import { create } from 'zustand';
import type { DbConnection } from '../types/connection';
import { ConnectionStatus } from '../types/connection';
import { nanoid } from 'nanoid';
import {
  fetchConnections,
  createConnection,
  updateConnection,
  deleteConnection,
} from '../services/connectionApiService';

interface ConnectionState {
  connections: Record<string, DbConnection>;
  loading: boolean;
  healthCheckInterval: ReturnType<typeof setInterval> | null;

  loadConnections: () => Promise<void>;
  addConnection: (connection: Omit<DbConnection, 'id'>) => Promise<string | undefined>;
  addConnectionWithId: (connection: DbConnection) => Promise<void>;
  updateConnection: (id: string, partial: Partial<DbConnection>) => Promise<void>;
  deleteConnection: (id: string) => Promise<void>;
  startHealthCheck: () => void;
  stopHealthCheck: () => void;
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  connections: {},
  loading: false,
  healthCheckInterval: null,

  loadConnections: async () => {
    set({ loading: true });
    try {
      const list = await fetchConnections();
      const map: Record<string, DbConnection> = {};
      for (const c of list) {
        map[c.id] = {
          id: c.id,
          name: c.name,
          driver: c.driver,
          host: c.host,
          port: c.port,
          username: c.username,
          password: '******',
          database: c.database_name || c.database || '',
          schema: c.schema_name || c.schema || '',
          status: (c.status as ConnectionStatus) || ConnectionStatus.Online,
          customDriverId: c.custom_driver_id || c.customDriverId,
          serverId: c.server_id || c.serverId,
          dbInstanceId: c.db_instance_id || c.dbInstanceId,
          credentialIndex: c.credential_index ?? c.credentialIndex,
        };
      }
      set({ connections: map, loading: false });
    } catch (err) {
      console.error('加载连接列表失败:', err);
      set({ loading: false });
    }
  },

  addConnection: async (connection) => {
    try {
      const created = await createConnection({
        name: connection.name,
        driver: connection.driver,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        database: connection.database,
        schema: connection.schema,
        customDriverId: connection.customDriverId,
        serverId: connection.serverId,
        dbInstanceId: connection.dbInstanceId,
        credentialIndex: connection.credentialIndex,
      });
      const newConn: DbConnection = {
        id: created.id,
        name: created.name,
        driver: created.driver,
        host: created.host,
        port: created.port,
        username: created.username,
        password: '******',
        database: created.database_name || '',
        schema: created.schema_name || '',
        status: ConnectionStatus.Online,
        customDriverId: created.custom_driver_id,
        serverId: connection.serverId,
        dbInstanceId: connection.dbInstanceId,
        credentialIndex: connection.credentialIndex,
      };
      set((state) => ({
        connections: { ...state.connections, [created.id]: newConn },
      }));
      return created.id;
    } catch (err) {
      console.error('添加连接失败:', err);
      throw err;
    }
  },

  addConnectionWithId: async (connection) => {
    try {
      await createConnection({
        name: connection.name,
        driver: connection.driver,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        database: connection.database,
        schema: connection.schema,
        customDriverId: connection.customDriverId,
        serverId: connection.serverId,
        dbInstanceId: connection.dbInstanceId,
        credentialIndex: connection.credentialIndex,
      });
    } catch (err) {
      console.error('创建连接失败:', err);
    }
    set((state) => ({
      connections: { ...state.connections, [connection.id]: connection },
    }));
  },

  updateConnection: async (id, partial) => {
    try {
      await updateConnection(id, {
        name: partial.name,
        driver: partial.driver,
        host: partial.host,
        port: partial.port,
        username: partial.username,
        password: partial.password !== '******' ? partial.password : undefined,
        database: partial.database,
        schema: partial.schema,
        customDriverId: partial.customDriverId,
        serverId: partial.serverId,
        dbInstanceId: partial.dbInstanceId,
        credentialIndex: partial.credentialIndex,
      });
      set((state) => {
        const existing = state.connections[id];
        if (!existing) return state;
        return {
          connections: { ...state.connections, [id]: { ...existing, ...partial } },
        };
      });
    } catch (err) {
      console.error('更新连接失败:', err);
      throw err;
    }
  },

  deleteConnection: async (id) => {
    try {
      await deleteConnection(id);
      set((state) => {
        const { [id]: _, ...rest } = state.connections;
        return { connections: rest };
      });
    } catch (err) {
      console.error('删除连接失败:', err);
      throw err;
    }
  },

  startHealthCheck: () => {
    const { healthCheckInterval } = get();
    if (healthCheckInterval) return; // already running

    const interval = setInterval(async () => {
      const { connections } = get();
      for (const [id] of Object.entries(connections)) {
        try {
          // 通过连接 ID 测试（后端从数据库取真实密码，避免密码脱敏问题）
          const resp = await (await import('../services/apiClient')).apiFetch(`/api/connections/${id}/test`, {
            method: 'POST',
          });
          const status = resp.ok ? ConnectionStatus.Online : ConnectionStatus.Error;
          set(state => ({
            connections: {
              ...state.connections,
              [id]: { ...state.connections[id], status },
            },
          }));
        } catch {
          set(state => ({
            connections: {
              ...state.connections,
              [id]: { ...state.connections[id], status: ConnectionStatus.Offline },
            },
          }));
        }
      }
    }, 300000); // every 5 minutes

    set({ healthCheckInterval: interval });
  },

  stopHealthCheck: () => {
    const { healthCheckInterval } = get();
    if (healthCheckInterval) {
      clearInterval(healthCheckInterval);
      set({ healthCheckInterval: null });
    }
  },
}));
