/**
 * 访问管理 API（VPN / 堡垒机）
 * 支持多用户凭据、密码加密、密码历史
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { getAll, getById, insert, update, remove, query, removeWhere } from '../database.mjs';
import { encryptPassword, decryptPassword } from '../crypto.mjs';

const router = Router();

/** 脱敏输出 */
function sanitize(a) {
  let credentials = [];
  if (a.credentials && typeof a.credentials === 'string') {
    try { credentials = JSON.parse(a.credentials); } catch { credentials = []; }
  }
  // 兼容旧数据：单个用户名密码
  if (credentials.length === 0 && a.username) {
    credentials = [{ username: a.username, password: a.password || '******' }];
  }
  return {
    id: a.id,
    type: a.type || 'VPN',
    address: a.address || '',
    provider: a.provider || '',
    username: a.username || '',
    password: a.password || '******',
    credentials: credentials.map(c => ({
      username: c.username || '',
      notes: c.notes || '',
      password: c.password_encrypted || c.password ? '******' : '',
    })),
    notes: a.notes || '',
  };
}

/** 记录密码修改历史（使用 access-{id} 作为标识） */
function recordHistory(accessId, fieldName, changedBy, encryptedPassword) {
  const hId = nanoid(8);
  insert('passwordHistory', {
    id: hId,
    server_id: `access-${accessId}`,
    field_name: fieldName,
    password_encrypted: encryptedPassword || '',
    changed_at: new Date().toISOString(),
    changed_by: changedBy || 'unknown',
  });
}

// ========= 获取全部 =========
router.get('/', (_req, res) => {
  const entries = getAll('access_entries').map(sanitize);
  res.json({ entries });
});

// ========= 获取单个 =========
router.get('/:id', (req, res) => {
  const entry = getById('access_entries', req.params.id);
  if (!entry) return res.status(404).json({ error: '访问条目不存在' });
  res.json(sanitize(entry));
});

// ========= 新增 =========
router.post('/', (req, res) => {
  const { type, address, provider, username, password, credentials, notes } = req.body;
  if (!type || !address) return res.status(400).json({ error: '类型和地址不能为空' });

  const id = nanoid(8);
  // 处理多用户凭据
  const hasCreds = Array.isArray(credentials) && credentials.length > 0 && credentials.some(c => c.username?.trim());
  let credsJson = '';
  let primaryUser = username || '';
  if (hasCreds) {
    const validCreds = credentials
      .filter(c => c.username?.trim())
      .map(c => ({ username: c.username.trim(), notes: c.notes || '', password_encrypted: c.password ? encryptPassword(c.password) : '' }));
    credsJson = JSON.stringify(validCreds);
    primaryUser = validCreds[0]?.username || '';
    // 记录每个凭据的密码历史
    validCreds.filter(c => c.password_encrypted).forEach(c => {
      recordHistory(id, `access-cred-${c.username}`, req.user?.username, c.password_encrypted);
    });
  } else if (password) {
    const pwdEnc = encryptPassword(password);
    credsJson = JSON.stringify([{ username: primaryUser.trim(), notes: notes || '', password_encrypted: pwdEnc }]);
    recordHistory(id, `access-cred-${primaryUser.trim() || 'default'}`, req.user?.username, pwdEnc);
  }

  const entry = {
    id,
    type,
    address: (address || '').trim(),
    provider: (provider || '').trim(),
    username: primaryUser,
    password: '',
    credentials: credsJson,
    notes: notes || '',
  };
  insert('access_entries', entry);
  res.status(201).json(sanitize(entry));
});

