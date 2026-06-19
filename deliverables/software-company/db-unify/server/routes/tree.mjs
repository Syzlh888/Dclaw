/**
 * 层级架构树管理 API
 * 四层结构：项目(Platform) → 业务模块(PreDbType) → 区域节点(District) → 连接实例(Hospital)
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  getAll, getById, insert, update, remove, removeWhere,
  getFullTree, query, reorderSiblings,
} from '../database.mjs';

const router = Router();

/**
 * GET /api/tree
 * 获取完整树结构数据
 */
router.get('/', (_req, res) => {
  let tree = getFullTree();

  // 如果没有数据，检查并初始化默认数据
  if (!tree) {
    // 初始化默认数据
    const { initDefaultData } = require('../database.mjs');
    initDefaultData();
    tree = getFullTree();
  }

  if (!tree) {
    return res.json({ nodes: {}, rootNodeIds: [] });
  }

  res.json(tree);
});

/**
 * GET /api/tree/connections
 * 获取所有连接信息（用于树节点显示连接状态）
 */
router.get('/connections', (_req, res) => {
  const connections = getAll('connections').map((c) => ({
    id: c.id,
    name: c.name,
    driver: c.driver,
    host: c.host,
    port: c.port,
    username: c.username,
    database: c.database_name,
    schema: c.schema_name,
    status: c.status,
    customDriverId: c.custom_driver_id,
  }));
  res.json({ connections });
});

// ========= 层级列表查询 =========

/**
 * GET /api/tree/platforms-list
 * 获取所有项目列表（用于级联选择器）
 */
router.get('/platforms-list', (_req, res) => {
  const platforms = getAll('platforms').map(p => ({ id: p.id, name: p.name }));
  res.json(platforms);
});

/**
 * GET /api/tree/predb-types-list
 * 获取指定项目下的业务模块列表
 * ?platform_id=xxx
 */
router.get('/predb-types-list', (req, res) => {
  const { platform_id } = req.query;
  if (!platform_id) return res.status(400).json({ error: 'platform_id 不能为空' });
  const list = query('predbTypes', p => p.platform_id === platform_id)
    .map(p => ({ id: p.id, name: p.name }));
  res.json(list);
});

/**
 * GET /api/tree/districts-list
 * 获取指定业务模块下的区域节点列表
 * ?predb_type_id=xxx
 */
router.get('/districts-list', (req, res) => {
  const { predb_type_id } = req.query;
  if (!predb_type_id) return res.status(400).json({ error: 'predb_type_id 不能为空' });
  const list = query('districts', d => d.predb_type_id === predb_type_id)
    .map(d => ({ id: d.id, name: d.name }));
  res.json(list);
});

/**
 * GET /api/tree/hospitals/by-connection/:connectionId
 * 查找使用指定连接的连接实例
 */
router.get('/hospitals/by-connection/:connectionId', (req, res) => {
  const hospitals = query('hospitals', h => h.connection_id === req.params.connectionId);
  if (hospitals.length === 0) return res.json(null);

  const hospital = hospitals[0];
  // 向上追溯完整路径
  const district = getById('districts', hospital.district_id);
  let predbType = null;
  let platform = null;
  if (district) {
    predbType = getById('predbTypes', district.predb_type_id);
    if (predbType) {
      platform = getById('platforms', predbType.platform_id);
    }
  }

  res.json({
    hospital: { id: hospital.id, name: hospital.name },
    district: district ? { id: district.id, name: district.name } : null,
    predbType: predbType ? { id: predbType.id, name: predbType.name } : null,
    platform: platform ? { id: platform.id, name: platform.name } : null,
  });
});

// ========= 项目 (Platform) 操作 =========

/**
 * POST /api/tree/platforms
 * 创建项目
 */
