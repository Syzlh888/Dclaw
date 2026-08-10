/**
 * DClaw 数据库代理网关 — 独立代理进程
 *
 * 运行方式：
 *   node server/proxy/index.mjs
 *
 * 职责：
 *  - 从 DClaw 主库加载所有 active 且未过期的 proxy_connections
 *  - 每个代理连接在其 proxy_port 上监听 TCP
 *  - 客户端经 PG 协议认证（临时账号 + 国密解密校验密码）+ 有效期/IP/并发校验
 *  - 通过后用内部账号连接真实库，双向转发 + 每条 SQL 审计入库
 *  - audit_mode=intercept 时拦截危险 SQL
 *  - 周期性同步：新增连接自动监听、撤销/过期自动断开并标记
 *
 * 独立进程运行，主服务崩溃不影响代理（见 docs/db-proxy-gateway-design.md）。
 */
import net from 'node:net';
import { getPool, closePool } from '../db/pool.mjs';
import { decryptPassword } from '../crypto.mjs';
import { ProxySession } from './session.mjs';
import { getAdapter } from './adapters/index.mjs';
import { startAuditCleanupLoop } from './cleanup.mjs';
import { startHealthCheckLoop } from './healthcheck.mjs';

const SYNC_INTERVAL_MS = parseInt(process.env.PROXY_SYNC_INTERVAL_MS, 10) || 10000;

/** port -> { proxy, server, sessions:Set } */
const listeners = new Map();

/** sync 重叠保护：sync() 是 async，前一次未完成时不并发 */
let syncRunning = false;

function log(...args) {
  console.log(`[proxy-gateway]`, ...args);
}

/** 加载所有 active 且未过期的代理连接 + 真实连接内部信息 */
async function loadActiveProxies() {
  const { rows } = await getPool().query(
    `SELECT pc.*, c.host AS real_host, c.port AS real_port, c.username AS real_username,
            c.password_encrypted AS real_password_encrypted, c.database_name AS real_database,
            c.driver AS real_driver
     FROM proxy_connections pc
     LEFT JOIN connections c ON c.id = pc.real_connection_id
     WHERE pc.status = 'active' AND pc.expires_at > NOW()`
  );

  return rows.map((r) => {
    let allowedIps = r.allowed_ips;
    if (typeof allowedIps === 'string') {
      try { allowedIps = JSON.parse(allowedIps); } catch { allowedIps = null; }
    }
    const realPassword = decryptPassword(r.real_password_encrypted || '');
    return {
      id: r.id,
      name: r.name,
      db_type: r.db_type,
      real_connection_id: r.real_connection_id,
      proxy_port: r.proxy_port,
      proxy_username: r.proxy_username,
      proxy_password: r.proxy_password,
      audit_mode: r.audit_mode,
      access_mode: r.access_mode,
      allow_blind: !!r.allow_blind,
      max_connections: r.max_connections,
      allowed_ips: allowedIps,
      proxy_port_base: r.proxy_port_base,
      expires_at: r.expires_at,
      status: r.status,
      real: {
        host: r.real_host,
        port: r.real_port,
        username: r.real_username,
        password: realPassword,
        database_name: r.real_database,
      },
    };
  });
}

