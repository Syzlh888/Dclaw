/**
 * 树层级 API 服务
 */
const API_BASE = '/api/tree';

export async function fetchTree() {
  const response = await fetch(API_BASE);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '获取树数据失败');
  }
  return response.json();
}

export async function createNode(params: {
  type: 'platform' | 'predb_type' | 'district' | 'hospital';
  parentId: string;
  name: string;
  connectionId?: string;
}) {
  let url: string;
  let body: any = { name: params.name };

  switch (params.type) {
    case 'platform':
      url = `${API_BASE}/platforms`;
      // Platform has no parent, just send name
      break;
    case 'predb_type':
      url = `${API_BASE}/predb-types`;
      body.platform_id = params.parentId;
      break;
    case 'district':
      url = `${API_BASE}/districts`;
      body.predb_type_id = params.parentId;
      break;
    case 'hospital':
      url = `${API_BASE}/hospitals`;
      body.district_id = params.parentId;
      if (params.connectionId) body.connection_id = params.connectionId;
      break;
    default:
      throw new Error('未知节点类型');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '创建失败' }));
    throw new Error(err.error || '创建失败');
  }
  return response.json();
}

export async function updateNode(params: {
  type: 'platform' | 'predb_type' | 'district' | 'hospital';
  id: string;
  name?: string;
  connectionId?: string;
}) {
  let url: string;
  let body: any = {};

  switch (params.type) {
    case 'platform':
      url = `${API_BASE}/platforms/${params.id}`;
      if (params.name) body.name = params.name;
      break;
    case 'predb_type':
      url = `${API_BASE}/predb-types/${params.id}`;
      if (params.name) body.name = params.name;
      break;
    case 'district':
      url = `${API_BASE}/districts/${params.id}`;
      if (params.name) body.name = params.name;
      break;
    case 'hospital':
      url = `${API_BASE}/hospitals/${params.id}`;
      if (params.name !== undefined) body.name = params.name;
      if (params.connectionId !== undefined) body.connection_id = params.connectionId;
      break;
    default:
      throw new Error('未知节点类型');
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '更新失败' }));
    throw new Error(err.error || '更新失败');
  }
  return response.json();
}

export async function deleteNode(params: {
  type: 'platform' | 'predb_type' | 'district' | 'hospital';
  id: string;
}) {
  let url: string;
  switch (params.type) {
    case 'platform':
      url = `${API_BASE}/platforms/${params.id}`;
      break;
    case 'predb_type':
      url = `${API_BASE}/predb-types/${params.id}`;
      break;
    case 'district':
      url = `${API_BASE}/districts/${params.id}`;
      break;
    case 'hospital':
      url = `${API_BASE}/hospitals/${params.id}`;
      break;
    default:
      throw new Error('未知节点类型');
  }

  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '删除失败' }));
    throw new Error(err.error || '删除失败');
  }
  return response.json();
}

export async function fetchTreeConnections() {
  const response = await fetch(`${API_BASE}/connections`);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '获取连接列表失败');
  }
  return response.json();
}

/** 获取所有项目列表（用于级联选择器） */
export async function fetchPlatforms(): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${API_BASE}/platforms-list`);
  if (!response.ok) throw new Error('获取项目列表失败');
  return response.json();
}

/** 获取指定项目下的业务模块列表 */
export async function fetchPredbTypes(platformId: string): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${API_BASE}/predb-types-list?platform_id=${encodeURIComponent(platformId)}`);
  if (!response.ok) throw new Error('获取业务模块列表失败');
  return response.json();
}

/** 获取指定业务模块下的区域节点列表 */
export async function fetchDistricts(predbTypeId: string): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(`${API_BASE}/districts-list?predb_type_id=${encodeURIComponent(predbTypeId)}`);
  if (!response.ok) throw new Error('获取区域节点列表失败');
  return response.json();
}

/** 查找使用指定连接的连接实例及其完整层级路径 */
export async function fetchHospitalByConnection(connectionId: string): Promise<{
  hospital: { id: string; name: string } | null;
  district: { id: string; name: string } | null;
  predbType: { id: string; name: string } | null;
  platform: { id: string; name: string } | null;
} | null> {
  const response = await fetch(`${API_BASE}/hospitals/by-connection/${encodeURIComponent(connectionId)}`);
  if (!response.ok) throw new Error('获取关联连接实例失败');
  return response.json();
}

/** 批量更新同级节点的排序 */
export async function reorderNodes(params: {
  type: 'platform' | 'predb_type' | 'district' | 'hospital';
  ids: string[];
}): Promise<void> {
  const response = await fetch(`${API_BASE}/reorder`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '排序更新失败' }));
    throw new Error(err.error || '排序更新失败');
  }
}
