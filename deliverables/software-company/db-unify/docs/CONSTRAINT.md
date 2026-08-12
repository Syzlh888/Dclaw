# DB-Unify（DClaw 数据钳）项目约束文档

> **文档版本**: v1.0
> **整理日期**: 2026-08-12
> **整理人**: Hermes（default profile，项目约束汇总）
> **适用范围**: 本仓库 `deliverables/software-company/db-unify/`
> **说明**: 本文档将散落在 PRD / README / ARCHITECTURE / gm-compliance / deployment / permission-design 及交付经验中的**硬约束、红线、边界与决策**汇总为单一清单，供开发、评审、交付、运维统一遵循。带 ⚠️ 为**必须遵守的红线**，带 🕐 为**已变更/演进中**的约束（引用旧文档前必读）。

---

## 1. 技术栈约束

| 类别 | 约束 | 来源 |
|------|------|------|
| 前端 | React 18 + TypeScript 5.4 + MUI 5 + Zustand 4 + Monaco Editor + Tailwind CSS 3，构建用 Vite 5 | README |
| 后端 | Node.js + Express 4，SSE 流式推送 | README / ARCHITECTURE |
| 数据库驱动 | mysql2、pg、postgres.js（Oracle/SQL Server 等走 JDBC 桥 `hgdb-bridge.mjs`） | README / ARCHITECTURE |
| 桌面端 | Electron 42 + electron-builder 26，NSIS 安装包 | README |
| 认证 | JWT（**国密改版后为 HMAC-SM3**）+ bcryptjs（兼容） | README / gm-compliance |
| 加密 | 国密 SM4-CBC+SM3-MAC（数据）、SM3-PBKDF（密码） | gm-compliance |
| 测试 | Vitest 4 + Testing Library | README |
| 运行环境 | Node.js ≥ 18，npm ≥ 9 | README |

**⚠️ 版本演进提示**：PRD/ARCHITECTURE 为 v1.0/v1.1 时代的文档，其中 **bcrypt + AES-256-GCM + JSON 文件存储** 的描述已被国密改造（v1.3+）取代，仅保留兼容读取。引用这些旧文档的加密/存储结论前，先看 §5 与 §6。

---

## 2. 业务 / 功能边界约束

| # | 约束 | 说明 | 来源 |
|---|------|------|------|
| B1 | 四层树结构固定 | 平台 → 前置库类型 → 区县 → 医院（L1→L4），MVP 固定 4 层，不自定义层级数 | PRD |
| B2 | ⚠️ 勾选逻辑 | 父节点勾选自动全选子节点；部分选中父节点显示半选（indeterminate）；计数格式 `(X/Y)` | PRD |
| B3 | SQL 模式 | 只读模式仅允许 SELECT；非只读模式纯查询（SELECT/WITH/SHOW/DESCRIBE/EXPLAIN）直接执行，**写操作（INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE）必须弹确认框** | PRD / README |
| B4 | ⚠️ 无执行超时 | **SQL 执行不限制超时**，由用户手动点『停止』取消（曾加过超时配置 UI，后被用户要求移除）——不得重新引入自动超时 | 交付决策 |
| B5 | 危险 SQL 审批 | `DELETE`/`UPDATE` 无 WHERE、`TRUNCATE`、`DROP`、`ALTER` 删列等危险 SQL：用户无 `sql:dangerous` 权限时走单条 SQL 审批流（一次性 token + SM3 hash 防篡改） | permission-design |
| B6 | 连接信息单源 | 连接参数只在 connections 单处存储，不做冗余；层级树挂载关系通过外键引用 | 交付决策 |
| B7 | 左侧菜单一致性 | 左侧菜单树仅显示**已挂载**的 hospital 连接；`/api/connections` 返回全部连接 → 巡检/列表差异属正常现象 | 交付决策 |
| B8 | 并发执行 | 默认并发数 5（PRD），支持 10 库同时执行 | PRD |
| B9 | 结果聚合前提 | 各库结果列结构必须一致（列名+类型），不一致时提示 | PRD |

