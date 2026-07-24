/**
 * 数据库角色管理与表/视图 CRUD API 服务
 */
import { apiFetch } from './apiClient';

// ===================================================================
//  角色管理
// ===================================================================

export interface RoleInfo {
  role_name: string;
  super_user?: boolean | string;
  can_login?: boolean | string;
  can_create_db?: boolean | string;
  can_create_role?: boolean | string;
  can_inherit?: boolean | string;
  [key: string]: any;
}

export interface GrantInfo {
  grantStatement?: string;
  grantee?: string;
  table_schema?: string;
  table_name?: string;
  privilege_type?: string;
  is_grantable?: string;
  [key: string]: any;
}

/** 获取角色列表 */
export async function fetchRoles(connectionId: string): Promise<RoleInfo[]> {
  const res = await apiFetch(`/api/connection/${connectionId}/roles`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取角色列表失败' }));
    throw new Error(err.error || '获取角色列表失败');
  }
  const data = await res.json();
  return data.roles || [];
}

/** 创建角色 */
export async function createRole(
  connectionId: string,
  params: { roleName: string; password?: string; canLogin?: boolean; superUser?: boolean; host?: string }
): Promise<void> {
  const res = await apiFetch(`/api/connection/${connectionId}/roles`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '创建角色失败' }));
    throw new Error(err.error || '创建角色失败');
  }
}

/** 修改角色 */
export async function updateRole(
  connectionId: string,
  roleName: string,
  params: { newPassword?: string; canLogin?: boolean; superUser?: boolean; host?: string }
): Promise<void> {
  const res = await apiFetch(`/api/connection/${connectionId}/roles/${encodeURIComponent(roleName)}`, {
    method: 'PUT',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '修改角色失败' }));
    throw new Error(err.error || '修改角色失败');
  }
}

/** 删除角色 */
export async function deleteRole(
  connectionId: string,
  roleName: string,
  host?: string
): Promise<void> {
  const query = host ? `?host=${encodeURIComponent(host)}` : '';
  const res = await apiFetch(`/api/connection/${connectionId}/roles/${encodeURIComponent(roleName)}${query}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '删除角色失败' }));
    throw new Error(err.error || '删除角色失败');
  }
}

/** 获取角色权限 */
export async function fetchRoleGrants(connectionId: string, roleName: string, host?: string): Promise<GrantInfo[]> {
  const query = host ? `?host=${encodeURIComponent(host)}` : '';
  const res = await apiFetch(`/api/connection/${connectionId}/roles/${encodeURIComponent(roleName)}/grants${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取权限列表失败' }));
    throw new Error(err.error || '获取权限列表失败');
  }
  const data = await res.json();
  return data.grants || [];
}

/** 授予权限 */
export async function grantPrivilege(
  connectionId: string,
  roleName: string,
  params: { privilege: string; table?: string; schema?: string; host?: string }
): Promise<void> {
  const res = await apiFetch(`/api/connection/${connectionId}/roles/${encodeURIComponent(roleName)}/grants`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '授予权限失败' }));
    throw new Error(err.error || '授予权限失败');
  }
}

/** 撤销权限 */
export async function revokePrivilege(
  connectionId: string,
  roleName: string,
  params: { privilege: string; table?: string; schema?: string; host?: string }
): Promise<void> {
  const res = await apiFetch(`/api/connection/${connectionId}/roles/${encodeURIComponent(roleName)}/grants`, {
    method: 'DELETE',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '撤销权限失败' }));
    throw new Error(err.error || '撤销权限失败');
  }
}

/** 批量授予权限 */
export async function batchGrantPrivilege(
  connectionId: string,
  roleName: string,
  params: { privilege: string; tables: string[]; schema?: string; host?: string }
): Promise<{ success: number; fail: number }> {
  const res = await apiFetch(`/api/connection/${connectionId}/roles/${encodeURIComponent(roleName)}/grants/batch`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '批量授予权限失败' }));
    throw new Error(err.error || '批量授予权限失败');
  }
  const data = await res.json();
  return { success: data.success || 0, fail: data.fail || 0 };
}

