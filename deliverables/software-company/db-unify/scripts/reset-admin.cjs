const { Pool } = require('pg');
const crypto = require('crypto');
const p = new Pool({host:'postgres',port:5432,user:'dclaw',database:'dclaw'});
async function main() {
  const salt = crypto.randomBytes(16).toString('hex');
  const pwd = 'admin123';
  const iterations = 120000;
  const key = crypto.pbkdf2Sync(pwd, salt, iterations, 32, 'sha256').toString('hex');
  const passwordHash = 'GMP1$' + iterations + '$' + salt + '$' + key;
  
  await p.query("DELETE FROM users WHERE username = 'admin'");
  await p.query("INSERT INTO users (id, username, password_hash, display_name, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())",
    ['admin-v2', 'admin', passwordHash, '管理员', 'active']);
  console.log('OK admin / admin123');
  const r = await p.query("SELECT username, substring(password_hash,1,30) as pwd FROM users");
  console.log(JSON.stringify(r.rows));
  await p.end();
}
main().catch(e => { console.error(e.message); process.exit(1); });