---

## 3. 非功能约束

| 指标 | 要求 | 来源 |
|------|------|------|
| 数据库树加载 | ≤ 1s（50 节点） | PRD |
| 结果渲染 | 单库 ≤ 10,000 行，渲染 ≤ 2s | PRD |
| 聚合结果 | 50 库各 200 行，聚合渲染 ≤ 5s | PRD |
| SQL 编辑器 | 输入延迟 ≤ 50ms | PRD |
| 执行容错 | 单库失败不影响其他库；连接失败自动重试 1 次 | PRD |
| 结果缓存 | 执行结果存内存，会话内可反复查看（不持久化） | PRD |
| API 限流 | express-rate-limit 100 req / 15 min | ARCHITECTURE |
| 会话 | JWT 令牌，过期 7 天 | ARCHITECTURE |

---

## 4. 安全与合规约束（红线）

| # | 约束 | 说明 | 来源 |
|---|------|------|------|
| C1 | ⚠️ 国密算法 | 数据库连接密码、访问凭据必须 **SM4-CBC + SM3-MAC** 加密存储（密文前缀 `GM1:`）；密码 SM3-PBKDF（120000 迭代，`GMP1$` 前缀）；JWT 用 HMAC-SM3；审计日志 SM3 hash chain 防篡改 | gm-compliance |
| C2 | ⚠️ 密码不明文落盘 | 禁止将数据库/连接密码明文写入配置文件或磁盘；`config/db.enc` 为国密加密后的 JSON | gm-compliance / deployment |
| C3 | ⚠️ 密钥管理 | `GM_MASTER_KEY`（16 字节 SM4 主密钥）、`GM_JWT_SECRET`、`GM_PWD_PEPPER` 三把密钥分别生成，**任意泄露 = 敏感数据泄露风险**；主密钥丢失将导致全部密文不可恢复，必须离线备份（KMS/加密介质/保险柜） | deployment / gm-compliance |
| C4 | 密钥轮换 | 建议每 12 个月或运维人员变更时轮换；轮换 = 用新密钥重加密全部密文，任何一步失败会导致数据不可读 | deployment |
| C5 | 兼容旧密文 | 解密时自动识别前缀：`v1:`(AES-256-GCM)、`GM1:`(SM4)、`GMP1$`(SM3)、`$2a$/$2b$`(bcrypt) 均兼容读取；旧 bcrypt 密码用户下次登录自动升级为 GMP1 | gm-compliance |
| C6 | 敏感权限 | 64 项权限点中 3 项为敏感：`server:view_credentials`、`access_entry:view_password`、`sql:dangerous`；editor/executor/viewer 均不可执行 dangerous SQL | permission-design |
| C7 | 权限模型 | 资源级授权（角色 RBAC + project/server 资源作用域）+ 强继承（授权 project 自动展开到子树）+ SQL 三层控制；不做部门树 ABAC（过度设计） | permission-design |
| C8 | 认证门禁现状 | 🕐 权限基础设施+国密已完成；**业务路由 `requirePermission` 门禁尚未全部启用**（阶段 3 待启动）——对外交付前需确认门禁状态 | permission-design |
| C9 | 许可证 | RSA 4096 机器指纹绑定授权；当前 `BYPASS_ACTIVATION = true` 临时跳过激活，交付前需评估是否恢复 | README |
| C10 | ⚠️ 对外文档脱敏 | 涉及金额、患者信息、内部数据、真实密钥时一律脱敏 | 通用原则 |

---

## 5. 部署与运行约束

