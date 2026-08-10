/**
 * 数据库代理网关 — 管理 REST API
 *
 * 阶段1：代理连接 CRUD + 审计查询
 * - GET    /api/proxy/connections             列表（分页 / 状态筛选）
 * - POST   /api/proxy/connections             创建（生成端口+临时账号+随机密码，国密加密存密码，明文返回一次）
 * - GET    /api/proxy/connections/:id         详情
 * - PUT    /api/proxy/connections/:id         更新（续期=改 expires_at 等）
 * - POST   /api/proxy/connections/:id/revoke  撤销（标记 revoked）
 * - GET    /api/proxy/connections/:id/audit   该代理连接的审计记录
 * - GET    /api/proxy/audit                   审计查询（多条件 + 分页）
 * - GET    /api/proxy/audit/export            审计导出（CSV，UTF-8 BOM 兼容 Excel 中文）
 *
 * 端口分配：从 proxy_port_base（默认 35000）递增找未被 proxy_connections 占用的端口
 * 随机密码：>=12 位，含大小写字母 + 数字 + 特殊字符
 * 密码存储：国密 SM4 可逆加密（GM1: 前缀，复用 crypto-gm.mjs），创建时明文仅返回一次
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { getPool } from '../db/pool.mjs';
import { encryptPasswordGm } from '../crypto-gm.mjs';
import proxyManager from '../proxy/manager.mjs';
import { loadRulesFromDb, invalidateRulesCache } from '../proxy/audit.mjs';
import { checkOne } from '../proxy/healthcheck.mjs';

const router = Router();

const DEFAULT_PORT_BASE = 35000;
const MAX_PORT_BASE = 60000;

/** 生成随机密码：>=12 位，含大小写+数字+特殊字符 */
function genRandomPassword(len = 16) {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const special = '!@#$%^&*()-_=+[]{}';
  const all = upper + lower + digits + special;
  // CSPRNG：crypto.randomInt 确保不可预测
  const pick = (chars) => chars[crypto.randomInt(chars.length)];

  // 保证每种字符至少一个
  let p = pick(upper) + pick(lower) + pick(digits) + pick(special);
  // Fisher-Yates + CSPRNG 打乱
  const arr = p.split('');
  for (let i = 0; i < len; i += 1) arr.push(all[crypto.randomInt(all.length)]);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, len).join('');
}

/** 生成对外临时账号：proxy_ + 短随机 */
function genProxyUsername() {
  return `proxy_${nanoid(6)}`;
}

/** 从 base 起递增，找第一个未被 proxy_connections 占用的端口 */
async function findFreePort(base) {
  const MAX_ATTEMPTS = 10000;
  let port = base;
  let attempts = 0;
  while (port < MAX_PORT_BASE && attempts < MAX_ATTEMPTS) {
    attempts += 1;
    const { rows } = await getPool().query(
      'SELECT 1 FROM proxy_connections WHERE proxy_port = $1 LIMIT 1',
      [port]
    );
    if (rows.length === 0) return port;
    port += 1;
  }
  throw new Error('代理端口段已用尽，无法分配端口');
}

/** 从数据库行中取出代理连接（脱敏密码） */
function serializeProxy(row) {
  if (!row) return null;
  // 脱敏：不暴露 proxy_password 明文（has_password 标记）；real_connection_id 不是敏感字段，保留
  const { proxy_password: _pw, ...rest } = row;
  let allowedIps = rest.allowed_ips;
  if (typeof allowedIps === 'string') {
    try { allowedIps = JSON.parse(allowedIps); } catch { allowedIps = null; }
  }
  return {
    ...rest,
    allowed_ips: allowedIps,
    has_password: !!_pw,
    health_status: rest.health_status || 'unknown',
    last_health_check_at: rest.last_health_check_at || null,
    last_error: rest.last_error || null,
  };
}

/**
 * GET /api/proxy/connections
 * 列表：分页（page/pageSize）+ 状态筛选（status）
 */
