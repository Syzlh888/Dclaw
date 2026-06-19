/**
 * SQL 脚本管理服务
 * 与后端 /api/scripts 接口交互
 */
import type { SqlScript } from '../types/script';

const API_BASE = '/api/scripts';

/** 获取脚本列表（不含 sql_text） */
export async function fetchScripts(): Promise<SqlScript[]> {
  const res = await fetch(API_BASE);
  if (!res.ok) throw new Error('获取脚本列表失败');
  const data = await res.json();
  return data.scripts || [];
}

/** 获取单个脚本详情（含 sql_text） */
export async function fetchScript(id: string): Promise<SqlScript> {
  const res = await fetch(`${API_BASE}/${id}`);
  if (!res.ok) throw new Error('获取脚本失败');
  return res.json();
}

/** 保存新脚本 */
export async function saveScript(params: {
  name: string;
  description?: string;
  sql_text: string;
}): Promise<SqlScript> {
  const res = await fetch(API_BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '保存脚本失败');
  }
  return res.json();
}

/** 更新已有脚本 */
export async function updateScript(
  id: string,
  params: { name?: string; description?: string; sql_text?: string }
): Promise<SqlScript> {
  const res = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '更新脚本失败');
  }
  return res.json();
}

/** 删除脚本 */
export async function deleteScript(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || '删除脚本失败');
  }
}
