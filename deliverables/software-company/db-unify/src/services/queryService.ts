/**
 * 综合查询 API 服务
 */
import type {
  FilterCondition,
  QueryTemplate,
  QueryResult,
  QueryFieldGroup,
} from '../types/server';

const BASE = '/api/query';

/** 执行综合查询 */
export async function executeQuery(
  fields: string[],
  filters: FilterCondition[]
): Promise<QueryResult> {
  const res = await fetch(`${BASE}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields, filters }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '查询失败');
  }
  return res.json();
}

/** 获取所有可用字段（按分组） */
export async function getQueryFields(): Promise<QueryFieldGroup[]> {
  const res = await fetch(`${BASE}/fields`);
  if (!res.ok) throw new Error('获取字段定义失败');
  return res.json();
}

/** 获取所有查询模板 */
export async function getQueryTemplates(): Promise<QueryTemplate[]> {
  const res = await fetch(`${BASE}/templates`);
  if (!res.ok) throw new Error('获取模板失败');
  return res.json();
}

/** 保存查询模板 */
export async function saveQueryTemplate(
  name: string,
  fields: string[],
  filters: FilterCondition[]
): Promise<QueryTemplate> {
  const res = await fetch(`${BASE}/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, fields, filters }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '保存模板失败');
  }
  return res.json();
}

/** 更新查询模板 */
export async function updateQueryTemplate(
  id: string,
  data: Partial<Pick<QueryTemplate, 'name' | 'fields' | 'filters'>>
): Promise<QueryTemplate> {
  const res = await fetch(`${BASE}/templates/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '更新模板失败');
  }
  return res.json();
}

/** 删除查询模板 */
export async function deleteQueryTemplate(id: string): Promise<void> {
  const res = await fetch(`${BASE}/templates/${id}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || '删除模板失败');
  }
}
