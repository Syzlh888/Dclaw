import { create } from 'zustand';
import type { ServerHost, DbInstance, AppInstance, ApiInstance, MiddlewareInstance, PortInfo, PasswordHistory, AssetSummary, ServerSearchFilter } from '../types/server';
import * as api from '../services/serverService';
import { removeServerAssociations } from '../services/dbInstanceSyncService';

interface ServerState {
  servers: ServerHost[];
  serverMap: Record<string, ServerHost>;
  loading: boolean;
  selectedId: string | null;

  // 子资源缓存
  dbInstances: Record<string, DbInstance[]>;
  appInstances: Record<string, AppInstance[]>;
  apiInstances: Record<string, ApiInstance[]>;
  midInstances: Record<string, MiddlewareInstance[]>;
  ports: Record<string, PortInfo[]>;

  // 搜索
  searchFilter: ServerSearchFilter;

  // 汇总
  summary: AssetSummary | null;

  loadServers: () => Promise<void>;
  selectServer: (id: string | null) => void;
  createServer: (input: any) => Promise<string>;
  updateServer: (id: string, partial: any) => Promise<void>;
  deleteServer: (id: string) => Promise<void>;
  loadDetail: (id: string) => Promise<void>;

  // 子资源
  addDbInstance: (serverId: string, input: any) => Promise<void>;
  updateDbInstance: (serverId: string, di: string, partial: any) => Promise<void>;
  deleteDbInstance: (serverId: string, di: string) => Promise<void>;
  addAppInstance: (serverId: string, input: any) => Promise<void>;
  updateAppInstance: (serverId: string, ai: string, partial: any) => Promise<void>;
  deleteAppInstance: (serverId: string, ai: string) => Promise<void>;
  addMiddleware: (serverId: string, input: any) => Promise<void>;
  updateMiddleware: (serverId: string, mi: string, partial: any) => Promise<void>;
  deleteMiddleware: (serverId: string, mi: string) => Promise<void>;
  addApiInstance: (serverId: string, input: any) => Promise<void>;
  updateApiInstance: (serverId: string, ai: string, partial: any) => Promise<void>;
  deleteApiInstance: (serverId: string, ai: string) => Promise<void>;
  addPort: (serverId: string, input: any) => Promise<void>;
  updatePort: (serverId: string, pi: string, partial: any) => Promise<void>;
  deletePort: (serverId: string, pi: string) => Promise<void>;

  // 搜索
  setSearchFilter: (filter: Partial<ServerSearchFilter>) => void;
  getFilteredServers: () => ServerHost[];

  // 汇总
  loadSummary: () => Promise<void>;

  // 密码历史
  passwordHistory: Record<string, PasswordHistory[]>;
  loadPasswordHistory: (serverId: string) => Promise<void>;
}