router.get('/connections', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const { status } = req.query;

    const where = [];
    const params = [];
    if (status) {
      params.push(status);
      where.push(`status = $${params.length}`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await getPool().query(
      `SELECT COUNT(*)::int AS total FROM proxy_connections ${whereSql}`, params
    );
    const total = countRes.rows[0].total;

    const offset = (page - 1) * pageSize;
    const listParams = [...params, pageSize, offset];
    const { rows } = await getPool().query(
      `SELECT * FROM proxy_connections
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );

    res.json({ connections: rows.map(serializeProxy), total, page, pageSize });
  } catch (e) { next(e); }
});

/**
 * POST /api/proxy/connections
 * 创建代理连接：生成端口 + 临时账号 + 随机密码，密码国密加密存储，明文返回一次
 */
router.post('/connections', async (req, res, next) => {
  try {
    const {
      name, db_type = 'postgresql', real_connection_id,
      audit_mode = 'record', access_mode = 'writable', max_connections = 100,
      allowed_ips, proxy_port_base = DEFAULT_PORT_BASE,
      allow_blind = false, expires_at, // 必填，ISO 时间
    } = req.body || {};

    if (!name || !real_connection_id || !expires_at) {
      return res.status(400).json({ error: '缺少必填字段：name / real_connection_id / expires_at' });
    }
    if (!['record', 'intercept'].includes(audit_mode)) {
      return res.status(400).json({ error: 'audit_mode 必须为 record 或 intercept' });
    }
    if (!['readonly', 'writable'].includes(access_mode)) {
      return res.status(400).json({ error: 'access_mode 必须为 readonly 或 writable' });
    }
    const maxConns = Math.min(100, Math.max(1, parseInt(max_connections, 10) || 100));
    const expires = new Date(expires_at);
    if (Number.isNaN(expires.getTime())) {
      return res.status(400).json({ error: 'expires_at 不是合法时间' });
    }

    // 校验真实连接存在
    const realRes = await getPool().query(
      'SELECT id, driver FROM connections WHERE id = $1', [real_connection_id]
    );
    if (realRes.rows.length === 0) {
      return res.status(404).json({ error: '关联的真实连接不存在' });
    }

    const base = parseInt(proxy_port_base, 10) || DEFAULT_PORT_BASE;
    const port = await findFreePort(base);

    const id = nanoid(8);
    const username = genProxyUsername();
    const plainPassword = genRandomPassword(16);
    const encryptedPassword = encryptPasswordGm(plainPassword);

    const allowedIpsJson = Array.isArray(allowed_ips) && allowed_ips.length
      ? JSON.stringify(allowed_ips)
      : null;

    const created = await getPool().query(
      `INSERT INTO proxy_connections
        (id, name, db_type, real_connection_id, proxy_port, proxy_username,
         proxy_password, audit_mode, access_mode, max_connections, allowed_ips, proxy_port_base,
         allow_blind, expires_at, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'active',$15)
       RETURNING *`,
      [id, name, db_type, real_connection_id, port, username, encryptedPassword,
       audit_mode, access_mode, maxConns, allowedIpsJson, base, !!allow_blind, expires.toISOString(),
       req.user?.id || req.user?.username || 'unknown']
    );

    const row = created.rows[0];
    // 明文密码仅此一次返回
    res.status(201).json({
      ...serializeProxy(row),
      proxy_password: plainPassword,
    });
  } catch (e) { next(e); }
});

/**
 * GET /api/proxy/connections/:id
 * 详情
 */
router.get('/connections/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'SELECT * FROM proxy_connections WHERE id = $1', [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '代理连接不存在' });
    res.json({ connection: serializeProxy(rows[0]) });
  } catch (e) { next(e); }
});

/**
 * PUT /api/proxy/connections/:id
 * 更新（支持续期=改 expires_at，及名称/审计模式/并发/IP白名单）
 */
router.put('/connections/:id', async (req, res, next) => {
  try {
    const { rows: exist } = await getPool().query(
      'SELECT id FROM proxy_connections WHERE id = $1', [req.params.id]
    );
    if (!exist.length) return res.status(404).json({ error: '代理连接不存在' });

    const { name, audit_mode, access_mode, allow_blind, max_connections, allowed_ips, expires_at } = req.body || {};
    const sets = [];
    const params = [];

    if (name !== undefined) { params.push(name); sets.push(`name = $${params.length}`); }
    if (audit_mode !== undefined) {
      if (!['record', 'intercept'].includes(audit_mode)) {
        return res.status(400).json({ error: 'audit_mode 必须为 record 或 intercept' });
      }
      params.push(audit_mode); sets.push(`audit_mode = $${params.length}`);
    }
    if (access_mode !== undefined) {
      if (!['readonly', 'writable'].includes(access_mode)) {
        return res.status(400).json({ error: 'access_mode 必须为 readonly 或 writable' });
      }
      params.push(access_mode); sets.push(`access_mode = $${params.length}`);
    }
    if (allow_blind !== undefined) {
      params.push(!!allow_blind); sets.push(`allow_blind = $${params.length}`);
    }
    if (max_connections !== undefined) {
      const m = Math.min(100, Math.max(1, parseInt(max_connections, 10) || 100));
      params.push(m); sets.push(`max_connections = $${params.length}`);
    }
    if (allowed_ips !== undefined) {
      const json = Array.isArray(allowed_ips) && allowed_ips.length
        ? JSON.stringify(allowed_ips) : null;
      params.push(json); sets.push(`allowed_ips = $${params.length}`);
    }
    if (expires_at !== undefined) {
      const d = new Date(expires_at);
      if (Number.isNaN(d.getTime())) return res.status(400).json({ error: 'expires_at 不是合法时间' });
      params.push(d.toISOString()); sets.push(`expires_at = $${params.length}`);
    }

    if (!sets.length) {
      return res.status(400).json({ error: '没有可更新的字段' });
    }

    params.push(req.params.id);
    const { rows } = await getPool().query(
      `UPDATE proxy_connections SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ connection: serializeProxy(rows[0]) });
  } catch (e) { next(e); }
});

