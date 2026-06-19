export enum DbDriver {
  MySQL = 'mysql',
  PostgreSQL = 'postgresql',
  Oracle = 'oracle',
  SQLServer = 'sqlserver',
  Custom = 'custom',
}

export enum ConnectionStatus {
  Online = 'online',
  Offline = 'offline',
  Error = 'error',
}

export interface DbConnection {
  id: string;
  name: string;
  driver: DbDriver;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  status: ConnectionStatus;
  /** 当 driver 为 Custom 时关联自定义驱动 ID */
  customDriverId?: string;
  /** 数据库模式/Schema */
  schema?: string;
  /** 关联的服务器资源 ID */
  serverId?: string;
  /** 关联的数据库实例 ID */
  dbInstanceId?: string;
  /** 凭据索引（区分同一实例的多个凭据） */
  credentialIndex?: number;
}
