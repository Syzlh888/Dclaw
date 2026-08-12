/**
 * API 服务 — 公开调用网关（/api/public/v1）
 *
 * 独立于登录 JWT：使用 api_tokens.token 鉴权。
 * 调用流程：
 *   1. 提取 Token（Authorization Bearer / X-API-Key / ?token=）
 *   2. 查 api_tokens：active + 未过期
 *   3. 跨接口授权（scope=all 全通过；scope=select 检查 endpoint_ids）
 *   4. IP 白名单校验（CIDR / 单 IP 精确匹配）
 *   5. 检查接口 active
 *   6. 限流（QPS 滑动窗口 + 每日上限）
 *   7. 参数解析 + 只读 SQL 校验 + 参数化绑定
 *   8. 分页 LIMIT/OFFSET（<= page_size_max）
 *   9. 脱敏
 *   10. 返回 {code:0, data, total, page, pageSize}
 *   11. 写审计日志
 */
import { Router } from 'express';
import { getPool } from '../db/pool.mjs';
import { decryptPasswordGm, sm3Hash } from '../crypto-gm.mjs';
import { validateSql } from '../sqlValidator.mjs';
import {
  executeQuery,
  createDbConnection,
  closeConnection,
} from './connections.mjs';
import { decryptPassword } from '../crypto.mjs';
import { _internal as apiAdmin } from './api-service.mjs';

const router = Router();

/* ===========================================================
 * 提取调用方 IP（兼容反向代理）
 * =========================================================== */
function getCallerIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  if (Array.isArray(xff) && xff.length > 0) return String(xff[0]).trim();
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.length > 0) return real.trim();
  return req.ip || (req.connection && req.connection.remoteAddress) || '';
}

/* ===========================================================
 * IP 白名单匹配：支持单 IP / CIDR / 通配符段
 *  - 精确：192.168.1.10
 *  - CIDR：192.168.1.0/24
 *  - 段（后两段通配）：192.168.*.*
 * =========================================================== */
function ipToLong(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = n * 256 + v;
  }
  return n >>> 0;
}

function matchIpRule(rule, ip) {
  const r = String(rule).trim();
  if (!r) return false;
  if (r === ip) return true;
  if (r.includes('/')) {
    const [base, bitsStr] = r.split('/');
    const bits = Math.max(0, Math.min(32, Number(bitsStr) || 0));
    const ipL = ipToLong(ip);
    const baseL = ipToLong(base);
    if (ipL === null || baseL === null) return false;
    if (bits === 0) return true;
    const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
    return (ipL & mask) === (baseL & mask);
  }
  if (r.includes('*')) {
    // 192.168.*.* → 192.168.x.x
    const rp = r.split('.');
    const ip = String(ip).split('.');
    if (rp.length !== 4 || ip.length !== 4) return false;
    for (let i = 0; i < 4; i += 1) {
      if (rp[i] === '*') continue;
      if (rp[i] !== ip[i]) return false;
    }
    return true;
  }
  return false;
}

function checkIpAllowed(whitelist, ip) {
  if (!Array.isArray(whitelist) || whitelist.length === 0) return true;
  return whitelist.some((r) => matchIpRule(r, ip));
}

/* ===========================================================
 * QPS 滑动窗口限流（进程内内存版；多实例需外置 Redis）
 *   key: tokenId + ':' + endpointId
 *   记录一秒内的请求时间戳，超过 qps_limit 拒绝
 * =========================================================== */
const qpsBuckets = new Map(); // key -> { count: number[], resetAt: number }

function checkQpsLimit(tokenId, endpointId, qpsLimit) {
  const key = `${tokenId}:${endpointId}`;
  const now = Date.now();
  const bucket = qpsBuckets.get(key) || { count: [], resetAt: now + 1000 };
  // 清理一秒之前的
  bucket.count = bucket.count.filter((t) => now - t < 1000);
  if (bucket.count.length >= qpsLimit) {
    qpsBuckets.set(key, bucket);
    return false;
  }
  bucket.count.push(now);
  qpsBuckets.set(key, bucket);
  return true;
}

/* ===========================================================
 * 每日上限：查 api_call_logs 当天已调用次数
 * =========================================================== */
