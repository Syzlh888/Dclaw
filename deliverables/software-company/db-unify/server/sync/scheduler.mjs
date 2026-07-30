/**
 * 数据同步 · 定时轮询调度器  (v1.6)
 *
 * 职责：
 *   - 启动时每 5 秒 (tickInterval) 检查一次 sync_tasks
 *   - 对 enabled=true 且 now - last_run_at >= poll_interval_seconds 的任务
 *     调用 runTask (taskRunner.mjs) 执行
 *   - 执行结束后把 last_run_at / last_run_status / last_run_rows 写回
 *
 * 设计：
 *   - 单进程单调度器（每次 tick 全表扫描，sync_tasks 通常 < 100 条）
 *   - 每个 task 用 Map(timers) 记录 { running, lastRunAt }，防止同一任务并发
 *   - 集成 express 路由使用：见 server/routes/sync-scheduler.mjs
 */
import { getAll, update, query } from '../database.mjs';
import { runTask } from './taskRunner.mjs';

class SyncScheduler {
  constructor() {
    /** taskId -> { running, lastRunAt, lastError } */
    this.timers = new Map();
    /** tick 句柄 */
    this._tick = null;
    /** 每 5 秒扫描一次 */
    this.tickInterval = 5 * 1000;
  }

  /** 启动调度循环（幂等） */
  start() {
    if (this._tick) return;
    this._tick = setInterval(() => {
      this.tick().catch((err) => {
        console.error('[SyncScheduler] tick error:', err);
      });
    }, this.tickInterval);
    console.log('[SyncScheduler] started, tick every', this.tickInterval, 'ms');
  }

  /** 停止调度循环 + 清空状态 */
  stop() {
    if (this._tick) {
      clearInterval(this._tick);
      this._tick = null;
    }
    // 不取消正在进行的 runTask —— 等待其自然结束
    this.timers.clear();
    console.log('[SyncScheduler] stopped');
  }

  /**
   * 检查所有任务，把到期的丢进执行队列。
   * 利用 taskId 锁避免同任务并发执行。
   */
  async tick() {
    const tasks = await getAll('syncTasks');
    const now = Date.now();

    for (const task of tasks) {
      if (!task || !task.id) continue;

      // 已禁用任务：清理运行标记，但保留统计
      if (task.enabled === false) {
        const t = this.timers.get(task.id);
        if (t) {
          // 仅清 running，保持 lastRunAt 历史
          t.running = false;
          this.timers.set(task.id, t);
        }
        continue;
      }

      const intervalSec = Number(task.poll_interval_seconds || 60);
      const intervalMs = intervalSec * 1000;

      // 解析 last_run_at（PG 返回的可能是 Date 对象或 ISO 字符串）
      let lastRunMs = 0;
      if (task.last_run_at) {
        const d = task.last_run_at instanceof Date ? task.last_run_at : new Date(task.last_run_at);
        if (!Number.isNaN(d.getTime())) lastRunMs = d.getTime();
      }

      const elapsed = now - lastRunMs;

      if (elapsed >= intervalMs && !this.isRunning(task.id)) {
        // 异步触发；不 await —— setInterval 不能阻塞
        this.runTaskScheduled(task).catch((err) => {
          console.error(`[SyncScheduler] task ${task.id} failed:`, err);
        });
      }
    }
  }

  /** 当前任务是否在执行 */
  isRunning(taskId) {
    return Boolean(this.timers.get(taskId)?.running);
  }

  /** 记录 / 读取 lastRunAt 数值（用于 getStatus） */
  getLastRunAt(taskId) {
    return this.timers.get(taskId)?.lastRunAt || null;
  }

  /**
   * 执行单个任务。会被 tick 自动调用，也可由 API 手动触发。
   * @param {Object} task sync_tasks 记录
   */
  async runTaskScheduled(task) {
    if (!task || !task.id) return;
    if (this.isRunning(task.id)) {
      console.log(`[SyncScheduler] task ${task.id} already running, skip`);
      return;
    }

    // 标记 running
    const t = this.timers.get(task.id) || {};
    t.running = true;
    t.lastRunAt = Date.now();
    this.timers.set(task.id, t);

    const startedAt = new Date().toISOString();

    try {
      // 拉取并过滤 mappings
      const allMappings = await query('syncTableMappings', (m) => m.task_id === task.id && m.enabled !== false);
      const mappings = allMappings
        .filter((m) => m.enabled !== false)
        .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));

      console.log(`[SyncScheduler] running task ${task.id} (${task.name}) with ${mappings.length} mappings`);

      // runTask(task, mappings, onProgress=() => {}) —— scheduler 不推送进度
      const result = await runTask(task, mappings, () => {});

      // 写回数据库
      await update('syncTasks', task.id, {
        last_run_at: new Date().toISOString(),
        last_run_status: result.success ? 'success' : 'failed',
        last_run_rows: Number(result.totalRows || 0),
      });

      const t2 = this.timers.get(task.id);
      if (t2) {
        t2.lastError = null;
        this.timers.set(task.id, t2);
      }

      console.log(
        `[SyncScheduler] task ${task.id} done: success=${result.success}, rows=${result.totalRows}, duration=${result.durationMs}ms`,
      );
    } catch (err) {
      console.error(`[SyncScheduler] task ${task.id} error:`, err);
      try {
        await update('syncTasks', task.id, {
          last_run_at: new Date().toISOString(),
          last_run_status: 'failed',
          last_run_rows: 0,
        });
      } catch (writeErr) {
        console.error(`[SyncScheduler] failed to write last_run_status for ${task.id}:`, writeErr);
      }
      const t2 = this.timers.get(task.id);
      if (t2) {
        t2.lastError = err?.message || String(err);
        this.timers.set(task.id, t2);
      }
    } finally {
      const t2 = this.timers.get(task.id);
      if (t2) {
        t2.running = false;
        this.timers.set(task.id, t2);
      }
      void startedAt;
    }
  }

  /** 暴露给前端的调度器状态 */
  getStatus() {
    const result = [];
    for (const [taskId, t] of this.timers.entries()) {
      result.push({
        taskId,
        running: Boolean(t.running),
        lastRunAt: t.lastRunAt || null,
        lastError: t.lastError || null,
      });
    }
    return result;
  }
}

const scheduler = new SyncScheduler();
export default scheduler;
