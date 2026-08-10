import { apiFetch } from './apiClient';
import type {
  CreateSyncMappingPayload,
  CreateSyncProjectPayload,
  CreateSyncTaskPayload,
  SyncProject,
  SyncProjectStats,
  SyncRunHistoryResponse,
  SyncTableMapping,
  SyncTask,
} from '../types/sync';

/** 拉取表列元数据：复用 exportService 的实现（POST /api/connections/:id/metadata），返回 ColumnInfo[] */
export { fetchTableColumns, type ColumnInfo } from './exportService';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${response.status})`);
  }
  return data as T;
}

// ========= 任务执行（SSE 流式） =========

export interface RunTaskProgress {
  mappingIndex: number;
  mappingId?: string;
  totalMappings: number;
  currentTable: string;
  status: 'running' | 'success' | 'error' | 'retrying' | 'started';
  rows?: number;
  totalSourceRows?: number;
  pct?: number;
  error?: string;
  attempt?: number;
  maxAttempts?: number;
  concurrency?: number;
}

export interface RunTaskDone {
  success: boolean;
  totalRows: number;
  durationMs: number;
  errors: { mappingId?: string; error: string }[];
  mappingResults?: {
    mappingId?: string;
    status: string;
    rowsSynced: number;
    durationMs: number;
    attempts: number;
    error?: string;
  }[];
}

export interface RunTaskStreamHandlers {
  onStart?: (info: { taskId: string; mappingCount: number; startedAt: string; concurrency?: number; retries?: number; fromScratch?: boolean }) => void;
  onProgress: (progress: RunTaskProgress) => void;
  onDone: (result: RunTaskDone) => void;
  onError: (err: Error) => void;
}

/** runTaskStream 可选 body 参数 */
export interface RunTaskStreamOptions {
  /** true 时清空增量 checkpoint，强制全量 */
  fromScratch?: boolean;
  /** 覆盖任务默认并发度 */
  concurrency?: number;
  /** 覆盖任务默认重试次数 */
  retries?: number;
}

/**
 * 调 POST /api/sync-tasks/:id/run，订阅 SSE 流。
 * 返回 AbortController，调用方 controller.abort() 可取消（关闭 fetch）。
 */
export function runTaskStream(
  taskId: string,
  handlers: RunTaskStreamHandlers,
  baseUrl?: string,
  options: RunTaskStreamOptions = {},
): AbortController {
  const controller = new AbortController();
  const base = baseUrl || (typeof window !== 'undefined' ? '' : 'http://localhost:3001');

  (async () => {
    let res: Response;
    try {
      const body: Record<string, unknown> = {};
      if (options.fromScratch) body.fromScratch = true;
      if (options.concurrency != null) body.concurrency = options.concurrency;
      if (options.retries != null) body.retries = options.retries;
      const hasBody = Object.keys(body).length > 0;
      res = await apiFetch(`${base}/api/sync-tasks/${encodeURIComponent(taskId)}/run`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        },
        body: hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    if (!res.ok || !res.body) {
      let message = `请求失败 (${res.status})`;
      try {
        const data = await res.json();
        message = data.error || message;
      } catch { /* ignore */ }
      handlers.onError(new Error(message));
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';

    const dispatchEvent = (rawEvent: string, rawData: string) => {
      const event = rawEvent || 'message';
      let payload: any = rawData;
      try {
        if (rawData && rawData.trim().startsWith('{')) {
          payload = JSON.parse(rawData);
        }
      } catch { /* keep raw string */ }

      try {
        if (event === 'start') handlers.onStart?.(payload);
        else if (event === 'progress') handlers.onProgress(payload as RunTaskProgress);
        else if (event === 'done') handlers.onDone(payload as RunTaskDone);
        else if (event === 'error') handlers.onError(new Error(payload?.message || '任务执行失败'));
      } catch (cbErr) {
        handlers.onError(cbErr instanceof Error ? cbErr : new Error(String(cbErr)));
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE 事件以 "\n\n" 分隔
        let sep = buf.indexOf('\n\n');
        while (sep >= 0) {
          const raw = buf.slice(0, sep);
          buf = buf.slice(sep + 2);
          // 解析 event: / data: 行
          let eventName = '';
          const dataLines: string[] = [];
          for (const line of raw.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim();
            else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length) dispatchEvent(eventName, dataLines.join('\n'));
          sep = buf.indexOf('\n\n');
        }
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      handlers.onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return controller;
}

export const syncService = {
  async getProjects(): Promise<SyncProject[]> {
    const data = await request<{ projects: SyncProject[] }>('/api/sync-projects');
    return data.projects.map((item) => ({
      ...item,
      description: item.description ?? item.extra?.description ?? '',
    }));
  },

  async getTasks(projectId: string): Promise<SyncTask[]> {
    const data = await request<{ tasks: SyncTask[] }>(`/api/sync-tasks?project_id=${encodeURIComponent(projectId)}`);
    return data.tasks.map((item) => ({
      ...item,
      description: item.description ?? item.extra?.description ?? '',
    }));
  },

  async getMappings(taskId: string): Promise<SyncTableMapping[]> {
    const data = await request<{ mappings: SyncTableMapping[] }>(`/api/sync-table-mappings?task_id=${encodeURIComponent(taskId)}`);
    return data.mappings;
  },

  /** 拉取任务的运行历史（GET /api/sync-tasks/:id/history） */
  getHistory: async (taskId: string, limit = 100): Promise<SyncRunHistoryResponse> => {
    const data = await request<SyncRunHistoryResponse>(`/api/sync-tasks/${encodeURIComponent(taskId)}/history?limit=${encodeURIComponent(String(limit))}`);
    return data;
  },

  getProjectStats: (id: string) => request<SyncProjectStats>(`/api/sync-projects/${encodeURIComponent(id)}/stats`),
  createProject: (payload: CreateSyncProjectPayload) => request<SyncProject>('/api/sync-projects', { method: 'POST', body: JSON.stringify(payload) }),
  createTask: (payload: CreateSyncTaskPayload) => request<SyncTask>('/api/sync-tasks', { method: 'POST', body: JSON.stringify(payload) }),
  createMapping: (payload: CreateSyncMappingPayload) => request<SyncTableMapping>('/api/sync-table-mappings', { method: 'POST', body: JSON.stringify(payload) }),
  updateProject: (id: string, payload: Partial<CreateSyncProjectPayload>) => request<SyncProject>(`/api/sync-projects/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateTask: (id: string, payload: Partial<CreateSyncTaskPayload>) => request<SyncTask>(`/api/sync-tasks/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  updateMapping: (id: string, payload: Partial<CreateSyncMappingPayload>) => request<SyncTableMapping>(`/api/sync-table-mappings/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteProject: (id: string) => request<{ success: boolean }>(`/api/sync-projects/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteTask: (id: string) => request<{ success: boolean }>(`/api/sync-tasks/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteMapping: (id: string) => request<{ success: boolean }>(`/api/sync-table-mappings/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** 暴露 SSE 流式执行入口 */
  runTaskStream,
};

// ========= v1.6 调度器 =========

export interface SchedulerStatusItem {
  taskId: string;
  running: boolean;
  lastRunAt: number | null;
  lastError: string | null;
}

export interface SchedulerStatusResponse {
  status: SchedulerStatusItem[];
}

export interface SchedulerTaskItem {
  id: string;
  name: string;
  enabled?: boolean;
  poll_interval_seconds?: number;
  last_run_at?: string | null;
  last_run_status?: string | null;
  last_run_rows?: number;
  scheduler: { running: boolean; lastRunAt: number | null; lastError: string | null };
}

export interface SchedulerTasksResponse {
  tasks: SchedulerTaskItem[];
}

export const schedulerService = {
  getStatus: () => request<SchedulerStatusResponse>('/api/sync-scheduler/status'),
  getTasks: () => request<SchedulerTasksResponse>('/api/sync-scheduler/tasks'),
  runNow: (taskId: string) =>
    request<{ ok: boolean; message?: string }>(`/api/sync-scheduler/run/${encodeURIComponent(taskId)}`, {
      method: 'POST',
    }),
  start: () => request<{ ok: boolean }>('/api/sync-scheduler/start', { method: 'POST' }),
  stop: () => request<{ ok: boolean }>('/api/sync-scheduler/stop', { method: 'POST' }),
};

// keep backward compat: also expose scheduler methods on syncService
export const syncServiceWithScheduler = Object.assign({}, syncService, {
  schedulerStatus: schedulerService.getStatus,
  schedulerTasks: schedulerService.getTasks,
  schedulerRunNow: schedulerService.runNow,
  schedulerStart: schedulerService.start,
  schedulerStop: schedulerService.stop,
});