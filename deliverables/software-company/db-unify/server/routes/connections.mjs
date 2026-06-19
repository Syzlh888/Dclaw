/**
 * 数据库连接管理 API
 * 包括：CRUD、连接测试、Schema/Database 发现
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import net from 'node:net';
import { getAll, getById, insert, update, remove, removeWhere, query } from '../database.mjs';
import postgres from 'postgres';
import { encryptPassword, decryptPassword } from '../crypto.mjs';

const router = Router();

/**
 * GET /api/connections
 * 获取所有连接（密码字段脱敏）
 */
router.get('/', (_req, res) => {
  const connections = getAll('connections').map((c) => ({
    ...c,
    password: '******', // 不返回真实密码
    password_encrypted: undefined,
  }));
  res.json({ connections });
});

/**
 * GET /api/connections/template
 * 下载批量导入模板（返回示例 CSV 内容）
 */
router.get('/template', (_req, res) => {
  const headers = [
    '连接名称', '驱动类型', '主机地址', '端口', '用户名', '密码',
    '数据库名', 'Schema', '项目', '业务模块', '区域节点', '连接实例名称',
  ];
  const exampleRow = [
    '示例-主连接实例', 'mysql', '192.168.1.100', '3306', 'db_user', 'your_password',
    'his_db', 'public', '示例项目', '数据交换模块', '中心区域', '主连接实例',
  ];

  const bom = '\uFEFF'; // UTF-8 BOM，确保 Excel 正确识别中文
  const escapeCsv = (val) => {
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvLines = [
    headers.map(escapeCsv).join(','),
    exampleRow.map(escapeCsv).join(','),
    ['注：后4列（项目/业务模块/区域节点/连接实例名称）为可选，用于自动关联左侧树结构'].map(escapeCsv).join(','),
  ];

  const csvContent = bom + csvLines.join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  const encodedName = encodeURIComponent('数据库连接批量导入模板.csv');
  res.setHeader('Content-Disposition', `attachment; filename="bulk-import-template.csv"; filename*=UTF-8''${encodedName}`);
  res.send(csvContent);
});

/**
 * GET /api/connections/:id
 * 获取单个连接详情（密码脱敏，仅内部执行时解密）
 */
router.get('/:id', (req, res) => {
  const conn = getById('connections', req.params.id);
  if (!conn) {
    return res.status(404).json({ error: '连接不存在' });
  }

  // 仅内部执行接口可获取解密密码，对外 API 返回脱敏
  const isInternal = req.headers['x-internal-request'] === 'true';
  res.json({
    ...conn,
    password: isInternal ? decryptPassword(conn.password_encrypted || '') : '******',
    password_encrypted: undefined,
  });
});

/**
 * POST /api/connections
 * 创建新连接（密码加密存储）
 */
router.post('/', (req, res) => {
  const { name, driver, host, port, username, password, database, schema, customDriverId } = req.body;

  // 参数校验
  if (!name || !driver || !host || !port || !username || !password) {
    return res.status(400).json({ error: '连接参数不完整' });
  }

  const id = nanoid(8);
  const now = new Date().toISOString();
  const connection = {
    id,
    name,
    driver,
    host: host.trim(),
    port: Number(port),
    username: username.trim(),
    password_encrypted: encryptPassword(password),
    database_name: (database || '').trim(),
    schema_name: (schema || '').trim(),
    custom_driver_id: customDriverId || null,
    status: 'unknown',
    created_at: now,
    updated_at: now,
  };

  insert('connections', connection);

  // 返回时脱敏
  res.status(201).json({
    ...connection,
    password: '******',
    password_encrypted: undefined,
  });
});

/**
 * PUT /api/connections/:id
 * 更新连接信息
 */
router.put('/:id', (req, res) => {
  const existing = getById('connections', req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '连接不存在' });
  }

  const { name, driver, host, port, username, password, database, schema, customDriverId } = req.body;

  const partial = {};
  if (name !== undefined) partial.name = name;
  if (driver !== undefined) partial.driver = driver;
  if (host !== undefined) partial.host = host.trim();
  if (port !== undefined) partial.port = Number(port);
  if (username !== undefined) partial.username = username.trim();
  if (password !== undefined && password !== '******') {
    partial.password_encrypted = encryptPassword(password);
  }
  if (database !== undefined) partial.database_name = database.trim();
  if (schema !== undefined) partial.schema_name = schema.trim();
  if (customDriverId !== undefined) partial.custom_driver_id = customDriverId || null;

  const updated = update('connections', req.params.id, partial);
  if (!updated) {
    return res.status(500).json({ error: '更新失败' });
  }

  res.json({
    ...updated,
    password: '******',
    password_encrypted: undefined,
  });
});

/**
 * DELETE /api/connections/:id
 * 删除连接
 */
