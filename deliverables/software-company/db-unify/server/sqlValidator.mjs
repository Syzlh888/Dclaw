/**
 * SQL 语句校验工具
 * - 判断 SQL 类型
 * - 只读模式拦截非 SELECT 语句
 * - 危险操作检测
 */

/** DDL/DML 关键词列表（非只读操作） */
const WRITE_KEYWORDS = [
  'INSERT', 'UPDATE', 'DELETE', 'DROP', 'CREATE', 'ALTER',
  'TRUNCATE', 'REPLACE', 'MERGE', 'GRANT', 'REVOKE',
  'RENAME', 'SET', 'LOCK', 'UNLOCK', 'CALL', 'EXEC', 'EXECUTE',
];

/** 危险操作关键词（需要特别确认） */
const DANGEROUS_KEYWORDS = [
  'DROP', 'TRUNCATE', 'DELETE', 'ALTER',
];

/**
 * 检测 SQL 语句类型
 */
export function detectSqlType(sql) {
  const trimmed = sql.trim();
  if (!trimmed) return 'EMPTY';

  // 移除注释
  const clean = trimmed
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();

  if (!clean) return 'EMPTY';

  const firstWord = clean.split(/\s+/)[0].toUpperCase();
  return firstWord;
}

/**
 * 判断是否为只读 SELECT 语句
 */
export function isSelectStatement(sql) {
  const type = detectSqlType(sql);
  return type === 'SELECT' || type === 'SHOW' || type === 'DESCRIBE' || type === 'DESC' || type === 'EXPLAIN';
}

/**
 * 只读模式校验
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateReadOnly(sql) {
  if (!sql || !sql.trim()) {
    return { valid: false, error: 'SQL 语句不能为空' };
  }

  if (isSelectStatement(sql)) {
    return { valid: true };
  }

  const type = detectSqlType(sql);
  return {
    valid: false,
    error: `只读模式下不允许执行 ${type} 语句。仅允许 SELECT / SHOW / DESCRIBE / EXPLAIN`,
  };
}

/**
 * 检测是否包含危险操作
 * @returns {string[]} 匹配到的危险关键词列表
 */
export function detectDangerousOps(sql) {
  const upper = sql.toUpperCase();
  return DANGEROUS_KEYWORDS.filter((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, 'i');
    return regex.test(upper);
  });
}

/**
 * 校验 SQL 基本安全性
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
export function validateSql(sql, { readOnlyMode = true } = {}) {
  const errors = [];
  const warnings = [];

  if (!sql || !sql.trim()) {
    errors.push('SQL 语句不能为空');
    return { valid: false, errors, warnings };
  }

  // 只读模式检查
  if (readOnlyMode) {
    const roResult = validateReadOnly(sql);
    if (!roResult.valid) {
      errors.push(roResult.error);
    }
  }

  // 危险操作警告
  const dangerous = detectDangerousOps(sql);
  if (dangerous.length > 0) {
    warnings.push(`检测到危险操作：${dangerous.join(', ')}，请确认后执行`);
  }

  return { valid: errors.length === 0, errors, warnings };
}
