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
const MAX_CUSTOM_SQL = 16000;
const MAX_INCREMENTAL_COLUMN = 128;
const MAX_CHECKPOINT_VALUE = 256;
const ALLOWED_INCREMENTAL_TYPES = new Set(['timestamp', 'numeric']);
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;

/**
 * 校验并规范化增量同步配置：
 *   - incrementalColumn 必须是合法 SQL 标识符（允许 schema.table.col）
 *   - incrementalType 必须是 timestamp / numeric
 *   - checkpointValue 长度上限 256
 * 返回 null 表示「未启用增量」（任一字段未提供）
 */
function normalizeIncremental({ incrementalColumn, incrementalType, checkpointValue }) {
  const colPresent = incrementalColumn !== undefined && incrementalColumn !== null && incrementalColumn !== '';
  const typePresent = incrementalType !== undefined && incrementalType !== null && incrementalType !== '';
  const valuePresent = checkpointValue !== undefined && checkpointValue !== null && checkpointValue !== '';

  if (!colPresent && !typePresent && !valuePresent) {
    return { enabled: false, column: null, type: null, value: null };
  }

  if (!colPresent) {
    throw new Error('启用增量同步时，incrementalColumn 必填');
  }
  const col = String(incrementalColumn).trim();
  if (!col) throw new Error('incrementalColumn 不能为空');
  if (col.length > MAX_INCREMENTAL_COLUMN) {
    throw new Error(`incrementalColumn 长度不能超过 ${MAX_INCREMENTAL_COLUMN}`);
  }
  if (!IDENTIFIER_PATTERN.test(col)) {
    throw new Error('incrementalColumn 只能包含字母、数字、下划线和点号');
  }

  const type = typePresent ? String(incrementalType).trim().toLowerCase() : 'timestamp';
  if (!ALLOWED_INCREMENTAL_TYPES.has(type)) {
    throw new Error(`incrementalType 必须是 ${Array.from(ALLOWED_INCREMENTAL_TYPES).join(' / ')}`);
  }

  const value = valuePresent ? String(checkpointValue) : null;
  if (value != null && value.length > MAX_CHECKPOINT_VALUE) {
    throw new Error(`checkpointValue 长度不能超过 ${MAX_CHECKPOINT_VALUE}`);
  }
  if (type === 'numeric' && value != null && value !== '' && !Number.isFinite(Number(value))) {
    throw new Error(`incrementalType 为 numeric 时，checkpointValue 必须是合法数字`);
  }

  return { enabled: true, column: col, type, value: value === '' ? null : value };
}

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
    customSql,
    incrementalColumn,
    incrementalType,
    checkpointValue,
  } = req.body || {};

  if (!taskId) return res.status(400).json({ error: '所属任务 (taskId) 不能为空' });

  const hasCustomSql = typeof customSql === 'string' && customSql.trim().length > 0;
  if (!hasCustomSql && (!sourceTable || !sourceTable.trim())) {
    return res.status(400).json({ error: '源表 (sourceTable) 或自定义 SQL (customSql) 必须填一个' });
  }
  if (!targetTable || !targetTable.trim()) return res.status(400).json({ error: '目标表 (targetTable) 不能为空' });

  const task = await getById('syncTasks', taskId);
  if (!task) return res.status(400).json({ error: '所属任务不存在' });

  if (whereClause != null && typeof whereClause === 'string' && whereClause.length > MAX_WHERE) {
    return res.status(400).json({ error: `whereClause 长度不能超过 ${MAX_WHERE}` });
  }
  if (orderBy != null && typeof orderBy === 'string' && orderBy.length > MAX_ORDERBY) {
    return res.status(400).json({ error: `orderBy 长度不能超过 ${MAX_ORDERBY}` });
  }
  if (customSql != null && typeof customSql === 'string' && customSql.length > MAX_CUSTOM_SQL) {
    return res.status(400).json({ error: `customSql 长度不能超过 ${MAX_CUSTOM_SQL}` });
  }
  if (customSql != null && String(customSql).trim()) {
    const trimmed = String(customSql).trim().replace(/;\s*$/, '');
    if (!/^(SELECT|WITH)\b/i.test(trimmed)) {
      return res.status(400).json({ error: 'customSql 必须是 SELECT 或 WITH 查询' });
    }
  }

  let normalizedCols;
  try {
    normalizedCols = normalizeColumnMappings(columnMappings);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let incremental;
  try {
    incremental = normalizeIncremental({ incrementalColumn, incrementalType, checkpointValue });
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
    source_table: hasCustomSql
      ? (sourceTable ? sourceTable.trim().slice(0, MAX_TABLE_NAME) : '__custom_sql__')
      : sourceTable.trim().slice(0, MAX_TABLE_NAME),
    target_table: targetTable.trim().slice(0, MAX_TABLE_NAME),
    enabled: enabled === false ? false : true,
    where_clause: whereClause ? String(whereClause) : null,
    orderby: orderBy ? String(orderBy) : null,
    sequence: Math.max(0, Math.floor(nextSequence)),
    sort_order: 0,
    custom_sql: hasCustomSql ? String(customSql).trim() : null,
    column_mappings: normalizedCols,
    incremental_column: incremental.column,
    incremental_type: incremental.type,
    checkpoint_value: incremental.value,
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
    customSql,
    incrementalColumn,
    incrementalType,
    checkpointValue,
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
  if (customSql !== undefined) {
    if (customSql != null && String(customSql).length > MAX_CUSTOM_SQL) {
      return res.status(400).json({ error: `customSql 长度不能超过 ${MAX_CUSTOM_SQL}` });
    }
    const trimmed = customSql == null ? '' : String(customSql).trim();
    if (trimmed && !/^(SELECT|WITH)\b/i.test(trimmed)) {
      return res.status(400).json({ error: 'customSql 必须是 SELECT 或 WITH 查询' });
    }
    partial.custom_sql = trimmed ? trimmed : null;
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

  // 增量同步配置：支持「清空」—— 显式传 null/空串则视为禁用
  const incrementalTouched =
    incrementalColumn !== undefined || incrementalType !== undefined || checkpointValue !== undefined;
  if (incrementalTouched) {
    try {
      const inc = normalizeIncremental({ incrementalColumn, incrementalType, checkpointValue });
      partial.incremental_column = inc.column;
      partial.incremental_type = inc.type;
      partial.checkpoint_value = inc.value;
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
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
