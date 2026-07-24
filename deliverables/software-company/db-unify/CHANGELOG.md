# Changelog

## [1.4.0-alpha.1] - 2026-07-23

### 变更 - 端口调整 & 部署模式变更 (医院内网适配)

- **端口调整: 80/443 → 8080/8443** — 医院内网通常关闭 80/443，改走 8000-9000 段：
  - `docker-compose.yml` web 服务映射 `'8080:3001'`（宿主 8080 → 容器内 3001）。
  - `docs/SERVER-DEPLOYMENT.md`：端口规划表、防火墙规则 (ufw / firewalld)、
    Nginx 站点模板 (`listen 8080` / `listen 8443 ssl http2`)、访问地址样例、
    上线检查清单、附录 D 端口开放申请模板全部同步为 8080/8443。
  - HTTPS 证书章节将“企业内部 CA / 商业证书 / 自签”前置为主推方式，
    Let's Encrypt 因 80 端口不通降为 DNS-01 challenge 可选方案。
  - 新增“上线前须与医院信息科书面确认 8080/8443 放行”硬检查项。
- **部署模式变更: 空库 + pg_dump 备份还原** —
  新部署默认以空库启动（自动初始化 admin/admin123 + 4 角色 + 64 权限点 + 34 张空表），
  历史数据搬迁改由 `pg_dump --clean --if-exists` 备份 + `psql` 还原承担。
  `npm run db:import` 保留但降为可选（仅“从旧 JSON 版本首次迁移”的兜底途径），
  `docs/SERVER-DEPLOYMENT.md` 第 8 部分已重写为 8.1–8.5 五个子步骤。
- **新增备份/还原脚本**:
  - `scripts/backup-pg.sh` — 一键 pg_dump + gzip 到 `backups/dclaw-YYYYMMDD_HHMMSS.sql.gz`，
    自动清理 30 天前旧备份。
  - `scripts/restore-pg.sh` — 交互确认后 gunzip → `psql` 还原，
    支持 `.sql` / `.sql.gz` 双格式，`--force` 参数跳过确认便于脚本化。
  - `package.json` 新增 `npm run backup:pg` / `npm run restore:pg` 快捷入口。

### 修复 - D3/D4 收尾修复 (E2E 联调阻塞项)

- **`server/routes/table-mgmt.mjs`** — 修复 `wrapHandler` 被误声明为 `async function`，
  导致 `router.get('/:id/roles', wrapHandler(...))` 拿到的是 Promise 而非 handler，
  Express 启动直接抛 `Route.get() requires a callback function but got a [object Promise]`。
  移除 `async` 关键字（内部仍返回 async handler），服务器现可正常启动。
- **`server/db/migrations/001_init_schema.sql`** — `hospitals.district_id` 由 `NOT NULL` 改为 NULLABLE。
  原始 JSON 数据中有 22 家医院未挂靠区县，此前迁移会跳过这些记录（仅导入 65/87）。
- **`server/db/migrations/003_relax_hospitals_district.sql`** — 新增 migration：
  对已应用 001 的环境执行 `ALTER TABLE hospitals ALTER COLUMN district_id DROP NOT NULL`，
  幂等安全，允许旧数据库无重建平滑升级。
- **端到端联调验证通过**：docker-compose 起 PG (5433) → migrate → import (671 行 / 21 张表，
  hospitals **87/87** ✅) → 启 Node server (3099) → 全部关键接口返回 200：
  - `GET /api/health` → 200
  - `GET /api/projects` → 200 (1 项目)
  - `GET /api/roles` → 200 (5 角色)
  - `POST /api/auth/login` (admin/admin123) → 200 (返回 JWT + 完整权限列表)
- **await 覆盖审计**：全项目 grep 已确认 routes/permissions/hgdb-bridge 下所有
  `getById/getAll/query/insert/update/remove` 调用均已正确 `await`；
  `connections.mjs:188` / `roles.mjs:61` 的 `...updated` 展开均已在上游 await 展开值。
- **构建全绿**：`npm run build:server-bundle`（esbuild → scripts/server-bundle.cjs 5.7MB）、
  `npx vite build`（dist 输出成功，仅 chunk 大小警告）、`npx tsc --noEmit`（0 error）三管齐下。



