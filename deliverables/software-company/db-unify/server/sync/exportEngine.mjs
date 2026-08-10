/** 临时导出引擎：连接生命周期、计数、读取、文件/数据库写入和并发锁。 */
import fs from 'node:fs';
import path from 'node:path';
import { createDbConnection, closeConnection, executeQuery, resolveRealDriver } from '../routes/connections.mjs';
import { decryptPassword } from '../crypto.mjs';
import { getById } from '../database.mjs';
import { detectDbType, executeQueryWithParams, streamBatch } from './batchReader.mjs';
import { normalizeDbType, quoteIdentifier, splitQualifiedName } from './transformer.mjs';
import { exportCsv, exportTsv, exportSql, exportJson, exportXlsx } from './exporters/fileExporters.mjs';
import { exportRowsToDatabase } from './exporters/dbExporter.mjs';

const DEFAULT_BATCH_SIZE = 10000;
const DEFAULT_MAX_ROWS = Number.MAX_SAFE_INTEGER  // 0 或不传表示不限制;
const XLSX_MAX_ROWS = 100000;
const locks = new Map();

export class ExportCancelledError extends Error {
  constructor(message = '导出已取消') { super(message); this.name = 'ExportCancelledError'; }
}

export class ExportLimitReached extends Error {
  constructor() { super('达到导出行数限制'); this.name = 'ExportLimitReached'; }
}

function connectionData(record) {
  if (!record) throw new Error('数据库连接配置不能为空');
  const data = { ...(record.connection || record.connectionData || {}), ...record };
  if (!data.driver || !data.host || !data.port || !data.username) throw new Error('数据库连接信息不完整');
  return {
    driver: data.driver,
    host: data.host,
    port: Number(data.port),
    username: data.username,
    password: data.password || decryptPassword(data.password_encrypted || ''),
    database: data.database || data.database_name || '',
    schema: data.schema || data.schema_name || '',
    customDriverId: data.customDriverId || data.custom_driver_id || undefined,
  };
}

export async function openExportConnection(record) {
  return createDbConnection(connectionData(record));
}

function safeSql(sql) {
  const value = String(sql || '').trim().replace(/;\s*$/, '');
  if (!value || !/^(SELECT|WITH)\b/i.test(value)) throw new Error('导出源必须是 SELECT 或 WITH 查询');
  // 不允许把多语句写入导出读取连接；末尾分号已在上面剥掉。
  if (value.includes(';')) throw new Error('导出源 SQL 不允许包含多条语句');
  return value;
}

function safeFilter(filter) {
  const value = String(filter || '').trim();
  if (!value) return '';
  if (value.includes(';') || /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE)\b/i.test(value)) {
    throw new Error('过滤条件包含不允许的 SQL');
  }
  return value.replace(/^WHERE\s+/i, '');
}

function qualifiedName(schema, table, dbType) {
  const quote = normalizeDbType(dbType) === 'mysql' ? '`' : '"';
  const part = (name) => `${quote}${String(name).replaceAll(quote, quote + quote)}${quote}`;
  return schema ? `${part(schema)}.${part(table)}` : part(table);
}

export function buildSourceSql(source, dbType = 'postgresql') {
  if (source.sql) return safeSql(source.sql);
  if (!source.table) throw new Error('请选择源表或填写源 SQL');
  const parsed = splitQualifiedName(source.table, source.schema || '');
  if (!parsed.table) throw new Error('源表不能为空');
  const table = qualifiedName(parsed.schema, parsed.table, dbType);
  const filter = safeFilter(source.filter);
  return `SELECT * FROM ${table}${filter ? ` WHERE ${filter}` : ''}`;
}

function normalizeColumns(result) {
  const rows = result?.rows || [];
  const columns = result?.columns || (rows.length ? Object.keys(rows[0]) : []);
  return columns.map((name) => ({ name, type: 'text', nullable: true }));
}

