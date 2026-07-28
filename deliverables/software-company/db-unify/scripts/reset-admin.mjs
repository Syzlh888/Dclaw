import { hashPassword } from '../server/gm-password.mjs';
import { Pool } from 'pg';
import { loadDbConfig } from '../server/db/config-loader.mjs';

const cfg = loadDbConfig();
const pool = new Pool({
  host: cfg.host, port: cfg.port, user: cfg.user,
  password: cfg.password, database: cfg.database,
});

async function main() {
  const hash = hashPassword('admin123');
  console.log('HASH:', hash);
  
  await pool.query("DELETE FROM users WHERE username = 'admin'");
  await pool.query(
    "INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
    ['admin-v3', 'admin', hash, '管理员', 'active']
  );
  console.log('Admin created: admin / admin123');
  await pool.end();
}
main().catch(e => { console.error(e); process.exit(1); });