### 新增 - `docs/SERVER-DEPLOYMENT.md` 一人可执行的完整服务器部署文档

- **`docs/SERVER-DEPLOYMENT.md`** — 16 章节 + 4 附录的运维交付级部署手册：
  服务器选型 / Docker 安装 (Ubuntu/CentOS/麒麟/UOS) / 代码发布 / 密钥初始化 /
  国密加密 PG 连接 / 数据库迁移 / 导入历史数据 / Web 容器启动 /
  Nginx + HTTPS / 备份恢复 / 日常运维 / 升级 / 密钥轮换 /
  15 项故障排查 / 上线检查清单 / .env & nginx.conf 模板 / 信创兼容矩阵 / 浪潮·北方健康对接

### 新增 - JSON → PostgreSQL 数据迁移脚本 (T4/D4)

- **`scripts/import-json.mjs`** — 数据迁移主脚本：
  - 33 张表映射固定顺序（字典 → 业务 → 服务器/端口 → 权限 → 审计）
  - 用 `information_schema.columns` 自省目标表列 + 数据类型
  - JSONB/JSON 列自动 `JSON.stringify`；未知字段自动汇入 `extra` 列（若存在）
  - `ON CONFLICT (id) DO NOTHING` — 幂等，重复执行 0 插入
  - 单事务 + **每行 SAVEPOINT**：单行失败不污染事务，其他行/其他表继续
  - 默认只导入空表；非空表跳过（`--force` 强制导入）
  - `--dry-run` 干跑模式，事务末尾主动 ROLLBACK
- **`scripts/backup-json.mjs`** — 归档 `data/` 到 `data.snapshots/pre-pg-migration-YYYYMMDD-HHMMSS.tgz`（git-bash 兼容：cwd 到项目根 + 相对路径）
- **package.json** — 追加 `db:import` / `db:import:dry` / `db:import:force` / `backup:json` 四个脚本
- **`docs/data-migration.md`** — 迁移手册：前置检查、备份、干跑、实迁、验证 SQL、回滚方案、常见错误表、完整集合→表映射
- **验证**（`postgres:16-alpine` 临时容器，端口 5434）：
  - 干跑：21 张表 / 671 行 / 0 错误
  - 实迁：21 张表 / 649 行插入 / 22 错误（全部为 `hospitals.district_id=NULL` 的既有脏数据违反 T2 DDL NOT NULL 约束，非脚本 bug）
  - 幂等：`--force` 重跑 → 0 插入 / 0 冲突报错
  - 默认跳过非空表：第三次执行 21 张表全部 `⏭️ 跳过`
  - JSONB：`system_config.server_location_list` 正确序列化为 JSONB 数组
  - 归档：`backup:json` 生成 2926.6 KB tgz
- **已知遗留**（转给 T2 责任人）：`hospitals.district_id NOT NULL` 与真实 JSON 数据不符（22/87 行 district_id 为 null，属"预置库"类目）。建议 T2 后续把该字段改为 NULLABLE，或在 D5 API 层补齐分类。

## [1.4.0-alpha.1] - 2026-07-23

### 新增 - PG DDL + 自制 migration 执行器 (T2)

- **`server/db/migrations/001_init_schema.sql`** — 33 张业务表 DDL（1:1 映射自 `DATA_FILES`）
  - 主键统一 `VARCHAR(20) PRIMARY KEY`（保留 nanoid 字符串 id）
  - 时间字段统一 `TIMESTAMPTZ`，默认 `NOW()`
  - 加密字段 (`password_hash` / `password_encrypted` / `credentials`) 使用 `TEXT`
  - 不使用外键，关联由应用层保证（与 JSON 时代行为一致）
  - 松散/扩展字段一律 `extra JSONB`
  - 全部使用 `CREATE TABLE IF NOT EXISTS`，可幂等重放
