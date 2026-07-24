/**
 * 系统配置 API（二次验证密码）
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { getAll, insert, update, remove } from '../database.mjs';

const router = Router();

async function getConfig() {
  const configs = await getAll('systemConfig');
  return configs.length > 0 ? configs[0] : {};
}

/**
 * 读取系统配置项(带默认值)。
 * 已知默认值:
 *   - auth.mode: 'single'  (登录模式: single | multi)
 */
export function getSystemConfig(key, defaultValue) {
  const cfg = getConfig();
  const DEFAULTS = {
    'auth.mode': 'single',
  };
  const fallback = defaultValue !== undefined ? defaultValue : DEFAULTS[key];
  if (cfg == null) return fallback;
  // 支持点号 key 直存,或作为对象字段
  if (Object.prototype.hasOwnProperty.call(cfg, key) && cfg[key] !== undefined && cfg[key] !== null) {
    return cfg[key];
  }
  return fallback;
}

async function setConfig(partial) {
  const configs = await getAll('systemConfig');
  if (configs.length > 0) {
    const updated = { ...configs[0], ...partial, updated_at: new Date().toISOString() };
    await update('systemConfig', configs[0].id, partial);
    return updated;
  }
  const newConfig = { id: 'default', ...partial, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await insert('systemConfig', newConfig);
  return newConfig;
}

router.get('/config', (_req, res) => {
  const config = getConfig();
  res.json({ hasSecondaryPassword: !!config.secondary_password_hash });
});

router.put('/config/secondary-password', async (req, res) => {
  const { password, oldPassword } = req.body;
  if (!password) {
    return res.status(400).json({ error: '请输入密码' });
  }

  const config = getConfig();
  // 如果已有密码，需要验证旧密码
  if (config.secondary_password_hash) {
    if (!oldPassword) {
      return res.status(400).json({ error: '请输入当前密码以验证身份' });
    }
    const match = await bcrypt.compare(oldPassword, config.secondary_password_hash);
    if (!match) {
      return res.status(401).json({ error: '当前密码错误' });
    }
  }

  const hash = await bcrypt.hash(password, 10);
  setConfig({ secondary_password_hash: hash });
  res.json({ success: true });
});

router.post('/verify-secondary-password', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '请提供二次验证密码' });
  const config = getConfig();
  if (!config.secondary_password_hash) {
    return res.status(400).json({ error: '尚未设置二次验证密码' });
  }
  const match = await bcrypt.compare(password, config.secondary_password_hash);
  if (!match) return res.status(401).json({ error: '二次验证密码错误' });
  res.json({ success: true });
});

// ===== OS 字典 =====
router.get('/os-dict', (_req, res) => {
  const config = getConfig();
  const raw = config.os_list ? JSON.parse(config.os_list) : [];
  // 兼容旧数据（纯字符串数组）
  const osList = raw.map(item => typeof item === 'string' ? { name: item, shortName: '' } : item);
  res.json({ osList });
});

router.put('/os-dict', (req, res) => {
  const { osList } = req.body;
  if (!Array.isArray(osList)) return res.status(400).json({ error: 'osList 必须是数组' });
  const sanitized = osList.map(item => ({ name: item.name || '', shortName: item.shortName || '' })).filter(item => item.name);
  setConfig({ os_list: JSON.stringify(sanitized) });
  res.json({ success: true });
});

// ===== 服务器位置字典 =====
router.get('/server-location-dict', (_req, res) => {
  const config = getConfig();
  const raw = config.server_location_list ? JSON.parse(config.server_location_list) : [];
  // 兼容旧数据（纯字符串数组）
  const list = raw.map(item => typeof item === 'string' ? { name: item, shortName: '' } : item);
  res.json({ list });
});

router.put('/server-location-dict', (req, res) => {
  const { list } = req.body;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'list 必须是数组' });
  const sanitized = list.map(item => ({ name: item.name || '', shortName: item.shortName || '' })).filter(item => item.name);
  setConfig({ server_location_list: JSON.stringify(sanitized) });
  res.json({ success: true });
});

// ===== 字典引用检查 =====
router.post('/check-dict-usage', async (req, res) => {
  const { type, name } = req.body;
  if (!type || !name) return res.status(400).json({ error: '缺少 type 或 name 参数' });
  const servers = await getAll('servers');
  let usingServers = [];
  if (type === 'os') {
    usingServers = servers.filter(s => s.os === name);
  } else if (type === 'serverLocation') {
    usingServers = servers.filter(s => s.server_location === name);
  } else {
    return res.status(400).json({ error: '无效的 type 参数' });
  }
  res.json({
    inUse: usingServers.length > 0,
    count: usingServers.length,
    serverNames: usingServers.slice(0, 5).map(s => s.name),
  });
});

export default router;
