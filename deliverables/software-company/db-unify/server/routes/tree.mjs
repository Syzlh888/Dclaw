/**
 * 层级架构树管理 API
 * 四层结构：项目(Platform) → 业务模块(PreDbType) → 区域节点(District) → 连接实例(Hospital)
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  getAll, getById, insert, update, remove, removeWhere,
  getFullTree, query, reorderSiblings, initDefaultData,
} from '../database.mjs';

const router = Router();

/**
 * GET /api/tree
 * 获取完整树结构数据
 */
router.get('/', async (_req, res) => {
  let tree = await getFullTree();

  // 如果没有数据，检查并初始化默认数据
  if (!tree) {
    // 初始化默认数据
    await initDefaultData();
    tree = await getFullTree();
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
router.get('/connections', async (_req, res) => {
  const connections = (await getAll('connections')).map((c) => ({
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
router.get('/platforms-list', async (_req, res) => {
  const platforms = (await getAll('platforms')).map(p => ({ id: p.id, name: p.name }));
  res.json(platforms);
});

/**
 * GET /api/tree/predb-types-list
 * 获取指定项目下的业务模块列表
 * ?platform_id=xxx
 */
router.get('/predb-types-list', async (req, res) => {
  const { platform_id } = req.query;
  if (!platform_id) return res.status(400).json({ error: 'platform_id 不能为空' });
  const list = await query('predbTypes', p => p.platform_id === platform_id)
    .map(p => ({ id: p.id, name: p.name }));
  res.json(list);
});

/**
 * GET /api/tree/districts-list
 * 获取指定业务模块下的区域节点列表
 * ?predb_type_id=xxx
 */
router.get('/districts-list', async (req, res) => {
  const { predb_type_id } = req.query;
  if (!predb_type_id) return res.status(400).json({ error: 'predb_type_id 不能为空' });
  const list = await query('districts', d => d.predb_type_id === predb_type_id)
    .map(d => ({ id: d.id, name: d.name }));
  res.json(list);
});

/**
 * GET /api/tree/hospitals/by-connection/:connectionId
 * 查找使用指定连接的连接实例
 */
router.get('/hospitals/by-connection/:connectionId', async (req, res) => {
  const hospitals = await query('hospitals', h => h.connection_id === req.params.connectionId);
  if (hospitals.length === 0) return res.json(null);

  const hospital = hospitals[0];
  // 向上追溯完整路径
  const district = await getById('districts', hospital.district_id);
  let predbType = null;
  let platform = null;
  if (district) {
    predbType = await getById('predbTypes', district.predb_type_id);
    if (predbType) {
      platform = await getById('platforms', predbType.platform_id);
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
router.post('/platforms', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });

  const id = nanoid(8);
  const record = {
    id, name, sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insert('platforms', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/platforms/:id
 * 更新项目名称
 */
router.put('/platforms/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '项目名称不能为空' });

  const updated = await update('platforms', req.params.id, { name });
  if (!updated) return res.status(404).json({ error: '项目不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/platforms/:id
 * 删除项目及其下所有子节点
 */
router.delete('/platforms/:id', async (req, res) => {
  const existing = await getById('platforms', req.params.id);
  if (!existing) return res.status(404).json({ error: '项目不存在' });

  // 级联删除：先删连接实例（挂在此 platform 下的），再往下 predb_types → districts → hospitals
  await removeWhere('hospitals', (h) => h.platform_id === req.params.id);
  const predbTypes = await query('predbTypes', (p) => p.platform_id === req.params.id);
  for (const pt of predbTypes) {
    await removeWhere('hospitals', (h) => h.predb_type_id === pt.id);
    const districts = await query('districts', (d) => d.predb_type_id === pt.id);
    for (const d of districts) {
      await removeWhere('hospitals', (h) => h.district_id === d.id);
    }
    await removeWhere('districts', (d) => d.predb_type_id === pt.id);
  }
  await removeWhere('predbTypes', (p) => p.platform_id === req.params.id);
  await remove('platforms', req.params.id);

  res.json({ success: true });
});

// ========= 业务模块 (PreDbType) 操作 =========

/**
 * POST /api/tree/predb-types
 * 创建业务模块
 */
router.post('/predb-types', async (req, res) => {
  const { platform_id, name } = req.body;
  if (!platform_id || !name) return res.status(400).json({ error: '参数不完整' });

  const platform = await getById('platforms', platform_id);
  if (!platform) return res.status(404).json({ error: '项目不存在' });

  const id = nanoid(8);
  const record = {
    id, platform_id, name, sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insert('predbTypes', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/predb-types/:id
 * 更新业务模块
 */
router.put('/predb-types/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '名称不能为空' });

  const updated = await update('predbTypes', req.params.id, { name });
  if (!updated) return res.status(404).json({ error: '节点不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/predb-types/:id
 * 删除业务模块及其下所有子节点
 */
router.delete('/predb-types/:id', async (req, res) => {
  const existing = await getById('predbTypes', req.params.id);
  if (!existing) return res.status(404).json({ error: '节点不存在' });

  // 级联删除：先删直接挂在此 predb_type 下的连接实例，再删区域节点及其下连接实例
  await removeWhere('hospitals', (h) => h.predb_type_id === req.params.id);
  const districts = await query('districts', (d) => d.predb_type_id === req.params.id);
  for (const d of districts) {
    await removeWhere('hospitals', (h) => h.district_id === d.id);
    await remove('districts', d.id);
  }
  await remove('predbTypes', req.params.id);

  res.json({ success: true });
});

// ========= 区域节点 (District) 操作 =========

/**
 * POST /api/tree/districts
 * 创建区域节点
 */
router.post('/districts', async (req, res) => {
  const { predb_type_id, name } = req.body;
  if (!predb_type_id || !name) return res.status(400).json({ error: '参数不完整' });

  const predbType = await getById('predbTypes', predb_type_id);
  if (!predbType) return res.status(404).json({ error: '业务模块不存在' });

  const id = nanoid(8);
  const record = {
    id, predb_type_id, name, sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insert('districts', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/districts/:id
 * 更新区域节点名称
 */
router.put('/districts/:id', async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: '名称不能为空' });

  const updated = await update('districts', req.params.id, { name });
  if (!updated) return res.status(404).json({ error: '节点不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/districts/:id
 * 删除区域节点及其下所有连接实例
 */
router.delete('/districts/:id', async (req, res) => {
  const existing = await getById('districts', req.params.id);
  if (!existing) return res.status(404).json({ error: '节点不存在' });

  await removeWhere('hospitals', (h) => h.district_id === req.params.id);
  await remove('districts', req.params.id);

  res.json({ success: true });
});

// ========= 连接实例 (Hospital) 操作 =========

/**
 * POST /api/tree/hospitals
 * 创建连接实例（可挂在 district / predb_type / platform 之一）
 * Body 三选一：{ district_id | predb_type_id | platform_id, name, connection_id? }
 */
router.post('/hospitals', async (req, res) => {
  const { district_id, predb_type_id, platform_id, name, connection_id } = req.body;
  if (!name) return res.status(400).json({ error: '名称不能为空' });
  if (!district_id && !predb_type_id && !platform_id) {
    return res.status(400).json({ error: '必须指定父节点（district_id / predb_type_id / platform_id 之一）' });
  }

  // 校验父节点存在
  if (district_id && !await getById('districts', district_id)) return res.status(404).json({ error: '区域节点不存在' });
  if (predb_type_id && !await getById('predbTypes', predb_type_id)) return res.status(404).json({ error: '业务模块不存在' });
  if (platform_id && !await getById('platforms', platform_id)) return res.status(404).json({ error: '项目不存在' });

  // 如果指定了连接 ID，验证连接是否存在
  if (connection_id) {
    const conn = await getById('connections', connection_id);
    if (!conn) return res.status(404).json({ error: '数据库连接不存在' });
  }

  const id = nanoid(8);
  const record = {
    id,
    district_id: district_id || null,
    predb_type_id: predb_type_id || null,
    platform_id: platform_id || null,
    name,
    connection_id: connection_id || null,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await insert('hospitals', record);
  res.status(201).json(record);
});

/**
 * PUT /api/tree/hospitals/:id
 * 更新连接实例
 */
router.put('/hospitals/:id', async (req, res) => {
  const { name, connection_id } = req.body;
  const partial = {};
  if (name !== undefined) partial.name = name;
  if (connection_id !== undefined) partial.connection_id = connection_id || null;

  if (Object.keys(partial).length === 0) {
    return res.status(400).json({ error: '无更新数据' });
  }

  const updated = await update('hospitals', req.params.id, partial);
  if (!updated) return res.status(404).json({ error: '节点不存在' });

  res.json(updated);
});

/**
 * DELETE /api/tree/hospitals/:id
 * 删除连接实例
 */
router.delete('/hospitals/:id', async (req, res) => {
  const existing = await getById('hospitals', req.params.id);
  if (!existing) return res.status(404).json({ error: '节点不存在' });

  await remove('hospitals', req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/tree/hospitals/:id/assign-connection
 * 为连接实例分配数据库连接
 */
router.post('/hospitals/:id/assign-connection', async (req, res) => {
  const { connection_id } = req.body;
  if (!connection_id) return res.status(400).json({ error: 'connection_id 不能为空' });

  const hospital = await getById('hospitals', req.params.id);
  if (!hospital) return res.status(404).json({ error: '连接实例不存在' });

  const conn = await getById('connections', connection_id);
  if (!conn) return res.status(404).json({ error: '数据库连接不存在' });

  const updated = await update('hospitals', req.params.id, { connection_id });
  res.json(updated);
});

/**
 * POST /api/tree/hospitals/:id/move
 * 将连接实例移动到新的父节点（platform / predb_type / district 之一）
 * Body: { parent_type: 'platform'|'predb_type'|'district', parent_id: string, sibling_ids?: string[] }
 * sibling_ids 为该父节点下移动完成后的完整 hospital id 顺序（含本节点），用于同时定序。
 */
router.post('/hospitals/:id/move', async (req, res) => {
  const { parent_type, parent_id, sibling_ids } = req.body;
  const hospital = await getById('hospitals', req.params.id);
  if (!hospital) return res.status(404).json({ error: '连接实例不存在' });
  if (!parent_type || !parent_id) return res.status(400).json({ error: '需要 parent_type 和 parent_id' });

  // 校验父节点
  let patch = null;
  switch (parent_type) {
    case 'platform':
      if (!await getById('platforms', parent_id)) return res.status(404).json({ error: '项目不存在' });
      patch = { platform_id: parent_id, predb_type_id: null, district_id: null };
      break;
    case 'predb_type':
      if (!await getById('predbTypes', parent_id)) return res.status(404).json({ error: '业务模块不存在' });
      patch = { platform_id: null, predb_type_id: parent_id, district_id: null };
      break;
    case 'district':
      if (!await getById('districts', parent_id)) return res.status(404).json({ error: '区域节点不存在' });
      patch = { platform_id: null, predb_type_id: null, district_id: parent_id };
      break;
    default:
      return res.status(400).json({ error: `不支持的 parent_type: ${parent_type}` });
  }

  const updated = await update('hospitals', req.params.id, patch);
  if (!updated) return res.status(500).json({ error: '移动失败' });

  // 如果提供了 sibling_ids，同时更新 sort_order（只更新这批，其它 hospital 的 sort_order 不动）
  if (Array.isArray(sibling_ids) && sibling_ids.length > 0) {
    for (let i = 0; i < sibling_ids.length; i++) {
      await update('hospitals', sibling_ids[i], { sort_order: i });
    }
  }

  res.json({ success: true, hospital: updated });
});

// ========= 节点排序 =========

/**
 * PUT /api/tree/reorder
 * 批量更新同级节点的 sort_order
 * Body: { type: 'platform'|'predb_type'|'district'|'hospital', ids: ['id1','id2',...] }
 */
router.put('/reorder', async (req, res) => {
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
    const updated = await reorderSiblings(collection, ids);
    res.json({ success: true, updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
