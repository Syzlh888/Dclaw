/**
 * 数据同步 · 任务 API  (v1.5)
 *
 * 端点 (挂载在 /api):
 *   GET    /sync-tasks?project_id=xxx         列表（支持按 project_id 过滤）
 *   POST   /sync-tasks                        创建 (id = 'task-' + nanoid(8))
 *   PATCH  /sync-tasks/:id                    更新
 *   DELETE /sync-tasks/:id                    删除（级联删 table_mappings）
 *
 * 注意：
 *   - 与现有 engineerings/projects 一样，使用 database.mjs 的
 *     getAll / getById / query / insert / update / remove 接口
 *   - source_connection_id / target_connection_id 关联 connections.id
 *   - v1.6 启用轮询 (pollIntervalSeconds)；v1.5 仅落库不调度
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  getAll,
  getById,
  insert,
  update,
  remove,
  query,
} from '../database.mjs';

const router = Router();

const WRITE_STRATEGIES = ['insert', 'upsert', 'replace'];
const MIN_POLL_INTERVAL = 5;
const MAX_POLL_INTERVAL = 86400; // 1 天
const DEFAULT_POLL_INTERVAL = 60;
const DEFAULT_WRITE_STRATEGY = 'insert';

function normalizeWriteStrategy(s) {
  if (!s) return DEFAULT_WRITE_STRATEGY;
  const v = String(s).toLowerCase();
  return WRITE_STRATEGIES.includes(v) ? v : DEFAULT_WRITE_STRATEGY;
}

function normalizePollInterval(n) {
  const num = Number(n);
  if (!Number.isFinite(num) || num <= 0) return DEFAULT_POLL_INTERVAL;
  if (num < MIN_POLL_INTERVAL) return MIN_POLL_INTERVAL;
  if (num > MAX_POLL_INTERVAL) return MAX_POLL_INTERVAL;
  return Math.floor(num);
}

// GET /sync-tasks?project_id=xxx
router.get('/', async (req, res) => {
  let items = await getAll('syncTasks');
  if (req.query.project_id) {
    const pid = String(req.query.project_id);
    items = items.filter((t) => t.project_id === pid);
  }
  if (req.query.enabled === 'true') {
    items = items.filter((t) => t.enabled !== false);
  }
  items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  res.json({ tasks: items });
});

// POST /sync-tasks
router.post('/', async (req, res) => {
  const {
    projectId,
    name,
    sourceConnectionId,
    sourceSchema,
    targetConnectionId,
    targetSchema,
    pollIntervalSeconds,
    enabled,
    writeStrategy,
    description,
  } = req.body || {};

  if (!projectId) return res.status(400).json({ error: '所属项目 (projectId) 不能为空' });
  if (!name || !name.trim()) return res.status(400).json({ error: '任务名称不能为空' });
  if (!sourceConnectionId) return res.status(400).json({ error: '源连接 (sourceConnectionId) 不能为空' });
  if (!targetConnectionId) return res.status(400).json({ error: '目标连接 (targetConnectionId) 不能为空' });

  const project = await getById('syncProjects', projectId);
  if (!project) return res.status(400).json({ error: '所属项目不存在' });
  const src = await getById('connections', sourceConnectionId);
  if (!src) return res.status(400).json({ error: '源连接不存在' });
  const tgt = await getById('connections', targetConnectionId);
  if (!tgt) return res.status(400).json({ error: '目标连接不存在' });

  const now = new Date().toISOString();
  const id = `task-${nanoid(8)}`;
  const record = {
    id,
    project_id: projectId,
    name: name.trim(),
    source_connection_id: sourceConnectionId,
    source_schema: sourceSchema ? String(sourceSchema) : null,
    target_connection_id: targetConnectionId,
    target_schema: targetSchema ? String(targetSchema) : null,
    poll_interval_seconds: normalizePollInterval(pollIntervalSeconds),
    enabled: enabled === false ? false : true,
    write_strategy: normalizeWriteStrategy(writeStrategy),
    last_run_at: null,
    last_run_status: null,
    last_run_rows: 0,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    extra: description != null ? { description: String(description) } : {},
  };
  await insert('syncTasks', record);
  res.status(201).json({
    ...record,
    description: record.extra.description ?? '',
  });
});

// PATCH /sync-tasks/:id
router.patch('/:id', async (req, res) => {
  const existing = await getById('syncTasks', req.params.id);
  if (!existing) return res.status(404).json({ error: '同步任务不存在' });

  const {
    projectId,
    name,
    sourceConnectionId,
    sourceSchema,
    targetConnectionId,
    targetSchema,
    pollIntervalSeconds,
    enabled,
    writeStrategy,
    description,
  } = req.body || {};

  const partial = { updated_at: new Date().toISOString() };

  if (projectId !== undefined) {
    const p = await getById('syncProjects', projectId);
    if (!p) return res.status(400).json({ error: '所属项目不存在' });
    partial.project_id = projectId;
  }
  if (name !== undefined) {
    if (!name || !name.trim()) return res.status(400).json({ error: '任务名称不能为空' });
    partial.name = name.trim();
  }
  if (sourceConnectionId !== undefined) {
    if (!sourceConnectionId) return res.status(400).json({ error: '源连接不能为空' });
    const c = await getById('connections', sourceConnectionId);
    if (!c) return res.status(400).json({ error: '源连接不存在' });
    partial.source_connection_id = sourceConnectionId;
  }
  if (targetConnectionId !== undefined) {
    if (!targetConnectionId) return res.status(400).json({ error: '目标连接不能为空' });
    const c = await getById('connections', targetConnectionId);
    if (!c) return res.status(400).json({ error: '目标连接不存在' });
    partial.target_connection_id = targetConnectionId;
  }
  if (sourceSchema !== undefined) partial.source_schema = sourceSchema ? String(sourceSchema) : null;
  if (targetSchema !== undefined) partial.target_schema = targetSchema ? String(targetSchema) : null;
  if (pollIntervalSeconds !== undefined) partial.poll_interval_seconds = normalizePollInterval(pollIntervalSeconds);
  if (enabled !== undefined) partial.enabled = enabled !== false;
  if (writeStrategy !== undefined) partial.write_strategy = normalizeWriteStrategy(writeStrategy);
  if (description !== undefined) {
    const prevExtra = (existing.extra && typeof existing.extra === 'object') ? existing.extra : {};
    partial.extra = { ...prevExtra, description: description == null ? '' : String(description) };
  }

  const updated = await update('syncTasks', req.params.id, partial);
  if (!updated) return res.status(404).json({ error: '同步任务不存在' });
  const extra = (updated.extra && typeof updated.extra === 'object') ? updated.extra : {};
  res.json({ ...updated, description: extra.description ?? '' });
});

// DELETE /sync-tasks/:id  (级联删除 table_mappings)
router.delete('/:id', async (req, res) => {
  const existing = await getById('syncTasks', req.params.id);
  if (!existing) return res.status(404).json({ error: '同步任务不存在' });

  const mappings = await query('syncTableMappings', (m) => m.task_id === req.params.id);
  let deletedMappings = 0;
  for (const m of mappings) {
    const ok = await remove('syncTableMappings', m.id);
    if (ok) deletedMappings += 1;
  }
  const ok = await remove('syncTasks', req.params.id);
  res.json({
    success: ok,
    cascade: { deletedMappings },
  });
});

export default router;
