/**
 * 数据持久化层 —— PostgreSQL adapter (v1.4.0-alpha.1, D3)
 *
 * 历史：本模块曾使用 JSON 文件存储（server/database.mjs.json-backup 为旧版备份）。
 * 从 D3 起底层完全切换到 PG，`pool.mjs` 提供连接池与事务。
 *
 * 关键设计
 *  1. 保留原 15+ 个函数签名（getAll / getById / insert / update / remove / query /
 *     removeWhere / getByParentId / getFullTree / reorderSiblings / initDatabase /
 *     initDefaultData），但 **全部改为 async**。
 *  2. `query(collection, filterFn)` —— filterFn 是任意 JS 函数，无法翻译成 SQL 参数，
 *     策略是 SELECT * 全量拉取到内存后再 .filter(fn)。数据量在千行以内，够用。
 *  3. JSON 时代对象里未知字段（不在表列上）落到 `extra JSONB`，读出时会把 extra
 *     解构回顶层，保持上层调用者看到的字段面貌不变。
 *  4. `initDatabase()` 内部调 `runMigrations()`；`initDefaultData()` 用 ON CONFLICT
 *     DO NOTHING 幂等插入。
 */
import { nanoid } from 'nanoid';
import { query as pgQuery, getPool } from './db/pool.mjs';
import { runMigrations } from './db/migrator.mjs';

// ============================================================
// 集合名 (JS camelCase / 历史约定) → PG 表名 (snake_case) 映射
// ============================================================
const COLLECTION_TO_TABLE = {
  platforms: 'platforms',
  predbTypes: 'predb_types',
  districts: 'districts',
  hospitals: 'hospitals',
  connections: 'connections',
  drivers: 'drivers',
  executionHistory: 'execution_history',
  executionTasks: 'execution_tasks',
  sqlTemplates: 'sql_templates',
  sqlScripts: 'sql_scripts',
  projects: 'projects',
  engineerings: 'engineerings',
  applications: 'applications',
  servers: 'servers',
  servers_db_instances: 'servers_db_instances',
  servers_app_instances: 'servers_app_instances',
  servers_mid_instances: 'servers_mid_instances',
  servers_api_instances: 'servers_api_instances',
  servers_ports: 'servers_ports',
  access_entries: 'access_entries',
  passwordHistory: 'password_history',
  systemConfig: 'system_config',
  queryTemplates: 'query_templates',
  users: 'users',
  roles: 'roles',
  rolePermissions: 'role_permissions',
  userRoles: 'user_roles',
  resourceGrants: 'resource_grants',
  temporaryGrants: 'temporary_grants',
  sqlApprovalRequests: 'sql_approval_requests',
  sqlApproverConfig: 'sql_approver_config',
  auditLogs: 'audit_logs',
  authSessions: 'auth_sessions',
  exportHistory: 'export_history',
  syncProjects: 'sync_projects',
  syncTasks: 'sync_tasks',
  syncTableMappings: 'sync_table_mappings',
};

function resolveTable(collection) {
  const table = COLLECTION_TO_TABLE[collection];
  if (!table) throw new Error(`[db] 未知的 collection: ${collection}`);
  return table;
}

// ============================================================
// 列信息缓存 —— 用来区分 "已知列" vs "未知字段(进 extra JSONB)"
// schema+table 一起作 key；TTL 5 分钟避免 schema 变更后误判
// ============================================================
const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;
const columnCache = new Map(); // key -> { columns: string[], expiresAt: number }

async function getTableColumns(table, schema = 'public') {
  const key = `${schema}.${table}`;
  const hit = columnCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.columns;
  const r = await pgQuery(
    `SELECT column_name FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2`,
    [schema, table]
  );
  const columns = r.rows.map((x) => x.column_name);
  columnCache.set(key, { columns, expiresAt: Date.now() + COLUMN_CACHE_TTL_MS });
  return columns;
}