async function readSourceColumns(connection, source, driver, customDriverId, dbType, sql) {
  if (!source.table) {
    const result = await executeQueryWithParams(connection, driver, `SELECT * FROM (${sql}) __dclaw_columns WHERE 1 = 0`, source.params || [], 120000, customDriverId);
    return normalizeColumns(result);
  }
  const parsed = splitQualifiedName(source.table, source.schema || '');
  const schema = parsed.schema || source.schema || source.connection?.schema || source.connection?.schema_name
    || (dbType === 'mysql' ? '' : 'public');
  // 信息模式在 MySQL、PostgreSQL 兼容数据库和多数国产 PG fork 中都可用。
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const metadataSql = `SELECT column_name, data_type, is_nullable, character_maximum_length, numeric_precision, numeric_scale
    FROM information_schema.columns WHERE table_schema = ${literal(schema)} AND table_name = ${literal(parsed.table)}
    ORDER BY ordinal_position`;
  try {
    const metadata = await executeQuery(connection, driver, metadataSql, 120000, customDriverId);
    const rows = metadata.rows || [];
    if (rows.length) {
      return rows.map((row) => ({
        name: row.column_name ?? row.COLUMN_NAME,
        type: row.data_type ?? row.DATA_TYPE ?? 'text',
        nullable: String(row.is_nullable ?? row.IS_NULLABLE).toUpperCase() !== 'NO',
        length: row.character_maximum_length ?? row.CHARACTER_MAXIMUM_LENGTH,
        precision: row.numeric_precision ?? row.NUMERIC_PRECISION,
        scale: row.numeric_scale ?? row.NUMERIC_SCALE,
      }));
    }
  } catch (error) {
    console.warn('[export] 读取列类型失败，将按 text 映射:', error.message);
  }
  const result = await executeQuery(connection, driver, `SELECT * FROM ${qualifiedName(parsed.schema, parsed.table, dbType)} WHERE 1 = 0`, 120000, customDriverId);
  return normalizeColumns(result);
}

async function countRows(connection, driver, sql, params, customDriverId) {
  const result = await executeQueryWithParams(connection, driver, `SELECT COUNT(*) AS __dclaw_total FROM (${sql}) __dclaw_count`, params || [], 15 * 60 * 1000, customDriverId);
  const row = result.rows?.[0] || {};
  return Number(row.__dclaw_total ?? row.__DCLAW_TOTAL ?? Object.values(row)[0] ?? 0) || 0;
}

function resolveOutputPath(file) {
  const output = String(file?.path || '').trim();
  if (!output) throw new Error('文件导出路径不能为空');
  if (path.isAbsolute(output)) return output;
  return path.resolve(process.cwd(), 'data', 'exports', output);
}

async function ensureParent(outputPath) {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
}

function lockKey(source) {
  return `${source.connectionId || source.connection?.id || 'connection'}:${source.schema || ''}:${source.table || source.sql || ''}`;
}

async function withSourceLock(source, callback) {
  const key = lockKey(source);
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  const chain = previous.then(() => current);
  locks.set(key, chain);
  await previous;
  try { return await callback(); } finally {
    release();
    if (locks.get(key) === chain) locks.delete(key);
  }
}

export function isExportLocked(source) {
  return locks.has(lockKey(source));
}

