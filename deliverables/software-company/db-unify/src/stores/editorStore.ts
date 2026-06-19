import { create } from 'zustand';

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
  return 14;
};

export interface SqlTab {
  id: string;
  name: string;
  sql: string;
}

const DEFAULT_SQL = '';

let tabCounter = 1;

interface EditorState {
  sql: string;
  readOnlyMode: boolean;
  isExecuting: boolean;
  editorTheme: EditorTheme;
  fontSize: number;

  tabs: SqlTab[];
  activeTabId: string;
  addTab: () => void;
  removeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  setTabSql: (id: string, sql: string) => void;
  renameTab: (id: string, name: string) => void;

  setSql: (sql: string) => void;
  toggleReadOnly: () => void;
  setExecuting: (executing: boolean) => void;
  setEditorTheme: (theme: EditorTheme) => void;
  setFontSize: (size: number) => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  sql: DEFAULT_SQL,
  readOnlyMode: true,
  isExecuting: false,
  editorTheme: getPersistedTheme(),
  fontSize: getPersistedFontSize(),

  tabs: [{ id: 'tab-1', name: 'SQL 1', sql: DEFAULT_SQL }],
  activeTabId: 'tab-1',

  addTab: () => {
    tabCounter++;
    const newId = `tab-${tabCounter}`;
    set((state) => ({
      tabs: [...state.tabs, { id: newId, name: `SQL ${tabCounter}`, sql: '' }],
      activeTabId: newId,
      sql: '',
    }));
  },

  removeTab: (id: string) => {
    set((state) => {
      const newTabs = state.tabs.filter((t) => t.id !== id);
      if (newTabs.length === 0) {
        tabCounter = 1;
        return {
          tabs: [{ id: 'tab-1', name: 'SQL 1', sql: DEFAULT_SQL }],
          activeTabId: 'tab-1',
          sql: DEFAULT_SQL,
        };
      }
      let newActiveId = state.activeTabId;
      if (state.activeTabId === id) {
        const removedIndex = state.tabs.findIndex((t) => t.id === id);
        const targetIndex = Math.min(removedIndex, newTabs.length - 1);
        newActiveId = newTabs[targetIndex].id;
      }
      return { tabs: newTabs, activeTabId: newActiveId, sql: newTabs.find((t) => t.id === newActiveId)?.sql ?? DEFAULT_SQL };
    });
  },

  setActiveTab: (id: string) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === id);
    if (tab) {
      set({ activeTabId: id, sql: tab.sql });
    } else {
      set({ activeTabId: id });
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
}));
