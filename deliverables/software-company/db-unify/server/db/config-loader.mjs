/**
 * PG 连接配置加载器
 * - 生产：解密 DB_CONFIG_PATH (config/db.enc) 使用 GM_MASTER_KEY
 * - 开发：DB_CONFIG_PATH 不存在且 NODE_ENV != production 时，回退到 DB_HOST/... 环境变量
 */
import fs from 'node:fs';
import { decryptGm } from '../crypto-gm.mjs';

let cachedConfig = null;

export function loadDbConfig() {
  if (cachedConfig) return cachedConfig;

  const configPath = process.env.DB_CONFIG_PATH || './config/db.enc';

  // 开发回退（生产环境也支持环境变量配置）
  if (!fs.existsSync(configPath)) {
    if (process.env.DB_HOST) {
      console.warn('[db-config] 无加密配置文件，使用环境变量 DB_HOST/DB_USER/... 直接连接');
      cachedConfig = {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432', 10),
        user: process.env.DB_USER || 'dclaw',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'dclaw',
        ssl: process.env.DB_SSL === '1',
      };
      return cachedConfig;
    }
    throw new Error(`❌ PG 配置文件不存在：${configPath}\n   请先运行：npm run encrypt:db`);
  }

  if (!process.env.GM_MASTER_KEY) {
    throw new Error('❌ GM_MASTER_KEY 环境变量未设置，无法解密 PG 连接配置');
  }

  const encrypted = fs.readFileSync(configPath, 'utf8').trim();
  const plaintext = decryptGm(encrypted);

  if (plaintext === encrypted) {
    throw new Error('❌ 解密失败：密钥不匹配或密文损坏');
  }

  try {
    cachedConfig = JSON.parse(plaintext);
  } catch (e) {
    throw new Error('❌ 解密后的配置不是合法 JSON: ' + e.message);
  }

  console.log('[db-config] ✅ 国密解密成功，host=' + cachedConfig.host + ' port=' + cachedConfig.port);
  return cachedConfig;
}

/** 测试用：清缓存 */
export function _resetDbConfigCache() {
  cachedConfig = null;
}
