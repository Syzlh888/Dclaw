/**
 * 代理网关 — SQL 审计模块（阶段8 优化：危险SQL规则可配置）
 *
 * 职责：
 *  - 识别 SQL 类型 / 风险分级 / 危险 SQL 判断
 *  - 审计记录写入 proxy_audit_logs（复用主服务 PG 连接池）
 *  - classifySql 使用内存缓存的危险SQL规则（默认内置 + DB 可覆盖）
 *
 * 危险 SQL 识别（audit_mode=intercept 时拦截）：
 *   - 默认规则：DROP / TRUNCATE / ALTER / GRANT / REVOKE / RENAME
 *   - 可选规则：DELETE/UPDATE 无 WHERE（按规则 enabled 决定是否拦截）
 *   - 自定义规则：通过 proxy_danger_rules 表动态加载
 */
import { getPool } from '../db/pool.mjs';

/** 内置 fallback 规则（数据库未就绪 / proxy_danger_rules 表为空时仍可工作） */
const FALLBACK_RULES = [
  { keyword: 'DROP', risk_level: 'high', action: 'block', enabled: true },
  { keyword: 'TRUNCATE', risk_level: 'high', action: 'block', enabled: true },
  { keyword: 'ALTER', risk_level: 'high', action: 'block', enabled: true },
  { keyword: 'GRANT', risk_level: 'high', action: 'block', enabled: true },
  { keyword: 'REVOKE', risk_level: 'high', action: 'block', enabled: true },
  { keyword: 'RENAME', risk_level: 'high', action: 'block', enabled: true },
];

/** 内存缓存：{ rows: Rule[], fetchedAt: number } */
let cache = { rows: FALLBACK_RULES.slice(), fetchedAt: 0 };
const CACHE_TTL_MS = 30000; // 30s 缓存，规则变更后最多 30s 内生效

/**
 * 从 DB 加载规则并刷新缓存（失败时保留旧缓存，确保可用性）
 * @returns {Promise<Array<{keyword,risk_level,action,enabled}>>}
 */
export async function loadRulesFromDb(force = false) {
  if (!force && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.rows;
  }
  try {
    const { rows } = await getPool().query(
      `SELECT keyword, risk_level, action, enabled, sort_order
       FROM proxy_danger_rules
       WHERE enabled = TRUE
       ORDER BY sort_order ASC, keyword ASC`
    );
    if (rows.length > 0) {
      cache = { rows, fetchedAt: Date.now() };
    } else {
      // 表为空：保留旧缓存，但刷新 fetchedAt 避免每次都打 DB
      cache.fetchedAt = Date.now();
    }
  } catch (err) {
    console.error('[proxy-audit] 加载危险SQL规则失败，沿用旧规则:', err?.message);
  }
  return cache.rows;
}

/** 手动失效缓存（管理 API 修改规则后调用） */
export function invalidateRulesCache() {
  cache.fetchedAt = 0;
}

/** 同步版：使用当前缓存。模块第一次加载会尝试预热缓存（fire-and-forget） */
export function getActiveRules() {
  return cache.rows;
}

/** 模块加载时尝试刷新一次（异步，不阻塞主流程） */
(async () => {
  try { await loadRulesFromDb(true); } catch { /* ignore */ }
})();

/** 大小写不敏感的整词匹配（避免 DROP 误中 DROPPED 等） */
function matchesKeyword(sql, keyword) {
  if (!keyword) return false;
  const re = new RegExp(`\\b${keyword}\\b`, 'i');
  return re.test(sql);
}

/** 分类 + 风险分级 + 是否危险 */
export function classifySql(sql) {
  const raw = (sql || '').trim();
  // 先剥离行注释(-- ...\n)和块注释(/* ... */)，避免注释里藏 DDL 绕过检测
  // 同时也避免普通带注释 SQL（如 SELECT 1 -- 解释）被误判为危险
  const s = raw
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const keyword = (s.split(/[\s;(]/)[0] || '').toUpperCase();

  let sqlType = 'OTHER';
  let riskLevel = 'low';
  let dangerous = false;
  let blockAction = false; // 命中 block 类规则？

  if (/^(SELECT|WITH)\b/i.test(s)) sqlType = 'SELECT';
  else if (/^(INSERT|REPLACE|COPY)\b/i.test(s)) sqlType = 'INSERT';
  else if (/^UPDATE\b/i.test(s)) sqlType = 'UPDATE';
  else if (/^(DELETE|TRUNCATE)\b/i.test(s)) sqlType = 'DELETE';
  else if (/^(CREATE|DROP|ALTER|GRANT|REVOKE|COMMENT|RENAME|LOCK|UNLOCK|MERGE|CALL|EXEC|EXECUTE)\b/i.test(s)) sqlType = 'DDL';

  // 只读判定：SELECT/WITH/SHOW/EXPLAIN/DESCRIBE/DESC/HELP/VALUES/PRAGMA 等
  const readOnly = /^(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC|HELP|VALUES|PRAGMA)\b/i.test(s);

  // 1) 先按代理规则表中的关键字规则判定
  const rules = getActiveRules();
  let matchedRule = null;
  for (const r of rules) {
    if (r && r.keyword && matchesKeyword(s, r.keyword)) {
      // 默认行为：命中即视为危险；如规则带 action=warn，则只升级风险等级不拦截
      matchedRule = r;
      if (r.action === 'block') {
        dangerous = true;
        blockAction = true;
      } else if (r.action === 'warn') {
        dangerous = false;
        blockAction = false;
      }
      // 风险等级按规则升级（high > medium > low）
      const order = { low: 1, medium: 2, high: 3 };
      if (order[r.risk_level] > order[riskLevel]) {
        riskLevel = r.risk_level;
      }
    }
  }

  // 2) DELETE/UPDATE 无 WHERE 的额外语义判定：
  //    即便规则表里只把 DELETE/UPDATE 配成 warn，这里也按"无 WHERE"作为强信号升级。
  if (/^\s*DELETE\b/i.test(s) && !/\bWHERE\b/i.test(s)) {
    dangerous = true;
    blockAction = true;
    if (order_of(riskLevel) < 3) riskLevel = 'high';
  }
  if (/^\s*UPDATE\b/i.test(s) && !/\bWHERE\b/i.test(s)) {
    if (order_of(riskLevel) < 2) riskLevel = 'medium';
    // UPDATE 无 WHERE 不强制 block（避免误杀 SET 等），除非规则表显式 enabled
    if (matchedRule && matchedRule.keyword && matchedRule.keyword.toUpperCase() === 'UPDATE'
        && matchedRule.action === 'block') {
      dangerous = true;
      blockAction = true;
    }
  }

  return {
    sqlType,
    riskLevel,
    dangerous,
    readOnly,
    keyword,
    matchedRule: matchedRule ? { keyword: matchedRule.keyword, action: matchedRule.action, risk_level: matchedRule.risk_level } : null,
    blockAction,
  };
}

// 内部辅助：风险等级排序
function order_of(lv) {
  return { low: 1, medium: 2, high: 3 }[lv] || 0;
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