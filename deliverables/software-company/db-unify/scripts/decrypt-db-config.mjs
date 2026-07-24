#!/usr/bin/env node
/**
 * PG 连接配置解密验证工具（运维排查用）
 *  - 读取 DB_CONFIG_PATH 或 config/db.enc
 *  - 用 GM_MASTER_KEY 解密
 *  - 打印配置（密码字段掩码）
 *
 * 用法:
 *   GM_MASTER_KEY=<32hex> node scripts/decrypt-db-config.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { decryptGm } from '../server/crypto-gm.mjs';

console.log('\n=== DClaw PG 连接配置解密验证 ===\n');

if (!process.env.GM_MASTER_KEY) {
  console.error('❌ 请先设置 GM_MASTER_KEY 环境变量');
  process.exit(1);
}

const configPath = process.env.DB_CONFIG_PATH || path.join(process.cwd(), 'config', 'db.enc');
if (!fs.existsSync(configPath)) {
  console.error(`❌ 密文文件不存在：${configPath}`);
  console.error('   请先运行: npm run encrypt:db');
  process.exit(1);
}

const encrypted = fs.readFileSync(configPath, 'utf8').trim();
console.log(`读取文件: ${configPath}`);
console.log(`密文长度: ${encrypted.length} bytes, 前缀: ${encrypted.slice(0, 24)}...`);

const plaintext = decryptGm(encrypted);
if (plaintext === encrypted) {
  console.error('\n❌ 解密失败：GM_MASTER_KEY 不匹配 或 密文损坏');
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(plaintext);
} catch (e) {
  console.error('\n❌ 解密后不是合法 JSON:', e.message);
  console.error('原文:', plaintext);
  process.exit(1);
}

function maskPassword(pw) {
  if (!pw) return '';
  if (pw.length <= 4) return '*'.repeat(pw.length);
  return pw.slice(0, 2) + '*'.repeat(pw.length - 4) + pw.slice(-2);
}

console.log('\n✅ 解密成功，配置如下：');
console.log('   host      :', cfg.host);
console.log('   port      :', cfg.port);
console.log('   user      :', cfg.user);
console.log('   password  :', maskPassword(cfg.password), `(${cfg.password?.length ?? 0} chars)`);
console.log('   database  :', cfg.database);
console.log('   ssl       :', cfg.ssl);
console.log();
