/**
 * 数据同步 · 任务执行 API  (v1.5)
 *
 * 端点 (挂载在 /api/sync-tasks):
 *   POST /api/sync-tasks/:id/run      立即执行任务 (SSE 流式进度)
 *   POST /api/sync-tasks/:id/cancel   取消 (v1.5 占位实现)
 *   GET  /api/sync-tasks/:id/history  历史 (v1.5 占位返回空数组)
 *
 * SSE 事件格式：
 *   event: start      data: { taskId, mappingCount, startedAt }
 *   event: progress   data: { mappingIndex, totalMappings, currentTable, status, rows, ... }
 *   event: done       data: { success, totalRows, durationMs, errors }
 *   event: error      data: { message }
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.mjs';
import { getById, getAll, update, query } from '../database.mjs';
import { runTask } from '../sync/taskRunner.mjs';
import { log } from '../logger.mjs';

const router = Router();

/** 拉取任务和有效 mappings（按 sequence 排序） */
async function loadTaskAndMappings(taskId) {
  const task = await getById('syncTasks', taskId);
  if (!task) return { task: null, mappings: [] };

  // 用 query 做内存过滤，等价 sync-tasks.mjs 里的写法
  const all = await query('syncTableMappings', (m) => m.task_id === taskId);
  const mappings = all
    .filter((m) => m.enabled !== false)
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));

  return { task, mappings };
}

/** 写 sync_history 记录（如果表存在）；失败不影响主流程 */
async function writeHistorySafe(taskId, result) {
  try {
    await update('syncTasks', taskId, {
      last_run_at: new Date().toISOString(),
      last_run_status: result.success ? 'success' : 'error',
      last_run_rows: result.totalRows || 0,
    });
  } catch (err) {
    log.warn('[sync-execute] 更新 sync_tasks 失败', { taskId, error: err.message });
  }
}

// POST /api/sync-tasks/:id/run  (SSE 流式)
router.post('/:id/run', authMiddleware, async (req, res) => {
  const taskId = req.params.id;

  // 先确认任务存在、读取 mappings（失败用普通 JSON 响应，不要进入 SSE）
  const { task, mappings } = await loadTaskAndMappings(taskId);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }

  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const sendEvent = (event, data) => {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      // 连接已断开，吞掉错误
    }
  };

  const startedAt = new Date().toISOString();
  sendEvent('start', { taskId, mappingCount: mappings.length, startedAt });

  // 客户端断开时清理
  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    const result = await runTask(task, mappings, (progress) => {
      if (aborted) return;
      sendEvent('progress', progress);
    });

    await writeHistorySafe(taskId, result);

    if (!aborted) {
      sendEvent('done', result);
    }
    res.end();
  } catch (err) {
    log.error('[sync-execute] 任务执行异常', { taskId, error: err.message, stack: err.stack });
    if (!aborted) {
      sendEvent('error', { message: err.message || '任务执行失败' });
    }
    try { res.end(); } catch { /* ignore */ }
  }
});

// POST /api/sync-tasks/:id/cancel  (v1.5 占位)
router.post('/:id/cancel', authMiddleware, async (req, res) => {
  const task = await getById('syncTasks', req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({ ok: true, taskId: req.params.id, message: 'v1.5 暂不支持取消' });
});

// GET /api/sync-tasks/:id/history  (v1.5 占位)
router.get('/:id/history', authMiddleware, async (req, res) => {
  const task = await getById('syncTasks', req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  res.json({
    taskId: req.params.id,
    history: [],
    note: 'v1.5 历史记录功能开发中',
  });
});

export default router;