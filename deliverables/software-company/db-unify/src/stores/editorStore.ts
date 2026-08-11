import { create } from 'zustand';
import { useExecutionStore } from './executionStore';
import { useResultStore } from './resultStore';
import { useTreeStore } from './treeStore';
import type { ExecutionTask } from '../types/execution';
import type { QueryResult, AggregatedResult } from '../types/result';

export type EditorTheme = 'vs-dark' | 'vs' | 'hc-black' | 'hc-light';

/** 从 localStorage 读取持久化的编辑器主题 */
const getPersistedTheme = (): EditorTheme => {
  try {
    const raw = localStorage.getItem('dc_editor_theme');
    if (raw && ['vs-dark', 'vs', 'hc-black', 'hc-light'].includes(raw)) {
      return raw as EditorTheme;
    }
  } catch { /* 读取失败用默认值 */ }
  return 'vs-dark';
};

/** 从 localStorage 读取持久化的字体大小 */
const getPersistedFontSize = (): number => {
  try {
    const raw = localStorage.getItem('dc_editor_font_size');
    const n = parseInt(raw || '', 10);
    if (n >= 10 && n <= 30) return n;
  } catch { /* 读取失败用默认值 */ }
  return 17;  // 默认 17px 让 SQL token 视觉间距更宽
};

export interface SqlTab {
  id: string;
  name: string;
  sql: string;
}

/** 每个标签页独立的执行状态快照 */
export interface TabExecSnapshot {
  tasks: ExecutionTask[];
  currentSql: string;
  currentConnections: { id: string; hospitalName: string; preDbTypeName: string; schema?: string }[];
  currentExecutionId: string | null;
  results: Record<string, QueryResult>;
  aggregatedResult: AggregatedResult | null;
  /** 该 tab 在"单库详情"中选的数据库 ID */
  selectedDbId: string | null;
  /** 分页批次大小 */
  pageSize: number;
  /** 各连接的分页元信息 */
  resultMeta: Record<string, { hasMore: boolean; totalLoaded: number }>;
  /** 该 tab 是否正在执行（切换 tab 时决定按钮/进度条状态）*/
  isExecuting: boolean;
  /** 各连接的行选择状态（单库详情中用） */
  rowSelections: Record<string, number[]>;
}

/** 从全局 store 抓取当前执行/结果状态快照 */
function captureSnapshot(): TabExecSnapshot {
  const es = useExecutionStore.getState();
  const rs = useResultStore.getState();
  const eds = useEditorStore.getState();
  return {
    tasks: es.tasks,
    currentSql: es.currentSql,
    currentConnections: es.currentConnections,
    currentExecutionId: es.currentExecutionId,
    results: rs.results,
    aggregatedResult: rs.aggregatedResult,
    selectedDbId: rs.selectedDbId,
    pageSize: eds.pageSize,
    resultMeta: eds.resultMeta,
    isExecuting: eds.isExecuting,
    rowSelections: eds.rowSelections,
  };
}

/** 将快照恢复到全局 store */
function restoreSnapshot(snapshot: TabExecSnapshot) {
  useExecutionStore.setState({
    tasks: snapshot.tasks,
    currentSql: snapshot.currentSql,
    currentConnections: snapshot.currentConnections,
    currentExecutionId: snapshot.currentExecutionId,
  });
  useResultStore.setState({
    results: snapshot.results,
    aggregatedResult: snapshot.aggregatedResult,
    selectedDbId: snapshot.selectedDbId,
  });
  useEditorStore.setState({
    pageSize: snapshot.pageSize ?? 100,
    resultMeta: snapshot.resultMeta ?? {},
    isExecuting: snapshot.isExecuting ?? false,
    rowSelections: snapshot.rowSelections ?? {},
  });
}

const DEFAULT_SQL = '';

let tabCounter = 1;

interface EditorState {
  sql: string;
  selectedSql: string;
  readOnlyMode: boolean;
  isExecuting: boolean;
  editorTheme: EditorTheme;
  fontSize: number;

  tabs: SqlTab[];
  activeTabId: string;
  /** 记录每个标签页是否执行过（切换标签时据此决定是否清空底栏） */
  tabExecutedMap: Record<string, boolean>;
  /** 每个标签页独立的执行状态/结果/历史快照 */
  tabSnapshots: Record<string, TabExecSnapshot>;
  /** 每个标签页独立绑定的数据库连接 ID 列表 */
  tabDbIds: Record<string, string[]>;
  markTabExecuted: (tabId: string) => void;
  setTabDbIds: (tabId: string, dbIds: string[]) => void;
  bindDbToTab: (tabId: string, dbId: string) => void;
  unbindDbFromTab: (tabId: string, dbId: string) => void;
  addTab: () => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabSql: (id: string, sql: string) => void;
  renameTab: (id: string, name: string) => void;
  /** 将当前全局 store 状态保存到指定 tab 的快照中 */
  saveSnapshotToTab: (tabId: string) => void;

