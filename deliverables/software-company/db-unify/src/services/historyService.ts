import type { ExecutionHistory, ExecutionHistoryDetail } from '../types/history';

const API_BASE = '/api/history';

/** 获取执行历史列表 */
export async function fetchHistory(): Promise<ExecutionHistory[]> {
  const res = await fetch(API_BASE);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '获取历史记录失败');
  }
  const data = await res.json();
  return data.history || [];
}

/** 获取单次执行详情（含任务列表） */
export async function fetchHistoryDetail(id: string): Promise<ExecutionHistoryDetail> {
  const res = await fetch(`${API_BASE}/${id}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '获取历史详情失败');
  }
  return res.json();
}

/** 删除单条执行历史 */
export async function deleteHistory(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '删除历史记录失败');
  }
}

/** 批量删除执行历史 */
export async function deleteHistoryBatch(ids: string[]): Promise<{ deletedCount: number }> {
  const res = await fetch(`${API_BASE}/batch`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '批量删除失败');
  }
  return res.json();
}

/** 清空全部执行历史 */
export async function clearHistory(): Promise<void> {
  const res = await fetch(API_BASE, { method: 'DELETE' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '清空历史记录失败');
  }
}

/** 获取自动清理配置 */
export async function fetchCleanupConfig(): Promise<{ enabled: boolean; retentionDays: number }> {
  const res = await fetch(`${API_BASE}/cleanup-config`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '获取清理配置失败');
  }
  return res.json();
}

/** 更新自动清理配置（开启/关闭） */
export async function updateCleanupConfig(enabled: boolean): Promise<void> {
  const res = await fetch(`${API_BASE}/cleanup-config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '请求失败' }));
    throw new Error(err.error || '更新清理配置失败');
  }
}