/**
 * POST /api/proxy/connections/:id/revoke
 * 撤销：标记 revoked + revoked_at（代理进程轮询后断开活动连接）
 */
router.post('/connections/:id/revoke', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `UPDATE proxy_connections
       SET status = 'revoked', revoked_at = NOW()
       WHERE id = $1 AND status <> 'revoked'
       RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) {
      const check = await getPool().query('SELECT status FROM proxy_connections WHERE id = $1', [req.params.id]);
      if (!check.rows.length) return res.status(404).json({ error: '代理连接不存在' });
      return res.json({ success: true, connection: serializeProxy(check.rows[0]), message: '已处于撤销状态' });
    }
    res.json({ success: true, connection: serializeProxy(rows[0]) });
  } catch (e) { next(e); }
});

/**
 * DELETE /api/proxy/connections/:id
 * 彻底删除代理连接记录（连带其审计日志），仅用于清理脏数据/已撤销记录。
 */
router.delete('/connections/:id', async (req, res, next) => {
  try {
    const id = req.params.id;
    const check = await getPool().query('SELECT id FROM proxy_connections WHERE id = $1', [id]);
    if (!check.rows.length) return res.status(404).json({ error: '代理连接不存在' });
    await getPool().query('DELETE FROM proxy_audit_logs WHERE proxy_connection_id = $1', [id]);
    await getPool().query('DELETE FROM proxy_connections WHERE id = $1', [id]);
    res.json({ success: true, deleted: id });
  } catch (e) { next(e); }
});

/**
 * GET /api/proxy/connections/:id/audit
 * 该代理连接的审计记录
 */
router.get('/connections/:id/audit', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const offset = (page - 1) * pageSize;

    const countRes = await getPool().query(
      'SELECT COUNT(*)::int AS total FROM proxy_audit_logs WHERE proxy_connection_id = $1',
      [req.params.id]
    );
    const total = countRes.rows[0].total;

    const { rows } = await getPool().query(
      `SELECT * FROM proxy_audit_logs
       WHERE proxy_connection_id = $1
       ORDER BY executed_at DESC
       LIMIT $2 OFFSET $3`,
      [req.params.id, pageSize, offset]
    );
    res.json({ logs: rows, total, page, pageSize });
  } catch (e) { next(e); }
});

/**
 * GET /api/proxy/audit
 * 审计查询：按 proxy_connection_id / proxy_username / client_ip / sql_type / status / 时间范围筛选 + 分页
 */
router.get('/audit', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const { proxy_connection_id, proxy_username, client_ip, sql_type, status, start, end } = req.query;

    const where = [];
    const params = [];
    if (proxy_connection_id) { params.push(proxy_connection_id); where.push(`proxy_connection_id = $${params.length}`); }
    if (proxy_username) { params.push(proxy_username); where.push(`proxy_username = $${params.length}`); }
    if (client_ip) { params.push(client_ip); where.push(`client_ip = $${params.length}::inet`); }
    if (sql_type) { params.push(sql_type); where.push(`sql_type = $${params.length}`); }
    if (status) { params.push(status); where.push(`status = $${params.length}`); }
    if (start) { params.push(start); where.push(`executed_at >= $${params.length}`); }
    if (end) { params.push(end); where.push(`executed_at <= $${params.length}`); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRes = await getPool().query(
      `SELECT COUNT(*)::int AS total FROM proxy_audit_logs ${whereSql}`, params
    );
    const total = countRes.rows[0].total;

    const offset = (page - 1) * pageSize;
    const listParams = [...params, pageSize, offset];
    const { rows } = await getPool().query(
      `SELECT * FROM proxy_audit_logs
       ${whereSql}
       ORDER BY executed_at DESC
       LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
      listParams
    );
    res.json({ logs: rows, total, page, pageSize });
  } catch (e) { next(e); }
});

