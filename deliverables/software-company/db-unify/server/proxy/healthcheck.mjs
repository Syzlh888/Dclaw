/**
 * 代理网关 — 后台健康检查（阶段6 优化）
 *
 * 周期对所有 active 且未过期的代理连接做 TCP 连通性探测：
 *   - 写入 proxy_connections.last_health_check_at
 *   - 更新 health_status（ok / fail）
 *   - 失败时记录 last_error（脱敏，不含密码/账号）
 *
 * 配置（环境变量）：
 *   PROXY_HEALTH_CHECK_ENABLED  默认 true
 *   PROXY_HEALTH_CHECK_INTERVAL_MS 默认 60000 (60s)
 *   PROXY_HEALTH_CHECK_TIMEOUT_MS  默认 3000
 */
import net from 'node:net';
import { getPool } from '../db/pool.mjs';

const DEFAULT_INTERVAL_MS = 60000;
const DEFAULT_TIMEOUT_MS = 3000;

function isEnabled() {
  const v = process.env.PROXY_HEALTH_CHECK_ENABLED;
  if (v === undefined) return true;
  return !['false', '0', 'off', 'no'].includes(String(v).toLowerCase());
}

function getIntervalMs() {
  const n = parseInt(process.env.PROXY_HEALTH_CHECK_INTERVAL_MS, 10);
  return Number.isFinite(n) && n >= 5000 ? n : DEFAULT_INTERVAL_MS;
}

function getTimeoutMs() {
  const n = parseInt(process.env.PROXY_HEALTH_CHECK_TIMEOUT_MS, 10);
  return Number.isFinite(n) && n >= 500 ? n : DEFAULT_TIMEOUT_MS;
}

/** TCP 探测端口；不关心协议，只要端口能连上即视为本进程监听正常 */
function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host, port });
    let done = false;
    const finish = (ok, errMsg) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch { /* ignore */ }
      resolve({ ok, errMsg: errMsg || null });
    };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false, `timeout ${timeoutMs}ms`));
    sock.once('error', (e) => finish(false, e.code || e.message));
  });
}

/**
 * 对单个代理连接做一次健康检查，并把结果写回 DB。
 * @param {string} id
 * @param {number} port
 * @returns {Promise<{ok:boolean, errMsg?:string}>}
 */
export async function checkOne(id, port) {
  const t0 = Date.now();
  const result = await probeTcp('127.0.0.1', port, getTimeoutMs());
  const elapsed = Date.now() - t0;
  const status = result.ok ? 'ok' : 'fail';
  const errMsg = result.errMsg ? `${result.errMsg} (${elapsed}ms)` : null;

  try {
    await getPool().query(
      `UPDATE proxy_connections
       SET last_health_check_at = NOW(),
           health_status        = $2,
           last_error           = $3
       WHERE id = $1`,
      [id, status, errMsg]
    );
  } catch (err) {
    // DB 写失败不应影响返回值
    console.error('[proxy-healthcheck] 写回 health_status 失败:', err?.message);
  }
  return result.ok ? { ok: true } : { ok: false, errMsg };
}

/**
 * 加载所有 active 且未过期的代理连接并逐个探测。
 * 设计：
 *   - 串行探测，避免本机端口探测并发过高；
 *   - 失败后不重试（同一周期内只跑一次），由下一周期再触发；
 *   - 整个流程加 running 锁，防止重叠。
 */
async function checkAllActive(logger) {
  let res;
  try {
    res = await getPool().query(
      `SELECT id, name, proxy_port FROM proxy_connections
       WHERE status = 'active' AND expires_at > NOW()
       ORDER BY id ASC`
    );
  } catch (err) {
    logger.error?.(`[proxy-healthcheck] 加载 active 失败: ${err.message}`);
    return;
  }

  let okCount = 0;
  let failCount = 0;
  for (const r of res.rows) {
    const v = await checkOne(r.id, r.proxy_port);
    if (v.ok) okCount += 1;
    else failCount += 1;
  }
  if (okCount || failCount) {
    logger.log?.(`[proxy-healthcheck] 本轮扫描 ${res.rows.length} 个连接: ok=${okCount} fail=${failCount}`);
  }
}

/**
 * 启动健康检查循环：startHealthCheckLoop()
 * 返回 cancel() 用于优雅关闭
 */
export function startHealthCheckLoop(logger = console) {
  if (!isEnabled()) {
    logger.log?.('[proxy-healthcheck] 已通过 PROXY_HEALTH_CHECK_ENABLED=false 关闭');
    return () => {};
  }
  const intervalMs = getIntervalMs();
  let cancelled = false;
  let running = false;

  const safeRun = async () => {
    if (cancelled || running) return;
    running = true;
    try {
      await checkAllActive(logger);
    } catch (err) {
      logger.error?.(`[proxy-healthcheck] 异常: ${err?.message || err}`);
    } finally {
      running = false;
    }
  };

  // 启动后稍延迟首次执行（等 sync 把 listeners 启起来）
  const initial = setTimeout(safeRun, 8000);
  const tick = setInterval(safeRun, intervalMs);

  logger.log?.(
    `[proxy-healthcheck] 启动：每 ${Math.round(intervalMs / 1000)}s 扫描，超时 ${getTimeoutMs()}ms`
  );

  return () => {
    cancelled = true;
    clearTimeout(initial);
    clearInterval(tick);
  };
}