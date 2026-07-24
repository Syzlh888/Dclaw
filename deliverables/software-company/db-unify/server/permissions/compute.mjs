import { getAll, query, getById } from '../database.mjs';

// 5分钟缓存,userId -> {permissions:Set, resources:Map, expiresAt}
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached(userId) {
  const entry = cache.get(userId);
  if (entry && entry.expiresAt > Date.now()) return entry;
  return null;
}

function setCached(userId, data) {
  cache.set(userId, { ...data, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateUserCache(userId) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/**
 * 返回用户所有权限点集合 Set<string>
 * 合并来源: 用户绑定的所有角色的权限 + 生效中的临时授权(全局资源)
 */
export async function getUserPermissions(userId) {
  const cached = getCached(userId);
  if (cached?.permissions) return cached.permissions;

  const perms = new Set();

  // 1. 通过角色获取权限
  const userRoles = await query('userRoles', ur => ur.user_id === userId);
  const roleIds = userRoles.map(ur => ur.role_id);
  const rolePerms = await query('rolePermissions', rp => roleIds.includes(rp.role_id));
  rolePerms.forEach(rp => perms.add(rp.permission_code));

  // 2. 生效中的全局临时授权
  const now = new Date().toISOString();
  const tempGrants = await query('temporaryGrants', tg =>
    tg.user_id === userId &&
    (tg.resource_type === 'global' || !tg.resource_type) &&
    !tg.revoked_at &&
    tg.expires_at > now
  );
  for (const tg of tempGrants) {
    try {
      const permList = JSON.parse(tg.permissions || '[]');
      permList.forEach(p => perms.add(p));
    } catch {}
  }

  setCached(userId, { permissions: perms });
  return perms;
}

/**
 * 返回用户可访问的所有资源
 * 返回 Map: resourceType -> Set<resourceId>
 * 采用强继承: 授权 project X 自动包含其下所有 engineering/application/server
 */
export async function getAccessibleResources(userId) {
  const cached = getCached(userId);
  if (cached?.resources) return cached.resources;

  // 拿到用户和其角色的所有 grants
  const userRoles = await query('userRoles', ur => ur.user_id === userId);
  const roleIds = userRoles.map(ur => ur.role_id);

  const directGrants = await query('resourceGrants', g =>
    (g.subject_type === 'user' && g.subject_id === userId) ||
    (g.subject_type === 'role' && roleIds.includes(g.subject_id))
  );

  // 生效中的资源级临时授权
  const now = new Date().toISOString();
  const tempGrants = await query('temporaryGrants', tg =>
    tg.user_id === userId &&
    tg.resource_type && tg.resource_type !== 'global' &&
    tg.resource_id &&
    !tg.revoked_at &&
    tg.expires_at > now
  );

  const accessible = {
    project: new Map(),         // id -> access_level ('read'|'write'|'admin')
    engineering: new Map(),
    application: new Map(),
    server: new Map(),
    connection: new Map(),
  };

  const mergeLevel = (existing, next) => {
    const rank = { read: 1, write: 2, admin: 3 };
    if (!existing) return next;
    return rank[next] > rank[existing] ? next : existing;
  };

  const addAccess = (type, id, level) => {
    if (!accessible[type]) return;
    accessible[type].set(id, mergeLevel(accessible[type].get(id), level));
  };

  const engs = await getAll('engineerings');
  const apps = await getAll('applications');
  const servers = await getAll('servers');

  const expandDown = (type, id, level) => {
    addAccess(type, id, level);
    if (type === 'project') {
      engs.filter(e => e.projectId === id).forEach(e => expandDown('engineering', e.id, level));
      // servers 直接挂 projectId 的
      servers.filter(s => s.projectId === id).forEach(s => addAccess('server', s.id, level));
    } else if (type === 'engineering') {
      apps.filter(a => a.engineeringId === id).forEach(a => expandDown('application', a.id, level));
      servers.filter(s => s.engineeringId === id).forEach(s => addAccess('server', s.id, level));
    } else if (type === 'application') {
      servers.filter(s => s.applicationId === id).forEach(s => addAccess('server', s.id, level));
    }
  };

  for (const g of [...directGrants, ...tempGrants.map(t => ({
    resource_type: t.resource_type,
    resource_id: t.resource_id,
    access_level: 'write', // 临时授权默认 write,
  }))]) {
    expandDown(g.resource_type, g.resource_id, g.access_level);
  }

  setCached(userId, {
    permissions: cached?.permissions,
    resources: accessible,
  });
  return accessible;
}

/**
 * 返回用户在指定连接上的 SQL 能力位
 * 默认映射: read -> {query:true}, write -> {query,write}, admin -> {query,write,ddl}
 * dangerous 需专门配置(默认 false)
 */
export async function getSqlCapabilities(userId, connectionId) {
  // 先看是否是全局 admin
  const perms = await getUserPermissions(userId);
  const hasGlobalDdl = perms.has('sql:ddl');
  const hasGlobalWrite = perms.has('sql:write');
  const hasGlobalQuery = perms.has('sql:query');
  const hasDangerous = perms.has('sql:dangerous');

  // 如果全局 admin (拥有 sql:ddl + sql:dangerous),直接放全部
  if (hasGlobalDdl && hasGlobalWrite && hasGlobalQuery) {
    return {
      query: true,
      write: true,
      ddl: true,
      dangerous: hasDangerous,
    };
  }

  // 查该连接的资源授权
  const resources = await getAccessibleResources(userId);
  const level = resources.connection?.get(connectionId);

  const defaultCaps = {
    read:  { query: true,  write: false, ddl: false, dangerous: false },
    write: { query: true,  write: true,  ddl: false, dangerous: false },
    admin: { query: true,  write: true,  ddl: true,  dangerous: false },
  };

  const caps = level ? { ...defaultCaps[level] } : { query: false, write: false, ddl: false, dangerous: false };

  // 全局权限与连接权限取并集
  if (hasGlobalQuery) caps.query = true;
  if (hasGlobalWrite) caps.write = true;
  if (hasGlobalDdl) caps.ddl = true;
  if (hasDangerous) caps.dangerous = true;

  // 叠加连接级临时授权
  const now = new Date().toISOString();
  const tempGrants = await query('temporaryGrants', tg =>
    tg.user_id === userId &&
    tg.resource_type === 'connection' &&
    tg.resource_id === connectionId &&
    !tg.revoked_at &&
    tg.expires_at > now
  );
  for (const tg of tempGrants) {
    try {
      const permList = JSON.parse(tg.permissions || '[]');
      if (permList.includes('sql:query')) caps.query = true;
      if (permList.includes('sql:write')) caps.write = true;
      if (permList.includes('sql:ddl')) caps.ddl = true;
      if (permList.includes('sql:dangerous')) caps.dangerous = true;
    } catch {}
  }

  return caps;
}

/**
 * 检查用户是否有指定权限点
 */
export async function hasPermission(userId, ...codes) {
  const perms = await getUserPermissions(userId);
  return codes.every(c => perms.has(c));
}

/**
 * 检查用户是否可访问指定资源(read权限即可)
 */
export async function canAccessResource(userId, resourceType, resourceId) {
  const resources = await getAccessibleResources(userId);
  return resources[resourceType]?.has(resourceId) ?? false;
}