async function* createRowsStream({ connection, source, sql, options, driver, customDriverId, dbType, onProgress, totalRows, isCancelled }) {
  // 0/空表示不限制，> 0 才是指定值
  const maxRows = Number(options.maxRows) > 0 ? Math.max(1, Number(options.maxRows)) : DEFAULT_MAX_ROWS;
  const batchSize = Math.min(Math.max(1, Number(options.batchSize) || DEFAULT_BATCH_SIZE), 50000);
  let queue = [];
  let producedRows = 0;
  let done = false;
  let generatorStopped = false;
  let producerError = null;
  let notify;
  let resumeProducer;
  const wake = () => { const resolve = notify; notify = null; resolve?.(); };
  const producer = streamBatch(connection, sql, source.params || [], batchSize, {
    driver, customDriverId, dbType,
    onBatch: async (rows) => {
      if (isCancelled() || generatorStopped) throw new ExportCancelledError();
      const remaining = maxRows - producedRows;
      if (remaining <= 0) throw new ExportLimitReached();
      queue.push(...rows.slice(0, remaining));
      producedRows += Math.min(rows.length, remaining);
      wake();
      if (rows.length > remaining) throw new ExportLimitReached();
      if (onProgress) await onProgress({
        stage: 'reading', readRows: producedRows, writtenRows: 0,
        totalRows: Math.min(totalRows, maxRows), pct: totalRows ? Math.min(99, Math.round(producedRows * 100 / totalRows)) : 0,
      });
      // 最多缓存约两个 batch；消费者写磁盘较慢时暂停下一次 SELECT。
      if (queue.length > batchSize && !generatorStopped) {
        await new Promise((resolve) => { resumeProducer = resolve; });
      }
    },
    onComplete: async () => { done = true; wake(); },
    onError: async (error) => { if (!(error instanceof ExportLimitReached)) producerError = error; done = true; wake(); },
  }, customDriverId).catch((error) => {
    if (!(error instanceof ExportLimitReached)) producerError = error;
    done = true; wake();
  });

  try {
    while (!done || queue.length) {
      if (isCancelled()) throw new ExportCancelledError();
      if (!queue.length) { await new Promise((resolve) => { notify = resolve; }); continue; }
      const row = queue.shift();
      if (queue.length <= batchSize && resumeProducer) {
        const resume = resumeProducer;
        resumeProducer = null;
        resume();
      }
      yield row;
    }
    await producer;
    if (producerError) throw producerError;
  } finally {
    // producer 使用的是短连接查询，不持有可取消的游标；消费端断开时仅停止后续消费。
    generatorStopped = true;
    resumeProducer?.();
    queue = [];
  }
}

function exporterFor(format) {
  return ({ csv: exportCsv, tsv: exportTsv, sql: exportSql, json: exportJson, xlsx: exportXlsx })[String(format || 'csv').toLowerCase()];
}

async function prepareSource(source) {
  if (source.connection || source.connectionData) return { record: source, owned: false };
  const record = source.connectionRecord || await getById('connections', source.connectionId);
  if (!record) throw new Error(`源连接不存在: ${source.connectionId || ''}`);
  return { record: { ...source, connection: record }, owned: true };
}

async function prepareTarget(target) {
  const config = target.database || target;
  if (config.connection || config.connectionData) return { record: config, owned: false };
  const record = config.connectionRecord || await getById('connections', config.connectionId);
  if (!record) throw new Error(`目标连接不存在: ${config.connectionId || ''}`);
  return { record: { ...config, connection: record }, owned: true };
}

async function runFileExport({ source, target, options = {}, onProgress = () => {}, isCancelled = () => false }) {
  const sourcePrepared = await prepareSource(source);
  let sourceConn;
  const started = Date.now();
  try {
    const record = sourcePrepared.record;
    sourceConn = await openExportConnection(record);
    const sourceConfig = connectionData(record);
    const dbType = await detectDbType(sourceConfig.driver, sourceConfig.customDriverId);
    const sql = buildSourceSql(record, dbType);
    const columns = await readSourceColumns(sourceConn, record, sourceConfig.driver, sourceConfig.customDriverId, dbType, sql);
    const count = await countRows(sourceConn, sourceConfig.driver, sql, record.params, sourceConfig.customDriverId);
    const format = String(target.file?.format || target.format || 'csv').toLowerCase();
    const exporter = exporterFor(format);
    if (!exporter) throw new Error(`不支持的导出格式: ${format}`);
    // 0/空表示不限制（xlsx 受 Excel 行数上限约束，默认按 XLSX_MAX_ROWS 保护）
    const specified = Number(options.maxRows);
    const effectiveMax = specified > 0 ? specified : (format === 'xlsx' ? XLSX_MAX_ROWS : DEFAULT_MAX_ROWS);
    const maxRows = format === 'xlsx' ? Math.min(effectiveMax, XLSX_MAX_ROWS) : effectiveMax;
    const warnings = [];
    if (maxRows < Number.MAX_SAFE_INTEGER && count > maxRows) warnings.push(`源数据约 ${count} 行，本次最多导出 ${maxRows} 行`);
    await onProgress({ stage: 'reading', readRows: 0, writtenRows: 0, totalRows: Math.min(count, maxRows), pct: 0, message: warnings.join('；') });
    const outputPath = resolveOutputPath(target.file || target);
    await ensureParent(outputPath);
    const rowsStream = createRowsStream({ connection: sourceConn, source: record, sql, options: { ...options, maxRows }, driver: sourceConfig.driver, customDriverId: sourceConfig.customDriverId, dbType, onProgress, totalRows: count, isCancelled });
    const result = await exporter(rowsStream, columns, outputPath, {
      ...(target.file || target), ...options, tableName: source.table ? splitQualifiedName(source.table, source.schema || '').table : undefined,
      onRow: async (writtenRows) => {
        if (isCancelled()) throw new ExportCancelledError();
        const elapsed = Math.max(1, Date.now() - started);
        await onProgress({ stage: 'writing', readRows: writtenRows, writtenRows, totalRows: Math.min(count, maxRows), pct: count ? Math.min(99, Math.round(writtenRows * 100 / Math.min(count, maxRows))) : 100, speed: Math.round(writtenRows * 1000 / elapsed) });
      },
    });
    result.warnings = [...warnings, ...(result.warnings || [])];
    return { ...result, outputPath, totalRows: result.totalRows, durationMs: Date.now() - started };
  } finally {
    if (sourceConn) await closeConnection(sourceConn, connectionData(sourcePrepared.record).driver, connectionData(sourcePrepared.record).customDriverId);
  }
}

