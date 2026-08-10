export type SyncRunStatus = 'running' | 'success' | 'failed' | 'pending' | 'idle' | null;

export interface SyncProject {
  id: string;
  name: string;
  description?: string;
  color?: string;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  extra?: { description?: string; [key: string]: unknown };
}

export interface SyncTask {
  id: string;
  project_id: string;
  name: string;
  description?: string;
  source_connection_id: string;
  source_schema?: string | null;
  target_connection_id: string;
  target_schema?: string | null;
  poll_interval_seconds?: number;
  enabled?: boolean;
  write_strategy?: 'insert' | 'upsert' | 'replace';
  /** taskRunner 同时执行的映射数（1~16，默认 3） */
  max_concurrent?: number;
  /** 单映射失败时的最大重试次数（0~5，默认 2） */
  retry_count?: number;
  last_run_at?: string | null;
  last_run_status?: SyncRunStatus;
  last_run_rows?: number;
  created_at?: string;
  updated_at?: string;
  extra?: { description?: string; [key: string]: unknown };
}

export interface SyncColumnMapping {
  source: string;
  target: string;
  type?: string;
}

export interface SyncTableMapping {
  id: string;
  task_id: string;
  source_table: string;
  target_table: string;
  enabled?: boolean;
  where_clause?: string | null;
  orderby?: string | null;
  sequence?: number;
  column_mappings?: SyncColumnMapping[];
  /** 可选：自定义 SELECT 查询；非空时用此 SQL 取数替代 source_table */
  custom_sql?: string | null;
  /** 可选：增量同步字段名（用于跟踪增量位点） */
  incremental_column?: string | null;
  /** 可选：增量类型 'timestamp' | 'numeric' */
  incremental_type?: 'timestamp' | 'numeric' | null;
  /** 可选：增量位点当前值 */
  checkpoint_value?: string | null;
  /** 单映射级别：最近一次执行时间 */
  last_run_at?: string | null;
  /** 单映射级别：最近一次执行结果 success | failed | running */
  last_run_status?: SyncRunStatus;
  /** 单映射级别：最近一次同步行数 */
  last_run_rows?: number;
  /** 单映射级别：最近一次失败原因 */
  last_run_error?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface SyncProjectStats {
  projectId: string;
  taskCount: number;
  enabledTaskCount: number;
  mappingCount: number;
  lastRunAt: string | null;
  lastRunStatus: SyncRunStatus;
  lastRunRows: number;
  totalRuns: number;
  successRuns: number;
  successRate: number | null;
}

export type SyncSelection =
  | { type: 'project'; id: string }
  | { type: 'task'; id: string }
  | { type: 'mapping'; id: string }
  | null;

export interface CreateSyncProjectPayload {
  name: string;
  description?: string;
  color?: string;
}

export interface CreateSyncTaskPayload {
  projectId: string;
  name: string;
  sourceConnectionId: string;
  sourceSchema?: string;
  targetConnectionId: string;
  targetSchema?: string;
  pollIntervalSeconds?: number;
  enabled?: boolean;
  writeStrategy?: 'insert' | 'upsert' | 'replace';
  /** taskRunner 同时执行的映射数（1~16） */
  maxConcurrent?: number;
  /** 单映射失败时的最大重试次数（0~5） */
  retryCount?: number;
  description?: string;
}

export interface SyncRunHistoryEntry {
  id: string;
  taskId: string;
  mappingId: string | null;
  status: 'success' | 'failed' | 'running' | 'skipped';
  rowsSynced: number;
  durationMs: number;
  attempts: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SyncRunHistoryResponse {
  taskId: string;
  history: SyncRunHistoryEntry[];
}

export interface CreateSyncMappingPayload {
  taskId: string;
  sourceTable: string;
  targetTable: string;
  enabled?: boolean;
  whereClause?: string;
  orderBy?: string;
  columnMappings?: SyncColumnMapping[];
  sequence?: number;
  /** 可选：自定义 SELECT；与 sourceTable 二选一 */
  customSql?: string;
  /** 可选：增量同步字段名（如 updated_at / id） */
  incrementalColumn?: string | null;
  /** 可选：增量类型 'timestamp' | 'numeric' */
  incrementalType?: 'timestamp' | 'numeric' | null;
  /** 可选：增量位点值（timestamp 字符串 / numeric 字符串） */
  checkpointValue?: string | null;
}
