#!/usr/bin/env node
/**
 * PG 连接配置加密工具
 *  - 交互式提示输入 host/port/user/password/database/ssl (TTY)
 *  - 非交互：stdin 每行一个字段，顺序: host, port, user, password, database, ssl(y/N)
 *  - SM4-CBC + SM3-MAC 加密（GM1: 前缀），输出到 DB_CONFIG_PATH 或 config/db.enc
 *
 * 示例（非交互）:
 *   GM_MASTER_KEY=<32hex> printf 'host\n5432\nuser\npass\ndb\nn\n' | node scripts/encrypt-db-config.mjs
 */
import readline from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import fs from 'node:fs';
import path from 'node:path';
import { encryptGm } from '../server/crypto-gm.mjs';

console.log('\n=== DClaw PG 连接配置加密工具 ===\n');

if (!process.env.GM_MASTER_KEY) {
  console.error('❌ 请先设置 GM_MASTER_KEY 环境变量');
  console.error('   生成: node -e "console.log(require(\'crypto\').randomBytes(16).toString(\'hex\'))"');
  process.exit(1);
}
if (process.env.GM_MASTER_KEY.length !== 32) {
  console.error(`❌ GM_MASTER_KEY 长度必须为 32 hex 字符 (当前 ${process.env.GM_MASTER_KEY.length})`);
  process.exit(1);
}

const isTTY = input.isTTY;
const prompts = [
  { key: 'host',     label: 'PG 主机 (默认 postgres): ', def: 'postgres' },
  { key: 'port',     label: '端口 (默认 5432): ',         def: '5432' },
  { key: 'user',     label: '用户名 (默认 dclaw): ',      def: 'dclaw' },
  { key: 'password', label: '密码: ',                    def: '' },
  { key: 'database', label: '数据库名 (默认 dclaw): ',    def: 'dclaw' },
  { key: 'ssl',      label: '启用 SSL? (y/N): ',         def: 'n' },
];

const answers = {};

async function collect() {
  if (isTTY) {
    // TTY 交互
    const rl = readline.createInterface({ input, output });
    const ask = (q) => new Promise((res) => rl.question(q, res));
    for (const p of prompts) {
      const raw = await ask(p.label);
      answers[p.key] = raw;
    }
    rl.close();
  } else {
    // 非 TTY：按行读取 stdin
    const rl = readline.createInterface({ input, terminal: false });
    const lines = [];
    for await (const line of rl) {
      lines.push(line);
      if (lines.length >= prompts.length) break;
    }
    prompts.forEach((p, i) => {
      const line = lines[i] ?? '';
      // 打印提示 + 回显，便于日志确认
      output.write(p.label + (p.key === 'password' ? '***\n' : line + '\n'));
      answers[p.key] = line;
    });
  }
}

await collect();

const config = {
  host: (answers.host || '').trim() || 'postgres',
  port: parseInt((answers.port || '').trim() || '5432', 10),
  user: (answers.user || '').trim() || 'dclaw',
  password: answers.password || '',
  database: (answers.database || '').trim() || 'dclaw',
  ssl: (answers.ssl || '').trim().toLowerCase() === 'y',
};

if (!config.password) {
  console.error('\n❌ 密码不能为空');
  process.exit(1);
}
if (!Number.isFinite(config.port) || config.port <= 0 || config.port > 65535) {
  console.error('\n❌ 端口非法: ' + answers.port);
  process.exit(1);
}

const encrypted = encryptGm(JSON.stringify(config));
if (!encrypted.startsWith('GM1:')) {
  console.error('\n❌ 加密失败：未产生 GM1 前缀密文');
  process.exit(1);
}

const outPath = process.env.DB_CONFIG_PATH || path.join(process.cwd(), 'config', 'db.enc');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, encrypted, { mode: 0o600 });

console.log(`\n✅ 已加密写入：${outPath}`);
console.log('   密文前缀: ' + encrypted.slice(0, 24) + '...');
console.log('   host=' + config.host + ' port=' + config.port + ' user=' + config.user + ' database=' + config.database + ' ssl=' + config.ssl);
console.log('\n下一步：docker-compose 中保证 GM_MASTER_KEY 环境变量相同，否则容器内无法解密。');
