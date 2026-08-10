/**
 * 代理网关 — 审计日志归档 / 清理（阶段5 优化）
 *
 * 规则：
 *  - 保留最近 N 天（默认 90，可配置 PROXY_AUDIT_RETENTION_DAYS）
 *  - 至少保留 N 条（默认 1000，可配置 PROXY_AUDIT_MIN_KEEP）
 *    —— 即使按时间条件未到，也至少保证表中至少有这个数量条数，防止误清空
 *
 * 配置项（环境变量）：
 *   PROXY_AUDIT_CLEANUP_ENABLED  是否启用（默认 true；显式=false 关闭）
 *   PROXY_AUDIT_RETENTION_DAYS   保留天数（默认 90）
 *   PROXY_AUDIT_MIN_KEEP         最少保留条数（默认 1000）
 *   PROXY_AUDIT_CLEANUP_INTERVAL 清理间隔毫秒（默认 24 小时）
 */
import { getPool } from '../db/pool.mjs';

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_MIN_KEEP = 1000;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function isEnabled() {
  const v = process.env.PROXY_AUDIT_CLEANUP_ENABLED;
  // 默认开启；只有显式 'false'/'0'/'off' 才视为关闭
  if (v === undefined) return true;
  return !['false', '0', 'off', 'no'].includes(String(v).toLowerCase());
}

function getRetentionDays() {
  const n = parseInt(process.env.PROXY_AUDIT_RETENTION_DAYS, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RETENTION_DAYS;
}

function getMinKeep() {
  const n = parseInt(process.env.PROXY_AUDIT_MIN_KEEP, 10);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_KEEP;
}

function getIntervalMs() {
  const n = parseInt(process.env.PROXY_AUDIT_CLEANUP_INTERVAL, 10);
  return Number.isFinite(n) && n >= 60000 ? n : DEFAULT_INTERVAL_MS;
}

/**
 * 执行一次清理：
 *  1. 删除 executed_at < now - retention_days 的记录
 *  2. 但若删除后总数 < min_keep，则仅删除时间窗内多余的最旧记录（最多保留 min_keep 条）
 *
 * @returns {Promise<{deleted:number, retentionDays:number, minKeep:number, before:number, after:number}>}
 */
export async function runAuditCleanup() {
  if (!isEnabled()) {
    return { deleted: 0, skipped: true, reason: 'disabled by env' };
  }
  const retentionDays = getRetentionDays();
  const minKeep = getMinKeep();
  const pool = getPool();

  const totalRes = await pool.query('SELECT COUNT(*)::int AS n FROM proxy_audit_logs');
  const before = totalRes.rows[0].n;

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  // 按时间窗删
  const timeDeletedRes = await pool.query(
    'DELETE FROM proxy_audit_logs WHERE executed_at < $1',
    [cutoff]
  );
  let deleted = timeDeletedRes.rowCount || 0;

  // 仍不足 min_keep？仅当表中总量超过 min_keep 时，再按 executed_at 升序裁剪到 min_keep 条
  const afterRes = await pool.query('SELECT COUNT(*)::int AS n FROM proxy_audit_logs');
  const after = afterRes.rows[0].n;
  if (after > minKeep) {
    const need = after - minKeep;
    const trimRes = await pool.query(
      `DELETE FROM proxy_audit_logs
       WHERE id IN (
          SELECT id FROM proxy_audit_logs ORDER BY executed_at ASC LIMIT $1
        )`,
      [need]
    );
    deleted += trimRes.rowCount || 0;
  }

  const finalRes = await pool.query('SELECT COUNT(*)::int AS n FROM proxy_audit_logs');
  const finalCount = finalRes.rows[0].n;

  return {
    deleted,
    retentionDays,
    minKeep,
    before,
    after: finalCount,
  };
}

/**
 * 启动后台清理定时器（在独立代理进程中调用）：
 *   - 启动后立即跑一次（小延迟 5s，让 DB 池先稳定）
 *   - 之后按 PROXY_AUDIT_CLEANUP_INTERVAL 周期触发
 *
 * 返回 cancel() 用于关闭时清理
 */
export function startAuditCleanupLoop(logger = console) {
  if (!isEnabled()) {
    logger.log('[proxy-cleanup] 已通过 PROXY_AUDIT_CLEANUP_ENABLED=false 关闭');
    return () => {};
  }
  const intervalMs = getIntervalMs();

  let cancelled = false;
  const safeRun = async () => {
    if (cancelled) return;
    try {
      const r = await runAuditCleanup();
      if (r.deleted > 0) {
        logger.log(
          `[proxy-cleanup] 删除 ${r.deleted} 条审计记录 (retention=${r.retentionDays}d, minKeep=${r.minKeep}, ${r.before} → ${r.after})`
        );
      }
    } catch (err) {
      logger.error?.(`[proxy-cleanup] 失败: ${err.message}`);
    }
  };

  const initial = setTimeout(safeRun, 5000);
  const tick = setInterval(safeRun, intervalMs);

  logger.log?.(
    `[proxy-cleanup] 启动：每 ${Math.round(intervalMs / 60000)}min，保留 ${getRetentionDays()} 天 / 最少 ${getMinKeep()} 条`
  );

  return () => {
    cancelled = true;
    clearTimeout(initial);
    clearInterval(tick);
  };
}