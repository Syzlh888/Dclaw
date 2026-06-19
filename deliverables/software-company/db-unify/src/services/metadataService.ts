/**
 * 数据库元数据浏览服务
 * 获取表、列等数据库结构信息
 */
import { apiFetch } from './apiClient';

export interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
  default?: string;
  comment: string;
}

export interface TableMeta {
  name: string;
  type: string;
  comment: string;
  rows: number;
  sizeMb: number;
  size?: string;
  columns: ColumnMeta[];
}

/**
 * 获取连接对应数据库的元数据（表列表 + 列信息）
 */
export async function fetchMetadata(connectionId: string): Promise<TableMeta[]> {
  const response = await apiFetch(`/api/connection/${connectionId}/metadata`, {
    method: 'POST',
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '获取元数据失败' }));
    throw new Error(err.error || '获取元数据失败');
  }

  const data = await response.json();
  return data.tables || [];
}

/**
 * 生成 SELECT 语句（用于拖拽/点击生成）
 */
export function generateSelectSql(tableName: string, columns: ColumnMeta[]): string {
  const colList = columns.length > 0
    ? columns.map(c => `  ${c.name}`).join(',\n')
    : '  *';
  return `SELECT\n${colList}\nFROM ${tableName}\nLIMIT 100;`;
}