/** 构造审计导出的过滤条件（与 /audit 相同，无分页） */
function buildAuditExportFilter(query) {
  const { proxy_connection_id, sql_type, status, start, end } = query;
  const where = [];
  const params = [];
  if (proxy_connection_id) { params.push(proxy_connection_id); where.push(`proxy_connection_id = $${params.length}`); }
  if (sql_type) { params.push(sql_type); where.push(`sql_type = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (start) { params.push(start); where.push(`executed_at >= $${params.length}`); }
  if (end) { params.push(end); where.push(`executed_at <= $${params.length}`); }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** 转义 CSV 字段：含逗号/引号/换行时加引号并双写内部引号 */
function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * GET /api/proxy/audit/export?proxy_connection_id=&sql_type=&status=&start=&end=
 * 导出审计记录为 CSV（UTF-8 BOM，Excel 中文兼容），Content-Disposition attachment
 */
router.get('/audit/export', async (req, res, next) => {
  try {
    const { whereSql, params } = buildAuditExportFilter(req.query);
    const { rows } = await getPool().query(
      `SELECT proxy_connection_id, proxy_username, db_type, client_ip,
              sql_type, sql_text, status, risk_level, error_message, executed_at
       FROM proxy_audit_logs
       ${whereSql}
       ORDER BY executed_at DESC`,
      params
    );

    const header = [
      'proxy_connection_id', 'proxy_username', 'db_type', 'client_ip', 'sql_type',
      'sql_text', 'status', 'risk_level', 'error_message', 'executed_at',
    ];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        csvEscape(r.proxy_connection_id),
        csvEscape(r.proxy_username),
        csvEscape(r.db_type),
        csvEscape(r.client_ip),
        csvEscape(r.sql_type),
        csvEscape(r.sql_text),
        csvEscape(r.status),
        csvEscape(r.risk_level),
        csvEscape(r.error_message),
        csvEscape(r.executed_at),
      ].join(','));
    }
    // UTF-8 BOM 使 Excel 正确识别 UTF-8 中文
    const csv = '\uFEFF' + lines.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="proxy-audit-${Date.now()}.csv"`
    );
    res.send(csv);
  } catch (e) { next(e); }
});

