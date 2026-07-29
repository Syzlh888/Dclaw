/**
 * 临时数据导出 API
 * - POST /api/export/preview   预览前 N 行
 * - POST /api/export/execute   执行导出（SSE 流式推送进度）
 * - POST /api/export/cancel/:id 取消进行中的导出
 * - GET  /api/export/formats   获取支持的导出格式配置
 * - GET  /api/export/history   导出历史
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { authMiddleware } from '../middleware/auth.mjs';
import { getAll } from '../database.mjs';
import { exportToFile, exportToDatabase, isExportLocked, ExportCancelledError } from '../sync/exportEngine.mjs';

const router = express.Router();

// 进行中的导出，便于取消
const activeExports = new Map();
let exportCounter = 0;

function sendEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

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

    const { describeQuery, detectDbType, executeQueryWithParams } = await import('../sync/batchReader.mjs');
    const { createDbConnection, closeConnection, resolveRealDriver } = await import('../routes/connections.mjs');
    const { getById } = await import('../database.mjs');
    const { buildSourceSql } = await import('../sync/exportEngine.mjs');

    const connRecord = source.connection || await getById('connections', source.connectionId);
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
      const pagedSql = (await import('../sync/batchReader.mjs')).buildPagedSql(sql, limit, 0, dbType);
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

/** 执行导出（SSE 流式推送） */
router.post('/execute', authMiddleware, async (req, res) => {
  const executionId = `exp-${Date.now()}-${++exportCounter}`;
  const { source, target, options = {} } = req.body || {};

  if (!source) {
    return res.status(400).json({ error: '缺少 source 参数' });
  }
  if (!target) {
    return res.status(400).json({ error: '缺少 target 参数' });
  }

  // 归一化字段
  const normalizedSource = {
    ...source,
    table: source.table || source.tableName,
    schema: source.schema || source.schemaName,
  };
  // 归一化 target：把 savePath 转 path，format 平铺到 file 对象
  let normalizedTarget = { ...target };
  if (normalizedTarget.type === 'file') {
    const merged = { ...normalizedTarget };
    merged.file = {
      ...(normalizedTarget.file || {}),
      format: normalizedTarget.format || normalizedTarget.file?.format,
      path: normalizedTarget.savePath || normalizedTarget.path || normalizedTarget.file?.path,
      encoding: normalizedTarget.encoding || normalizedTarget.file?.encoding,
      delimiter: normalizedTarget.delimiter || normalizedTarget.file?.delimiter,
      includeHeader: normalizedTarget.includeHeader ?? normalizedTarget.file?.includeHeader,
      sqlIncludeDrop: normalizedTarget.sqlIncludeDrop ?? normalizedTarget.file?.sqlIncludeDrop,
      compress: normalizedTarget.compress ?? normalizedTarget.file?.compress,
    };
    normalizedTarget = merged;
    console.log('[export] normalizedTarget.file =', JSON.stringify(normalizedTarget.file));
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const cancelledRef = { value: false };
  activeExports.set(executionId, cancelledRef);

  const started = Date.now();
  let cancelled = false;
  let lastEvent = { processedRows: 0, totalRows: 0 };
  let filePath = null;
  let tableName = null;

  // 客户端断开
  req.on('close', () => {
    cancelledRef.value = true;
    activeExports.delete(executionId);
  });

  const onProgress = (evt) => {
    if (cancelled) return;
    // 兼容 exportEngine 的事件字段(readRows/writtenRows)和标准字段(processedRows)
    const processedRows = evt.processedRows ?? evt.readRows ?? evt.writtenRows ?? lastEvent.processedRows;
    const totalRows = evt.totalRows ?? lastEvent.totalRows;
    lastEvent = { processedRows, totalRows };
    if (evt.totalRows) {
      const elapsed = Date.now() - started;
      const speed = elapsed > 0 ? (processedRows / (elapsed / 1000)) : 0;
      sendEvent(res, 'progress', {
        processedRows,
        totalRows,
        rate: Math.round(speed),
        elapsedMs: elapsed,
      });
    } else {
      sendEvent(res, 'progress', {
        processedRows,
      });
    }
  };

  const isCancelled = () => cancelledRef.value;

  try {
    // start event
    sendEvent(res, 'start', {
      executionId,
      filePath: target?.type === 'file' ? target.savePath : null,
      tableName: target?.type === 'database' ? target.tableName : null,
    });

    if (target.type === 'database') {
      // DB 目标
      const result = await exportToDatabase({
        source: normalizedSource,
        target: normalizedTarget,
        options,
        onProgress,
        isCancelled,
      });
      filePath = null;
      tableName = target.tableName;
      const finalResult = {
        executionId,
        totalRows: result.totalRows || lastEvent.processedRows,
        tableName,
        durationMs: result.durationMs || (Date.now() - started),
      };
      sendEvent(res, 'done', finalResult);
    } else {
      // 文件目标
      const result = await exportToFile({
        source: normalizedSource,
        target: normalizedTarget,
        options,
        onProgress,
        isCancelled,
      });
      filePath = result.filePath || target.savePath;
      const finalResult = {
        executionId,
        totalRows: result.totalRows || lastEvent.processedRows,
        filePath,
        durationMs: result.durationMs || (Date.now() - started),
        fileSize: result.fileSize,
      };
      sendEvent(res, 'done', finalResult);
    }

    // 异步写历史
    writeExportHistory({
      userId: req.user?.id || 'unknown',
      source,
      target,
      status: 'success',
      totalRows: lastEvent.processedRows,
      filePath,
      tableName,
      durationMs: Date.now() - started,
      req,
    }).catch((err) => console.error('[export/history]', err));
  } catch (err) {
    if (err instanceof ExportCancelledError || err?.name === 'ExportCancelledError') {
      sendEvent(res, 'error', { message: '导出已取消' });
    } else {
      console.error('[export/execute]', err);
      sendEvent(res, 'error', { message: err?.message || '导出失败' });
    }
  } finally {
    activeExports.delete(executionId);
    res.end();
  }
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
      { id: 'file', label: '本地文件' },
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
    // 直接走 PG，避免 insert 函数默认生成 nanoid（表 id 是 uuid）
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