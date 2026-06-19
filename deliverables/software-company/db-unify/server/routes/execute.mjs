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
 *   }
 * }
 *
 * SSE 事件：
 * - progress: { taskId, connectionId, hospitalName, status, duration, errorMessage, rowCount, columns }
 * - complete: { executionId, summary: { total, success, failed, timeout, totalDuration } }
 * - error: { message }
 */
router.post('/', async (req, res) => {
  const { sql, connectionIds, config = {} } = req.body;

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

  // SQL 校验
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
  insert('executionHistory', historyRecord);

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
  const hospitals = getAll('hospitals');
  const predbTypes = getAll('predbTypes');
  const districts = getAll('districts');

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

    const conn = getById('connections', task.connectionId);
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
      dbClient = await createDbConnection({
        driver: conn.driver,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password,
        database: conn.database_name,
        schema: conn.schema_name || '',
        customDriverId: conn.custom_driver_id || undefined,
      });

      // 执行查询
      const result = await executeQuery(dbClient, conn.driver, sql, timeoutMs, conn.custom_driver_id || undefined);

      const duration = Date.now() - taskStart;
      successCount++;

      // 限制返回行数，避免前端渲染卡死
      const MAX_ROWS = 500;
      const truncated = result.rows.length > MAX_ROWS;
      const limitedRows = result.rows.slice(0, MAX_ROWS);

      sendSSE('progress', {
        taskId: task.id,
        connectionId: task.connectionId,
        hospitalName: task.hospitalName,
        predbTypeName: task.predbTypeName,
        status: 'success',
        duration,
        rowCount: result.rows.length,
        columns: result.columns,
        rows: limitedRows,
        totalRows: result.rows.length,
        truncated,
        timestamp: Date.now(),
      });

      // 更新连接状态为在线
      update('connections', task.connectionId, { status: 'online' });
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

      // 更新连接状态
      update('connections', task.connectionId, { status: 'error' });
    } finally {
      if (dbClient) {
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
    sendSSE('error', { message: err.message });
  }

  // 执行完毕
  if (!aborted) {
    const totalDuration = Date.now() - executionStart;

    // 更新执行历史
    update('executionHistory', executionId, {
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
