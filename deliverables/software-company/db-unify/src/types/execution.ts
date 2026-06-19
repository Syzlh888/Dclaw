import type { QueryResult } from './result';

export enum ExecutionStatus {
  Pending = 'pending',
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
  Timeout = 'timeout',
}

export interface ExecutionTask {
  id: string;
  sql: string;
  dbConnectionId: string;
  hospitalName: string;
  preDbTypeName: string;
  status: ExecutionStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  errorMessage?: string;
  result?: QueryResult;
  retryCount: number;
}

export interface ExecutionConfig {
  concurrency: number;
  timeoutMs: number;
  continueOnError: boolean;
  maxRetries: number;
  readOnlyMode: boolean;
}
