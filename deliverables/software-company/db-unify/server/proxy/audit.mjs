/**
 * 代理网关 — SQL 审计模块
 *
 * 职责：
 *  - 识别 SQL 类型 / 风险分级 / 危险 SQL 判断
 *  - 审计记录写入 proxy_audit_logs（复用主服务 PG 连接池）
 *
 * 危险 SQL 识别（intercept 模式下拦截）：
 *  DROP / TRUNCATE / ALTER / DELETE 无 WHERE / 含注释(规避风险) / GRANT / REVOKE
 */
import { getPool } from '../db/pool.mjs';

/** 分类 + 风险分级 + 是否危险 */
export function classifySql(sql) {
  const s = (sql || '').trim();
  const keyword = (s.split(/[\s;(]/)[0] || '').toUpperCase();

  let sqlType = 'OTHER';
  let riskLevel = 'low';
  let dangerous = false;

  if (/^(SELECT|WITH)\b/i.test(s)) sqlType = 'SELECT';
  else if (/^(INSERT|REPLACE|COPY)\b/i.test(s)) sqlType = 'INSERT';
  else if (/^UPDATE\b/i.test(s)) sqlType = 'UPDATE';
  else if (/^(DELETE|TRUNCATE)\b/i.test(s)) sqlType = 'DELETE';
  else if (/^(CREATE|DROP|ALTER|GRANT|REVOKE|COMMENT|RENAME|LOCK|UNLOCK|MERGE|CALL|EXEC|EXECUTE)\b/i.test(s)) sqlType = 'DDL';

  // 只读判定：SELECT/WITH/SHOW/EXPLAIN/DESCRIBE/DESC 等仅查询语句
  // 兼容 MySQL（SHOW/DESCRIBE/EXPLAIN/HELP/SET 只读查询）与达梦（同 SQL 关键字）
  const readOnly = /^(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC|TABLE|VALUES|HELP|SET|USE|PRAGMA)\b/i.test(s);

  // 危险 SQL：DROP/TRUNCATE/ALTER/GRANT/REVOKE / DELETE 无 WHERE / 注释规避
  if (
    /^\s*(DROP|TRUNCATE|ALTER|GRANT|REVOKE|RENAME)\b/i.test(s) ||
    (/^\s*DELETE\b/i.test(s) && !/\bWHERE\b/i.test(s)) ||
    /(--|\/\*)/.test(s)
  ) {
    dangerous = true;
    riskLevel = 'high';
  } else if (/^\s*UPDATE\b/i.test(s) && !/\bWHERE\b/i.test(s)) {
    riskLevel = 'medium';
  }

  return { sqlType, riskLevel, dangerous, readOnly, keyword };
}

/**
 * 写入一条审计记录（后台异步，失败不阻塞代理转发）
 */
export function persistAudit({
  proxyConnectionId, proxyUsername, dbType, realConnectionId, clientIp,
  sessionStart, sqlText, sqlType, affectedRows, status, riskLevel, errorMessage,
}) {
  const q = getPool().query(
    `INSERT INTO proxy_audit_logs
      (proxy_connection_id, proxy_username, db_type, real_connection_id, client_ip,
       session_start, sql_text, sql_type, affected_rows, status, risk_level, error_message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [proxyConnectionId, proxyUsername, dbType, realConnectionId, clientIp,
     sessionStart, sqlText, sqlType, affectedRows, status, riskLevel, errorMessage]
  ).catch((err) => {
    console.error('[proxy-audit] 写入审计失败:', err.message);
  });
  return q;
}

/** 记录一条会话开始（不带 SQL，仅会话信息） */
export function recordSessionStart({
  proxyConnectionId, proxyUsername, dbType, realConnectionId, clientIp,
}) {
  return persistAudit({
    proxyConnectionId, proxyUsername, dbType, realConnectionId, clientIp,
    sessionStart: new Date().toISOString(), sqlText: null, sqlType: null,
    affectedRows: null, status: 'success', riskLevel: null, errorMessage: null,
  });
}
