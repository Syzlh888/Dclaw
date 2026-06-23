/**
 * 工程字典 API
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove, query } from '../database.mjs';

const router = Router();

router.get('/', (req, res) => {
  let items = getAll('engineerings');
  if (req.query.projectId) items = items.filter(e => e.project_id === req.query.projectId);
  items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  res.json({ engineerings: items });
});

router.post('/', (req, res) => {
  const { projectId, name, shortName } = req.body;
  if (!projectId) return res.status(400).json({ error: '所属项目不能为空' });
  if (!name || !name.trim()) return res.status(400).json({ error: '工程名称不能为空' });
  const project = getById('projects', projectId);
  if (!project) return res.status(400).json({ error: '所属项目不存在' });
  const now = new Date().toISOString();
  const id = nanoid(8);
  const record = { id, project_id: projectId, name: name.trim(), short_name: (shortName || '').trim(), sort_order: 0, created_at: now, updated_at: now };
  insert('engineerings', record);
  res.status(201).json(record);
});

router.put('/:id', (req, res) => {
  const existing = getById('engineerings', req.params.id);
  if (!existing) return res.status(404).json({ error: '工程不存在' });
  const { projectId, name, shortName, sort_order } = req.body;
  const partial = { updated_at: new Date().toISOString() };
  if (projectId !== undefined) partial.project_id = projectId;
  if (name !== undefined) partial.name = name.trim();
  if (shortName !== undefined) partial.short_name = (shortName || '').trim();
  if (sort_order !== undefined) partial.sort_order = sort_order;
  const updated = update('engineerings', req.params.id, partial);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = getById('engineerings', req.params.id);
  if (!existing) return res.status(404).json({ error: '工程不存在' });
  // 检查是否被服务器引用
  const serversUsing = query('servers', s => s.engineering_id === req.params.id);
  if (serversUsing.length > 0) {
    return res.status(409).json({
      error: `无法删除，还有 ${serversUsing.length} 台服务器引用此工程`,
      details: serversUsing.slice(0, 5).map(s => s.name),
      count: serversUsing.length,
    });
  }
  // 检查是否有关联应用
  const childApps = query('applications', a => a.engineering_id === req.params.id);
  if (childApps.length > 0) {
    return res.status(409).json({
      error: `无法删除，该工程下还有 ${childApps.length} 个应用，请先删除应用`,
      count: childApps.length,
    });
  }
  remove('engineerings', req.params.id);
  res.json({ success: true });
});

export default router;
