/**
 * 数据同步 · 任务执行器 (v1.6)
 *
 * 职责：
 *   - 并发执行单个 sync_task 下的所有 table_mapping（Promise 池，可配并发度）
 *   - 每个映射失败自动重试（指数退避，默认重试 2 次）
 *   - 增量同步：失败后下次从 checkpoint 继续；非增量任务失败后默认从 from_scratch=false 时保留 checkpoint 行为
 *   - 每次执行按 mapping 写入 sync_run_history 历史，并更新 mapping.last_run_*
 *   - 通过 onProgress 回调向调用方 (sync-execute.mjs) 推送每个 mapping 的进度
 *
 * 输入：
 *   task:           sync_tasks 记录 (含 source_connection_id / target_connection_id /
 *                   source_schema / target_schema / write_strategy /
 *                   max_concurrent / retry_count)
 *   mappings:       SyncTableMapping[] (调用方负责过滤 enabled + 排序)
 *   options:        {
 *                     fromScratch?: boolean  // true 时清空增量 checkpoint（强制全量）
 *                     concurrency?: number  // 覆盖 task.max_concurrent
 *                     retries?:     number  // 覆盖 task.retry_count
 *                   }
 *   onProgress:     (progress) => void
 *
 * 输出：
 *   { success, totalRows, durationMs, errors, mappingResults }
 *   mappingResults: [{ mappingId, status, rowsSynced, durationMs, attempts, error? }]
 */
import { exportToDatabase } from './exportEngine.mjs';
import { getById, update, query } from '../database.mjs';

const DEFAULT_WRITE_STRATEGY = 'insert';
const DEFAULT_MAX_CONCURRENT = 3;
const MAX_CONCURRENT_LIMIT = 16;
const DEFAULT_RETRY_COUNT = 2;
const MAX_RETRY_LIMIT = 5;
const RETRY_BASE_DELAY_MS = 1000;

/** 规范化并发数（1 ~ 16） */
function normalizeConcurrency(input, fallback) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 1) return fallback || DEFAULT_MAX_CONCURRENT;
  return Math.max(1, Math.min(MAX_CONCURRENT_LIMIT, Math.floor(n)));
}

/** 规范化重试次数（0 ~ 5） */
function normalizeRetries(input, fallback) {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return fallback || DEFAULT_RETRY_COUNT;
  return Math.max(0, Math.min(MAX_RETRY_LIMIT, Math.floor(n)));
}

/** 简单的 Promise 池：保持 concurrency 个 worker 同时运行 */
async function runWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 等待（用于重试退避） */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      const incType = String(mapping.incremental_type || 'timestamp').toLowerCase();
      const raw = String(mapping.checkpoint_value).replaceAll("'", "''");
      const incCond = incType === 'numeric' && Number.isFinite(Number(raw))
        ? `${col} > ${Number(raw)}`
        : `${col} > '${raw}'`;
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
    columnMappings: Array.isArray(mapping.column_mappings) ? mapping.column_mappings : [],
  };

  return { source, target };
}

/**
 * 写单条 sync_run_history（同时更新 mapping.last_run_*）
 * 失败仅 console.warn，不影响主流程
 */
async function writeHistoryAndMappingStatus({ taskId, mapping, status, rowsSynced, durationMs, attempts, errorMessage, startedAt }) {
  try {
    const finishedAtIso = new Date().toISOString();
    // 1) 写 sync_run_history：直接走 pool.query（不走 database.mjs 的 update；
    //    因为 sync_run_history 主键是 BIGSERIAL 且无 updated_at，不适合通用 update）
    const { query: pgQuery } = await import('../db/pool.mjs');
    await pgQuery(
      `INSERT INTO sync_run_history
        (task_id, mapping_id, status, rows_synced, duration_ms, attempts, error_message, started_at, finished_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        taskId,
        mapping?.id || null,
        status,
        Number(rowsSynced) || 0,
        Number(durationMs) || 0,
        Number(attempts) || 1,
        errorMessage ? String(errorMessage).slice(0, 4000) : null,
        startedAt || finishedAtIso,
        finishedAtIso,
      ],
    );
    // 2) 更新 sync_table_mappings.last_run_*
    if (mapping?.id) {
      await update('syncTableMappings', mapping.id, {
        last_run_at: finishedAtIso,
        last_run_status: status,
        last_run_rows: Number(rowsSynced) || 0,
        last_run_error: errorMessage ? String(errorMessage).slice(0, 4000) : null,
      });
    }
  } catch (err) {
    console.warn(`[taskRunner] write history failed (mapping=${mapping?.id || '-'})`, err?.message || err);
  }
}

/**
 * 把增量 checkpoint 回写到 mapping（HTTP PATCH 到 sync-table-mappings 路由）。
 * 失败仅 console.warn，不影响主流程。
 */
async function persistCheckpoint(mapping, checkpointValue) {
  if (!mapping?.id) return;
  try {
    const apiPort = Number(process.env.API_PORT) || Number(process.env.PORT) || 3001;
    const apiHost = process.env.API_HOST || 'localhost';
    const res = await fetch(`http://${apiHost}:${apiPort}/api/sync-table-mappings/${encodeURIComponent(mapping.id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ checkpointValue }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      console.warn(`[taskRunner] checkpoint 持久化失败 (HTTP ${res.status}): ${errBody.slice(0, 200)}`);
    }
  } catch (e) {
    console.warn(`[taskRunner] checkpoint 持久化异常: ${e?.message || e}`);
  }
}

