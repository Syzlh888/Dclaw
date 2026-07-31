import { create } from 'zustand';
import { syncService } from '../services/syncService';
import type {
  CreateSyncMappingPayload,
  CreateSyncProjectPayload,
  CreateSyncTaskPayload,
  SyncProject,
  SyncProjectStats,
  SyncSelection,
  SyncTableMapping,
  SyncTask,
} from '../types/sync';

interface SyncState {
  projects: SyncProject[];
  tasks: SyncTask[];
  mappings: SyncTableMapping[];
  stats: Record<string, SyncProjectStats>;
  selectedProjectId: string | null;
  selectedTaskId: string | null;
  selectedMappingId: string | null;
  selection: SyncSelection;
  loading: boolean;
  error: string | null;
  /** 当前正在执行的任务 id（同一时刻只能跑一个任务） */
  runningTaskId: string | null;
  /** 当前正在执行任务的实时进度（mappingIndex -> progress） */
  runProgress: Record<string, { mappingIndex: number; totalMappings: number; currentTable: string; status: string; rows?: number; pct?: number }>;
  loadProjects: () => Promise<void>;
  loadTasks: (projectId: string) => Promise<void>;
  loadMappings: (taskId: string) => Promise<void>;
  loadProjectStats: (projectId: string) => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  selectTask: (id: string) => Promise<void>;
  selectMapping: (id: string) => void;
  createProject: (payload: CreateSyncProjectPayload) => Promise<SyncProject>;
  createTask: (payload: CreateSyncTaskPayload) => Promise<SyncTask>;
  createMapping: (payload: CreateSyncMappingPayload) => Promise<SyncTableMapping>;
  /** 批量创建：用于「多表向导」一键生成多对 (source, target) 映射。 */
  createMappings: (payloads: CreateSyncMappingPayload[]) => Promise<SyncTableMapping[]>;
  updateMapping: (id: string, payload: Partial<CreateSyncMappingPayload>) => Promise<SyncTableMapping>;
  deleteProject: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  updateTask: (id: string, payload: Partial<SyncTask>) => Promise<void>;
  deleteMapping: (id: string) => Promise<void>;
  /** 立即执行任务（订阅 SSE 进度），完成后刷新 task 列表 */
  runTaskNow: (taskId: string) => Promise<void>;
  /** 手动更新任务的 last_run_* 字段（SSE done 后被 runTaskNow 调用） */
  updateTaskLastRun: (taskId: string, payload: { lastRunAt: string; lastRunStatus: string; lastRunRows: number }) => void;
  clearError: () => void;
}

const messageOf = (error: unknown) => error instanceof Error ? error.message : '数据同步请求失败';

