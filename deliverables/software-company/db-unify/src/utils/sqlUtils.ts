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
