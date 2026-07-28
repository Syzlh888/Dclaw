/**
 * 数据库角色管理与表/视图 CRUD API
 *
 * 角色管理：
 *   GET    /api/connections/:id/roles                         - 获取角色列表
 *   POST   /api/connections/:id/roles                         - 创建角色
 *   PUT    /api/connections/:id/roles/:roleName               - 修改角色
 *   DELETE /api/connections/:id/roles/:roleName               - 删除角色
 *   GET    /api/connections/:id/roles/:roleName/grants         - 获取角色权限
 *   POST   /api/connections/:id/roles/:roleName/grants         - 授予权限
 *   DELETE /api/connections/:id/roles/:roleName/grants         - 撤销权限
 *
 * 表 CRUD：
 *   POST   /api/connections/:id/tables                         - 创建表
 *   DELETE /api/connections/:id/tables/:tableName              - 删除表
 *   POST   /api/connections/:id/tables/:tableName/columns      - 添加列
 *   PUT    /api/connections/:id/tables/:tableName/columns/:columnName - 修改列
 *   DELETE /api/connections/:id/tables/:tableName/columns/:columnName - 删除列
 *
 * 视图 CRUD：
 *   POST   /api/connections/:id/views                          - 创建视图
 *   PUT    /api/connections/:id/views/:viewName                - 修改视图
 *   DELETE /api/connections/:id/views/:viewName                - 删除视图
 */
import { Router } from 'express';
import { getById } from '../database.mjs';
import { decryptPassword } from '../crypto.mjs';
import {
  createDbConnection,
  executeQuery,
  closeConnection,
  resolveRealDriver,
  formatConnectionError,
} from './connections.mjs';

const router = Router();

// ===================================================================
//  帮助函数
// ===================================================================

/** 获取连接配置（含解密后的密码） */
async function getConnConfig(id) {
  const conn = await getById('connections', id);
  if (!conn) throw Object.assign(new Error('连接不存在'), { status: 404 });
  const password = decryptPassword(conn.password_encrypted || '');
  return { conn, password };
}

/** 建立连接、执行 SQL、关闭连接 */
async function withDb(connectionId, sql, opts = {}) {
  const { conn, password } = await getConnConfig(connectionId);
  const dbClient = await createDbConnection({
    driver: conn.driver,
    host: conn.host,
    port: conn.port,
    username: conn.username,
    password,
    database: conn.database_name || '',
    schema: conn.schema_name || '',
    customDriverId: conn.custom_driver_id || undefined,
  });
  try {
    const timeout = opts.timeout || 30000;
    const result = await executeQuery(dbClient, conn.driver, sql, timeout, conn.custom_driver_id);
    return result;
  } finally {
    await closeConnection(dbClient, conn.driver, conn.custom_driver_id).catch(() => {});
  }
}

/** 错误处理包装 */
function wrapHandler(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err.status) {
        return res.status(err.status).json({ error: err.message });
      }
      console.error(`[table-mgmt] error:`, err.message);
      res.status(500).json({ error: formatConnectionError(err) });
    }
  };
}

/**
 * 检查数据库是否支持角色管理
 */
async function supportsRoleManagement(driver, customDriverId) {
  const real = await resolveRealDriver(driver, customDriverId);
  return real === 'mysql' || real === 'postgresql';
}

// ===================================================================
//  角色管理
// ===================================================================

/**
 * GET /api/connections/:id/roles
 * 获取角色列表
 */
router.get('/:id/roles', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  let sql;
  if (real === 'mysql') {
    sql = `SELECT User AS role_name, Host, 'N' AS super_user,
                  'Y' AS can_login, 'Y' AS can_create_db
           FROM mysql.user
           WHERE User NOT IN ('root', 'mysql.sys', 'mysql.session', 'mysql.infoschema')
           ORDER BY User`;
  } else {
    sql = `SELECT rolname AS role_name,
                  rolsuper AS super_user,
                  rolinherit AS can_inherit,
                  rolcreaterole AS can_create_role,
                  rolcreatedb AS can_create_db,
                  rolcanlogin AS can_login
           FROM pg_roles
           WHERE rolname NOT LIKE 'pg_%'
           ORDER BY rolname`;
  }

  const result = await withDb(req.params.id, sql);
  res.json({ roles: result.rows });
}));

