/**
 * 数据库函数/存储过程管理 API
 * 
 * 函数列表:
 *   GET    /api/connections/:id/functions                    - 获取函数列表
 *   GET    /api/connections/:id/functions/:funcName         - 获取函数详情
 *   GET    /api/connections/:id/functions/:funcName/ddl     - 获取函数 DDL
 *   DELETE /api/connections/:id/functions/:funcName          - 删除函数
 * 
 * 存储过程列表:
 *   GET    /api/connections/:id/procedures                  - 获取存储过程列表
 *   GET    /api/connections/:id/procedures/:procName        - 获取存储过程详情
 *   DELETE /api/connections/:id/procedures/:procName        - 删除存储过程
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
      console.error(`[function-mgmt] error:`, err.message);
      res.status(500).json({ error: formatConnectionError(err) });
    }
  };
}

// ===================================================================
//  函数管理 API
// ===================================================================

/**
 * GET /api/connections/:id/functions
 * 获取函数列表
 */
router.get('/:id/functions', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const schema = req.query.schema || conn.schema_name || 'public';

  let sql;
  let rows;

  if (real === 'mysql') {
    // MySQL: 从 mysql.routines 获取函数列表
    sql = `SELECT ROUTINE_NAME AS func_name, ROUTINE_TYPE AS routine_type, ROUTINE_SCHEMA AS schema_name,
                  DATA_TYPE AS return_type, ROUTINE_DEFINITION AS definition, ROUTINE_COMMENT AS comment
           FROM information_schema.ROUTINES
           WHERE ROUTINE_SCHEMA = '${conn.database_name}' AND ROUTINE_TYPE = 'FUNCTION'
           ORDER BY ROUTINE_NAME`;
    const result = await withDb(req.params.id, sql);
    rows = result.rows || [];
  } else {
    // PostgreSQL/瀚高/达梦: 从 information_schema 获取函数列表
    const escapedSchema = schema.replace(/'/g, "''");
    sql = `SELECT p.proname AS func_name,
                  'FUNCTION' AS routine_type,
                  n.nspname AS schema_name,
                  pg_get_function_result(p.oid) AS return_type,
                  pg_get_function_definition(p.oid) AS definition,
                  obj_description(p.oid, 'pg_proc') AS comment
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = '${escapedSchema}'
             AND p.prokind = 'f'
             AND NOT p.proisagg
           ORDER BY p.proname`;
    
    // 尝试标准 PostgreSQL 查询，如果失败则使用兼容查询
    try {
      const result = await withDb(req.params.id, sql);
      rows = result.rows || [];
    } catch (e) {
      // 兼容瀚高/达梦等国产数据库
      sql = `SELECT routine_name AS func_name,
                    'FUNCTION' AS routine_type,
                    routine_schema AS schema_name,
                    data_type AS return_type,
                    routine_definition AS definition,
                    '' AS comment
             FROM information_schema.routines
             WHERE routine_schema = '${escapedSchema}'
               AND routine_type = 'FUNCTION'
             ORDER BY routine_name`;
      const result = await withDb(req.params.id, sql);
      rows = result.rows || [];
    }
  }

  // 格式化返回数据
  const functions = rows.map(r => ({
    name: r.func_name,
    type: r.routine_type,
    schema: r.schema_name,
    returnType: r.return_type || 'void',
    definition: r.definition || '',
    comment: r.comment || '',
  }));

  res.json({ functions });
}));

/**
 * GET /api/connections/:id/functions/:funcName
 * 获取函数详情（包含参数列表）
 */
