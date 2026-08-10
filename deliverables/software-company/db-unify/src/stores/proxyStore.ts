import { create } from 'zustand';
import type {
  ProxyConnection,
  ProxyAuditLog,
  ProxyProcessStatus,
  CreateProxyConnectionPayload,
} from '../types/proxy';
import {
  fetchProxyConnections,
  createProxyConnection,
  updateProxyConnection,
  revokeProxyConnection,
  fetchProxyAuditByConnection,
  fetchProxyProcessStatus,
  startProxyProcess,
  stopProxyProcess,
  restartProxyProcess,
} from '../services/proxyService';

interface ProxyState {
  connections: ProxyConnection[];
  total: number;
  loading: boolean;
  error: string | null;

  selectedId: string | null;
  auditLogs: ProxyAuditLog[];
  auditLoading: boolean;

  processStatus: ProxyProcessStatus | null;
  processLoading: boolean;
  processError: string | null;

  loadConnections: () => Promise<void>;
  createConnection: (payload: CreateProxyConnectionPayload) => Promise<ProxyConnection | null>;
  updateConnection: (id: string, patch: Partial<CreateProxyConnectionPayload>) => Promise<void>;
  revokeConnection: (id: string) => Promise<void>;
  selectConnection: (id: string | null) => void;
  loadAudit: (id: string) => Promise<void>;

  loadProcessStatus: () => Promise<void>;
  startProcess: () => Promise<void>;
  stopProcess: () => Promise<void>;
  restartProcess: () => Promise<void>;
}

export const useProxyStore = create<ProxyState>((set, get) => ({
  connections: [],
  total: 0,
  loading: false,
  error: null,

  selectedId: null,
  auditLogs: [],
  auditLoading: false,

  processStatus: null,
  processLoading: false,
  processError: null,

  loadConnections: async () => {
    set({ loading: true, error: null });
    try {
      const data = await fetchProxyConnections({ pageSize: 100 });
      set({ connections: data.connections, total: data.total, loading: false });
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  createConnection: async (payload) => {
    try {
      const created = await createProxyConnection(payload);
      await get().loadConnections();
      set({ selectedId: created.id });
      return created;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  updateConnection: async (id, patch) => {
    try {
      await updateProxyConnection(id, patch);
      await get().loadConnections();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  revokeConnection: async (id) => {
    try {
      await revokeProxyConnection(id);
      await get().loadConnections();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  selectConnection: (id) => {
    set({ selectedId: id });
    if (id) get().loadAudit(id);
  },

  loadAudit: async (id) => {
    set({ auditLoading: true });
    try {
      const logs = await fetchProxyAuditByConnection(id);
      set({ auditLogs: logs, auditLoading: false });
    } catch (e) {
      set({ auditLoading: false, error: (e as Error).message });
    }
  },

  loadProcessStatus: async () => {
    try {
      const status = await fetchProxyProcessStatus();
      set({ processStatus: status, processError: null });
    } catch (e) {
      set({ processError: (e as Error).message });
    }
  },

  startProcess: async () => {
    set({ processLoading: true, processError: null });
    try {
      const status = await startProxyProcess();
      set({ processStatus: status, processLoading: false });
    } catch (e) {
      set({ processLoading: false, processError: (e as Error).message });
    }
  },

  stopProcess: async () => {
    set({ processLoading: true, processError: null });
    try {
      const status = await stopProxyProcess();
      set({ processStatus: status, processLoading: false });
    } catch (e) {
      set({ processLoading: false, processError: (e as Error).message });
    }
  },

  restartProcess: async () => {
    set({ processLoading: true, processError: null });
    try {
      const status = await restartProxyProcess();
      set({ processStatus: status, processLoading: false });
    } catch (e) {
      set({ processLoading: false, processError: (e as Error).message });
    }
  },
}));