router.delete('/:id', (req, res) => {
  const existing = getById('connections', req.params.id);
  if (!existing) {
    return res.status(404).json({ error: '连接不存在' });
  }

  // 同步删除引用此连接的树节点(hospitals)
  removeWhere('hospitals', h => h.connection_id === req.params.id);

  remove('connections', req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/connections/test
 * 测试连接是否可用（真实连接数据库）
 */
router.post('/test', async (req, res) => {
  const { driver, host, port, username, password, database, customDriverId } = req.body;

  if (!driver || !host || !port || !username || !password) {
    return res.status(400).json({ error: '连接参数不完整' });
  }

  try {
    await testConnection(driver, host, port, username, password, database, customDriverId);
    res.json({ success: true, message: '连接成功' });
  } catch (err) {
    res.status(500).json({ success: false, error: formatConnectionError(err) });
  }
});

/**
 * POST /api/connections/:id/test
 * 测试已保存的连接
 */
router.post('/:id/test', async (req, res) => {
  const conn = getById('connections', req.params.id);
  if (!conn) {
    return res.status(404).json({ error: '连接不存在' });
  }

  const password = decryptPassword(conn.password_encrypted || '');

  try {
    await testConnection(conn.driver, conn.host, conn.port, conn.username, password, conn.database_name, conn.custom_driver_id);
    update('connections', req.params.id, { status: 'online' });
    res.json({ success: true, message: '连接成功' });
  } catch (err) {
    update('connections', req.params.id, { status: 'error' });
    res.status(500).json({ success: false, error: formatConnectionError(err) });
  }
});

/**
 * POST /api/connections/schemas
 * 获取目标数据库的 Schema 列表
 */
router.post('/schemas', async (req, res) => {
  const { driver, host, port, username, password, database, customDriverId } = req.body;

  if (!driver || !host || !port || !username || !password || !database) {
    return res.status(400).json({ error: '连接参数不完整' });
  }

  try {
    console.log(`[schemas] driver=${driver} db=${database} host=${host}:${port}`);
    const schemas = await discoverSchemas(driver, host, port, username, password, database, customDriverId);
    console.log(`[schemas] result count=${schemas.length} values=${JSON.stringify(schemas)}`);
    res.json({ schemas });
  } catch (err) {
    console.error(`[schemas] error:`, err.message);
    res.status(500).json({ error: formatConnectionError(err) });
  }
});

/**
 * POST /api/connections/databases
 * 获取数据库服务器上的数据库列表
 */
router.post('/databases', async (req, res) => {
  const { driver, host, port, username, password } = req.body;

  if (!driver || !host || !port || !username || !password) {
    return res.status(400).json({ error: '连接参数不完整' });
  }

  try {
    const databases = await discoverDatabases(driver, host, port, username, password, undefined);
    res.json({ databases });
  } catch (err) {
    res.status(500).json({ error: formatConnectionError(err) });
  }
});

/**
 * POST /api/connections/bulk-import
 * 批量导入数据库连接（支持层级自动创建）
 */
router.post('/bulk-import', (req, res) => {
  const { connections } = req.body;

  if (!Array.isArray(connections) || connections.length === 0) {
    return res.status(400).json({ error: '请提供有效的连接列表' });
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;

  // 层级缓存：名称 → id，用于同一批次中复用
  const platformCache = new Map(); // name → id
  const predbTypeCache = new Map(); // platformId|name → id
  const districtCache = new Map(); // predbTypeId|name → id

  const now = new Date().toISOString();

  for (const item of connections) {
    const row = (item.row !== undefined ? item.row : results.length + 1);
    try {
      const { name, driver, host, port, username, password, database, schema,
        platform, predb_type, district, hospital_name } = item;

      // 字段验证
      if (!name || !driver || !host || !port || !username || !password) {
        results.push({ row, name: name || '(空)', status: 'failed', error: '连接参数不完整（名称/驱动/主机/端口/用户名/密码为必填）' });
        failCount++;
        continue;
      }

      const validDrivers = ['mysql', 'postgresql', 'oracle', 'sqlserver', 'custom'];
      if (!validDrivers.includes(driver)) {
        results.push({ row, name, status: 'failed', error: `不支持的驱动类型: ${driver}，支持的类型: ${validDrivers.join(', ')}` });
        failCount++;
        continue;
      }

      // ---- 处理层级自动创建 ----
      let platformId = null;
      let predbTypeId = null;
      let districtId = null;
      let treePathStr = '';

      if (platform && String(platform).trim()) {
        const platName = String(platform).trim();
        // 1. 项目
        if (platformCache.has(platName)) {
          platformId = platformCache.get(platName);
        } else {
          const existing = query('platforms', p => p.name === platName)[0];
          if (existing) {
            platformId = existing.id;
          } else {
            platformId = nanoid(8);
            insert('platforms', {
              id: platformId, name: platName, sort_order: 0,
              created_at: now, updated_at: now,
            });
          }
          platformCache.set(platName, platformId);
        }
        treePathStr = platName;

        // 2. 业务模块
        if (predb_type && String(predb_type).trim()) {
          const ptName = String(predb_type).trim();
          const cacheKey = `${platformId}|${ptName}`;
          if (predbTypeCache.has(cacheKey)) {
            predbTypeId = predbTypeCache.get(cacheKey);
          } else {
            const existing = query('predbTypes', p => p.platform_id === platformId && p.name === ptName)[0];
            if (existing) {
              predbTypeId = existing.id;
            } else {
              predbTypeId = nanoid(8);
              insert('predbTypes', {
                id: predbTypeId, platform_id: platformId, name: ptName, sort_order: 0,
                created_at: now, updated_at: now,
              });
            }
            predbTypeCache.set(cacheKey, predbTypeId);
          }
          treePathStr += ` > ${ptName}`;

          // 3. 区域节点
          if (district && String(district).trim()) {
            const distName = String(district).trim();
            const cacheKey = `${predbTypeId}|${distName}`;
            if (districtCache.has(cacheKey)) {
              districtId = districtCache.get(cacheKey);
            } else {
              const existing = query('districts', d => d.predb_type_id === predbTypeId && d.name === distName)[0];
              if (existing) {
                districtId = existing.id;
              } else {
                districtId = nanoid(8);
                insert('districts', {
                  id: districtId, predb_type_id: predbTypeId, name: distName, sort_order: 0,
                  created_at: now, updated_at: now,
                });
              }
              districtCache.set(cacheKey, districtId);
            }
            treePathStr += ` > ${distName}`;
          }
        }
      }

      // ---- 创建连接 ----
      const id = nanoid(8);
      const connection = {
        id,
        name,
        driver,
        host: host.trim(),
        port: Number(port),
        username: username.trim(),
        password_encrypted: encryptPassword(String(password)),
        database_name: (database || '').trim(),
        schema_name: (schema || '').trim(),
        custom_driver_id: null,
        status: 'unknown',
        created_at: now,
        updated_at: now,
      };
      insert('connections', connection);

      // ---- 创建连接实例节点并关联 ----
      if (districtId) {
        const hospName = (hospital_name && String(hospital_name).trim()) ? String(hospital_name).trim() : name;
        const hospitalId = nanoid(8);
        insert('hospitals', {
          id: hospitalId,
          district_id: districtId,
          name: hospName,
          connection_id: id,
          sort_order: 0,
          created_at: now,
          updated_at: now,
        });
      }

      results.push({
        row, name, status: 'created', id,
        treePath: treePathStr || undefined,
      });
      successCount++;
    } catch (err) {
      results.push({ row, name: item.name || '(空)', status: 'failed', error: err.message });
      failCount++;
    }
  }

  res.json({
    total: connections.length,
    success: successCount,
    failed: failCount,
    results,
  });
});

/**
 * POST /api/connections/:id/metadata
 * 获取数据库元数据（表列表 + 列信息）
 */
router.post('/:id/metadata', async (req, res) => {
  const conn = getById('connections', req.params.id);
  if (!conn) {
    return res.status(404).json({ error: '连接不存在' });
  }

  const password = decryptPassword(conn.password_encrypted || '');

  try {
    console.log(`[metadata] driver=${conn.driver} db=${conn.database_name} host=${conn.host}:${conn.port}`);
    const metadata = await discoverMetadata(conn.driver, conn.host, conn.port, conn.username, password, conn.database_name, conn.schema_name, conn.custom_driver_id);
    console.log(`[metadata] found ${metadata.length} tables`);
    res.json({ tables: metadata });
  } catch (err) {
    console.error(`[metadata] error:`, err.message);
    res.status(500).json({ error: formatConnectionError(err) });
  }
});

/**
 * 根据 driver 和 customDriverId 解析实际的数据库类型
 * 自定义驱动会根据其 dbType 映射到已知的连接协议
 */
function resolveRealDriver(driver, customDriverId) {
  if (driver !== 'custom') return driver;
  if (!customDriverId) throw new Error('自定义驱动未指定');
  const d = getById('drivers', customDriverId);
  if (!d) throw new Error('自定义驱动不存在');
  const dt = (d.dbType || '').toLowerCase();
  if (dt.includes('mysql')) return 'mysql';
  if (dt === 'postgresql' || dt === 'postgres' || dt.includes('highgo') || dt.includes('gauss') || dt.includes('kingbase')
    || dt.includes('瀚高') || dt.includes('高斯') || dt.includes('金仓')
    || dt.includes('达梦') || dt.includes('神通') || dt.includes('opengauss')) return 'postgresql';
  throw new Error(`暂不支持数据库类型 "${d.dbType}" 的连接测试，请确保数据库类型填写正确（如 MySQL、PostgreSQL）`);
}

/**
 * 测试数据库连接
 */
async function testConnection(driver, host, port, username, password, database, customDriverId) {
  const realDriver = resolveRealDriver(driver, customDriverId);
  switch (realDriver) {
    case 'mysql': {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection({
        host, port, user: username, password,
        database: database || undefined,
        connectTimeout: 15000,
      });
      await conn.ping();
      await conn.end();
      return;
    }
    case 'postgresql': {
      // 自定义驱动（如瀚高、高斯、金仓等）必须使用 JDBC 桥接测试
      // 这些数据库修改了 PostgreSQL 协议（如 SM3 国密认证），TCP 连通性不等于认证成功
      if (driver === 'custom' && customDriverId) {
        const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
        const bridge = await createHgdbConnection({ host, port, username, password, database, driverId: customDriverId });
        await bridge.exec('SELECT 1');
        await bridge.end();
        return;
      }
      // 标准 PostgreSQL：优先用 pg 库，失败时自动回退 JDBC 桥接
      let pgClient;
      try {
        const pg = await import('pg');
        const { Client } = pg.default || pg;
        pgClient = new Client({
          host, port, user: username, password,
          database: database || 'postgres',
          connectionTimeoutMillis: 15000,
        });
        await pgClient.connect();
        await pgClient.query('SELECT 1');
        await pgClient.end();
        console.log(`[testConnection] standard pg OK`);
        return;
      } catch (pgErr) {
        console.error(`[testConnection] standard pg FAILED:`, pgErr.message);
        if (pgClient) { try { pgClient.end(); } catch {} }
        // pg 失败（SM3 国密认证等），回退 JDBC 桥接
        try {
          const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
          const resolvedDriverId = customDriverId || findAvailablePgDriver();
          if (resolvedDriverId) {
            console.log(`[testConnection] falling back JDBC (driver=${resolvedDriverId})`);
            const bridge = await createHgdbConnection({ host, port, username, password, database, driverId: resolvedDriverId });
            await bridge.exec('SELECT 1');
            await bridge.end();
            console.log(`[testConnection] JDBC bridge OK`);
            return;
          }
        } catch (jdbcErr) {
          console.error(`[testConnection] JDBC fallback FAILED:`, jdbcErr.message);
        }
        throw pgErr;
      }
    }
    default:
      throw new Error(`暂不支持 ${realDriver} 类型的连接测试`);
  }
}

/**
 * 发现 Schema 列表
 */
async function discoverSchemas(driver, host, port, username, password, database, customDriverId) {
  const realDriver = resolveRealDriver(driver, customDriverId);
  switch (realDriver) {
    case 'mysql':
      // MySQL 中 schema 等同于 database，直接返回当前数据库名
      return [database];
    case 'postgresql': {
      // 自定义驱动（如瀚高、高斯、金仓等）必须使用 JDBC 桥接
      if (driver === 'custom' && customDriverId) {
        const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
        const bridge = await createHgdbConnection({ host, port, username, password, database, driverId: customDriverId });
        const result = await bridge.exec(
          `SELECT nspname FROM pg_catalog.pg_namespace
           WHERE nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
             AND nspname NOT LIKE 'pg_%'
           ORDER BY nspname`
        );
        await bridge.end();
        const names = (result.rows || []).map((r) => r.nspname);
        console.log(`[discoverSchemas] jdbc bridge: found ${names.length} schemas`);
        return names;
      }
      console.log(`[discoverSchemas] postgresql: connecting to ${host}:${port}/${database}`);
      const pg = await import('pg');
      const { Client } = pg.default || pg;
      const client = new Client({
        host, port, user: username, password, database,
        connectionTimeoutMillis: 15000,
      });
      await client.connect();
      console.log(`[discoverSchemas] postgresql: connected, querying schemas...`);
      // 用 pg_namespace 而非 information_schema.schemata
      // 后者只返回有 USAGE 权限的 schema，对受限用户会返回空
      const result = await client.query(
        `SELECT nspname FROM pg_catalog.pg_namespace
         WHERE nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
           AND nspname NOT LIKE 'pg_%'
           AND nspname NOT IN ('cstore', 'db4ai', 'dbe_perf', 'dbe_pldebugger', 'dbe_pldeveloper', 'dbe_sql_util', 'pkg_service', 'snapshot', 'sqladvisor')
         ORDER BY nspname`
      );
      await client.end();
      const names = result.rows.map((r) => r.nspname);
      console.log(`[discoverSchemas] postgresql: found ${names.length} schemas: ${JSON.stringify(names)}`);
      return names;
    }
    default:
      throw new Error(`暂不支持 ${driver} 类型`);
  }
}

/**
 * 发现数据库列表
 */
async function discoverDatabases(driver, host, port, username, password, customDriverId) {
  const realDriver = resolveRealDriver(driver, customDriverId);
  switch (realDriver) {
    case 'mysql': {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection({
        host, port, user: username, password,
        connectTimeout: 15000,
      });
      const [rows] = await conn.execute('SHOW DATABASES');
      await conn.end();
      return rows.map((r) => r.Database);
    }
    case 'postgresql': {
      // 自定义驱动（如瀚高、高斯、金仓等）必须使用 JDBC 桥接
      if (driver === 'custom' && customDriverId) {
        const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
        const bridge = await createHgdbConnection({ host, port, username, password, database: 'postgres', driverId: customDriverId });
        const result = await bridge.exec('SELECT datname FROM pg_database ORDER BY datname');
        await bridge.end();
        return (result.rows || []).map((r) => r.datname);
      }
      const pg = await import('pg');
      const { Client } = pg.default || pg;
      const client = new Client({
        host, port, user: username, password,
        database: 'postgres',
        connectionTimeoutMillis: 15000,
      });
      await client.connect();
      const result = await client.query(
        'SELECT datname FROM pg_database ORDER BY datname'
      );
      await client.end();
      return result.rows.map((r) => r.datname);
    }
    default:
      throw new Error(`暂不支持 ${driver} 类型`);
  }
}

/**
 * 发现数据库元数据（表 + 列）
 */
async function discoverMetadata(driver, host, port, username, password, database, schema, customDriverId) {
  const realDriver = resolveRealDriver(driver, customDriverId);
  switch (realDriver) {
    case 'mysql': {
      const mysql = await import('mysql2/promise');
      const conn = await mysql.createConnection({
        host, port, user: username, password, database,
        connectTimeout: 10000,
      });
      const [tables] = await conn.execute(
        `SELECT TABLE_NAME, TABLE_TYPE, TABLE_COMMENT, TABLE_ROWS, ROUND(DATA_LENGTH/1024/1024, 2) AS size_mb
         FROM information_schema.TABLES
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`,
        [database]
      );
      // 获取所有列信息（一次查询获取全部，避免 N+1）
      const [allColumns] = await conn.execute(
        `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_COMMENT, ORDINAL_POSITION
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [database]
      );
      await conn.end();
      const colMap = {};
      allColumns.forEach(c => {
        if (!colMap[c.TABLE_NAME]) colMap[c.TABLE_NAME] = [];
        colMap[c.TABLE_NAME].push({
          name: c.COLUMN_NAME,
          type: c.DATA_TYPE,
          nullable: c.IS_NULLABLE === 'YES',
          default: c.COLUMN_DEFAULT,
          comment: c.COLUMN_COMMENT || '',
        });
      });
      return tables.map(t => ({
        name: t.TABLE_NAME,
        type: t.TABLE_TYPE,
        comment: t.TABLE_COMMENT || '',
        rows: t.TABLE_ROWS || 0,
        sizeMb: t.size_mb || 0,
        columns: colMap[t.TABLE_NAME] || [],
      }));
    }
    case 'postgresql': {
      // 自定义驱动（如瀚高、高斯、金仓等）必须使用 JDBC 桥接
      if (driver === 'custom' && customDriverId) {
        const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
        const bridge = await createHgdbConnection({ host, port, username, password, database, driverId: customDriverId });
        const targetSchema = schema || 'public';
        await bridge.exec(`SET search_path TO "${targetSchema}", public`);
        // 简化查询：优先使用 information_schema，减少对 pg_catalog 的依赖（兼容不同版本瀚高）
        const tableResult = await bridge.exec(
          `SELECT table_name,
                  CASE WHEN table_type = 'VIEW' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type
           FROM information_schema.tables
           WHERE table_schema = '${targetSchema}' AND table_type IN ('BASE TABLE', 'VIEW')
           ORDER BY table_name`
        );
        const colResult = await bridge.exec(
          `SELECT table_name, column_name, data_type, is_nullable,
                  column_default, '' AS comment,
                  ordinal_position
           FROM information_schema.columns
           WHERE table_schema = '${targetSchema}'
           ORDER BY table_name, ordinal_position`
        );
        await bridge.end();
        const colMap = {};
        (colResult.rows || []).forEach(c => {
          if (!colMap[c.table_name]) colMap[c.table_name] = [];
          colMap[c.table_name].push({
            name: c.column_name,
            type: c.data_type,
            nullable: c.is_nullable === 'YES',
            default: c.column_default,
            comment: c.comment || '',
          });
        });
        return (tableResult.rows || []).map(t => ({
          name: t.table_name,
          type: t.table_type,
          comment: t.comment || '',
          rows: Number(t.estimated_rows) || 0,
          sizeMb: 0,
          size: t.size || '',
          columns: colMap[t.table_name] || [],
        }));
      }
      // 瀚高等国产数据库使用 postgres.js
      if (isPgForkDriver(driver, customDriverId)) {
        const safeDb = encodeURIComponent(database || 'postgres');
        const connStr = `postgres://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}/${safeDb}`;
        const sql = postgres(connStr, { connect_timeout: 20 });
        const targetSchema = schema || 'public';
        try {
          await sql.unsafe(`SET search_path TO "${targetSchema}", public`);
          // 查询表信息（使用 unsafe 因为 schema 是动态的）
          const tableResult = await sql.unsafe(
            `SELECT t.table_name,
                    CASE WHEN t.table_type = 'VIEW' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type,
                    COALESCE(pg_catalog.obj_description(c.oid), '') AS comment,
                    c.reltuples::bigint AS estimated_rows,
                    pg_size_pretty(pg_total_relation_size(c.oid)) AS size
             FROM information_schema.tables t
             JOIN pg_catalog.pg_class c ON c.relname = t.table_name
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
             WHERE t.table_schema = ${targetSchema} AND t.table_type = 'BASE TABLE'
             ORDER BY t.table_name`
          );
          // 查询列信息
          const colResult = await sql.unsafe(
            `SELECT table_name, column_name, data_type, is_nullable,
                    column_default, COALESCE(pg_catalog.col_description(c.oid, a.attnum), '') AS comment,
                    ordinal_position
             FROM information_schema.columns col
             JOIN pg_catalog.pg_class c ON c.relname = col.table_name
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = col.table_schema
             JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = col.column_name
             WHERE col.table_schema = ${targetSchema}
             ORDER BY col.table_name, col.ordinal_position`
          );
          const colMap = {};
          for (const c of colResult) {
            if (!colMap[c.table_name]) colMap[c.table_name] = [];
            colMap[c.table_name].push({
              name: c.column_name,
              type: c.data_type,
              nullable: c.is_nullable === 'YES',
              default: c.column_default,
              comment: c.comment || '',
            });
          }
          return (tableResult || []).map(t => ({
            name: t.table_name,
            type: t.table_type,
            comment: t.comment || '',
            rows: Number(t.estimated_rows) || 0,
            sizeMb: 0,
            size: t.size || '',
            columns: colMap[t.table_name] || [],
          }));
        } finally {
          await sql.end();
        }
      }

      // 标准 PostgreSQL：优先用 pg 库，失败时自动回退 JDBC 桥接
      let stdClient;
      try {
        const pg = await import('pg');
        const { Client } = pg.default || pg;
        stdClient = new Client({
          host, port, user: username, password, database,
          connectionTimeoutMillis: 10000,
        });
        await stdClient.connect();
        const targetSchema = schema || 'public';
        const tableResult = await stdClient.query(
          `SELECT t.table_name,
                  CASE WHEN t.table_type = 'VIEW' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type,
                  pg_catalog.obj_description(c.oid) AS comment,
                  c.reltuples::bigint AS estimated_rows,
                  pg_size_pretty(pg_total_relation_size(c.oid)) AS size
           FROM information_schema.tables t
           JOIN pg_catalog.pg_class c ON c.relname = t.table_name
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
           WHERE t.table_schema = $1 AND t.table_type = 'BASE TABLE'
           ORDER BY t.table_name`,
          [targetSchema]
        );
        const colResult = await stdClient.query(
          `SELECT table_name, column_name, data_type, is_nullable,
                  column_default, pg_catalog.col_description(c.oid, a.attnum) AS comment,
                  ordinal_position
           FROM information_schema.columns col
           JOIN pg_catalog.pg_class c ON c.relname = col.table_name
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = col.table_schema
           JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = col.column_name
           WHERE col.table_schema = $1
           ORDER BY col.table_name, col.ordinal_position`,
          [targetSchema]
        );
        await stdClient.end();
        console.log(`[discoverMetadata] standard pg OK`);
        return buildMetadataResult(tableResult.rows, colResult.rows);
      } catch (pgErr) {
        console.error(`[discoverMetadata] standard pg FAILED:`, pgErr.message);
        if (stdClient) { try { stdClient.end(); } catch {} }
        // pg 失败（SM3 国密认证等），回退 JDBC 桥接
        try {
          const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
          const resolvedDriverId = customDriverId || findAvailablePgDriver();
          if (resolvedDriverId) {
            console.log(`[discoverMetadata] falling back to JDBC (driver=${resolvedDriverId})`);
            const bridge = await createHgdbConnection({ host, port, username, password, database, driverId: resolvedDriverId });
            const targetSchema = schema || 'public';
            await bridge.exec(`SET search_path TO "${targetSchema}", public`);
            const tableResult = await bridge.exec(
              `SELECT t.table_name,
                      CASE WHEN t.table_type = 'VIEW' THEN 'VIEW' ELSE 'BASE TABLE' END AS table_type,
                      COALESCE(pg_catalog.obj_description(c.oid), '') AS comment,
                      c.reltuples::bigint AS estimated_rows,
                      pg_size_pretty(pg_total_relation_size(c.oid)) AS size
               FROM information_schema.tables t
               JOIN pg_catalog.pg_class c ON c.relname = t.table_name
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
               WHERE t.table_schema = '${targetSchema}' AND t.table_type = 'BASE TABLE'
               ORDER BY t.table_name`
            );
            const colResult = await bridge.exec(
              `SELECT table_name, column_name, data_type, is_nullable,
                      column_default, COALESCE(pg_catalog.col_description(c.oid, a.attnum), '') AS comment,
                      ordinal_position
               FROM information_schema.columns col
               JOIN pg_catalog.pg_class c ON c.relname = col.table_name
               JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace AND n.nspname = col.table_schema
               JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attname = col.column_name
               WHERE col.table_schema = '${targetSchema}'
               ORDER BY col.table_name, col.ordinal_position`
            );
            await bridge.end();
            console.log(`[discoverMetadata] JDBC bridge OK`);
            return buildMetadataResult(tableResult.rows || [], colResult.rows || []);
          }
        } catch (jdbcErr) {
          console.error(`[discoverMetadata] JDBC fallback FAILED:`, jdbcErr.message);
        }
        throw pgErr;
      }
    }
    default:
      throw new Error(`元数据浏览暂不支持 ${realDriver} 类型`);
  }
}

/**
 * 从表/列查询结果构建元数据结构
 */
function buildMetadataResult(tableRows, colRows) {
  const colMap = {};
  (colRows || []).forEach(c => {
    if (!colMap[c.table_name]) colMap[c.table_name] = [];
    colMap[c.table_name].push({
      name: c.column_name,
      type: c.data_type,
      nullable: c.is_nullable === 'YES',
      default: c.column_default,
      comment: c.comment || '',
    });
  });
  return (tableRows || []).map(t => ({
    name: t.table_name,
    type: t.table_type,
    comment: t.comment || '',
    rows: Number(t.estimated_rows) || 0,
    sizeMb: 0,
    size: t.size || '',
    columns: colMap[t.table_name] || [],
  }));
}

/**
 * 判断是否为需要特殊连接方式的 PostgreSQL 兼容数据库（如瀚高、高斯、金仓等）
 * 这些数据库修改了标准 PostgreSQL 协议，标准 pg 库无法正常工作
 */
function isPgForkDriver(driver, customDriverId) {
  if (driver !== 'custom' || !customDriverId) return false;
  const d = getById('drivers', customDriverId);
  if (!d) { console.log(`[isPgForkDriver] driver ${customDriverId} not found`); return false; }
  const dt = (d.dbType || '').toLowerCase();
  console.log(`[isPgForkDriver] dbType="${d.dbType}" (lower: "${dt}")`);
  const result = dt.includes('highgo') || dt.includes('gauss') || dt.includes('kingbase')
    || dt.includes('瀚高') || dt.includes('高斯') || dt.includes('金仓')
    || dt.includes('达梦') || dt.includes('神通') || dt.includes('opengauss');
  console.log(`[isPgForkDriver] result=${result}`);
  return result;
}

/**
 * 查找可用的 PostgreSQL 兼容 JDBC 驱动（用于 pg 库失败时的自动回退）
 */
function findAvailablePgDriver() {
  const drivers = getAll('drivers');
  if (!drivers) return null;
  // 优先找瀚高/高斯/金仓等国产驱动
  const special = drivers.find(d => {
    const dt = (d.dbType || '').toLowerCase();
    return (dt.includes('highgo') || dt.includes('gauss') || dt.includes('kingbase')
      || dt.includes('瀚高') || dt.includes('高斯') || dt.includes('金仓')
      || dt.includes('达梦') || dt.includes('opengauss'))
      && !d.isBuiltIn;
  });
  if (special) { console.log(`[findAvailablePgDriver] found: ${special.id} (${special.name})`); return special.id; }
  // 其次用内置 PostgreSQL JDBC 驱动
  const builtin = drivers.find(d => d.id === 'postgresql-builtin' || (d.isBuiltIn && d.dbType === 'postgresql'));
  if (builtin) { console.log(`[findAvailablePgDriver] using builtin: ${builtin.id}`); return builtin.id; }
  console.log(`[findAvailablePgDriver] no available driver found`);
  return null;
}

/**
 * 建立数据库连接并返回客户端
 * 调用方使用完后需自行关闭连接
 */
export async function createDbConnection(params) {
  const { driver, host, port, username, password, database, schema, customDriverId } = params;
  const realDriver = resolveRealDriver(driver, customDriverId);
  const isFork = isPgForkDriver(driver, customDriverId);
  console.log(`[createDbConnection] driver=${driver} customDriverId=${customDriverId} realDriver=${realDriver} isPgFork=${isFork} host=${host}:${port} db=${database}`);

  switch (realDriver) {
    case 'mysql': {
      const mysql = await import('mysql2/promise');
      return await mysql.createConnection({
        host, port, user: username, password, database,
        connectTimeout: 10000,
      });
    }
    case 'postgresql': {
      // 瀚高/高斯/金仓等国产数据库（自定义驱动）
      if (isFork) {
        // 自定义驱动必须使用 JDBC 桥接（支持 SM3 国密等非标准协议）
        // pg 库和 postgres.js 无法兼容这些修改后的协议，尝试它们只会浪费时间并导致 SSE 超时
        const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
        const bridge = await createHgdbConnection({ host, port, username, password, database, driverId: customDriverId });
        return { __type: 'jdbc_bridge', client: bridge, schema };
      }

      // 标准 PostgreSQL：优先用 pg 库，失败时自动尝试 JDBC 桥接（兼容瀚高/高斯等）
      let stdClient;
      try {
        const pg = await import('pg');
        const { Client } = pg.default || pg;
        stdClient = new Client({
          host, port, user: username, password, database,
          connectionTimeoutMillis: 10000,
        });
        await stdClient.connect();
        if (schema) {
          await stdClient.query(`SET search_path TO ${stdClient.escapeIdentifier(schema)}, public`);
        }
        console.log(`[createDbConnection] standard pg connected OK`);
        return stdClient;
      } catch (stdErr) {
        console.error(`[createDbConnection] standard pg FAILED:`, stdErr.message);
        // pg 库失败（可能是 SM3 国密认证等非标准协议），自动回退 JDBC 桥接
        if (stdClient) { try { stdClient.end(); } catch {} }
        try {
          const { createHgdbConnection } = await import('../hgdb-bridge.mjs');
          // 优先使用指定的自定义驱动，否则查找可用的 PostgreSQL 类驱动
          const resolvedDriverId = customDriverId || findAvailablePgDriver();
          if (resolvedDriverId) {
            console.log(`[createDbConnection] falling back to JDBC bridge (driver=${resolvedDriverId})`);
            const bridge = await createHgdbConnection({ host, port, username, password, database, driverId: resolvedDriverId });
            console.log(`[createDbConnection] JDBC bridge connected OK`);
            return { __type: 'jdbc_bridge', client: bridge, schema };
          }
        } catch (jdbcErr) {
          console.error(`[createDbConnection] JDBC fallback FAILED:`, jdbcErr.message);
        }
        // 所有方案都失败了，抛出原始错误
        throw stdErr;
      }
    }
    default:
      throw new Error(`不支持的数据库驱动: ${realDriver}`);
  }
}

/**
 * 在指定连接上执行 SQL 查询
 */
export async function executeQuery(conn, driver, sql, timeoutMs = 30000, customDriverId) {
  const realDriver = resolveRealDriver(driver, customDriverId);
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`查询超时（${timeoutMs / 1000}s）`)), timeoutMs)
  );

  let queryPromise;
  switch (realDriver) {
    case 'mysql': {
      queryPromise = (async () => {
        const [rows, fields] = await conn.execute({ sql, timeout: timeoutMs });
        // mysql2 execute 将列信息放在 fields 里
        const columns = fields ? fields.map((f) => f.name) : [];
        return { columns, rows };
      })();
      break;
    }
    case 'postgresql': {
      console.log(`[executeQuery] conn.__type=${conn?.__type} sql=${sql.substring(0, 80)}`);
      // 瀚高等国产数据库使用 JDBC 桥接（支持 SM3 认证）
      if (conn && conn.__type === 'jdbc_bridge') {
        queryPromise = (async () => {
          const result = await conn.client.exec(sql);
          return { columns: result.columns || [], rows: result.rows || [] };
        })();
        break;
      }

      // 瀚高等国产数据库使用标准 pg 连接
      if (conn && conn.__type === 'pgfork_std') {
        queryPromise = (async () => {
          const { client: pgStdClient, schema } = conn;
          if (schema) {
            await pgStdClient.query(`SET search_path TO ${pgStdClient.escapeIdentifier(schema)}, public`);
          }
          const result = await pgStdClient.query({ text: sql, statement_timeout: timeoutMs });
          const columns = result.fields ? result.fields.map((f) => f.name) : [];
          return { columns, rows: result.rows };
        })();
        break;
      }

      // 瀚高等国产数据库使用 postgres.js 连接
      if (conn && conn.__type === 'pgfork') {
        queryPromise = (async () => {
          const { client: pgClient, schema } = conn;
          try {
            if (schema) await pgClient.unsafe(`SET search_path TO "${schema}", public`);
            const result = await pgClient.unsafe(sql);
            // postgres.js 返回格式与 pg 不同，需要适配
            if (Array.isArray(result)) {
              const columns = result.length > 0 ? Object.keys(result[0]) : [];
              return { columns, rows: result };
            }
            if (result && result.rows) {
              const columns = result.fields ? result.fields.map((f) => f.name) : [];
              return { columns, rows: result.rows };
            }
            const columns = Object.keys(result || {});
            return { columns, rows: [result] };
          } catch (e) {
            throw e;
          }
        })();
        break;
      }

      queryPromise = (async () => {
        const result = await conn.query({ text: sql, query_timeout: timeoutMs });
        const columns = result.fields ? result.fields.map((f) => f.name) : [];
        return { columns, rows: result.rows };
      })();
      break;
    }
    default:
      throw new Error(`不支持的驱动: ${realDriver}`);
  }

  return Promise.race([queryPromise, timeoutPromise]);
}

