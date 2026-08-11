/**
 * SQL 批量执行 API
 * 支持并发执行、超时控制、只读模式、SSE 实时进度推送
 */
import { Router } from 'express';
import fs from 'node:fs';
import { nanoid } from 'nanoid';
import { getById, getAll, insert, update } from '../database.mjs';
import { decryptPassword } from '../crypto.mjs';
import { validateSql } from '../sqlValidator.mjs';
import {
  createDbConnection,
  executeQuery,
  closeConnection,
  formatConnectionError,
} from './connections.mjs';

const router = Router();

/**
 * 检测 SQL 语句是否已包含 LIMIT / TOP / FETCH / ROWNUM 子句
 * 用于判断是否需要自动追加分页
 */
function sqlHasLimit(sql) {
  const upper = sql.toUpperCase();
  // MySQL/PostgreSQL/SQLite: LIMIT
  if (/\bLIMIT\s+\d+/i.test(sql)) return true;
  // SQL Server: SELECT TOP N / OFFSET ... FETCH
  if (/\bSELECT\s+TOP\s+\d+/i.test(sql)) return true;
  if (/\bFETCH\s+(FIRST|NEXT)\s+\d+/i.test(sql)) return true;
  // Oracle: ROWNUM <= N
  if (/\bROWNUM\s*<[=]?\s*\d+/i.test(sql)) return true;
  return false;
}

/**
 * 判断 SQL 是否为可追加 LIMIT 的 SELECT 查询
 * 排除 DDL、写操作、已含 LIMIT 的查询
 */
function canAppendLimit(sql) {
  if (!sql || !sql.trim()) return false;
  const upper = sql.trim().toUpperCase();
  // 必须先以 SELECT / WITH 开头
  if (!/^(SELECT|WITH)\b/i.test(upper)) return false;
  // 不能已含 LIMIT
  if (sqlHasLimit(sql)) return false;
  return true;
}

/**
 * 为 SELECT 语句追加 LIMIT ? OFFSET ? 包装（兼容多数据库语法）
 * 默认使用 LIMIT/OFFSET 语法（MySQL/PostgreSQL/SQLite/SQL Server 2012+）
 * @returns {string} 包装后的 SQL
 */
function appendPageLimit(sql, pageSize, offset) {
  const clean = sql.trim().replace(/;+\s*$/, ''); // 移除末尾分号
  return `${clean} LIMIT ${Number(pageSize)} OFFSET ${Number(offset)}`;
}

/**
 * POST /api/execute
 * 启动批量 SQL 执行，通过 SSE 流式返回实时进度
 *
 * 请求体：
 * {
 *   sql: string,
 *   connectionIds: string[],        // 要执行的连接 ID 列表
 *   config: {
 *     concurrency: number,          // 并发数（默认 5）
 *     timeoutMs: number,            // 单库超时（默认 30000）
 *     continueOnError: boolean,     // 失败后继续（默认 true）
 *     maxRetries: number,           // 重试次数（默认 1）
 *     readOnlyMode: boolean         // 只读模式（默认 true）
 *   },
 *   pageSize?: number,              // 每批行数（默认不限制，指定后自动追加 LIMIT）
 *   offset?: number                 // 偏移量（默认 0，配合 pageSize 使用）
 * }
 *
 * SSE 事件：
 * - progress: { taskId, connectionId, hospitalName, status, duration, errorMessage, rowCount, columns, rows, totalRows, truncated, hasMore, totalLoaded }
 * - complete: { executionId, summary: { total, success, failed, timeout, totalDuration } }
 * - error: { message }
 */
