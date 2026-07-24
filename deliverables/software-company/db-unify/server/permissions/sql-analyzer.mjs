import crypto from 'node:crypto';

export function analyzeSql(sql) {
  if (!sql || typeof sql !== 'string') {
    return { type: 'unknown', isDangerous: false };
  }

  // 去注释
  const cleaned = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim()
    .toUpperCase();

  const first = cleaned.split(/\s+/)[0] || '';

  const QUERY_KW = ['SELECT','WITH','SHOW','DESC','DESCRIBE','EXPLAIN'];
  const WRITE_KW = ['INSERT','UPDATE','DELETE','MERGE','UPSERT','REPLACE'];
  const DDL_KW = ['CREATE','ALTER','DROP','TRUNCATE','RENAME','COMMENT'];
  const GRANT_KW = ['GRANT','REVOKE'];

  let type = 'unknown';
  if (QUERY_KW.includes(first)) type = 'query';
  else if (WRITE_KW.includes(first)) type = 'write';
  else if (DDL_KW.includes(first)) type = 'ddl';
  else if (GRANT_KW.includes(first)) type = 'ddl'; // GRANT 归为 ddl

  // 危险模式检测
  const DANGEROUS_PATTERNS = [
    /DROP\s+(DATABASE|SCHEMA)/,
    /TRUNCATE\s+/,
    /^DELETE\s+FROM\s+\S+\s*(;|$)/,  // DELETE 无 WHERE
    /^UPDATE\s+\S+\s+SET\s+.+(?<!WHERE.+)$/,  // UPDATE 无 WHERE (简单检测)
  ];
  const isDangerous = DANGEROUS_PATTERNS.some(p => p.test(cleaned));

  // 简单提取表名
  const tableMatch = cleaned.match(/(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+([\w."]+)/g) || [];
  const tables = tableMatch.map(m => m.replace(/(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+/, '').replace(/"/g, ''));

  return { type, isDangerous, tables: [...new Set(tables)] };
}

// SQL 规范化(用于审批时的 hash 比对)
export function normalizeSql(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hashSql(sql) {
  return crypto.createHash('sha256').update(normalizeSql(sql)).digest('hex');
}
