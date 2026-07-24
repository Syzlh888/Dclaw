// DClaw 预置角色定义
// is_system=1 表示系统内置角色,通常禁止在 UI 中删除

import { PERMISSION_META } from './registry.mjs';

const ALL_CODES = PERMISSION_META.map(p => p.code);

// viewer 权限:所有 :read + sql:query + metadata:*
const VIEWER_CODES = PERMISSION_META
  .filter(p =>
    p.code.endsWith(':read')
    || p.code === 'sql:query'
    || p.module === 'metadata'
  )
  .map(p => p.code);

// editor 权限:排除敏感权限点和用户/角色/系统/审计模块
const EDITOR_EXCLUDED_MODULES = new Set(['user', 'role', 'system', 'audit']);
const EDITOR_CODES = PERMISSION_META
  .filter(p => !p.sensitive)
  .filter(p => !EDITOR_EXCLUDED_MODULES.has(p.module))
  .map(p => p.code);

// executor 权限:viewer + 写入/DDL/执行/SQL 审批提交
const EXECUTOR_EXTRA = [
  'sql:write',
  'sql:ddl',
  'template:execute',
  'script:execute',
  'sql_approval:submit',
];
const EXECUTOR_CODES = Array.from(new Set([...VIEWER_CODES, ...EXECUTOR_EXTRA]));

export const PRESET_ROLES = Object.freeze([
  {
    code: 'admin',
    name: '系统管理员',
    description: '拥有所有权限,包括敏感操作与用户/角色管理',
    is_system: 1,
    permissions: ALL_CODES,
  },
  {
    code: 'editor',
    name: '编辑者',
    description: '可管理业务对象,但不含用户/角色/系统/审计管理及敏感操作',
    is_system: 1,
    permissions: EDITOR_CODES,
  },
  {
    code: 'viewer',
    name: '只读用户',
    description: '仅可查看资源、查询 SQL 及浏览元数据',
    is_system: 1,
    permissions: VIEWER_CODES,
  },
  {
    code: 'executor',
    name: '执行者',
    description: '在只读用户基础上增加 SQL 写入/DDL、模板与脚本执行、SQL 审批提交',
    is_system: 1,
    permissions: EXECUTOR_CODES,
  },
]);

/** 根据 code 获取预置角色定义 */
export function getPresetRole(code) {
  return PRESET_ROLES.find(r => r.code === code);
}
