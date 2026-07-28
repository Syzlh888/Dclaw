import fs from 'node:fs';
import zlib from 'node:zlib';
import { Pool } from 'pg';
import { loadDbConfig } from './server/db/config-loader.mjs';

const cfg = loadDbConfig();
const pool = new Pool({
  host: cfg.host, port: cfg.port, user: cfg.user,
  password: cfg.password, database: cfg.database,
});

const filePath = process.argv[2] || '/tmp/dclaw-backup-2026-07-21T08-41-17.dclaw';

async function main() {
  const raw = fs.readFileSync(filePath);
  const json = JSON.parse(zlib.gunzipSync(raw).toString('utf8'));
  const files = json.dataFiles || {};
  const entries = Object.entries(files);
  console.log(`备份文件包含 ${entries.length} 个数据集合`);
  
  for (const [fileName, records] of entries) {
    const tableName = fileName.replace(/\.json$/, '');
    if (!Array.isArray(records) || records.length === 0) continue;
    let ok = 0, fail = 0;
    for (const rec of records) {
      const keys = Object.keys(rec);
      const values = keys.map(k => rec[k]);
      const placeholders = keys.map((_, i) => `$${i + 1}`);
      const sql = `INSERT INTO ${tableName} (${keys.join(',')}) VALUES (${placeholders.join(',')}) ON CONFLICT DO NOTHING`;
      try { await pool.query(sql, values); ok++; } catch (e) { fail++; }
    }
    console.log(`  ${tableName}: ${ok} 成功, ${fail} 失败`);
  }
  console.log('✅ 导入完成');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
