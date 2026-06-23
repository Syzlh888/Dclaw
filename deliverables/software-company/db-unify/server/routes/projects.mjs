/**
 * 项目字典 API
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove, query } from '../database.mjs';

const router = Router();

router.get('/', (_req, res) => {
  const items = getAll('projects');
  items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  res.json({ projects: items });
});

router.post('/', (req, res) => {
  const { name, shortName } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: '项目名称不能为空' });
  const now = new Date().toISOString();
  const id = nanoid(8);
  const record = { id, name: name.trim(), short_name: (shortName || '').trim(), sort_order: 0, created_at: now, updated_at: now };
  insert('projects', record);
  res.status(201).json(record);
});

router.put('/:id', (req, res) => {
  const existing = getById('projects', req.params.id);
  if (!existing) return res.status(404).json({ error: '项目不存在' });
  const { name, shortName, sort_order } = req.body;
  const partial = { updated_at: new Date().toISOString() };
  if (name !== undefined) partial.name = name.trim();
  if (shortName !== undefined) partial.short_name = (shortName || '').trim();
  if (sort_order !== undefined) partial.sort_order = sort_order;
  const updated = update('projects', req.params.id, partial);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = getById('projects', req.params.id);
  if (!existing) return res.status(404).json({ error: '项目不存在' });
  // 检查是否被服务器引用
  const serversUsing = query('servers', s => s.project_id === req.params.id);
  if (serversUsing.length > 0) {
    return res.status(409).json({
      error: `无法删除，还有 ${serversUsing.length} 台服务器引用此项目`,
      details: serversUsing.slice(0, 5).map(s => s.name),
      count: serversUsing.length,
    });
  }
  // 检查是否有关联工程
  const childEngineerings = query('engineerings', e => e.project_id === req.params.id);
  if (childEngineerings.length > 0) {
    return res.status(409).json({
      error: `无法删除，该项目下还有 ${childEngineerings.length} 个工程，请先删除工程`,
      count: childEngineerings.length,
    });
  }
  remove('projects', req.params.id);
  res.json({ success: true });
});

export default router;
