// DClaw 权限点注册表
// 权限点命名: <module>:<action>
// 每个权限点带 metadata: { code, module, name(中文名), sensitive }

export const PERMISSIONS = Object.freeze({
  // ── 项目类 ──
  PROJECT_READ: 'project:read',
  PROJECT_CREATE: 'project:create',
  PROJECT_UPDATE: 'project:update',
  PROJECT_DELETE: 'project:delete',
  ENGINEERING_READ: 'engineering:read',
  ENGINEERING_CREATE: 'engineering:create',
  ENGINEERING_UPDATE: 'engineering:update',
  ENGINEERING_DELETE: 'engineering:delete',
  APPLICATION_READ: 'application:read',
  APPLICATION_CREATE: 'application:create',
  APPLICATION_UPDATE: 'application:update',
  APPLICATION_DELETE: 'application:delete',

  // ── 服务器与连接 ──
  SERVER_READ: 'server:read',
  SERVER_CREATE: 'server:create',
  SERVER_UPDATE: 'server:update',
  SERVER_DELETE: 'server:delete',
  SERVER_IMPORT: 'server:import',
  SERVER_VIEW_CREDENTIALS: 'server:view_credentials',
  CONNECTION_READ: 'connection:read',
  CONNECTION_CREATE: 'connection:create',
  CONNECTION_UPDATE: 'connection:update',
  CONNECTION_DELETE: 'connection:delete',
  CONNECTION_TEST: 'connection:test',
  CONNECTION_IMPORT: 'connection:import',

  // ── SQL 执行 ──
  SQL_QUERY: 'sql:query',
  SQL_WRITE: 'sql:write',
  SQL_DDL: 'sql:ddl',
  SQL_DANGEROUS: 'sql:dangerous',

  // ── 元数据与备份 ──
  METADATA_READ: 'metadata:read',
  METADATA_VIEW_DDL: 'metadata:view_ddl',
  METADATA_EXPORT: 'metadata:export',
  BACKUP_CREATE: 'backup:create',
  BACKUP_RESTORE: 'backup:restore',
  BACKUP_DOWNLOAD: 'backup:download',

  // ── 服务信息 ──
  SERVICE_INFO_READ: 'service_info:read',
  SERVICE_INFO_WRITE: 'service_info:write',

  // ── 访问凭据 ──
  ACCESS_ENTRY_READ: 'access_entry:read',
  ACCESS_ENTRY_WRITE: 'access_entry:write',
  ACCESS_ENTRY_VIEW_PASSWORD: 'access_entry:view_password',

  // ── 模板与脚本 ──
  TEMPLATE_READ: 'template:read',
  TEMPLATE_WRITE: 'template:write',
  TEMPLATE_EXECUTE: 'template:execute',
  SCRIPT_READ: 'script:read',
  SCRIPT_WRITE: 'script:write',
  SCRIPT_EXECUTE: 'script:execute',

  // ── 用户与角色 ──
  USER_READ: 'user:read',
  USER_CREATE: 'user:create',
  USER_UPDATE: 'user:update',
  USER_DELETE: 'user:delete',
  USER_RESET_PASSWORD: 'user:reset_password',
  ROLE_READ: 'role:read',
  ROLE_MANAGE: 'role:manage',
  ROLE_GRANT_RESOURCE: 'role:grant_resource',
  SYSTEM_CONFIG_READ: 'system:config_read',
  SYSTEM_CONFIG_WRITE: 'system:config_write',

  // ── 审计 ──
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',

  // ── 临时授权与 SQL 审批 ──
  TEMP_GRANT_CREATE: 'temp_grant:create',
  TEMP_GRANT_REVOKE: 'temp_grant:revoke',
  TEMP_GRANT_VIEW_ALL: 'temp_grant:view_all',
  SQL_APPROVAL_SUBMIT: 'sql_approval:submit',
  SQL_APPROVAL_APPROVE: 'sql_approval:approve',
  SQL_APPROVAL_VIEW_ALL: 'sql_approval:view_all',
  SQL_APPROVAL_CANCEL_OTHERS: 'sql_approval:cancel_others',
});

