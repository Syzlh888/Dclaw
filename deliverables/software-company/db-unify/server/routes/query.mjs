/**
 * 综合查询 API
 * 支持跨实体（服务器、数据库实例、应用实例等）的自定义字段组合查询
 * 支持查询模板的保存/加载/删除
 * 支持查询结果导出（XLSX）
 */
import { createRequire } from 'module';
import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove, query } from '../database.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const router = Router();

// ========= 字段定义 =========

const FIELD_GROUPS = [
  {
    group: '服务器',
    prefix: 'server',
    fields: [
      { key: 'server.name', label: '服务器名称' },
      { key: 'server.internalIp', label: '内网IP' },
      { key: 'server.externalIp', label: '外网IP' },
      { key: 'server.publicIp', label: '公网IP' },
      { key: 'server.os', label: '操作系统' },
      { key: 'server.cpuCores', label: 'CPU核数', type: 'number' },
      { key: 'server.memoryGB', label: '内存(GB)', type: 'number' },
      { key: 'server.systemDiskGB', label: '系统盘(GB)', type: 'number' },
      { key: 'server.dataDiskGB', label: '数据盘(GB)', type: 'number' },
      { key: 'server.storageType', label: '存储类型' },
      { key: 'server.bandwidthMbps', label: '带宽(Mbps)', type: 'number' },
      { key: 'server.serverType', label: '服务器类型' },
      { key: 'server.serverLocation', label: '服务器位置' },
      { key: 'server.deployedContent', label: '部署内容' },
      { key: 'server.macAddress', label: 'MAC地址' },
      { key: 'server.tags', label: '标签' },
      { key: 'server.notes', label: '备注' },
    ],
  },
  {
    group: '项目',
    prefix: 'project',
    fields: [
      { key: 'project.name', label: '项目名称' },
      { key: 'project.shortName', label: '项目简称' },
    ],
  },
  {
    group: '工程',
    prefix: 'engineering',
    fields: [
      { key: 'engineering.name', label: '工程名称' },
      { key: 'engineering.shortName', label: '工程简称' },
    ],
  },
  {
    group: '应用',
    prefix: 'application',
    fields: [
      { key: 'application.name', label: '应用名称' },
      { key: 'application.shortName', label: '应用简称' },
    ],
  },
  {
    group: '数据库实例',
    prefix: 'db',
    fields: [
      { key: 'db.dbType', label: '数据库类型' },
      { key: 'db.version', label: '版本' },
      { key: 'db.dbName', label: '数据库名' },
      { key: 'db.port', label: '端口', type: 'number' },
      { key: 'db.isCluster', label: '是否集群' },
      { key: 'db.clusterIps', label: '集群IP' },
      { key: 'db.internalIp', label: '内网IP' },
      { key: 'db.externalIp', label: '外网IP' },
      { key: 'db.notes', label: '备注' },
    ],
  },
  {
    group: '应用实例',
    prefix: 'app',
    fields: [
      { key: 'app.name', label: '应用名称' },
      { key: 'app.port', label: '端口', type: 'number' },
      { key: 'app.url', label: 'URL' },
      { key: 'app.contactPerson', label: '联系人' },
      { key: 'app.contactPhone', label: '联系电话' },
      { key: 'app.notes', label: '备注' },
    ],
  },
  {
    group: '中间件实例',
    prefix: 'mid',
    fields: [
      { key: 'mid.name', label: '中间件名称' },
      { key: 'mid.type', label: '类型' },
      { key: 'mid.version', label: '版本' },
      { key: 'mid.port', label: '端口', type: 'number' },
      { key: 'mid.url', label: 'URL' },
      { key: 'mid.serviceApp', label: '服务应用' },
      { key: 'mid.notes', label: '备注' },
    ],
  },
  {
    group: 'API实例',
    prefix: 'api',
    fields: [
      { key: 'api.apiAddress', label: 'API地址' },
      { key: 'api.port', label: '端口', type: 'number' },
      { key: 'api.applicationName', label: '所属应用' },
      { key: 'api.encrypted', label: '是否加密' },
      { key: 'api.encryptionMethod', label: '加密方式' },
      { key: 'api.notes', label: '备注' },
    ],
  },
  {
    group: '端口',
    prefix: 'port',
    fields: [
      { key: 'port.port', label: '端口号', type: 'number' },
      { key: 'port.protocol', label: '协议' },
      { key: 'port.type', label: '类型' },
      { key: 'port.serviceName', label: '服务名' },
      { key: 'port.notes', label: '备注' },
    ],
  },
];

