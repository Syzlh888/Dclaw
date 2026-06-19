/**
 * SQL 脚本管理 API
 * 支持保存、加载、删除 SQL 脚本
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove } from '../database.mjs';

const router = Router();

/**
 * GET /api/scripts
 * 获取所有脚本列表（不含 sql_text 以减小响应体积）
 */
router.get('/', (_req, res) => {
  const scripts = getAll('sqlScripts')
    .map(({ sql_text, ...rest }) => ({ ...rest, sql_preview: sql_text?.slice(0, 100) || '' }))
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  res.json({ scripts });
});

/**
 * GET /api/scripts/:id
 * 获取单个脚本（含完整 sql_text）
 */
router.get('/:id', (req, res) => {
  const script = getById('sqlScripts', req.params.id);
  if (!script) {
    return res.status(404).json({ error: '脚本不存在' });
  }
  res.json(script);
});

/**
 * POST /api/scripts
 * 保存新脚本
 */
router.post('/', (req, res) => {
  const { name, description, sql_text } = req.body;

  if (!name || !sql_text) {
    return res.status(400).json({ error: '脚本名称和 SQL 内容不能为空' });
  }

  const id = nanoid(8);
  const now = new Date().toISOString();
  const script = {
    id,
    name,
    description: description || '',
    sql_text,
    created_at: now,
    updated_at: now,
  };

  insert('sqlScripts', script);
  res.status(201).json(script);
});

/**
 * PUT /api/scripts/:id
 * 更新已有脚本
 */
router.put('/:id', (req, res) => {
  const existing = getById('sqlScripts', req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '脚本不存在' });
  }

  const { name, description, sql_text } = req.body;
  const partial = {};
  if (name !== undefined) partial.name = name;
  if (description !== undefined) partial.description = description;
  if (sql_text !== undefined) partial.sql_text = sql_text;

  const updated = update('sqlScripts', req.params.id, partial);
  res.json(updated);
});

/**
 * DELETE /api/scripts/:id
 * 删除脚本
 */
router.delete('/:id', (req, res) => {
  const existing = getById('sqlScripts', req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '脚本不存在' });
  }

  remove('sqlScripts', req.params.id);
  res.json({ success: true });
});

export default router;