router.get('/:id/functions/:funcName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { funcName } = req.params;
  const schema = req.query.schema || conn.schema_name || 'public';

  let funcDetail;
  let args = [];

  if (real === 'mysql') {
    // MySQL: 获取函数定义和参数
    const escapedDb = conn.database_name.replace(/'/g, "''");
    const escapedFunc = funcName.replace(/'/g, "''");
    
    // 获取函数基本信息
    const funcSql = `SELECT ROUTINE_NAME AS func_name, ROUTINE_TYPE AS routine_type,
                            DATA_TYPE AS return_type, ROUTINE_DEFINITION AS definition,
                            ROUTINE_COMMENT AS comment
                     FROM information_schema.ROUTINES
                     WHERE ROUTINE_SCHEMA = '${escapedDb}' AND ROUTINE_NAME = '${escapedFunc}'`;
    const funcResult = await withDb(req.params.id, funcSql);
    
    if (funcResult.rows.length === 0) {
      return res.status(404).json({ error: '函数不存在' });
    }
    
    const r = funcResult.rows[0];
    funcDetail = {
      name: r.func_name,
      type: r.routine_type,
      returnType: r.return_type,
      definition: r.definition || '',
      comment: r.comment || '',
    };
    
    // 获取函数参数
    const argSql = `SELECT PARAMETER_NAME AS param_name, PARAMETER_MODE AS param_mode,
                          DATA_TYPE AS param_type, CHARACTER_MAXIMUM_LENGTH AS param_length,
                          ORDINAL_POSITION AS position
                   FROM information_schema.PARAMETERS
                   WHERE ROUTINE_SCHEMA = '${escapedDb}' AND ROUTINE_NAME = '${escapedFunc}'
                   ORDER BY ORDINAL_POSITION`;
    const argResult = await withDb(req.params.id, argSql);
    args = (argResult.rows || []).map(a => ({
      name: a.param_name || '',
      mode: a.param_mode || 'IN',
      type: a.param_type,
      length: a.param_length,
      position: a.position,
    }));
  } else {
    // PostgreSQL/瀚高/达梦
    const escapedSchema = schema.replace(/'/g, "''");
    const escapedFunc = funcName.replace(/'/g, "''");
    
    // 获取函数定义
    const funcSql = `SELECT p.proname AS func_name,
                            pg_get_function_result(p.oid) AS return_type,
                            pg_get_function_definition(p.oid) AS definition,
                            obj_description(p.oid, 'pg_proc') AS comment
                     FROM pg_proc p
                     JOIN pg_namespace n ON p.pronamespace = n.oid
                     WHERE n.nspname = '${escapedSchema}' AND p.proname = '${escapedFunc}'`;
    
    try {
      const funcResult = await withDb(req.params.id, funcSql);
      
      if (funcResult.rows.length === 0) {
        return res.status(404).json({ error: '函数不存在' });
      }
      
      const r = funcResult.rows[0];
      funcDetail = {
        name: r.func_name,
        type: 'FUNCTION',
        returnType: r.return_type || 'void',
        definition: r.definition || '',
        comment: r.comment || '',
      };
      
      // 获取函数参数
      const argSql = `SELECT p.proname AS func_name,
                            COALESCE(pg_get_function_arguments(p.oid), '') AS args
                     FROM pg_proc p
                     JOIN pg_namespace n ON p.pronamespace = n.oid
                     WHERE n.nspname = '${escapedSchema}' AND p.proname = '${escapedFunc}'`;
      const argResult = await withDb(req.params.id, argSql);
      
      if (argResult.rows.length > 0 && argResult.rows[0].args) {
        // 解析参数字符串: (param1 type1, param2 type2, ...)
        const argsStr = argResult.rows[0].args;
        const paramMatches = argsStr.matchAll(/(\w+)\s+(\w+(?:\(\d+\))?)/g);
        let pos = 1;
        for (const match of paramMatches) {
          args.push({
            name: match[1],
            mode: 'IN',
            type: match[2],
            position: pos++,
          });
        }
      }
    } catch (e) {
      // 兼容国产数据库: 使用 information_schema
      const funcSql = `SELECT routine_name AS func_name, data_type AS return_type,
                              '' AS comment
                       FROM information_schema.routines
                       WHERE routine_schema = '${escapedSchema}' 
                         AND routine_name = '${escapedFunc}'
                         AND routine_type = 'FUNCTION'`;
      const funcResult = await withDb(req.params.id, funcSql);
      
      if (funcResult.rows.length === 0) {
        return res.status(404).json({ error: '函数不存在' });
      }
      
      const r = funcResult.rows[0];
      funcDetail = {
        name: r.func_name,
        type: 'FUNCTION',
        returnType: r.return_type || 'void',
        definition: r.definition || '',
        comment: r.comment || '',
      };
    }
  }

  res.json({ function: funcDetail, args });
}));

/**
 * GET /api/connections/:id/functions/:funcName/ddl
 * 获取函数 DDL
 */
router.get('/:id/functions/:funcName/ddl', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { funcName } = req.params;
  const schema = req.query.schema || conn.schema_name || 'public';

  let ddl = '';

  if (real === 'mysql') {
    // MySQL: 使用 SHOW CREATE FUNCTION
    const escapedFunc = funcName.replace(/`/g, '``');
    try {
      const result = await withDb(req.params.id, `SHOW CREATE FUNCTION \`${escapedFunc}\``);
      if (result.rows.length > 0) {
        ddl = result.rows[0]['Create Function'] || '';
      }
    } catch (e) {
      // Fallback: 从 information_schema 获取定义
      const escapedDb = conn.database_name.replace(/'/g, "''");
      const sql = `SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES
                   WHERE ROUTINE_SCHEMA = '${escapedDb}' AND ROUTINE_NAME = '${funcName}'`;
      const result = await withDb(req.params.id, sql);
      if (result.rows.length > 0) {
        ddl = `CREATE FUNCTION \`${funcName}\`\nAS \\$\\$\n${result.rows[0].ROUTINE_DEFINITION}\n\\$\\$;`;
      }
    }
  } else {
    // PostgreSQL/瀚高/达梦: 使用 pg_get_function_definition
    const escapedSchema = schema.replace(/'/g, "''");
    const escapedFunc = funcName.replace(/'/g, "''");
    
    try {
      const sql = `SELECT pg_get_function_definition(p.oid) AS ddl
                   FROM pg_proc p
                   JOIN pg_namespace n ON p.pronamespace = n.oid
                   WHERE n.nspname = '${escapedSchema}' AND p.proname = '${escapedFunc}'`;
      const result = await withDb(req.params.id, sql);
      if (result.rows.length > 0) {
        ddl = result.rows[0].ddl || '';
      }
    } catch (e) {
      // 兼容国产数据库
      const sql = `SELECT routine_definition AS ddl
                   FROM information_schema.routines
                   WHERE routine_schema = '${escapedSchema}'
                     AND routine_name = '${escapedFunc}'
                     AND routine_type = 'FUNCTION'`;
      const result = await withDb(req.params.id, sql);
      if (result.rows.length > 0 && result.rows[0].ddl) {
        ddl = `CREATE OR REPLACE FUNCTION "${schema}"."${funcName}"\nAS \\$\\$\n${result.rows[0].ddl}\n\\$\\$;`;
      }
    }
  }

  if (!ddl) {
    return res.status(404).json({ error: '无法获取函数 DDL' });
  }

  res.json({ ddl });
}));

/**
 * DELETE /api/connections/:id/functions/:funcName
 * 删除函数
 */
router.delete('/:id/functions/:funcName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { funcName } = req.params;
  const schema = req.query.schema || conn.schema_name || 'public';

  let sql;

  if (real === 'mysql') {
    const escapedFunc = funcName.replace(/`/g, '``');
    sql = `DROP FUNCTION IF EXISTS \`${escapedFunc}\``;
  } else {
    const escapedSchema = schema.replace(/"/g, '""');
    const escapedFunc = funcName.replace(/"/g, '""');
    sql = `DROP FUNCTION IF EXISTS "${escapedSchema}"."${escapedFunc}" CASCADE`;
  }

  await withDb(req.params.id, sql);
  res.json({ success: true, message: `函数 ${funcName} 已删除` });
}));

// ===================================================================
//  存储过程管理 API
// ===================================================================

/**
 * GET /api/connections/:id/procedures
 * 获取存储过程列表
 */
router.get('/:id/procedures', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const schema = req.query.schema || conn.schema_name || 'public';

  let sql;
  let rows;

  if (real === 'mysql') {
    sql = `SELECT ROUTINE_NAME AS proc_name, ROUTINE_TYPE AS routine_type, ROUTINE_SCHEMA AS schema_name,
                  ROUTINE_DEFINITION AS definition, ROUTINE_COMMENT AS comment
           FROM information_schema.ROUTINES
           WHERE ROUTINE_SCHEMA = '${conn.database_name}' AND ROUTINE_TYPE = 'PROCEDURE'
           ORDER BY ROUTINE_NAME`;
    const result = await withDb(req.params.id, sql);
    rows = result.rows || [];
  } else {
    // PostgreSQL/瀚高/达梦: 存储过程 (PostgreSQL 11+ 支持)
    const escapedSchema = schema.replace(/'/g, "''");
    sql = `SELECT p.proname AS proc_name,
                  'PROCEDURE' AS routine_type,
                  n.nspname AS schema_name,
                  pg_get_function_definition(p.oid) AS definition,
                  obj_description(p.oid, 'pg_proc') AS comment
           FROM pg_proc p
           JOIN pg_namespace n ON p.pronamespace = n.oid
           WHERE n.nspname = '${escapedSchema}'
             AND p.prokind = 'p'
           ORDER BY p.proname`;
    
    try {
      const result = await withDb(req.params.id, sql);
      rows = result.rows || [];
    } catch (e) {
      // 兼容国产数据库
      sql = `SELECT routine_name AS proc_name, routine_type, routine_schema AS schema_name,
                              '' AS comment
             FROM information_schema.routines
             WHERE routine_schema = '${escapedSchema}' AND routine_type = 'PROCEDURE'
             ORDER BY routine_name`;
      const result = await withDb(req.params.id, sql);
      rows = result.rows || [];
    }
  }

  const procedures = rows.map(r => ({
    name: r.proc_name,
    type: r.routine_type,
    schema: r.schema_name,
    definition: r.definition || '',
    comment: r.comment || '',
  }));

  res.json({ procedures });
}));

/**
 * GET /api/connections/:id/procedures/:procName
 * 获取存储过程详情
 */
router.get('/:id/procedures/:procName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { procName } = req.params;
  const schema = req.query.schema || conn.schema_name || 'public';

  let procDetail;
  let args = [];

  if (real === 'mysql') {
    const escapedDb = conn.database_name.replace(/'/g, "''");
    const escapedProc = procName.replace(/'/g, "''");
    
    const sql = `SELECT ROUTINE_NAME AS proc_name, ROUTINE_TYPE AS routine_type,
                        ROUTINE_DEFINITION AS definition, ROUTINE_COMMENT AS comment
                 FROM information_schema.ROUTINES
                 WHERE ROUTINE_SCHEMA = '${escapedDb}' AND ROUTINE_NAME = '${escapedProc}'`;
    const result = await withDb(req.params.id, sql);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: '存储过程不存在' });
    }
    
    const r = result.rows[0];
    procDetail = {
      name: r.proc_name,
      type: r.routine_type,
      definition: r.definition || '',
      comment: r.comment || '',
    };
    
    // 获取参数
    const argSql = `SELECT PARAMETER_NAME AS param_name, PARAMETER_MODE AS param_mode,
                          DATA_TYPE AS param_type, ORDINAL_POSITION AS position
                   FROM information_schema.PARAMETERS
                   WHERE ROUTINE_SCHEMA = '${escapedDb}' AND ROUTINE_NAME = '${escapedProc}'
                   ORDER BY ORDINAL_POSITION`;
    const argResult = await withDb(req.params.id, argSql);
    args = (argResult.rows || []).map(a => ({
      name: a.param_name || '',
      mode: a.param_mode || 'IN',
      type: a.param_type,
      position: a.position,
    }));
  } else {
    const escapedSchema = schema.replace(/'/g, "''");
    const escapedProc = procName.replace(/'/g, "''");
    
    const sql = `SELECT p.proname AS proc_name, pg_get_function_definition(p.oid) AS definition,
                        obj_description(p.oid, 'pg_proc') AS comment
                 FROM pg_proc p
                 JOIN pg_namespace n ON p.pronamespace = n.oid
                 WHERE n.nspname = '${escapedSchema}' AND p.proname = '${escapedProc}'`;
    
    try {
      const result = await withDb(req.params.id, sql);
      
      if (result.rows.length === 0) {
        return res.status(404).json({ error: '存储过程不存在' });
      }
      
      const r = result.rows[0];
      procDetail = {
        name: r.proc_name,
        type: 'PROCEDURE',
        definition: r.definition || '',
        comment: r.comment || '',
      };
    } catch (e) {
      return res.status(404).json({ error: '存储过程不存在' });
    }
  }

  res.json({ procedure: procDetail, args });
}));

/**
 * DELETE /api/connections/:id/procedures/:procName
 * 删除存储过程
 */
router.delete('/:id/procedures/:procName', wrapHandler(async (req, res) => {
  const { conn } = await getConnConfig(req.params.id);
  const real = await resolveRealDriver(conn.driver, conn.custom_driver_id);
  const { procName } = req.params;
  const schema = req.query.schema || conn.schema_name || 'public';

  let sql;

  if (real === 'mysql') {
    const escapedProc = procName.replace(/`/g, '``');
    sql = `DROP PROCEDURE IF EXISTS \`${escapedProc}\``;
  } else {
    const escapedSchema = schema.replace(/"/g, '""');
    const escapedProc = procName.replace(/"/g, '""');
    sql = `DROP PROCEDURE IF EXISTS "${escapedSchema}"."${escapedProc}" CASCADE`;
  }

  await withDb(req.params.id, sql);
  res.json({ success: true, message: `存储过程 ${procName} 已删除` });
}));

export default router;
