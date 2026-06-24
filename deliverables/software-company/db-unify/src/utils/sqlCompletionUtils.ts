/**
 * SQL 智能补全工具
 * 从 SQL 语句中解析表名/别名映射，支持列名自动补全
 */

/**
 * 从 SQL 中提取 表名→别名 的映射关系
 *
 * 支持的语法模式：
 *   FROM table_name [AS] [alias]
 *   JOIN table_name [AS] [alias]
 *   LEFT/RIGHT/INNER/FULL/CROSS JOIN table_name [AS] [alias]
 *   , table_name [AS] [alias]  （隐式连接）
 *
 * 返回 Map<alias | tableName, realTableName>
 */
export function parseTableAliases(sql: string): Map<string, string> {
  const map = new Map<string, string>();

  // 移除字符串字面量，避免误匹配（支持转义单引号 ''）
  const cleanSql = sql.replace(/'(?:[^']|'')*'/g, "''");

  // 匹配 FROM / JOIN / 各种 JOIN / 逗号 后跟的表名和可选别名
  const pattern =
    /\b(?:FROM|JOIN|LEFT\s+(?:OUTER\s+)?JOIN|RIGHT\s+(?:OUTER\s+)?JOIN|INNER\s+JOIN|FULL\s+(?:OUTER\s+)?JOIN|OUTER\s+JOIN|CROSS\s+JOIN|,)\s+([a-zA-Z_][\w.]*)\s*(?:AS\s+)?([a-zA-Z_]\w*)?/gi;

  // SQL 关键字，不可能是表别名
  const RESERVED = new Set(['ON','WHERE','SELECT','SET','AND','OR','AS','JOIN',
    'LEFT','RIGHT','INNER','OUTER','CROSS','FULL','FROM','INTO','VALUES',
    'GROUP','ORDER','BY','HAVING','LIMIT','OFFSET','UNION','EXISTS','NOT',
    'NULL','TRUE','FALSE','CASE','WHEN','THEN','ELSE','END','ASC','DESC',
    'INSERT','UPDATE','DELETE','CREATE','DROP','ALTER','TABLE','INDEX','VIEW',
  ]);

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(cleanSql)) !== null) {
    const tableName = match[1];
    const alias = match[2];

    if (!tableName) continue;

    // 过滤掉纯数字表名（不合理）
    if (/^\d+$/.test(tableName)) continue;

    if (alias && !RESERVED.has(alias.toUpperCase())) {
      map.set(alias, tableName);
      // 也用表名本身作为 key（用户可能直接用表名加 . 引用列）
      map.set(tableName, tableName);
    } else {
      // 无别名，用表名本身
      map.set(tableName, tableName);
    }
  }

  return map;
}

/**
 * 获取光标位置前的一个标识符（用于检测 . 前面的别名/表名）
 * 支持：
 *   alias.          → 返回 "alias"
 *   schema.table.   → 返回 "schema.table"
 */
export function getIdentifierBeforeDot(
  textBeforeCursor: string
): string | null {
  // 匹配末尾的 identifier.identifier. 模式（最多两级，如 schema.table. 或 alias.）
  const match = textBeforeCursor.match(/(\w+(?:\.\w+)?)\.\s*$/);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * 简化的 SQL 关键字列表（用于过滤）
 */
export const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'AND', 'OR', 'NOT', 'IN', 'IS',
  'NULL', 'LIKE', 'BETWEEN', 'EXISTS', 'UNION', 'ORDER', 'BY',
  'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'INSERT', 'INTO', 'VALUES',
  'UPDATE', 'SET', 'DELETE', 'CREATE', 'DROP', 'ALTER', 'TABLE',
  'INDEX', 'VIEW', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'JOIN',
  'ON', 'AS', 'DISTINCT', 'ALL', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'ASC', 'DESC', 'TRUE', 'FALSE', 'PRIMARY', 'KEY', 'FOREIGN',
  'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'CHECK', 'UNIQUE', 'AUTO_INCREMENT',
]);
