const { Pool } = require('/app/node_modules/pg');
const crypto = require('crypto');
const p = new Pool({host:'postgres',port:5432,user:'dclaw',database:'dclaw'});

async function main() {
  // Check if admin exists
  const existing = await p.query("SELECT id FROM users WHERE username = 'admin'");
  if (existing.rows.length > 0) {
    console.log('Admin user already exists');
    await p.end();
    return;
  }
  
  // Hash password: admin123
  const salt = crypto.randomBytes(16).toString('base64');
  const hash = crypto.createHash('sha256').update('admin123' + salt).digest('hex');
  const passwordHash = salt + '.' + hash;
  const id = 'admin-' + Date.now();
  
  await p.query(
    "INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
    [id, 'admin', passwordHash, '管理员', 'active']
  );
  console.log('Admin user created: admin / admin123');
  
  const result = await p.query('SELECT id, username, display_name FROM users');
  console.log('Users:', JSON.stringify(result.rows));
  await p.end();
}
main().catch(e => { console.error(e); process.exit(1); });