/**
 * 执行单个 mapping（含重试 / 增量 checkpoint / 历史写）
 * 返回 { status, rowsSynced, durationMs, attempts, error? }
 */
async function runSingleMapping(task, mapping, options, emit) {
  const concurrency = options.concurrency; // 仅用于日志
  const retries = options.retries;
  const fromScratch = options.fromScratch;

  const baseLabel = mapping.custom_sql
    ? `(自定义 SQL) → ${mapping.target_table}`
    : `${mapping.source_table} → ${mapping.target_table}`;

  const startedAt = new Date().toISOString();
  const mappingStartedAt = Date.now();

  // fromScratch=true 时清空增量 checkpoint（仅对启用增量的 mapping 生效）
  const effectiveMapping = (fromScratch && mapping.incremental_column)
    ? { ...mapping, checkpoint_value: null }
    : mapping;

  let lastError = null;
  let lastRows = 0;
  const maxAttempts = retries + 1; // 第 1 次 + retries 次重试

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      emit({
        mappingId: mapping.id,
        currentTable: baseLabel,
        status: 'running',
        attempt,
        maxAttempts,
        rows: 0,
      });

      const { source, target } = buildSourceAndTarget(task, effectiveMapping);

      const result = await exportToDatabase({
        source,
        target,
        options: {},
        onProgress: (p) => {
          emit({
            mappingId: mapping.id,
            currentTable: baseLabel,
            status: 'running',
            attempt,
            maxAttempts,
            rows: p?.writtenRows || 0,
            totalSourceRows: p?.totalRows || 0,
            pct: p?.pct || 0,
          });
        },
        isCancelled: () => false,
      });

      lastRows = result.totalRows || 0;

      // 成功后回写增量 checkpoint（不影响 custom_sql 模式）
      if (!mapping.custom_sql && mapping.incremental_column) {
        await persistCheckpoint(mapping, new Date().toISOString());
      }

      const durationMs = Date.now() - mappingStartedAt;

      emit({
        mappingId: mapping.id,
        currentTable: baseLabel,
        status: 'success',
        attempt,
        maxAttempts,
        rows: lastRows,
      });

      await writeHistoryAndMappingStatus({
        taskId: task.id,
        mapping,
        status: 'success',
        rowsSynced: lastRows,
        durationMs,
        attempts: attempt,
        errorMessage: null,
        startedAt,
      });

      return {
        mappingId: mapping.id,
        status: 'success',
        rowsSynced: lastRows,
        durationMs,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err;
      const message = err?.message || String(err);
      console.warn(`[taskRunner] mapping ${mapping.id} attempt ${attempt}/${maxAttempts} failed: ${message}`);

      // 最后一次尝试也失败 —— 记历史 + 推进 progress
      if (attempt >= maxAttempts) {
        const durationMs = Date.now() - mappingStartedAt;
        emit({
          mappingId: mapping.id,
          currentTable: baseLabel,
          status: 'error',
          attempt,
          maxAttempts,
          error: message,
        });
        await writeHistoryAndMappingStatus({
          taskId: task.id,
          mapping,
          status: 'failed',
          rowsSynced: lastRows,
          durationMs,
          attempts: attempt,
          errorMessage: message,
          startedAt,
        });
        return {
          mappingId: mapping.id,
          status: 'failed',
          rowsSynced: lastRows,
          durationMs,
          attempts: attempt,
          error: message,
        };
      }

      // 还没到最后一次：发 retry 进度事件 + 指数退避
      emit({
        mappingId: mapping.id,
        currentTable: baseLabel,
        status: 'retrying',
        attempt,
        maxAttempts,
        error: message,
      });
      const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1);
      await sleep(delay);
    }
  }

  // 不可达（TypeScript 友好兜底）
  void concurrency; void lastError;
  return {
    mappingId: mapping?.id,
    status: 'failed',
    rowsSynced: 0,
    durationMs: Date.now() - mappingStartedAt,
    attempts: 0,
    error: 'unknown',
  };
}

