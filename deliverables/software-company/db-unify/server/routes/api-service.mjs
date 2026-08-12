/**
 * API 服务 — 管理端路由（/api/api-service）
 *
 * 提供 api_endpoints / api_tokens / api_call_logs 的 CRUD 与测试调用。
 * 公开调用路由在 api-public.mjs，本文件只供 DClaw 已登录管理员使用。
 *
 * 接口定义：
 *   GET    /api/api-service/endpoints                       接口列表
 *   POST   /api/api-service/endpoints                       新建接口
 *   PUT    /api/api-service/endpoints/:id                   更新接口
 *   DELETE /api/api-service/endpoints/:id                   删除接口
 *   POST   /api/api-service/endpoints/:id/test              测试接口（不走 Token / 限流）
 *   GET    /api/api-service/endpoints/:id/tokens            接口下 Token 列表（管理用）
 *   GET    /api/api-service/endpoints/:id/logs              调用日志
 *   GET    /api/api-service/tokens                          Token 列表
 *   POST   /api/api-service/tokens                          生成 Token（明文只返回一次）
 *   PUT    /api/api-service/tokens/:id                      更新 Token
 *   DELETE /api/api-service/tokens/:id                      删除 Token
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import crypto from 'node:crypto';
import { getPool } from '../db/pool.mjs';
import { encryptPasswordGm, decryptPasswordGm, sm3Hash } from '../crypto-gm.mjs';
import { validateSql } from '../sqlValidator.mjs';
import {
  executeQuery,
  createDbConnection,
  closeConnection,
} from './connections.mjs';
import { decryptPassword } from '../crypto.mjs';

const router = Router();

/* ===========================================================
 * 工具
 * =========================================================== */

/** JSON 字段解析容错：返回 [] / {} */
function parseJsonSafe(v, fallback) {
  if (v === null || v === undefined || v === '') return fallback;
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
}

/** 检测 SQL 中的命名占位符 :name */
function detectSqlParams(sql) {
  if (!sql) return [];
  const names = new Set();
  // 去掉单行注释 / 块注释 / 字符串字面量后再扫描，避免误报
  const cleaned = sql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/'(?:''|[^'])*'/g, "''");
  const re = /(?:^|[^A-Za-z0-9_]):([A-Za-z_][A-Za-z0-9_]*)/g;
  let m;
  while ((m = re.exec(cleaned)) !== null) names.add(m.group(1));
  return Array.from(names);
}

/** 校验 params_json：必须是 [{name,type,required,label}...] 结构 */
function normalizeParams(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p) => p && typeof p === 'object' && p.name)
    .map((p) => ({
      name: String(p.name),
      type: ['string', 'number', 'boolean', 'date'].includes(p.type) ? p.type : 'string',
      required: !!p.required,
      label: p.label ? String(p.label) : String(p.name),
    }));
}