  setSql: (sql: string) => void;
  setSelectedSql: (sql: string) => void;
  toggleReadOnly: () => void;
  setExecuting: (executing: boolean) => void;
  setEditorTheme: (theme: EditorTheme) => void;
  setFontSize: (size: number) => void;

  // ─── 分页相关 ───
  /** 每批加载行数（默认 100） */
  pageSize: number;
  /** 是否正在加载更多行 */
  loadingMore: boolean;
  /** 各连接的分页元信息 */
  resultMeta: Record<string, { hasMore: boolean; totalLoaded: number }>;
  /** loadMore 函数引用（由 useExecution 设置） */
  loadMoreFn: ((connId: string) => void) | null;
  /** 各连接的行选择状态（单库详情中用，key=dbConnectionId） */
  rowSelections: Record<string, number[]>;
  setPageSize: (size: number) => void;
  setLoadingMore: (loading: boolean) => void;
  setLoadMoreFn: (fn: ((connId: string) => void) | null) => void;
  updateResultMeta: (connId: string, meta: { hasMore: boolean; totalLoaded: number }) => void;
  resetPagination: () => void;
  /** 设置某个连接的选中行索引列表 */
  setRowSelections: (connId: string, indices: number[]) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  sql: DEFAULT_SQL,
  selectedSql: '',
  readOnlyMode: true,
  isExecuting: false,
  editorTheme: getPersistedTheme(),
  fontSize: getPersistedFontSize(),

  tabs: [{ id: 'tab-1', name: 'SQL 1', sql: DEFAULT_SQL }],
  activeTabId: 'tab-1',
  tabExecutedMap: { 'tab-1': false },
  tabSnapshots: {},
  tabDbIds: { 'tab-1': [] },

  // ─── 分页初始值 ───
  pageSize: 100,
  loadingMore: false,
  resultMeta: {},
  loadMoreFn: null,
  rowSelections: {},

  markTabExecuted: (tabId) => {
    set((state) => ({ tabExecutedMap: { ...state.tabExecutedMap, [tabId]: true } }));
  },

  saveSnapshotToTab: (tabId) => {
    const snapshot = captureSnapshot();
    set((state) => ({
      tabSnapshots: { ...state.tabSnapshots, [tabId]: snapshot },
    }));
  },

  setTabDbIds: (tabId, dbIds) => {
    set((state) => ({
      tabDbIds: { ...state.tabDbIds, [tabId]: dbIds },
    }));
  },

  bindDbToTab: (tabId, dbId) => {
    set((state) => {
      const current = state.tabDbIds[tabId] || [];
      if (current.includes(dbId)) return state;
      return {
        tabDbIds: { ...state.tabDbIds, [tabId]: [...current, dbId] },
      };
    });
  },

  unbindDbFromTab: (tabId, dbId) => {
    set((state) => {
      const current = state.tabDbIds[tabId] || [];
      return {
        tabDbIds: { ...state.tabDbIds, [tabId]: current.filter((id) => id !== dbId) },
      };
    });
  },

  addTab: () => {
    tabCounter++;
    const newId = `tab-${tabCounter}`;
    // 保存当前 tab 的快照
    const state = get();
    const currentSnapshot = captureSnapshot();
    // 保存当前 tab 的数据库绑定状态
    const currentTabDbIds = useTreeStore.getState().selectedDbIds;
    // 新 tab 的空白快照
    const emptySnapshot: TabExecSnapshot = {
      tasks: [],
      currentSql: '',
      currentConnections: [],
      currentExecutionId: null,
      results: {},
      aggregatedResult: null,
      selectedDbId: null,
      pageSize: 100,
      resultMeta: {},
      isExecuting: false,
      rowSelections: {},
    };
    // 重置全局 store 为新 tab 的空白状态
    useExecutionStore.getState().reset();
    useResultStore.getState().reset();
    // 新 tab 无绑定数据库，同步清空 treeStore 的选中状态
    useTreeStore.getState().setSelectedDbIds([]);
    set({
      tabs: [...state.tabs, { id: newId, name: `SQL ${tabCounter}`, sql: '' }],
      activeTabId: newId,
      sql: '',
      tabExecutedMap: { ...state.tabExecutedMap, [newId]: false },
      tabSnapshots: {
        ...state.tabSnapshots,
        [state.activeTabId]: currentSnapshot,
        [newId]: emptySnapshot,
      },
      tabDbIds: {
        ...state.tabDbIds,
        [state.activeTabId]: currentTabDbIds,
        [newId]: [],
      },
    });
  },

