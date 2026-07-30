/**
 * 数据同步 · 调度器 API (v1.6)
 *
 * 端点 (挂载在 /api/sync-scheduler):
 *   GET  /status                       获取所有任务在调度器中的运行状态
 *   POST /run/:taskId                  立即触发一次（绕过轮询间隔）
 *   POST /start                        启动调度循环（幂等）
 *   POST /stop                         停止调度循环
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.mjs';
import scheduler from '../sync/scheduler.mjs';
import { getById, getAll } from '../database.mjs';

const router = Router();

// GET /sync-scheduler/status
router.get('/status', authMiddleware, (_req, res) => {
  try {
    const status = scheduler.getStatus();
    res.json({ status });
  } catch (err) {
    res.status(500).json({ error: err?.message || '获取调度器状态失败' });
  }
});

// POST /sync-scheduler/run/:taskId
// 立即把任务丢进执行队列（不等待 poll_interval）
router.post('/run/:taskId', authMiddleware, async (req, res) => {
  try {
    const task = await getById('syncTasks', req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    // 异步执行，立即返回
    scheduler.runTaskScheduled(task).catch((err) => {
      console.error(`[sync-scheduler] manual run task ${task.id} failed:`, err);
    });

    res.json({ ok: true, message: `任务 ${task.name} 已加入执行队列` });
  } catch (err) {
    res.status(500).json({ error: err?.message || '触发任务失败' });
  }
});

// POST /sync-scheduler/start
router.post('/start', authMiddleware, (_req, res) => {
  try {
    scheduler.start();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || '启动调度器失败' });
  }
});

// POST /sync-scheduler/stop
router.post('/stop', authMiddleware, (_req, res) => {
  try {
    scheduler.stop();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err?.message || '停止调度器失败' });
  }
});

// GET /sync-scheduler/tasks  —— 列出所有 sync_tasks + 当前调度器状态
// 方便前端一次性拉取，不用分别打两套接口
router.get('/tasks', authMiddleware, async (_req, res) => {
  try {
    const tasks = await getAll('syncTasks');
    const status = scheduler.getStatus();
    const statusMap = new Map(status.map((s) => [s.taskId, s]));
    const merged = tasks.map((t) => {
      const s = statusMap.get(t.id) || {};
      return {
        ...t,
        scheduler: {
          running: Boolean(s.running),
          lastRunAt: s.lastRunAt || null,
          lastError: s.lastError || null,
        },
      };
    });
    res.json({ tasks: merged });
  } catch (err) {
    res.status(500).json({ error: err?.message || '拉取任务状态失败' });
  }
});

export default router;
