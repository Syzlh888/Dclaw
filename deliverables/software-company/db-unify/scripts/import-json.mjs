#!/usr/bin/env node
/**
 * JSON → PostgreSQL 数据迁移脚本 (D4)
 *
 * 用法:
 *   node scripts/import-json.mjs             # 实际导入 (仅空表)
 *   node scripts/import-json.mjs --dry-run   # 干跑, 不写入
 *   node scripts/import-json.mjs --force     # 强制导入 (非空表也导, 幂等 ON CONFLICT DO NOTHING)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, withTransaction, closePool } from '../server/db/pool.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, '..', 'data');

// 集合 → 表 → 文件 (顺序按依赖关系: 先基础字典, 再业务, 最后权限/审计)
const MAPPINGS = [
  { collection: 'platforms',           table: 'platforms',             file: 'platforms.json' },
  { collection: 'predbTypes',          table: 'predb_types',           file: 'predb_types.json' },
  { collection: 'districts',           table: 'districts',             file: 'districts.json' },
  { collection: 'hospitals',           table: 'hospitals',             file: 'hospitals.json' },
  { collection: 'connections',         table: 'connections',           file: 'connections.json' },
  { collection: 'drivers',             table: 'drivers',               file: 'drivers.json' },
  { collection: 'executionHistory',    table: 'execution_history',     file: 'execution_history.json' },
  { collection: 'executionTasks',      table: 'execution_tasks',       file: 'execution_tasks.json' },
  { collection: 'sqlTemplates',        table: 'sql_templates',         file: 'sql_templates.json' },
  { collection: 'sqlScripts',          table: 'sql_scripts',           file: 'sql_scripts.json' },
  { collection: 'projects',            table: 'projects',              file: 'projects.json' },
  { collection: 'engineerings',        table: 'engineerings',          file: 'engineerings.json' },
  { collection: 'applications',        table: 'applications',          file: 'applications.json' },
  { collection: 'servers',             table: 'servers',               file: 'servers.json' },
  { collection: 'servers_db_instances',  table: 'servers_db_instances',  file: 'servers_db_instances.json' },
  { collection: 'servers_app_instances', table: 'servers_app_instances', file: 'servers_app_instances.json' },
  { collection: 'servers_mid_instances', table: 'servers_mid_instances', file: 'servers_mid_instances.json' },
  { collection: 'servers_api_instances', table: 'servers_api_instances', file: 'servers_api_instances.json' },
  { collection: 'servers_ports',       table: 'servers_ports',         file: 'servers_ports.json' },
  { collection: 'access_entries',      table: 'access_entries',        file: 'access_entries.json' },
  { collection: 'passwordHistory',     table: 'password_history',      file: 'password_history.json' },
  { collection: 'systemConfig',        table: 'system_config',         file: 'system_config.json' },
  { collection: 'queryTemplates',      table: 'query_templates',       file: 'query_templates.json' },
  { collection: 'users',               table: 'users',                 file: 'users.json' },
  { collection: 'roles',               table: 'roles',                 file: 'roles.json' },
  { collection: 'rolePermissions',     table: 'role_permissions',      file: 'role_permissions.json' },
  { collection: 'userRoles',           table: 'user_roles',            file: 'user_roles.json' },
  { collection: 'resourceGrants',      table: 'resource_grants',       file: 'resource_grants.json' },
  { collection: 'temporaryGrants',     table: 'temporary_grants',      file: 'temporary_grants.json' },
  { collection: 'sqlApprovalRequests', table: 'sql_approval_requests', file: 'sql_approval_requests.json' },
  { collection: 'sqlApproverConfig',   table: 'sql_approver_config',   file: 'sql_approver_config.json' },
  { collection: 'auditLogs',           table: 'audit_logs',            file: 'audit_logs.json' },
  { collection: 'authSessions',        table: 'auth_sessions',         file: 'auth_sessions.json' },
];

const JSON_TYPES = new Set(['jsonb', 'json']);

/** 查目标表列信息 */
async function getTableColumns(table) {
  const r = await query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=$1
    ORDER BY ordinal_position
  `, [table]);
  return r.rows;
}

/** 插入单行, JSONB 字段自动 stringify, 未知字段进 extra (若存在) */
async function insertRow(client, table, columns, row) {
  const colNames = columns.map(c => c.column_name);
  const hasExtra = colNames.includes('extra');

  const known = {};
  const extra = {};
  for (const [k, v] of Object.entries(row)) {
    if (colNames.includes(k)) known[k] = v;
    else if (hasExtra) extra[k] = v;
    // else: 静默丢弃
  }

  if (hasExtra && Object.keys(extra).length > 0) {
    // 若原本 row 里也带 extra, 合并
    known.extra = { ...(known.extra && typeof known.extra === 'object' ? known.extra : {}), ...extra };
  }

  const keys = Object.keys(known);
  if (keys.length === 0) return null;

  const values = keys.map(k => {
    const v = known[k];
    if (v === null || v === undefined) return null;
    const col = columns.find(c => c.column_name === k);
    if (col && JSON_TYPES.has(col.data_type)) {
      // JSONB: 对象/数组序列化; 若已是字符串则保持
      return typeof v === 'string' ? v : JSON.stringify(v);
    }
    // 布尔/数字/字符串直接传, PG driver 负责编码
    return v;
  });

  const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
  const colList = keys.map(k => `"${k}"`).join(', ');
  const hasIdCol = colNames.includes('id');
  const conflict = hasIdCol ? 'ON CONFLICT (id) DO NOTHING' : 'ON CONFLICT DO NOTHING';
  const returning = hasIdCol ? 'RETURNING id' : '';
  const sql = `INSERT INTO ${table} (${colList}) VALUES (${placeholders}) ${conflict} ${returning}`.trim();

  const result = await client.query(sql, values);
  return hasIdCol ? (result.rows[0]?.id ?? null) : (result.rowCount > 0 ? true : null);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const force  = process.argv.includes('--force');

  console.log(dryRun ? '🔍 干跑模式(不写数据)' : '🚀 开始 JSON → PG 迁移');
  if (force) console.log('⚠️  --force 已启用: 非空表也将尝试导入 (幂等)');
  console.log(`数据目录: ${DATA_DIR}\n`);

  const stats = { total: 0, inserted: 0, skipped: 0, errors: 0, tables: 0 };
  let rollbackSentinel = false;

  try {
    await withTransaction(async (client) => {
      for (const m of MAPPINGS) {
        const filePath = path.join(DATA_DIR, m.file);
        if (!fs.existsSync(filePath)) {
          console.log(`⚠️  跳过(文件不存在): ${m.file}`);
          continue;
        }

        let rows;
        try {
          const raw = fs.readFileSync(filePath, 'utf8').trim();
          if (!raw) { console.log(`  空文件: ${m.file}`); continue; }
          rows = JSON.parse(raw);
        } catch (e) {
          console.error(`❌ 解析失败: ${m.file}`, e.message);
          stats.errors++;
          continue;
        }

        if (!Array.isArray(rows)) rows = [rows];
        if (rows.length === 0) {
          console.log(`  空数组: ${m.file}`);
          continue;
        }

        // 检查表当前数据量 (每次用 SAVEPOINT 隔离, 表不存在不影响后续)
        let existingCount;
        await client.query('SAVEPOINT sp_count');
        try {
          const r = await client.query(`SELECT COUNT(*)::int AS c FROM ${m.table}`);
          existingCount = r.rows[0].c;
          await client.query('RELEASE SAVEPOINT sp_count');
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT sp_count');
          await client.query('RELEASE SAVEPOINT sp_count');
          console.error(`❌ 表不存在或不可访问: ${m.table} — ${e.message}`);
          stats.errors++;
          continue;
        }

        if (existingCount > 0 && !force) {
          console.log(`⏭️  ${m.table} 已有 ${existingCount} 行, 跳过(用 --force 强制导入)`);
          stats.skipped += rows.length;
          continue;
        }

        const columns = await getTableColumns(m.table);

        let inserted = 0, errs = 0;
        for (const row of rows) {
          if (dryRun) { inserted++; continue; }
          // 每行一个 SAVEPOINT: 单行失败不污染整个事务
          await client.query('SAVEPOINT sp_row');
          try {
            const id = await insertRow(client, m.table, columns, row);
            await client.query('RELEASE SAVEPOINT sp_row');
            if (id !== null) inserted++;
          } catch (e) {
            await client.query('ROLLBACK TO SAVEPOINT sp_row');
            await client.query('RELEASE SAVEPOINT sp_row');
            errs++;
            console.error(`  ❌ 插入失败 (${m.table} id=${row.id ?? '?'}):`, e.message);
          }
        }

        console.log(`  ✅ ${m.table}: ${inserted}/${rows.length} 行${errs > 0 ? ` (错误 ${errs})` : ''}`);
        stats.total    += rows.length;
        stats.inserted += inserted;
        stats.errors   += errs;
        stats.tables++;
      }

      if (dryRun) {
        rollbackSentinel = true;
        throw new Error('DRY_RUN_ROLLBACK');
      }
    });
  } catch (e) {
    if (rollbackSentinel && e.message === 'DRY_RUN_ROLLBACK') {
      console.log('\n🔍 干跑完成, 事务已回滚, 数据未提交');
    } else {
      console.error('\n💥 迁移失败, 事务已回滚:', e.message);
      stats.errors++;
      await closePool().catch(() => {});
      process.exit(1);
    }
  }

  console.log('\n📊 统计:');
  console.log(`  涉及表数: ${stats.tables}`);
  console.log(`  总行数:   ${stats.total}`);
  console.log(`  已${dryRun ? '模拟' : ''}插入: ${stats.inserted}`);
  console.log(`  已跳过:   ${stats.skipped}`);
  console.log(`  错误数:   ${stats.errors}`);

  await closePool();

  if (stats.errors > 0) process.exit(2);
}

main().catch(async (e) => {
  console.error('未捕获异常:', e);
  await closePool().catch(() => {});
  process.exit(1);
});
