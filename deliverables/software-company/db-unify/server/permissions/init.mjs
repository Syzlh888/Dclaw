// DClaw 权限系统首次启动初始化
// 若 users 集合为空,则创建预置角色 + 默认管理员账号 admin/admin123

import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { getAll, insert } from '../database.mjs';
import { PRESET_ROLES } from './preset-roles.mjs';

export async function initAuthDefaults() {
  const users = await getAll('users');
  if (users && users.length > 0) {
    return { alreadyInitialized: true };
  }
  console.log('[Auth] 首次启动,初始化权限系统...');

  // 1. 创建预置角色 + 角色权限
  const roleIdMap = {};
  for (const preset of PRESET_ROLES) {
    const roleId = nanoid(8);
    roleIdMap[preset.code] = roleId;
    await insert('roles', {
      id: roleId,
      code: preset.code,
      name: preset.name,
      description: preset.description,
      is_system: preset.is_system,
      created_at: new Date().toISOString(),
    });
    for (const permCode of preset.permissions) {
      await insert('rolePermissions', {
        id: nanoid(8),
        role_id: roleId,
        permission_code: permCode,
      });
    }
  }

  // 2. 创建默认管理员账号
  const adminId = nanoid(8);
  const nowIso = new Date().toISOString();
  await insert('users', {
    id: adminId,
    username: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10),
    display_name: '系统管理员',
    email: '',
    phone: '',
    status: 'active',
    last_login_at: null,
    last_login_ip: null,
    password_updated_at: nowIso,
    created_by: 'system',
    created_at: nowIso,
  });

  // 3. 绑定 admin 用户到 admin 角色
  await insert('userRoles', {
    id: nanoid(8),
    user_id: adminId,
    role_id: roleIdMap['admin'],
    granted_by: 'system',
    granted_at: nowIso,
  });

  console.log('[Auth] 首次启动: 已创建默认管理员账号 admin / admin123, 请立即修改密码');
  return { initialized: true, adminId };
}