/**
 * ============ 阶段3：代理进程生命周期管理 ============
 * - GET  /api/proxy/process/status   进程状态（含端口监听）
 * - POST /api/proxy/process/start    启动代理进程
 * - POST /api/proxy/process/stop     停止代理进程
 * - POST /api/proxy/process/restart  重启代理进程
 */

/** GET /api/proxy/process/status */
router.get('/process/status', async (_req, res, next) => {
  try {
    res.json(await proxyManager.status());
  } catch (e) { next(e); }
});

/** POST /api/proxy/process/start */
router.post('/process/start', (_req, res, next) => {
  try {
    res.json(proxyManager.start());
  } catch (e) { next(e); }
});

/** POST /api/proxy/process/stop */
router.post('/process/stop', async (_req, res, next) => {
  try {
    res.json(await proxyManager.stop());
  } catch (e) { next(e); }
});

/** POST /api/proxy/process/restart */
router.post('/process/restart', async (_req, res, next) => {
  try {
    res.json(await proxyManager.restart());
  } catch (e) { next(e); }
});

/**
 * ============ 阶段6：单代理连接健康检查 ============
 * - GET /api/proxy/connections/:id/health     返回 DB 中最近一次健康状态（瞬时）
 * - POST /api/proxy/connections/:id/health    强制立即对指定连接做一次 TCP 探测
 * - GET /api/proxy/health/all                 一次性返回所有 active 连接的最近健康状态
 */

/** GET /api/proxy/connections/:id/health */
router.get('/connections/:id/health', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, proxy_port, status, health_status, last_health_check_at, last_error
       FROM proxy_connections WHERE id = $1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '代理连接不存在' });
    res.json({
      id: rows[0].id,
      name: rows[0].name,
      port: rows[0].proxy_port,
      status: rows[0].status,
      health_status: rows[0].health_status || 'unknown',
      last_health_check_at: rows[0].last_health_check_at || null,
      last_error: rows[0].last_error || null,
    });
  } catch (e) { next(e); }
});

/** POST /api/proxy/connections/:id/health — 立即触发一次探测 */
router.post('/connections/:id/health', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'SELECT id, proxy_port, status FROM proxy_connections WHERE id = $1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '代理连接不存在' });
    const v = await checkOne(rows[0].id, rows[0].proxy_port);
    res.json({
      id: rows[0].id,
      ok: v.ok,
      errMsg: v.errMsg || null,
    });
  } catch (e) { next(e); }
});

