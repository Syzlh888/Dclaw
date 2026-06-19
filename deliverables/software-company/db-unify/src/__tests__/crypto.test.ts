/**
 * 加密模块单元测试
 */
import { describe, it, expect } from 'vitest';

// 模拟 crypto 模块
const crypto = await import('node:crypto');

// 设置测试密钥
const testKey = crypto.randomBytes(32).toString('hex');
process.env.ENCRYPTION_KEY = testKey;

// 动态导入被测模块（确保环境变量已设置）
const { encryptPassword, decryptPassword } = await import('../../server/crypto.mjs');

describe('crypto.mjs', () => {
  it('应该正确加密和解密密码', () => {
    const plaintext = 'MySecretPassword123!';
    const encrypted = encryptPassword(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(encrypted.split(':')).toHaveLength(3);

    const decrypted = decryptPassword(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('每次加密应产生不同的密文', () => {
    const plaintext = 'test';
    const e1 = encryptPassword(plaintext);
    const e2 = encryptPassword(plaintext);
    expect(e1).not.toBe(e2);
  });

  it('应正确处理包含特殊字符的密码', () => {
    const plaintext = 'p@$$w0rd!汉字测试';
    const encrypted = encryptPassword(plaintext);
    const decrypted = decryptPassword(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('对空密文应返回空字符串', () => {
    expect(decryptPassword('')).toBe('');
    expect(decryptPassword(null)).toBe('');
    expect(decryptPassword(undefined)).toBe('');
  });

  it('明文（不含冒号）应原样返回', () => {
    const plaintext = 'simpletext';
    expect(decryptPassword(plaintext)).toBe(plaintext);
  });
});