  removeTab: (id: string) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id);
      // 清理已删除 tab 的快照和数据库绑定
      const { [id]: removedSnapshot, ...remainingSnapshots } = state.tabSnapshots;
      const { [id]: removedDbIds, ...remainingTabDbIds } = state.tabDbIds;
      if (newTabs.length === 0) {
        tabCounter = 1;
        useExecutionStore.getState().reset();
        useResultStore.getState().reset();
        useTreeStore.getState().setSelectedDbIds([]);
        return {
          tabs: [{ id: 'tab-1', name: 'SQL 1', sql: DEFAULT_SQL }],
          activeTabId: 'tab-1',
          sql: DEFAULT_SQL,
          tabSnapshots: {},
          tabDbIds: { 'tab-1': [] },
        };
      }
      let newActiveId = state.activeTabId;
      let needRestore = false;
      if (state.activeTabId === id) {
        const removedIndex = state.tabs.findIndex((t) => t.id === id);
        const targetIndex = Math.min(removedIndex, newTabs.length - 1);
        newActiveId = newTabs[targetIndex].id;
        needRestore = true;
      }
      const result: any = { tabs: newTabs, activeTabId: newActiveId, tabSnapshots: remainingSnapshots, tabDbIds: remainingTabDbIds };
      if (needRestore) {
        // 恢复目标 tab 的快照和数据库绑定
        const targetSnap = remainingSnapshots[newActiveId];
        const targetDbIds = remainingTabDbIds[newActiveId] || [];
        useTreeStore.getState().setSelectedDbIds(targetDbIds);
        if (targetSnap) {
          restoreSnapshot(targetSnap);
          result.sql = newTabs.find((t) => t.id === newActiveId)?.sql ?? DEFAULT_SQL;
        } else {
          useExecutionStore.getState().reset();
          useResultStore.getState().reset();
          result.sql = newTabs.find((t) => t.id === newActiveId)?.sql ?? DEFAULT_SQL;
        }
      } else {
        result.sql = newTabs.find((t) => t.id === newActiveId)?.sql ?? DEFAULT_SQL;
      }
      return result;
    });
  },

  setActiveTab: (id: string) => {
    const state = get();
    // 保存当前 tab 的全局 store 状态到快照
    if (state.activeTabId && state.activeTabId !== id) {
      const currentSnapshot = captureSnapshot();
      const updatedSnapshots = { ...state.tabSnapshots, [state.activeTabId]: currentSnapshot };
      // 保存当前 tab 的数据库绑定状态
      const currentDbIds = useTreeStore.getState().selectedDbIds;
      const updatedTabDbIds = { ...state.tabDbIds, [state.activeTabId]: currentDbIds };
      // 恢复目标 tab 的数据库绑定到 treeStore
      const targetDbIds = updatedTabDbIds[id] || [];
      useTreeStore.getState().setSelectedDbIds(targetDbIds);
      // 恢复目标 tab 的快照
      const targetSnap = updatedSnapshots[id];
      if (targetSnap) {
        restoreSnapshot(targetSnap);
      } else {
        // 目标 tab 从未执行过 → 重置全局 store
        useExecutionStore.getState().reset();
        useResultStore.getState().reset();
      }
      const tab = state.tabs.find((t) => t.id === id);
      set({
        activeTabId: id,
        sql: tab?.sql ?? '',
        tabSnapshots: updatedSnapshots,
        tabDbIds: updatedTabDbIds,
      });
    } else if (state.activeTabId === id) {
      // 同一个 tab，不做任何操作
    } else {
      // 首次设置 activeTabId（初始化场景）
      if (!state.tabExecutedMap[id]) {
        useExecutionStore.getState().reset();
        useResultStore.getState().reset();
      }
      const tab = state.tabs.find((t) => t.id === id);
      if (tab) {
        set({ activeTabId: id, sql: tab.sql });
      } else {
        set({ activeTabId: id });
      }
    }
  },

  setTabSql: (id: string, sql: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }));
  },

  renameTab: (id: string, name: string) => {
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, name } : t)),
    }));
  },

  setSql: (sql: string) => {
    const state = get();
    set({
      sql,
      tabs: state.tabs.map((t) => (t.id === state.activeTabId ? { ...t, sql } : t)),
    });
  },
  setSelectedSql: (sql: string) => set({ selectedSql: sql }),
  toggleReadOnly: () => set((state) => ({ readOnlyMode: !state.readOnlyMode })),
  setExecuting: (executing: boolean) => set({ isExecuting: executing }),
  setEditorTheme: (theme: EditorTheme) => {
    try { localStorage.setItem('dc_editor_theme', theme); } catch { /* 持久化失败 */ }
    set({ editorTheme: theme });
  },
  setFontSize: (size: number) => {
    try { localStorage.setItem('dc_editor_font_size', String(size)); } catch { /* 持久化失败 */ }
    set({ fontSize: size });
  },

  // ─── 分页 setter ───
  setPageSize: (size: number) => {
    const clamped = Math.max(10, Math.min(10000, Math.round(size)));
    set({ pageSize: clamped });
  },
  setLoadingMore: (loading: boolean) => set({ loadingMore: loading }),
  setLoadMoreFn: (fn: ((connId: string) => void) | null) => set({ loadMoreFn: fn }),
  updateResultMeta: (connId: string, meta: { hasMore: boolean; totalLoaded: number }) => {
    set((state) => ({
      resultMeta: { ...state.resultMeta, [connId]: meta },
    }));
  },
  resetPagination: () => set({ resultMeta: {}, loadingMore: false }),

  setRowSelections: (connId, indices) => {
    set((state) => ({
      rowSelections: { ...state.rowSelections, [connId]: indices },
    }));
  },
}));
