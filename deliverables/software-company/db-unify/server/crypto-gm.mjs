import sm from 'sm-crypto';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const { sm4, sm3 } = sm;

/** 获取主密钥 (SM4 key hex, 32 chars = 16 bytes) */
function resolveGmMasterKey() {
  // 1. 环境变量
  if (process.env.GM_MASTER_KEY && process.env.GM_MASTER_KEY.length === 32) {
    return process.env.GM_MASTER_KEY;
  }
  // 2. 文件
  const keyDir = path.join(os.homedir(), 'AppData', 'Roaming', 'db-unify');
  const keyPath = path.join(keyDir, '.gm-master-key');
  if (fs.existsSync(keyPath)) {
    const k = fs.readFileSync(keyPath, 'utf8').trim();
    if (k.length === 32) return k;
  }
  // 3. 首次生成
  const newKey = crypto.randomBytes(16).toString('hex'); // 16 bytes = SM4 key
  fs.mkdirSync(keyDir, { recursive: true });
  try {
    fs.writeFileSync(keyPath, newKey, { mode: 0o600 });
  } catch {
    fs.writeFileSync(keyPath, newKey);
  }
  console.log('[GM] 首次生成SM4主密钥，已存于:', keyPath);
  return newKey;
}

const GM_KEY = resolveGmMasterKey();

/**
 * SM4-CBC 加密 + SM3 MAC 验证，输出格式：
 *   'GM1:iv(hex):mac(hex):ciphertext(hex)'
 * 前缀 GM1 表示国密版本1
 */
export function encryptGm(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(16).toString('hex');
  const ciphertext = sm4.encrypt(plaintext, GM_KEY, { mode: 'cbc', iv, output: 'string' });
  const mac = sm3(iv + ciphertext + GM_KEY);
  return `GM1:${iv}:${mac}:${ciphertext}`;
}

/**
 * 解密 GM1 格式，不匹配前缀的直接返回原文(兼容旧 AES/明文)
 */
export function decryptGm(encrypted) {
  if (!encrypted || typeof encrypted !== 'string') return '';
  if (!encrypted.startsWith('GM1:')) return encrypted;
  try {
    const parts = encrypted.split(':');
    if (parts.length !== 4) return encrypted;
    const [, iv, mac, ciphertext] = parts;
    const expectedMac = sm3(iv + ciphertext + GM_KEY);
    if (expectedMac !== mac) throw new Error('GM MAC 验证失败');
    return sm4.decrypt(ciphertext, GM_KEY, { mode: 'cbc', iv, output: 'string' });
  } catch (e) {
    console.error('[GM] 解密失败:', e.message);
    return encrypted;
  }
}

/** 统一入口：新数据用国密，旧数据兼容解密 */
export { encryptGm as encryptPasswordGm, decryptGm as decryptPasswordGm };

/** SM3 hash 工具函数 */
export function sm3Hash(input) {
  return sm3(input);
}