/**
 * 关闭数据库连接
 */
export async function closeConnection(conn, driver, customDriverId) {
  const realDriver = resolveRealDriver(driver, customDriverId);
  try {
    if (conn && conn.__type === 'jdbc_bridge') {
      // JDBC 桥接连接
      await conn.client.end();
    } else if (conn && conn.__type === 'pgfork') {
      // postgres.js 连接
      await conn.client.end();
    } else if (conn && conn.__type === 'pgfork_std') {
      // 标准 pg 连接（瀚高等国产数据库）
      await conn.client.end();
    } else if (realDriver === 'mysql' || realDriver === 'postgresql') {
      await conn.end();
    }
  } catch {
    // 忽略关闭错误
  }
}

/**
 * 格式化连接错误信息
 */
export function formatConnectionError(err) {
  const raw = err.message || String(err);

  if (raw.includes('ECONNREFUSED') || raw.includes('connect ECONNREFUSED') || raw.includes('拒绝连接')) {
    return '无法连接到数据库服务器（连接被拒绝）';
  }
  if (raw.includes('ENOTFOUND') || raw.includes('getaddrinfo') || raw.includes('no such host')) {
    return '无法解析主机名';
  }
  if (raw.includes('ETIMEDOUT') || raw.includes('timed out')) {
    return '连接超时';
  }

  // ===== JDBC 桥接错误翻译 =====
  if (raw.includes('password authentication failed') || raw.includes('authentication failed') || raw.includes('认证失败')) {
    return '认证失败：用户名或密码错误';
  }
  if (raw.includes('FATAL') && (raw.includes('database') || raw.includes('数据库'))) {
    return '数据库不存在或无权访问';
  }
  if (raw.includes('ClassNotFoundException') || raw.includes('driver class') || raw.includes('未找到驱动')) {
    const match = raw.match(/ClassNotFoundException:\s*(\S+)/);
    const cls = match ? match[1] : '';
    return `驱动类加载失败${cls ? '：' + cls : ''}，请确认驱动文件有效且驱动类名正确`;
  }
  if (raw.includes('Java 桥接启动超时') || raw.includes('查询超时')) {
    return raw;
  }
  if (raw.includes('Java 桥接') || raw.includes('JDBC')) {
    return raw;
  }
  // JDBC 桥接的 FATAL 错误（瀚高/PostgreSQL 协议级错误）
  if (raw.includes('FATAL:')) {
    const parts = raw.split('FATAL:');
    const detail = parts[parts.length - 1]?.trim() || '';
    return `数据库连接失败：${detail.substring(0, 100)}`;
  }

  if (raw.includes('ER_ACCESS_DENIED') || raw.includes('access denied')) {
    return '认证失败：用户名或密码错误';
  }
  if (raw.includes('ER_BAD_DB_ERROR') || (raw.includes('database') && (raw.includes('does not exist') || raw.includes('not exist')))) {
    return '数据库不存在或无权访问';
  }
  if (raw.includes('timeout') || raw.includes('超时')) {
    return raw;
  }

  return raw;
}

export default router;
