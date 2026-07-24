import sm from 'sm-crypto';
import crypto from 'node:crypto';
const { sm3 } = sm;

const PEPPER = process.env.GM_PWD_PEPPER || 'dclaw-gm-pepper-v1';
const ITERATIONS = 120000;

function pbkdfSm3(password, salt) {
  let h = password + salt + PEPPER;
  for (let i = 0; i < ITERATIONS; i++) {
    h = sm3(h);
  }
  return h;
}

/** 返回存储字符串: 'GMP1$<iter>$<salt>$<hash>' */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = pbkdfSm3(password, salt);
  return `GMP1$${ITERATIONS}$${salt}$${hash}`;
}

/** 验证密码，兼容旧 bcrypt格式 (需 bcryptjs) */
export async function verifyPassword(password, stored) {
  if (!stored) return false;
  if (stored.startsWith('GMP1$')) {
    const parts = stored.split('$');
    if (parts.length !== 4) return false;
    const [, iterStr, salt, expectedHash] = parts;
    const iter = parseInt(iterStr, 10);
    let h = password + salt + PEPPER;
    for (let i = 0; i < iter; i++) h = sm3(h);
    return h.length === expectedHash.length &&
      crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(expectedHash, 'hex'));
  }
  // 兼容旧 bcrypt (以 $2a$ / $2b$ 开头)
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
    const bcrypt = await import('bcryptjs');
    return bcrypt.default.compareSync(password, stored);
  }
  return false;
}

/** 检查存储格式是否需要升级到国密 */
export function needsRehash(stored) {
  return !stored || !stored.startsWith('GMP1$');
}