| # | 约束 | 说明 | 来源 |
|---|------|------|------|
| D1 | 部署形态 | 主推 **Web + Docker（PostgreSQL 16 + 国密）** 生产/信创形态；桌面 Electron 为 1.3.x 系列 | deployment |
| D2 | 主机要求 | Linux（UOS/Kylin/CentOS 7+/Ubuntu 22.04+）；CPU 2 核起（4 核推荐）、内存 4G 起（8G 推荐）、磁盘 50G 起（SSD） | deployment |
| D3 | ⚠️ 端口暴露 | Web 端口 3001 对外可达；**PG 端口 5432 仅绑定 127.0.0.1**，严禁暴露公网 | deployment |
| D4 | 环境变量 | 必须设置 `GM_MASTER_KEY` / `GM_JWT_SECRET` / `GM_PWD_PEPPER` / `POSTGRES_PASSWORD`；`.env` 与 `config/db.enc` 必须排除出版本控制 | deployment |
| D5 | ⚠️ 备份 | 每日全量 + 每周异地；`.env` + `config/db.enc` + 密钥同时归档；`docker compose down` 正常停机（`-v` 会删数据卷） | deployment |
| D6 | 信创/国密审计 | 若需国密合规审计：宿主机开启系统时间同步（chronyd/ntpd）；交付级别 L1 算法合规已达成，L2/L3 演进路径见 gm-compliance | deployment / gm-compliance |
| D7 | 反向代理 | 生产强制 HTTPS + HSTS | deployment |
| D8 | 数据目录 | 开发环境业务数据以 JSON 文件存于 `data/`（connections/tree/history/scripts/users 等）；生产 Web 形态为 PostgreSQL | ARCHITECTURE / 实际目录 |

---

## 6. 数据模型 / 存储约束

| 约束 | 说明 | 来源 |
|------|------|------|
| ⚠️ 连接参数单源 | 连接参数只在 connections 存一份（约 202 条）；hospitals 表（约 90 条）只存 `connection_id` 外键引用表达树挂载关系，**不存连接参数、无冗余** | 交付决策 / 实际 data/ |
| 树挂载 | hospitals 通过外键挂在四层树下；左侧菜单只显示已挂载连接 | 交付决策 |
| 权限 10 集合 | users/roles/rolePermissions/userRoles/resourceGrants/temporaryGrants/sqlApprovalRequests/sqlApproverConfig/auditLogs/authSessions | permission-design |
| 存储形态演进 | 🕐 文档并存 JSON 文件（开发）与 PostgreSQL（生产 Docker）；改动数据层前先确认当前形态 | 实际目录 / deployment |

---

## 7. 演进中的约束 / 历史决策（引用旧文档前必读）

| 旧文档说法 | 当前状态 | 影响 |
|-----------|----------|------|
| 密码 bcrypt、数据 AES-256-GCM | 已升级为国密 SM3/SM4（兼容读取旧值） | 加密相关代码必须用 `gm-cipher`，勿回退旧方案 |
| 存储为 JSON 文件 | 生产 Web 已迁 PostgreSQL，开发仍为 JSON | 按部署形态选择 |
| 有自动超时配置 | 已移除，改为手动『停止』 | 不得重引入自动超时 |
| connections 冗余存于多表 | 已收敛为单源 + 外键 | 不得复制连接参数 |
| 激活码强制 | 当前 `BYPASS_ACTIVATION=true` 跳过 | 交付前评估 |
| `requirePermission` 门禁 | 阶段 3 未完成，业务路由未全部接入 | 权限约束尚未全量生效 |

---

## 8. 需注意的交叉引用

- 约束与既有文档关系：本文档是**索引/汇总**，各约束的完整细节仍以源文档为准：
  - 功能/非功能 → `PRD.md`
  - 架构 → `ARCHITECTURE.md`
  - 国密合规 → `docs/gm-compliance.md`
  - 权限 → `docs/permission-design.md`
  - 部署 → `docs/deployment.md`、`docs/SERVER-DEPLOYMENT.md`
  - 版本变更 → `CHANGELOG.md`
- 若新增/修改硬约束，应同步更新源文档并在 `CHANGELOG.md` 登记（遵循 `docs/CHANGE-LOG-GUIDE.md` 约定）。