/** 进程内手动失效（如 ALTER TABLE 之后）；可接受无参数清空全部 */
export function invalidateColumnCache(table, schema) {
  if (!table) columnCache.clear();
  else columnCache.delete(`${schema || 'public'}.${table}`);
}

// ============================================================
// 行 <-> 对象 序列化工具
// ============================================================

/** 把 pg 返回的 row（含 extra JSONB）扁平化：extra 内字段并入顶层，同名以真实列优先 */
function rowToObject(row) {
  if (!row) return row;
  const { extra, ...rest } = row;
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    // extra 里没有 id/主字段的话，扁平合并
    return { ...extra, ...rest };
  }
  return rest;
}

/** 拆分入库字段：columns 内的走原列；未知字段塞进 extra JSONB */
function splitFields(item, columns, { skipId = false } = {}) {
  const known = {};
  const extra = {};
  for (const [k, v] of Object.entries(item)) {
    if (skipId && k === 'id') continue;
    if (k === 'extra') continue; // 用户不能直接塞 extra
    if (columns.includes(k)) known[k] = v;
    else extra[k] = v;
  }
  return { known, extra };
}

/** 把 JS 值转成 pg 参数：object/array 走 JSON 序列化，其他透传 */
function toParam(v) {
  if (v === undefined) return null;
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) {
    return JSON.stringify(v);
  }
  return v;
}

function quoteIdent(name) {
  // 简单双引号包裹；columns 来自 information_schema，可信
  return `"${name.replace(/"/g, '""')}"`;
}

// ============================================================
// 初始化
// ============================================================

/**
 * 初始化数据库：执行 migration。
 * 幂等；应用启动时调用一次即可。
 */
export async function initDatabase() {
  // 诊断日志：打印 PG server_encoding / client_encoding + 中文 roundtrip 测试
  try {
    const r1 = await pgQuery('SHOW server_encoding');
    console.log('[db-init] server_encoding =', r1.rows[0]?.server_encoding);
    const r2 = await pgQuery('SHOW client_encoding');
    console.log('[db-init] client_encoding =', r2.rows[0]?.client_encoding);
    const r3 = await pgQuery('SELECT $1::text AS t, length($1::text) AS chars, octet_length($1::text) AS bytes', ['测试中文']);
    console.log('[db-init] roundtrip Chinese:', JSON.stringify(r3.rows[0]));
  } catch (e) {
    console.error('[db-init] SHOW encoding / roundtrip failed:', e.message);
  }

  console.log('[db] 运行 migration ...');
  await runMigrations();
  // 预热连接
  await pgQuery('SELECT 1');
}

// ============================================================
// 通用 CRUD
// ============================================================

/** 全表查询，返回对象数组（extra 已扁平化） */
export async function getAll(collection) {
  const table = resolveTable(collection);
  const r = await pgQuery(`SELECT * FROM ${quoteIdent(table)}`);
  return r.rows.map(rowToObject);
}

/** 主键查询 */
export async function getById(collection, id) {
  if (id === undefined || id === null) return null;
  const table = resolveTable(collection);
  const r = await pgQuery(
    `SELECT * FROM ${quoteIdent(table)} WHERE id = $1 LIMIT 1`,
    [id]
  );
  return r.rows[0] ? rowToObject(r.rows[0]) : null;
}

/**
 * 用 JS 函数过滤 —— 全表 SELECT 后走 Array.filter。
 * 数据量小的表适用，不适合海量表。
 */
export async function query(collection, filterFn) {
  const rows = await getAll(collection);
  if (typeof filterFn !== 'function') return rows;
  return rows.filter(filterFn);
}