router.post('/platforms', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });

  const id = nanoid(8);
  const record = {
    id, name, sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  insert('platforms', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/platforms/:id
 * 更新项目名称
 */
router.put('/platforms/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });

  const updated = update('platforms', req.params.id, { name });
  if (!updated) return res.status(404).json({ error: '项目不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/platforms/:id
 * 删除项目及其下所有子节点
 */
router.delete('/platforms/:id', (req, res) => {
  const existing = getById('platforms', req.params.id);
  if (!existing) return res.status(404).json({ error: '项目不存在' });

  // 级联删除：先删连接实例，再删区域节点，再删业务模块，最后删项目
  const predbTypes = query('predbTypes', (p) => p.platform_id === req.params.id);
  for (const pt of predbTypes) {
    const districts = query('districts', (d) => d.predb_type_id === pt.id);
    for (const d of districts) {
      removeWhere('hospitals', (h) => h.district_id === d.id);
    }
    removeWhere('districts', (d) => d.predb_type_id === pt.id);
  }
  removeWhere('predbTypes', (p) => p.platform_id === req.params.id);
  remove('platforms', req.params.id);

  res.json({ success: true });
});

// ========= 业务模块 (PreDbType) 操作 =========

/**
 * POST /api/tree/predb-types
 * 创建业务模块
 */
router.post('/predb-types', (req, res) => {
  const { platform_id, name } = req.body;
  if (!platform_id || !name) return res.status(400).json({ error: '参数不完整' });

  const platform = getById('platforms', platform_id);
  if (!platform) return res.status(404).json({ error: '项目不存在' });

  const id = nanoid(8);
  const record = {
    id, platform_id, name, sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  insert('predbTypes', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/predb-types/:id
 * 更新业务模块
 */
router.put('/predb-types/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '名称不能为空' });

  const updated = update('predbTypes', req.params.id, { name });
  if (!updated) return res.status(404).json({ error: '节点不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/predb-types/:id
 * 删除业务模块及其下所有子节点
 */
router.delete('/predb-types/:id', (req, res) => {
  const existing = getById('predbTypes', req.params.id);
  if (!existing) return res.status(404).json({ error: '节点不存在' });

  // 级联删除：先删连接实例，再删区域节点，再删自身
  const districts = query('districts', (d) => d.predb_type_id === req.params.id);
  for (const d of districts) {
    removeWhere('hospitals', (h) => h.district_id === d.id);
    remove('districts', d.id);
  }
  remove('predbTypes', req.params.id);

  res.json({ success: true });
});

// ========= 区域节点 (District) 操作 =========

/**
 * POST /api/tree/districts
 * 创建区域节点
 */
router.post('/districts', (req, res) => {
  const { predb_type_id, name } = req.body;
  if (!predb_type_id || !name) return res.status(400).json({ error: '参数不完整' });

  const predbType = getById('predbTypes', predb_type_id);
  if (!predbType) return res.status(404).json({ error: '业务模块不存在' });

  const id = nanoid(8);
  const record = {
    id, predb_type_id, name, sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  insert('districts', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/districts/:id
 * 更新区域节点名称
 */
router.put('/districts/:id', (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '名称不能为空' });

  const updated = update('districts', req.params.id, { name });
  if (!updated) return res.status(404).json({ error: '节点不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/districts/:id
 * 删除区域节点及其下所有连接实例
 */
router.delete('/districts/:id', (req, res) => {
  const existing = getById('districts', req.params.id);
  if (!existing) return res.status(404).json({ error: '节点不存在' });

  removeWhere('hospitals', (h) => h.district_id === req.params.id);
  remove('districts', req.params.id);

  res.json({ success: true });
});

// ========= 连接实例 (Hospital) 操作 =========

/**
 * POST /api/tree/hospitals
 * 创建连接实例
 */
router.post('/hospitals', (req, res) => {
  const { district_id, name, connection_id } = req.body;
  if (!district_id || !name) return res.status(400).json({ error: '参数不完整' });

  const district = getById('districts', district_id);
  if (!district) return res.status(404).json({ error: '区域节点不存在' });

  // 如果指定了连接 ID，验证连接是否存在
  if (connection_id) {
    const conn = getById('connections', connection_id);
    if (!conn) return res.status(404).json({ error: '数据库连接不存在' });
  }

  const id = nanoid(8);
  const record = {
    id,
    district_id,
    name,
    connection_id: connection_id || null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  insert('hospitals', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/hospitals/:id
 * 更新连接实例
 */
router.put('/hospitals/:id', (req, res) => {
  const { name, connection_id } = req.body;
  const partial = {};
  if (name !== undefined) partial.name = name;
  if (connection_id !== undefined) partial.connection_id = connection_id || null;

  if (Object.keys(partial).length === 0) {
    return res.status(400).json({ error: '无更新数据' });
  }

  const updated = update('hospitals', req.params.id, partial);
  if (!updated) return res.status(404).json({ error: '节点不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/hospitals/:id
 * 删除连接实例
 */
router.delete('/hospitals/:id', (req, res) => {
  const existing = getById('hospitals', req.params.id);
  if (!existing) return res.status(404).json({ error: '节点不存在' });

  remove('hospitals', req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/tree/hospitals/:id/assign-connection
 * 为连接实例分配数据库连接
 */
router.post('/hospitals/:id/assign-connection', (req, res) => {
  const { connection_id } = req.body;
  if (!connection_id) return res.status(400).json({ error: 'connection_id 不能为空' });

  const hospital = getById('hospitals', req.params.id);
  if (!hospital) return res.status(404).json({ error: '连接实例不存在' });

  const conn = getById('connections', connection_id);
  if (!conn) return res.status(404).json({ error: '数据库连接不存在' });

  const updated = update('hospitals', req.params.id, { connection_id });
  res.json(updated);
});

// ========= 节点排序 =========

/**
 * PUT /api/tree/reorder
 * 批量更新同级节点的 sort_order
 * Body: { type: 'platform'|'predb_type'|'district'|'hospital', ids: ['id1','id2',...] }
 */
router.put('/reorder', (req, res) => {
  const { type, ids } = req.body;
  if (!type || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '参数不完整：需要 type 和 ids 数组' });
  }

  const collectionMap = {
    platform: 'platforms',
    predb_type: 'predbTypes',
    district: 'districts',
    hospital: 'hospitals',
  };
  const collection = collectionMap[type];
  if (!collection) {
    return res.status(400).json({ error: `不支持的节点类型: ${type}` });
  }

  try {
    const updated = reorderSiblings(collection, ids);
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
