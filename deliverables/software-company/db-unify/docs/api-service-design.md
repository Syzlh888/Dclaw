# DClaw API 服务（对外数据接口）设计文档

> **文档版本**: v1.0
> **日期**: 2026-08-12
> **状态**: 待评审
> **适用范围**: DClaw 新增「API 服务」模块，将表/SQL 发布为对外 HTTP API，外部用户凭 API Token 调用

---

## 1. 需求概述

DClaw 提供「API 服务」能力：管理员把**某张表**或**某条 SQL** 发布成一个对外 HTTP API 接口，其他系统/用户凭**有效的 API Token** 调用该接口获取数据。

**核心价值**：把数据库能力以标准 REST API 形式开放给第三方，无需暴露数据库连接，安全可控。

---

## 2. 已确认需求（决策）

| 决策 | 结论 |
|------|------|
| 接口形态 | **C 两者都支持**：可发布预定义 SQL 接口 + 表自动生成 REST 接口 |
| 鉴权方式 | **A 独立 API Token**（与登录 JWT 分开）|
| Token 粒度 | **跨接口授权**：一个 Token 可绑定指定多个接口或全部接口 |
| 脱敏 | **需脱敏**：用户勾选接口的脱敏字段，返回时自动打码 |
| UI 位置 | **A 独立一级模块**（左侧菜单新增「API 服务」）|
| 安全策略 | **A 只读 + IP 白名单 + 限流**（医疗数据安全第一）|
| 实施方式 | **一次性完成**（不分阶段）|

---

## 3. 架构总览

```
┌─────────────┐     ┌──────────────────────────────────────┐
│  外部调用方   │ ──> │         DClaw API 网关                │
│ (其他系统)    │     │  /api/public/v1/{apiId}               │
└─────────────┘     │  ├─ Token 校验 (独立 API Token)         │
                    │  ├─ IP 白名单校验                      │
                    │  ├─ 限流 (QPS/调用次数)                 │
                    │  ├─ SQL 只读校验 (SELECT/WITH)          │
                    │  └─ 参数绑定 + 安全过滤                  │
                    │            │                           │
                    │            v                           │
                    │   ┌─────────────────────┐              │
                    │   │ 连接池 / 数据库       │             │
                    │   └─────────────────────┘              │
                    │            │                           │
                    │            v                           │
                    │   返回 JSON (含调用审计)                 │
                    └──────────────────────────────────────┘
```

**关键设计**：API 服务是**独立公开路由**（`/api/public/v1/*`），不经过 DClaw 登录 JWT 中间件，只用独立 API Token 鉴权。内部仍复用连接池/执行引擎/SQL 校验。

---

## 4. 数据模型（新增迁移 011）

```sql
-- API 接口定义
CREATE TABLE api_endpoints (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,              -- 接口名称
  description    TEXT,                       -- 描述
  type           TEXT NOT NULL DEFAULT 'sql',-- 'sql' 预定义SQL | 'table' 表接口
  connection_id  TEXT NOT NULL,              -- 关联数据库连接
  schema_name    TEXT,                       -- schema (表接口用)
  table_name     TEXT,                       -- 目标表 (表接口用)
  sql_text       TEXT,                       -- SQL (SQL接口用, 含 :param 占位符)
  params_json    TEXT,                       -- 参数定义 [{name,type,required,label}]
  page_size_max  INTEGER DEFAULT 100,        -- 单页最大条数
  mask_fields    TEXT,                       -- 脱敏字段列表 (JSON数组，如 ["name","idcard"])
  status         TEXT DEFAULT 'active',      -- active | disabled
  created_by     TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  updated_at     TEXT
);

# API Token（跨接口授权）
CREATE TABLE api_tokens (
  id             TEXT PRIMARY KEY,
  scope          TEXT DEFAULT 'all',        -- 'all' 全部接口 | 'select' 指定接口
  endpoint_ids   TEXT,                       -- scope='select' 时逗号分隔接口ID，空=全部
  token          TEXT NOT NULL UNIQUE,       -- 独立 API Token (加密存储)
  name           TEXT,                       -- token 名称
  ip_whitelist   TEXT,                       -- 逗号分隔 IP/CIDR
  qps_limit      INTEGER DEFAULT 10,         -- 每秒请求上限
  daily_limit    INTEGER DEFAULT 1000,       -- 每日调用上限
  expires_at     TEXT,                       -- 过期时间 (NULL 永久)
  status         TEXT DEFAULT 'active',      -- active | disabled
  created_by     TEXT,
  created_at     TEXT DEFAULT (datetime('now')),
  last_used_at   TEXT
);

-- 调用审计
CREATE TABLE api_call_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id    TEXT NOT NULL,
  token_id       TEXT,
  ip             TEXT,
  params_hash    TEXT,
  status_code    INTEGER,
  error_msg      TEXT,
  duration_ms    INTEGER,
  called_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_api_logs_endpoint ON api_call_logs(endpoint_id, called_at);
```