/** 把 :name 命名占位符替换成 $1, $2, ...，返回参数数组（注意保留 SQL 字面量 / 注释） */
function bindNamedParams(sql, params) {
  const paramNames = detectSqlParams(sql);
  const values = [];
  let i = 1;
  let out = '';
  let cursor = 0;
  // 简易状态机：单引号字符串 / 双引号标识符 / 行注释 / 块注释 / 命名占位符
  while (cursor < sql.length) {
    const c = sql[cursor];
    const next2 = sql.slice(cursor, cursor + 2);
    // 行注释
    if (next2 === '--') {
      const end = sql.indexOf('\n', cursor);
      const stop = end === -1 ? sql.length : end;
      out += sql.slice(cursor, stop);
      cursor = stop;
      continue;
    }
    // 块注释
    if (next2 === '/*') {
      const end = sql.indexOf('*/', cursor + 2);
      const stop = end === -1 ? sql.length : end + 2;
      out += sql.slice(cursor, stop);
      cursor = stop;
      continue;
    }
    // 单引号字符串
    if (c === "'") {
      const start = cursor;
      cursor += 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'" && sql[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === "'") {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      out += sql.slice(start, cursor);
      continue;
    }
    // 双引号标识符（PostgreSQL）
    if (c === '"') {
      const start = cursor;
      cursor += 1;
      while (cursor < sql.length) {
        if (sql[cursor] === '"' && sql[cursor + 1] === '"') {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === '"') {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      out += sql.slice(start, cursor);
      continue;
    }
    // 命名占位符 :name
    if (c === ':') {
      const m = sql.slice(cursor + 1).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
      if (m) {
        const name = m[1];
        if (paramNames.includes(name)) {
          out += `$${i++}`;
          values.push(params[name] !== undefined ? params[name] : null);
          cursor += 1 + name.length;
          continue;
        }
      }
    }
    out += c;
    cursor += 1;
  }
  return { sql: out, values, paramNames };
}

/** 将请求参数按参数定义转换为可用值（类型转换 / 必填校验） */
function coerceParams(defs, input) {
  const out = {};
  const errors = [];
  for (const def of defs) {
    let v = input[def.name];
    if (v === undefined || v === null || v === '') {
      if (def.required) errors.push(`参数 ${def.name} 缺失`);
      out[def.name] = null;
      continue;
    }
    switch (def.type) {
      case 'number': {
        const n = Number(v);
        if (Number.isNaN(n)) errors.push(`参数 ${def.name} 不是合法数字`);
        else out[def.name] = n;
        break;
      }
      case 'boolean': {
        if (typeof v === 'boolean') out[def.name] = v;
        else if (v === 'true' || v === '1' || v === 1) out[def.name] = true;
        else if (v === 'false' || v === '0' || v === 0) out[def.name] = false;
        else errors.push(`参数 ${def.name} 不是合法布尔值`);
        break;
      }
      case 'date': {
        const t = new Date(v).getTime();
        if (Number.isNaN(t)) errors.push(`参数 ${def.name} 不是合法日期`);
        else out[def.name] = new Date(t).toISOString();
        break;
      }
      default:
        out[def.name] = String(v);
    }
  }
  return { values: out, errors };
}

/** 把 mask_fields 列对单元格值打码 */
function maskValue(fieldName, val) {
  if (val === null || val === undefined) return val;
  const s = String(val);
  const lower = String(fieldName).toLowerCase();
  // 身份证 18 位
  if (/idcard|id_card|identity|身份证/.test(lower)) {
    if (s.length >= 8) return s.slice(0, 4) + '**********' + s.slice(-4);
    return s.replace(/./g, '*');
  }
  // 手机号
  if (/phone|mobile|手机/.test(lower)) {
    if (s.length === 11) return s.slice(0, 3) + '****' + s.slice(-4);
    return s.replace(/.(?=.{4})/g, '*');
  }
  // 邮箱
  if (/email|mail|邮箱/.test(lower)) {
    const at = s.indexOf('@');
    if (at > 1) return s[0] + '***' + s.slice(at);
    return s;
  }
  // 姓名（默认前两个字保留）
  if (/name|姓名/.test(lower)) {
    if (s.length <= 1) return s;
    if (s.length <= 3) return s[0] + '*'.repeat(s.length - 1);
    return s[0] + '*'.repeat(s.length - 1);
  }
  // 默认中间打码
  if (s.length <= 2) return '*'.repeat(s.length);
  return s[0] + '*'.repeat(Math.max(2, s.length - 2)) + s[s.length - 1];
}

/** 对结果行应用脱敏 */
function applyMask(rows, maskFields) {
  if (!Array.isArray(maskFields) || maskFields.length === 0) return rows;
  const fields = maskFields.map((f) => String(f).toLowerCase());
  return rows.map((row) => {
    const next = { ...row };
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(next, f)) {
        next[f] = maskValue(f, next[f]);
      }
    }
    return next;
  });
}

