/** 数据库代理网关 — 前端类型定义 */

export type ProxyStatus = 'active' | 'expired' | 'revoked';
export type AuditMode = 'record' | 'intercept';
export type AccessMode = 'readonly' | 'writable';
export type HealthStatus = 'ok' | 'fail' | 'unknown';

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
  /** 健康检查状态 */
  health_status?: HealthStatus;
  last_health_check_at?: string | null;
  last_error?: string | null;
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

export interface ProxyHealth {
  id: string;
  name: string;
  port: number;
  status: ProxyStatus;
  health_status: HealthStatus;
  last_health_check_at: string | null;
  last_error: string | null;
}

export interface ProxyStats {
  id: string;
  name: string;
  port: number;
  status: ProxyStatus;
  db_type: string;
  last_connected_at: string | null;
  audit_count: number;
  success_count: number;
  failed_count: number;
  blocked_count: number;
  distinct_client_ips: number;
  last_activity_at: string | null;
  success_rate: number | null;
}

export interface ProxyStatsResponse {
  from: string;
  to: string;
  stats: ProxyStats[];
}

export type DangerAction = 'block' | 'warn';
export type DangerRiskLevel = 'low' | 'medium' | 'high';

export interface ProxyDangerRule {
  id: string;
  keyword: string;
  risk_level: DangerRiskLevel;
  action: DangerAction;
  enabled: boolean;
  sort_order: number;
  description?: string | null;
  created_at: string;
  updated_at?: string | null;
}
