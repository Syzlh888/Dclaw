/**
 * 数据同步 · 任务执行器 (v1.5)
 *
 * 职责：
 *   - 串行执行单个 sync_task 下的所有 table_mapping
 *   - 复用 v1.3 exportEngine 的 exportToDatabase (runDatabaseExport)
 *     做真正的源→目标数据搬迁
 *   - 通过 onProgress 回调向调用方 (sync-execute.mjs) 推送每个 mapping 的进度
 *
 * 输入：
 *   task:        sync_tasks 记录 (含 source_connection_id / target_connection_id /
 *                source_schema / target_schema / write_strategy)
 *   mappings:    SyncTableMapping[] (调用方负责过滤 enabled + 排序)
 *   onProgress:  (progress) => void
 *
 * 输出：
 *   { success, totalRows, durationMs, errors }
 */
import { exportToDatabase } from './exportEngine.mjs';

const DEFAULT_WRITE_STRATEGY = 'insert';

/** 把 sync_table_mappings 的字段映射拼成 exportEngine 认识的 source/target 对象 */
function buildSourceAndTarget(task, mapping) {
  const writeStrategy = String(task.write_strategy || DEFAULT_WRITE_STRATEGY).toLowerCase();

  const source = {
    type: 'table',
    connectionId: task.source_connection_id,
    table: mapping.source_table,
    schema: mapping.source_schema || task.source_schema || undefined,
  };
  // where_clause 在 exportEngine 走 safeFilter (白名单 SELECT/WHERE)
  if (mapping.where_clause) {
    source.filter = String(mapping.where_clause);
  }
  // orderby 不被 exportEngine 直接支持：拼到 source.sql
  if (mapping.orderby) {
    const schemaPart = source.schema ? `"${String(source.schema).replaceAll('"', '""')}".` : '';
    const tablePart = `"${String(mapping.source_table).replaceAll('"', '""')}"`;
    const filterPart = source.filter ? ` WHERE ${source.filter}` : '';
    source.sql = `SELECT * FROM ${schemaPart}${tablePart}${filterPart} ORDER BY ${mapping.orderby}`;
  }

  const target = {
    type: 'database',
    connectionId: task.target_connection_id,
    table: mapping.target_table,
    schema: mapping.target_schema || task.target_schema || undefined,
    writeStrategy,
    // columnMappings 是 JSONB 数组 [{source, target, type?}]，
    // v1.5 先按导出引擎默认列映射执行；后续版本把 columnMappings 透传到 dbExporter
    columnMappings: Array.isArray(mapping.column_mappings) ? mapping.column_mappings : [],
  };

  return { source, target };
}

/**
 * 执行单个 sync task
 * @param {Object} task
 * @param {Object[]} mappings
 * @param {(progress: any) => void} onProgress
 * @returns {Promise<{ success: boolean, totalRows: number, durationMs: number, errors: any[] }>}
 */
export async function runTask(task, mappings, onProgress = () => {}) {
  const startTime = Date.now();
  const errors = [];
  let totalRows = 0;
  let hasError = false;

  // 串行执行每个 mapping
  for (let i = 0; i < mappings.length; i++) {
    const mapping = mappings[i];
    if (!mapping.enabled) continue;

    const currentTable = `${mapping.source_table} → ${mapping.target_table}`;

    try {
      onProgress({
        mappingIndex: i,
        mappingId: mapping.id,
        totalMappings: mappings.length,
        currentTable,
        status: 'running',
        rows: 0,
      });

      const { source, target } = buildSourceAndTarget(task, mapping);

      const result = await exportToDatabase({
        source,
        target,
        options: {},
        onProgress: (p) => {
          // 把 exportEngine 的细粒度进度透传给上层
          onProgress({
            mappingIndex: i,
            mappingId: mapping.id,
            totalMappings: mappings.length,
            currentTable,
            status: 'running',
            rows: p?.writtenRows || 0,
            totalSourceRows: p?.totalRows || 0,
            pct: p?.pct || 0,
          });
        },
        isCancelled: () => false,
      });

      totalRows += result.totalRows || 0;

      onProgress({
        mappingIndex: i,
        mappingId: mapping.id,
        totalMappings: mappings.length,
        currentTable,
        status: 'success',
        rows: result.totalRows || 0,
      });
    } catch (err) {
      hasError = true;
      const message = err?.message || String(err);
      errors.push({ mappingId: mapping.id, error: message });
      onProgress({
        mappingIndex: i,
        mappingId: mapping.id,
        totalMappings: mappings.length,
        currentTable,
        status: 'error',
        error: message,
      });
    }
  }

  return {
    success: !hasError,
    totalRows,
    durationMs: Date.now() - startTime,
    errors,
  };
}

export default { runTask };