// ========= 更新 =========
router.put('/:id', (req, res) => {
  const existing = getById('access_entries', req.params.id);
  if (!existing) return res.status(404).json({ error: '访问条目不存在' });

  const body = req.body;
  const partial = {};

  if (body.type !== undefined) partial.type = body.type;
  if (body.address !== undefined) partial.address = body.address.trim();
  if (body.provider !== undefined) partial.provider = body.provider.trim();
  if (body.notes !== undefined) partial.notes = body.notes;

  // 处理多用户凭据
  if (body.credentials !== undefined && Array.isArray(body.credentials)) {
    let oldCredsArr = [];
    if (existing.credentials) {
      try { oldCredsArr = JSON.parse(existing.credentials); } catch { oldCredsArr = []; }
    }
    const validCreds = body.credentials.filter(c => c.username?.trim());
    const newCreds = validCreds.map(c => {
      const oldFound = oldCredsArr.find(oc => oc.username === c.username);
      const oldPwdEncrypted = oldFound?.password_encrypted || '';
      const newPwdEncrypted = c.password && c.password !== '******' ? encryptPassword(c.password) : oldPwdEncrypted;
      // 记录密码变更历史
      if (c.password && c.password !== '******' && c.password !== oldPwdEncrypted) {
        recordHistory(req.params.id, `access-cred-${c.username.trim()}`, req.user?.username, newPwdEncrypted);
      }
      return { username: c.username.trim(), notes: c.notes || '', password_encrypted: newPwdEncrypted };
    });
    partial.credentials = JSON.stringify(newCreds);
    partial.username = newCreds[0]?.username || '';
  } else {
    // 处理旧版单密码更新
    if (body.username !== undefined) partial.username = body.username.trim();
    if (body.password !== undefined && body.password !== '******' && body.password !== '') {
      // 兼容旧数据：更新 credentials JSON
      let oldCredsArr = [];
      if (existing.credentials) {
        try { oldCredsArr = JSON.parse(existing.credentials); } catch { oldCredsArr = []; }
      }
      const pwdEnc = encryptPassword(body.password);
      const usernameToUse = body.username || existing.username || '';
      if (oldCredsArr.length > 0) {
        oldCredsArr[0] = { ...oldCredsArr[0], username: usernameToUse, password_encrypted: pwdEnc };
        partial.credentials = JSON.stringify(oldCredsArr);
      } else {
        partial.credentials = JSON.stringify([{ username: usernameToUse, notes: '', password_encrypted: pwdEnc }]);
      }
      recordHistory(req.params.id, `access-cred-${usernameToUse || 'default'}`, req.user?.username, pwdEnc);
    }
  }

  const result = update('access_entries', req.params.id, partial);
  res.json(sanitize(result));
});

// ========= 删除 =========
router.delete('/:id', (req, res) => {
  const existing = getById('access_entries', req.params.id);
  if (!existing) return res.status(404).json({ error: '访问条目不存在' });
  remove('access_entries', req.params.id);
  // 清理关联的密码历史
  removeWhere('passwordHistory', h => h.server_id === `access-${req.params.id}`);
  res.json({ success: true });
});

// ========= 解密凭据密码（需二次验证） =========
router.post('/:id/decrypt-credential', async (req, res) => {
  const { verifyPassword, credentialIndex } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入验证密码' });
  if (credentialIndex === undefined || credentialIndex === null) return res.status(400).json({ error: '请指定凭据索引' });

  const configs = getAll('systemConfig');
  const config = configs.length > 0 ? configs[0] : {};
  if (!config.secondary_password_hash) {
    return res.status(400).json({ error: '尚未设置二次验证密码，请先在系统设置中设置' });
  }

  const match = await bcrypt.compare(verifyPassword, config.secondary_password_hash);
  if (!match) return res.status(401).json({ error: '二次验证密码错误' });

  const entry = getById('access_entries', req.params.id);
  if (!entry) return res.status(404).json({ error: '访问条目不存在' });

  let credentials = [];
  if (entry.credentials && typeof entry.credentials === 'string') {
    try { credentials = JSON.parse(entry.credentials); } catch { credentials = []; }
  }
  if (!credentials[credentialIndex]) return res.status(404).json({ error: '凭据不存在' });

  const cred = credentials[credentialIndex];
  const result = { username: cred.username, password: '' };
  if (cred.password_encrypted) {
    result.password = decryptPassword(cred.password_encrypted);
  } else if (cred.password) {
    result.password = cred.password;
  }

  res.json(result);
});

// ========= 密码历史 =========
router.get('/:id/password-history', (req, res) => {
  const items = query('passwordHistory', h => h.server_id === `access-${req.params.id}`);
  items.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  res.json({ history: items });
});

// 解密密码历史（需二次验证）
router.post('/:id/password-history/decrypt', async (req, res) => {
  const { verifyPassword } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入二次验证密码' });

  const configs = getAll('systemConfig');
  const config = configs.length > 0 ? configs[0] : {};
  if (!config.secondary_password_hash) {
    return res.status(400).json({ error: '尚未设置二次验证密码' });
  }

  const match = await bcrypt.compare(verifyPassword, config.secondary_password_hash);
  if (!match) return res.status(401).json({ error: '二次验证密码错误' });

  const items = query('passwordHistory', h => h.server_id === `access-${req.params.id}`);
  items.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));

  const decrypted = items.map(item => ({
    ...item,
    password: item.password_encrypted ? decryptPassword(item.password_encrypted) : null,
    password_encrypted: undefined,
  }));

  res.json({ history: decrypted });
});

export default router;