/**
 * POST /api/connections/:id/roles
 * 创建角色
 */
router.post('/:id/roles', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { roleName, password, canLogin, superUser } = req.body;

  if (!roleName) return res.status(400).json({ error: '角色名称不能为空' });

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  let sql;
  if (real === 'mysql') {
    // MySQL: CREATE USER
    const host = req.body.host || '%';
    const escapedUser = roleName.replace(/['\\]/g, "\\$&");
    const escapedHost = host.replace(/['\\]/g, "\\$&");
    if (password) {
      const escapedPwd = password.replace(/['\\]/g, "\\$&");
      sql = `CREATE USER '${escapedUser}'@'${escapedHost}' IDENTIFIED BY '${escapedPwd}'`;
    } else {
      sql = `CREATE USER '${escapedUser}'@'${escapedHost}'`;
    }
  } else {
    // PostgreSQL: CREATE ROLE
    const escapedRole = roleName.replace(/"/g, '""');
    const opts = [];
    if (canLogin) opts.push('LOGIN');
    if (!canLogin && canLogin !== undefined) opts.push('NOLOGIN');
    if (superUser) opts.push('SUPERUSER');
    if (!superUser && superUser !== undefined) opts.push('NOSUPERUSER');
    if (password) {
      const escapedPwd = password.replace(/'/g, "''");
      opts.push(`PASSWORD '${escapedPwd}'`);
    }
    const optStr = opts.length > 0 ? ' ' + opts.join(' ') : '';
    sql = `CREATE ROLE "${escapedRole}"${optStr}`;
  }

  await withDb(req.params.id, sql);
  res.json({ success: true, message: `角色 ${roleName} 创建成功` });
}));

/**
 * PUT /api/connections/:id/roles/:roleName
 * 修改角色属性
 */
router.put('/:id/roles/:roleName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { roleName } = req.params;
  const { newPassword, canLogin, superUser } = req.body;

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  if (real === 'mysql') {
    // MySQL: ALTER USER
    const host = req.body.host || '%';
    const escapedUser = roleName.replace(/['\\]/g, "\\$&");
    const escapedHost = host.replace(/['\\]/g, "\\$&");
    const parts = [];
    if (newPassword) {
      const escapedPwd = newPassword.replace(/['\\]/g, "\\$&");
      parts.push(`IDENTIFIED BY '${escapedPwd}'`);
    }
    const alterPart = parts.length > 0 ? ' ' + parts.join(' ') : '';
    const sql = `ALTER USER '${escapedUser}'@'${escapedHost}'${alterPart}`;
    await withDb(req.params.id, sql);
  } else {
    // PostgreSQL: ALTER ROLE
    const escapedRole = roleName.replace(/"/g, '""');
    const opts = [];
    if (canLogin !== undefined) opts.push(canLogin ? 'LOGIN' : 'NOLOGIN');
    if (superUser !== undefined) opts.push(superUser ? 'SUPERUSER' : 'NOSUPERUSER');
    if (newPassword) {
      const escapedPwd = newPassword.replace(/'/g, "''");
      opts.push(`PASSWORD '${escapedPwd}'`);
    }

    if (opts.length > 0) {
      const sql = `ALTER ROLE "${escapedRole}" WITH ${opts.join(' ')}`;
      await withDb(req.params.id, sql);
    }
  }

  res.json({ success: true, message: `角色 ${roleName} 修改成功` });
}));

/**
 * DELETE /api/connections/:id/roles/:roleName
 * 删除角色
 */
router.delete('/:id/roles/:roleName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  const { roleName } = req.params;
  let sql;
  if (real === 'mysql') {
    const host = req.query.host || '%';
    const escapedUser = roleName.replace(/['\\]/g, "\\$&");
    const escapedHost = host.replace(/['\\]/g, "\\$&");
    sql = `DROP USER '${escapedUser}'@'${escapedHost}'`;
  } else {
    const escapedRole = roleName.replace(/"/g, '""');
    sql = `DROP ROLE IF EXISTS "${escapedRole}"`;
  }

  await withDb(req.params.id, sql);
  res.json({ success: true, message: `角色 ${roleName} 已删除` });
}));

/**
 * GET /api/connections/:id/roles/:roleName/grants
 * 获取角色权限
 */
router.get('/:id/roles/:roleName/grants', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { roleName } = req.params;

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  if (real === 'mysql') {
    const host = req.query.host || '%';
    const escapedUser = roleName.replace(/['\\]/g, "\\$&");
    const escapedHost = host.replace(/['\\]/g, "\\$&");
    const sql = `SHOW GRANTS FOR '${escapedUser}'@'${escapedHost}'`;
    const result = await withDb(req.params.id, sql);
    // 解析 SHOW GRANTS 输出
    const grants = result.rows.map(r => {
      const line = Object.values(r)[0] || '';
      return { grantStatement: line };
    });
    res.json({ grants });
  } else {
    // PostgreSQL
    const escapedRole = roleName.replace(/"/g, '""');
    const sql = `SELECT
                   grantee,
                   table_catalog,
                   table_schema,
                   table_name,
                   privilege_type,
                   is_grantable
                 FROM information_schema.table_privileges
                 WHERE grantee = '${escapedRole}'
                 ORDER BY table_schema, table_name, privilege_type`;
    const result = await withDb(req.params.id, sql);
    res.json({ grants: result.rows });
  }
}));

/**
 * POST /api/connections/:id/roles/:roleName/grants
 * 授予权限
 */
router.post('/:id/roles/:roleName/grants', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { roleName } = req.params;
  const { privilege, table, schema } = req.body;

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  if (!privilege) return res.status(400).json({ error: '权限类型不能为空' });

  const priv = privilege.toUpperCase();

  if (real === 'mysql') {
    const host = req.body.host || '%';
    const escapedUser = roleName.replace(/['\\]/g, "\\$&");
    const escapedHost = host.replace(/['\\]/g, "\\$&");
    const escapedTable = table
      ? `\`${table.replace(/`/g, '``')}\``
      : '*.*';
    const sql = `GRANT ${priv} ON ${escapedTable} TO '${escapedUser}'@'${escapedHost}'`;
    await withDb(req.params.id, sql);
  } else {
    const escapedRole = roleName.replace(/"/g, '""');
    const targetSchema = schema || 'public';
    const escapedSchema = targetSchema.replace(/"/g, '""');
    let target;
    if (table) {
      const escapedTable = table.replace(/"/g, '""');
      target = `"${escapedSchema}"."${escapedTable}"`;
    } else {
      target = `ALL TABLES IN SCHEMA "${escapedSchema}"`;
    }
    const sql = `GRANT ${priv} ON ${target} TO "${escapedRole}"`;
    await withDb(req.params.id, sql);
  }

  res.json({ success: true, message: `已授予 ${privilege} 权限` });
}));

/**
 * DELETE /api/connections/:id/roles/:roleName/grants
 * 撤销权限
 */
router.delete('/:id/roles/:roleName/grants', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { roleName } = req.params;
  const { privilege, table, schema } = req.body;

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  if (!privilege) return res.status(400).json({ error: '权限类型不能为空' });

  const priv = privilege.toUpperCase();

  if (real === 'mysql') {
    const host = req.body.host || '%';
    const escapedUser = roleName.replace(/['\\]/g, "\\$&");
    const escapedHost = host.replace(/['\\]/g, "\\$&");
    const escapedTable = table
      ? `\`${table.replace(/`/g, '``')}\``
      : '*.*';
    const sql = `REVOKE ${priv} ON ${escapedTable} FROM '${escapedUser}'@'${escapedHost}'`;
    await withDb(req.params.id, sql);
  } else {
    const escapedRole = roleName.replace(/"/g, '""');
    const targetSchema = schema || 'public';
    const escapedSchema = targetSchema.replace(/"/g, '""');
    let target;
    if (table) {
      const escapedTable = table.replace(/"/g, '""');
      target = `"${escapedSchema}"."${escapedTable}"`;
    } else {
      target = `ALL TABLES IN SCHEMA "${escapedSchema}"`;
    }
    const sql = `REVOKE ${priv} ON ${target} FROM "${escapedRole}"`;
    await withDb(req.params.id, sql);
  }

  res.json({ success: true, message: `已撤销 ${privilege} 权限` });
}));

/**
 * POST /api/connections/:id/roles/:roleName/grants/batch
 * 批量授予权限
 */
router.post('/:id/roles/:roleName/grants/batch', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { roleName } = req.params;
  const { privilege, tables, schema } = req.body;

  if (!await supportsRoleManagement(conn.driver, conn.custom_driver_id)) {
    return res.status(400).json({ error: '当前数据库类型不支持角色管理' });
  }

  if (!privilege) return res.status(400).json({ error: '权限类型不能为空' });
  if (!tables || !Array.isArray(tables) || tables.length === 0) {
    return res.status(400).json({ error: '表名列表不能为空' });
  }

  const priv = privilege.toUpperCase();
  const targetSchema = schema || 'public';
  let success = 0;
  let fail = 0;
  const errors = [];

  if (real === 'mysql') {
    const host = req.body.host || '%';
    const escapedUser = roleName.replace(/['\\]/g, "\\$&");
    const escapedHost = host.replace(/['\\]/g, "\\$&");
    for (const table of tables) {
      try {
        const escapedTable = `\`${table.replace(/`/g, '``')}\``;
        const sql = `GRANT ${priv} ON ${escapedTable} TO '${escapedUser}'@'${escapedHost}'`;
        await withDb(req.params.id, sql);
        success++;
      } catch (err) {
        fail++;
        errors.push(`表 ${table}: ${err.message}`);
      }
    }
  } else {
    const escapedRole = roleName.replace(/"/g, '""');
    const escapedSchema = targetSchema.replace(/"/g, '""');
    for (const table of tables) {
      try {
        const escapedTable = table.replace(/"/g, '""');
        const sql = `GRANT ${priv} ON "${escapedSchema}"."${escapedTable}" TO "${escapedRole}"`;
        await withDb(req.params.id, sql);
        success++;
      } catch (err) {
        fail++;
        errors.push(`表 ${table}: ${err.message}`);
      }
    }
  }

  res.json({ success, fail, errors: errors.length > 0 ? errors : undefined });
}));

// ===================================================================
//  表 CRUD
// ===================================================================

/**
 * POST /api/connections/:id/tables
 * 创建表
 */
router.post('/:id/tables', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { tableName, schema, columns, comment } = req.body;

  if (!tableName) return res.status(400).json({ error: '表名不能为空' });
  if (!columns || columns.length === 0) return res.status(400).json({ error: '至少需要定义一个列' });

  const escapedTable = tableName.replace(/"/g, '""');
  const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';

  const colDefs = columns.map(col => buildColumnDef(col, real));
  const colSql = colDefs.join(',\n  ');

  let sql;
  if (real === 'mysql') {
    const backtickTable = tableName.replace(/`/g, '``');
    const mysqlPrefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';
    const mysqlCols = columns.map(col => buildColumnDef(col, 'mysql')).join(',\n  ');
    sql = `CREATE TABLE ${mysqlPrefix}\`${backtickTable}\` (\n  ${mysqlCols}\n)`;
    if (comment) {
      const escapedComment = comment.replace(/['\\]/g, "\\$&");
      sql += ` COMMENT='${escapedComment}'`;
    }
  } else {
    sql = `CREATE TABLE ${prefix}"${escapedTable}" (\n  ${colSql}\n)`;
    if (comment) {
      sql += `;`;
      const escapedComment = comment.replace(/'/g, "''");
      sql += `\nCOMMENT ON TABLE ${prefix}"${escapedTable}" IS '${escapedComment}'`;
    }
  }

  await withDb(req.params.id, sql, { timeout: 60000 });
  res.json({ success: true, message: `表 ${tableName} 创建成功` });
}));

/**
 * DELETE /api/connections/:id/tables/:tableName
 * 删除表
 */
router.delete('/:id/tables/:tableName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { tableName } = req.params;
  const schema = req.query.schema;

  let sql;
  if (real === 'mysql') {
    const escapedTable = tableName.replace(/`/g, '``');
    const prefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';
    sql = `DROP TABLE IF EXISTS ${prefix}\`${escapedTable}\``;
  } else {
    const escapedTable = tableName.replace(/"/g, '""');
    const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';
    sql = `DROP TABLE IF EXISTS ${prefix}"${escapedTable}"`;
  }

  await withDb(req.params.id, sql, { timeout: 60000 });
  res.json({ success: true, message: `表 ${tableName} 已删除` });
}));

/**
 * POST /api/connections/:id/tables/:tableName/columns
 * 添加列
 */
router.post('/:id/tables/:tableName/columns', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { tableName } = req.params;
  const { column, after } = req.body;

  if (!column || !column.name || !column.type) {
    return res.status(400).json({ error: '列名和类型不能为空' });
  }

  const schema = req.query.schema;
  const colDef = buildColumnDef(column, real);

  let sql;
  if (real === 'mysql') {
    const escapedTable = tableName.replace(/`/g, '``');
    const prefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';
    sql = `ALTER TABLE ${prefix}\`${escapedTable}\` ADD COLUMN ${colDef}`;
    if (after) {
      const escapedAfter = after.replace(/`/g, '``');
      sql += ` AFTER \`${escapedAfter}\``;
    }
  } else {
    const escapedTable = tableName.replace(/"/g, '""');
    const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';
    sql = `ALTER TABLE ${prefix}"${escapedTable}" ADD COLUMN ${colDef}`;
  }

  await withDb(req.params.id, sql, { timeout: 60000 });
  res.json({ success: true, message: `列 ${column.name} 添加成功` });
}));

/**
 * PUT /api/connections/:id/tables/:tableName/columns/:columnName
 * 修改列
 */
router.put('/:id/tables/:tableName/columns/:columnName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { tableName, columnName } = req.params;
  const { newName, type, nullable, defaultValue, comment } = req.body;
  const schema = req.query.schema;

  let sql;
  if (real === 'mysql') {
    const escapedTable = tableName.replace(/`/g, '``');
    const escapedCol = columnName.replace(/`/g, '``');
    const prefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';

    if (newName && type) {
      // 重命名 + 修改类型
      const escapedNew = newName.replace(/`/g, '``');
      const nullStr = nullable !== false ? 'NULL' : 'NOT NULL';
      const defStr = defaultValue !== undefined ? ` DEFAULT ${formatDefaultValue(defaultValue, real)}` : '';
      sql = `ALTER TABLE ${prefix}\`${escapedTable}\` CHANGE \`${escapedCol}\` \`${escapedNew}\` ${type} ${nullStr}${defStr}`;
    } else if (type) {
      const nullStr = nullable !== false ? 'NULL' : 'NOT NULL';
      const defStr = defaultValue !== undefined ? ` DEFAULT ${formatDefaultValue(defaultValue, real)}` : '';
      sql = `ALTER TABLE ${prefix}\`${escapedTable}\` MODIFY \`${escapedCol}\` ${type} ${nullStr}${defStr}`;
    } else {
      // 只修改属性
      const parts = [`ALTER TABLE ${prefix}\`${escapedTable}\``];
      if (newName) {
        const escapedNew = newName.replace(/`/g, '``');
        parts.push(`RENAME COLUMN \`${escapedCol}\` TO \`${escapedNew}\``);
      }
      if (nullable !== undefined) {
        parts.push(`MODIFY \`${escapedCol}\` ${nullable ? 'DROP' : 'SET'} NOT NULL`);
      }
      if (defaultValue !== undefined) {
        if (defaultValue === null) {
          parts.push(`ALTER \`${escapedCol}\` DROP DEFAULT`);
        } else {
          parts.push(`ALTER \`${escapedCol}\` SET DEFAULT ${formatDefaultValue(defaultValue, real)}`);
        }
      }
      sql = parts.join(',\n');
    }
  } else {
    const escapedTable = tableName.replace(/"/g, '""');
    const escapedCol = columnName.replace(/"/g, '""');
    const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';

    if (newName && newName !== columnName) {
      const escapedNew = newName.replace(/"/g, '""');
      sql = `ALTER TABLE ${prefix}"${escapedTable}" RENAME COLUMN "${escapedCol}" TO "${escapedNew}"`;
      // 如果需要修改类型，先重命名
      await withDb(req.params.id, sql, { timeout: 60000 });
      if (type) {
        const nullStr = nullable !== false ? '' : ' SET NOT NULL';
        const escapedNewCol = newName.replace(/"/g, '""');
        sql = `ALTER TABLE ${prefix}"${escapedTable}" ALTER COLUMN "${escapedNewCol}" TYPE ${type}${nullStr ? ';' : ''}`;
        if (nullStr) {
          sql += `\nALTER TABLE ${prefix}"${escapedTable}" ALTER COLUMN "${escapedNewCol}"${nullStr}`;
        }
        await withDb(req.params.id, sql, { timeout: 60000 });
      }
      // 处理 default
      if (defaultValue !== undefined) {
        await withDb(req.params.id,
          `ALTER TABLE ${prefix}"${escapedTable}" ALTER COLUMN "${escapedNew}" ${defaultValue === null ? 'DROP DEFAULT' : `SET DEFAULT ${formatDefaultValue(defaultValue, real)}`}`,
          { timeout: 60000 });
      }
      return res.json({ success: true, message: `列 ${columnName} 修改成功` });
    }

    // PG: ALTER COLUMN
    const alterParts = [];
    if (type) {
      const nullStr = nullable !== false ? '' : ' SET NOT NULL';
      alterParts.push(`ALTER COLUMN "${escapedCol}" TYPE ${type}${nullStr ? '; ALTER COLUMN "' + escapedCol + '"' + nullStr : ''}`);
    }
    if (nullable !== undefined && !type) {
      alterParts.push(`ALTER COLUMN "${escapedCol}" ${nullable ? 'DROP' : 'SET'} NOT NULL`);
    }
    if (defaultValue !== undefined) {
      alterParts.push(`ALTER COLUMN "${escapedCol}" ${defaultValue === null ? 'DROP DEFAULT' : `SET DEFAULT ${formatDefaultValue(defaultValue, real)}`}`);
    }

    if (alterParts.length === 0) {
      return res.status(400).json({ error: '没有需要修改的属性' });
    }

    sql = alterParts.map(p => `ALTER TABLE ${prefix}"${escapedTable}" ${p}`).join(';\n');
  }

  await withDb(req.params.id, sql, { timeout: 60000 });
  res.json({ success: true, message: `列 ${columnName} 修改成功` });
}));

/**
 * DELETE /api/connections/:id/tables/:tableName/columns/:columnName
 * 删除列
 */
router.delete('/:id/tables/:tableName/columns/:columnName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { tableName, columnName } = req.params;
  const schema = req.query.schema;

  let sql;
  if (real === 'mysql') {
    const escapedTable = tableName.replace(/`/g, '``');
    const escapedCol = columnName.replace(/`/g, '``');
    const prefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';
    sql = `ALTER TABLE ${prefix}\`${escapedTable}\` DROP COLUMN \`${escapedCol}\``;
  } else {
    const escapedTable = tableName.replace(/"/g, '""');
    const escapedCol = columnName.replace(/"/g, '""');
    const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';
    sql = `ALTER TABLE ${prefix}"${escapedTable}" DROP COLUMN "${escapedCol}"`;
  }

  await withDb(req.params.id, sql, { timeout: 60000 });
  res.json({ success: true, message: `列 ${columnName} 已删除` });
}));

// ===================================================================
//  视图 CRUD
// ===================================================================

/**
 * POST /api/connections/:id/views
 * 创建视图
 */
router.post('/:id/views', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { viewName, schema, asSql, comment } = req.body;

  if (!viewName) return res.status(400).json({ error: '视图名不能为空' });
  if (!asSql) return res.status(400).json({ error: '视图 SQL 不能为空' });

  if (real === 'mysql') {
    const escapedView = viewName.replace(/`/g, '``');
    const prefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';
    const sql = `CREATE VIEW ${prefix}\`${escapedView}\` AS ${asSql}`;
    await withDb(req.params.id, sql, { timeout: 60000 });
  } else {
    const escapedView = viewName.replace(/"/g, '""');
    const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';
    let sql = `CREATE VIEW ${prefix}"${escapedView}" AS ${asSql}`;
    await withDb(req.params.id, sql, { timeout: 60000 });

    if (comment) {
      const escapedComment = comment.replace(/'/g, "''");
      await withDb(req.params.id,
        `COMMENT ON VIEW ${prefix}"${escapedView}" IS '${escapedComment}'`,
        { timeout: 10000 });
    }
  }

  res.json({ success: true, message: `视图 ${viewName} 创建成功` });
}));

/**
 * PUT /api/connections/:id/views/:viewName
 * 修改视图
 */
router.put('/:id/views/:viewName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { viewName } = req.params;
  const { asSql, comment } = req.body;
  const schema = req.query.schema;

  if (asSql) {
    if (real === 'mysql') {
      const escapedView = viewName.replace(/`/g, '``');
      const prefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';
      const sql = `CREATE OR REPLACE VIEW ${prefix}\`${escapedView}\` AS ${asSql}`;
      await withDb(req.params.id, sql, { timeout: 60000 });
    } else {
      const escapedView = viewName.replace(/"/g, '""');
      const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';
      const sql = `CREATE OR REPLACE VIEW ${prefix}"${escapedView}" AS ${asSql}`;
      await withDb(req.params.id, sql, { timeout: 60000 });
    }
  }

  if (comment !== undefined) {
    if (real === 'mysql') {
      // MySQL doesn't support COMMENT ON VIEW via standard SQL
      // Use information_schema approach or skip
    } else {
      const escapedView = viewName.replace(/"/g, '""');
      const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';
      const escapedComment = comment.replace(/'/g, "''");
      const sql = `COMMENT ON VIEW ${prefix}"${escapedView}" IS '${escapedComment}'`;
      await withDb(req.params.id, sql, { timeout: 10000 });
    }
  }

  res.json({ success: true, message: `视图 ${viewName} 修改成功` });
}));

/**
 * DELETE /api/connections/:id/views/:viewName
 * 删除视图
 */
router.delete('/:id/views/:viewName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { viewName } = req.params;
  const schema = req.query.schema;

  let sql;
  if (real === 'mysql') {
    const escapedView = viewName.replace(/`/g, '``');
    const prefix = schema ? `\`${schema.replace(/`/g, '``')}\`.` : '';
    sql = `DROP VIEW IF EXISTS ${prefix}\`${escapedView}\``;
  } else {
    const escapedView = viewName.replace(/"/g, '""');
    const prefix = schema ? `"${schema.replace(/"/g, '""')}".` : '';
    sql = `DROP VIEW IF EXISTS ${prefix}"${escapedView}"`;
  }

  await withDb(req.params.id, sql, { timeout: 60000 });
  res.json({ success: true, message: `视图 ${viewName} 已删除` });
}));

/**
 * GET /api/connections/:id/views/:viewName/ddl
 * 获取视图定义 DDL
 */
router.get('/:id/views/:viewName/ddl', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { viewName } = req.params;
  const schema = req.query.schema;

  let sql;
  if (real === 'mysql') {
    const escapedSchema = schema ? schema.replace(/`/g, '``') : '';
    const escapedView = viewName.replace(/`/g, '``');
    if (escapedSchema) {
      sql = 'SHOW CREATE VIEW `' + escapedSchema + '`.`' + escapedView + '`';
    } else {
      sql = 'SHOW CREATE VIEW `' + escapedView + '`';
    }
    const result = await withDb(req.params.id, sql, { timeout: 30000 });
    // SHOW CREATE VIEW returns two columns: View, Create View, character_set_client
    const ddl = result.rows && result.rows.length > 0
      ? result.rows[0]['Create View'] || result.rows[0]['create_view'] || (Object.values(result.rows[0])[1] || '')
      : '';
    res.json({ ddl: formatViewSql(ddl) });
  } else {
    // PostgreSQL
        const escapedSchema = (schema || 'public').replace(/"/g, '""');
        const escapedView = viewName.replace(/"/g, '""');
        sql = `SELECT 'CREATE OR REPLACE VIEW "' || schemaname || '"."' || viewname || '" AS ' || definition AS ddl
           FROM pg_views
           WHERE schemaname = '${escapedSchema}' AND viewname = '${escapedView}'`;
    const result = await withDb(req.params.id, sql, { timeout: 30000 });
    const ddl = result.rows?.[0]?.ddl || '';
    res.json({ ddl: formatViewSql(ddl) });
  }
}));

/**
 * 格式化视图 SQL，将关键字换行缩进
 */
function formatViewSql(sql) {
  if (!sql) return '';
  // 将 SELECT, FROM, WHERE, JOIN, LEFT JOIN, RIGHT JOIN, INNER JOIN, 
  // GROUP BY, HAVING, ORDER BY, LIMIT, OFFSET, UNION, INTERSECT, EXCEPT
  // 关键字前的空格替换为换行+缩进
  return sql
    // 保留原始 SQL 中的 CREATE OR REPLACE VIEW 头
    // 然后格式化 AS 后面的 SELECT 部分
    .replace(/\bAS\b\s*/i, 'AS\n  ')
    // 主要关键字换行
    .replace(/\s+(SELECT|FROM|WHERE|JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|INNER\s+JOIN|CROSS\s+JOIN|FULL\s+JOIN|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|OFFSET|UNION|INTERSECT|EXCEPT)\b/gi, '\n  $1')
    // 清理多余空行
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ===================================================================
//  辅助函数
// ===================================================================

function buildColumnDef(col, dialect) {
  const escapedName = dialect === 'mysql'
    ? `\`${col.name.replace(/`/g, '``')}\``
    : `"${col.name.replace(/"/g, '""')}"`;

  const type = col.type || 'VARCHAR(255)';
  const length = col.length ? `(${col.length})` : '';
  const fullType = length && !type.includes('(') ? `${type}${length}` : type;

  const nullStr = col.primaryKey ? 'NOT NULL' : (col.nullable !== false ? 'NULL' : 'NOT NULL');
  const pkStr = col.primaryKey ? ' PRIMARY KEY' : '';
  const autoInc = dialect === 'mysql' && col.autoIncrement ? ' AUTO_INCREMENT' : '';
  const defStr = col.defaultValue !== undefined && col.defaultValue !== ''
    ? ` DEFAULT ${formatDefaultValue(col.defaultValue, dialect)}`
    : '';

  let commentStr = '';
  if (col.comment && dialect === 'mysql') {
    const escapedComment = col.comment.replace(/['\\]/g, "\\$&");
    commentStr = ` COMMENT '${escapedComment}'`;
  }

  return `${escapedName} ${fullType}${nullStr}${pkStr}${autoInc}${defStr}${commentStr}`;
}

function formatDefaultValue(value, dialect) {
  if (value === null || value === undefined) return 'NULL';
  const str = String(value);
  // 如果已经是函数调用或数字，不加引号
  if (/^[A-Z_]+\(/.test(str) || /^\d+(\.\d+)?$/.test(str) || str === 'TRUE' || str === 'FALSE' || str === 'NULL') {
    return str;
  }
  if (dialect === 'mysql') {
    return `'${str.replace(/['\\]/g, "\\$&")}'`;
  }
  return `'${str.replace(/'/g, "''")}'`;
}

export default router;