// ========= 辅助函数 =========

/** 获取所有字段的扁平列表 */
function getAllFields() {
  return FIELD_GROUPS.flatMap((g) => g.fields);
}

/** 根据字段路径获取值 */
function getFieldValue(obj, fieldPath) {
  const keys = fieldPath.split('.');
  let val = obj;
  for (const k of keys) {
    if (val == null) return '';
    val = val[k];
  }
  if (val == null) return '';
  if (Array.isArray(val)) return val.join(', ');
  return val;
}

/** 应用过滤条件 */
function applyFilter(item, filters) {
  if (!filters || filters.length === 0) return true;
  return filters.every((f) => {
    const val = getFieldValue(item, f.field);
    const filterVal = f.value;
    if (!filterVal) return true;

    const strVal = String(val).toLowerCase();
    const strFilter = String(filterVal).toLowerCase();

    switch (f.operator) {
      case 'equals':
        return strVal === strFilter;
      case 'contains':
        return strVal.includes(strFilter);
      case 'gt':
        return Number(val) > Number(filterVal);
      case 'lt':
        return Number(val) < Number(filterVal);
      case 'gte':
        return Number(val) >= Number(filterVal);
      case 'lte':
        return Number(val) <= Number(filterVal);
      case 'notEquals':
        return strVal !== strFilter;
      case 'isEmpty':
        return !val || String(val).trim() === '';
      case 'isNotEmpty':
        return val && String(val).trim() !== '';
      default:
        return true;
    }
  });
}

