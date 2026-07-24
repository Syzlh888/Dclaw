import sm from 'sm-crypto';
import crypto from 'node:crypto';
const { sm3 } = sm;

const JWT_SECRET = process.env.GM_JWT_SECRET || process.env.JWT_SECRET || 'dclaw-gm-jwt-dev-secret';
const JWT_EXPIRES_SECONDS = 24 * 3600; // 24h

/** base64url 编码/解码 */
function b64uEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
}
function b64uDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - str.length % 4);
  return Buffer.from(str.replace(/-/g,'+').replace(/_/g,'/') + pad, 'base64').toString('utf8');
}

/**
 * HMAC-SM3 实现(RFC 2104)
 * key: 字符串; message: 字符串
 * 返回 hex 字符串
 */
function hmacSm3(key, message) {
  const blockSize = 64;
  let keyBuf = Buffer.from(key, 'utf8');
  if (keyBuf.length > blockSize) {
    keyBuf = Buffer.from(sm3(keyBuf.toString('utf8')), 'hex');
  }
  if (keyBuf.length < blockSize) {
    keyBuf = Buffer.concat([keyBuf, Buffer.alloc(blockSize - keyBuf.length)]);
  }
  const oKeyPad = Buffer.alloc(blockSize);
  const iKeyPad = Buffer.alloc(blockSize);
  for (let i = 0; i < blockSize; i++) {
    oKeyPad[i] = keyBuf[i] ^ 0x5c;
    iKeyPad[i] = keyBuf[i] ^ 0x36;
  }
  const innerHex = sm3(iKeyPad.toString('binary') + message);
  return sm3(oKeyPad.toString('binary') + Buffer.from(innerHex, 'hex').toString('binary'));
}

/**
 * 签发 JWT
 * payload: 对象，会自动加 exp
 * options.expiresIn (秒)，默认 24*3600
 * 返回字符串: header.payload.sig
 */
export function signGm(payload, options = {}) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + (options.expiresIn ?? JWT_EXPIRES_SECONDS);
  const header = { alg: 'HMAC-SM3', typ: 'JWT' };
  const finalPayload = { ...payload, iat: now, exp };
  const h = b64uEncode(JSON.stringify(header));
  const p = b64uEncode(JSON.stringify(finalPayload));
  const body = h + '.' + p;
  const sig = hmacSm3(JWT_SECRET, body);
  return body + '.' + sig;
}

/**
 * 验证 + 解析，报错: TokenExpiredError | JsonWebTokenError
 */
export function verifyGm(token) {
  if (!token || typeof token !== 'string') throw new Error('JsonWebTokenError: 无效token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('JsonWebTokenError: 格式错误');
  const [h, p, sig] = parts;
  const expected = hmacSm3(JWT_SECRET, h + '.' + p);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig,'utf8'), Buffer.from(expected,'utf8'))) {
    throw new Error('JsonWebTokenError: 签名不匹配');
  }
  const payload = JSON.parse(b64uDecode(p));
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    const err = new Error('TokenExpiredError: 已过期');
    err.name = 'TokenExpiredError';
    throw err;
  }
  return payload;
}
