/**
 * 基于 JSON 文件的持久化数据存储
 * 异步写入 + 写入队列，避免数据竞争
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// 数据文件映射
const DATA_FILES = {
  platforms: 'platforms.json',
  predbTypes: 'predb_types.json',
  districts: 'districts.json',
  hospitals: 'hospitals.json',
  connections: 'connections.json',
  drivers: 'drivers.json',
  executionHistory: 'execution_history.json',
  executionTasks: 'execution_tasks.json',
  sqlTemplates: 'sql_templates.json',
  sqlScripts: 'sql_scripts.json',
  projects: 'projects.json',
  engineerings: 'engineerings.json',
  applications: 'applications.json',
  servers: 'servers.json',
  servers_db_instances: 'servers_db_instances.json',
  servers_app_instances: 'servers_app_instances.json',
  servers_mid_instances: 'servers_mid_instances.json',
  servers_ports: 'servers_ports.json',
  access_entries: 'access_entries.json',
  passwordHistory: 'password_history.json',
  systemConfig: 'system_config.json',
};

/** 内存缓存 */
const cache = {};

/** 写入队列：保证同一集合的写入串行执行 */
const writeQueue = {};

/**
 * 将写入任务加入队列，同一集合串行写入
 */
function enqueueWrite(collection) {
  if (!writeQueue[collection]) {
    writeQueue[collection] = Promise.resolve();
  }
  const task = writeQueue[collection].then(() => writeToDisk(collection));
  writeQueue[collection] = task.catch(() => {});
  return task;
}

/**
 * 异步写入磁盘
 */
