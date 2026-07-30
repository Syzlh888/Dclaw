/**
 * PG 连接池 — 使用国密解密后的配置
 */
import pg from 'pg';
import { loadDbConfig } from './config-loader.mjs';

const { Pool } = pg;
let pool = null;

export function getPool() {
  if (pool) return pool;
  const cfg = loadDbConfig();
  pool = new Pool({
    host: cfg.host,
    port: cfg.port,
    user: cfg.user,
    password: cfg.password,
    database: cfg.database,
    ssl: cfg.ssl,
    // 关键修复：强制 UTF-8 编码，避免中文写入时被错误解释
    client_encoding: 'UTF8',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  // 兜底：每个新连接再 SET 一次 client_encoding，防止 libpq 协商中退化
  pool.on('connect', (client) => {
    client.query("SET client_encoding TO 'UTF8'").catch((err) => {
      console.error('[pg-pool] SET client_encoding failed:', err.message);
    });
  });
  pool.on('error', (err) => console.error('[pg-pool] Unexpected error:', err));
  return pool;
}

export async function query(text, params) {
  return getPool().query(text, params);
}

export async function withTransaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** 启动时自检：能不能连上 */
export async function pingDb() {
  const r = await query('SELECT NOW() AS now, version() AS ver');
  console.log('[pg] ✅ 连接成功，服务器时间:', r.rows[0].now);
  console.log('[pg] 版本:', String(r.rows[0].ver).split(',')[0]);
  return r.rows[0];
}
