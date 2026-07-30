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
  description?: string;
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
}
