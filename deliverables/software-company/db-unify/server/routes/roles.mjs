import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove, query } from '../database.mjs';
import { invalidateUserCache } from '../permissions/compute.mjs';
import { isValidPermission } from '../permissions/registry.mjs';

const router = Router();

async function getRolePermissionCodes(roleId) {
  return (await query('rolePermissions', rp => rp.role_id === roleId)).map(rp => rp.permission_code);
}

router.get('/', async (req, res) => {
  const roles = (await getAll('roles')).map(r => ({
    ...r,
    permissions: getRolePermissionCodes(r.id),
  }));
  res.json({ roles });
});

router.get('/:id', async (req, res) => {
  const r = await getById('roles', req.params.id);
  if (!r) return res.status(404).json({ error: '角色不存在' });
  res.json({ role: { ...r, permissions: getRolePermissionCodes(r.id) } });
});

router.post('/', async (req, res) => {
  const { code, name, description, permissions = [] } = req.body || {};
  if (!code || !name) return res.status(400).json({ error: 'code 和 name 不能为空' });
  if (await query('roles', r => r.code === code).length > 0) return res.status(409).json({ error: '角色 code 已存在' });

  const id = nanoid(8);
  await insert('roles', {
    id, code, name,
    description: description || '',
    is_system: 0,
    created_at: new Date().toISOString(),
  });

  const valid = permissions.filter(isValidPermission);
  for (const code of valid) {
    await insert('rolePermissions', {
      id: nanoid(8), role_id: id, permission_code: code,
    });
  }

  const created = await getById('roles', id);
  res.json({ role: { ...created, permissions: valid } });
});

router.put('/:id', async (req, res) => {
  const r = await getById('roles', req.params.id);
  if (!r) return res.status(404).json({ error: '角色不存在' });
  const { name, description } = req.body || {};
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (description !== undefined) patch.description = description;
  await update('roles', r.id, patch);
  const updated = await getById('roles', r.id);
  const permCodes = await getRolePermissionCodes(r.id);
  res.json({ role: { ...updated, permissions: permCodes } });
});

router.delete('/:id', async (req, res) => {
  const r = await getById('roles', req.params.id);
  if (!r) return res.status(404).json({ error: '角色不存在' });
  if (r.is_system) return res.status(403).json({ error: '预置角色不可删除' });

  // 删除角色的权限关联和用户关联
  const perms = await query('rolePermissions', rp => rp.role_id === r.id);
  for (const p of perms) await remove('rolePermissions', p.id);
  const links = await query('userRoles', ur => ur.role_id === r.id);
  for (const l of links) {
    invalidateUserCache(l.user_id);
    await remove('userRoles', l.id);
  }
  await remove('roles', r.id);
  res.json({ ok: true });
});

/** PUT /api/roles/:id/permissions — 重置权限矩阵 */
router.put('/:id/permissions', async (req, res) => {
  const r = await getById('roles', req.params.id);
  if (!r) return res.status(404).json({ error: '角色不存在' });
  const { permissions = [] } = req.body || {};
  const valid = permissions.filter(isValidPermission);

  // 清空后重写
  const existing = await query('rolePermissions', rp => rp.role_id === r.id);
  for (const rp of existing) await remove('rolePermissions', rp.id);
  for (const code of valid) {
    await insert('rolePermissions', {
      id: nanoid(8), role_id: r.id, permission_code: code,
    });
  }

  // 失效所有关联用户的缓存
  const affected = await query('userRoles', ur => ur.role_id === r.id);
  for (const link of affected) invalidateUserCache(link.user_id);

  res.json({ role: { ...r, permissions: valid } });
});

export default router;
