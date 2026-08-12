/**
 * API 服务 - 前端 service 层
 *
 * 通过 /api/api-service/* 调用管理端接口（需登录 JWT）
 * 调用流程在 server/routes/api-service.mjs 中定义
 */
import { apiFetch } from './apiClient';

const BASE = '/api/api-service';

// ============================================================
// Types
// ============================================================
export interface ApiParam {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date';
  required: boolean;
  label?: string;
}

export interface ApiEndpoint {
  id: string;
  name: string;
  description: string;
  type: 'sql' | 'table';
  connection_id: string;
  schema_name?: string;
  table_name?: string;
  sql_text?: string;
  params: ApiParam[];
  page_size_max: number;
  mask_fields: string[];
  status: 'active' | 'disabled';
  created_by?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ApiToken {
  id: string;
  scope: 'all' | 'select';
  endpoint_ids: string[];
  name: string;
  ip_whitelist: string[];
  qps_limit: number;
  daily_limit: number;
  expires_at: string | null;
  status: 'active' | 'disabled';
  created_by?: string;
  created_at?: string;
  last_used_at?: string | null;
  has_token?: boolean;
}

export interface ApiCallLog {
  id: number;
  endpoint_id: string;
  token_id: string | null;
  ip: string | null;
  params_hash: string | null;
  status_code: number;
  error_msg: string | null;
  duration_ms: number | null;
  called_at: string;
}

export interface ApiTableInfo {
  name: string;
  schema?: string;
  type?: string;
  [k: string]: unknown;
}

export interface ApiColumnInfo {
  name: string;
  type: string;
}

// ============================================================
// Endpoints
// ============================================================
export async function listEndpoints(): Promise<ApiEndpoint[]> {
  const r = await apiFetch(`${BASE}/endpoints`);
  const j = await r.json();
  return j.endpoints || [];
}

export async function createEndpoint(ep: Partial<ApiEndpoint>): Promise<ApiEndpoint> {
  const r = await apiFetch(`${BASE}/endpoints`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ep),
  });
  if (!r.ok) throw new Error((await r.json()).error || '创建失败');
  const j = await r.json();
  return j.endpoint;
}

export async function updateEndpoint(id: string, ep: Partial<ApiEndpoint>): Promise<ApiEndpoint> {
  const r = await apiFetch(`${BASE}/endpoints/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ep),
  });
  if (!r.ok) throw new Error((await r.json()).error || '更新失败');
  const j = await r.json();
  return j.endpoint;
}

export async function deleteEndpoint(id: string): Promise<void> {
  const r = await apiFetch(`${BASE}/endpoints/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json()).error || '删除失败');
}

export async function testEndpoint(
  id: string,
  payload: { params?: Record<string, unknown>; page?: number; pageSize?: number }
): Promise<{ success: boolean; data?: unknown[]; columns?: string[]; error?: string; bounded_sql?: string; bound_params?: unknown[]; duration_ms?: number; total_returned?: number }> {
  const r = await apiFetch(`${BASE}/endpoints/${id}/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  if (!r.ok) {
    return { success: false, error: j.error || '测试失败' };
  }
  return { success: true, ...j };
}

// ============================================================
// Tokens
// ============================================================
export async function listTokens(): Promise<ApiToken[]> {
  const r = await apiFetch(`${BASE}/tokens`);
  const j = await r.json();
  return j.tokens || [];
}

export async function listEndpointTokens(epId: string): Promise<ApiToken[]> {
  const r = await apiFetch(`${BASE}/endpoints/${epId}/tokens`);
  const j = await r.json();
  return j.tokens || [];
}

export async function createToken(payload: {
  name?: string;
  scope: 'all' | 'select';
  endpoint_ids?: string[];
  ip_whitelist?: string[];
  qps_limit?: number;
  daily_limit?: number;
  expires_at?: string | null;
}): Promise<{ token: ApiToken; plaintext: string; reminder: string }> {
  const r = await apiFetch(`${BASE}/tokens`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error((await r.json()).error || '创建 Token 失败');
  return r.json();
}

export async function updateToken(id: string, payload: Partial<ApiToken>): Promise<ApiToken> {
  const r = await apiFetch(`${BASE}/tokens/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error((await r.json()).error || '更新失败');
  const j = await r.json();
  return j.token;
}

export async function deleteToken(id: string): Promise<void> {
  const r = await apiFetch(`${BASE}/tokens/${id}`, { method: 'DELETE' });
  if (!r.ok) throw new Error((await r.json()).error || '删除失败');
}

// ============================================================
// Logs
// ============================================================
export async function listEndpointLogs(
  epId: string,
  opts: { page?: number; pageSize?: number; token_id?: string; status_code?: number } = {}
): Promise<{ logs: ApiCallLog[]; total: number; page: number; pageSize: number }> {
  const params = new URLSearchParams();
  if (opts.page) params.set('page', String(opts.page));
  if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
  if (opts.token_id) params.set('token_id', opts.token_id);
  if (opts.status_code !== undefined && opts.status_code !== null && opts.status_code !== undefined) {
    params.set('status_code', String(opts.status_code));
  }
  const qs = params.toString();
  const r = await apiFetch(`${BASE}/endpoints/${epId}/logs${qs ? `?${qs}` : ''}`);
  return r.json();
}

// ============================================================
// 表 / 列发现（给 EndpointDialog 选表用）
// ============================================================
export async function listConnectionTables(
  connId: string,
  schema?: string
): Promise<ApiTableInfo[]> {
  const qs = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const r = await apiFetch(`${BASE}/connections/${connId}/tables${qs}`);
  if (!r.ok) throw new Error((await r.json()).error || '取表失败');
  const j = await r.json();
  return j.tables || [];
}

export async function listConnectionColumns(
  connId: string,
  table: string,
  schema?: string
): Promise<ApiColumnInfo[]> {
  const params = new URLSearchParams({ table });
  if (schema) params.set('schema', schema);
  const r = await apiFetch(`${BASE}/connections/${connId}/columns?${params.toString()}`);
  if (!r.ok) throw new Error((await r.json()).error || '取列失败');
  const j = await r.json();
  return j.columns || [];
}