export async function exportToFile({ source, target, options = {}, onProgress = () => {}, isCancelled = () => false }) {
  return withSourceLock(source, () => {
    if (isCancelled()) throw new ExportCancelledError();
    return runFileExport({ source, target, options, onProgress, isCancelled });
  });
}

async function runDatabaseExport({ source, target, options = {}, onProgress = () => {}, isCancelled = () => false }) {
  const sourcePrepared = await prepareSource(source);
  const targetPrepared = await prepareTarget(target);
  let sourceConn;
  let targetConn;
  const started = Date.now();
  try {
    sourceConn = await openExportConnection(sourcePrepared.record);
    targetConn = await openExportConnection(targetPrepared.record);
    const sourceConfig = connectionData(sourcePrepared.record);
    const targetConfig = connectionData(targetPrepared.record);
    const sourceType = await detectDbType(sourceConfig.driver, sourceConfig.customDriverId);
    const targetType = await detectDbType(targetConfig.driver, targetConfig.customDriverId);
    const sql = buildSourceSql(sourcePrepared.record, sourceType);
    const columns = await readSourceColumns(sourceConn, sourcePrepared.record, sourceConfig.driver, sourceConfig.customDriverId, sourceType, sql);
    const totalRows = await countRows(sourceConn, sourceConfig.driver, sql, sourcePrepared.record.params, sourceConfig.customDriverId);
    await onProgress({ stage: 'reading', readRows: 0, writtenRows: 0, totalRows, pct: 0 });
    const result = await exportRowsToDatabase({
      sourceConnection: sourceConn,
      source: { ...source, sql, driver: sourceConfig.driver, customDriverId: sourceConfig.customDriverId },
      targetConnection: targetConn,
      target: { ...targetConfig, ...(target.database || target), driver: targetConfig.driver, customDriverId: targetConfig.customDriverId },
      sourceColumns: columns, sourceDbType: sourceType, targetDbType: targetType, options: { ...options, totalRows }, onProgress,
      isCancelled,
    });
    return { ...result, durationMs: Date.now() - started };
  } finally {
    if (targetConn) await closeConnection(targetConn, connectionData(targetPrepared.record).driver, connectionData(targetPrepared.record).customDriverId);
    if (sourceConn) await closeConnection(sourceConn, connectionData(sourcePrepared.record).driver, connectionData(sourcePrepared.record).customDriverId);
  }
}

export async function exportToDatabase({ source, target, options = {}, onProgress = () => {}, isCancelled = () => false }) {
  return withSourceLock(source, () => {
    if (isCancelled()) throw new ExportCancelledError();
    return runDatabaseExport({ source, target, options, onProgress, isCancelled });
  });
}

export default { exportToFile, exportToDatabase, buildSourceSql, resolveOutputPath, isExportLocked, ExportCancelledError };
