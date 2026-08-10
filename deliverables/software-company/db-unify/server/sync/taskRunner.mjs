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

  // v1.5+：如果 mapping 有 custom_sql（SELECT/WITH），优先用它做源。
  const customSql = mapping.custom_sql ? String(mapping.custom_sql).trim() : '';
  const source = {
    type: customSql ? 'sql' : 'table',
    connectionId: task.source_connection_id,
    schema: mapping.source_schema || task.source_schema || undefined,
  };
  if (customSql) {
    source.sql = customSql;
    // 自定义 SQL 模式下，source.table 用作显示占位（让 lockKey/cache 仍可工作）
    source.table = mapping.source_table || '__custom_sql__';
  } else {
    source.table = mapping.source_table;
  }
  // where_clause 在 exportEngine 走 safeFilter (白名单 SELECT/WHERE)
  if (mapping.where_clause && !customSql) {
    source.filter = String(mapping.where_clause);
  }
  // 增量同步：把 checkpoint 注入 where（仅 table 模式 + 启用增量字段时）
  if (!customSql && mapping.incremental_column && mapping.checkpoint_value != null && String(mapping.checkpoint_value).length > 0) {
    const col = String(mapping.incremental_column).replace(/[^A-Za-z0-9_.]/g, '');
    if (col) {
      const incCond = `${col} > '${String(mapping.checkpoint_value).replaceAll("'", "''")}'`;
      source.filter = source.filter ? `${source.filter} AND ${incCond}` : incCond;
    }
  }
  // orderby 不被 exportEngine 直接支持：拼到 source.sql（仅 table 模式）
  if (!customSql && mapping.orderby) {
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

    const currentTable = mapping.custom_sql
      ? `(自定义 SQL) → ${mapping.target_table}`
      : `${mapping.source_table} → ${mapping.target_table}`;

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

      // 增量同步：执行成功后回写 checkpoint_value（通过 PATCH 持久化）
      if (!mapping.custom_sql && mapping.incremental_column) {
        try {
          // 端口配置与 server/index.mjs 默认保持一致（3001）；允许通过 env 覆盖
          // 注意：开发模式下 npm run dev 会同时启动 client (3000) 和 server (3001)，
          // 此处必须取 server 端口，否则 PATCH 会打错端口导致 checkpoint 静默丢失
          const apiPort = Number(process.env.API_PORT) || Number(process.env.PORT) || 3001;
          const apiHost = process.env.API_HOST || 'localhost';
          const res = await fetch(`http://${apiHost}:${apiPort}/api/sync-table-mappings/${encodeURIComponent(mapping.id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ checkpointValue: new Date().toISOString() }),
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => '');
            console.warn(`[taskRunner] checkpoint 持久化失败 (HTTP ${res.status}): ${errBody.slice(0, 200)}`);
          }
        } catch (e) {
          // checkpoint 持久化失败不影响本次任务结果，但至少要可见
          console.warn(`[taskRunner] checkpoint 持久化异常: ${e?.message || e}`);
        }
      }
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