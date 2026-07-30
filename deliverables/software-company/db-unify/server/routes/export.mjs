/**
 * 临时数据导出 API
 * - POST /api/export/preview           预览前 N 行
 * - POST /api/export/execute           启动导出（返回 JSON {executionId, downloadUrl, ...}）
 * - GET  /api/export/progress/:id      SSE 流式推送进度
 * - GET  /api/export/download/:id      下载生成的文件（Content-Disposition: attachment）
 * - POST /api/export/cancel/:id        取消进行中的导出
 * - GET  /api/export/formats           获取支持的导出格式配置
 * - GET  /api/export/history           导出历史
 *
 * 文件导出为「浏览器下载」模式：后端不写盘到业务目录，临时文件写到 os.tmpdir()，
 * 文件下载通过 /api/export/download/:id 端点流式返回 + Content-Disposition 触发浏览器下载。
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { authMiddleware } from '../middleware/auth.mjs';
import { getAll } from '../database.mjs';
import { exportToFile, exportToDatabase, ExportCancelledError } from '../sync/exportEngine.mjs';

const router = express.Router();

// 内存状态：执行中的导出
const activeExports = new Map();          // executionId -> { cancelled }
const progressSubscribers = new Map();   // executionId -> Set<res>
const readyFiles = new Map();             // executionId -> { filePath, filename, mime, size, tableName, totalRows, durationMs, createdAt }
let exportCounter = 0;

const TEMP_TTL_MS = 30 * 60 * 1000; // 临时文件 30 分钟后清理

/** MIME 推断 */
function getContentType(format) {
  const map = {
    csv: 'text/csv; charset=utf-8',
    tsv: 'text/tab-separated-values; charset=utf-8',
    sql: 'application/sql; charset=utf-8',
    json: 'application/json; charset=utf-8',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
  return map[format] || 'application/octet-stream';
}

function sendEvent(res, event, data) {
  try {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    /* ignore */
  }
}

function broadcastProgress(executionId, event, data) {
  const subs = progressSubscribers.get(executionId);
  if (!subs || subs.size === 0) return;
  for (const res of subs) sendEvent(res, event, data);
}

function ensureTempDir() {
  const dir = path.join(os.tmpdir(), 'dclaw-exports');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 清理过期的临时文件（懒清理：被命中时顺手扫一次） */
function cleanupExpiredTempFiles() {
  const dir = path.join(os.tmpdir(), 'dclaw-exports');
  if (!fs.existsSync(dir)) return;
  const now = Date.now();
  try {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      try {
        const stat = fs.statSync(full);
        if (now - stat.mtimeMs > TEMP_TTL_MS) {
          fs.unlinkSync(full);
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* skip */
  }
  // 清理过期的 readyFiles 记录
  for (const [id, info] of readyFiles.entries()) {
    if (now - info.createdAt > TEMP_TTL_MS) {
      try {
        if (fs.existsSync(info.filePath)) fs.unlinkSync(info.filePath);
      } catch {
        /* skip */
      }
      readyFiles.delete(id);
    }
  }
}

// 启动后台清理
setInterval(cleanupExpiredTempFiles, 5 * 60 * 1000).unref?.();

/** 预览前 N 行 */
router.post('/preview', authMiddleware, async (req, res) => {
  try {
    const { source, limit = 100 } = req.body || {};
    if (!source) return res.status(400).json({ error: '缺少 source 参数' });
    if (!source.connectionId && !source.connection)
      return res.status(400).json({ error: '必须指定源连接 ID' });

    // 归一化字段：前端用 tableName，引擎用 table
    const normalizedSource = {
      ...source,
      table: source.table || source.tableName,
      schema: source.schema || source.schemaName,
    };

    const { describeQuery, detectDbType, executeQueryWithParams, buildPagedSql } = await import('../sync/batchReader.mjs');
    const { createDbConnection, closeConnection, resolveRealDriver } = await import('../routes/connections.mjs');
    const { getById } = await import('../database.mjs');
    const { buildSourceSql } = await import('../sync/exportEngine.mjs');

    const connRecord = source.connection || (await getById('connections', source.connectionId));
    if (!connRecord) return res.status(404).json({ error: '连接不存在' });

    const conn = await createDbConnection(connRecord);
    try {
      const driver = await resolveRealDriver(connRecord.driver, connRecord.custom_driver_id);
      const dbType = await detectDbType(driver, connRecord.custom_driver_id);
      const sql = buildSourceSql(
        { ...connRecord, schemaName: normalizedSource.schema, tableName: normalizedSource.table, table: normalizedSource.table, sql: normalizedSource.sql, filter: normalizedSource.filter },
        dbType
      );
      const params = normalizedSource.filter ? [normalizedSource.filter] : [];
      const desc = await describeQuery(conn, driver, sql, params, connRecord.custom_driver_id, dbType);
      const colNames = (desc.columns || []).map((c) => c.name);
      const pagedSql = buildPagedSql(sql, limit, 0, dbType);
      const result = await executeQueryWithParams(conn, driver, pagedSql, params, 60000, connRecord.custom_driver_id);

      const rows = (result.rows || []).map((r) => {
        const o = {};
        for (let i = 0; i < colNames.length; i++) o[colNames[i]] = r[i] !== undefined ? r[i] : r[colNames[i]];
        return o;
      });

      res.json({
        columns: colNames,
        rows,
        totalRows: result.rows?.length || 0,
        truncated: (result.rows?.length || 0) >= limit,
      });
    } finally {
      await closeConnection(conn);
    }
  } catch (err) {
    console.error('[export/preview]', err);
    res.status(500).json({ error: err?.message || '预览失败' });
  }
});

/** 计算最终下载文件名 */
function buildDownloadFilename(target, source) {
  const format = String(target?.file?.format || target?.format || 'csv').toLowerCase();
  const raw = String(target?.file?.filename || target?.filename || '').trim();
  let base = raw;
  if (!base) {
    const ts = new Date()
      .toISOString()
      .replace(/[-:T.Z]/g, '')
      .slice(0, 14);
    if (source?.type === 'table' && source.tableName) {
      base = `${source.tableName}_${ts}`;
    } else if (source?.tableName) {
      base = `${source.tableName}_${ts}`;
    } else if (source?.type === 'sql' || source?.sql) {
      base = `export_${ts}`;
    } else {
      base = `export_${ts}`;
    }
  }
  // 保证后缀
  const ext = format;
  if (!/\.[a-z0-9]+$/i.test(base)) base = `${base}.${ext}`;
  return base;
}

/**
 * 启动导出任务（立即返回 JSON，包含 executionId + 进度/下载 URL）
 * 后端任务在后台跑：写临时文件 -> 通过 SSE 推进度 -> 完成后登记 readyFiles
 */
router.post('/execute', authMiddleware, async (req, res) => {
  const { source, target, options = {} } = req.body || {};

  if (!source) return res.status(400).json({ error: '缺少 source 参数' });
  if (!target) return res.status(400).json({ error: '缺少 target 参数' });

  const executionId = `exp-${Date.now()}-${++exportCounter}-${crypto.randomBytes(2).toString('hex')}`;

  // 归一化字段
  const normalizedSource = {
    ...source,
    table: source.table || source.tableName,
    schema: source.schema || source.schemaName,
  };

  // 归一化 target
  let normalizedTarget = { ...target };
  if (normalizedTarget.type === 'file') {
    const format = String(normalizedTarget.format || normalizedTarget.file?.format || 'csv').toLowerCase();
    // 强制使用临时目录（不再写容器业务目录）
    const tempDir = ensureTempDir();
    const filename = buildDownloadFilename({ ...normalizedTarget, file: { ...(normalizedTarget.file || {}), format } }, normalizedSource);
    const safeName = filename.replace(/[^A-Za-z0-9._\u4e00-\u9fa5\-]/g, '_');
    const tempFilePath = path.join(tempDir, `${executionId}__${safeName}`);

    normalizedTarget = {
      ...normalizedTarget,
      file: {
        ...(normalizedTarget.file || {}),
        format,
        path: tempFilePath, // 关键：写到这里
        encoding: normalizedTarget.encoding || normalizedTarget.file?.encoding || 'utf-8',
        delimiter: normalizedTarget.delimiter || normalizedTarget.file?.delimiter,
        includeHeader: normalizedTarget.includeHeader ?? normalizedTarget.file?.includeHeader ?? true,
        sqlIncludeDrop: normalizedTarget.sqlIncludeDrop ?? normalizedTarget.file?.sqlIncludeDrop ?? false,
        compress: normalizedTarget.compress ?? normalizedTarget.file?.compress ?? false,
        filename,
      },
    };
  }

  // 取消标记
  const cancelledRef = { value: false };
  activeExports.set(executionId, cancelledRef);

  // 立即返回 JSON（不再用 SSE 作为 execute 的返回通道）
  res.json({
    executionId,
    mode: normalizedTarget.type,
    statusUrl: `/api/export/progress/${executionId}`,
    downloadUrl: normalizedTarget.type === 'file' ? `/api/export/download/${executionId}` : null,
    filename: normalizedTarget.type === 'file' ? normalizedTarget.file.filename : null,
  });

  // 后台异步执行
  const started = Date.now();
  let lastEvent = { processedRows: 0, totalRows: 0 };
  let tableName = null;
  let filePath = null;
  let fileSize = 0;

  const onProgress = (evt) => {
    if (cancelledRef.value) return;
    const processedRows = evt.processedRows ?? evt.readRows ?? evt.writtenRows ?? lastEvent.processedRows;
    const totalRows = evt.totalRows ?? lastEvent.totalRows;
    lastEvent = { processedRows, totalRows };
    const elapsed = Date.now() - started;
    const speed = elapsed > 0 ? Math.round(processedRows / (elapsed / 1000)) : 0;
    const payload = totalRows
      ? { processedRows, totalRows, rate: speed, elapsedMs: elapsed }
      : { processedRows };
    broadcastProgress(executionId, 'progress', payload);
  };

  const isCancelled = () => cancelledRef.value;

  (async () => {
    try {
      broadcastProgress(executionId, 'start', {
        executionId,
        filePath: normalizedTarget.type === 'file' ? normalizedTarget.file.filename : null,
        tableName: normalizedTarget.type === 'database' ? normalizedTarget.tableName : null,
      });

      if (normalizedTarget.type === 'database') {
        const result = await exportToDatabase({
          source: normalizedSource,
          target: normalizedTarget,
          options,
          onProgress,
          isCancelled,
        });
        tableName = normalizedTarget.tableName;
        broadcastProgress(executionId, 'done', {
          executionId,
          totalRows: result.totalRows || lastEvent.processedRows,
          tableName,
          durationMs: result.durationMs || Date.now() - started,
        });
      } else {
        const result = await exportToFile({
          source: normalizedSource,
          target: normalizedTarget,
          options,
          onProgress,
          isCancelled,
        });
        filePath = result.filePath || normalizedTarget.file.path;
        fileSize = result.fileSize || 0;
        // 文件已写到 tempFilePath，把它登记到 readyFiles 供 /download 拉取
        if (filePath && fs.existsSync(filePath)) {
          const stat = fs.statSync(filePath);
          readyFiles.set(executionId, {
            filePath,
            filename: normalizedTarget.file.filename,
            mime: getContentType(normalizedTarget.file.format),
            size: stat.size,
            tableName: null,
            totalRows: result.totalRows || lastEvent.processedRows,
            durationMs: result.durationMs || Date.now() - started,
            createdAt: Date.now(),
          });
        }
        broadcastProgress(executionId, 'done', {
          executionId,
          totalRows: result.totalRows || lastEvent.processedRows,
          filePath: normalizedTarget.file.filename,
          fileSize,
          durationMs: result.durationMs || Date.now() - started,
          downloadUrl: `/api/export/download/${executionId}`,
        });
      }

      writeExportHistory({
        userId: req.user?.id || 'unknown',
        source,
        target,
        status: 'success',
        totalRows: lastEvent.processedRows,
        filePath: filePath ? normalizedTarget.file.filename : null,
        tableName,
        durationMs: Date.now() - started,
        req,
      }).catch((err) => console.error('[export/history]', err));
    } catch (err) {
      if (err instanceof ExportCancelledError || err?.name === 'ExportCancelledError') {
        broadcastProgress(executionId, 'error', { message: '导出已取消' });
      } else {
        console.error('[export/execute]', err);
        broadcastProgress(executionId, 'error', { message: err?.message || '导出失败' });
      }
    } finally {
      // 延迟清理 activeExports，给客户端一点时间收 done
      setTimeout(() => activeExports.delete(executionId), 5_000);
      // 进度订阅者仍可短暂收到 done/error，5 秒后再清理
      setTimeout(() => {
        const subs = progressSubscribers.get(executionId);
        if (subs) {
          for (const r of subs) {
            try { r.end(); } catch { /* ignore */ }
          }
          progressSubscribers.delete(executionId);
        }
      }, 6_000);
    }
  })();
});

/** SSE 进度订阅（与执行 ID 绑定） */
router.get('/progress/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).json({ error: '缺少 executionId' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // 订阅
  let subs = progressSubscribers.get(id);
  if (!subs) {
    subs = new Set();
    progressSubscribers.set(id, subs);
  }
  subs.add(res);

  // 立即推一个 ready 事件，前端可借此判断订阅建立
  sendEvent(res, 'ready', { executionId: id });

  // 心跳保活（很多代理会 60s 切断）
  const heartbeat = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
    } catch {
      /* ignore */
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const s = progressSubscribers.get(id);
    if (s) {
      s.delete(res);
      if (s.size === 0) progressSubscribers.delete(id);
    }
  });
});

/** 下载文件（Content-Disposition: attachment 触发浏览器下载） */
router.get('/download/:id', authMiddleware, (req, res) => {
  const id = req.params.id;
  const info = readyFiles.get(id);
  if (!info || !fs.existsSync(info.filePath)) {
    return res.status(404).json({ error: '文件不存在或已过期，请重新导出' });
  }

  // 一些浏览器对 RFC 5987 编码的中文 filename 支持不一致，给出 fallback
  const rawName = info.filename || 'export';
  const asciiFallback = rawName.replace(/[^\x20-\x7E]/g, '_') || 'export';
  const encodedName = encodeURIComponent(rawName);

  res.setHeader('Content-Type', info.mime);
  res.setHeader('Content-Length', info.size);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedName}`
  );
  res.setHeader('Cache-Control', 'no-cache');

  const stream = fs.createReadStream(info.filePath);
  stream.on('error', (err) => {
    console.error('[export/download] stream error', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  });
  stream.on('close', () => {
    // 不立刻删除：浏览器重试/Range 还需要。30 分钟后自动清理。
  });
  stream.pipe(res);
});

/** 取消进行中的导出 */
router.post('/cancel/:id', authMiddleware, (req, res) => {
  const item = activeExports.get(req.params.id);
  if (!item) return res.status(404).json({ error: '导出不存在或已完成' });
  item.value = true;
  activeExports.delete(req.params.id);
  res.json({ ok: true });
});

/** 获取支持的导出格式 */
router.get('/formats', authMiddleware, (_req, res) => {
  res.json({
    fileFormats: [
      { id: 'csv', label: 'CSV', extension: 'csv', maxRows: 500000 },
      { id: 'tsv', label: 'TSV', extension: 'tsv', maxRows: 500000 },
      { id: 'sql', label: 'SQL INSERT', extension: 'sql', maxRows: 500000 },
      { id: 'json', label: 'JSON', extension: 'json', maxRows: 500000 },
      { id: 'xlsx', label: 'Excel (XLSX)', extension: 'xlsx', maxRows: 100000 },
    ],
    targetTypes: [
      { id: 'file', label: '本地文件（下载）' },
      { id: 'database', label: '数据库' },
    ],
    encodings: ['utf-8', 'gbk', 'gb18030'],
    dbWriteStrategies: [
      { id: 'append', label: 'INSERT (追加)' },
      { id: 'truncate', label: 'TRUNCATE + INSERT' },
      { id: 'drop_create', label: 'DROP + CREATE' },
    ],
  });
});

/** 导出历史 */
router.get('/history', authMiddleware, async (_req, res) => {
  try {
    const history = await getAll('exportHistory');
    res.json({ history: history || [] });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

async function writeExportHistory({ userId, source, target, status, totalRows, filePath, tableName, durationMs, req }) {
  try {
    const { query: pgQuery } = await import('../db/pool.mjs');
    await pgQuery(
      `INSERT INTO export_history (user_id, source_conn, source_table, source_sql, target_type, target_format, target_path, target_conn, target_table, total_rows, file_size, duration_ms, status, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        userId,
        source.connectionId || source.connection?.id || '',
        source.tableName || null,
        source.sql || null,
        target.type,
        target.type === 'file' ? (target.format || null) : null,
        filePath || null,
        target.type === 'database' ? (target.connectionId || null) : null,
        tableName || null,
        totalRows || 0,
        null,
        durationMs || 0,
        status,
        req?.ip || null,
      ]
    );
  } catch (err) {
    console.error('[export/history] write failed', err);
  }
}

export default router;
