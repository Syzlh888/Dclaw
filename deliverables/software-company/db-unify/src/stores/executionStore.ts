import { create } from 'zustand';
import type { ExecutionTask, ExecutionConfig } from '../types/execution';
import { ExecutionStatus } from '../types/execution';
import { nanoid } from 'nanoid';

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
    timeoutMs: 30000,
    continueOnError: true,
    maxRetries: 1,
    readOnlyMode: true,
  },
  currentExecutionId: null,
  executionStats: getPersistedStats(),

  startExecution: (sql, dbConnections) => {
    const executionId = nanoid(8);
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

    set({ tasks, currentExecutionId: executionId });
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