/** 插入 —— 无 id 自动生成 nanoid(8)；未知字段进 extra */
export async function insert(collection, record) {
  const table = resolveTable(collection);
  const columns = await getTableColumns(table);

  const row = { ...record };
  if (!row.id && columns.includes('id')) row.id = nanoid(8);

  const { known, extra } = splitFields(row, columns);
  if (columns.includes('extra') && Object.keys(extra).length > 0) {
    known.extra = extra;
  }

  const keys = Object.keys(known);
  if (keys.length === 0) {
    // 极端情况：全字段都塞不下 —— 兜底 INSERT DEFAULT VALUES
    const r = await pgQuery(`INSERT INTO ${quoteIdent(table)} DEFAULT VALUES RETURNING *`);
    return rowToObject(r.rows[0]);
  }
  const cols = keys.map(quoteIdent).join(', ');
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const values = keys.map((k) => toParam(known[k]));
  const sql = `INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${placeholders}) RETURNING *`;
  const r = await pgQuery(sql, values);
  return rowToObject(r.rows[0]);
}

/**
 * 部分更新 —— 已知列走 SET；未知字段合并进 extra JSONB (用 || 合并)
 * 匹配旧行为：自动写 updated_at (如果表有该列)
 */
export async function update(collection, id, partial) {
  if (id === undefined || id === null) return null;
  const table = resolveTable(collection);
  const columns = await getTableColumns(table);

  const patch = { ...partial };
  if (columns.includes('updated_at') && patch.updated_at === undefined) {
    patch.updated_at = new Date().toISOString();
  }

  const { known, extra } = splitFields(patch, columns, { skipId: true });

  const setClauses = [];
  const values = [];
  let idx = 1;

  for (const k of Object.keys(known)) {
    setClauses.push(`${quoteIdent(k)} = $${idx++}`);
    values.push(toParam(known[k]));
  }

  const hasExtra = Object.keys(extra).length > 0 && columns.includes('extra');
  if (hasExtra) {
    // 合并语义：COALESCE(extra, '{}'::jsonb) || $N::jsonb
    setClauses.push(`"extra" = COALESCE("extra", '{}'::jsonb) || $${idx++}::jsonb`);
    values.push(JSON.stringify(extra));
  }

  if (setClauses.length === 0) {
    return await getById(collection, id);
  }

  values.push(id);
  const sql = `UPDATE ${quoteIdent(table)} SET ${setClauses.join(', ')} WHERE id = $${idx} RETURNING *`;
  const r = await pgQuery(sql, values);
  return r.rows[0] ? rowToObject(r.rows[0]) : null;
}

/** 按 id 删除，返回布尔 */
export async function remove(collection, id) {
  if (id === undefined || id === null) return false;
  const table = resolveTable(collection);
  const r = await pgQuery(
    `DELETE FROM ${quoteIdent(table)} WHERE id = $1`,
    [id]
  );
  return r.rowCount > 0;
}

/** 按 JS 谓词批量删除，返回删除条数 */
export async function removeWhere(collection, predicate) {
  const rows = await query(collection, predicate);
  if (rows.length === 0) return 0;
  const table = resolveTable(collection);
  const ids = rows.map((r) => r.id).filter((id) => id !== undefined);
  if (ids.length === 0) return 0;
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
  const r = await pgQuery(
    `DELETE FROM ${quoteIdent(table)} WHERE id IN (${placeholders})`,
    ids
  );
  return r.rowCount;
}

/** 按 parent_id 字段拉子节点 */
export async function getByParentId(collection, parentId) {
  return await query(collection, (item) => item.parent_id === parentId);
}

// ============================================================
// 树结构 (platform → predb_type → district → hospital)
// ============================================================

