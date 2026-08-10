/** 数据库代理网关 — 前端类型定义 */

export type ProxyStatus = 'active' | 'expired' | 'revoked';
export type AuditMode = 'record' | 'intercept';
export type AccessMode = 'readonly' | 'writable';

export interface ProxyConnection {
  id: string;
  name: string;
  db_type: string;
  real_connection_id: string;
  proxy_port: number;
  proxy_username: string;
  has_password: boolean;
  /** 仅在创建成功时返回一次明文密码 */
  proxy_password?: string;
  audit_mode: AuditMode;
  access_mode: AccessMode;
  max_connections: number;
  allowed_ips: string[] | null;
  proxy_port_base: number;
  expires_at: string;
  status: ProxyStatus;
  created_by?: string;
  created_at: string;
  revoked_at?: string | null;
  last_connected_at?: string | null;
}

export interface ProxyAuditLog {
  id: number;
  proxy_connection_id: string;
  proxy_username?: string | null;
  db_type?: string | null;
  real_connection_id?: string | null;
  client_ip?: string | null;
  session_start?: string | null;
  session_end?: string | null;
  sql_text?: string | null;
  sql_type?: string | null;
  affected_rows?: number | null;
  status?: string | null;
  risk_level?: string | null;
  error_message?: string | null;
  executed_at: string;
}

export interface ProxyListeningPort {
  id: string;
  name: string;
  port: number;
  audit_mode: string;
  listening: boolean;
}

export interface ProxyProcessStatus {
  running: boolean;
  pid: number | null;
  started_at: string | null;
  uptime: number;
  logFile?: string;
  listeningPorts: ProxyListeningPort[];
  activeCount: number;
  totalActive: number;
}

export interface ProxyListResponse {
  connections: ProxyConnection[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ProxyAuditResponse {
  logs: ProxyAuditLog[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateProxyConnectionPayload {
  name: string;
  real_connection_id: string;
  db_type: string;
  audit_mode: AuditMode;
  access_mode: AccessMode;
  max_connections: number;
  allowed_ips: string[];
  expires_at: string;
  proxy_port_base?: number;
}