- **`server/db/migrations/002_indexes.sql`** — 常用索引：`user_roles(user_id,role_id)`、`role_permissions(role_id,permission_code)`、`resource_grants(subject_type,subject_id)`+`(resource_type,resource_id)`、`temporary_grants(user_id)`+`(expires_at)`、`audit_logs(created_at DESC)`+`(user_id,created_at DESC)`、`servers(project_id|engineering_id|application_id)`、`engineerings(project_id)`、`applications(engineering_id)`、`auth_sessions(user_id)`+`(expires_at)`，全部 `IF NOT EXISTS`。
- **`server/db/migrations/999_verify.sql`** — 使用 `DO $$ ... $$` 断言 33 张业务表全部存在，缺失则 `RAISE EXCEPTION` 触发事务 ROLLBACK。
- **`server/db/migrator.mjs`** — 自制 migration 执行器：`schema_migrations(version, applied_at)` 版本表自动创建；扫描 `migrations/*.sql` 按字典序执行；每个 sql 在 `withTransaction` 单事务内运行；提供 `runMigrations()` 导出 + CLI 入口。
- **package.json** — `db:migrate` 脚本从占位 echo 改为 `node server/db/migrator.mjs`。
- **验证**：以 `postgres:16-alpine` 空库 dry-run，首轮应用 3 个 migration 全部成功，`information_schema.tables` 计数 = 34（33 业务表 + `schema_migrations`），二次运行输出 `新应用 0 个，跳过 3 个` 证明幂等性。

## [1.4.0-alpha.1] - 2026-07-23

### 移除 - Electron 桌面壳（转纯 Web）

正式弃桌面版形态，项目改为纯 Web + Docker 部署，代码库大幅瘦身。

- **删除目录/文件**：`electron/`（main.mjs, preload.cjs, preload.mjs）、`electron-builder.yml`、`build/installer.nsh`、`src/components/auth/ActivationPage.tsx`、`src/components/layout/LicenseDialog.tsx`、`src/types/electron.d.ts`。
- **package.json 清理**：
  - 移除 `main` 字段（electron 主入口）；
  - 从 devDependencies 删除：`electron`、`electron-builder`、`wait-on`；
  - 从 scripts 删除：`dev:electron`、`build:electron`、`build:electron:dir`；
  - 保留 `build:server-bundle`（Docker 镜像仍需要）；
  - 版本对齐为 `1.4.0-alpha.1`。
- **前端清理**：
  - `src/App.tsx` 移除 `isElectron / electronActivated / licenseStatus / BYPASS_ACTIVATION` 全部激活相关分支，改为纯 Web 登录流：生产环境 `import.meta.env.PROD` 且未登录 → `<LoginPage/>`，开发环境走 `useAuthStore.refresh()` 兜底为 admin；
  - `src/components/layout/StatusBar.tsx` 移除许可证徽章/`LicenseDialog`，props 简化为无参组件。
- **服务端清理**：
  - `server/middleware/auth.mjs` 删除 `ELECTRON_MODE === 'true'` → 自动 `req.user={admin}` 兜底分支；
  - `server/routes/auth.mjs` 的 `/api/auth/me` 单机模式 admin 兜底改为仅 `NODE_ENV !== 'production'` 生效，生产环境必须真实登录，防止公网部署时匿名越权。
- **未改动**：`server/gm/crypto-gm.mjs` 的 Windows AppData 回退保留（Docker 中 `GM_MASTER_KEY` 环境变量优先，永远走不到该分支）；`build/icon.ico` / `icon.png` 保留（Web favicon 可用）。
- **验证**：`npm install` 后 node_modules 无 electron/electron-builder 包；`npx tsc --noEmit` 零错误；`vite build` 成功，产物 `dist/index-*.js` 2.29MB / gzip 667KB。



本版本启动 v1.4 系列，交付目标：从桌面 Electron 形态迁移至纯 Web + PostgreSQL 16 + 容器化部署，同时把 DB 连接配置强制走国密（SM4-CBC + SM3-MAC）加密流。

#### 部署编排

- `docker-compose.yml` — 双服务编排：
  - `postgres`（postgres:16-alpine）：仅绑定 `127.0.0.1:5432`，数据卷 `dclaw-pg-data`，健康检查 `pg_isready`。
  - `web`：多阶段镜像，`depends_on postgres service_healthy`，注入 `GM_MASTER_KEY / GM_JWT_SECRET / GM_PWD_PEPPER / DB_CONFIG_PATH`，只读挂载 `./config` 到 `/app/config`。