export const useSyncStore = create<SyncState>((set, get) => ({
  projects: [], tasks: [], mappings: [], stats: {},
  selectedProjectId: null, selectedTaskId: null, selectedMappingId: null,
  selection: null, loading: false, error: null,
  runningTaskId: null, runProgress: {},

  loadProjects: async () => {
    set({ loading: true, error: null });
    try {
      const projects = await syncService.getProjects();
      set({ projects, loading: false });
    } catch (error) { set({ error: messageOf(error), loading: false }); }
  },

  loadTasks: async (projectId) => {
    try {
      const incoming = await syncService.getTasks(projectId);
      set((state) => ({ tasks: [...state.tasks.filter((t) => t.project_id !== projectId), ...incoming] }));
    } catch (error) { set({ error: messageOf(error) }); }
  },

  loadMappings: async (taskId) => {
    try {
      const incoming = await syncService.getMappings(taskId);
      set((state) => ({ mappings: [...state.mappings.filter((m) => m.task_id !== taskId), ...incoming] }));
    } catch (error) { set({ error: messageOf(error) }); }
  },

  loadProjectStats: async (projectId) => {
    try {
      const value = await syncService.getProjectStats(projectId);
      set((state) => ({ stats: { ...state.stats, [projectId]: value } }));
    } catch (error) { set({ error: messageOf(error) }); }
  },

  selectProject: async (id) => {
    set({ selectedProjectId: id, selectedTaskId: null, selectedMappingId: null, selection: { type: 'project', id } });
    await Promise.all([get().loadTasks(id), get().loadProjectStats(id)]);
  },
  selectTask: async (id) => {
    const task = get().tasks.find((item) => item.id === id);
    set({ selectedProjectId: task?.project_id ?? get().selectedProjectId, selectedTaskId: id, selectedMappingId: null, selection: { type: 'task', id } });
    await get().loadMappings(id);
  },
  selectMapping: (id) => set({ selectedMappingId: id, selection: { type: 'mapping', id } }),

  createProject: async (payload) => {
    const item = await syncService.createProject(payload);
    set((state) => ({ projects: [...state.projects, item] }));
    return item;
  },
  createTask: async (payload) => {
    const item = await syncService.createTask(payload);
    set((state) => ({ tasks: [...state.tasks, item] }));
    return item;
  },
  createMapping: async (payload) => {
    const item = await syncService.createMapping(payload);
    set((state) => ({ mappings: [...state.mappings, item] }));
    return item;
  },
  /**
   * 批量创建映射（用于向导式「多源 × 多目标」一次性建多个 sync_table_mapping）。
   * 按 sequence 顺序逐条调后端；任一失败立刻抛出（已成功的留在 store 里，由调用方决定回滚）。
   */
  createMappings: async (payloads: CreateSyncMappingPayload[]) => {
    const created: SyncTableMapping[] = [];
    for (let i = 0; i < payloads.length; i += 1) {
      const payload = { ...payloads[i], sequence: payloads[i].sequence ?? i };
      const item = await syncService.createMapping(payload);
      created.push(item);
      // 增量写进 store，让 UI 立即看到新行
      set((state) => ({ mappings: [...state.mappings, item] }));
    }
    return created;
  },
  updateMapping: async (id, payload) => {
    const updated = await syncService.updateMapping(id, payload);
    set((state) => ({ mappings: state.mappings.map((m) => (m.id === id ? updated : m)) }));
    return updated;
  },

  deleteProject: async (id) => {
    await syncService.deleteProject(id);
    set((state) => {
      const taskIds = new Set(state.tasks.filter((t) => t.project_id === id).map((t) => t.id));
      return {
        projects: state.projects.filter((p) => p.id !== id),
        tasks: state.tasks.filter((t) => t.project_id !== id),
        mappings: state.mappings.filter((m) => !taskIds.has(m.task_id)),
        selection: state.selectedProjectId === id ? null : state.selection,
        selectedProjectId: state.selectedProjectId === id ? null : state.selectedProjectId,
        selectedTaskId: state.selectedProjectId === id ? null : state.selectedTaskId,
        selectedMappingId: state.selectedProjectId === id ? null : state.selectedMappingId,
      };
    });
  },
  deleteTask: async (id) => {
    await syncService.deleteTask(id);
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== id), mappings: state.mappings.filter((m) => m.task_id !== id),
      selection: state.selectedTaskId === id ? (state.selectedProjectId ? { type: 'project', id: state.selectedProjectId } : null) : state.selection,
      selectedTaskId: state.selectedTaskId === id ? null : state.selectedTaskId,
      selectedMappingId: state.selectedTaskId === id ? null : state.selectedMappingId,
    }));
  },
  updateTask: async (id, payload) => {
    const updated = await syncService.updateTask(id, payload as any);
    set((state) => ({ tasks: state.tasks.map((t) => (t.id === id ? updated : t)) }));
  },
  deleteMapping: async (id) => {
    await syncService.deleteMapping(id);
    set((state) => ({
      mappings: state.mappings.filter((m) => m.id !== id),
      selection: state.selectedMappingId === id ? (state.selectedTaskId ? { type: 'task', id: state.selectedTaskId } : null) : state.selection,
      selectedMappingId: state.selectedMappingId === id ? null : state.selectedMappingId,
    }));
  },

  updateTaskLastRun: (taskId, payload) => {
    set((state) => ({
      tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, ...payload } : t)),
    }));
  },

  runTaskNow: async (taskId: string) => {
    // 同一时刻只允许一个任务在跑
    if (get().runningTaskId) return;
    set({ runningTaskId: taskId, runProgress: {}, error: null });

    await new Promise<void>((resolve) => {
      syncService.runTaskStream(
        taskId,
        {
          onProgress: (progress) => {
            // 记录最近一条进度，方便 UI 渲染
            set((state) => ({
              runProgress: { ...state.runProgress, [taskId]: {
                mappingIndex: progress.mappingIndex,
                totalMappings: progress.totalMappings,
                currentTable: progress.currentTable,
                status: progress.status,
                rows: progress.rows,
                pct: progress.pct,
              } },
            }));
          },
          onDone: async (result) => {
            // 更新 task 的 last_run_* 字段（前端镜像，与服务端同步）
            get().updateTaskLastRun(taskId, {
              lastRunAt: new Date().toISOString(),
              lastRunStatus: result.success ? 'success' : 'error',
              lastRunRows: result.totalRows,
            });
            set({ runningTaskId: null });
            // 刷新 tasks 列表（取最新 server 端状态）
            const projId = get().tasks.find((t) => t.id === taskId)?.project_id;
            if (projId) await get().loadTasks(projId);
            // 刷新项目 stats
            if (projId) {
              try { await get().loadProjectStats(projId); } catch { /* ignore */ }
            }
            resolve();
          },
          onError: (err) => {
            set({ error: err.message, runningTaskId: null });
            resolve();
          },
        }
      );
    });
  },

  clearError: () => set({ error: null }),
}));
