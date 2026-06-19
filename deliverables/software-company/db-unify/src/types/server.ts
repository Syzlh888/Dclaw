/** 项目（最顶层） */
export interface Project {
  id: string;
  name: string;
  shortName?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 工程字典（属于某个项目） */
export interface Engineering {
  id: string;
  projectId: string;
  name: string;
  shortName?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 应用字典（属于某个工程） */
export interface Application {
  id: string;
  engineeringId: string;
  name: string;
  shortName?: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 端口信息（服务器子资源） */
export interface PortInfo {
  id: string;
  serverId: string;
  port: number;
  protocol: 'TCP' | 'UDP' | 'HTTP' | 'HTTPS' | 'Other';
  type?: string;
  serviceName: string;
  notes?: string;
}

/** 数据库实例（服务器子资源） */
export interface DbInstance {
  id: string;
  serverId: string;
  dbType: string;
  version?: string;
  dbName: string;
  schema?: string;
  username?: string;
  password?: string;
  credentials?: ServerCredential[];
  internalIp?: string;
  externalIp?: string;
  port: number;
  notes?: string;
}

/** 应用实例（服务器子资源） */
export interface AppInstance {
  id: string;
  serverId: string;
  name: string;
  port?: number;
  contactPerson?: string;
  contactPhone?: string;
  url: string;
  username?: string;
  password?: string;
  credentials?: ServerCredential[];
  notes?: string;
}

/** API 实例（服务器子资源） */
export interface ApiInstance {
  id: string;
  serverId: string;
  apiAddress: string;
  port?: number;
  applicationName: string;
  encrypted: boolean;
  encryptionMethod: string;
  requestExample?: string;
  responseExample?: string;
  notes?: string;
}

/** 中间件实例（服务器子资源） */
export interface MiddlewareInstance {
  id: string;
  serverId: string;
  name: string;
  port?: number;
  type: string;
  version?: string;
  url?: string;
  serviceApp?: string;
  username?: string;
  password?: string;
  credentials?: ServerCredential[];
  notes?: string;
}

/** IP 地址条目 */
export interface IpEntry {
  ip: string;
  type: '局域' | '政务外' | '政务内' | '互联网';
  port?: number;
  mappedIp?: string;
}

/** 凭据条目（用户名密码对） */
export interface ServerCredential {
  username: string;
  password: string;
  schema?: string;
  region?: string;
  connectionName?: string;
  notes?: string;
}

/** 关联访问条目 */
export interface AccessLinkage {
  type: string;
  address: string;
  user: string;
}

/** 服务器主机（核心实体，属于某个应用） */
export interface ServerHost {
  id: string;
  projectId?: string;
  engineeringId?: string;
  applicationId?: string;
  name: string;
  ips: IpEntry[];
  internalIp: string;
  externalIp?: string;
  publicIp?: string;
  crossNetworkIp?: string;
  os?: string;
  cpuCores?: number;
  memoryGB?: number;
  systemDiskGB?: number;
  dataDiskGB?: number;
  storageType?: string;
  bandwidthMbps?: number;
  serverLocation?: string;
  serverType?: string;
  username?: string;
  password?: string;
  credentials?: ServerCredential[];
  bastionHost?: string;
  bastionPort?: number;
  bastionUsername?: string;
  bastionPassword?: string;
  vpnInfo?: string;
  macAddress?: string;
  tags?: string[];
  notes?: string;
  deployedContent?: string;
  accessList?: AccessLinkage[];
  linkedConnectionIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** 密码修改历史 */
export interface PasswordHistory {
  id: string;
  serverId: string;
  fieldName: string;
  changedAt: string;
  changedBy: string;
}

/** 访问管理条目（VPN/堡垒机），支持多用户凭据 */
export interface AccessEntry {
  id: string;
  type: 'VPN' | '堡垒机';
  address: string;
  provider: string;
  username?: string;
  password?: string;
  credentials?: ServerCredential[];
  notes: string;
}

/** 系统配置（二次验证密码等） */
export interface SystemConfig {
  secondaryPasswordHash?: string;
}

/** 密码生成配置 */
export interface PasswordGenConfig {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  numbers: boolean;
  symbols: boolean;
}

/** 服务器搜索条件 */
export interface ServerSearchFilter {
  keyword?: string;
  ip?: string;
  os?: string;
  projectId?: string;
  engineeringId?: string;
  applicationId?: string;
  tags?: string[];
}

/** 资产汇总数据 */
export interface AssetSummary {
  totalServers: number;
  totalDbInstances: number;
  totalAppInstances: number;
  osDistribution: { name: string; count: number }[];
  resourceDistribution: {
    label: string;
    cpuCores: number;
    memoryGB: number;
    count: number;
  }[];
  serverTypeDistribution: { name: string; count: number }[];
}