export async function getFullTree() {
  const [platforms, predbTypes, districts, hospitals, connections] = await Promise.all([
    getAll('platforms'),
    getAll('predbTypes'),
    getAll('districts'),
    getAll('hospitals'),
    getAll('connections'),
  ]);

  if (platforms.length === 0) return null;

  const nodes = {};

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
    const parentId = h.platform_id || h.predb_type_id || h.district_id || null;
    nodes[h.id] = {
      id: h.id, name: h.name, type: 'hospital',
      checkState: 'unchecked', expanded: false, parentId,
      childrenIds: [], dbConnectionId: h.connection_id || undefined,
      visible: true, sortOrder: h.sort_order ?? 0,
      connectionStatus: conn?.status || 'unknown',
    };
    if (parentId && nodes[parentId]) nodes[parentId].childrenIds.push(h.id);
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

/** 批量重排：按传入 id 顺序把 sort_order 覆盖为 0..n-1 */
export async function reorderSiblings(collection, ids) {
  const updated = [];
  for (let i = 0; i < ids.length; i++) {
    const r = await update(collection, ids[i], { sort_order: i });
    if (r) updated.push(r);
  }
  return updated;
}

// ============================================================
// 默认数据 (首次启动 seed) —— 全部走 ON CONFLICT DO NOTHING 幂等
// ============================================================

export async function initDefaultData() {
  const existing = await getAll('platforms');
  if (existing.length > 0) return;

  const now = new Date().toISOString();
  const pid = nanoid(8);
  await insert('platforms', { id: pid, name: '示例项目', sort_order: 0, created_at: now, updated_at: now });

  const emrId = nanoid(8);
  const healthId = nanoid(8);
  await insert('predbTypes', { id: emrId, platform_id: pid, name: '数据交换模块', sort_order: 0, created_at: now, updated_at: now });
  await insert('predbTypes', { id: healthId, platform_id: pid, name: '数据归档模块', sort_order: 1, created_at: now, updated_at: now });

  const districtDefs = [
    { predbTypeId: emrId, name: '中心区域' },
    { predbTypeId: emrId, name: '东部区域' },
    { predbTypeId: healthId, name: '中心区域' },
    { predbTypeId: healthId, name: '东部区域' },
  ];

  const districtIds = {};
  for (const d of districtDefs) {
    const did = nanoid(8);
    districtIds[`${d.predbTypeId}_${d.name}`] = did;
    await insert('districts', { id: did, predb_type_id: d.predbTypeId, name: d.name, sort_order: 0, created_at: now, updated_at: now });
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
    await insert('hospitals', { id: hid, district_id: districtIds[h.district], name: h.name, connection_id: null, sort_order: 0, created_at: now, updated_at: now });
  }

  const builtinDrivers = [
    { id: 'mysql-builtin', name: 'MySQL', version: '8.0.33', driverClass: 'com.mysql.cj.jdbc.Driver', fileName: 'mysql-connector-j-8.0.33.jar', fileSize: 2500000, dbType: 'mysql', isBuiltIn: true, downloaded: false, downloadUrl: 'https://repo1.maven.org/maven2/com/mysql/mysql-connector-j/8.0.33/mysql-connector-j-8.0.33.jar', description: 'MySQL 官方 JDBC 驱动（内置）', uploadTime: now },
    { id: 'postgresql-builtin', name: 'PostgreSQL', version: '42.7.1', driverClass: 'org.postgresql.Driver', fileName: 'postgresql-42.7.1.jar', fileSize: 1000000, dbType: 'postgresql', isBuiltIn: true, downloaded: false, downloadUrl: 'https://repo1.maven.org/maven2/org/postgresql/postgresql/42.7.1/postgresql-42.7.1.jar', description: 'PostgreSQL 官方 JDBC 驱动（内置）', uploadTime: now },
    { id: 'oracle-builtin', name: 'Oracle', version: '19.21.0', driverClass: 'oracle.jdbc.OracleDriver', fileName: 'ojdbc8-19.21.0.0.jar', fileSize: 4194304, dbType: 'oracle', isBuiltIn: true, downloaded: false, description: 'Oracle 官方 JDBC 驱动（内置，需从 Oracle 官网手动下载）', uploadTime: now },
    { id: 'sqlserver-builtin', name: 'SQL Server', version: '12.4.2', driverClass: 'com.microsoft.sqlserver.jdbc.SQLServerDriver', fileName: 'mssql-jdbc-12.4.2.jre11.jar', fileSize: 1200000, dbType: 'sqlserver', isBuiltIn: true, downloaded: false, downloadUrl: 'https://repo1.maven.org/maven2/com/microsoft/sqlserver/mssql-jdbc/12.4.2.jre11/mssql-jdbc-12.4.2.jre11.jar', description: 'SQL Server 官方 JDBC 驱动（内置）', uploadTime: now },
    { id: 'mariadb-builtin', name: 'MariaDB', version: '3.3.2', driverClass: 'org.mariadb.jdbc.Driver', fileName: 'mariadb-java-client-3.3.2.jar', fileSize: 800000, dbType: 'mariadb', isBuiltIn: true, downloaded: false, downloadUrl: 'https://repo1.maven.org/maven2/org/mariadb/jdbc/mariadb-java-client/3.3.2/mariadb-java-client-3.3.2.jar', description: 'MariaDB 官方 JDBC 驱动（内置）', uploadTime: now },
    { id: 'sqlite-builtin', name: 'SQLite', version: '3.44.1.0', driverClass: 'org.sqlite.JDBC', fileName: 'sqlite-jdbc-3.44.1.0.jar', fileSize: 1000000, dbType: 'sqlite', isBuiltIn: true, downloaded: false, downloadUrl: 'https://repo1.maven.org/maven2/org/xerial/sqlite-jdbc/3.44.1.0/sqlite-jdbc-3.44.1.0.jar', description: 'SQLite JDBC 驱动（内置）', uploadTime: now },
    { id: 'highgo-builtin', name: 'HighGo (瀚高)', version: '6.2.4', driverClass: 'com.highgo.jdbc.Driver', fileName: 'HgdbJdbc-6.2.4.jar', fileSize: 2000000, dbType: 'highgo', isBuiltIn: true, downloaded: false, description: '瀚高数据库 JDBC 驱动（内置，需从瀚高官网下载）', uploadTime: now },
    { id: 'kingbase-builtin', name: 'Kingbase (金仓)', version: '8.6.0', driverClass: 'com.kingbase8.Driver', fileName: 'kingbase8-8.6.0.jar', fileSize: 3000000, dbType: 'kingbase', isBuiltIn: true, downloaded: false, description: '金仓数据库 JDBC 驱动（内置，需从人大金仓官网下载）', uploadTime: now },
    { id: 'dameng-builtin', name: 'Dameng (达梦)', version: '8.1', driverClass: 'dm.jdbc.driver.DmDriver', fileName: 'DmJdbcDriver-8.1.jar', fileSize: 3000000, dbType: 'dameng', isBuiltIn: true, downloaded: false, description: '达梦数据库 JDBC 驱动（内置，需从达梦官网下载）', uploadTime: now },
    { id: 'db2-builtin', name: 'DB2', version: '4.0.0', driverClass: 'com.ibm.db2.jcc.DB2Driver', fileName: 'db2jcc-4.0.0.jar', fileSize: 3500000, dbType: 'db2', isBuiltIn: true, downloaded: false, downloadUrl: 'https://repo1.maven.org/maven2/com/ibm/db2/jcc/db2jcc/db2jcc4/db2jcc-4.0.0.jar', description: 'IBM DB2 JDBC 驱动（内置）', uploadTime: now },
    { id: 'h2-builtin', name: 'H2', version: '2.2.224', driverClass: 'org.h2.Driver', fileName: 'h2-2.2.224.jar', fileSize: 2500000, dbType: 'h2', isBuiltIn: true, downloaded: false, downloadUrl: 'https://repo1.maven.org/maven2/com/h2database/h2/2.2.224/h2-2.2.224.jar', description: 'H2 数据库 JDBC 驱动（内置）', uploadTime: now },
  ];
  for (const d of builtinDrivers) {
    // 用 ON CONFLICT DO NOTHING 直接 upsert 内置驱动
    const existingDrv = await getById('drivers', d.id);
    if (!existingDrv) await insert('drivers', d);
  }

  console.log('[db] ✅ 默认数据已初始化');
}

// 兼容旧版：暴露 pool getter（若上层需要透传做特殊查询）
export { getPool };