/** 为一个代理连接创建 TCP 监听 */
function startListener(proxy) {
  if (listeners.has(proxy.proxy_port)) {
    // 端口已监听：仅更新配置（密码/审计模式等可能已变）
    const entry = listeners.get(proxy.proxy_port);
    entry.proxy = proxy;
    return entry.server;
  }
  const server = net.createServer((socket) => {
    const entry = listeners.get(proxy.proxy_port);
    if (!entry) { socket.destroy(); return; }
    if (entry.sessions.size >= entry.proxy.max_connections) {
      try {
        // 用适配器构造对应该 db_type 的错误响应（PG: ErrorResponse, MySQL: ERR 包, DM: 空→直接断开）
        const adapter = getAdapter(entry.proxy.db_type, { client: socket, proxy: entry.proxy });
        const errBuf = adapter.buildAuthError(`超过最大并发连接数（${entry.proxy.max_connections}）`);
        if (errBuf && errBuf.length) socket.write(errBuf);
      } catch { /* ignore */ }
      socket.destroy();
      return;
    }
    const proxyCopy = { ...entry.proxy, currentConnections: entry.sessions.size };
    const session = new ProxySession(socket, proxyCopy, (s) => {
      entry.sessions.delete(s);
    });
    entry.sessions.add(session);
  });

  server.on('error', (err) => {
    log(`监听端口 ${proxy.proxy_port} 失败:`, err.message);
  });

  server.listen(proxy.proxy_port, '0.0.0.0', () => {
    log(`✅ 代理连接 [${proxy.name}] 监听端口 ${proxy.proxy_port} (audit=${proxy.audit_mode}, max=${proxy.max_connections})`);
  });

  listeners.set(proxy.proxy_port, { proxy, server, sessions: new Set() });
  return server;
}

/** 关闭某端口的监听并断开其所有会话 */
function stopListener(port, reason) {
  const entry = listeners.get(port);
  if (!entry) return;
  log(`关闭代理连接 ${entry.proxy.name} (端口 ${port}): ${reason}`);
  for (const s of [...entry.sessions]) s.close(`listener closed: ${reason}`);
  entry.sessions.clear();
  try { entry.server.close(); } catch { /* ignore */ }
  listeners.delete(port);
}

/** 周期性同步：加载 active 连接，启停监听，标记过期 */
async function sync() {
  // 防止上一次 sync 还没结束，下一次 tick 又触发（避免 active listener 重叠）
  if (syncRunning) return;
  syncRunning = true;
  try {
    const actives = await loadActiveProxies();
    const activePorts = new Set();
    const activeIds = new Set();

    for (const p of actives) {
      activePorts.add(p.proxy_port);
      activeIds.add(p.id);
      startListener(p);
    }

    // 关闭已撤销/过期连接的监听
    for (const [port, entry] of [...listeners]) {
      const stillActive = activePorts.has(port) && activeIds.has(entry.proxy.id);
      if (!stillActive) {
        stopListener(port, '已撤销或过期');
      }
    }

    // 把已过期但仍 active 的记录标记为 expired
    await getPool().query(
      `UPDATE proxy_connections
       SET status = 'expired'
       WHERE status = 'active' AND expires_at <= NOW()`
    ).catch((e) => {
      // 过期标记失败不应阻塞后续同步，但需要可观测
      console.warn('[proxy-gateway] 标记过期连接失败:', e?.message);
    });
  } catch (err) {
    log('同步失败:', err.message);
  } finally {
    syncRunning = false;
  }
}

async function main() {
  log('启动 DClaw 数据库代理网关独立进程...');
  try {
    const r = await getPool().query('SELECT NOW() AS now');
    log('主库连接成功, 时间:', r.rows[0].now);
  } catch (e) {
    log('❌ 无法连接主库:', e.message);
    process.exit(1);
  }

  await sync();
  setInterval(sync, SYNC_INTERVAL_MS);

  // 阶段5：审计日志归档清理
  const cancelCleanup = startAuditCleanupLoop({ log, error: console.error });
  // 阶段6：代理连接健康检查
  const cancelHealth = startHealthCheckLoop({ log, error: console.error });

  const shutdown = async (sig) => {
    log(`收到 ${sig}，正在关闭...`);
    cancelCleanup();
    cancelHealth();
    for (const [port] of [...listeners]) stopListener(port, '进程退出');
    await closePool();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  // 独立代理进程：uncaughtException 后进程状态可能已不一致（如 DB pool 泄漏），
  // 不能仅 log 后继续。最安全的做法是 log 后退出，让 supervisor 重启。
  process.on('uncaughtException', (err) => {
    log('[uncaughtException]', err?.stack || err?.message || err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (r) => {
    log('[unhandledRejection]', r?.stack || r?.message || r);
    shutdown('unhandledRejection');
  });

  log(`代理网关运行中，同步周期 ${SYNC_INTERVAL_MS}ms`);
}

main();
