/**
 * 用分页查询实现的流式分批读取器。
 * 由于 mysql2/pg/JDBC 三种客户端的流 API 不一致，统一在这里适配，
 * 每次只让一个 batch 在回调和调用者之间流动，避免把结果集全部放进内存。
 */
import { getById } from '../database.mjs';
import {
  executeQuery,
  resolveRealDriver,
} from '../routes/connections.mjs';
import { normalizeDbType } from './transformer.mjs';

export async function detectDbType(driver, customDriverId) {
  if (driver !== 'custom') return normalizeDbType(driver);
  const custom = customDriverId ? await getById('drivers', customDriverId) : null;
  const name = custom?.dbType || custom?.db_type || custom?.name || 'postgresql';
  return normalizeDbType(name);
}

function stripSql(sql) {
  return String(sql || '').trim().replace(/;\s*$/, '');
}

/** 将查询包装后分页。包装比直接追加 LIMIT 更能兼容用户传入的 ORDER BY/LIMIT。 */
export function buildPagedSql(sql, limit, offset, dbType = 'postgresql') {
  const base = stripSql(sql);
  if (!base) throw new Error('导出源 SQL 不能为空');
  const alias = '__dclaw_export_source';
  const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
  const safeOffset = Math.max(0, Math.floor(Number(offset) || 0));
  const prefix = `SELECT * FROM (${base}) ${alias}`;
  if (normalizeDbType(dbType) === 'dameng') {
    return `${prefix} OFFSET ${safeOffset} ROWS FETCH NEXT ${safeLimit} ROWS ONLY`;
  }
  return `${prefix} LIMIT ${safeLimit} OFFSET ${safeOffset}`;
}

function normalizeResult(result) {
  if (Array.isArray(result)) {
    return { rows: result, columns: result.length ? Object.keys(result[0]) : [] };
  }
  const rows = result?.rows || [];
  const columns = result?.fields
    ? result.fields.map((field) => field.name)
    : result?.columns || (rows.length ? Object.keys(rows[0]) : []);
  return { rows, columns };
}

/** 执行带参数的查询；connections.mjs 的兼容查询函数本身只接收无参数 SQL。 */
export async function executeQueryWithParams(connection, driver, sql, params = [], timeoutMs = 120000, customDriverId) {
  if (!params || params.length === 0) return executeQuery(connection, driver, sql, timeoutMs, customDriverId);
  const realDriver = await resolveRealDriver(driver, customDriverId);
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(`查询超时（${timeoutMs / 1000}s）`)), timeoutMs));
  let queryPromise;
  if (realDriver === 'mysql') {
    queryPromise = connection.execute(sql, params).then(([rows, fields]) => ({
      rows, columns: fields ? fields.map((field) => field.name) : Object.keys(rows[0] || {}),
    }));
  } else if (realDriver === 'postgresql') {
    if (connection?.__type === 'jdbc_bridge') {
      throw new Error('JDBC 桥接暂不支持参数化导出查询，请将参数写入 SQL');
    }
    if (connection?.__type === 'pgfork') {
      queryPromise = connection.client.unsafe(sql, params).then(normalizeResult);
    } else if (connection?.__type === 'pgfork_std') {
      queryPromise = connection.client.query({ text: sql, values: params }).then(normalizeResult);
    } else {
      queryPromise = connection.query({ text: sql, values: params }).then(normalizeResult);
    }
  } else {
    throw new Error(`不支持的数据库驱动: ${realDriver}`);
  }
  return Promise.race([queryPromise, timeout]);
}

/** 获取 SELECT 的列名，查询不会读取数据行。 */
export async function describeQuery(connection, driver, sql, params = [], customDriverId, dbType) {
  const base = stripSql(sql);
  const type = dbType || await detectDbType(driver, customDriverId);
  // WHERE 1=0 会保留 fields，且比 LIMIT 0 更容易兼容达梦/JDBC。
  const describeSql = `SELECT * FROM (${base}) __dclaw_describe_source WHERE 1 = 0`;
  const result = await executeQueryWithParams(connection, driver, describeSql, params, 120000, customDriverId);
  return result.columns || [];
}

export async function streamBatch(connection, sql, params = [], batchSize = 10000, callbacks = {}, customDriverId) {
  const onBatch = callbacks.onBatch || (async () => {});
  const onComplete = callbacks.onComplete || (async () => {});
  const onError = callbacks.onError || (async () => {});
  const size = Math.min(Math.max(1, Math.floor(Number(batchSize) || 10000)), 50000);
  const driver = callbacks.driver || connection?.driver || 'postgresql';
  const customId = customDriverId || callbacks.customDriverId;
  let dbType;
  let totalRows = 0;
  try {
    dbType = callbacks.dbType || await detectDbType(driver, customId);
    for (let offset = 0; ; offset += size) {
      const pagedSql = buildPagedSql(sql, size, offset, dbType);
      const result = await executeQueryWithParams(connection, driver, pagedSql, params, 15 * 60 * 1000, customId);
      const rows = result.rows || [];
      if (rows.length === 0) break;
      await onBatch(rows);
      totalRows += rows.length;
      if (rows.length < size) break;
    }
    await onComplete(totalRows);
    return totalRows;
  } catch (error) {
    try { await onError(error); } catch { /* 不覆盖原始导出错误 */ }
    throw error;
  }
}

export default { streamBatch, detectDbType, describeQuery, buildPagedSql, executeQueryWithParams };
