# DClaw 权限体系设计文档

> 版本：v1.3.0-alpha.1
> 状态：阶段 1 + 1.5 已完成（权限基础设施 + 国密加密），业务路由权限门禁尚未启用
> 关联：[CHANGELOG.md](../CHANGELOG.md) · [gm-compliance.md](./gm-compliance.md) · [CHANGE-LOG-GUIDE.md](./CHANGE-LOG-GUIDE.md)

## 目录

- [1. 总体目标](#1-总体目标)
- [2. 能力开关（四档位）](#2-能力开关四档位)
- [3. 关键决策](#3-关键决策)
- [4. 三层权限模型](#4-三层权限模型)
- [5. 数据模型（10 张表）](#5-数据模型10-张表)
- [6. 权限点清单（64 项）](#6-权限点清单64-项)
- [7. 预置角色](#7-预置角色)
- [8. 强继承机制](#8-强继承机制)
- [9. SQL 三层控制](#9-sql-三层控制)
- [10. 临时授权与单条 SQL 审批](#10-临时授权与单条-sql-审批)
- [11. 实施阶段](#11-实施阶段)
- [12. 国密合规](#12-国密合规)

---

## 1. 总体目标

DClaw（数据钳）作为跨库统一操作平台，v1.3.0 正式面向**医疗信息化交付**场景做产品化改造。业务背景：

- **多项目并行**：一家实施公司同时服务多家医院项目，每个项目下含多套工程环境（HIS / LIS / EMR），环境下再挂多个应用与数据库服务器
- **人员分层**：项目经理、实施工程师、数据库管理员、只读审查员等角色权限要求差异极大
- **合规要求**：医疗行业信创要求（国密 SM2/SM3/SM4）、数据库操作审计留痕、危险 SQL 必须审批
- **单机 + 多用户双模式**：Electron 桌面版单人使用；服务端部署时支持多用户 + 认证

**核心诉求**：**"某用户在某项目/某工程/某应用/某服务器上能做什么 SQL"** 必须可精确表达、可审计、可撤销。

## 2. 能力开关（四档位）

设计初期评估了四种权限体系强度，取舍如下：

| 档位 | 名称 | 特点 | 结论 |
|------|------|------|------|
| A | 无权限 | 全员管理员 | ❌ 不满足医疗合规 |
| B | 角色 RBAC | 只按角色控制，全局生效 | ❌ 无法做项目隔离 |
| **C** | **资源级授权** | 角色 + 资源作用域（project/server 粒度） | ✅ **本次选定** |
| D | 部门树 ABAC | 组织架构 + 属性策略 | ❌ 过度设计，交付客户不需要 |

**选定 C** 的理由：既能表达"张三只能查医院 A 的 LIS 库"这类需求，又不会引入 IAM 级别的复杂度。

## 3. 关键决策

| 议题 | 选项 | 决策 | 说明 |
|------|------|------|------|
| 桌面模式 | A 强制登录 / **B 单机跳过** / C 可选 | **B** | Electron 单机默认 `auth.mode=single`，无需登录；服务端部署自动切 `multi` |
| 继承规则 | **A 强继承** / B 弱继承 / C 显式勾选 | **A** | 授权 project 自动展开到其下全部 engineering/application/server，减少 90% 配置量 |
| 部门树 | 是 / **否** | **否** | 客户多为 10~50 人小团队，无需组织架构 |
| 密码算法 | bcrypt / **国密 SM3** | **SM3** | 医疗信创合规要求，兼容旧 bcrypt |
| 数据加密 | AES-256-GCM / **SM4-CBC+SM3-MAC** | **SM4** | 同上，兼容旧 AES 密文 |

## 4. 三层权限模型

```
┌─────────────────────────────────────────────┐
│  L1: 全局权限点（角色）                     │  ← 用户能"操作什么类型"
│      64 项 permission, 4 个预置角色         │
├─────────────────────────────────────────────┤
│  L2: 资源级授权（resource_grants）          │  ← 用户能"在哪些资源上操作"
│      project / engineering / app / server   │
├─────────────────────────────────────────────┤
│  L3: SQL 语句级分析（sql-analyzer）         │  ← 具体一条 SQL 是否放行
│      query / write / ddl / dangerous        │
└─────────────────────────────────────────────┘
```

**判定流程**：请求进入 → L1 校验角色权限点 → L2 校验目标资源是否在授权范围 → 若为 SQL 执行则 L3 分析类型 → 交叉能力位裁决。

### L1 全局权限点

由 `server/permissions/registry.mjs` 定义 64 个 `<module>:<action>` 对，例如：

```javascript
{ key: 'server:view_credentials', module: 'server', action: 'view_credentials', sensitive: true }
```

### L2 资源级授权

存储在 `resourceGrants` 集合：

```
{ userId, resourceType: 'project'|'engineering'|'application'|'server',
  resourceId, permissions: ['sql:query', 'sql:write'], grantedBy, grantedAt }
```

### L3 SQL 分析

`server/permissions/sql-analyzer.mjs` 对每条 SQL 分类：

```javascript
analyzeSql('DELETE FROM users')
// → { type: 'write', dangerous: true, patterns: ['delete_without_where'], tables: ['users'] }
```

## 5. 数据模型（10 张表）

| 集合 | 主要字段 | 用途 |
|------|----------|------|
| `users` | id, username, passwordHash, email, status | 用户账户 |
| `roles` | id, name, description, isSystem | 角色（预置 + 自定义） |
| `rolePermissions` | roleId, permissionKey | 角色→权限点 |
| `userRoles` | userId, roleId | 用户→角色 |
| `resourceGrants` | userId, resourceType, resourceId, permissions[] | **资源级授权** |
| `temporaryGrants` | userId, permissions[], expiresAt, reason | 时段临时授权 |
| `sqlApprovalRequests` | id, userId, connId, sqlHash, sql, status, approverId, oneTimeToken | 单条 SQL 审批 |
| `sqlApproverConfig` | connId, approverIds[], autoRules | 审批人配置 |
| `auditLogs` | userId, action, resourceType, resourceId, detail, at | 操作审计 |
| `authSessions` | userId, token, ip, ua, expiresAt | 登录会话 |

## 6. 权限点清单（64 项）

按模块归类，见 `server/permissions/registry.mjs` 完整定义。汇总如下：

| 模块 | 数量 | 代表权限点 |
|------|------|-----------|
| `user` | 5 | list/view/create/update/delete |
| `role` | 5 | list/view/create/update/delete |
| `permission` | 2 | grant / revoke |
| `project` | 5 | list/view/create/update/delete |
| `engineering` | 5 | 同 project |
| `application` | 5 | 同 project |
| `server` | 6 | list/view/create/update/delete/**view_credentials** ⚠ |
| `access_entry` | 5 | list/view/create/update/**view_password** ⚠ |
| `connection` | 4 | list/view/create/update |
| `sql` | 4 | query / write / ddl / **dangerous** ⚠ |
| `sql_approval` | 3 | request / approve / reject |
| `temp_grant` | 3 | request / approve / revoke |
| `audit` | 2 | view / export |
| `system_config` | 2 | view / update |
| `backup` | 3 | create / restore / delete |
| `import_export` | 2 | import / export |
| `notification` | 2 | send / view |
| `dashboard` | 1 | view |

**总计 64 项 / 18 模块**，其中 3 项标记为敏感：`server:view_credentials`、`access_entry:view_password`、`sql:dangerous`。

## 7. 预置角色

`server/permissions/preset-roles.mjs` 定义 4 个 `isSystem=1` 角色（不可删除）：

| 角色 | 权限数 | 定位 |
|------|--------|------|
| **admin** | 64 (全部) | 超级管理员，含所有敏感权限 |
| **editor** | 49 | 项目管理员：可增删改资源、可写 SQL，**不能看密码/凭据、不能执行 dangerous SQL** |
| **executor** | 21 | 实施工程师：可查看资源 + 执行 query/write SQL，不能修改元数据 |
| **viewer** | 16 | 只读审查员：只有 list/view 类权限 |

包含关系：`admin ⊃ editor ⊃ executor ⊃ viewer`（除敏感权限外）。

## 8. 强继承机制

`getAccessibleResources(userId)` 从 `resourceGrants` 展开：

```
授权 project=P1  ─────►  展开到 P1.engineering[*]
                                      └►  P1.engineering[*].application[*]
                                                                    └► P1.engineering[*].application[*].server[*]
```

**示例**：给用户 U1 授权 `project=hospital-A` + `sql:query`：

```javascript
getAccessibleResources('U1')
// 返回：{
//   project: ['hospital-A'],
//   engineering: ['his-prod', 'lis-prod', ...],       // hospital-A 下所有
//   application: ['his-app-01', 'lis-app-01', ...],
//   server: ['his-db-01', 'lis-db-01', ...],
// }
```

一次授权覆盖整棵子树，撤销 project 授权即整树失效。若需精细化，可直接对下层资源单独授权。

## 9. SQL 三层控制

SQL 执行时的判定链路：

```
1. L1 全局权限：用户角色是否有 sql:query / sql:write / sql:ddl / sql:dangerous
                 ↓
2. L2 资源授权：目标 connection 所属 server 是否在 getAccessibleResources 中
                 ↓
3. L3 语句分析：analyzeSql(sql) → type + dangerous
                 ↓
4. 能力位裁决：getSqlCapabilities(user, conn) 返回 {query, write, ddl, dangerous}
              与 analyzeSql 结果做与运算
                 ↓
5. dangerous=true 且用户无 sql:dangerous → 走 SQL 审批流程（sqlApprovalRequests）
```

**危险模式识别**（`sql-analyzer.mjs`）：

- `DELETE` / `UPDATE` 无 `WHERE`
- `TRUNCATE`
- `DROP TABLE` / `DROP DATABASE`
- `ALTER TABLE` 涉及删列
- 影响行数超阈值（后续版本）

## 10. 临时授权与单条 SQL 审批

### 时段临时授权（`temporaryGrants`）

场景：交付高峰期临时给某工程师一天的 admin 权限。

```
{ userId, permissions: ['sql:dangerous', 'server:view_credentials'],
  expiresAt: '2026-07-24T18:00:00Z', reason: '割接窗口', approvedBy }
```

`getUserPermissions()` 合并未过期的临时授权。

### 单条 SQL 审批（`sqlApprovalRequests`）

场景：用户无 `sql:dangerous` 但需执行一次 `TRUNCATE`。

```
1. 用户提交 → hash = sm3(normalizeSql(sql))
2. 生成 request { userId, connId, sqlHash, sql, status: 'pending', oneTimeToken }
3. 审批人（sqlApproverConfig 配置）approve/reject
4. approve 后返回 oneTimeToken，用户凭 token 执行**同一条 SQL**（hash 匹配）
5. 执行后 token 失效
```

一次性 token 保证审批不可复用，SM3 hash 保证 SQL 不可篡改。

## 11. 实施阶段

| 阶段 | 内容 | 工期 | 状态 |
|------|------|------|------|
| **1** | 权限基础设施（registry / roles / init / compute / analyzer） | 3 天 | ✅ 已完成 |
| **1.5** | 国密加密层（SM4 数据 / SM3 密码 / SM3-HMAC JWT） | 2 天 | ✅ 已完成 |
| 2 | 用户/角色管理 API + 登录页 + 用户管理页 | 5 天 | 进行中 |
| 3 | 现有 15 个 route 接入 `requirePermission` 中间件 | 4 天 | 待启动 |
| 4 | 资源级授权 UI（授权矩阵、树形选择器） | 4 天 | - |
| 5 | 桌面模式首启向导 + 单机/多用户切换 | 2 天 | - |
| 6 | SQL 审批流 + 临时授权工作台 | 4 天 | - |
| 7 | 审计日志 UI + 导出 + 交付验收清单 | 2 天 | - |

**总周期 26 天**，当前完成 5 天 (19%)。

## 12. 国密合规

详见 [docs/gm-compliance.md](./gm-compliance.md)。摘要：

- **算法**：SM4-CBC（数据）/ SM3-PBKDF（密码）/ HMAC-SM3（JWT），纯 JS `sm-crypto@0.4.0` 实现
- **密钥管理**：主密钥支持环境变量 / 本地 keystore / 后续硬件密码机（HSM）三档
- **兼容性**：`decryptGm` 遇非 `GM1:` 前缀直接回退旧 AES；`verifyPassword` 兼容 bcrypt
- **交付级别**：L1 算法合规，L2 密钥托管（HSM）预留接口

---

**变更约定**：本文档在每次涉及权限模型/数据模型/权限点新增的改动后须同步更新，并在 CHANGELOG 中登记。写入规范见 [CHANGE-LOG-GUIDE.md](./CHANGE-LOG-GUIDE.md)。