export const useServerStore = create<ServerState>((set, get) => ({
  servers: [],
  serverMap: {},
  loading: false,
  selectedId: null,
  dbInstances: {},
  appInstances: {},
  apiInstances: {},
  midInstances: {},
  ports: {},
  searchFilter: {},
  summary: null,
  passwordHistory: {},

  loadServers: async () => {
    set({ loading: true });
    try {
      const servers = await api.fetchServers();
      const map: Record<string, ServerHost> = {};
      for (const s of servers) {
        map[s.id || s.internal_ip] = mapServerFromApi(s);
      }
      set({ servers: Object.values(map), serverMap: map, loading: false });
    } catch (err) {
      console.error('加载服务器列表失败:', err);
      set({ loading: false });
    }
  },

  selectServer: (id) => {
    set({ selectedId: id });
    if (id) get().loadDetail(id);
  },

  createServer: async (input) => {
    const created = await api.createServer(input);
    await get().loadServers();
    return created.id;
  },

  updateServer: async (id, partial) => {
    await api.updateServer(id, partial);
    await get().loadServers();
    if (get().selectedId === id) get().loadDetail(id);
  },

  deleteServer: async (id) => {
    // 删除前先清理关联的连接和树节点
    const state = get();
    const dbInstances = state.dbInstances[id] || [];
    if (dbInstances.length > 0) {
      try {
        await removeServerAssociations(id, dbInstances);
      } catch (err) {
        console.error('清理关联连接失败:', err);
      }
    }
    await api.deleteServer(id);
    set({
      selectedId: state.selectedId === id ? null : state.selectedId,
      dbInstances: { ...state.dbInstances, [id]: [] },
      appInstances: { ...state.appInstances, [id]: [] },
      apiInstances: { ...state.apiInstances, [id]: [] },
      midInstances: { ...state.midInstances, [id]: [] },
      ports: { ...state.ports, [id]: [] },
    });
    await get().loadServers();
  },

  loadDetail: async (id) => {
    try {
      const data = await api.fetchServerDetail(id);
      const sub = data;

      const dbInstances = (sub.dbInstances || []).map(mapDbInstFromApi);
      const appInstances = (sub.appInstances || []).map(mapAppInstFromApi);
      const apiInstances = (sub.apiInstances || []).map(mapApiInstFromApi);
      const midInstances = (sub.midInstances || []).map(mapMidInstFromApi);
      const ports = (sub.ports || []).map(mapPortFromApi);

      set({
        dbInstances: { ...get().dbInstances, [id]: dbInstances },
        appInstances: { ...get().appInstances, [id]: appInstances },
        apiInstances: { ...get().apiInstances, [id]: apiInstances },
        midInstances: { ...get().midInstances, [id]: midInstances },
        ports: { ...get().ports, [id]: ports },
      });
    } catch (err) {
      console.error('加载服务器详情失败:', err);
    }
  },

  addDbInstance: async (serverId, input) => {
    await api.addDbInstance(serverId, input);
    await get().loadDetail(serverId);
  },
  updateDbInstance: async (serverId, di, partial) => {
    await api.updateDbInstance(serverId, di, partial);
    await get().loadDetail(serverId);
  },
  deleteDbInstance: async (serverId, di) => {
    await api.deleteDbInstance(serverId, di);
    await get().loadDetail(serverId);
  },
  addAppInstance: async (serverId, input) => {
    await api.addAppInstance(serverId, input);
    await get().loadDetail(serverId);
  },
  updateAppInstance: async (serverId, ai, partial) => {
    await api.updateAppInstance(serverId, ai, partial);
    await get().loadDetail(serverId);
  },
  deleteAppInstance: async (serverId, ai) => {
    await api.deleteAppInstance(serverId, ai);
    await get().loadDetail(serverId);
  },
  addMiddleware: async (serverId, input) => {
    await api.addMiddleware(serverId, input);
    await get().loadDetail(serverId);
  },
  updateMiddleware: async (serverId, mi, partial) => {
    await api.updateMiddleware(serverId, mi, partial);
    await get().loadDetail(serverId);
  },
  deleteMiddleware: async (serverId, mi) => {
    await api.deleteMiddleware(serverId, mi);
    await get().loadDetail(serverId);
  },
  addApiInstance: async (serverId, input) => {
    await api.addApiInstance(serverId, input);
    await get().loadDetail(serverId);
  },
  updateApiInstance: async (serverId, ai, partial) => {
    await api.updateApiInstance(serverId, ai, partial);
    await get().loadDetail(serverId);
  },
  deleteApiInstance: async (serverId, ai) => {
    await api.deleteApiInstance(serverId, ai);
    await get().loadDetail(serverId);
  },
  addPort: async (serverId, input) => {
    await api.addPort(serverId, input);
    await get().loadDetail(serverId);
  },
  updatePort: async (serverId, pi, partial) => {
    await api.updatePort(serverId, pi, partial);
    await get().loadDetail(serverId);
  },
  deletePort: async (serverId, pi) => {
    await api.deletePort(serverId, pi);
    await get().loadDetail(serverId);
  },

  setSearchFilter: (filter) => {
    set({ searchFilter: { ...get().searchFilter, ...filter } });
  },

  getFilteredServers: () => {
    const { servers, searchFilter: f } = get();
    return servers.filter(s => {
      if (f.keyword) {
        const kw = f.keyword.toLowerCase();
        if (!s.name?.toLowerCase().includes(kw) && !s.internalIp?.includes(kw)) return false;
      }
      if (f.ip && !s.internalIp?.includes(f.ip) && !s.externalIp?.includes(f.ip)) return false;
      if (f.os && s.os !== f.os) return false;
      if (f.applicationId && s.applicationId !== f.applicationId) return false;
      if (f.tags && f.tags.length > 0) {
        if (!s.tags || !f.tags.some(t => s.tags!.includes(t))) return false;
      }
      return true;
    });
  },

  loadSummary: async () => {
    try {
      const summary = await api.fetchServerSummary();
      set({ summary });
    } catch (err) {
      console.error('加载资产汇总失败:', err);
    }
  },

  loadPasswordHistory: async (serverId, fieldName?) => {
    try {
      const data = await api.fetchPasswordHistory(serverId, fieldName);
      const key = serverId + (fieldName ? `|${fieldName}` : '');
      set({ passwordHistory: { ...get().passwordHistory, [key]: data.history || [] } });
    } catch (err) {
      console.error('加载密码历史失败:', err);
    }
  },
}));

