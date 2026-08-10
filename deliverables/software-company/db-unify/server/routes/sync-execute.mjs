/**
 * 数据同步 · 任务执行 API  (v1.6)
 *
 * 端点 (挂载在 /api/sync-tasks):
 *   POST /api/sync-tasks/:id/run      立即执行任务 (SSE 流式进度)
 *   POST /api/sync-tasks/:id/cancel   取消 (v1.5 占位实现)
 *   GET  /api/sync-tasks/:id/history  历史 (sync_run_history，按时间倒序)
 *
 * SSE 事件格式：
 *   event: start      data: { taskId, mappingCount, startedAt, concurrency, retries }
 *   event: progress   data: { mappingIndex, totalMappings, currentTable, status, rows, attempt, maxAttempts, error? }
 *   event: done       data: { success, totalRows, durationMs, errors, mappingResults }
 *   event: error      data: { message }
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.mjs';
import { getById, getAll, update, query } from '../database.mjs';
import { runTask, fetchTaskHistory, loadTaskAndMappings } from '../sync/taskRunner.mjs';
import { log } from '../logger.mjs';

const router = Router();

/** 写 sync_tasks 的 last_run_* 字段（不影响 sync_run_history，taskRunner 自己负责） */
async function writeTaskLastRun(taskId, result) {
  try {
    await update('syncTasks', taskId, {
      last_run_at: new Date().toISOString(),
      last_run_status: result.success ? 'success' : 'failed',
      last_run_rows: result.totalRows || 0,
    });
  } catch (err) {
    log.warn('[sync-execute] 更新 sync_tasks 失败', { taskId, error: err.message });
  }
}

// POST /api/sync-tasks/:id/run  (SSE 流式)
router.post('/:id/run', authMiddleware, async (req, res) => {
  const taskId = req.params.id;
  // 可选 body: { fromScratch?: boolean, concurrency?: number, retries?: number }
  const body = req.body || {};
  const fromScratch = body.fromScratch === true;
  const overrideConcurrency = body.concurrency != null ? Number(body.concurrency) : undefined;
  const overrideRetries = body.retries != null ? Number(body.retries) : undefined;

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
  const concurrency = overrideConcurrency || task.max_concurrent || 3;
  const retries = overrideRetries != null ? overrideRetries : (task.retry_count != null ? task.retry_count : 2);
  sendEvent('start', {
    taskId,
    mappingCount: mappings.length,
    startedAt,
    concurrency,
    retries,
    fromScratch,
  });

  // 客户端断开时清理
  let aborted = false;
  req.on('close', () => { aborted = true; });

  try {
    const result = await runTask(
      task,
      mappings,
      { fromScratch, concurrency: overrideConcurrency, retries: overrideRetries },
      (progress) => {
        if (aborted) return;
        sendEvent('progress', progress);
      },
    );

    await writeTaskLastRun(taskId, result);

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

// GET /api/sync-tasks/:id/history?limit=100
// 返回按时间倒序的 sync_run_history
router.get('/:id/history', authMiddleware, async (req, res) => {
  const task = await getById('syncTasks', req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在' });

  const limit = req.query.limit != null ? Number(req.query.limit) : 100;
  try {
    const rows = await fetchTaskHistory(req.params.id, { limit });
    const history = rows.map((r) => ({
      id: String(r.id),
      taskId: r.task_id,
      mappingId: r.mapping_id || null,
      status: r.status,
      rowsSynced: Number(r.rows_synced || 0),
      durationMs: Number(r.duration_ms || 0),
      attempts: Number(r.attempts || 1),
      errorMessage: r.error_message || null,
      startedAt: r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at,
      finishedAt: r.finished_at instanceof Date ? r.finished_at.toISOString() : r.finished_at,
    }));
    res.json({ taskId: req.params.id, history });
  } catch (err) {
    log.error('[sync-execute] 拉取历史失败', { taskId: req.params.id, error: err.message });
    res.status(500).json({ error: err?.message || '拉取历史失败' });
  }
});

export default router;
