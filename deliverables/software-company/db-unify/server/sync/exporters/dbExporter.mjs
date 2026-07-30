/** 数据库目标导出：自动建表、批量 INSERT/UPSERT/REPLACE。 */
import {
  buildFieldMappings,
  normalizeDbType,
  quoteIdentifier,
  splitQualifiedName,
  toSqlLiteral,
  transformValue,
} from '../transformer.mjs';
import { detectDbType, streamBatch } from '../batchReader.mjs';
import { executeQuery } from '../../routes/connections.mjs';

function qualifiedTable(schema, table, dbType) {
  const quote = normalizeDbType(dbType) === 'mysql' ? '`' : '"';
  const quotePart = (part) => `${quote}${String(part).replaceAll(quote, quote + quote)}${quote}`;
  return schema ? `${quotePart(schema)}.${quotePart(table)}` : quotePart(table);
}

function valuesForRow(row, mappings) {
  return mappings.map((mapping, index) => {
    const value = Array.isArray(row) ? row[index] : row?.[mapping.sourceName];
    return toSqlLiteral(transformValue(value, mapping.sourceType, mapping.targetType));
  });
}

async function run(conn, driver, sql, customDriverId) {
  return executeQuery(conn, driver, sql, 15 * 60 * 1000, customDriverId);
}

async function rollback(conn, driver, customDriverId) {
  try { await run(conn, driver, 'ROLLBACK', customDriverId); } catch { /* ignore */ }
}

function getTargetConfig(target) {
  const database = target.database && typeof target.database === 'object' ? target.database : target;
  // 兼容字段：table / tableName / targetTable
  const targetName = database.table || database.tableName || database.targetTable;
  if (!targetName) throw new Error('数据库导出目标表不能为空');
  const split = splitQualifiedName(targetName, database.schema || database.schemaName || '');
  if (!split.table) throw new Error('数据库导出目标表不能为空');
  return { ...database, ...split, table: split.table, schema: split.schema };
}

export async function createTargetTable({ targetConnection, target, sourceColumns, sourceDbType, targetDbType }) {
  const config = getTargetConfig(target);
  const mappings = buildFieldMappings(sourceColumns, sourceDbType, targetDbType);
  if (!mappings.length) throw new Error('无法从源查询获取列结构，不能自动建表');
  const table = qualifiedTable(config.schema, config.table, targetDbType);
  if (config.schema && normalizeDbType(targetDbType) !== 'mysql') {
    await run(targetConnection, target.driver || 'postgresql', `CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(config.schema)}`, target.customDriverId);
  }
  const definitions = mappings.map((mapping) => {
    let ddl = `${quoteIdentifier(mapping.targetName, normalizeDbType(targetDbType) === 'mysql' ? '`' : '"')} ${mapping.targetType}`;
    if (mapping.primaryKey) ddl += ' PRIMARY KEY';
    if (!mapping.nullable && !mapping.primaryKey) ddl += ' NOT NULL';
    return ddl;
  });
  await run(targetConnection, target.driver || 'postgresql', `CREATE TABLE IF NOT EXISTS ${table} (${definitions.join(', ')})`, target.customDriverId);
  return { mappings, tableCreated: true, tableName: table };
}

function buildWriteSql(rows, mappings, config, targetDbType, strategy) {
  const normalized = normalizeDbType(targetDbType);
  const quote = normalized === 'mysql' ? '`' : '"';
  const table = qualifiedTable(config.schema, config.table, normalized);
  const columns = mappings.map((mapping) => `${quote}${mapping.targetName.replaceAll(quote, quote + quote)}${quote}`);
  const values = rows.map((row) => `(${valuesForRow(row, mappings).join(', ')})`).join(',\n');
  const command = strategy === 'replace' && normalized === 'mysql' ? 'REPLACE INTO' : 'INSERT INTO';
  let sql = `${command} ${table} (${columns.join(', ')}) VALUES ${values}`;
  const keys = (config.primaryKeys || mappings.filter((mapping) => mapping.primaryKey).map((mapping) => mapping.targetName)).filter(Boolean);
  if (strategy === 'replace' && normalized !== 'mysql') {
    // 非 MySQL 的 REPLACE 语义由调用方先 DELETE，再用普通 INSERT。
    return sql;
  }
  if (strategy === 'upsert') {
    if (!keys.length) throw new Error('UPSERT 需要 primaryKeys 或源表主键');
    const keySql = keys.map((key) => `${quote}${String(key).replaceAll(quote, quote + quote)}${quote}`);
    if (normalized === 'mysql') {
      const updates = mappings.filter((mapping) => !keys.includes(mapping.targetName)).map((mapping) => `${quote}${mapping.targetName.replaceAll(quote, quote + quote)}${quote}=VALUES(${quote}${mapping.targetName.replaceAll(quote, quote + quote)}${quote})`);
      if (updates.length) sql += ` ON DUPLICATE KEY UPDATE ${updates.join(', ')}`;
    } else {
      const updates = mappings.filter((mapping) => !keys.includes(mapping.targetName)).map((mapping) => `${quote}${mapping.targetName.replaceAll(quote, quote + quote)}${quote}=EXCLUDED.${quote}${mapping.targetName.replaceAll(quote, quote + quote)}${quote}`);
      sql += ` ON CONFLICT (${keySql.join(', ')}) DO ${updates.length ? `UPDATE SET ${updates.join(', ')}` : 'NOTHING'}`;
    }
  }
  return sql;
}