function mapServerFromApi(s: any): ServerHost {
  return {
    id: s.id,
    projectId: s.project_id || '',
    engineeringId: s.engineering_id || '',
    applicationId: s.application_id || '',
    name: s.name || '',
    internalIp: s.internal_ip || '',
    externalIp: s.external_ip || '',
    publicIp: s.public_ip || '',
    crossNetworkIp: s.cross_network_ip || '',
    os: s.os || '',
    cpuCores: s.cpu_cores,
    memoryGB: s.memory_gb,
    systemDiskGB: s.system_disk_gb,
    dataDiskGB: s.data_disk_gb,
    storageType: s.storage_type || '',
    bandwidthMbps: s.bandwidth_mbps,
    serverLocation: s.server_location || '',
    serverType: s.server_type || '',
    username: s.username || '',
    password: s.password || '******',
    ips: s.ips || [],
    credentials: s.credentials || [],
    bastionHost: s.bastion_host || '',
    bastionPort: s.bastion_port,
    bastionUsername: s.bastion_username || '',
    bastionPassword: s.bastion_password || '******',
    vpnInfo: s.vpn_info || '',
    macAddress: s.mac_address || '',
    deployedContent: s.deployed_content || '',
    accessList: Array.isArray(s.access_list) ? s.access_list : [],
    tags: s.tags || [],
    notes: s.notes || '',
    linkedConnectionIds: s.linked_connection_ids || [],
    createdAt: s.created_at || '',
    updatedAt: s.updated_at || '',
  };
}

function mapDbInstFromApi(d: any): DbInstance {
  let credentials = d.credentials || [];
  if (typeof credentials === 'string') {
    try { credentials = JSON.parse(credentials); } catch { credentials = []; }
  }
  return {
    id: d.id,
    serverId: d.server_id || '',
    dbType: d.db_type || '',
    version: d.version || '',
    dbName: d.db_name || '',
    schema: d.schema_name || '',
    username: d.username || '',
    password: d.password || '******',
    credentials: Array.isArray(credentials) ? credentials : [],
    internalIp: d.internal_ip || '',
    externalIp: d.external_ip || '',
    port: d.port || 0,
    notes: d.notes || '',
  };
}

function mapAppInstFromApi(a: any): AppInstance {
  let credentials = a.credentials || [];
  if (typeof credentials === 'string') {
    try { credentials = JSON.parse(credentials); } catch { credentials = []; }
  }
  return {
    id: a.id,
    serverId: a.server_id || '',
    name: a.name || '',
    port: a.port != null ? Number(a.port) : undefined,
    contactPerson: a.contact_person || '',
    contactPhone: a.contact_phone || '',
    url: a.url || '',
    username: a.username || '',
    password: a.password || '******',
    credentials: Array.isArray(credentials) ? credentials : [],
    notes: a.notes || '',
  };
}

function mapMidInstFromApi(m: any): MiddlewareInstance {
  let credentials = m.credentials || [];
  if (typeof credentials === 'string') {
    try { credentials = JSON.parse(credentials); } catch { credentials = []; }
  }
  return {
    id: m.id,
    serverId: m.server_id || '',
    name: m.name || '',
    port: m.port != null ? Number(m.port) : undefined,
    type: m.type || '',
    version: m.version || '',
    url: m.url || '',
    serviceApp: m.service_app || '',
    username: m.username || '',
    password: m.password || '******',
    credentials: Array.isArray(credentials) ? credentials : [],
    notes: m.notes || '',
  };
}

function mapApiInstFromApi(a: any): ApiInstance {
  return {
    id: a.id,
    serverId: a.server_id || '',
    apiAddress: a.api_address || '',
    port: a.port != null ? Number(a.port) : undefined,
    applicationName: a.application_name || '',
    encrypted: a.encrypted === 1 || a.encrypted === true,
    encryptionMethod: a.encryption_method || '',
    requestExample: a.request_example || a.requestExample || '',
    responseExample: a.response_example || a.responseExample || '',
    notes: a.notes || '',
  };
}

function mapPortFromApi(p: any): PortInfo {
  return {
    id: p.id,
    serverId: p.server_id || '',
    port: p.port || 0,
    protocol: p.protocol || 'TCP',
    type: p.type || '',
    serviceName: p.service_name || '',
    notes: p.notes || '',
  };
}
