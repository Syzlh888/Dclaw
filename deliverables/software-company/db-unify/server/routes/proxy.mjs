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
 *
 * 端口分配：从 proxy_port_base（默认 35000）递增找未被 proxy_connections 占用的端口
 * 随机密码：>=12 位，含大小写字母 + 数字 + 特殊字符
 * 密码存储：国密 SM4 可逆加密（GM1: 前缀，复用 crypto-gm.mjs），创建时明文仅返回一次
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getPool } from '../db/pool.mjs';
import { encryptPasswordGm } from '../crypto-gm.mjs';
import proxyManager from '../proxy/manager.mjs';

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
  const pick = (chars) => chars[Math.floor(Math.random() * chars.length)];

  // 保证每种字符至少一个
  let p = pick(upper) + pick(lower) + pick(digits) + pick(special);
  for (let i = p.length; i < len; i += 1) p += pick(all);
  // 打乱顺序
  return p.split('').sort(() => Math.random() - 0.5).join('');
}

/** 生成对外临时账号：proxy_ + 短随机 */
function genProxyUsername() {
  return `proxy_${nanoid(6)}`;
}

/** 从 base 起递增，找第一个未被 proxy_connections 占用的端口 */
async function findFreePort(base) {
  let port = base;
  const guard = 0;
  while (port < MAX_PORT_BASE) {
    const { rows } = await getPool().query(
      'SELECT 1 FROM proxy_connections WHERE proxy_port = $1 LIMIT 1',
      [port]
    );
    if (rows.length === 0) return port;
    port += 1;
    if (guard > 10000) break;
  }
  throw new Error('代理端口段已用尽，无法分配端口');
}

/** 从数据库行中取出代理连接（脱敏密码） */
function serializeProxy(row) {
  if (!row) return null;
  const { proxy_password: _pw, ...rest } = row;
  let allowedIps = rest.allowed_ips;
  if (typeof allowedIps === 'string') {
    try { allowedIps = JSON.parse(allowedIps); } catch { allowedIps = null; }
  }
  return { ...rest, allowed_ips: allowedIps, has_password: !!_pw };
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
      expires_at, // 必填，ISO 时间
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
         expires_at, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'active',$14)
       RETURNING *`,
      [id, name, db_type, real_connection_id, port, username, encryptedPassword,
       audit_mode, access_mode, maxConns, allowedIpsJson, base, expires.toISOString(),
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

    const { name, audit_mode, access_mode, max_connections, allowed_ips, expires_at } = req.body || {};
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
 * 审计查询：按 proxy_connection_id / proxy_username / client_ip / 时间范围筛选 + 分页
 */
router.get('/audit', async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
    const { proxy_connection_id, proxy_username, client_ip, start, end } = req.query;

    const where = [];
    const params = [];
    if (proxy_connection_id) { params.push(proxy_connection_id); where.push(`proxy_connection_id = $${params.length}`); }
    if (proxy_username) { params.push(proxy_username); where.push(`proxy_username = $${params.length}`); }
    if (client_ip) { params.push(client_ip); where.push(`client_ip = $${params.length}::inet`); }
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

export default router;