/** 展平服务器数据（含子资源） */
function flattenServers(fields) {
  const servers = getAll('servers');
  const projects = getAll('projects');
  const engineerings = getAll('engineerings');
  const applications = getAll('applications');

  const hasSubField = (prefix) => fields.some((f) => f.startsWith(prefix + '.'));
  const hasServerField = fields.some((f) => f.startsWith('server.'));
  const hasProjectField = fields.some((f) => f.startsWith('project.'));
  const hasEngineeringField = fields.some((f) => f.startsWith('engineering.'));
  const hasApplicationField = fields.some((f) => f.startsWith('application.'));

  const result = [];

  for (const s of servers) {
    // 解析 JSON 字段
    let ips = [];
    try { ips = s.ips ? JSON.parse(s.ips) : []; } catch {}
    let credentials = [];
    try { credentials = s.credentials ? JSON.parse(s.credentials) : []; } catch {}
    let accessList = [];
    try { accessList = s.access_list ? JSON.parse(s.access_list) : []; } catch {}

    const serverObj = {
      ...s,
      ips,
      credentials,
      accessList,
      // 转换 snake_case 为 camelCase
      internalIp: s.internal_ip || s.internalIp || '',
      externalIp: s.external_ip || s.externalIp || '',
      publicIp: s.public_ip || s.publicIp || '',
      cpuCores: s.cpu_cores ?? s.cpuCores ?? 0,
      memoryGB: s.memory_gb ?? s.memoryGB ?? 0,
      systemDiskGB: s.system_disk_gb ?? s.systemDiskGB ?? 0,
      dataDiskGB: s.data_disk_gb ?? s.dataDiskGB ?? 0,
      storageType: s.storage_type || s.storageType || '',
      bandwidthMbps: s.bandwidth_mbps ?? s.bandwidthMbps ?? 0,
      serverType: s.server_type || s.serverType || '',
      serverLocation: s.server_location || s.serverLocation || '',
      deployedContent: s.deployed_content || s.deployedContent || '',
      macAddress: s.mac_address || s.macAddress || '',
      tags: s.tags ? (typeof s.tags === 'string' ? JSON.parse(s.tags) : s.tags) : [],
    };

    // 关联字典
    const project = hasProjectField ? projects.find((p) => p.id === serverObj.project_id || p.id === serverObj.projectId) || null : null;
    const engineering = hasEngineeringField ? engineerings.find((e) => e.id === serverObj.engineering_id || e.id === serverObj.engineeringId) || null : null;
    const application = hasApplicationField ? applications.find((a) => a.id === serverObj.application_id || a.id === serverObj.applicationId) || null : null;

    const baseObj = {
      ...serverObj,
      project: project || {},
      engineering: engineering || {},
      application: application || {},
    };

    // 判断是否需要展开子资源
    const needDb = hasSubField('db');
    const needApp = hasSubField('app');
    const needMid = hasSubField('mid');
    const needApi = hasSubField('api');
    const needPort = hasSubField('port');

    const hasAnySub = needDb || needApp || needMid || needApi || needPort;

    if (!hasAnySub) {
      // 不需要子资源字段，每台服务器一行
      result.push(baseObj);
    } else {
      // 需要展开子资源
      const dbInstances = needDb ? query('servers_db_instances', (d) => d.server_id === s.id || d.serverId === s.id) : [];
      const appInstances = needApp ? query('servers_app_instances', (a) => a.server_id === s.id || a.serverId === s.id) : [];
      const midInstances = needMid ? query('servers_mid_instances', (m) => m.server_id === s.id || m.serverId === s.id) : [];
      const apiInstances = needApi ? query('servers_api_instances', (a) => a.server_id === s.id || a.serverId === s.id) : [];
      const ports = needPort ? query('servers_ports', (p) => p.server_id === s.id || p.serverId === s.id) : [];

      // 转换为 camelCase
      const normalizeDb = (d) => ({
        ...d,
        dbType: d.db_type || d.dbType || '',
        version: d.version || '',
        dbName: d.db_name || d.dbName || '',
        port: d.port ?? 0,
        isCluster: d.is_cluster === 1 || d.isCluster === true,
        clusterIps: d.cluster_ips || d.clusterIps || '',
        internalIp: d.internal_ip || d.internalIp || '',
        externalIp: d.external_ip || d.externalIp || '',
        notes: d.notes || '',
      });
      const normalizeApp = (a) => ({
        ...a,
        name: a.name || '',
        port: a.port ?? 0,
        url: a.url || '',
        contactPerson: a.contact_person || a.contactPerson || '',
        contactPhone: a.contact_phone || a.contactPhone || '',
        notes: a.notes || '',
      });
      const normalizeMid = (m) => ({
        ...m,
        name: m.name || '',
        type: m.type || '',
        version: m.version || '',
        port: m.port ?? 0,
        url: m.url || '',
        serviceApp: m.service_app || m.serviceApp || '',
        notes: m.notes || '',
      });
      const normalizeApi = (a) => ({
        ...a,
        apiAddress: a.api_address || a.apiAddress || '',
        port: a.port ?? 0,
        applicationName: a.application_name || a.applicationName || '',
        encrypted: a.encrypted === 1 || a.encrypted === true,
        encryptionMethod: a.encryption_method || a.encryptionMethod || '',
        notes: a.notes || '',
      });
      const normalizePort = (p) => ({
        ...p,
        port: p.port ?? 0,
        protocol: p.protocol || '',
        type: p.type || '',
        serviceName: p.service_name || p.serviceName || '',
        notes: p.notes || '',
      });

      const dbRows = needDb ? dbInstances.map(normalizeDb) : [];
      const appRows = needApp ? appInstances.map(normalizeApp) : [];
      const midRows = needMid ? midInstances.map(normalizeMid) : [];
      const apiRows = needApi ? apiInstances.map(normalizeApi) : [];
      const portRows = needPort ? ports.map(normalizePort) : [];

      // 找出最大的子资源数量
      const maxLen = Math.max(
        dbRows.length || 1,
        appRows.length || 1,
        midRows.length || 1,
        apiRows.length || 1,
        portRows.length || 1
      );

      for (let i = 0; i < maxLen; i++) {
        result.push({
          ...baseObj,
          db: dbRows[i] || {},
          app: appRows[i] || {},
          mid: midRows[i] || {},
          api: apiRows[i] || {},
          port: portRows[i] || {},
        });
      }
    }
  }

  return result;
}

// ========= API 路由 =========

/**
 * POST /api/query
 * 执行综合查询
 * Body: { fields: string[], filters: FilterCondition[] }
 */
