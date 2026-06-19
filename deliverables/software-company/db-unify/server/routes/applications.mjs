/**
 * 应用字典 API
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove } from '../database.mjs';

const router = Router();

router.get('/', (req, res) => {
  let items = getAll('applications');
  if (req.query.engineeringId) items = items.filter(a => a.engineering_id === req.query.engineeringId);
  items.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  res.json({ applications: items });
});

router.post('/', (req, res) => {
  const { engineeringId, name, shortName } = req.body;
  if (!engineeringId) return res.status(400).json({ error: '所属工程不能为空' });
  if (!name || !name.trim()) return res.status(400).json({ error: '应用名称不能为空' });
  const eng = getById('engineerings', engineeringId);
  if (!eng) return res.status(400).json({ error: '所属工程不存在' });
  const now = new Date().toISOString();
  const id = nanoid(8);
  const record = { id, engineering_id: engineeringId, name: name.trim(), short_name: (shortName || '').trim(), sort_order: 0, created_at: now, updated_at: now };
  insert('applications', record);
  res.status(201).json(record);
});

router.put('/:id', (req, res) => {
  const existing = getById('applications', req.params.id);
  if (!existing) return res.status(404).json({ error: '应用不存在' });
  const { engineeringId, name, shortName, sort_order } = req.body;
  const partial = { updated_at: new Date().toISOString() };
  if (engineeringId !== undefined) partial.engineering_id = engineeringId;
  if (name !== undefined) partial.name = name.trim();
  if (shortName !== undefined) partial.short_name = (shortName || '').trim();
  if (sort_order !== undefined) partial.sort_order = sort_order;
  const updated = update('applications', req.params.id, partial);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const existing = getById('applications', req.params.id);
  if (!existing) return res.status(404).json({ error: '应用不存在' });
  remove('applications', req.params.id);
  res.json({ success: true });
});

export default router;