export async function exportRowsToDatabase({ sourceConnection, source, targetConnection, target, sourceColumns, sourceDbType, targetDbType, options = {}, onProgress = () => {}, isCancelled = () => false }) {
  const config = getTargetConfig(target);
  const effectiveTargetType = targetDbType || await detectDbType(target.driver || 'postgresql', target.customDriverId);
  const effectiveSourceType = sourceDbType || await detectDbType(source.driver || 'postgresql', source.customDriverId);
  const mappings = buildFieldMappings(sourceColumns, effectiveSourceType, effectiveTargetType);
  if (!mappings.length) throw new Error('源查询没有可导出的列');
  const batchSize = Math.min(Math.max(1, Number(options.batchSize) || 10000), 50000);
  const rawStrategy = String(config.writeStrategy || options.writeStrategy || 'insert').toLowerCase();
  // 兼容旧值：append 是 insert 的同义词
  const strategy = rawStrategy === 'append' ? 'insert' : rawStrategy;
  if (!['insert', 'upsert', 'replace'].includes(strategy)) throw new Error(`不支持的写入策略: ${rawStrategy}`);
  const table = qualifiedTable(config.schema, config.table, effectiveTargetType);
  let tableCreated = false;

  if (config.autoCreate !== false) {
    const created = await createTargetTable({ targetConnection, target: { ...config, driver: target.driver, customDriverId: target.customDriverId }, sourceColumns, sourceDbType: effectiveSourceType, targetDbType: effectiveTargetType });
    tableCreated = created.tableCreated;
  }
  if (strategy === 'replace' && normalizeDbType(effectiveTargetType) !== 'mysql') {
    await run(targetConnection, target.driver || 'postgresql', `DELETE FROM ${table}`, target.customDriverId);
  }

  let readRows = 0;
  let writtenRows = 0;
  const started = Date.now();
  await streamBatch(sourceConnection, source.sql, source.params || [], batchSize, {
    driver: source.driver,
    customDriverId: source.customDriverId,
    dbType: effectiveSourceType,
    onBatch: async (rows) => {
      if (isCancelled()) throw new Error('导出已取消');
      readRows += rows.length;
      await run(targetConnection, target.driver || 'postgresql', 'BEGIN', target.customDriverId);
      try {
        await run(targetConnection, target.driver || 'postgresql', buildWriteSql(rows, mappings, config, effectiveTargetType, strategy), target.customDriverId);
        await run(targetConnection, target.driver || 'postgresql', 'COMMIT', target.customDriverId);
        writtenRows += rows.length;
        const elapsed = Math.max(1, Date.now() - started);
        await onProgress({ stage: 'writing', readRows, writtenRows, totalRows: options.totalRows || 0, pct: options.totalRows ? Math.min(99, Math.round(writtenRows * 100 / options.totalRows)) : 0, speed: Math.round(writtenRows * 1000 / elapsed) });
      } catch (error) {
        await rollback(targetConnection, target.driver || 'postgresql', target.customDriverId);
        throw error;
      }
    },
  }, source.customDriverId);

  return { totalRows: writtenRows, writtenRows, readRows, durationMs: Date.now() - started, tableCreated, mappings };
}

export const exportToDatabase = exportRowsToDatabase;
export default { exportRowsToDatabase, exportToDatabase, createTargetTable };