- `Dockerfile` — Stage1 `npm ci` + `npm run build` + `npm run build:server-bundle`；Stage2 `--omit=dev` prod 依赖 + 前端 dist + server-bundle；使用 `registry.npmmirror.com` 国内镜像；Asia/Shanghai 时区；health check 打 `/api/health`。
- `.env.example` — 五项：`POSTGRES_PASSWORD / GM_MASTER_KEY / GM_JWT_SECRET / GM_PWD_PEPPER / CORS_ORIGIN`，附生成命令注释。
- `.gitignore` 新增：`config/db.enc`。

#### 国密加密的连接配置

- `scripts/encrypt-db-config.mjs` — CLI：交互式提示 host/port/user/password/database/ssl → `encryptGm(JSON.stringify(cfg))` → 写入 `config/db.enc` (mode 0o600)。支持 stdin 非交互喂入。要求 `GM_MASTER_KEY` 为 32-hex。
- `scripts/decrypt-db-config.mjs` — 运维排查：解密并打印配置，密码字段掩码。
- `server/db/config-loader.mjs` — 应用启动时加载：优先解密 `DB_CONFIG_PATH`；开发模式回退到 `DB_HOST/DB_USER/...` 环境变量；生产必须走加密。带缓存与显式清空 `_resetDbConfigCache()`。
- `server/db/pool.mjs` — `pg.Pool` 封装：`getPool()` / `query()` / `withTransaction()` / `closePool()` / `pingDb()`，max=20，5s 连接超时。
- `crypto-gm.mjs` **未修改** —— 其 `GM_MASTER_KEY` 环境变量优先级已能满足容器化场景。

#### package.json

- 依赖 `pg ^8.13.0` 从 devDependencies 提升到 dependencies（生产运行需要）。
- 新增 scripts：`encrypt:db` / `decrypt:db` / `db:migrate`(占位) / `docker:up` / `docker:down` / `docker:logs`。
- 版本号 `1.2.8` → `1.4.0-alpha.1`。

#### 文档

- `docs/deployment.md` — 完整部署手册（≈200 行）：环境准备、首次部署、升级、备份恢复、密钥轮换、故障排查、安全上线清单。

#### 交付物文件清单

```
docker-compose.yml        (重写)
Dockerfile                (重写：多阶段 + 国内 npm 镜像 + prod-only 运行时)
.env.example              (重写)
.gitignore                (追加 config/db.enc)
scripts/encrypt-db-config.mjs   (新增)
scripts/decrypt-db-config.mjs   (新增)
server/db/config-loader.mjs     (新增)
server/db/pool.mjs              (新增)
docs/deployment.md              (新增)
package.json              (scripts + dependencies + version)
CHANGELOG.md              (本节)
```

#### 遗留 / 待后续任务

- `server/database.mjs` 的 JSON→PG 迁移属于 T2 任务范围，本版本不动。
- `db:migrate` 目前为占位 echo，实际 schema/迁移在 T2 提供。
- Electron 相关代码删除属于另一独立清理任务。
- 全局密钥轮换脚本 `scripts/rotate-gm-key.mjs` 待 T2 数据落地 PG 后编写。

---

## [1.3.0-alpha.1] - 2026-07-23

### 修复 (2026-07-23 补丁 · 阶段2 反馈)
- **新建用户对话框浏览器自动填充**: `UserManagementDialog` 表单增加 `autoComplete='off'` + 密码字段用 `autoComplete='new-password'`，配合隐藏 honeypot 输入 + `data-lpignore`/`data-1p-ignore`，彻底阻断 Chrome/Edge/密码管理器把当前登录信息灌进"新建用户"表单。emptyForm 各字段初始值确认为空字符串。
- **权限矩阵默认折叠、需一个个点开**: `RoleManagementDialog` 权限矩阵所有 Accordion 默认全部展开（受控 `expanded` + `expandedModules` state），顶部工具栏新增"全部展开/全部折叠"切换按钮 与 "全选/全不选" 两个总操作按钮；敏感权限点由警告黄改为**错误红**（Checkbox + 名称 + Chip 全部标红）。
- **打开个人资料提示"未登录或获取用户信息失败"**:
  - 后端 `/api/auth/me` 增加单机模式兜底：token 缺失/失效 且 `auth.mode=single` 时，自动定位 admin 用户并返回其信息 + 权限（`server/routes/auth.mjs`）。
  - 前端 `authStore.refresh()` 不再要求先有 token；`App.tsx` 启动时无条件调用一次 `refresh()`，让 authStore 填充 admin 用户信息，`ProfileDialog` 不再报"未登录"。



