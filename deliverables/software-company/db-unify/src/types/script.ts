/**
 * SQL 脚本类型定义
 */
export type ScriptCategory = '常用' | '巡检' | '即席' | '';

export const SCRIPT_CATEGORIES: ScriptCategory[] = ['常用', '巡检', '即席', ''];

export interface SqlScript {
  id: string;
  name: string;
  description: string;
  category?: ScriptCategory;
  sql_text: string;
  /** 列表接口返回的 SQL 预览（前 100 字符） */
  sql_preview?: string;
  created_at: string;
  updated_at: string;
}
