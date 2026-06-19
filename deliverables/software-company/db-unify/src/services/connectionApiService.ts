/**
 * 连接管理 API 服务
 * 统一使用 apiFetch 自动附加 JWT Token
 */
import { apiFetch } from './apiClient';

const API_BASE = '/api/connections';

export interface ConnectionParams {
  name: string;
  driver: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database?: string;
  schema?: string;
  customDriverId?: string;
  /** 关联的服务器资源 ID */
  serverId?: string;
  /** 关联的数据库实例 ID */
  dbInstanceId?: string;
  /** 凭据索引（区分同一实例的多个凭据） */
  credentialIndex?: number;
}

export async function fetchConnections() {
  const response = await apiFetch(API_BASE);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '获取连接列表失败');
  }
  const data = await response.json();
  return data.connections;
}

export async function createConnection(params: ConnectionParams) {
  const response = await apiFetch(API_BASE, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '创建失败' }));
    throw new Error(err.error || '创建连接失败');
  }
  return response.json();
}

export async function updateConnection(id: string, params: Partial<ConnectionParams>) {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '更新失败' }));
    throw new Error(err.error || '更新连接失败');
  }
  return response.json();
}

export async function deleteConnection(id: string) {
  const response = await apiFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '删除失败' }));
    throw new Error(err.error || '删除连接失败');
  }
  return response.json();
}

export async function testConnection(id: string) {
  const response = await apiFetch(`${API_BASE}/${id}/test`, { method: 'POST' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '连接测试失败');
  return data;
}

export async function testConnectionParams(params: ConnectionParams) {
  const response = await apiFetch(`${API_BASE}/test`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '连接测试失败');
  return data;
}

/** 批量导入连接时单条记录 */
export interface BulkImportItem {
  name: string;
  driver: string;
  host: string;
  port: number | string;
  username: string;
  password: string;
  database?: string;
  schema?: string;
  /** 层级：项目（可选） */
  platform?: string;
  /** 层级：业务模块（可选） */
  predb_type?: string;
  /** 层级：区域节点（可选） */
  district?: string;
  /** 层级：连接实例名称（可选，默认用连接名称） */
  hospital_name?: string;
}

/** 批量导入结果 */
export interface BulkImportResult {
  total: number;
  success: number;
  failed: number;
  results: Array<{
    row: number;
    name: string;
    status: 'created' | 'failed';
    id?: string;
    error?: string;
    treePath?: string;
  }>;
}

/** 批量导入数据库连接 */
export async function bulkImportConnections(
  connections: BulkImportItem[]
): Promise<BulkImportResult> {
  const response = await apiFetch(`${API_BASE}/bulk-import`, {
    method: 'POST',
    body: JSON.stringify({ connections }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '批量导入失败');
  return data;
}

/** 下载批量导入模板 CSV */
export async function downloadImportTemplate(): Promise<void> {
  const response = await apiFetch(`${API_BASE}/template`);
  if (!response.ok) throw new Error('下载模板失败');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '数据库连接批量导入模板.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