async function writeToDisk(collection) {
  const filePath = path.join(DATA_DIR, DATA_FILES[collection]);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = filePath + '.tmp';
  const data = JSON.stringify(cache[collection] || [], null, 2);
  // 先写临时文件，再原子重命名
  await fs.promises.writeFile(tmpPath, data, 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

/**
 * 初始化数据目录和默认数据
 */
export function initDatabase() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  for (const [name, filename] of Object.entries(DATA_FILES)) {
    const filePath = path.join(DATA_DIR, filename);
    if (fs.existsSync(filePath)) {
      try {
        cache[name] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      } catch {
        cache[name] = [];
        saveCollectionSync(name);
      }
    } else {
      cache[name] = [];
      saveCollectionSync(name);
    }
  }
}

/** 同步保存（仅初始化时使用） */
function saveCollectionSync(name) {
  const filePath = path.join(DATA_DIR, DATA_FILES[name]);
  fs.writeFileSync(filePath, JSON.stringify(cache[name] || [], null, 2), 'utf8');
}

// ========= 通用 CRUD 操作 =========

export function getAll(collection) {
  return cache[collection] || [];
}

export function getById(collection, id) {
  return (cache[collection] || []).find((item) => item.id === id) || null;
}

export function query(collection, predicate) {
  return (cache[collection] || []).filter(predicate);
}

export function insert(collection, record) {
  if (!cache[collection]) cache[collection] = [];
  cache[collection].push(record);
  enqueueWrite(collection);
  return record;
}

export function update(collection, id, partial) {
  const items = cache[collection] || [];
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return null;

  const updated = { ...items[idx], ...partial, updated_at: new Date().toISOString() };
  items[idx] = updated;
  enqueueWrite(collection);
  return updated;
}

export function remove(collection, id) {
  const items = cache[collection] || [];
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return false;

  items.splice(idx, 1);
  enqueueWrite(collection);
  return true;
}

export function removeWhere(collection, predicate) {
  const items = cache[collection] || [];
  const before = items.length;
  cache[collection] = items.filter((item) => !predicate(item));
  if (cache[collection].length !== before) {
    enqueueWrite(collection);
  }
  return before - cache[collection].length;
}

export function getByParentId(collection, parentId) {
  return (cache[collection] || []).filter((item) => item.parent_id === parentId);
}

/**
 * 获取完整树结构
 */
export function getFullTree() {
  const platforms = getAll('platforms');
  const predbTypes = getAll('predbTypes');
  const districts = getAll('districts');
  const hospitals = getAll('hospitals');
  const connections = getAll('connections');

  const nodes = {};

  if (platforms.length === 0) {
    return null;
  }

  for (const p of platforms) {
    nodes[p.id] = {
      id: p.id, name: p.name, type: 'platform',
      checkState: 'unchecked', expanded: true, parentId: null,
      childrenIds: [], visible: true, sortOrder: p.sort_order ?? 0,
    };
  }

  for (const pt of predbTypes) {
    nodes[pt.id] = {
      id: pt.id, name: pt.name, type: 'predb_type',
      checkState: 'unchecked', expanded: true, parentId: pt.platform_id,
      childrenIds: [], visible: true, sortOrder: pt.sort_order ?? 0,
    };
    if (nodes[pt.platform_id]) nodes[pt.platform_id].childrenIds.push(pt.id);
  }

  for (const d of districts) {
    nodes[d.id] = {
      id: d.id, name: d.name, type: 'district',
      checkState: 'unchecked', expanded: false, parentId: d.predb_type_id,
      childrenIds: [], visible: true, sortOrder: d.sort_order ?? 0,
    };
    if (nodes[d.predb_type_id]) nodes[d.predb_type_id].childrenIds.push(d.id);
  }

  for (const h of hospitals) {
    const conn = connections.find((c) => c.id === h.connection_id);
    nodes[h.id] = {
      id: h.id, name: h.name, type: 'hospital',
      checkState: 'unchecked', expanded: false, parentId: h.district_id,
      childrenIds: [], dbConnectionId: h.connection_id || undefined,
      visible: true, sortOrder: h.sort_order ?? 0,
      connectionStatus: conn?.status || 'unknown',
    };
    if (nodes[h.district_id]) nodes[h.district_id].childrenIds.push(h.id);
  }

  const rootNodeIds = platforms
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((p) => p.id);

  for (const node of Object.values(nodes)) {
    if (node.childrenIds.length > 1) {
      node.childrenIds.sort((a, b) => {
        const aOrder = nodes[a]?.sortOrder ?? 0;
        const bOrder = nodes[b]?.sortOrder ?? 0;
        return aOrder - bOrder;
      });
    }
  }

  return { nodes, rootNodeIds };
}

export function reorderSiblings(collection, ids) {
  const updated = [];
  for (let i = 0; i < ids.length; i++) {
    const result = update(collection, ids[i], { sort_order: i });
    if (result) updated.push(result);
  }
  return updated;
}

export function initDefaultData() {
  if (getAll('platforms').length > 0) return;

  const pid = nanoid(8);
  insert('platforms', {
    id: pid, name: '示例项目', sort_order: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  const emrId = nanoid(8);
  const healthId = nanoid(8);

  insert('predbTypes', {
    id: emrId, platform_id: pid, name: '数据交换模块', sort_order: 0,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  insert('predbTypes', {
    id: healthId, platform_id: pid, name: '数据归档模块', sort_order: 1,
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  });

  const districts = [
    { predbTypeId: emrId, name: '中心区域' },
    { predbTypeId: emrId, name: '东部区域' },
    { predbTypeId: healthId, name: '中心区域' },
    { predbTypeId: healthId, name: '东部区域' },
  ];

  const districtIds = {};
  for (const d of districts) {
    const did = nanoid(8);
    districtIds[`${d.predbTypeId}_${d.name}`] = did;
    insert('districts', {
      id: did, predb_type_id: d.predbTypeId, name: d.name, sort_order: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }

  const hospitalData = [
    { district: `${emrId}_中心区域`, name: '生产主库' },
    { district: `${emrId}_中心区域`, name: '只读副本' },
    { district: `${emrId}_东部区域`, name: '区域数据库-1' },
    { district: `${emrId}_东部区域`, name: '区域数据库-2' },
    { district: `${emrId}_东部区域`, name: '区域数据库-3' },
    { district: `${healthId}_中心区域`, name: '生产主库' },
    { district: `${healthId}_中心区域`, name: '只读副本' },
    { district: `${healthId}_东部区域`, name: '区域数据库-1' },
    { district: `${healthId}_东部区域`, name: '区域数据库-2' },
    { district: `${healthId}_东部区域`, name: '区域数据库-3' },
  ];

  for (const h of hospitalData) {
    const hid = nanoid(8);
    insert('hospitals', {
      id: hid, district_id: districtIds[h.district], name: h.name,
      connection_id: null, sort_order: 0,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
  }

  // 初始化内置驱动
  const builtinDrivers = [
    { id: 'mysql-builtin', name: 'MySQL', version: '8.0.33', driverClass: 'com.mysql.cj.jdbc.Driver', fileName: 'mysql-connector-j-8.0.33.jar', fileSize: 2500000, dbType: 'mysql', isBuiltIn: true, description: 'MySQL 官方 JDBC 驱动（内置）', uploadTime: new Date().toISOString() },
    { id: 'postgresql-builtin', name: 'PostgreSQL', version: '42.7.1', driverClass: 'org.postgresql.Driver', fileName: 'postgresql-42.7.1.jar', fileSize: 1000000, dbType: 'postgresql', isBuiltIn: true, description: 'PostgreSQL 官方 JDBC 驱动（内置）', uploadTime: new Date().toISOString() },
    { id: 'oracle-builtin', name: 'Oracle', version: '19.21.0', driverClass: 'oracle.jdbc.OracleDriver', fileName: 'ojdbc8-19.21.0.0.jar', fileSize: 4194304, dbType: 'oracle', isBuiltIn: true, description: 'Oracle 官方 JDBC 驱动（内置）', uploadTime: new Date().toISOString() },
  ];
  for (const d of builtinDrivers) insert('drivers', d);

  console.log('✅ 默认数据已初始化');
}
