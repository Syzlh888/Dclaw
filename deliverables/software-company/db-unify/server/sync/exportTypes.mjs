/** 导出历史表的运行时初始化和 CRUD。 */
import { randomUUID } from 'node:crypto';
import { query } from '../db/pool.mjs';

let ready;

export async function initExportHistory() {
  if (!ready) {
    ready = (async () => {
      // gen_random_uuid 在 PostgreSQL 13+ 的 pgcrypto 扩展中提供。
      await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      await query(`
        CREATE TABLE IF NOT EXISTS export_history (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id VARCHAR(100) NOT NULL,
          source_conn VARCHAR(100) NOT NULL,
          source_table VARCHAR(200),
          source_sql TEXT,
          target_type VARCHAR(20) NOT NULL,
          target_format VARCHAR(20),
          target_path TEXT,
          target_conn VARCHAR(100),
          target_table VARCHAR(200),
          total_rows INTEGER,
          file_size BIGINT,
          duration_ms INTEGER,
          status VARCHAR(20),
          errors JSONB DEFAULT '[]',
          ip VARCHAR(45),
          timestamp TIMESTAMP NOT NULL DEFAULT NOW()
        )
      `);
      await query('CREATE INDEX IF NOT EXISTS idx_export_history_user_id ON export_history(user_id)');
      await query('CREATE INDEX IF NOT EXISTS idx_export_history_timestamp ON export_history(timestamp DESC)');
    })().catch((error) => { ready = undefined; throw error; });
  }
  return ready;
}

export async function createExportHistory(record) {
  await initExportHistory();
  const r = await query(`
    INSERT INTO export_history
      (id, user_id, source_conn, source_table, source_sql, target_type, target_format,
       target_path, target_conn, target_table, total_rows, file_size, duration_ms, status, errors, ip)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16)
    RETURNING *
  `, [
    record.id || randomUUID(), record.userId || 'local', record.sourceConn || 'unknown', record.sourceTable || null,
    record.sourceSql || null, record.targetType || 'file', record.targetFormat || null, record.targetPath || null,
    record.targetConn || null, record.targetTable || null, record.totalRows ?? null, record.fileSize ?? null,
    record.durationMs ?? null, record.status || 'running', JSON.stringify(record.errors || []), record.ip || null,
  ]);
  return r.rows[0];
}

const UPDATABLE = new Map([
  ['totalRows', 'total_rows'], ['fileSize', 'file_size'], ['durationMs', 'duration_ms'], ['status', 'status'], ['errors', 'errors'],
]);
export async function updateExportHistory(id, patch = {}) {
  await initExportHistory();
  const sets = [];
  const values = [];
  let i = 1;
  for (const [key, column] of UPDATABLE) {
    if (patch[key] !== undefined) {
      sets.push(`"${column}" = $${i}${key === 'errors' ? '::jsonb' : ''}`);
      values.push(key === 'errors' ? JSON.stringify(patch[key] || []) : patch[key]);
      i += 1;
    }
  }
  if (!sets.length) return null;
  values.push(id);
  const r = await query(`UPDATE export_history SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, values);
  return r.rows[0] || null;
}

export async function listExportHistory({ userId, limit = 50, offset = 0 } = {}) {
  await initExportHistory();
  const safeLimit = Math.min(Math.max(1, Number(limit) || 50), 200);
  const safeOffset = Math.max(0, Number(offset) || 0);
  const values = [];
  let where = '';
  if (userId && userId !== 'admin') { values.push(userId); where = 'WHERE user_id = $1'; }
  values.push(safeLimit, safeOffset);
  const limitParam = `$${values.length - 1}`;
  const offsetParam = `$${values.length}`;
  const r = await query(`SELECT * FROM export_history ${where} ORDER BY timestamp DESC LIMIT ${limitParam} OFFSET ${offsetParam}`, values);
  return r.rows;
}

export default { initExportHistory, createExportHistory, updateExportHistory, listExportHistory };
