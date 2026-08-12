import { create } from 'zustand';
import type { ExecutionTask, ExecutionConfig } from '../types/execution';
import { ExecutionStatus } from '../types/execution';
import { nanoid } from 'nanoid';
import { useConnectionStore } from './connectionStore';

interface ExecutionStats {
  totalCount: number;
  successCount: number;
  failCount: number;
  totalDuration: number;
}

const getPersistedStats = (): ExecutionStats => {
  try {
    const raw = localStorage.getItem('dc_exec_stats');
    return raw ? JSON.parse(raw) : { totalCount: 0, successCount: 0, failCount: 0, totalDuration: 0 };
  } catch { return { totalCount: 0, successCount: 0, failCount: 0, totalDuration: 0 }; }
};

interface ExecutionState {
  tasks: ExecutionTask[];
  config: ExecutionConfig;
  currentExecutionId: string | null;
  executionStats: ExecutionStats;
  /** 当前执行的 SQL（只保留最新一次） */
  currentSql: string;
  /** 当前执行涉及的连接信息 */
  currentConnections: { id: string; hospitalName: string; preDbTypeName: string; schema?: string }[];

  startExecution: (sql: string, dbConnections: { id: string; hospitalName: string; preDbTypeName: string }[]) => void;
  updateTask: (taskId: string, partial: Partial<ExecutionTask>) => void;
  batchComplete: () => void;
  reset: () => void;
  updateConfig: (config: Partial<ExecutionConfig>) => void;
  updateStats: (success: number, failed: number, duration: number) => void;
}

export const useExecutionStore = create<ExecutionState>((set) => ({
  tasks: [],
  config: {
    concurrency: 5,
    timeoutMs: 86400000,  // 不限制超时（24h 等效），由用户手动点"停止"取消
    continueOnError: true,
    maxRetries: 1,
    readOnlyMode: true,
  },
  currentExecutionId: null,
  executionStats: getPersistedStats(),
  currentSql: '',
  currentConnections: [],

  startExecution: (sql, dbConnections) => {
    const executionId = nanoid(8);
    // 收集连接的实际 schema 信息
    const connections = useConnectionStore.getState?.()?.connections || {};
    const enriched = dbConnections.map(c => ({
      ...c,
      schema: connections[c.id]?.schema || '',
    }));

    const tasks: ExecutionTask[] = dbConnections.map((conn) => ({
      id: conn.id, // 用 connectionId 作为 taskId，确保前后端一致
      sql,
      dbConnectionId: conn.id,
      hospitalName: conn.hospitalName,
      preDbTypeName: conn.preDbTypeName,
      status: ExecutionStatus.Pending,
      startTime: Date.now(),
      retryCount: 0,
    }));

    set({ tasks, currentSql: sql, currentConnections: enriched, currentExecutionId: executionId });
  },

  updateTask: (taskId, partial) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...partial } : t)),
    }));
  },

  batchComplete: () => {
    set({ currentExecutionId: null });
  },

  reset: () => {
    set({ tasks: [], currentExecutionId: null });
  },

  updateConfig: (config) => {
    set((state) => ({
      config: { ...state.config, ...config },
    }));
  },

  updateStats: (success: number, failed: number, duration: number) => {
    set((state) => {
      const newStats = {
        totalCount: state.executionStats.totalCount + 1,
        successCount: state.executionStats.successCount + success,
        failCount: state.executionStats.failCount + failed,
        totalDuration: state.executionStats.totalDuration + duration,
      };
      try { localStorage.setItem('dc_exec_stats', JSON.stringify(newStats)); } catch { /* 持久化失败 */ }
      return { executionStats: newStats };
    });
  },
}));