### 新增 - 用户与权限体系（基础设施）

本版本开启 DClaw v1.3.0 核心改造，目标：引入完整的**资源级 RBAC 权限体系**与**国密加密**，适配信创/医疗交付场景。本阶段包含阶段 1（权限底层）+ 阶段 1.5（国密层），业务路由尚未启用权限门禁。

#### 权限基础（阶段 1）

- **权限点注册表 `server/permissions/registry.mjs`**
  - 64 个权限点 / 18 个模块，按 `<module>:<action>` 命名
  - 3 个敏感标记：`server:view_credentials`、`access_entry:view_password`、`sql:dangerous`
  - 辅助函数：`getPermissionsByModule` / `isSensitive` / `isValidPermission` / `getPermissionMeta`
- **预置角色 `server/permissions/preset-roles.mjs`**
  - `admin`（64）、`editor`（49）、`executor`(21)、`viewer`（16），均为 `is_system=1`
- **数据层扩展 `server/database.mjs`** — 新增 10 个集合：
  - `users` / `roles` / `rolePermissions` / `userRoles`
  - `resourceGrants` / `temporaryGrants` / `sqlApprovalRequests` / `sqlApproverConfig`
  - `auditLogs` / `authSessions`
- **首启初始化 `server/permissions/init.mjs`**
  - `initAuthDefaults()` 幂等：首次启动自动创建 4 个预置角色 + `admin/admin123` 账号
  - 已在 `server/index.mjs` `initDefaultData()` 后自动调用
- **权限计算内核 `server/permissions/compute.mjs`**
  - `getUserPermissions(userId)` — 角色权限 + 全局临时授权合并
  - `getAccessibleResources(userId)` — **强继承展开**：授权 project X 自动展开到其下全部 engineering/application/server
  - `getSqlCapabilities(userId, connId)` — 连接级 SQL 能力位（query/write/ddl/dangerous）
  - `invalidateUserCache` — 5 分钟 TTL 内存缓存
- **SQL 分析器 `server/permissions/sql-analyzer.mjs`**
  - `analyzeSql` — 识别 query/write/ddl 类型、危险模式、提取表名
  - `normalizeSql` / `hashSql` — 去注释+空白归一化 + SM3 哈希（后续 SQL 审批使用）
- **系统配置 `getSystemConfig(key, default)`** — 新增 `auth.mode` 项（默认 `single`）

#### 国密加密层（阶段 1.5）

- **新增依赖**：`sm-crypto@0.4.0`（纯 JS、无原生编译）
- **数据加密 `server/crypto-gm.mjs`**
  - SM4-CBC + SM3-MAC 认证加密，密文格式 `GM1:iv:mac:ciphertext`
  - 主密钥优先级：`GM_MASTER_KEY` 环境变量 → `%APPDATA%/db-unify/.gm-master-key` → 首次自动生成
  - 非 `GM1:` 前缀密文直接返回（兼容旧 AES-256-GCM 数据）
- **密码 hash `server/gm-password.mjs`**
  - SM3 PBKDF 强化（120000 次迭代），存储格式 `GMP1$iter$salt$hash`
  - 内置 pepper（可通过 `GM_PWD_PEPPER` 覆盖）
  - `verifyPassword` 兼容旧 bcrypt（`$2a$` / `$2b$` / `$2y$`），支持登录后自动重 hash
  - `needsRehash` 判断存储是否需要升级
- **JWT 签名 `server/gm-jwt.mjs`**
  - HMAC-SM3（RFC 2104）自行实现，head 部分 `alg=HMAC-SM3`
  - 可通过 `GM_JWT_SECRET` 配置密钥，默认 24h 过期
  - 支持 `TokenExpiredError` / 篡改报错，签名比较用 `crypto.timingSafeEqual`