router.post('/', (req, res) => {
  try {
    const { fields, filters } = req.body;

    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: '请至少选择一个查询字段' });
    }

    // 展平数据
    let data = flattenServers(fields);

    // 应用过滤条件
    data = data.filter((item) => applyFilter(item, filters));

    // 提取指定字段
    const columns = fields.map((f) => {
      const fieldDef = getAllFields().find((df) => df.key === f);
      return {
        key: f,
        label: fieldDef ? fieldDef.label : f,
        type: fieldDef ? fieldDef.type || 'string' : 'string',
      };
    });

    const rows = data.map((item, idx) => {
      const row = { _id: idx };
      for (const f of fields) {
        row[f] = getFieldValue(item, f);
      }
      return row;
    });

    res.json({ columns, rows, total: rows.length });
  } catch (err) {
    console.error('综合查询错误:', err);
    res.status(500).json({ error: '查询失败：' + err.message });
  }
});

/**
 * GET /api/query/fields
 * 获取所有可用字段（按分组）
 */
router.get('/fields', (_req, res) => {
  res.json(FIELD_GROUPS);
});

/**
 * GET /api/query-templates
 * 获取所有查询模板
 */
router.get('/templates', (_req, res) => {
  try {
    const templates = getAll('queryTemplates');
    res.json(templates.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')));
  } catch (err) {
    console.error('获取查询模板错误:', err);
    res.status(500).json({ error: '获取模板失败：' + err.message });
  }
});

/**
 * POST /api/query-templates
 * 保存查询模板
 */
router.post('/templates', (req, res) => {
  try {
    const { name, fields, filters } = req.body;
    if (!name || !Array.isArray(fields)) {
      return res.status(400).json({ error: '模板名称和字段不能为空' });
    }
    const id = nanoid(12);
    const now = new Date().toISOString();
    const template = {
      id,
      name,
      fields,
      filters: filters || [],
      createdAt: now,
      updatedAt: now,
    };
    insert('queryTemplates', template);
    res.json(template);
  } catch (err) {
    console.error('保存查询模板错误:', err);
    res.status(500).json({ error: '保存模板失败：' + err.message });
  }
});

/**
 * PUT /api/query-templates/:id
 * 更新查询模板
 */
router.put('/templates/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { name, fields, filters } = req.body;
    const existing = getById('queryTemplates', id);
    if (!existing) {
      return res.status(404).json({ error: '模板不存在' });
    }
    const updated = {
      ...existing,
      name: name || existing.name,
      fields: fields || existing.fields,
      filters: filters || existing.filters || [],
      updatedAt: new Date().toISOString(),
    };
    update('queryTemplates', id, updated);
    res.json(updated);
  } catch (err) {
    console.error('更新查询模板错误:', err);
    res.status(500).json({ error: '更新模板失败：' + err.message });
  }
});

/**
 * DELETE /api/query-templates/:id
 * 删除查询模板
 */
router.delete('/templates/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = remove('queryTemplates', id);
    if (!result) {
      return res.status(404).json({ error: '模板不存在' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('删除查询模板错误:', err);
    res.status(500).json({ error: '删除模板失败：' + err.message });
  }
});

/**
 * POST /api/query/export
 * 导出查询结果为 XLSX
 */
router.post('/export', (req, res) => {
  try {
    const { fields, filters } = req.body;
    if (!Array.isArray(fields) || fields.length === 0) {
      return res.status(400).json({ error: '请至少选择一个查询字段' });
    }

    // 展平数据并执行过滤
    let data = flattenServers(fields);
    data = data.filter((item) => applyFilter(item, filters));

    // 提取指定字段
    const columns = fields.map((f) => {
      const fieldDef = getAllFields().find((df) => df.key === f);
      return {
        key: f,
        label: fieldDef ? fieldDef.label : f,
      };
    });

    const rows = data.map((item, idx) => {
      const row = { _id: idx };
      for (const f of fields) {
        row[f] = getFieldValue(item, f);
      }
      return row;
    });

    // 生成 XLSX
    const wsData = [columns.map((c) => c.label), ...rows.map((r) => columns.map((c) => r[c.key]))];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '综合查询结果');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="综合查询_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    res.send(buf);
  } catch (err) {
    console.error('导出错误:', err);
    res.status(500).json({ error: '导出失败：' + err.message });
  }
});

export default router;