async function getTodayCallCount(tokenId, endpointId) {
  const { rows } = await getPool().query(
    `SELECT COUNT(*)::int AS c FROM api_call_logs
       WHERE token_id = $1 AND endpoint_id = $2
         AND called_at >= date_trunc('day', NOW())`,
    [tokenId, endpointId]
  );
  return rows[0]?.c || 0;
}

/* ===========================================================
 * 审计日志（异步 fire-and-forget）
 * =========================================================== */
function auditLog({ endpoint_id, token_id, ip, params_hash, status_code, error_msg, duration_ms }) {
  getPool().query(
    `INSERT INTO api_call_logs (endpoint_id, token_id, ip, params_hash, status_code, error_msg, duration_ms)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      endpoint_id, token_id || null, ip || null,
      params_hash || null,
      Number(status_code) || 0,
      error_msg ? String(error_msg).slice(0, 2000) : null,
        Math.max(0, Number(duration_ms) || 0),
      ]
    ).catch((e) => console.error('[api-public] audit log failed:', e.message));
}

/* ===========================================================
 * 主入口：GET / POST /api/public/v1/:apiId
 * =========================================================== */
async function handle(req, res) {
  const t0 = Date.now();
  const apiId = req.params.apiId;
  const ip = getCallerIp(req);

  // 1. 提取 Token
  const auth = req.headers.authorization;
  let rawToken = null;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) rawToken = auth.slice(7).trim();
  if (!rawToken) rawToken = (req.headers['x-api-key'] || req.query?.token || '').toString().trim();
  if (!rawToken) {
    return res.status(401).json({ code: 401, error: '未提供 API Token（Authorization Bearer / X-API-Key / ?token=）' });
  }

  // 2. 查 Token（带密文比对需要循环解密；为减少开销按 id 遍历）
  const tkRow = await getPool().query('SELECT * FROM api_tokens WHERE status = $1', ['active']);
  let matchedToken = null;
  for (const row of tkRow.rows) {
    const plain = decryptPasswordGm(row.token);
    if (plain && plain === rawToken) {
      matchedToken = row;
      break;
    }
  }
  if (!matchedToken) {
    auditLog({ endpoint_id: apiId, ip, status_code: 401, error_msg: 'token not found / not match', duration_ms: Date.now() - t0 });
    return res.status(401).json({ code: 401, error: 'API Token 无效' });
  }

  // 过期校验
  if (matchedToken.expires_at && new Date(matchedToken.expires_at).getTime() < Date.now()) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 401, error_msg: 'token expired', duration_ms: Date.now() - t0 });
    return res.status(401).json({ code: 401, error: 'API Token 已过期' });
  }

  // 3. 跨接口授权
  const epIds = (matchedToken.endpoint_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (matchedToken.scope === 'select' && !epIds.includes(apiId)) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 403, error_msg: 'token not authorized for this endpoint', duration_ms: Date.now() - t0 });
    return res.status(403).json({ code: 403, error: '此 Token 未被授权访问该接口' });
  }

  // 4. IP 白名单
  const iplist = (matchedToken.ip_whitelist || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!checkIpAllowed(iplist, ip)) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 403, error_msg: 'ip not in whitelist', duration_ms: Date.now() - t0 });
    return res.status(403).json({ code: 403, error: '调用方 IP 不在白名单内' });
  }

  // 5. 接口定义
  const epRow = await getPool().query('SELECT * FROM api_endpoints WHERE id = $1', [apiId]);
  if (epRow.rows.length === 0) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 404, error_msg: 'endpoint not found', duration_ms: Date.now() - t0 });
    return res.status(404).json({ code: 404, error: 'API 接口不存在' });
  }
  const ep = epRow.rows[0];
  if (ep.status !== 'active') {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 403, error_msg: 'endpoint disabled', duration_ms: Date.now() - t0 });
    return res.status(403).json({ code: 403, error: '该接口已停用' });
  }

  // 6. 限流：QPS + 每日
  const qpsLimit = matchedToken.qps_limit || 10;
  if (!checkQpsLimit(matchedToken.id, apiId, qpsLimit)) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 429, error_msg: 'qps exceeded', duration_ms: Date.now() - t0 });
    return res.status(429).json({ code: 429, error: 'QPS 上限已达上限，请稍后再试' });
  }
  const todayCount = await getTodayCallCount(matchedToken.id, apiId);
  if (todayCount >= (matchedToken.daily_limit || 1000)) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 429, error_msg: 'daily limit exceeded', duration_ms: Date.now() - t0 });
    return res.status(429).json({ code: 429, error: '每日调用次数已达上限' });
  }

  // 7. 解析参数
  const defs = apiAdmin.parseJsonSafe(ep.params_json, []);
  const userParams = {
    ...(req.query || {}),
    ...((req.body && typeof req.body === 'object') ? req.body : {}),
  };
  // 移除分页与鉴权字段，避免被当成业务参数
  delete userParams.page;
  delete userParams.pageSize;
  delete userParams.token;
  const coerced = apiAdmin.coerceParams(defs, userParams);
  if (coerced.errors.length > 0) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 400, error_msg: coerced.errors.join('；'), duration_ms: Date.now() - t0 });
    return res.status(400).json({ code: 400, error: coerced.errors.join('；') });
  }

  // 构造 SQL
  const connRow = await getPool().query('SELECT * FROM connections WHERE id = $1', [ep.connection_id]);
  if (connRow.rows.length === 0) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 500, error_msg: 'connection missing', duration_ms: Date.now() - t0 });
    return res.status(500).json({ code: 500, error: '接口关联的数据库连接不存在' });
  }
  const conn = connRow.rows[0];

  let rawSql;
  if (ep.type === 'sql') {
    rawSql = ep.sql_text;
  } else {
    const schema = ep.schema_name || conn.schema_name || '';
    const tbl = String(ep.table_name).replace(/"/g, '');
    const tblIdent = schema
      ? `"${String(schema).replace(/"/g, '""')}"."${tbl}"`
      : `"${tbl}"`;
    rawSql = `SELECT * FROM ${tblIdent}`;
  }

  // 8. 只读强制
  const ro = validateSql(rawSql, { readOnlyMode: true });
  if (!ro.valid) {
    auditLog({ endpoint_id: apiId, token_id: matchedToken.id, ip, status_code: 400, error_msg: ro.errors.join('；'), duration_ms: Date.now() - t0 });
    return res.status(400).json({ code: 400, error: `SQL 校验失败：${ro.errors.join('；')}` });
  }

  // 命名占位符参数化绑定
  const bound = apiAdmin.bindNamedParams(rawSql, coerced.values);

  // 9. 分页
  const page = Math.max(1, Number(userParams.page || req.query?.page || 1));
  const reqPageSize = Math.max(1, Number(userParams.pageSize || req.query?.pageSize || 20));
  const pageSize = Math.min(reqPageSize, ep.page_size_max || 100);
  const offset = (page - 1) * pageSize;
  const limitedSql = `${bound.sql.replace(/;+\s*$/, '')} LIMIT ${pageSize} OFFSET ${offset}`;

  const password = decryptPassword(conn.password_encrypted || '');
  const dbConn = await createDbConnection({
    driver: conn.driver,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password,
    database: conn.database_name || '',
    schema: conn.schema_name || '',
    customDriverId: conn.custom_driver_id || undefined,
  });

  try {
    const result = await executeQuery(dbConn, conn.driver, limitedSql, 30000, conn.custom_driver_id);
    const masked = apiAdmin.applyMask(result.rows || [], apiAdmin.parseJsonSafe(ep.mask_fields, []));

    // 更新 last_used_at（异步）
    getPool().query('UPDATE api_tokens SET last_used_at = NOW() WHERE id = $1', [matchedToken.id])
      .catch(() => {});

    auditLog({
      endpoint_id: apiId, token_id: matchedToken.id, ip,
      params_hash: sm3Hash(JSON.stringify(coerced.values || {})),
      status_code: 0, error_msg: null, duration_ms: Date.now() - t0,
    });

    res.json({
      code: 0,
      data: masked,
      columns: result.columns || [],
      total: masked.length,        // 受 pageSize 限制；如需精确总数可启用 SELECT COUNT(*)
      page,
      pageSize,
      endpoint: { id: ep.id, name: ep.name, type: ep.type },
    });
  } catch (err) {
    auditLog({
      endpoint_id: apiId, token_id: matchedToken.id, ip,
      status_code: 500, error_msg: err.message || 'execute failed', duration_ms: Date.now() - t0,
    });
    res.status(500).json({ code: 500, error: err.message || '查询执行失败' });
  } finally {
    await closeConnection(dbConn, conn.driver, conn.custom_driver_id).catch(() => {});
  }
}

router.get('/:apiId', handle);
router.post('/:apiId', handle);

export default router;