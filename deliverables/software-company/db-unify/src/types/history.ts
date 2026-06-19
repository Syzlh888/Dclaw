/** 执行历史记录 */
export interface ExecutionHistory {
  id: string;
  sql_text: string;
  connection_count: number;
  success_count: number;
  failed_count: number;
  timeout_count: number;
  duration_ms: number;
  read_only_mode: number;
  config_json: string;
  executed_at: string;
}

/** 执行任务明细（关联执行历史，区别于 execution.ts 中的运行时 ExecutionTask） */
export interface ExecutionHistoryTask {
  id: string;
  execution_id: string;
  connection_id: string;
  connection_name: string;
  status: 'success' | 'failed' | 'timeout' | 'running' | 'pending';
  duration_ms: number;
  error_message?: string;
  row_count?: number;
}

/** 单次执行详情（含任务列表） */
export interface ExecutionHistoryDetail extends ExecutionHistory {
  tasks: ExecutionHistoryTask[];
}