/**
 * 执行单个 sync task（并发执行所有 enabled mappings）
 * @param {Object} task
 * @param {Object[]} mappings
 * @param {Object} options { fromScratch, concurrency, retries }
 * @param {(progress: any) => void} onProgress
 * @returns {Promise<{ success, totalRows, durationMs, errors, mappingResults }>}
 */
export async function runTask(task, mappings, options = {}, onProgress = () => {}) {
  const startTime = Date.now();
  const errors = [];
  let totalRows = 0;
  let hasError = false;

  const enabledMappings = mappings.filter((m) => m && m.enabled !== false);

  const concurrency = normalizeConcurrency(
    options.concurrency ?? task.max_concurrent,
    DEFAULT_MAX_CONCURRENT,
  );
  const retries = normalizeRetries(
    options.retries ?? task.retry_count,
    DEFAULT_RETRY_COUNT,
  );

  // 透传映射索引到进度事件（与旧行为兼容：mappingIndex 是 mappings 列表里的位置）
  const indexMap = new Map();
  enabledMappings.forEach((m, i) => indexMap.set(m.id, i));

  const emit = (detail) => {
    const idx = detail.mappingId ? indexMap.get(detail.mappingId) ?? -1 : -1;
    onProgress({
      mappingIndex: idx,
      mappingId: detail.mappingId,
      totalMappings: enabledMappings.length,
      currentTable: detail.currentTable,
      status: detail.status,
      rows: detail.rows || 0,
      totalSourceRows: detail.totalSourceRows,
      pct: detail.pct,
      error: detail.error,
      attempt: detail.attempt,
      maxAttempts: detail.maxAttempts,
    });
  };

  // 开跑前给上层一个 start 帧，方便 UI 显示「并发度 / 总数」
  onProgress({
    mappingIndex: -1,
    totalMappings: enabledMappings.length,
    currentTable: '',
    status: 'started',
    concurrency,
    retries,
  });

  const results = await runWithConcurrency(enabledMappings, concurrency, async (mapping) => {
    return runSingleMapping(task, mapping, { concurrency, retries, fromScratch: !!options.fromScratch }, emit);
  });

  const mappingResults = [];
  for (const r of results) {
    if (!r) continue;
    mappingResults.push(r);
    totalRows += r.rowsSynced || 0;
    if (r.status !== 'success') {
      hasError = true;
      if (r.error) errors.push({ mappingId: r.mappingId, error: r.error });
    }
  }

  return {
    success: !hasError,
    totalRows,
    durationMs: Date.now() - startTime,
    errors,
    mappingResults,
  };
}

/**
 * 拉取某 task 的历史记录（按时间倒序，可选 limit）
 */
export async function fetchTaskHistory(taskId, { limit = 100 } = {}) {
  const { query: pgQuery } = await import('../db/pool.mjs');
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
  const r = await pgQuery(
    `SELECT id, task_id, mapping_id, status, rows_synced, duration_ms, attempts,
            error_message, started_at, finished_at
       FROM sync_run_history
       WHERE task_id = $1
       ORDER BY started_at DESC
       LIMIT $2`,
    [taskId, safeLimit],
  );
  return r.rows;
}

/**
 * 给定时调度器使用：根据 taskId 拉最新 task + enabled mappings
 */
export async function loadTaskAndMappings(taskId) {
  const task = await getById('syncTasks', taskId);
  if (!task) return { task: null, mappings: [] };
  const all = await query('syncTableMappings', (m) => m.task_id === taskId);
  const mappings = all
    .filter((m) => m.enabled !== false)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
  return { task, mappings };
}

export default { runTask, fetchTaskHistory, loadTaskAndMappings };