// ===================================================================
//  表/视图 CRUD
// ===================================================================

export interface ColumnDef {
  name: string;
  type: string;
  length?: number;
  nullable?: boolean;
  primaryKey?: boolean;
  autoIncrement?: boolean;
  defaultValue?: string;
  comment?: string;
}

/** 创建表 */
export async function createTable(
  connectionId: string,
  params: {
    tableName: string;
    columns: ColumnDef[];
    schema?: string;
    comment?: string;
  }
): Promise<void> {
  const res = await apiFetch(`/api/connection/${connectionId}/tables`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '创建表失败' }));
    throw new Error(err.error || '创建表失败');
  }
}

/** 删除表 */
export async function deleteTable(
  connectionId: string,
  tableName: string,
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(`/api/connection/${connectionId}/tables/${encodeURIComponent(tableName)}${query}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '删除表失败' }));
    throw new Error(err.error || '删除表失败');
  }
}

/** 添加列 */
export async function addColumn(
  connectionId: string,
  tableName: string,
  column: ColumnDef,
  after?: string,
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(
    `/api/connection/${connectionId}/tables/${encodeURIComponent(tableName)}/columns${query}`,
    {
      method: 'POST',
      body: JSON.stringify({ column, after }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '添加列失败' }));
    throw new Error(err.error || '添加列失败');
  }
}

/** 修改列 */
export async function updateColumn(
  connectionId: string,
  tableName: string,
  columnName: string,
  params: {
    newName?: string;
    type?: string;
    nullable?: boolean;
    defaultValue?: string;
    comment?: string;
  },
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(
    `/api/connection/${connectionId}/tables/${encodeURIComponent(tableName)}/columns/${encodeURIComponent(columnName)}${query}`,
    {
      method: 'PUT',
      body: JSON.stringify(params),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '修改列失败' }));
    throw new Error(err.error || '修改列失败');
  }
}

/** 删除列 */
export async function deleteColumn(
  connectionId: string,
  tableName: string,
  columnName: string,
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(
    `/api/connection/${connectionId}/tables/${encodeURIComponent(tableName)}/columns/${encodeURIComponent(columnName)}${query}`,
    {
      method: 'DELETE',
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '删除列失败' }));
    throw new Error(err.error || '删除列失败');
  }
}

/** 创建视图 */
export async function createView(
  connectionId: string,
  params: {
    viewName: string;
    asSql: string;
    schema?: string;
    comment?: string;
  }
): Promise<void> {
  const res = await apiFetch(`/api/connection/${connectionId}/views`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '创建视图失败' }));
    throw new Error(err.error || '创建视图失败');
  }
}

/** 修改视图 */
export async function updateView(
  connectionId: string,
  viewName: string,
  params: { asSql?: string; comment?: string },
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(
    `/api/connection/${connectionId}/views/${encodeURIComponent(viewName)}${query}`,
    {
      method: 'PUT',
      body: JSON.stringify(params),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '修改视图失败' }));
    throw new Error(err.error || '修改视图失败');
  }
}

/** 获取视图 DDL */
export async function fetchViewDdl(connectionId: string, viewName: string, schema?: string): Promise<string> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(`/api/connection/${connectionId}/views/${encodeURIComponent(viewName)}/ddl${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取视图 DDL 失败' }));
    throw new Error(err.error || '获取视图 DDL 失败');
  }
  const data = await res.json();
  return data.ddl || '';
}

/** 删除视图 */
export async function deleteView(
  connectionId: string,
  viewName: string,
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(
    `/api/connection/${connectionId}/views/${encodeURIComponent(viewName)}${query}`,
    {
      method: 'DELETE',
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '删除视图失败' }));
    throw new Error(err.error || '删除视图失败');
  }
}
