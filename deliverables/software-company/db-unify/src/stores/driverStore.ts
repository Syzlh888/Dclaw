import { create } from 'zustand';
import type { DriverPackage } from '../types/driver';
import { fetchDrivers, createDriver as apiCreateDriver, updateDriverApi, deleteDriverApi, downloadDriverApi, uninstallDriverApi, uploadBuiltinJarApi } from '../services/driverService';

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
  /** 在线下载内置驱动 */
  downloadDriver: (driverId: string) => Promise<boolean>;
  /** 为内置驱动手动上传 JAR 文件 */
  uploadBuiltinJar: (driverId: string, file: File, metadata: { name: string; version: string; driverClass: string }) => Promise<boolean>;
  /** 卸载驱动（移除 JAR 文件） */
  uninstallDriver: (id: string) => Promise<boolean>;
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
    downloadUrl: 'https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.0.33/mysql-connector-j-8.0.33.jar',
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
    downloadUrl: 'https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.1/postgresql-42.7.1.jar',
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
  {
    id: 'sqlserver-builtin',
    name: 'SQL Server',
    version: '12.4.2',
    driverClass: 'com.microsoft.sqlserver.jdbc.SQLServerDriver',
    fileName: 'mssql-jdbc-12.4.2.jre11.jar',
    fileSize: 1200000,
    uploadTime: new Date().toISOString(),
    dbType: 'sqlserver',
    isBuiltIn: true,
    downloadUrl: 'https://repo1.maven.org/maven2/com/microsoft/sqlserver/mssql-jdbc/12.4.2.jre11/mssql-jdbc-12.4.2.jre11.jar',
  },
  {
    id: 'mariadb-builtin',
    name: 'MariaDB',
    version: '3.3.2',
    driverClass: 'org.mariadb.jdbc.Driver',
    fileName: 'mariadb-java-client-3.3.2.jar',
    fileSize: 800000,
    uploadTime: new Date().toISOString(),
    dbType: 'mariadb',
    isBuiltIn: true,
    downloadUrl: 'https://repo1.maven.org/maven2/org/mariadb/jdbc/mariadb-java-client/3.3.2/mariadb-java-client-3.3.2.jar',
  },
  {
    id: 'sqlite-builtin',
    name: 'SQLite',
    version: '3.44.1.0',
    driverClass: 'org.sqlite.JDBC',
    fileName: 'sqlite-jdbc-3.44.1.0.jar',
    fileSize: 1000000,
    uploadTime: new Date().toISOString(),
    dbType: 'sqlite',
    isBuiltIn: true,
    downloadUrl: 'https://repo1.maven.org/maven2/org/xerial/sqlite-jdbc/3.44.1.0/sqlite-jdbc-3.44.1.0.jar',
  },
  {
    id: 'highgo-builtin',
    name: 'HighGo (瀚高)',
    version: '6.2.4',
    driverClass: 'com.highgo.jdbc.Driver',
    fileName: 'HgdbJdbc-6.2.4.jar',
    fileSize: 2000000,
    uploadTime: new Date().toISOString(),
    dbType: 'highgo',
    isBuiltIn: true,
  },
  {
    id: 'kingbase-builtin',
    name: 'Kingbase (金仓)',
    version: '8.6.0',
    driverClass: 'com.kingbase8.Driver',
    fileName: 'kingbase8-8.6.0.jar',
    fileSize: 3000000,
    uploadTime: new Date().toISOString(),
    dbType: 'kingbase',
    isBuiltIn: true,
  },
  {
    id: 'dameng-builtin',
    name: 'Dameng (达梦)',
    version: '8.1',
    driverClass: 'dm.jdbc.driver.DmDriver',
    fileName: 'DmJdbcDriver-8.1.jar',
    fileSize: 3000000,
    uploadTime: new Date().toISOString(),
    dbType: 'dameng',
    isBuiltIn: true,
  },
  {
    id: 'db2-builtin',
    name: 'DB2',
    version: '4.0.0',
    driverClass: 'com.ibm.db2.jcc.DB2Driver',
    fileName: 'db2jcc-4.0.0.jar',
    fileSize: 3500000,
    uploadTime: new Date().toISOString(),
    dbType: 'db2',
    isBuiltIn: true,
    downloadUrl: 'https://repo1.maven.org/maven2/com/ibm/db2/jcc/db2jcc/db2jcc4/db2jcc-4.0.0.jar',
  },
  {
    id: 'h2-builtin',
    name: 'H2',
    version: '2.2.224',
    driverClass: 'org.h2.Driver',
    fileName: 'h2-2.2.224.jar',
    fileSize: 2500000,
    uploadTime: new Date().toISOString(),
    dbType: 'h2',
    isBuiltIn: true,
    downloadUrl: 'https://repo1.maven.org/maven2/com/h2database/h2/2.2.224/h2-2.2.224.jar',
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

  /** 在线下载内置驱动 */
  downloadDriver: async (driverId) => {
    try {
      const result = await downloadDriverApi(driverId);
      // 更新 store 中该驱动的状态
      set((state) => {
        const driver = state.drivers[driverId];
        if (!driver) return state;
        return {
          drivers: {
            ...state.drivers,
            [driverId]: { ...driver, fileSize: result.fileSize, downloaded: true },
          },
        };
      });
      return true;
    } catch (err) {
      console.error('下载驱动失败:', err);
      return false;
    }
  },

  /** 为内置驱动手动上传 JAR 文件 */
  uploadBuiltinJar: async (driverId, file, metadata) => {
    try {
      const result = await uploadBuiltinJarApi(driverId, file, metadata);
      set((state) => {
        const driver = state.drivers[driverId];
        if (!driver) return state;
        return {
          drivers: {
            ...state.drivers,
            [driverId]: { ...driver, fileName: result.fileName, fileSize: result.fileSize, downloaded: true, name: metadata.name, version: metadata.version, driverClass: metadata.driverClass },
          },
        };
      });
      return true;
    } catch (err) {
      console.error('上传内置驱动 JAR 失败:', err);
      return false;
    }
  },

  /** 卸载驱动（移除 JAR 文件，保留驱动记录） */
  uninstallDriver: async (id) => {
    try {
      await uninstallDriverApi(id);
      // 更新 store 中该驱动的状态
      set((state) => {
        const driver = state.drivers[id];
        if (!driver) return state;
        return {
          drivers: {
            ...state.drivers,
            [id]: { ...driver, fileSize: 0, downloaded: false },
          },
        };
      });
      return true;
    } catch (err) {
      console.error('卸载驱动失败:', err);
      return false;
    }
  },
}));
