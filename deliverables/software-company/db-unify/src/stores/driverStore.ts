import { create } from 'zustand';
import type { DriverPackage } from '../types/driver';
import { fetchDrivers, createDriver as apiCreateDriver, updateDriverApi, deleteDriverApi } from '../services/driverService';

interface DriverState {
  drivers: Record<string, DriverPackage>;
  loading: boolean;
  loaded: boolean;

  loadDrivers: () => Promise<void>;
  /** 创建驱动（含文件上传） */
  addDriver: (driver: Omit<DriverPackage, 'id' | 'uploadTime'>, file: File) => Promise<string | null>;
  updateDriver: (id: string, data: Partial<Pick<DriverPackage, 'name' | 'version' | 'driverClass' | 'description'>>) => Promise<boolean>;
  deleteDriver: (id: string) => Promise<void>;
  getDriverById: (id: string) => DriverPackage | undefined;
}

/** 内置驱动预设（后端未返回时作为兜底） */
const builtInDrivers: DriverPackage[] = [
  {
    id: 'mysql-builtin',
    name: 'MySQL',
    version: '8.0.33',
    driverClass: 'com.mysql.cj.jdbc.Driver',
    fileName: 'mysql-connector-j-8.0.33.jar',
    fileSize: 2500000,
    uploadTime: new Date().toISOString(),
    dbType: 'mysql',
    isBuiltIn: true,
  },
  {
    id: 'postgresql-builtin',
    name: 'PostgreSQL',
    version: '42.7.1',
    driverClass: 'org.postgresql.Driver',
    fileName: 'postgresql-42.7.1.jar',
    fileSize: 1000000,
    uploadTime: new Date().toISOString(),
    dbType: 'postgresql',
    isBuiltIn: true,
  },
  {
    id: 'oracle-builtin',
    name: 'Oracle',
    version: '19.21.0',
    driverClass: 'oracle.jdbc.OracleDriver',
    fileName: 'ojdbc8-19.21.0.0.jar',
    fileSize: 4194304,
    uploadTime: new Date().toISOString(),
    dbType: 'oracle',
    isBuiltIn: true,
  },
];

export const useDriverStore = create<DriverState>((set, get) => ({
  drivers: Object.fromEntries(builtInDrivers.map((d) => [d.id, d])),
  loading: false,
  loaded: false,

  /** 从后端加载驱动列表 */
  loadDrivers: async () => {
    set({ loading: true });
    try {
      const remoteDrivers = await fetchDrivers();
      const merged: Record<string, DriverPackage> = {};
      for (const d of remoteDrivers) {
        merged[d.id] = d;
      }
      for (const d of builtInDrivers) {
        if (!merged[d.id]) {
          merged[d.id] = d;
        }
      }
      set({ drivers: merged, loaded: true, loading: false });
    } catch {
      set({ loaded: true, loading: false });
    }
  },

  /** 创建自定义驱动（含文件上传） */
  addDriver: async (driverData, file) => {
    try {
      const driver = await apiCreateDriver(driverData, file);
      set((state) => ({
        drivers: { ...state.drivers, [driver.id]: driver },
      }));
      return driver.id;
    } catch (err) {
      console.error('创建驱动失败:', err);
      return null;
    }
  },

  /** 更新自定义驱动 */
  updateDriver: async (id, data) => {
    const driver = get().drivers[id];
    if (!driver || driver.isBuiltIn) return false;
    try {
      const updated = await updateDriverApi(id, data);
      set((state) => ({
        drivers: { ...state.drivers, [id]: updated },
      }));
      return true;
    } catch (err) {
      console.error('更新驱动失败:', err);
      return false;
    }
  },

  /** 删除自定义驱动 */
  deleteDriver: async (id) => {
    const driver = get().drivers[id];
    if (!driver || driver.isBuiltIn) return;

    try {
      await deleteDriverApi(id);
      set((state) => {
        const { [id]: _, ...rest } = state.drivers;
        return { drivers: rest };
      });
    } catch (err) {
      console.error('删除驱动失败:', err);
    }
  },

  getDriverById: (id) => {
    return get().drivers[id];
  },
}));
