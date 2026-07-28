/**
 * 数据库函数/存储过程管理 API 服务
 */
import { apiFetch } from './apiClient';

// ===================================================================
//  函数管理
// ===================================================================

export interface FunctionInfo {
  name: string;
  type: string;  // 'FUNCTION'
  schema: string;
  returnType: string;
  definition: string;
  comment: string;
}

export interface FunctionArg {
  name: string;
  mode: 'IN' | 'OUT' | 'INOUT';
  type: string;
  length?: number;
  position: number;
}

export interface FunctionDetail extends FunctionInfo {
  args: FunctionArg[];
}

/**
 * 获取函数列表
 */
export async function fetchFunctions(connectionId: string, schema?: string): Promise<FunctionInfo[]> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(`/api/connections/${connectionId}/functions${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取函数列表失败' }));
    throw new Error(err.error || '获取函数列表失败');
  }
  const data = await res.json();
  return data.functions || [];
}

/**
 * 获取函数详情
 */
export async function fetchFunctionDetail(
  connectionId: string,
  funcName: string,
  schema?: string
): Promise<{ function: FunctionDetail; args: FunctionArg[] }> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(`/api/connections/${connectionId}/functions/${encodeURIComponent(funcName)}${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取函数详情失败' }));
    throw new Error(err.error || '获取函数详情失败');
  }
  const data = await res.json();
  return { 
    function: { ...data.function, args: data.args || [] }, 
    args: data.args || [] 
  };
}

/**
 * 获取函数 DDL
 */
export async function fetchFunctionDdl(
  connectionId: string,
  funcName: string,
  schema?: string
): Promise<string> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(`/api/connections/${connectionId}/functions/${encodeURIComponent(funcName)}/ddl${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取函数 DDL 失败' }));
    throw new Error(err.error || '获取函数 DDL 失败');
  }
  const data = await res.json();
  return data.ddl || '';
}

/**
 * 删除函数
 */
export async function deleteFunction(
  connectionId: string,
  funcName: string,
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(
    `/api/connections/${connectionId}/functions/${encodeURIComponent(funcName)}${query}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '删除函数失败' }));
    throw new Error(err.error || '删除函数失败');
  }
}

// ===================================================================
//  存储过程管理
// ===================================================================

export interface ProcedureInfo {
  name: string;
  type: string;  // 'PROCEDURE'
  schema: string;
  definition: string;
  comment: string;
}

export interface ProcedureDetail extends ProcedureInfo {
  args: FunctionArg[];
}

/**
 * 获取存储过程列表
 */
export async function fetchProcedures(connectionId: string, schema?: string): Promise<ProcedureInfo[]> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(`/api/connections/${connectionId}/procedures${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取存储过程列表失败' }));
    throw new Error(err.error || '获取存储过程列表失败');
  }
  const data = await res.json();
  return data.procedures || [];
}

/**
 * 获取存储过程详情
 */
export async function fetchProcedureDetail(
  connectionId: string,
  procName: string,
  schema?: string
): Promise<{ procedure: ProcedureDetail; args: FunctionArg[] }> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(`/api/connections/${connectionId}/procedures/${encodeURIComponent(procName)}${query}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '获取存储过程详情失败' }));
    throw new Error(err.error || '获取存储过程详情失败');
  }
  const data = await res.json();
  return { 
    procedure: { ...data.procedure, args: data.args || [] }, 
    args: data.args || [] 
  };
}

/**
 * 删除存储过程
 */
export async function deleteProcedure(
  connectionId: string,
  procName: string,
  schema?: string
): Promise<void> {
  const query = schema ? `?schema=${encodeURIComponent(schema)}` : '';
  const res = await apiFetch(
    `/api/connections/${connectionId}/procedures/${encodeURIComponent(procName)}${query}`,
    { method: 'DELETE' }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '删除存储过程失败' }));
    throw new Error(err.error || '删除存储过程失败');
  }
}
