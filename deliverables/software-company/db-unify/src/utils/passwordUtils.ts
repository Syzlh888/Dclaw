import type { PasswordGenConfig } from '../types/server';

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';

export function generatePassword(config: PasswordGenConfig): string {
  const { length, uppercase, lowercase, numbers, symbols } = config;
  let pool = '';
  if (uppercase) pool += UPPER;
  if (lowercase) pool += LOWER;
  if (numbers) pool += DIGITS;
  if (symbols) pool += SYMBOLS;
  if (!pool) pool = LOWER + DIGITS;

  let result = '';
  const arr = new Uint32Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) {
    result += pool[arr[i] % pool.length];
  }

  // 确保至少包含每种选中的字符类型
  const ensure = (charSet: string) => {
    const arr2 = new Uint32Array(1);
    crypto.getRandomValues(arr2);
    result = result.slice(0, -1) + charSet[arr2[0] % charSet.length];
  };
  if (uppercase && !/[A-Z]/.test(result)) { result = result.slice(0, -1) + UPPER[crypto.getRandomValues(new Uint32Array(1))[0] % UPPER.length]; }
  if (lowercase && !/[a-z]/.test(result)) { result = result.slice(0, -2) + LOWER[crypto.getRandomValues(new Uint32Array(1))[0] % LOWER.length] + result.slice(-1); }
  if (numbers && !/[0-9]/.test(result)) { result = result.slice(0, -1) + DIGITS[crypto.getRandomValues(new Uint32Array(1))[0] % DIGITS.length]; }
  if (symbols && !/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(result)) { result = result.slice(0, -1) + SYMBOLS[crypto.getRandomValues(new Uint32Array(1))[0] % SYMBOLS.length]; }

  return result;
}

export function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;

  if (score <= 2) return { score, label: '弱', color: '#D32F2F' };
  if (score <= 4) return { score, label: '中', color: '#ED6C02' };
  return { score, label: '强', color: '#2E7D32' };
}

export const DEFAULT_PASSWORD_CONFIG: PasswordGenConfig = {
  length: 16,
  uppercase: true,
  lowercase: true,
  numbers: true,
  symbols: true,
};