/** 把 endpoint 行序列化为对外结构（不带 token 明文，不带 page_size 之类内部字段） */
function serializeEndpoint(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    type: row.type,
    connection_id: row.connection_id,
    schema_name: row.schema_name || '',
    table_name: row.table_name || '',
    sql_text: row.sql_text || '',
    params: parseJsonSafe(row.params_json, []),
    page_size_max: row.page_size_max,
    mask_fields: parseJsonSafe(row.mask_fields, []),
    status: row.status,
    created_by: row.created_by || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Token 行序列化（明文永远不返回） */
function serializeToken(row) {
  if (!row) return null;
  const ids = (row.endpoint_ids || '').split(',').map((s) => s.trim()).filter(Boolean);
  return {
    id: row.id,
    scope: row.scope,
    endpoint_ids: ids,
    name: row.name || '',
    ip_whitelist: (row.ip_whitelist || '').split(',').map((s) => s.trim()).filter(Boolean),
    qps_limit: row.qps_limit,
    daily_limit: row.daily_limit,
    expires_at: row.expires_at,
    status: row.status,
    created_by: row.created_by || '',
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    has_token: !!row.token,
  };
}

/* ===========================================================
 * 端点管理
 * =========================================================== */

/** GET /api/api-service/endpoints */
router.get('/endpoints', async (_req, res) => {
  const { rows } = await getPool().query(
    'SELECT * FROM api_endpoints ORDER BY created_at DESC'
  );
  res.json({ endpoints: rows.map(serializeEndpoint) });
});

/** POST /api/api-service/endpoints */
router.post('/endpoints', async (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.type || !b.connection_id) {
    return res.status(400).json({ error: '名称、类型、数据库连接为必填' });
  }
  if (!['sql', 'table'].includes(b.type)) {
    return res.status(400).json({ error: 'type 仅支持 sql / table' });
  }

  if (b.type === 'sql') {
    if (!b.sql_text || !b.sql_text.trim()) {
      return res.status(400).json({ error: 'SQL 接口必须填写 sql_text' });
    }
    const check = validateSql(b.sql_text, { readOnlyMode: true });
    if (!check.valid) {
      return res.status(400).json({ error: `SQL 校验失败：${check.errors.join('；')}` });
    }
  } else {
    if (!b.table_name) {
      return res.status(400).json({ error: '表接口必须选择 table_name' });
    }
  }

  const id = nanoid(8);
  const now = new Date().toISOString();
  const params = normalizeParams(parseJsonSafe(b.params, []));
  const masks = Array.isArray(b.mask_fields) ? b.mask_fields : [];
  const createdBy = (req.user && req.user.username) || 'admin';

  await getPool().query(
    `INSERT INTO api_endpoints (
       id, name, description, type, connection_id,
       schema_name, table_name, sql_text, params_json, page_size_max,
       mask_fields, status, created_by, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      id,
      String(b.name).trim(),
      b.description ? String(b.description) : null,
      b.type,
      String(b.connection_id),
      b.schema_name || null,
      b.table_name || null,
      b.sql_text || null,
      JSON.stringify(params),
      Number(b.page_size_max) > 0 ? Number(b.page_size_max) : 100,
      JSON.stringify(masks),
      b.status === 'disabled' ? 'disabled' : 'active',
      createdBy,
      now,
      now,
    ]
  );

  const { rows } = await getPool().query('SELECT * FROM api_endpoints WHERE id = $1', [id]);
  res.status(201).json({ endpoint: serializeEndpoint(rows[0]) });
});

/** PUT /api/api-service/endpoints/:id */
router.put('/endpoints/:id', async (req, res) => {
  const id = req.params.id;
  const exist = await getPool().query('SELECT * FROM api_endpoints WHERE id = $1', [id]);
  if (exist.rows.length === 0) return res.status(404).json({ error: '接口不存在' });
  const cur = exist.rows[0];
  const b = req.body || {};

  // 合并：未传字段保留旧值
  const next = {
    name: b.name !== undefined ? String(b.name).trim() : cur.name,
    description: b.description !== undefined ? b.description : cur.description,
    type: b.type !== undefined ? b.type : cur.type,
    connection_id: b.connection_id !== undefined ? String(b.connection_id) : cur.connection_id,
    schema_name: b.schema_name !== undefined ? b.schema_name : cur.schema_name,
    table_name: b.table_name !== undefined ? b.table_name : cur.table_name,
    sql_text: b.sql_text !== undefined ? b.sql_text : cur.sql_text,
    params: b.params !== undefined ? normalizeParams(parseJsonSafe(b.params, [])) : parseJsonSafe(cur.params_json, []),
    page_size_max: b.page_size_max !== undefined ? Number(b.page_size_max) : cur.page_size_max,
    mask_fields: b.mask_fields !== undefined ? (Array.isArray(b.mask_fields) ? b.mask_fields : []) : parseJsonSafe(cur.mask_fields, []),
    status: b.status !== undefined ? (b.status === 'disabled' ? 'disabled' : 'active') : cur.status,
  };

  if (!['sql', 'table'].includes(next.type)) {
    return res.status(400).json({ error: 'type 仅支持 sql / table' });
  }
  if (next.type === 'sql') {
    if (!next.sql_text || !next.sql_text.trim()) {
      return res.status(400).json({ error: 'SQL 接口必须填写 sql_text' });
    }
    const check = validateSql(next.sql_text, { readOnlyMode: true });
    if (!check.valid) {
      return res.status(400).json({ error: `SQL 校验失败：${check.errors.join('；')}` });
    }
  } else if (!next.table_name) {
    return res.status(400).json({ error: '表接口必须选择 table_name' });
  }

  await getPool().query(
    `UPDATE api_endpoints SET
       name=$1, description=$2, type=$3, connection_id=$4,
       schema_name=$5, table_name=$6, sql_text=$7, params_json=$8,
       page_size_max=$9, mask_fields=$10, status=$11, updated_at=NOW()
     WHERE id=$12`,
    [
      next.name, next.description, next.type, next.connection_id,
      next.schema_name, next.table_name, next.sql_text,
      JSON.stringify(next.params), next.page_size_max,
      JSON.stringify(next.mask_fields), next.status, id,
    ]
  );

  const after = await getPool().query('SELECT * FROM api_endpoints WHERE id = $1', [id]);
  res.json({ endpoint: serializeEndpoint(after.rows[0]) });
});

/** DELETE /api/api-service/endpoints/:id */
router.delete('/endpoints/:id', async (req, res) => {
  const id = req.params.id;
  // 清理引用此接口的 Token 的 endpoint_ids
  const tokens = await getPool().query('SELECT id, endpoint_ids FROM api_tokens WHERE endpoint_ids LIKE $1', [`%${id}%`]);
  for (const tk of tokens.rows) {
    const ids = (tk.endpoint_ids || '').split(',').map((s) => s.trim()).filter((x) => x && x !== id);
    await getPool().query('UPDATE api_tokens SET endpoint_ids = $1 WHERE id = $2', [ids.join(','), tk.id]);
  }
  // 审计日志按业务约定保留，不级联删除
  await getPool().query('DELETE FROM api_endpoints WHERE id = $1', [id]);
  res.json({ success: true });
});

/* ===========================================================
 * 测试调用（不走 Token / 限流）
 * =========================================================== */

/** POST /api/api-service/endpoints/:id/test
 * Body: { params?: object, page?: number, pageSize?: number }
 */
router.post('/endpoints/:id/test', async (req, res) => {
  const t0 = Date.now();
  try {
    const { rows } = await getPool().query('SELECT * FROM api_endpoints WHERE id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: '接口不存在' });
    const ep = rows[0];

    const connRow = await getPool().query('SELECT * FROM connections WHERE id = $1', [ep.connection_id]);
    if (connRow.rows.length === 0) return res.status(400).json({ error: '关联的数据库连接不存在' });
    const conn = connRow.rows[0];
    const password = decryptPassword(conn.password_encrypted || '');

    const defs = parseJsonSafe(ep.params_json, []);
    const userParams = (req.body && req.body.params) || {};
    const coerced = coerceParams(defs, userParams);
    if (coerced.errors.length > 0) {
      return res.status(400).json({ error: coerced.errors.join('；') });
    }

    // 构造 SQL
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

    const ro = validateSql(rawSql, { readOnlyMode: true });
    if (!ro.valid) return res.status(400).json({ error: ro.errors.join('；') });

    const bound = bindNamedParams(rawSql, coerced.values);
    const paramsArr = bound.values;

    const page = Math.max(1, Number(req.body?.page) || 1);
    const reqPageSize = Math.max(1, Number(req.body?.pageSize) || 20);
    const pageSize = Math.min(reqPageSize, ep.page_size_max || 100);
    const offset = (page - 1) * pageSize;
    const limitedSql = `${bound.sql.replace(/;+\s*$/, '')} LIMIT ${pageSize} OFFSET ${offset}`;

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
      const masked = applyMask(result.rows || [], parseJsonSafe(ep.mask_fields, []));
      res.json({
        success: true,
        duration_ms: Date.now() - t0,
        data: masked,
        columns: result.columns || [],
        page,
        pageSize,
        bound_params: paramsArr,
        total_returned: masked.length,
        bounded_sql: limitedSql,
      });
    } finally {
      await closeConnection(dbConn, conn.driver, conn.custom_driver_id).catch(() => {});
    }
  } catch (err) {
    res.status(500).json({ error: err.message || '测试调用失败', duration_ms: Date.now() - t0 });
  }
});

/* ===========================================================
 * Token 管理
 * =========================================================== */

/** GET /api/api-service/endpoints/:id/tokens */
router.get('/endpoints/:id/tokens', async (req, res) => {
  const epId = req.params.id;
  const { rows } = await getPool().query(
    `SELECT * FROM api_tokens
       WHERE scope = 'all'
          OR endpoint_ids = ''
          OR endpoint_ids LIKE $1
          OR endpoint_ids LIKE $2
          OR endpoint_ids LIKE $3
       ORDER BY created_at DESC`,
    [`${epId},%`, `%,${epId},%`, `%,${epId}`]
  );
  res.json({ tokens: rows.map(serializeToken) });
});

/** GET /api/api-service/tokens */
router.get('/tokens', async (_req, res) => {
  const { rows } = await getPool().query('SELECT * FROM api_tokens ORDER BY created_at DESC');
  res.json({ tokens: rows.map(serializeToken) });
});

/** POST /api/api-service/tokens
 * Body: { name, scope, endpoint_ids:[], ip_whitelist:[], qps_limit, daily_limit, expires_at }
 * 返回：明文 token 仅此一次
 */
router.post('/tokens', async (req, res) => {
  const b = req.body || {};
  if (!b.scope || !['all', 'select'].includes(b.scope)) {
    return res.status(400).json({ error: 'scope 仅支持 all / select' });
  }
  if (b.scope === 'select' && (!Array.isArray(b.endpoint_ids) || b.endpoint_ids.length === 0)) {
    return res.status(400).json({ error: 'scope=select 时必须至少指定一个接口' });
  }
  const id = nanoid(8);
  // CSPRNG 生成 32 字节 -> 64 hex
  const rawToken = crypto.randomBytes(32).toString('hex');
  const encToken = encryptPasswordGm(rawToken);
  const createdBy = (req.user && req.user.username) || 'admin';
  const epIds = Array.isArray(b.endpoint_ids) ? b.endpoint_ids.filter(Boolean).join(',') : '';
  const iplist = Array.isArray(b.ip_whitelist)
    ? b.ip_whitelist.map((s) => String(s).trim()).filter(Boolean).join(',')
    : '';
  const expires = b.expires_at ? new Date(b.expires_at).toISOString() : null;
  if (expires && Number.isNaN(new Date(b.expires_at).getTime())) {
    return res.status(400).json({ error: 'expires_at 格式不合法' });
  }

  await getPool().query(
    `INSERT INTO api_tokens (
       id, scope, endpoint_ids, token, name, ip_whitelist,
       qps_limit, daily_limit, expires_at, status, created_by, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,NOW())`,
    [
      id,
      b.scope,
      epIds,
      encToken,
      b.name ? String(b.name) : '',
      iplist,
      Number(b.qps_limit) > 0 ? Number(b.qps_limit) : 10,
      Number(b.daily_limit) > 0 ? Number(b.daily_limit) : 1000,
      expires,
      createdBy,
    ]
  );

  const { rows } = await getPool().query('SELECT * FROM api_tokens WHERE id = $1', [id]);
  res.status(201).json({
    token: serializeToken(rows[0]),
    // 明文只返回一次
    plaintext: rawToken,
    reminder: '请妥善保存此 Token 明文，仅展示这一次，后续将无法再次查看。',
  });
});

/** PUT /api/api-service/tokens/:id */
router.put('/tokens/:id', async (req, res) => {
  const id = req.params.id;
  const exist = await getPool().query('SELECT * FROM api_tokens WHERE id = $1', [id]);
  if (exist.rows.length === 0) return res.status(404).json({ error: 'Token 不存在' });
  const cur = exist.rows[0];
  const b = req.body || {};

  const scope = b.scope !== undefined ? b.scope : cur.scope;
  if (!['all', 'select'].includes(scope)) return res.status(400).json({ error: 'scope 仅支持 all / select' });
  const epIds = Array.isArray(b.endpoint_ids)
    ? b.endpoint_ids.filter(Boolean).join(',')
    : (cur.endpoint_ids || '');
  if (scope === 'select' && !epIds) {
    return res.status(400).json({ error: 'scope=select 时必须至少指定一个接口' });
  }
  const iplist = Array.isArray(b.ip_whitelist)
    ? b.ip_whitelist.map((s) => String(s).trim()).filter(Boolean).join(',')
    : (cur.ip_whitelist || '');
  let expires = cur.expires_at;
  if (b.expires_at !== undefined) {
    if (b.expires_at === null || b.expires_at === '') expires = null;
    else {
      const t = new Date(b.expires_at);
      if (Number.isNaN(t.getTime())) return res.status(400).json({ error: 'expires_at 格式不合法' });
      expires = t.toISOString();
    }
  }

  await getPool().query(
    `UPDATE api_tokens SET
       scope=$1, endpoint_ids=$2, name=$3, ip_whitelist=$4,
       qps_limit=$5, daily_limit=$6, expires_at=$7, status=$8
     WHERE id=$9`,
    [
      scope,
      epIds,
      b.name !== undefined ? String(b.name) : cur.name,
      iplist,
      Number(b.qps_limit) > 0 ? Number(b.qps_limit) : cur.qps_limit,
      Number(b.daily_limit) > 0 ? Number(b.daily_limit) : cur.daily_limit,
      expires,
      b.status !== undefined ? (b.status === 'disabled' ? 'disabled' : 'active') : cur.status,
      id,
    ]
  );

  const after = await getPool().query('SELECT * FROM api_tokens WHERE id = $1', [id]);
  res.json({ token: serializeToken(after.rows[0]) });
});

/** DELETE /api/api-service/tokens/:id */
router.delete('/tokens/:id', async (req, res) => {
  const id = req.params.id;
  await getPool().query('DELETE FROM api_tokens WHERE id = $1', [id]);
  res.json({ success: true });
});

/* ===========================================================
 * 调用日志
 * =========================================================== */

/** GET /api/api-service/endpoints/:id/logs?token_id=&status_code=&page=&pageSize= */
router.get('/endpoints/:id/logs', async (req, res) => {
  const epId = req.params.id;
  const conditions = ['endpoint_id = $1'];
  const params = [epId];
  let idx = 2;
  if (req.query.token_id) {
    conditions.push(`token_id = $${idx++}`);
    params.push(req.query.token_id);
  }
  if (req.query.status_code !== undefined && req.query.status_code !== '') {
    conditions.push(`status_code = $${idx++}`);
    params.push(Number(req.query.status_code));
  }
  const where = conditions.join(' AND ');
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const offset = (page - 1) * pageSize;
  const cnt = await getPool().query(`SELECT COUNT(*)::int AS c FROM api_call_logs WHERE ${where}`, params);
  const total = cnt.rows[0].c;
  const { rows } = await getPool().query(
    `SELECT * FROM api_call_logs WHERE ${where}
       ORDER BY called_at DESC LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );
  res.json({
    logs: rows.map((r) => ({
      id: r.id,
      endpoint_id: r.endpoint_id,
      token_id: r.token_id,
      ip: r.ip,
      params_hash: r.params_hash,
      status_code: r.status_code,
      error_msg: r.error_msg,
      duration_ms: r.duration_ms,
      called_at: r.called_at,
    })),
    total,
    page,
    pageSize,
  });
});

