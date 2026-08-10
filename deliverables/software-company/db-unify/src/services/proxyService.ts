import { apiFetch } from './apiClient';
import type {
  CreateProxyConnectionPayload,
  ProxyAuditLog,
  ProxyAuditResponse,
  ProxyConnection,
  ProxyDangerRule,
  ProxyHealth,
  ProxyListResponse,
  ProxyProcessStatus,
  ProxyStatsResponse,
} from '../types/proxy';

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await apiFetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${response.status})`);
  }
  return data as T;
}

// ========= 代理连接 CRUD =========
export async function fetchProxyConnections(
  params: { page?: number; pageSize?: number; status?: string } = {}
): Promise<ProxyListResponse> {
  const qs = new URLSearchParams();
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  if (params.status) qs.set('status', params.status);
  const s = qs.toString();
  return request<ProxyListResponse>(`/api/proxy/connections${s ? `?${s}` : ''}`);
}

export async function createProxyConnection(
  payload: CreateProxyConnectionPayload
): Promise<ProxyConnection> {
  return request<ProxyConnection>('/api/proxy/connections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function fetchProxyConnection(id: string): Promise<ProxyConnection> {
  const r = await request<{ connection: ProxyConnection }>(`/api/proxy/connections/${id}`);
  return r.connection;
}

export async function updateProxyConnection(
  id: string,
  patch: Partial<CreateProxyConnectionPayload>
): Promise<ProxyConnection> {
  const r = await request<{ connection: ProxyConnection }>(`/api/proxy/connections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return r.connection;
}

export async function revokeProxyConnection(id: string): Promise<ProxyConnection> {
  const r = await request<{ connection: ProxyConnection }>(
    `/api/proxy/connections/${id}/revoke`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
  );
  return r.connection;
}

// ========= 审计 =========
export interface ProxyAuditFilter {
  proxy_connection_id?: string;
  sql_type?: string;
  status?: string;
  start?: string;
  end?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchProxyAudit(
  params: ProxyAuditFilter = {}
): Promise<ProxyAuditResponse> {
  const qs = new URLSearchParams();
  if (params.proxy_connection_id) qs.set('proxy_connection_id', params.proxy_connection_id);
  if (params.sql_type) qs.set('sql_type', params.sql_type);
  if (params.status) qs.set('status', params.status);
  if (params.start) qs.set('start', params.start);
  if (params.end) qs.set('end', params.end);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const s = qs.toString();
  return request<ProxyAuditResponse>(`/api/proxy/audit${s ? `?${s}` : ''}`);
}

export async function fetchProxyAuditByConnection(id: string): Promise<ProxyAuditLog[]> {
  const r = await request<{ logs: ProxyAuditLog[] }>(`/api/proxy/connections/${id}/audit`);
  return r.logs;
}

/**
 * 导出审计记录为 CSV（浏览器下载）。
 * 后端返回 attachment；这里用带鉴权的 fetch 取 blob 再触发下载。
 */
export async function exportProxyAuditCsv(
  params: Omit<ProxyAuditFilter, 'page' | 'pageSize'> = {}
): Promise<void> {
  const qs = new URLSearchParams();
  if (params.proxy_connection_id) qs.set('proxy_connection_id', params.proxy_connection_id);
  if (params.sql_type) qs.set('sql_type', params.sql_type);
  if (params.status) qs.set('status', params.status);
  if (params.start) qs.set('start', params.start);
  if (params.end) qs.set('end', params.end);
  const s = qs.toString();
  let url: string | null = null;
  try {
    const response = await apiFetch(`/api/proxy/audit/export${s ? `?${s}` : ''}`);
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error((data as { error?: string }).error || `导出失败 (${response.status})`);
    }
    const blob = await response.blob();
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proxy-audit-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // revoke 必须在 click 后异步执行；放 finally 防止 leak
    if (url) setTimeout(() => URL.revokeObjectURL(url as string), 0);
  }
}

// ========= 进程生命周期 =========
export async function fetchProxyProcessStatus(): Promise<ProxyProcessStatus> {
  return request<ProxyProcessStatus>('/api/proxy/process/status');
}

export async function startProxyProcess(): Promise<ProxyProcessStatus> {
  return request<ProxyProcessStatus>('/api/proxy/process/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export async function stopProxyProcess(): Promise<ProxyProcessStatus> {
  return request<ProxyProcessStatus>('/api/proxy/process/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export async function restartProxyProcess(): Promise<ProxyProcessStatus> {
  return request<ProxyProcessStatus>('/api/proxy/process/restart', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

// ========= 健康检查 =========
export async function fetchProxyHealth(id: string): Promise<ProxyHealth> {
  return request<ProxyHealth>(`/api/proxy/connections/${id}/health`);
}

export async function triggerProxyHealthCheck(id: string): Promise<{ id: string; ok: boolean; errMsg: string | null }> {
  return request<{ id: string; ok: boolean; errMsg: string | null }>(
    `/api/proxy/connections/${id}/health`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }
  );
}

export async function fetchProxyHealthAll(): Promise<{ connections: ProxyHealth[] }> {
  return request<{ connections: ProxyHealth[] }>('/api/proxy/health/all');
}

// ========= 统计 =========
export async function fetchProxyStats(params: { from?: string; to?: string; connection_id?: string } = {}): Promise<ProxyStatsResponse> {
  const qs = new URLSearchParams();
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  if (params.connection_id) qs.set('connection_id', params.connection_id);
  const s = qs.toString();
  return request<ProxyStatsResponse>(`/api/proxy/stats${s ? `?${s}` : ''}`);
}

// ========= 危险SQL规则 =========
export async function fetchProxyRules(): Promise<{ rules: ProxyDangerRule[] }> {
  return request<{ rules: ProxyDangerRule[] }>('/api/proxy/rules');
}

export interface ProxyRulePayload {
  keyword: string;
  risk_level: 'low' | 'medium' | 'high';
  action: 'block' | 'warn';
  enabled: boolean;
  sort_order: number;
  description?: string;
}

export async function createProxyRule(payload: ProxyRulePayload): Promise<{ rule: ProxyDangerRule }> {
  return request<{ rule: ProxyDangerRule }>('/api/proxy/rules', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function updateProxyRule(id: string, patch: Partial<ProxyRulePayload>): Promise<{ rule: ProxyDangerRule }> {
  return request<{ rule: ProxyDangerRule }>(`/api/proxy/rules/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function toggleProxyRule(id: string): Promise<{ rule: ProxyDangerRule }> {
  return request<{ rule: ProxyDangerRule }>(`/api/proxy/rules/${id}/toggle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

export async function deleteProxyRule(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/proxy/rules/${id}`, { method: 'DELETE' });
}

// ========= 审计清理 =========
export async function runProxyAuditCleanup(): Promise<{ success: boolean; deleted?: number; before?: number; after?: number }> {
  return request('/api/proxy/audit/cleanup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}
