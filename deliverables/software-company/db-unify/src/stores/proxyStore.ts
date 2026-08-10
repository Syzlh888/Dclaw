import { create } from 'zustand';
import type {
  ProxyConnection,
  ProxyAuditLog,
  ProxyProcessStatus,
  ProxyStats,
  ProxyDangerRule,
  CreateProxyConnectionPayload,
} from '../types/proxy';
import {
  fetchProxyConnections,
  createProxyConnection,
  updateProxyConnection,
  revokeProxyConnection,
  fetchProxyAudit,
  exportProxyAuditCsv,
  fetchProxyProcessStatus,
  startProxyProcess,
  stopProxyProcess,
  restartProxyProcess,
  fetchProxyHealthAll,
  triggerProxyHealthCheck,
  fetchProxyStats,
  fetchProxyRules,
  createProxyRule,
  updateProxyRule,
  toggleProxyRule,
  deleteProxyRule,
  runProxyAuditCleanup,
} from '../services/proxyService';
import type { ProxyAuditFilter, ProxyRulePayload } from '../services/proxyService';

interface ProxyState {
  connections: ProxyConnection[];
  total: number;
  loading: boolean;
  error: string | null;

  selectedId: string | null;
  auditLogs: ProxyAuditLog[];
  auditTotal: number;
  auditPage: number;
  auditPageSize: number;
  auditLoading: boolean;
  auditFilters: { sql_type?: string; status?: string; start?: string; end?: string };

  processStatus: ProxyProcessStatus | null;
  processLoading: boolean;
  processError: string | null;

  // 新增：健康检查 / 统计 / 规则
  healthMap: Record<string, { health_status: string; last_health_check_at: string | null; last_error: string | null }>;
  stats: ProxyStats[];
  statsRange: { from: string; to: string };
  statsLoading: boolean;

  rules: ProxyDangerRule[];
  rulesLoading: boolean;

  // 请求令牌（防竞态：过期响应丢弃）
  _auditReqId: number;
  _statusReqId: number;
  _statsReqId: number;
  _rulesReqId: number;
  _healthReqId: number;

  loadConnections: () => Promise<void>;
  createConnection: (payload: CreateProxyConnectionPayload) => Promise<ProxyConnection | null>;
  updateConnection: (id: string, patch: Partial<CreateProxyConnectionPayload>) => Promise<void>;
  revokeConnection: (id: string) => Promise<void>;
  selectConnection: (id: string | null) => void;
  loadAudit: (opts?: { page?: number; filters?: Partial<ProxyAuditFilter> }) => Promise<void>;
  setAuditFilters: (filters: Partial<ProxyAuditFilter>) => void;
  exportAudit: () => Promise<void>;

  loadProcessStatus: () => Promise<void>;
  startProcess: () => Promise<void>;
  stopProcess: () => Promise<void>;
  restartProcess: () => Promise<void>;

  loadHealthAll: () => Promise<void>;
  triggerHealthCheck: (id: string) => Promise<{ ok: boolean }>;

  loadStats: (params?: { from?: string; to?: string; connection_id?: string }) => Promise<void>;

  loadRules: () => Promise<void>;
  createRule: (payload: ProxyRulePayload) => Promise<ProxyDangerRule | null>;
  updateRule: (id: string, patch: Partial<ProxyRulePayload>) => Promise<ProxyDangerRule | null>;
  toggleRule: (id: string) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  runAuditCleanup: () => Promise<{ deleted: number } | null>;
}

