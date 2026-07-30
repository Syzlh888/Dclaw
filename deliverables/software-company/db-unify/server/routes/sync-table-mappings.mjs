/**
 * 数据同步 · 表映射 API  (v1.5)
 *
 * 端点 (挂载在 /api):
 *   GET    /sync-table-mappings?task_id=xxx        列表（按 task 过滤，按 sequence 排序）
 *   POST   /sync-table-mappings                    创建 (id = 'map-' + nanoid(8))
 *   PATCH  /sync-table-mappings/:id                更新（含 columnMappings JSON）
 *   DELETE /sync-table-mappings/:id                删除
 *   POST   /sync-table-mappings/reorder            批量改 sequence ({ taskId, orderedIds: [...] })
 *
 * 数据布局：
 *   - columnMappings JSON 数组 [{source, target, type?}]  →  column_mappings JSONB
 *   - whereClause (TEXT)                                  →  where_clause
 *   - orderBy                                              →  orderby
 *   - sequence                                              →  sequence
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

const MAX_TABLE_NAME = 255;
const MAX_WHERE = 4000;
const MAX_ORDERBY = 256;
const MAX_COLUMN_MAPPINGS = 500;

function normalizeColumnMappings(input) {
  if (input == null) return [];
  if (!Array.isArray(input)) {
    throw new Error('columnMappings 必须是数组');
  }
  if (input.length > MAX_COLUMN_MAPPINGS) {
    throw new Error(`columnMappings 最多 ${MAX_COLUMN_MAPPINGS} 条`);
  }
  const out = [];
  for (const c of input) {
    if (!c || typeof c !== 'object') continue;
    const src = c.source != null ? String(c.source) : '';
    const tgt = c.target != null ? String(c.target) : '';
    if (!src || !tgt) continue;
    const item = { source: src, target: tgt };
    if (c.type != null && c.type !== '') item.type = String(c.type);
    out.push(item);
  }
  return out;
}

// GET /sync-table-mappings?task_id=xxx
router.get('/', async (req, res) => {
  let items = await getAll('syncTableMappings');
  if (req.query.task_id) {
    const tid = String(req.query.task_id);
    items = items.filter((m) => m.task_id === tid);
  }
  items.sort((a, b) => {
    if ((a.sequence ?? 0) !== (b.sequence ?? 0)) return (a.sequence ?? 0) - (b.sequence ?? 0);
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  res.json({ mappings: items });
});

// POST /sync-table-mappings
router.post('/', async (req, res) => {
  const {
    taskId,
    sourceTable,
    targetTable,
    enabled,
    whereClause,
    orderBy,
    columnMappings,
    sequence,
  } = req.body || {};

  if (!taskId) return res.status(400).json({ error: '所属任务 (taskId) 不能为空' });
  if (!sourceTable || !sourceTable.trim()) return res.status(400).json({ error: '源表 (sourceTable) 不能为空' });
  if (!targetTable || !targetTable.trim()) return res.status(400).json({ error: '目标表 (targetTable) 不能为空' });

  const task = await getById('syncTasks', taskId);
  if (!task) return res.status(400).json({ error: '所属任务不存在' });

  if (whereClause != null && typeof whereClause === 'string' && whereClause.length > MAX_WHERE) {
    return res.status(400).json({ error: `whereClause 长度不能超过 ${MAX_WHERE}` });
  }
  if (orderBy != null && typeof orderBy === 'string' && orderBy.length > MAX_ORDERBY) {
    return res.status(400).json({ error: `orderBy 长度不能超过 ${MAX_ORDERBY}` });
  }

  let normalizedCols;
  try {
    normalizedCols = normalizeColumnMappings(columnMappings);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const now = new Date().toISOString();
  const id = `map-${nanoid(8)}`;
  let nextSequence = Number(sequence);
  if (!Number.isFinite(nextSequence)) {
    const sibs = await query('syncTableMappings', (m) => m.task_id === taskId);
    nextSequence = sibs.length;
  }

  const record = {
    id,
    task_id: taskId,
    source_table: sourceTable.trim().slice(0, MAX_TABLE_NAME),
    target_table: targetTable.trim().slice(0, MAX_TABLE_NAME),
    enabled: enabled === false ? false : true,
    where_clause: whereClause ? String(whereClause) : null,
    orderby: orderBy ? String(orderBy) : null,
    sequence: Math.max(0, Math.floor(nextSequence)),
    sort_order: 0,
    column_mappings: normalizedCols,
    created_at: now,
    updated_at: now,
  };
  await insert('syncTableMappings', record);
  res.status(201).json(record);
});

// PATCH /sync-table-mappings/:id
router.patch('/:id', async (req, res) => {
  const existing = await getById('syncTableMappings', req.params.id);
  if (!existing) return res.status(404).json({ error: '表映射不存在' });

  const {
    sourceTable,
    targetTable,
    enabled,
    whereClause,
    orderBy,
    columnMappings,
    sequence,
  } = req.body || {};

  const partial = { updated_at: new Date().toISOString() };

  if (sourceTable !== undefined) {
    if (!sourceTable || !sourceTable.trim()) return res.status(400).json({ error: '源表不能为空' });
    partial.source_table = sourceTable.trim().slice(0, MAX_TABLE_NAME);
  }
  if (targetTable !== undefined) {
    if (!targetTable || !targetTable.trim()) return res.status(400).json({ error: '目标表不能为空' });
    partial.target_table = targetTable.trim().slice(0, MAX_TABLE_NAME);
  }
  if (enabled !== undefined) partial.enabled = enabled !== false;
  if (whereClause !== undefined) {
    if (whereClause != null && String(whereClause).length > MAX_WHERE) {
      return res.status(400).json({ error: `whereClause 长度不能超过 ${MAX_WHERE}` });
    }
    partial.where_clause = whereClause ? String(whereClause) : null;
  }
  if (orderBy !== undefined) {
    if (orderBy != null && String(orderBy).length > MAX_ORDERBY) {
      return res.status(400).json({ error: `orderBy 长度不能超过 ${MAX_ORDERBY}` });
    }
    partial.orderby = orderBy ? String(orderBy) : null;
  }
  if (columnMappings !== undefined) {
    try {
      partial.column_mappings = normalizeColumnMappings(columnMappings);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
  }
  if (sequence !== undefined) {
    const n = Number(sequence);
    partial.sequence = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  const updated = await update('syncTableMappings', req.params.id, partial);
  if (!updated) return res.status(404).json({ error: '表映射不存在' });
  res.json(updated);
});

// DELETE /sync-table-mappings/:id
router.delete('/:id', async (req, res) => {
  const existing = await getById('syncTableMappings', req.params.id);
  if (!existing) return res.status(404).json({ error: '表映射不存在' });
  const ok = await remove('syncTableMappings', req.params.id);
  res.json({ success: ok });
});

// POST /sync-table-mappings/reorder
//   body: { taskId: 'task-xxx', orderedIds: ['map-a', 'map-b', 'map-c'] }
router.post('/reorder', async (req, res) => {
  const { taskId, orderedIds } = req.body || {};
  if (!taskId) return res.status(400).json({ error: 'taskId 不能为空' });
  if (!Array.isArray(orderedIds)) return res.status(400).json({ error: 'orderedIds 必须是数组' });

  const task = await getById('syncTasks', taskId);
  if (!task) return res.status(400).json({ error: '所属任务不存在' });

  const all = await query('syncTableMappings', (m) => m.task_id === taskId);
  const allIds = new Set(all.map((m) => m.id));
  for (const id of orderedIds) {
    if (!allIds.has(id)) {
      return res.status(400).json({ error: `映射 ${id} 不属于该任务` });
    }
  }

  const updated = [];
  for (let i = 0; i < orderedIds.length; i++) {
    const r = await update('syncTableMappings', orderedIds[i], {
      sequence: i,
      updated_at: new Date().toISOString(),
    });
    if (r) updated.push(r);
  }
  res.json({ success: true, updatedCount: updated.length });
});

export default router;