router.post('/', async (req, res) => {
  const { sql, connectionIds, config = {}, pageSize, offset = 0 } = req.body;

  // 参数校验
  if (!sql || !sql.trim()) {
    return res.status(400).json({ error: 'SQL 语句不能为空' });
  }
  if (!connectionIds || connectionIds.length === 0) {
    return res.status(400).json({ error: '请选择至少一个目标数据库' });
  }

  const {
    concurrency = 5,
    timeoutMs = 30000,
    continueOnError = true,
    maxRetries = 1,
    readOnlyMode = true,
  } = config;

  // ─── 分页参数处理 ───
  const effectivePageSize = pageSize && Number(pageSize) > 0 ? Number(pageSize) : 0;
  const effectiveOffset = Number(offset) || 0;
  // 需要用分页包装的 SQL（首次执行或 loadMore）
  const needsPagination = effectivePageSize > 0 && canAppendLimit(sql);
  const execSql = needsPagination
    ? appendPageLimit(sql, effectivePageSize, effectiveOffset)
    : sql;

  // SQL 校验（使用原始 SQL，不校验 LIMIT 包装后的）
  const validation = validateSql(sql, { readOnlyMode });
  if (!validation.valid) {
    return res.status(400).json({ error: validation.errors.join('; ') });
  }

  // 设置 SSE 响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 立即 flush 响应头 + 初始注释，确保 SSE 流立即可用
  res.flushHeaders();
  res.write(':ok\n\n');

  // 防止 socket 写入错误导致连接断开（如 Java 子进程 EPIPE 连锁反应）
  if (res.socket) {
    res.socket.on('error', () => {}); // 静默处理 socket 级错误
  }

  // 安全的 SSE 发送：写入失败时静默忽略，不抛异常
  const sendSSE = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // 客户端可能已断开，静默忽略
    }
  };

  const executionId = nanoid(8);
  const executionStart = Date.now();

  // 创建执行历史记录
  const historyRecord = {
    id: executionId,
    sql_text: sql,
    connection_count: connectionIds.length,
    success_count: 0,
    failed_count: 0,
    timeout_count: 0,
    duration_ms: 0,
    read_only_mode: readOnlyMode ? 1 : 0,
    config_json: JSON.stringify({ concurrency, timeoutMs, continueOnError, maxRetries }),
    executed_at: new Date().toISOString(),
  };
  await insert('executionHistory', historyRecord);

  // Abort 检测
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  // 构建执行任务列表
  const tasks = connectionIds.map((connId, idx) => ({
    id: connId,
    executionId,
    connectionId: connId,
    index: idx,
  }));

  // 获得连接信息及其所属连接实例名
  const hospitals = await getAll('hospitals');
  const predbTypes = await getAll('predbTypes');
  const districts = await getAll('districts');

  for (const task of tasks) {
    const hospital = hospitals.find((h) => h.connection_id === task.connectionId);
    if (hospital) {
      const district = districts.find((d) => d.id === hospital.district_id);
      const predbType = district
        ? predbTypes.find((pt) => pt.id === district.predb_type_id)
        : null;
      task.hospitalName = hospital.name;
      task.predbTypeName = predbType?.name || '';
      task.districtName = district?.name || '';
    } else {
      task.hospitalName = task.connectionId;
      task.predbTypeName = '';
      task.districtName = '';
    }
  }

  // 统计
  let successCount = 0;
  let failedCount = 0;
  let timeoutCount = 0;

  // 并发执行池
  let currentIdx = 0;

  const processTask = async (task) => {
    if (aborted) return;
    const taskStart = Date.now();

    // 发送 running 事件
    sendSSE('progress', {
      taskId: task.id,
      connectionId: task.connectionId,
      hospitalName: task.hospitalName,
      predbTypeName: task.predbTypeName,
      status: 'running',
      timestamp: Date.now(),
    });

    const conn = await getById('connections', task.connectionId);
    if (!conn) {
      const duration = Date.now() - taskStart;
      failedCount++;
      sendSSE('progress', {
        taskId: task.id,
        connectionId: task.connectionId,
        hospitalName: task.hospitalName,
        predbTypeName: task.predbTypeName,
        status: 'failed',
        duration,
        errorMessage: '连接不存在',
        timestamp: Date.now(),
      });
      return;
    }

    const password = decryptPassword(conn.password_encrypted || '');
    let dbClient = null;

    try {
      // 建立连接（传入 schema 以自动设置 search_path）
      const effectiveSchema = conn.schema_name || conn.schema || '';
      console.log(`[execute] conn=${conn.id} name=${conn.name} driver=${conn.driver} schema="${effectiveSchema}"`);
      dbClient = await createDbConnection({
        driver: conn.driver,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        database: conn.database_name || conn.database || '',
        schema: effectiveSchema,
        customDriverId: conn.custom_driver_id || undefined,
      });

      // 执行查询
      const result = await executeQuery(dbClient, conn.driver, execSql, timeoutMs, conn.custom_driver_id || undefined);

      const duration = Date.now() - taskStart;
      successCount++;

      const resultRowCount = result.rows.length;
      // 分页模式下：返回行数等于 pageSize 说明可能还有更多数据
      const hasMore = needsPagination ? (resultRowCount >= effectivePageSize) : false;
      const totalLoaded = needsPagination
        ? (effectiveOffset + resultRowCount)
        : resultRowCount;
      // 非分页模式：仍保留原来 500 行截断逻辑
      const shouldTruncate = !needsPagination && resultRowCount > 500;
      const limitedRows = shouldTruncate ? result.rows.slice(0, 500) : result.rows;

      sendSSE('progress', {
        taskId: task.id,
        connectionId: task.connectionId,
        hospitalName: task.hospitalName,
        predbTypeName: task.predbTypeName,
        status: 'success',
        duration,
        rowCount: resultRowCount,
        columns: result.columns,
        rows: limitedRows,
        totalRows: resultRowCount,
        truncated: shouldTruncate,
        hasMore,
        totalLoaded,
        timestamp: Date.now(),
      });

      // 更新连接状态为在线
      await update('connections', task.connectionId, { status: 'online' });
    } catch (err) {
      const duration = Date.now() - taskStart;
      const isTimeout = err.message && err.message.includes('超时');

      if (isTimeout) {
        timeoutCount++;
        sendSSE('progress', {
          taskId: task.id,
          connectionId: task.connectionId,
          hospitalName: task.hospitalName,
          predbTypeName: task.predbTypeName,
          status: 'timeout',
          duration,
          errorMessage: err.message,
          timestamp: Date.now(),
        });
      } else {
        // 静默处理 PG/瀚高 服务端主动取消（查询超时/连接断开导致）
        // 这不是用户手动停止，而是 statement_timeout 或 JDBC bridge 30s 超时被 PG 主动 cancel
        const rawErr = err.message || String(err);
        const isServerCancel = /canceling statement|aborted|query has no destination|connection.*terminat/i.test(rawErr)
          || /Statement canceled/i.test(rawErr)
          || /timeout expired/i.test(rawErr);
        if (isServerCancel) {
          timeoutCount++;
          sendSSE('progress', {
            taskId: task.id,
            connectionId: task.connectionId,
            hospitalName: task.hospitalName,
            predbTypeName: task.predbTypeName,
            status: 'timeout',
            duration,
            errorMessage: '查询执行超时（超过 30 秒），已被数据库服务端取消。请缩小查询范围或优化 SQL。',
            timestamp: Date.now(),
          });
        } else {
          failedCount++;
          sendSSE('progress', {
            taskId: task.id,
            connectionId: task.connectionId,
            hospitalName: task.hospitalName,
            predbTypeName: task.predbTypeName,
            status: 'failed',
            duration,
            errorMessage: formatConnectionError(err),
            timestamp: Date.now(),
          });
        }
      }

      // 更新连接状态
      await update('connections', task.connectionId, { status: 'error' });
    } finally {
      if (dbClient) {
        // 如果客户端已断开，发 SQL 取消真实数据库连接（瀚高/PostgreSQL 都支持 pg_cancel_backend）
        if (aborted) {
          try {
            // 标准 pg.Client：调 cancel() 中断当前 query
            if (typeof dbClient.cancel === 'function' && dbClient.activeQuery) {
              dbClient.cancel(dbClient.activeQuery, () => {});
            }
            // JDBC 桥接：杀 Java 子进程（HgdbBridge 通过 stdin pipe 通信，子进程会自然结束）
            if (dbClient.__type === 'jdbc_bridge' && dbClient.client?.process) {
              dbClient.client.process.kill('SIGTERM');
            }
            // 兜底：直接 destroy socket
            if (typeof dbClient.destroy === 'function') dbClient.destroy();
          } catch { /* ignore */ }
        }
        await closeConnection(dbClient, conn.driver, conn.custom_driver_id || undefined).catch(() => {});
      }
    }
  };

  // 工作线程
  const worker = async () => {
    while (currentIdx < tasks.length && !aborted) {
      const idx = currentIdx++;
      if (idx >= tasks.length) break;
      await processTask(tasks[idx]);
    }
  };

  // 启动并发池
  const poolSize = Math.min(concurrency, tasks.length);
  const workers = [];
  for (let i = 0; i < poolSize; i++) {
    workers.push(worker());
  }

  try {
    await Promise.all(workers);
  } catch (err) {
    // 客户端主动断开 / PG 服务端 cancel 查询 → 静默处理（不发 error 事件）
    if (aborted || /canceling statement|aborted|connection terminated/i.test(err.message || '')) {
      console.log('[execute] 客户端已断开或查询被取消，静默处理');
    } else {
      sendSSE('error', { message: err.message });
    }
  }

  // 执行完毕
  if (!aborted) {
    const totalDuration = Date.now() - executionStart;

    // 更新执行历史
    await update('executionHistory', executionId, {
      success_count: successCount,
      failed_count: failedCount,
      timeout_count: timeoutCount,
      duration_ms: totalDuration,
    });

    sendSSE('complete', {
      executionId,
      summary: {
        total: tasks.length,
        success: successCount,
        failed: failedCount,
        timeout: timeoutCount,
        totalDuration,
      },
      timestamp: Date.now(),
    });
  }

  res.end();
});

export default router;
