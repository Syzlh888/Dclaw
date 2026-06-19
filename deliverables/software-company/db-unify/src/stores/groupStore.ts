import { create } from 'zustand';

export interface DbGroup {
  id: string;
  name: string;
  dbConnectionIds: string[];
  createdAt: string; // ISO string
}

const STORAGE_KEY = 'dc_groups';
const ACTIVE_KEY = 'dc_active_group';

const getPersistedGroups = (): DbGroup[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { /* 读取失败用默认值 */ return []; }
};

const getPersistedActiveGroupId = (): string | null => {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { /* 读取失败返回 null */ return null; }
};

let nextId = Date.now();

interface GroupState {
  groups: DbGroup[];
  activeGroupId: string | null;

  createGroup: (name: string, dbConnectionIds: string[]) => string;
  deleteGroup: (id: string) => void;
  renameGroup: (id: string, name: string) => void;
  setActiveGroup: (id: string | null) => void;
  getActiveDbIds: () => string[];
}

export const useGroupStore = create<GroupState>((set, get) => ({
  groups: getPersistedGroups(),
  activeGroupId: getPersistedActiveGroupId(),

  createGroup: (name, dbConnectionIds) => {
    const id = `group_${++nextId}`;
    const group: DbGroup = {
      id,
      name,
      dbConnectionIds: [...new Set(dbConnectionIds)], // 去重
      createdAt: new Date().toISOString(),
    };
    const groups = [...get().groups, group];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups)); } catch { /* 持久化失败 */ }
    set({ groups });
    return id;
  },

  deleteGroup: (id) => {
    const state = get();
    const groups = state.groups.filter(g => g.id !== id);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups)); } catch { /* 持久化失败 */ }
    const nextActive = state.activeGroupId === id ? null : state.activeGroupId;
    try { localStorage.setItem(ACTIVE_KEY, nextActive || ''); } catch { /* 持久化失败 */ }
    set({ groups, activeGroupId: nextActive });
  },

  renameGroup: (id, name) => {
    const groups = get().groups.map(g => g.id === id ? { ...g, name } : g);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(groups)); } catch { /* 持久化失败 */ }
    set({ groups });
  },

  setActiveGroup: (id) => {
    try { localStorage.setItem(ACTIVE_KEY, id || ''); } catch { /* 持久化失败 */ }
    set({ activeGroupId: id });
  },

  getActiveDbIds: () => {
    const { activeGroupId, groups } = get();
    if (!activeGroupId) return [];
    const group = groups.find(g => g.id === activeGroupId);
    return group?.dbConnectionIds ?? [];
  },
}));