export const MODULES = Object.freeze([
  { code: 'project',       name: '项目管理',     order: 1 },
  { code: 'engineering',   name: '工程管理',     order: 2 },
  { code: 'application',   name: '应用管理',     order: 3 },
  { code: 'server',        name: '服务器管理',   order: 4 },
  { code: 'connection',    name: '数据库连接',   order: 5 },
  { code: 'sql',           name: 'SQL执行',      order: 6 },
  { code: 'metadata',      name: '元数据',       order: 7 },
  { code: 'backup',        name: '备份还原',     order: 8 },
  { code: 'service_info',  name: '服务信息',     order: 9 },
  { code: 'access_entry',  name: '访问凭据',     order: 10 },
  { code: 'template',      name: '模板',         order: 11 },
  { code: 'script',        name: '脚本',         order: 12 },
  { code: 'user',          name: '用户管理',     order: 13 },
  { code: 'role',          name: '角色权限',     order: 14 },
  { code: 'system',        name: '系统配置',     order: 15 },
  { code: 'audit',         name: '审计日志',     order: 16 },
  { code: 'temp_grant',    name: '临时授权',     order: 17 },
  { code: 'sql_approval',  name: 'SQL审批',      order: 18 },
]);

export const PERMISSION_META = Object.freeze([
  // ── 项目类 ──
  { code: 'project:read',         module: 'project',      name: '查看项目',       sensitive: false },
  { code: 'project:create',       module: 'project',      name: '新建项目',       sensitive: false },
  { code: 'project:update',       module: 'project',      name: '编辑项目',       sensitive: false },
  { code: 'project:delete',       module: 'project',      name: '删除项目',       sensitive: false },
  { code: 'engineering:read',     module: 'engineering',  name: '查看工程',       sensitive: false },
  { code: 'engineering:create',   module: 'engineering',  name: '新建工程',       sensitive: false },
  { code: 'engineering:update',   module: 'engineering',  name: '编辑工程',       sensitive: false },
  { code: 'engineering:delete',   module: 'engineering',  name: '删除工程',       sensitive: false },
  { code: 'application:read',     module: 'application',  name: '查看应用',       sensitive: false },
  { code: 'application:create',   module: 'application',  name: '新建应用',       sensitive: false },
  { code: 'application:update',   module: 'application',  name: '编辑应用',       sensitive: false },
  { code: 'application:delete',   module: 'application',  name: '删除应用',       sensitive: false },

  // ── 服务器与连接 ──
  { code: 'server:read',              module: 'server',      name: '查看服务器',       sensitive: false },
  { code: 'server:create',            module: 'server',      name: '新建服务器',       sensitive: false },
  { code: 'server:update',            module: 'server',      name: '编辑服务器',       sensitive: false },
  { code: 'server:delete',            module: 'server',      name: '删除服务器',       sensitive: false },
  { code: 'server:import',            module: 'server',      name: '导入服务器',       sensitive: false },
  { code: 'server:view_credentials',  module: 'server',      name: '查看服务器凭据',   sensitive: true  },
  { code: 'connection:read',          module: 'connection',  name: '查看数据库连接',   sensitive: false },
  { code: 'connection:create',        module: 'connection',  name: '新建数据库连接',   sensitive: false },
  { code: 'connection:update',        module: 'connection',  name: '编辑数据库连接',   sensitive: false },
  { code: 'connection:delete',        module: 'connection',  name: '删除数据库连接',   sensitive: false },
  { code: 'connection:test',          module: 'connection',  name: '测试数据库连接',   sensitive: false },
  { code: 'connection:import',        module: 'connection',  name: '导入数据库连接',   sensitive: false },

  // ── SQL 执行 ──
  { code: 'sql:query',      module: 'sql', name: '执行 SELECT 查询',                sensitive: false },
  { code: 'sql:write',      module: 'sql', name: '执行 INSERT/UPDATE/DELETE',       sensitive: false },
  { code: 'sql:ddl',        module: 'sql', name: '执行 CREATE/ALTER/DROP',          sensitive: false },
  { code: 'sql:dangerous',  module: 'sql', name: '执行破坏性操作(DROP DB/TRUNCATE)', sensitive: true  },

  // ── 元数据与备份 ──
  { code: 'metadata:read',      module: 'metadata', name: '查看元数据',       sensitive: false },
  { code: 'metadata:view_ddl',  module: 'metadata', name: '查看对象 DDL',     sensitive: false },
  { code: 'metadata:export',    module: 'metadata', name: '导出元数据',       sensitive: false },
  { code: 'backup:create',      module: 'backup',   name: '创建备份',         sensitive: false },
  { code: 'backup:restore',     module: 'backup',   name: '还原备份',         sensitive: false },
  { code: 'backup:download',    module: 'backup',   name: '下载备份文件',     sensitive: false },

  // ── 服务信息 ──
  { code: 'service_info:read',   module: 'service_info', name: '查看服务信息', sensitive: false },
  { code: 'service_info:write',  module: 'service_info', name: '编辑服务信息', sensitive: false },

  // ── 访问凭据 ──
  { code: 'access_entry:read',           module: 'access_entry', name: '查看访问凭据',   sensitive: false },
  { code: 'access_entry:write',          module: 'access_entry', name: '编辑访问凭据',   sensitive: false },
  { code: 'access_entry:view_password',  module: 'access_entry', name: '查看凭据密码',   sensitive: true  },

  // ── 模板与脚本 ──
  { code: 'template:read',     module: 'template', name: '查看模板',   sensitive: false },
  { code: 'template:write',    module: 'template', name: '编辑模板',   sensitive: false },
  { code: 'template:execute',  module: 'template', name: '执行模板',   sensitive: false },
  { code: 'script:read',       module: 'script',   name: '查看脚本',   sensitive: false },
  { code: 'script:write',      module: 'script',   name: '编辑脚本',   sensitive: false },
  { code: 'script:execute',    module: 'script',   name: '执行脚本',   sensitive: false },

  // ── 用户与角色 ──
  { code: 'user:read',            module: 'user',   name: '查看用户',       sensitive: false },
  { code: 'user:create',          module: 'user',   name: '新建用户',       sensitive: false },
  { code: 'user:update',          module: 'user',   name: '编辑用户',       sensitive: false },
  { code: 'user:delete',          module: 'user',   name: '删除用户',       sensitive: false },
  { code: 'user:reset_password',  module: 'user',   name: '重置用户密码',   sensitive: false },
  { code: 'role:read',            module: 'role',   name: '查看角色',       sensitive: false },
  { code: 'role:manage',          module: 'role',   name: '管理角色与权限', sensitive: false },
  { code: 'role:grant_resource',  module: 'role',   name: '授予资源访问',   sensitive: false },
  { code: 'system:config_read',   module: 'system', name: '查看系统配置',   sensitive: false },
  { code: 'system:config_write',  module: 'system', name: '修改系统配置',   sensitive: false },

  // ── 审计 ──
  { code: 'audit:read',    module: 'audit', name: '查看审计日志',   sensitive: false },
  { code: 'audit:export',  module: 'audit', name: '导出审计日志',   sensitive: false },

  // ── 临时授权与 SQL 审批 ──
  { code: 'temp_grant:create',           module: 'temp_grant',    name: '发起临时授权',       sensitive: false },
  { code: 'temp_grant:revoke',           module: 'temp_grant',    name: '撤销临时授权',       sensitive: false },
  { code: 'temp_grant:view_all',         module: 'temp_grant',    name: '查看所有临时授权',   sensitive: false },
  { code: 'sql_approval:submit',         module: 'sql_approval',  name: '提交 SQL 审批',      sensitive: false },
  { code: 'sql_approval:approve',        module: 'sql_approval',  name: '审批 SQL 工单',      sensitive: false },
  { code: 'sql_approval:view_all',       module: 'sql_approval',  name: '查看所有 SQL 工单',  sensitive: false },
  { code: 'sql_approval:cancel_others',  module: 'sql_approval',  name: '取消他人 SQL 工单',  sensitive: false },
]);

// ── 索引 ──
const _codeSet = new Set(PERMISSION_META.map(p => p.code));
const _byCode = new Map(PERMISSION_META.map(p => [p.code, p]));

// ── 辅助函数 ──

/** 返回指定模块下的所有权限点(按定义顺序) */
export function getPermissionsByModule(moduleCode) {
  return PERMISSION_META.filter(p => p.module === moduleCode);
}

/** 判断某权限点是否为敏感操作 */
export function isSensitive(code) {
  const meta = _byCode.get(code);
  return !!(meta && meta.sensitive);
}

/** 判断字符串是否为合法权限点 */
export function isValidPermission(code) {
  return _codeSet.has(code);
}

/** 获取权限点元数据(未找到返回 undefined) */
export function getPermissionMeta(code) {
  return _byCode.get(code);
}

/** 所有权限点 code 列表 */
export function allPermissionCodes() {
  return PERMISSION_META.map(p => p.code);
}
