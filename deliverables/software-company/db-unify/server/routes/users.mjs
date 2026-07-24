import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove, query } from '../database.mjs';
import { hashPassword } from '../gm-password.mjs';
import { invalidateUserCache } from '../permissions/compute.mjs';

const router = Router();

function sanitize(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return { ...rest, hasPassword: !!password_hash };
}

/** 搜集用户的角色 code 列表 */
async function getUserRoleCodes(userId) {
  const links = await query('userRoles', ur => ur.user_id === userId);
  const rids = links.map(l => l.role_id);
  const roles = (await Promise.all(rids.map(rid => getById('roles', rid)))).filter(Boolean);
  return roles.map(r => r.code);
}

router.get('/', async (req, res) => {
  const list = await getAll('users');
  const users = await Promise.all(list.map(async (u) => ({
    ...sanitize(u),
    roles: await getUserRoleCodes(u.id),
  })));
  res.json({ users });
});

router.get('/:id', async (req, res) => {
  const u = await getById('users', req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  res.json({ user: { ...sanitize(u), roles: await getUserRoleCodes(u.id) } });
});

router.post('/', async (req, res) => {
  const { username, password, displayName, email, phone, roles = [] } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  if (username.length < 3) return res.status(400).json({ error: '用户名至少 3 位' });
  if (password.length < 8) return res.status(400).json({ error: '密码至少 8 位' });
  const exists = await query('users', u => u.username === username);
  if (exists.length > 0) return res.status(409).json({ error: '用户名已存在' });

  const id = nanoid(8);
  await insert('users', {
    id, username,
    password_hash: hashPassword(password),
    display_name: displayName || '',
    email: email || '', phone: phone || '',
    status: 'active',
    last_login_at: null, last_login_ip: null,
    password_updated_at: new Date().toISOString(),
    created_by: req.user?.userId || 'system',
    created_at: new Date().toISOString(),
  });

  // 绑定角色
  const validRoles = (await getAll('roles')).filter(r => roles.includes(r.code));
  for (const r of validRoles) {
    await insert('userRoles', {
      id: nanoid(8), user_id: id, role_id: r.id,
      granted_by: req.user?.userId || 'system',
      granted_at: new Date().toISOString(),
    });
  }

  const u = await getById('users', id);
  res.json({ user: { ...sanitize(u), roles: getUserRoleCodes(id) } });
});

router.put('/:id', async (req, res) => {
  const u = await getById('users', req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });

  const { displayName, email, phone, status, roles } = req.body || {};
  const patch = {};
  if (displayName !== undefined) patch.display_name = displayName;
  if (email !== undefined) patch.email = email;
  if (phone !== undefined) patch.phone = phone;
  if (status !== undefined) patch.status = status;
  patch.updated_at = new Date().toISOString();
  await update('users', u.id, patch);

  // 重新绑定角色（如存在）
  if (Array.isArray(roles)) {
    const existLinks = await query('userRoles', ur => ur.user_id === u.id);
    for (const l of existLinks) await remove('userRoles', l.id);
    const validRoles = (await getAll('roles')).filter(r => roles.includes(r.code));
    for (const r of validRoles) {
      await insert('userRoles', {
        id: nanoid(8), user_id: u.id, role_id: r.id,
        granted_by: req.user?.userId || 'system',
        granted_at: new Date().toISOString(),
      });
    }
    invalidateUserCache(u.id);
  }

  const updated = await getById('users', u.id);
  res.json({ user: { ...sanitize(updated), roles: getUserRoleCodes(u.id) } });
});

router.delete('/:id', async (req, res) => {
  const u = await getById('users', req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.username === 'admin') return res.status(403).json({ error: '不允许删除默认管理员' });

  // 同时删除用户角色关联
  const links = await query('userRoles', ur => ur.user_id === u.id);
  for (const l of links) await remove('userRoles', l.id);
  await remove('users', u.id);
  invalidateUserCache(u.id);
  res.json({ ok: true });
});

router.post('/:id/reset-password', async (req, res) => {
  const u = await getById('users', req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
  await update('users', u.id, {
    password_hash: hashPassword(newPassword),
    password_updated_at: new Date().toISOString(),
  });
  res.json({ ok: true });
});

router.post('/:id/toggle-status', async (req, res) => {
  const u = await getById('users', req.params.id);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  if (u.username === 'admin') return res.status(403).json({ error: '不允许禁用默认管理员' });
  const nextStatus = u.status === 'active' ? 'disabled' : 'active';
  await update('users', u.id, { status: nextStatus });
  invalidateUserCache(u.id);
  res.json({ ok: true, status: nextStatus });
});

export default router;
