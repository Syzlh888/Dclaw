/**
 * SQL 模板库 API
 * 预置常用巡检/统计 SQL 模板
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove } from '../database.mjs';

const router = Router();

/**
 * GET /api/templates
 * 获取所有模板
 */
router.get('/', (_req, res) => {
  const templates = getAll('sqlTemplates')
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  res.json({ templates });
});

/**
 * GET /api/templates/:id
 * 获取单个模板
 */
router.get('/:id', (req, res) => {
  const tmpl = getById('sqlTemplates', req.params.id);
  if (!tmpl) {
    return res.status(404).json({ error: '模板不存在' });
  }
  res.json(tmpl);
});

/**
 * POST /api/templates
 * 创建新模板
 */
router.post('/', (req, res) => {
  const { name, description, sql_text, category } = req.body;

  if (!name || !sql_text) {
    return res.status(400).json({ error: '模板名称和 SQL 不能为空' });
  }

  const id = nanoid(8);
  const now = new Date().toISOString();
  const template = {
    id,
    name,
    description: description || '',
    sql_text,
    category: category || '自定义',
    created_at: now,
    updated_at: now,
  };

  insert('sqlTemplates', template);
  res.status(201).json(template);
});

/**
 * PUT /api/templates/:id
 * 更新模板
 */
router.put('/:id', (req, res) => {
  const existing = getById('sqlTemplates', req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '模板不存在' });
  }

  const { name, description, sql_text, category } = req.body;
  const partial = {};
  if (name !== undefined) partial.name = name;
  if (description !== undefined) partial.description = description;
  if (sql_text !== undefined) partial.sql_text = sql_text;
  if (category !== undefined) partial.category = category;

  const updated = update('sqlTemplates', req.params.id, partial);
  res.json(updated);
});

/**
 * DELETE /api/templates/:id
 * 删除模板
 */
router.delete('/:id', (req, res) => {
  const existing = getById('sqlTemplates', req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '模板不存在' });
  }

  remove('sqlTemplates', req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/templates/preset
 * 初始化预置模板（如果模板库为空时调用）
 */
router.post('/preset', (_req, res) => {
  const existing = getAll('sqlTemplates');
  if (existing.length > 0) {
    return res.json({ templates: existing });
  }

  const presets = [
    {
      name: '数据库健康检查',
      description: '检查数据库连接数、运行时间等基本状态',
      category: '巡检',
      sql_text: `-- 数据库健康检查
SELECT 
  COUNT(*) AS total_connections,
  NOW() AS check_time
FROM information_schema.PROCESSLIST;`,
    },
    {
      name: '表空间使用情况',
      description: '查询各数据库/表的空间占用',
      category: '巡检',
      sql_text: `-- 表空间使用情况
SELECT 
  table_schema,
  table_name,
  ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
FROM information_schema.tables
WHERE table_schema NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
ORDER BY size_mb DESC
LIMIT 20;`,
    },
    {
      name: '用户权限查询',
      description: '查看数据库用户及权限',
      category: '安全',
      sql_text: `-- 用户权限查询
SELECT user, host FROM mysql.user ORDER BY user;`,
    },
    {
      name: '慢查询统计',
      description: '统计慢查询日志',
      category: '性能',
      sql_text: `-- 慢查询统计
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';`,
    },
    {
      name: '数据行数统计',
      description: '统计各业务表的数据行数',
      category: '统计',
      sql_text: `-- 数据行数统计（替换 your_schema 为实际 schema 名）
SELECT 
  table_name,
  table_rows,
  ROUND(data_length / 1024 / 1024, 2) AS data_mb
FROM information_schema.tables
WHERE table_schema = 'your_schema'
ORDER BY table_rows DESC;`,
    },
  ];

  const now = new Date().toISOString();
  const created = presets.map((p) => ({
    id: nanoid(8),
    ...p,
    created_at: now,
    updated_at: now,
  }));

  for (const tmpl of created) {
    insert('sqlTemplates', tmpl);
  }

  res.status(201).json({ templates: created });
});

export default router;
