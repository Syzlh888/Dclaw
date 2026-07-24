/**
 * 数据库元数据浏览服务
 * 获取表、列等数据库结构信息
 */
import { apiFetch } from './apiClient';

export interface ColumnMeta {
  name: string;
  type: string;
  length?: number;
  nullable: boolean;
  primaryKey?: boolean;
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
 * @param schema 可选，指定 Schema（用于未设置 Schema 的连接）
 */
export async function fetchMetadata(connectionId: string, schema?: string): Promise<TableMeta[]> {
  const response = await apiFetch(`/api/connection/${connectionId}/metadata`, {
    method: 'POST',
    body: schema ? JSON.stringify({ schema }) : undefined,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '获取元数据失败' }));
    throw new Error(err.error || '获取元数据失败');
  }

  const data = await response.json();
  return data.tables || [];
}

/**
 * 获取连接对应数据库的 Schema 列表
 */
export async function fetchConnectionSchemas(connectionId: string): Promise<string[]> {
  const response = await apiFetch(`/api/connection/${connectionId}/schemas`, {
    method: 'POST',
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '获取 Schema 列表失败' }));
    throw new Error(err.error || '获取 Schema 列表失败');
  }

  const data = await response.json();
  return data.schemas || [];
}

/**
 * 生成 SELECT 语句（用于拖拽/点击生成）
 * @param quote 引用标识符的风格：'' 不引, '"' 双引号, '`' 反引号（仅作用于字段名，表名一律不加引号）
 * 说明：不追加 LIMIT，让后端分页机制接管（默认 100 行/批，触底自动加载更多）
 */
export function generateSelectSql(tableName: string, columns: ColumnMeta[], quote: '' | '"' | '`' = ''): string {
  const q = (name: string) => quote ? `${quote}${name}${quote}` : name;
  const colList = columns.length > 0
    ? columns.map(c => `  ${q(c.name)}`).join(',\n')
    : '  *';
  return `SELECT\n${colList}\nFROM ${tableName};`;
}

/** 生成 SELECT * 简短语句（不追加 LIMIT，由后端分页接管） */
export function generateSelectStarSql(tableName: string, _quote: '' | '"' | '`' = ''): string {
  return `SELECT * FROM ${tableName};`;
}

/** 生成 INSERT INTO 模板 */
export function generateInsertSql(tableName: string, columns: ColumnMeta[], quote: '' | '"' | '`' = ''): string {
  const q = (name: string) => quote ? `${quote}${name}${quote}` : name;
  if (columns.length === 0) {
    return `INSERT INTO ${tableName} () VALUES ();`;
  }
  const colList = columns.map(c => `  ${q(c.name)}`).join(',\n');
  const valList = columns.map(c => `  :${c.name}`).join(',\n');
  return `INSERT INTO ${tableName} (\n${colList}\n) VALUES (\n${valList}\n);`;
}

/** 生成 UPDATE 模板（不含 WHERE 主键因为不知道主键） */
export function generateUpdateSql(tableName: string, columns: ColumnMeta[], quote: '' | '"' | '`' = ''): string {
  const q = (name: string) => quote ? `${quote}${name}${quote}` : name;
  if (columns.length === 0) {
    return `UPDATE ${tableName} SET\n  <column> = <value>\nWHERE <condition>;`;
  }
  const setList = columns.map(c => `  ${q(c.name)} = :${c.name}`).join(',\n');
  return `UPDATE ${tableName} SET\n${setList}\nWHERE <condition>;`;
}

/** 生成 DELETE 模板 */
export function generateDeleteSql(tableName: string, _quote: '' | '"' | '`' = ''): string {
  return `DELETE FROM ${tableName}\nWHERE <condition>;`;
}

/** 生成 COUNT 语句 */
export function generateCountSql(tableName: string, _quote: '' | '"' | '`' = ''): string {
  return `SELECT COUNT(*) FROM ${tableName};`;
}

/**
 * 获取指定表的建表 DDL
 * @param connectionId 连接 ID
 * @param tableName 表名
 */
export async function fetchTableDdl(connectionId: string, tableName: string): Promise<string> {
  const response = await apiFetch(`/api/connection/${connectionId}/ddl`, {
    method: 'POST',
    body: JSON.stringify({ table: tableName }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '获取 DDL 失败' }));
    throw new Error(err.error || '获取 DDL 失败');
  }

  const data = await response.json();
  return data.ddl || '';
}