/* ===========================================================
 * 辅助：取连接下的表清单（前端在 EndpointDialog 选表用）
 * =========================================================== */

/** GET /api/api-service/connections/:id/tables?schema=xxx */
router.get('/connections/:id/tables', async (req, res) => {
  const connRow = await getPool().query('SELECT * FROM connections WHERE id = $1', [req.params.id]);
  if (connRow.rows.length === 0) return res.status(404).json({ error: '连接不存在' });
  const conn = connRow.rows[0];
  const password = decryptPassword(conn.password_encrypted || '');
  const targetSchema = req.query.schema || conn.schema_name || '';
  try {
    // 复用 connections.mjs 的元数据查询：动态加载避免循环依赖
    const mod = await import('./connections.mjs');
    const tables = await mod.discoverMetadata(
      conn.driver, conn.host, conn.port, conn.username, password,
      conn.database_name, targetSchema, conn.custom_driver_id
    );
    res.json({ tables });
  } catch (e) {
    res.status(500).json({ error: e.message || '取表清单失败' });
  }
});

/** GET /api/api-service/connections/:id/columns?schema=xxx&table=yyy
 * 表接口用：返回列清单，供 mask_fields 多选
 */
router.get('/connections/:id/columns', async (req, res) => {
  const connRow = await getPool().query('SELECT * FROM connections WHERE id = $1', [req.params.id]);
  if (connRow.rows.length === 0) return res.status(404).json({ error: '连接不存在' });
  const conn = connRow.rows[0];
  const password = decryptPassword(conn.password_encrypted || '');
  const schema = req.query.schema || conn.schema_name || '';
  const table = req.query.table;
  if (!table) return res.status(400).json({ error: 'table 必填' });
  try {
    const dbConn = await createDbConnection({
      driver: conn.driver, host: conn.host, port: conn.port,
      username: conn.username, password,
      database: conn.database_name || '', schema,
      customDriverId: conn.custom_driver_id || undefined,
    });
    try {
      const sql = schema
        ? `SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`
        : `SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`;
      const result = await executeQuery(dbConn, conn.driver, sql, 30000, conn.custom_driver_id);
      const cols = (result.rows || []).map((r) => ({ name: r.column_name, type: r.data_type }));
      res.json({ columns: cols });
    } finally {
      await closeConnection(dbConn, conn.driver, conn.custom_driver_id).catch(() => {});
    }
  } catch (e) {
    res.status(500).json({ error: e.message || '取列清单失败' });
  }
});

/* ===========================================================
 * 给公开调用路由用的内部工具 export
 * =========================================================== */
export const _internal = {
  serializeEndpoint,
  serializeToken,
  parseJsonSafe,
  detectSqlParams,
  bindNamedParams,
  coerceParams,
  applyMask,
  maskValue,
};

export default router;