export const useProxyStore = create<ProxyState>((set, get) => ({
  connections: [],
  total: 0,
  loading: false,
  error: null,

  selectedId: null,
  auditLogs: [],
  auditTotal: 0,
  auditPage: 1,
  auditPageSize: 20,
  auditLoading: false,
  auditFilters: {},

  processStatus: null,
  processLoading: false,
  processError: null,

  healthMap: {},
  stats: [],
  statsRange: { from: '', to: '' },
  statsLoading: false,

  rules: [],
  rulesLoading: false,

  /** 请求序号：用于丢弃过期的审计/状态请求（防止快速切换时顺序错乱） */
  _auditReqId: 0,
  _statusReqId: 0,
  _statsReqId: 0,
  _rulesReqId: 0,
  _healthReqId: 0,

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
    set({ selectedId: id, auditPage: 1, auditFilters: {}, auditLogs: [], auditTotal: 0 });
    if (id) get().loadAudit({ page: 1 });
  },

  setAuditFilters: (filters) => {
    set({ auditFilters: { ...get().auditFilters, ...filters }, auditPage: 1 });
    get().loadAudit({ page: 1 });
  },

  loadAudit: async (opts) => {
    const { selectedId, auditFilters } = get();
    if (!selectedId) return;
    const page = opts?.page ?? get().auditPage;
    const reqId = get()._auditReqId + 1;
    set({ auditLoading: true, _auditReqId: reqId });
    try {
      const mergedFilters = { ...auditFilters, ...(opts?.filters || {}) };
      const data = await fetchProxyAudit({
        proxy_connection_id: selectedId,
        sql_type: mergedFilters.sql_type || undefined,
        status: mergedFilters.status || undefined,
        start: mergedFilters.start || undefined,
        end: mergedFilters.end || undefined,
        page,
        pageSize: 20,
      });
      // 仅当 reqId 未被更新（即后续没有新请求）才写入结果
      if (get()._auditReqId === reqId) {
        set({ auditLogs: data.logs, auditTotal: data.total, auditPage: data.page, auditLoading: false });
      }
    } catch (e) {
      if (get()._auditReqId === reqId) {
        set({ auditLoading: false, error: (e as Error).message });
      }
    }
  },

  exportAudit: async () => {
    const { selectedId, auditFilters } = get();
    if (!selectedId) return;
    try {
      await exportProxyAuditCsv({
        proxy_connection_id: selectedId,
        sql_type: auditFilters.sql_type || undefined,
        status: auditFilters.status || undefined,
        start: auditFilters.start || undefined,
        end: auditFilters.end || undefined,
      });
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  loadProcessStatus: async () => {
    const reqId = get()._statusReqId + 1;
    set({ _statusReqId: reqId });
    try {
      const status = await fetchProxyProcessStatus();
      if (get()._statusReqId === reqId) {
        set({ processStatus: status, processError: null });
      }
    } catch (e) {
      if (get()._statusReqId === reqId) {
        set({ processError: (e as Error).message });
      }
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

  loadHealthAll: async () => {
    const reqId = get()._healthReqId + 1;
    set({ _healthReqId: reqId });
    try {
      const data = await fetchProxyHealthAll();
      if (get()._healthReqId !== reqId) return;
      const map: ProxyState['healthMap'] = {};
      for (const h of data.connections) {
        map[h.id] = {
          health_status: h.health_status,
          last_health_check_at: h.last_health_check_at,
          last_error: h.last_error,
        };
      }
      set({ healthMap: map });
    } catch (e) {
      // 静默失败，不弹错误（健康检查是非关键能力）
      // eslint-disable-next-line no-console
      console.warn('[proxy-store] loadHealthAll failed:', (e as Error).message);
    }
  },

  triggerHealthCheck: async (id) => {
    try {
      const r = await triggerProxyHealthCheck(id);
      await get().loadHealthAll();
      return { ok: r.ok };
    } catch (e) {
      set({ error: (e as Error).message });
      return { ok: false };
    }
  },

  loadStats: async (params) => {
    const reqId = get()._statsReqId + 1;
    set({ _statsReqId: reqId, statsLoading: true });
    try {
      const data = await fetchProxyStats(params || {});
      if (get()._statsReqId !== reqId) return;
      set({
        stats: data.stats,
        statsRange: { from: data.from, to: data.to },
        statsLoading: false,
      });
    } catch (e) {
      if (get()._statsReqId === reqId) {
        set({ statsLoading: false, error: (e as Error).message });
      }
    }
  },

  loadRules: async () => {
    const reqId = get()._rulesReqId + 1;
    set({ _rulesReqId: reqId, rulesLoading: true });
    try {
      const data = await fetchProxyRules();
      if (get()._rulesReqId !== reqId) return;
      set({ rules: data.rules, rulesLoading: false });
    } catch (e) {
      if (get()._rulesReqId === reqId) {
        set({ rulesLoading: false, error: (e as Error).message });
      }
    }
  },

  createRule: async (payload) => {
    try {
      const r = await createProxyRule(payload);
      await get().loadRules();
      return r.rule;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  updateRule: async (id, patch) => {
    try {
      const r = await updateProxyRule(id, patch);
      await get().loadRules();
      return r.rule;
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },

  toggleRule: async (id) => {
    try {
      await toggleProxyRule(id);
      await get().loadRules();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  deleteRule: async (id) => {
    try {
      await deleteProxyRule(id);
      await get().loadRules();
    } catch (e) {
      set({ error: (e as Error).message });
    }
  },

  runAuditCleanup: async () => {
    try {
      const r = await runProxyAuditCleanup();
      return { deleted: (r && r.deleted) || 0 };
    } catch (e) {
      set({ error: (e as Error).message });
      return null;
    }
  },
}));
