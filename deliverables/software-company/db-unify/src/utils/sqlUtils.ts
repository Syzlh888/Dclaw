/**
 * Check if a SQL statement is a SELECT statement.
 * Only looks at the first non-whitespace word.
 */
export function isSelectStatement(sql: string): boolean {
  const trimmed = sql.trim();
  if (!trimmed) return false;
  const firstWord = trimmed.split(/\s+/)[0].toUpperCase();
  return firstWord === 'SELECT';
}

/**
 * 检测 SQL 是否已包含 LIMIT / TOP / FETCH / ROWNUM 子句
 * 用于判断是否需要自动追加分页
 */
export function hasSqlLimit(sql: string): boolean {
  const upper = sql.toUpperCase();
  if (/\bLIMIT\s+\d+/i.test(sql)) return true;
  if (/\bSELECT\s+TOP\s+\d+/i.test(sql)) return true;
  if (/\bFETCH\s+(FIRST|NEXT)\s+\d+/i.test(sql)) return true;
  if (/\bROWNUM\s*<[=]?\s*\d+/i.test(sql)) return true;
  return false;
}

/**
 * 判断 SQL 是否为可追加 LIMIT 的查询（SELECT/WITH 且不包含 LIMIT）
 */
export function canAppendLimit(sql: string): boolean {
  if (!sql || !sql.trim()) return false;
  const upper = sql.trim().toUpperCase();
  if (!/^(SELECT|WITH)\b/i.test(upper)) return false;
  return !hasSqlLimit(sql);
}

/**
 * Detect the type of SQL statement.
 * Returns the first keyword of the SQL.
 */
export function detectSqlType(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) return 'UNKNOWN';
  return trimmed.split(/\s+/)[0].toUpperCase();
}

/**
 * Detect parameterized query placeholders (e.g., :paramName).
 * Returns unique parameter names found in the SQL.
 */
export function detectSqlParams(sql: string): string[] {
  const regex = /:(\w+)/g;
  const params = new Set<string>();
  let match;
  while ((match = regex.exec(sql)) !== null) {
    params.add(match[1]);
  }
  return Array.from(params);
}

/** 只读查询类 SQL 关键字（含 CTE） */
const READ_ONLY_KEYWORDS = new Set([
  'SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'EXPLAIN', 'DESC',
]);

/**
 * 去除 SQL 中的注释（单行 -- 和块注释 。* /）。*/
export function stripSqlComments(sql: string): string {
  // 先去掉块注释
  let result = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  // 再去掉单行注释 --（保留换行）
  result = result.replace(/--[^\n]*/g, '');
  return result;
}

/**
 * 判断一段 SQL 是否为纯查询语句（所有子语句都是只读的）。
 * 用于非只读模式下：纯查询直接执行不弹确认框。
 *
 * 判断规则：
 * 1. 去除注释后按分号拆分多条语句
 * 2. 每条 trim + 转大写后提取第一个词
 * 3. 所有子语句都以 SELECT / WITH / SHOW / DESCRIBE / EXPLAIN / DESC 开头则返回 true
 * 4. 任何一条包含写操作关键字则返回 false
 */
export function isPureQuerySql(sql: string): boolean {
  const clean = stripSqlComments(sql);
  const statements = clean.split(';');
  for (const stmt of statements) {
    const trimmed = stmt.trim();
    if (!trimmed) continue; // 跳过空语句
    const firstWord = trimmed.split(/\s+/)[0].toUpperCase();
    if (!READ_ONLY_KEYWORDS.has(firstWord)) {
      return false;
    }
  }
  // 没有非查询语句
  return true;
}