---

## 5. 后端实现

### 5.1 管理端路由 `server/routes/api-service.mjs`
> 需登录 JWT（管理功能），挂到 `/api/api-service`

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/api-service/endpoints` | 接口列表 |
| POST | `/api/api-service/endpoints` | 新建接口 |
| PUT | `/api/api-service/endpoints/:id` | 更新接口 |
| DELETE | `/api/api-service/endpoints/:id` | 删除接口 |
| POST | `/api/api-service/endpoints/:id/test` | 测试接口（校验 SQL/参数）|
| GET | `/api/api-service/endpoints/:id/tokens` | 接口的 Token 列表 |
| POST | `/api/api-service/tokens` | 生成 Token（返回一次明文）|
| PUT | `/api/api-service/tokens/:id` | 更新 Token（白名单/限流/过期）|
| DELETE | `/api/api-service/tokens/:id` | 删除/禁用 Token |
| GET | `/api/api-service/endpoints/:id/logs` | 调用日志 |

### 5.2 公开调用路由 `server/routes/api-public.mjs`
> **不经过登录 JWT**，用独立 Token，挂到 `/api/public/v1`

```
GET/POST /api/public/v1/:apiId
```

**调用流程**：
1. 提取 Token：`Authorization: Bearer <token>` 或 `X-API-Key: <token>` 或 `?token=`
2. 查 `api_tokens`，校验：token 存在 + active + 未过期
3. **跨接口授权校验**：token.scope='all' 放行任意接口；'select' 时校验 apiId 在 token.endpoint_ids 内
4. 校验调用方 IP 在白名单内
5. 查 `api_endpoints`：active
6. **限流检查**：QPS 限流（内存滑动窗口）+ 每日调用上限（查日志计数）
7. 解析参数：query/body 传入 → 绑定 SQL 占位符（`:param`）
8. **只读强制校验**：`validateSql(sql, { readOnlyMode: true })`，仅 SELECT/WITH
9. 执行查询（复用 `executeQuery`），分页（自动追加 LIMIT/OFFSET，上限 page_size_max）
10. **脱敏处理**：命中 endpoint.mask_fields 的列，对返回单元格值打码（姓名/手机号/身份证等按类型）
11. 返回 `{ code:0, data:[...], total, page, pageSize }`
12. 写调用审计日志

### 5.3 SQL 参数绑定安全
- SQL 用 **命名占位符 `:name`**（复用 `detectSqlParams` 思路）
- 参数值用**参数化查询**（pg/mysql 的 prepared statement），**禁止字符串拼接**，防 SQL 注入
- 参数类型校验（number/string/date），非法类型拒绝
- 表接口自动生成：`SELECT * FROM "schema"."table"` + 可选 WHERE 字段白名单

---

## 6. Token 安全

- **Token 生成**：`crypto.randomBytes(32).toString('hex')`（CSPRNG），长度 64
- **存储**：加密存储（复用项目 SM4 国密加密），管理端只显示一次明文
- **独立体系**：不依赖登录 JWT，Token 只绑定某个接口（可跨接口/全接口授权可选）
- **撤销**：删除或置 disabled 立即生效
- **过期**：`expires_at`，过期自动拒绝

---

## 7. 前端实现（独立一级模块「API 服务」）

```
src/components/api-service/
├── ApiServicePage.tsx          # 主页面（左侧菜单新增入口）
├── EndpointList.tsx            # 接口列表
├── EndpointDialog.tsx          # 新建/编辑接口（SQL/表两种模式）
├── TokenManager.tsx            # 接口的 Token 管理
├── CallLogsPanel.tsx           # 调用日志/统计
```

### 页面布局（DBeaver 风格，遵循 UI-STYLE-CONSTRAINTS）
- 左侧：接口列表（名称/类型/连接/状态）+ 新建按钮
- 右侧：详情（基本信息 + Token 管理 + 调用日志）
- 新建接口弹窗：选类型（SQL/表）→ 选连接 → 填 SQL 或选表 → 定义参数 → 保存

### 左侧菜单
- AppSidebar 新增「API 服务」菜单项（与 SQL编辑器/数据同步平级）

---

## 8. 安全红线

| 项 | 约束 |
|----|------|
| ⚠️ **只读强制** | 所有接口只执行 SELECT/WITH，`validateSql(readOnlyMode:true)`，写操作一律拒绝 |
| ⚠️ **参数化查询** | 参数必须 prepared statement，禁止拼接，防 SQL 注入 |
| ⚠️ **Token 加密** | 存储加密 + 只显示一次明文 + 可撤销/过期 |
| ⚠️ **跨接口授权** | Token 可绑定指定接口（scope=select）或全部接口（scope=all），未授权接口拒绝 |
| ⚠️ **IP 白名单** | Token 可配 IP/CIDR 白名单，非法 IP 拒绝 |
| ⚠️ **限流** | QPS + 每日上限，防滥用/防打爆数据库 |
| ⚠️ **分页上限** | page_size_max 默认 100，防止全表导出 |
| ⚠️ **数据脱敏** | 接口配置 mask_fields，返回时对敏感列打码（姓名/身份证/手机号等）|
| ⚠️ **审计** | 所有调用记录日志（谁/何时/来自哪/哪个接口/结果）|

---

## 9. 复用现有组件

| 能力 | 复用来源 |
|------|---------|
| SQL 执行 | `connections.mjs executeQuery` |
| SQL 只读校验 | `execute.mjs validateSql(readOnlyMode)` |
| 连接池 | 现有连接管理 |
| 国密加密 | 现有 SM4 工具 |
| 参数检测 | `sqlUtils.ts detectSqlParams` |
| UI 组件 | MUI + 深空科技主题 + TreeConnectionSelect |

---

## 10. 实施方式（一次性完成）

按用户确认，本功能**一次性开发完成**（不分阶段），一次性交付后端 + 前端 + 加固：

1. **迁移 011**：`api_endpoints` / `api_tokens` / `api_call_logs` 三张表
2. **后端**：`api-service.mjs`（管理端 CRUD）+ `api-public.mjs`（公开调用）
   - 跨接口 Token 授权（all/select）+ IP 白名单 + 限流 + 审计
   - SQL 参数化执行 + 表接口生成 + 脱敏
3. **前端**：`ApiServicePage`（接口管理 + Token 管理含跨接口选择 + 脱敏字段勾选 + 调用日志）
4. **加固验证**：只读强制/注入防护/token 过期/白名单/限流/跨接口/脱敏 全测试

### Token 管理 UI（含跨接口 + 脱敏）
- 新建 Token：选作用域（全部接口 / 指定接口→勾选多选）+ 名称 + IP 白名单 + QPS/每日上限 + 过期时间
- 接口编辑：可勾选「脱敏字段」（从该表/查询列中多选，存 mask_fields）
- 调用日志：按接口/Token/时间筛选 + 分页

---

## 11. 验收标准

1. ✅ 能发布 SQL 接口（含参数）和表接口（自动生成）
2. ✅ 用有效 Token 调用返回正确 JSON
3. ✅ 无效/过期/禁用 Token 返回 401
4. ✅ IP 不在白名单返回 403
5. ✅ 写 SQL（INSERT/UPDATE/DELETE）被拒绝
6. ✅ SQL 注入参数被拦截
7. ✅ 超 QPS/每日上限被限流
8. ✅ 调用有审计日志
9. ✅ 前端模块可管理接口/Token/日志
10. ✅ build + 部署 + 独立验证

---

*本文档评审通过后进入开发（分 3 阶段）。*