- **合规文档 `docs/gm-compliance.md`**
  - L1 算法合规声明、密钥管理、兼容性、硬件密码机接入预留、验收测试方法

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/database.mjs` | `DATA_FILES` 注册 10 个新集合 |
| `server/index.mjs` | 启动时调用 `initAuthDefaults()` |
| `server/routes/systemConfig.mjs` | 导出 `getSystemConfig(key, default)` |
| `package.json` | 新增 `sm-crypto` 依赖 |

### 新增文件

| 文件 | 作用 |
|------|------|
| `server/permissions/registry.mjs` | 64 权限点字典 |
| `server/permissions/preset-roles.mjs` | 预置角色定义 |
| `server/permissions/init.mjs` | 首启初始化 |
| `server/permissions/compute.mjs` | 权限计算 + 缓存 |
| `server/permissions/sql-analyzer.mjs` | SQL 类型分析 |
| `server/crypto-gm.mjs` | 国密数据加密 |
| `server/gm-password.mjs` | 国密密码 hash |
| `server/gm-jwt.mjs` | 国密 JWT |
| `docs/gm-compliance.md` | 国密合规交付文档 |
| `docs/permission-design.md` | 权限体系设计文档 |

### 兼容性

- 旧 AES-256-GCM 加密的连接密码/访问凭据密码可正常解密（`decryptGm` 遇非 `GM1:` 前缀直接返回，交给旧 `crypto.mjs` 处理）
- 旧 bcrypt 密码 hash 可正常验证，登录后可升级为 GMP1 格式
- Electron 单机模式仍跳过认证（阶段 5 会引入首启向导）

### 下一阶段

- 阶段 2：用户/角色管理 API + 登录页 + 用户管理页
- 阶段 3：现有 15 个 route 文件逐个接入 `requirePermission`

## [1.1.14] - 2026-07-08

### 新增功能

- **分批加载 + 可配置批次大小**：SELECT 查询自动追加 LIMIT 分页，支持无限滚动触底自动加载下一批数据
  - **默认查询限制 100 行**：前端执行 SELECT 时自动传 `pageSize=100`，后端智能追加 `LIMIT ? OFFSET ?`（不覆盖用户手动写的 LIMIT）
  - **触底自动加载（无限滚动）**：结果表滚动到距底部 20px 时自动请求下一批，加载中显示"加载中..."，已到末尾显示"已加载全部数据"
  - **批次大小输入框**：结果表工具栏新增"批次"数字输入框（范围 10~10000，默认 100），修改后下次加载生效
  - **多数据库兼容**：后端 `sqlHasLimit()` 检测 MySQL/PG/SQL Server/Oracle 的 LIMIT/TOP/FETCH/ROWNUM 语法
  - **标签页隔离**：每个 SQL 标签页独立维护 `pageSize` 和分页加载状态

### 修改文件

| 文件 | 改动 |
|------|------|
| `server/routes/execute.mjs` | 新增 `sqlHasLimit()`、`canAppendLimit()`、`appendPageLimit()` 函数；接收 `pageSize`/`offset` 参数；返回 `hasMore`/`totalLoaded` 字段 |
| `src/utils/sqlUtils.ts` | 新增 `hasSqlLimit()`、`canAppendLimit()` 导出函数 |
| `src/services/executionService.ts` | `ExecuteOptions` 新增 `pageSize`/`offset`；`ExecutionProgressEvent` 新增 `hasMore`/`totalLoaded` |
| `src/types/result.ts` | `QueryResult` 新增 `hasMore`/`totalLoaded` 字段 |
| `src/stores/editorStore.ts` | `TabExecSnapshot` 新增 `pageSize`/`resultMeta`；EditorState 新增分页状态和 setter |
| `src/stores/resultStore.ts` | 新增 `appendRows()` 方法支持追加行到已有结果 |
| `src/hooks/useExecution.ts` | 重构为 `doExecute(isLoadMore, offset)`；新增 `loadMore()` 导出；注册到 editorStore |
| `src/components/results/SingleDbView.tsx` | 新增批次大小 TextField；传递 `onScrollBottom`/`loadingMore`/`hasMore` 给 ResultTable |
| `src/components/results/ResultTable.tsx` | 新增 `onScrollBottom`/`loadingMore`/`hasMore` props；scroll 触底检测（20px阈值）；loading/完成指示器 |
| `src/__tests__/pagination.test.ts` | 35 个测试覆盖 LIMIT 检测、pageSize 范围、hasMore 判断、resultMeta 状态 |

### 技术细节

- **LIMIT 智能追加**：仅对以 SELECT/WITH 开头且不包含手动 LIMIT 的 SQL 追加分页，DDL/写操作不受影响
- **分页模式 vs 非分页模式**：分页模式下跳过原有的 500 行截断逻辑；非分页模式保持原有行为不变
- **累加式追加**：`appendRows()` 将新批次行追加到已有 `rows` 数组末尾，不清空已有数据

## [1.1.13] - 2026-07-08

### 新增功能

- **数据明细行号列**：结果表格左侧新增固定行号列（宽度 50px），不参与横向滚动，深色模式适配
- **多行多列矩形选择**：支持鼠标拖拽选择矩形区域（多行×多列），支持 Ctrl/Shift 扩展选择，选中区域高亮显示
- **Ctrl+C 复制选中区域**：选中矩形区域后按 Ctrl+C 复制，格式为制表符分隔列 + 换行符分隔行（可直接粘贴到 Excel）
- **右键"复制(含表头)"**：右键菜单新增「复制(含表头)」和「复制」选项，复制时自动附上对应列字段名

## [1.1.10] - 2026-07-08

### Bug 修复

- **数据明细编辑保存报错 "不支持的数据库驱动: undefined"**：修复编辑模式下保存数据时，后端无法识别数据库驱动类型导致保存失败的问题

### 新增功能

- **数据明细多字段 UPDATE**：数据明细编辑模式下，支持同时修改多个字段并一次性提交，提升编辑效率
- **右键菜单**：
  - 数据库树节点右键菜单（5 项）：复制连接信息、测试连接、编辑连接、删除连接、执行查询
  - 结果表单元格右键菜单（3 项）：复制单元格内容、复制整行数据（TSV 格式）、复制列名

### 优化

- **单连接自动跳转结果页**：用户只有一个数据库连接时，执行 SQL 后自动切换到"结果查询"标签页，减少手动切换操作
- **SQL 执行确认弹窗智能化**：非只读模式下，仅写操作（INSERT / UPDATE / DELETE / DROP / ALTER / TRUNCATE / CREATE）弹出确认框，纯查询语句（SELECT / WITH / SHOW / DESCRIBE / EXPLAIN）直接执行，大幅减少不必要的确认操作

### 修复

- **多 SQL 窗口执行状态隔离**：修复多个 SQL 标签页间执行状态相互干扰的历史遗留问题，确保每个标签页独立管理执行生命周期

---

## [1.1.3] - 2026-07-08

### 新增功能

- **SQL 查看面板**：底栏新增「SQL 查看」标签页，展示本次执行的实际 SQL 和各连接详情（含 Schema）
- **Schema 浏览**：未设置 Schema 的连接，展开后先显示 Schema 列表，选择后加载对应表/视图
- **标识符引用选项**：元数据浏览区新增 `""` 切换按钮，生成 SELECT 语句时可加双引号（适配 PG/瀚高）

### Bug 修复

- **实例密码二次验证 "凭证不存在"**：`decrypt-credential` 端点扩展支持按 `instanceType/instanceId` 查询实例凭据，不再误查服务器凭据
- **缩放不生效**：`theme.ts` 中 `htmlFontSize` 改为 `Math.round(16 * scale)` 并新增 `MuiTableCell` / `MuiInputBase` / `MuiFormLabel` 等组件样式覆盖
- **模板下载弹窗**：移除 `href + target="_blank"`，改用 `apiFetch` blob 下载
- **连接名称列恢复**：数据库实例明细表恢复显示「连接名称」列

### 优化

- **自动创建端口**：新增数据库/应用/API/中间件实例时自动创建对应的端口记录
- **Schema 兼容**：`execute.mjs` 中 schema 读取增加 `conn.schema_name || conn.schema || ''` 兼容旧数据
- **新版导入模板**：服务器资源导入模板改为 `IP地址/IP类型/映射端口/映射IP` + 多凭据 + 数据库 Schema

---

## [1.0.1] - 2026-06-17

### UI 调整

驱动管理和连接管理弹窗宽度缩减至原来的 60%，界面更紧凑：

| 组件 | 文件 | 原宽度 | 新宽度 |
|------|------|--------|--------|
| DriverManager | `driver/DriverManager.tsx` | ~900px (md) | 540px |
| DriverUpload | `driver/DriverUpload.tsx` | ~600px (sm) | 360px |
| ConnectionDialog | `connection/ConnectionDialog.tsx` | ~900px (md) | 540px |
| ConnectionAddDialog | `connection/ConnectionAddDialog.tsx` | ~600px (sm) | 360px |
| BulkImportDialog | `connection/BulkImportDialog.tsx` | ~900px (md) | 540px |

### 文档

- 新增 `ARCHITECTURE.md` 系统架构文档
- 新增 `CHANGELOG.md` 版本变更记录
- 更新 `README.md` 补充桌面应用、许可证激活等文档

---

## [1.0.0] - 2026-06-17

### 🚀 V1.0 正式版

首次正式发布，DClaw（数据钳）—— 跨数据库统一 SQL 执行与结果对比工具。

---

### 核心功能

#### 多数据库 SQL 执行
- 支持 MySQL、PostgreSQL、Oracle 数据库驱动
- 勾选多个连接，并发批量执行 SQL
- SSE 实时进度推送，执行过程可视化反馈
- 单条 SQL 可对多库同时执行并对比结果

#### 连接管理
- 连接 CRUD：创建、编辑、删除、测试连接
- Schema 发现：自动获取数据库 Schema/表结构
- 数据库列表发现：浏览数据库实例下的数据库列表
- 批量 CSV 导入：通过 CSV 文件批量创建连接
- 密码 AES-256-GCM 加密存储

#### 四层树组织管理
- 项目 → 业务模块 → 区域节点 → 连接实例
- 拖拽排序，灵活调整层级结构
- 支持连接上下文切换

#### 结果展示与对比
- 跨库结果聚合为一表，差异单元格高亮
- 支持分页、列排序、列筛选
- 结果导出（CSV / Excel）

#### SQL 编辑器
- 基于 Monaco Editor，语法高亮、自动补全
- SQL 格式化（sql-formatter）
- 常用快捷键支持
- 执行历史记录与回放

#### 只读安全模式
- 可切换只读模式，仅允许 SELECT 语句
- 危险操作检测与拦截（DROP、ALTER、TRUNCATE 等）

#### 许可证激活
- RSA 4096 签名授权系统
- 机器指纹（HWID）绑定
- 24 小时试用模式
- 支持永久授权和有效期授权

#### 用户认证
- JWT 用户登录/注册
- bcryptjs 密码哈希
- 开发环境自动跳过认证

#### 驱动管理
- 内置 MySQL、PostgreSQL 驱动预设
- 支持自定义 JDBC 驱动（hgdb-bridge）
- 驱动状态监控

#### 备份恢复
- 数据目录备份与恢复

#### 部署形态
- **Web 应用**：Docker 多阶段构建 + Nginx 反向代理
- **Electron 桌面应用**：Windows x64 NSIS 安装包 + Portable 免安装版

---

### 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript 5.4 |
| UI 组件库 | MUI 5 (Material-UI) |
| 编辑器 | Monaco Editor |
| 状态管理 | Zustand 4 |
| CSS 框架 | Tailwind CSS 3 |
| 后端框架 | Express 4 |
| 认证 | JWT + bcryptjs |
| 日志 | Winston (结构化日志 + traceId) |
| 数据库驱动 | mysql2、pg、postgres.js |
| 桌面端 | Electron 42 + electron-builder 26 |
| 构建工具 | Vite 5 |
| 测试框架 | Vitest 4 + Testing Library |
| 容器化 | Docker + docker-compose + Nginx |
| CI/CD | GitHub Actions |

---

### 已知限制

- Oracle 数据库支持需要额外 Java JDBC 桥接配置
- 仅支持 Windows x64 桌面端打包
- SQL Server 驱动尚未内置
- 试用模式依赖本地文件时间戳，可能存在绕过风险

---

### 下个版本计划 (V1.1)

- [ ] macOS / Linux 桌面端打包
- [ ] SQL Server 原生驱动支持
- [ ] 连接分组快速切换
- [ ] 查询结果可视化图表
- [ ] 导出模板（自定义 Excel 格式）
