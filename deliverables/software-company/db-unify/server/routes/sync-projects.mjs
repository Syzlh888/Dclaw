/**
 * 数据同步 · 项目字典 API  (v1.5)
 *
 * 端点 (挂载在 /api):
 *   GET    /sync-projects                    列表
 *   POST   /sync-projects                    创建 (id = 'proj-' + nanoid(8))
 *   PATCH  /sync-projects/:id                更新
 *   DELETE /sync-projects/:id                删除（级联删 tasks 和 table_mappings）
 *   GET    /sync-projects/:id/stats          任务数 + 表数 + 最后运行时间
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

const MAX_DESCRIPTION = 2000;
const DEFAULT_COLOR = '#1976D2';

// GET /sync-projects
router.get('/', async (_req, res) => {
  const items = await getAll('syncProjects');
  items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  res.json({ projects: items });
});

// POST /sync-projects
router.post('/', async (req, res) => {
  const { name, description, color } = req.body || {};
  if (!name || !name.trim()) {
    return res.status(400).json({ error: '项目名称不能为空' });
  }
  if (description != null && typeof description === 'string' && description.length > MAX_DESCRIPTION) {
    return res.status(400).json({ error: `描述长度不能超过 ${MAX_DESCRIPTION} 字符` });
  }
  const now = new Date().toISOString();
  const id = `proj-${nanoid(8)}`;
  const record = {
    id,
    name: name.trim(),
    color: (color && /^#[0-9A-Fa-f]{3,8}$/.test(color)) ? color : DEFAULT_COLOR,
    sort_order: 0,
    created_at: now,
    updated_at: now,
    extra: description != null ? { description: String(description) } : {},
  };
  await insert('syncProjects', record);
  res.status(201).json({
    ...record,
    description: record.extra.description ?? '',
  });
});

// PATCH /sync-projects/:id
router.patch('/:id', async (req, res) => {
  const existing = await getById('syncProjects', req.params.id);
  if (!existing) return res.status(404).json({ error: '同步项目不存在' });
  const { name, description, color, sort_order } = req.body || {};
  const partial = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
    partial.name = name.trim();
  }
  if (description !== undefined) {
    if (description != null && typeof description === 'string' && description.length > MAX_DESCRIPTION) {
      return res.status(400).json({ error: `描述长度不能超过 ${MAX_DESCRIPTION} 字符` });
    }
    const prevExtra = (existing.extra && typeof existing.extra === 'object') ? existing.extra : {};
    partial.extra = { ...prevExtra, description: description == null ? '' : String(description) };
  }
  if (color !== undefined) {
    if (color && /^#[0-9A-Fa-f]{3,8}$/.test(color)) partial.color = color;
    else if (color == null || color === '') partial.color = DEFAULT_COLOR;
  }
  if (sort_order !== undefined) partial.sort_order = Number(sort_order) || 0;
  const updated = await update('syncProjects', req.params.id, partial);
  const extra = (updated && updated.extra && typeof updated.extra === 'object') ? updated.extra : {};
  res.json({ ...updated, description: extra.description ?? '' });
});

// DELETE /sync-projects/:id  (级联删除 tasks + table_mappings)
router.delete('/:id', async (req, res) => {
  const existing = await getById('syncProjects', req.params.id);
  if (!existing) return res.status(404).json({ error: '同步项目不存在' });

  // 找出所有关联 tasks
  const tasks = await query('syncTasks', (t) => t.project_id === req.params.id);
  let deletedTasks = 0;
  let deletedMappings = 0;
  for (const task of tasks) {
    const maps = await query('syncTableMappings', (m) => m.task_id === task.id);
    for (const m of maps) {
      const ok = await remove('syncTableMappings', m.id);
      if (ok) deletedMappings += 1;
    }
    const ok = await remove('syncTasks', task.id);
    if (ok) deletedTasks += 1;
  }
  const ok = await remove('syncProjects', req.params.id);
  res.json({
    success: ok,
    cascade: {
      deletedTasks,
      deletedMappings,
    },
  });
});

// GET /sync-projects/:id/stats
router.get('/:id/stats', async (req, res) => {
  const project = await getById('syncProjects', req.params.id);
  if (!project) return res.status(404).json({ error: '同步项目不存在' });

  const tasks = await query('syncTasks', (t) => t.project_id === req.params.id);
  const enabledTasks = tasks.filter((t) => t.enabled !== false);

  let mappingCount = 0;
  let lastRunAt = null;
  let lastRunStatus = null;
  let lastRunRows = 0;
  let totalRuns = 0;
  let successRuns = 0;

  for (const t of tasks) {
    const maps = await query('syncTableMappings', (m) => m.task_id === t.id);
    mappingCount += maps.length;
    if (t.last_run_at) {
      if (!lastRunAt || new Date(t.last_run_at) > new Date(lastRunAt)) {
        lastRunAt = t.last_run_at;
        lastRunStatus = t.last_run_status || null;
      }
    }
    if (t.last_run_status) totalRuns += 1;
    if (t.last_run_status === 'success') successRuns += 1;
    if (t.last_run_rows) lastRunRows = Math.max(lastRunRows, Number(t.last_run_rows) || 0);
  }

  res.json({
    projectId: project.id,
    taskCount: tasks.length,
    enabledTaskCount: enabledTasks.length,
    mappingCount,
    lastRunAt,
    lastRunStatus,
    lastRunRows,
    totalRuns,
    successRuns,
    successRate: totalRuns > 0 ? +(successRuns / totalRuns).toFixed(4) : null,
  });
});

export default router;
