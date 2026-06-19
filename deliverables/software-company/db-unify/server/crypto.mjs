/**
 * AES-256-GCM 密码加解密工具
 * 用于安全存储数据库连接密码
 * 
 * 密钥获取优先级：
 * 1. ENCRYPTION_KEY 环境变量（生产/Electron 桌面版通过此途径设置）
 * 2. userData 目录下的 .encryption-key 文件（桌面版持久化密钥，dev 版自动复用）
 * 3. 硬编码开发默认密钥（仅首次开发时生成数据用，与 1/2 不一致会导致密码解密失败）
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function resolveEncryptionKeyHex() {
  // 1. 环境变量（最高优先级，桌面版 Electron 主进程设置）
  if (process.env.ENCRYPTION_KEY) {
    console.log('[crypto] 使用 ENCRYPTION_KEY 环境变量');
    return process.env.ENCRYPTION_KEY;
  }

  // 2. 尝试从桌面版的持久化密钥文件中读取（确保 dev 与 desktop 共享同一密钥）
  const keyFilePath = path.join(os.homedir(), 'AppData', 'Roaming', 'db-unify', '.encryption-key');
  try {
    if (fs.existsSync(keyFilePath)) {
      const key = fs.readFileSync(keyFilePath, 'utf8').trim();
      if (key.length === 64) {
        console.log('[crypto] 复用桌面版持久化密钥');
        return key;
      }
    }
  } catch { /* 文件不存在或无权限，继续 */ }

  // 3. 开发环境回退默认密钥
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '❌ 生产环境必须设置 ENCRYPTION_KEY 环境变量！\n' +
      '   生成密钥：node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n' +
      '   然后设置：export ENCRYPTION_KEY=<生成的密钥>'
    );
  }
  console.warn('⚠️  使用开发默认密钥（与桌面版密钥不同，此前加密的密码将无法解密）');
  return 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';
}

const ENCRYPTION_KEY_HEX = resolveEncryptionKeyHex();
const ENCRYPTION_KEY = Buffer.from(ENCRYPTION_KEY_HEX, 'hex');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * 加密明文密码
 * 返回格式：iv(hex):tag(hex):ciphertext(hex)
 */
export function encryptPassword(plaintext) {
  if (!plaintext) return '';
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted}`;
}

/**
 * 解密密文密码
 * 输入格式：iv(hex):tag(hex):ciphertext(hex)
 */
export function decryptPassword(encrypted) {
  if (!encrypted || !encrypted.includes(':')) {
    // 未加密的明文，直接返回
    return encrypted || '';
  }

  try {
    const [ivHex, tagHex, ciphertext] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    // 解密失败，返回原始字符串（可能是明文）
    return encrypted;
  }
}
