import { apiFetch } from './apiClient';
import type {
  CreateProxyConnectionPayload,
  ProxyAuditLog,
  ProxyAuditResponse,
  ProxyConnection,
  ProxyListResponse,
  ProxyProcessStatus,
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
export async function fetchProxyAudit(
  params: { proxy_connection_id?: string; page?: number; pageSize?: number } = {}
): Promise<ProxyAuditResponse> {
  const qs = new URLSearchParams();
  if (params.proxy_connection_id) qs.set('proxy_connection_id', params.proxy_connection_id);
  if (params.page) qs.set('page', String(params.page));
  if (params.pageSize) qs.set('pageSize', String(params.pageSize));
  const s = qs.toString();
  return request<ProxyAuditResponse>(`/api/proxy/audit${s ? `?${s}` : ''}`);
}

export async function fetchProxyAuditByConnection(id: string): Promise<ProxyAuditLog[]> {
  const r = await request<{ logs: ProxyAuditLog[] }>(`/api/proxy/connections/${id}/audit`);
  return r.logs;
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
