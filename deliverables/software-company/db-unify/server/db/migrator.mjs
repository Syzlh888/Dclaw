/**
 * server/db/migrator.mjs — 自制 SQL migration 执行器
 *
 * 特性：
 *   - 无外部框架，仅依赖 pg (via ./pool.mjs)
 *   - schema_migrations 表记录已应用版本
 *   - 每个 sql 文件在单事务内执行，成功后 INSERT version
 *   - 按文件名字典序执行 (001_ / 002_ / 999_)
 *
 * 用法：
 *   npm run db:migrate                    # 命令行
 *   import { runMigrations } from './migrator.mjs'
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, withTransaction, closePool } from './pool.mjs';

// ESM 下 import.meta.url 是标准获取当前文件 URL 的方法，无需 __filename 后备
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationTable() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    VARCHAR(64) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * 执行 migrations 目录下所有未应用的 .sql 文件
 * @returns {Promise<{applied: string[], skipped: string[]}>}
 */
export async function runMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    throw new Error(`[migrate] 迁移目录不存在: ${MIGRATIONS_DIR}`);
  }
  await ensureMigrationTable();

  const { rows } = await getPool().query('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map(r => r.version));

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const appliedNow = [];
  const skipped = [];

  for (const f of files) {
    const version = f.replace(/\.sql$/i, '');
    if (applied.has(version)) {
      skipped.push(version);
      continue;
    }
    const filePath = path.join(MIGRATIONS_DIR, f);
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log(`[migrate] 应用: ${f}`);
    const t0 = Date.now();
    try {
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1)',
          [version]
        );
      });
      appliedNow.push(version);
      console.log(`[migrate]   ✓ ${version} (${Date.now() - t0}ms)`);
    } catch (err) {
      console.error(`[migrate]   ✗ ${version} 失败:`, err.message);
      throw err;
    }
  }

  console.log(
    `[migrate] 完成 — 新应用 ${appliedNow.length} 个，跳过 ${skipped.length} 个已应用`
  );
  return { applied: appliedNow, skipped };
}

// CLI 入口
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const selfPath = fileURLToPath(import.meta.url);
if (invokedPath && path.resolve(invokedPath) === path.resolve(selfPath)) {
  runMigrations()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[migrate] 迁移失败:', err);
      closePool().finally(() => process.exit(1));
    });
}