/** GET /api/proxy/health/all — 一次性返回所有 active 连接健康状态 */
router.get('/health/all', async (_req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, name, proxy_port, status, health_status, last_health_check_at, last_error
       FROM proxy_connections
       WHERE status = 'active'
       ORDER BY proxy_port ASC`
    );
    res.json({
      connections: rows.map((r) => ({
        id: r.id,
        name: r.name,
        port: r.proxy_port,
        status: r.status,
        health_status: r.health_status || 'unknown',
        last_health_check_at: r.last_health_check_at || null,
        last_error: r.last_error || null,
      })),
    });
  } catch (e) { next(e); }
});

/**
 * ============ 阶段7：代理使用统计 ============
 * - GET /api/proxy/stats?from=&to=&connection_id=
 *   返回每个代理连接的统计：
 *     { id, name, port, status,
 *       audit_count, success_count, failed_count, blocked_count,
 *       distinct_client_ips, last_activity_at, from, to }
 */

/** 安全解析日期范围；不传时默认最近 30 天 */
function parseRange(query) {
  const now = new Date();
  const defFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const from = query.from ? new Date(query.from) : defFrom;
  const to = query.to ? new Date(query.to) : now;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  if (from >= to) return null;
  return { from: from.toISOString(), to: to.toISOString() };
}

router.get('/stats', async (req, res, next) => {
  try {
    const range = parseRange(req.query);
    if (!range) {
      return res.status(400).json({ error: 'from / to 不是合法时间，或 from >= to' });
    }
    const connFilter = req.query.connection_id;

    // LEFT JOIN：即使没审计记录也返回连接本身
    const params = [range.from, range.to];
    let extra = '';
    if (connFilter) {
      params.push(connFilter);
      extra = `AND pc.id = $${params.length}`;
    }

    const { rows } = await getPool().query(
      `SELECT
         pc.id, pc.name, pc.proxy_port AS port, pc.status, pc.db_type,
         pc.last_connected_at,
         COALESCE(SUM(al.total), 0)::int          AS audit_count,
         COALESCE(SUM(al.success_n), 0)::int      AS success_count,
         COALESCE(SUM(al.failed_n), 0)::int       AS failed_count,
         COALESCE(SUM(al.blocked_n), 0)::int      AS blocked_count,
         COALESCE(MAX(al.last_activity), NULL)    AS last_activity_at,
         COALESCE(COUNT(DISTINCT al.client_ip), 0)::int AS distinct_client_ips
       FROM proxy_connections pc
       LEFT JOIN (
         SELECT proxy_connection_id,
                COUNT(*)::int               AS total,
                SUM(CASE WHEN status='success' THEN 1 ELSE 0 END)::int AS success_n,
                SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END)::int AS failed_n,
                SUM(CASE WHEN status='blocked' THEN 1 ELSE 0 END)::int AS blocked_n,
                MAX(executed_at)            AS last_activity,
                client_ip
           FROM proxy_audit_logs
          WHERE executed_at >= $1 AND executed_at <= $2
          GROUP BY proxy_connection_id, client_ip
       ) al ON al.proxy_connection_id = pc.id
       WHERE 1=1 ${extra}
       GROUP BY pc.id
       ORDER BY audit_count DESC, pc.created_at DESC`,
      params
    );

    // 成功率 = success / (success + failed)，避免除零
    const list = rows.map((r) => {
      const exec = (r.success_count || 0) + (r.failed_count || 0);
      const successRate = exec > 0 ? Number(((r.success_count || 0) / exec).toFixed(4)) : null;
      return {
        id: r.id,
        name: r.name,
        port: r.port,
        status: r.status,
        db_type: r.db_type,
        last_connected_at: r.last_connected_at || null,
        audit_count: r.audit_count || 0,
        success_count: r.success_count || 0,
        failed_count: r.failed_count || 0,
        blocked_count: r.blocked_count || 0,
        distinct_client_ips: r.distinct_client_ips || 0,
        last_activity_at: r.last_activity_at || null,
        success_rate: successRate,
      };
    });

    res.json({ from: range.from, to: range.to, stats: list });
  } catch (e) { next(e); }
});

/**
 * ============ 阶段8：危险SQL规则管理 ============
 * - GET    /api/proxy/rules       列出全部规则（含禁用）
 * - POST   /api/proxy/rules       新建
 * - PUT    /api/proxy/rules/:id   修改
 * - DELETE /api/proxy/rules/:id   删除
 * - POST   /api/proxy/rules/:id/toggle   启用/停用
 *
 * 修改规则后立即失效内存缓存（下次 classifySql 会重新从 DB 加载）。
 */

const VALID_RISK = ['low', 'medium', 'high'];
const VALID_ACTION = ['block', 'warn'];

/** GET /api/proxy/rules */
router.get('/rules', async (_req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `SELECT id, keyword, risk_level, action, enabled, sort_order, description,
              created_at, updated_at
       FROM proxy_danger_rules
       ORDER BY sort_order ASC, keyword ASC`
    );
    res.json({ rules: rows });
  } catch (e) { next(e); }
});

/** POST /api/proxy/rules */
router.post('/rules', async (req, res, next) => {
  try {
    const { keyword, risk_level = 'high', action = 'block', enabled = true,
            sort_order = 0, description } = req.body || {};
    if (!keyword || !String(keyword).trim()) {
      return res.status(400).json({ error: '缺少必填字段：keyword' });
    }
    if (!VALID_RISK.includes(risk_level)) {
      return res.status(400).json({ error: 'risk_level 必须为 low|medium|high' });
    }
    if (!VALID_ACTION.includes(action)) {
      return res.status(400).json({ error: 'action 必须为 block|warn' });
    }
    const kw = String(keyword).trim();
    const id = `pdr_${nanoid(8)}`;
    try {
      const { rows } = await getPool().query(
        `INSERT INTO proxy_danger_rules
          (id, keyword, risk_level, action, enabled, sort_order, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING *`,
        [id, kw, risk_level, action, !!enabled, parseInt(sort_order, 10) || 0,
         description || null]
      );
      invalidateRulesCache();
      res.status(201).json({ rule: rows[0] });
    } catch (err) {
      // 唯一索引冲突：keyword 已存在
      if (err.code === '23505') {
        return res.status(409).json({ error: `关键字已存在: ${kw}` });
      }
      throw err;
    }
  } catch (e) { next(e); }
});

/** PUT /api/proxy/rules/:id */
router.put('/rules/:id', async (req, res, next) => {
  try {
    const { rows: cur } = await getPool().query(
      'SELECT id FROM proxy_danger_rules WHERE id = $1', [req.params.id]
    );
    if (!cur.length) return res.status(404).json({ error: '规则不存在' });

    const { keyword, risk_level, action, enabled, sort_order, description } = req.body || {};
    const sets = [];
    const params = [];
    if (keyword !== undefined) { params.push(String(keyword).trim()); sets.push(`keyword = $${params.length}`); }
    if (risk_level !== undefined) {
      if (!VALID_RISK.includes(risk_level)) return res.status(400).json({ error: 'risk_level 非法' });
      params.push(risk_level); sets.push(`risk_level = $${params.length}`);
    }
    if (action !== undefined) {
      if (!VALID_ACTION.includes(action)) return res.status(400).json({ error: 'action 非法' });
      params.push(action); sets.push(`action = $${params.length}`);
    }
    if (enabled !== undefined) { params.push(!!enabled); sets.push(`enabled = $${params.length}`); }
    if (sort_order !== undefined) {
      params.push(parseInt(sort_order, 10) || 0); sets.push(`sort_order = $${params.length}`);
    }
    if (description !== undefined) { params.push(description || null); sets.push(`description = $${params.length}`); }
    if (!sets.length) return res.status(400).json({ error: '没有可更新的字段' });

    sets.push('updated_at = NOW()');
    params.push(req.params.id);
    try {
      const { rows } = await getPool().query(
        `UPDATE proxy_danger_rules SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
        params
      );
      invalidateRulesCache();
      res.json({ rule: rows[0] });
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: '关键字已被其它规则占用' });
      throw err;
    }
  } catch (e) { next(e); }
});

/** POST /api/proxy/rules/:id/toggle */
router.post('/rules/:id/toggle', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      `UPDATE proxy_danger_rules
       SET enabled = NOT enabled, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '规则不存在' });
    invalidateRulesCache();
    res.json({ rule: rows[0] });
  } catch (e) { next(e); }
});

/** DELETE /api/proxy/rules/:id */
router.delete('/rules/:id', async (req, res, next) => {
  try {
    const { rows } = await getPool().query(
      'DELETE FROM proxy_danger_rules WHERE id = $1 RETURNING id, keyword',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: '规则不存在' });
    invalidateRulesCache();
    res.json({ success: true, deleted: rows[0] });
  } catch (e) { next(e); }
});

/**
 * ============ 阶段5：审计日志清理（手动触发） ============
 * POST /api/proxy/audit/cleanup
 * 返回删除条数 + 保留天数 + 最少保留数
 */
router.post('/audit/cleanup', async (_req, res, next) => {
  try {
    const { runAuditCleanup } = await import('../proxy/cleanup.mjs');
    const r = await runAuditCleanup();
    res.json({ success: true, ...r });
  } catch (e) { next(e); }
});

export default router;
