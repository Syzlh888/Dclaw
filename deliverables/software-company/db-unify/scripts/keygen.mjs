/**
 * ====================================
 * DB-Unify 密钥生成器（作者专用工具）
 * ====================================
 *
 * 用法：
 *   # 生成 RSA 密钥对（首次运行）
 *   node scripts/keygen.mjs --generate-keypair
 *
 *   # 根据机器指纹生成激活码（永久）
 *   node scripts/keygen.mjs --fingerprint ABCD1234EF567890
 *
 *   # 生成有时效的激活码
 *   node scripts/keygen.mjs --fingerprint ABCD1234EF567890 --expiry 2027-12-31
 *   node scripts/keygen.mjs --fingerprint ABCD1234EF567890 --days 365
 *
 *   # 交互模式
 *   node scripts/keygen.mjs
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KEYS_DIR = path.join(__dirname, '..', 'keys');

// 确保 keys 目录存在
if (!fs.existsSync(KEYS_DIR)) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
}

const PRIVATE_KEY_PATH = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_PATH = path.join(KEYS_DIR, 'public.pem');

/**
 * 生成 RSA 4096 密钥对
 */
function generateKeypair() {
  console.log('🔑 正在生成 RSA 4096 密钥对...');

  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 4096,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  fs.writeFileSync(PUBLIC_KEY_PATH, publicKey);
  fs.writeFileSync(PRIVATE_KEY_PATH, privateKey);

  console.log('✅ 密钥对已生成！\n');
  console.log(`   公钥（可分发，内嵌到软件中）: ${PUBLIC_KEY_PATH}`);
  console.log(`   私钥（⚠️ 请妥善保管，切勿泄露！）: ${PRIVATE_KEY_PATH}\n`);
  console.log('📋 下一步：');
  console.log('   1. 将 public.pem 的内容替换到 server/license.mjs 的 PUBLIC_KEY_PEM 变量');
  console.log('   2. 将 private.pem 妥善保管，用于生成激活码');
  console.log('   3. 运行 node scripts/keygen.mjs 生成激活码\n');
}

/**
 * 加载私钥
 */
function loadPrivateKey() {
  if (!fs.existsSync(PRIVATE_KEY_PATH)) {
    console.error('❌ 未找到私钥文件！请先运行: node scripts/keygen.mjs --generate-keypair');
    process.exit(1);
  }
  return fs.readFileSync(PRIVATE_KEY_PATH, 'utf8');
}

/**
 * 根据机器指纹生成激活码
 * @param {string} fingerprint - 用户提供的机器指纹
 * @param {number|null} expiryTimestamp - 秒级 Unix 时间戳，0/null 表示永久
 * @returns {string} 激活码
 */
function generateLicense(fingerprint, expiryTimestamp) {
  const privateKey = loadPrivateKey();
  const fp = fingerprint.trim().toUpperCase();

  if (!/^[A-F0-9]{16}$/.test(fp)) {
    console.error('❌ 机器指纹格式错误，应为 16 位十六进制字符');
    console.error(`   输入: "${fp}"`);
    process.exit(1);
  }

  const expiry = expiryTimestamp && expiryTimestamp > 0 ? String(expiryTimestamp) : '0';
  // 签名格式：fingerprint|expiryTimestamp（0=永久）
  const payload = `${fp}|${expiry}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(payload);
  sign.end();

  const signature = sign.sign(
    {
      key: privateKey,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    }
  );

  // Base64 编码，按 8 字符分组便于输入
  // 激活码格式：expiryTimestamp|signature_groups
  // expiryTimestamp=0 表示永久，否则为过期时刻的 Unix 秒级时间戳
  const base64 = signature.toString('base64');
  const groups = base64.match(/.{1,8}/g) || [];
  const formatted = `${expiry}|${groups.join('-')}`;

  console.log('\n✅ 激活码已生成：\n');
  console.log('━'.repeat(60));
  console.log(`  ${formatted}`);
  console.log('━'.repeat(60));
  console.log(`\n📌 机器指纹: ${fp}`);
  if (expiry === '0') {
    console.log('📅 有效期: 永久');
  } else {
    const expDate = new Date(Number(expiry) * 1000);
    console.log(`📅 有效期至: ${expDate.toISOString().split('T')[0]} (${expDate.toLocaleDateString('zh-CN')})`);
    const daysLeft = Math.ceil((Number(expiry) * 1000 - Date.now()) / 86400000);
    console.log(`   (剩余约 ${daysLeft} 天)`);
  }
  console.log('📋 将此激活码发送给用户即可\n');

  return formatted;
}

// ============ CLI 入口 ============

const args = process.argv.slice(2);

if (args.includes('--generate-keypair') || args.includes('-g')) {
  generateKeypair();
} else if (args.includes('--fingerprint') || args.includes('-f')) {
  const idx = args.indexOf('--fingerprint') !== -1 ? args.indexOf('--fingerprint') : args.indexOf('-f');
  const fingerprint = args[idx + 1];
  if (!fingerprint) {
    console.error('❌ 请提供机器指纹: node scripts/keygen.mjs --fingerprint <指纹>');
    process.exit(1);
  }

  // 解析有效期
  let expiryTimestamp = 0; // 默认永久
  const expiryIdx = args.indexOf('--expiry');
  const daysIdx = args.indexOf('--days');

  if (expiryIdx !== -1 && args[expiryIdx + 1]) {
    const dateStr = args[expiryIdx + 1];
    const ts = Math.floor(new Date(dateStr + 'T23:59:59').getTime() / 1000);
    if (isNaN(ts) || ts <= Math.floor(Date.now() / 1000)) {
      console.error('❌ 过期日期无效或已过期: ' + dateStr);
      process.exit(1);
    }
    expiryTimestamp = ts;
  } else if (daysIdx !== -1 && args[daysIdx + 1]) {
    const days = parseInt(args[daysIdx + 1], 10);
    if (isNaN(days) || days <= 0) {
      console.error('❌ 天数无效: ' + args[daysIdx + 1]);
      process.exit(1);
    }
    expiryTimestamp = Math.floor(Date.now() / 1000) + days * 86400;
  }

  generateLicense(fingerprint, expiryTimestamp);
} else {
  // 交互模式
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🔐 DB-Unify 激活码生成器\n');
  rl.question('请输入用户的机器指纹（16位）：', (fp) => {
    if (!fp || !fp.trim()) {
      console.log('❌ 未输入指纹，已退出');
      rl.close();
      return;
    }
    rl.question('有效期天数（回车=永久）：', (daysInput) => {
      let expiry = 0;
      if (daysInput && daysInput.trim()) {
        const days = parseInt(daysInput.trim(), 10);
        if (!isNaN(days) && days > 0) {
          expiry = Math.floor(Date.now() / 1000) + days * 86400;
        }
      }
      generateLicense(fp, expiry);
      rl.close();
    });
  });
}
