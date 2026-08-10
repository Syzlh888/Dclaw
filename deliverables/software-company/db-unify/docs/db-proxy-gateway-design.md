# 数据库代理网关（DB Proxy Gateway）设计文档

> 版本：v1.0-draft
> 状态：待评审
> 关联：DClaw 数据钳（Express + React + Vite + Electron + PostgreSQL 16）

## 1. 背景与目标

### 1.1 业务场景
外部用户（医院工程师、第三方开发者等）需要通过标准数据库客户端（DBeaver / Navicat / psql 等）访问真实业务数据库时：

- **不暴露**真实数据库 IP
- **不暴露**真实账号密码
- 支持**时效性**控制（临时授权，到期失效）
- 记录用户的**所有数据库操作**（全量审计）

### 1.2 核心价值
- 安全：真实库凭据永不外泄
- 可控：临时授权 + 可撤销 + 到期回收
- 可审计：每一条 SQL 都有记录

## 2. 方案定型

### 2.1 架构：内置 TCP 代理网关
```
外部客户端（DBeaver/Navicat）         DClaw 代理网关              真实数据库
┌──────────────────┐               ┌──────────────────┐        ┌──────────┐
│ 连接: 虚拟IP      │  标准DB协议     │ Node TCP 代理      │ 内部   │ 172.20.x  │
│ 端口: 15401       │ ───────────→  │ (校验+转发+审计)   │ ────→ │ 真实DB    │
│ 账号: temp_abc    │               │                  │        │          │
│ 密码: 随机        │               │                  │        │          │
└──────────────────┘               └──────────────────┘        └──────────┘
```

### 2.2 已确认决策
| 决策 | 选择 | 说明 |
|---|---|---|
| 对外形态 | 虚拟IP + 端口 | DClaw 监听端口，用户直连 |
| 审计策略 | 创建时可选 | 只记录 / 记录+拦截危险SQL |
| 账号类型 | 虚拟账号 | 不建真实 DB 账号，代理层校验 |
| 密码存储 | 国密可逆加密 | 复用现有 GM 国密（SM4-CBC+SM3-MAC），代理认证时解密校验 |
| 端口段 | 自动推荐 35000，可配置 | 端口段可在配置中自定义，避免与业务端口冲突 |
| 国产库审计完整度 | 与数据库连接保持一致 | 审计能力与 DClaw 数据库连接支持程度一致，不额外降级 |
| 并发上限 | 100 | 单代理连接最大并发连接数 100 |
| 代理进程 | 独立进程 | server/proxy/ 单独进程，主服务崩溃不影响代理 |

## 3. 数据模型

### 3.1 表：proxy_connections（代理连接）

```sql
CREATE TABLE proxy_connections (
  id                VARCHAR(32) PRIMARY KEY,
  name              VARCHAR(128) NOT NULL,          -- 对外名称
  db_type           VARCHAR(16) NOT NULL DEFAULT 'postgresql', -- postgresql|mysql|highgo|dm|oracle|sqlserver
  real_connection_id VARCHAR(32) NOT NULL,          -- 关联真实连接（内部）
  proxy_port        INT UNIQUE NOT NULL,            -- 对外监听端口
  proxy_username    VARCHAR(64) NOT NULL,           -- 对外临时账号
  proxy_password    VARCHAR(256) NOT NULL,          -- 对外临时密码（国密可逆加密 SM4 存储）
  audit_mode        VARCHAR(16) NOT NULL DEFAULT 'record', -- record | intercept
  max_connections   INT NOT NULL DEFAULT 100,       -- 最大并发连接（上限100）
  allowed_ips       JSONB DEFAULT NULL,             -- 来源IP白名单（可选）
  proxy_port_base   INT DEFAULT 35000,              -- 端口段起始（可配置）
  expires_at        TIMESTAMPTZ NOT NULL,           -- 到期时间
  status            VARCHAR(16) NOT NULL DEFAULT 'active', -- active|expired|revoked
  created_by        VARCHAR(64),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at        TIMESTAMPTZ,
  last_connected_at TIMESTAMPTZ
);
```

### 3.2 表：proxy_audit_logs（代理操作审计）

```sql
CREATE TABLE proxy_audit_logs (
  id                 BIGSERIAL PRIMARY KEY,
  proxy_connection_id VARCHAR(32) NOT NULL,
  proxy_username     VARCHAR(64),
  db_type            VARCHAR(16),
  real_connection_id VARCHAR(32),
  client_ip          INET,                          -- 来源IP
  session_start      TIMESTAMPTZ,
  session_end        TIMESTAMPTZ,
  sql_text           TEXT,                          -- 执行的SQL
  sql_type           VARCHAR(16),                   -- SELECT|INSERT|UPDATE|DELETE|DDL|OTHER
  affected_rows      INT,
  status             VARCHAR(16),                   -- success|failed|blocked
  risk_level         VARCHAR(8),                    -- low|medium|high
  error_message      TEXT,
  executed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_proxy_audit_conn ON proxy_audit_logs(proxy_connection_id, executed_at DESC);
CREATE INDEX idx_proxy_audit_client ON proxy_audit_logs(client_ip);
```

## 4. 功能模块

### 4.1 代理连接管理（管理员侧）
- **创建代理连接**：选真实连接 → 配置名称/审计模式/并发数/IP白名单/有效期 → 生成端口+临时账号+随机密码
- **列表**：查看所有代理连接（状态/到期时间/最近连接）
- **续期**：到期前延长有效期
- **撤销**：手动立即失效（断开活动连接 + 标记 revoked）
- **详情**：查看关联真实连接（内部）、审计模式

### 4.2 对外代理网关（核心，独立进程）
- **独立进程**：`server/proxy/index.mjs` 单独启动，通过主服务协调配置/状态，主服务崩溃不影响代理
- DClaw 启动时**监听所有 active 代理连接的端口**（端口段起始 35000 可配置）
- 收到外部连接：
  1. 校验端口 → 找到对应代理连接
  2. 校验状态（active / 未过期）
  3. 校验临时账号密码（国密解密校验，PG 协议握手时校验）
  4. 校验来源 IP（若配置白名单）
  5. 校验并发数（≤100）
- 通过 → 用**真实连接内部账号**连接真实库 → 建立双向转发
- 转发过程中：
  - 解析并记录每条 SQL 到 proxy_audit_logs
  - 若 audit_mode=intercept，危险 SQL 直接拦截返回错误

### 4.3 时效性控制
- 定时任务（scheduler）每分钟扫描 `expires_at < NOW()` 的 active 代理连接：
  - 标记 expired
  - 断开活动连接
- 撤销时同样断开

### 4.4 全量审计
- 每条 SQL 记录：代理账号、来源IP、会话时间、SQL文本、类型、影响行数、状态、风险等级
- 危险 SQL 识别（可配置关键词/正则）：DROP / TRUNCATE / DELETE 无 WHERE / ALTER / 高权限操作

## 5. 技术要点

### 5.1 多数据库协议代理架构

**核心设计**：代理网关采用「**统一入口 + 协议适配器**」架构。

```
外部客户端                        DClaw 代理网关                         真实数据库
┌──────────────┐               ┌─────────────────────────┐          ┌──────────┐
│ DBeaver      │               │  协议分派层              │          │ PostgreSQL│
│ (任意DB协议) │               │  ┌───────────────────┐   │          │ MySQL     │
│ 连虚拟IP:端口 │ ────────────→ │  │ DBProtocolAdapter │──│──→      │ 瀚高/达梦  │
└──────────────┘               │  ├───────────────────┤   │          │ Oracle    │
                               │  │ PG / MySQL /       │   │          │          │
                               │  │ Oracle / 瀚高/达梦  │   │          │          │
                               │  └───────────────────┘   │          └──────────┘
                               └─────────────────────────┘
```

### 5.2 协议适配器（DBProtocolAdapter）接口

每种数据库实现一个适配器，统一接口：

```typescript
interface DBProtocolAdapter {
  // 识别连接协议类型
  detectType(firstBytes: Buffer): DBType;
  // 认证：校验虚拟账号/密码（解析 StartupMessage / 握手包）
  authenticate(conn, proxyUser, proxyPass): Promise<boolean>;
  // SQL 提取：从字节流中解析出每条 SQL 文本
  extractSql(buf: Buffer): SqlExtraction[];
  // SQL 风险分级
  classifyRisk(sql: string): RiskLevel;
  // 危险 SQL 拦截
  shouldIntercept(sql: string, mode: string): boolean;
  // 真实连接：用内部账号连真实库
  connectReal(realConn: Connection): Promise<Socket>;
}
```

### 5.3 各数据库协议要点

| 数据库 | 协议 | 认证 | SQL消息识别 | 审计可行性 |
|---|---|---|---|---|
| **PostgreSQL** | 原生PG协议 | StartupMessage + MD5/SCRAM | `Query`(Q) / `Parse`(P) 消息 | ★★★ 完整 |
| **MySQL** | 原生MySQL协议 | Handshake + auth | `COM_QUERY`(0x03) 包 | ★★★ 完整 |
| **瀚高 HighGo** | PG兼容协议 | 同PG | 同PG | ★★★ 完整 |
| **达梦 DM** | 类Oracle/自定义 | TNS/自定义 | 需要逆向 | ★★ 部分 |
| **Oracle** | TNS + Net8 | TNS 认证 | TNS/SQLNet 包 | ★★ 需逆向 |
| **SQL Server** | TDS | TDS login | SQL Batch | ★★ 需逆向 |

**实现策略**：
- **优先完整支持**：PostgreSQL、MySQL、瀚高（瀚高=PG 协议，几乎免费获得）
- **达梦/Oracle/SQLServer**：协议复杂，采用「**盲转发 + 字节级 SQL 提取**」（抓取协议中嵌入的 SQL 文本，用正则/解析器提取），审计 SQL 文本 + 拦截危险 SQL
- 达梦有 `DM8` 的 JDBC/ODBC，可参考其网络协议文档

### 5.4 每条 SQL 审计（协议层）

**目标**：解析出客户端发出的**每一条 SQL**，记录并可选拦截。

**做法**：
- 在协议适配器层，维护一个「**消息解析状态机**」
- 每个数据库协议，识别并提取：
  - PG：`Q`(Query) / `P`(Parse) 消息中的 SQL 文本
  - MySQL：`COM_QUERY` / `COM_STMT_PREPARE` 中的 SQL
  - 其他：扫描字节流中的 SQL 语句边界（分号、换行、协议标记）
- 提取后 → 分类 → 风险分级 → 记录（record）/ 拦截（intercept）
- 对于**预处理语句/绑定参数**：记录 SQL 模板 + 参数值

### 5.5 密码国密可逆加密
- 复用现有 GM 国密（SM4-CBC + SM3-MAC，`GM1:` 前缀格式，与现有 connections 表一致）
- 代理认证时解密校验，内存中暂存，不落明文
- 创建时明文返回一次给管理员

### 5.6 端口管理
- 端口段起始**默认 35000**，可在配置中自定义（proxy_port_base）
- 自动递增分配；撤销/过期后端口释放可复用
- 需确保端口不被占用（可检测）

## 6. 实施阶段

### 阶段 1：数据模型 + API
- `proxy_connections` / `proxy_audit_logs` 两张表（migration 008）
- REST API：CRUD 代理连接 + 审计查询

### 阶段 2：代理网关核心（PG + 瀚高，独立进程）
- `server/proxy/index.mjs` 独立进程
- PG 协议适配器（含瀚高，协议同源）
- 连接校验（账号/密码/有效期/IP/并发≤100）
- SQL 解析 + 审计入库
- 端口段配置（默认 35000）

### 阶段 3：时效性 + 危险SQL拦截
- 定时回收任务
- 危险 SQL 识别 + 拦截（intercept 模式）

### 阶段 4：MySQL 支持
- MySQL 协议适配器
- COM_QUERY 提取 + 认证

### 阶段 5：达梦/Oracle/SQLServer 支持
- 盲转发 + 字节级 SQL 提取适配器
- 逐库逆向协议

### 阶段 6：管理 UI
- 代理连接管理页面（创建/列表/续期/撤销）
- 审计查询页面（按连接/用户/IP/时间/数据库类型筛选）

### 阶段 7：加固
- 连接池复用、性能优化
- IP 白名单完善
- 日志导出

## 7. 安全设计

- 真实库 IP/账号/密码仅存于 real_connection_id 关联，前端/外部永远拿不到
- 临时密码**国密 SM4 可逆加密**存储，创建时明文返回一次
- **代理层独立进程**运行，与 DClaw 主服务隔离，崩溃互不影响
- 危险 SQL 拦截在代理层强制执行
- 审计日志防篡改（追加式 + 定期归档）
- 并发上限 100，防止资源耗尽

## 8. 边界与限制

- **数据库支持**：PostgreSQL、MySQL、瀚高（完整）；达梦、Oracle、SQLServer（盲转发+字节级提取，部分审计）
- **国产库审计完整度与数据库连接保持一致**：DClaw 连接层能支持的 SQL 能力，审计层同步覆盖，不额外降级也不夸大
- 代理层性能受 Node 单进程限制，高并发需横向扩展（初始并发上限 100）
- 部分高级特性（如 PG 复制协议、Oracle 高级 Net 特性）需额外支持
- 达梦/Oracle 协议需逆向，依赖厂商文档/抓包，工时成本较高

## 9. UI 设计规范（与 SQL 编辑器一致）

> 代理功能的所有 UI 必须与 SQL 编辑器页面风格完全统一。

### 9.1 色彩（DBeaver 暗色主题）
| Token | 值 | 用途 |
|---|---|---|
| `background.default` | `#2B2B2B` | 主背景 |
| `background.paper` | `#3C3F41` | 面板/表头背景 |
| `text.primary` | `#BBBBBB` | 主文字 |
| `text.secondary` | `#888888` | 次要文字 |
| `primary.main` | `#1976D2` | 强调色 |
| `primary.light` | `#42A5F5` | 高亮/按钮 |
| hover | `rgba(255,255,255,0.04)` | 行悬浮高亮 |

### 9.2 字号层级（4 层，禁用 0.5 步进值）
| 层级 | 值 | 用途 |
|---|---|---|
| 标题 | `0.95rem` | 面板标题，fontWeight 600 |
| 内容 | `0.85rem` | 表格/字段主体 |
| 次要 | `0.75rem` | 次级文本/标签 |
| 提示 | `0.7rem` | 辅助说明 |

### 9.3 布局规范
- **左树 + 中列表 + 右详情** 三栏布局（与数据同步一致）
- 左侧菜单：List + ListItemButton 结构，FolderIcon 分组，`(X/Y)` 计数
- 图标按钮：`fontSize 13-14`、`p: 0.25`、`Tooltip` 包裹
- 搜索框：`fontSize: '0.7rem'`、SearchIcon + ClearIcon、`borderBottom` 分割线
- 新建按钮：`variant="text"`、`startIcon=<AddIcon>`、左对齐、hover→`primary.main`
- 间距：`py: 0.15`、`mb: 1.5`、Dialog `pt: '12px !important'`

### 9.4 页面结构（代理功能）
```
┌─ 代理连接管理 ──────────────────────────────────────────┐
│ [🔍 搜索]  [+ 新建代理连接]                              │
├────────────────────────────────────────────────────────┤
│ 左树(代理连接分组) │ 中列表(代理连接) │ 右详情+审计       │
│  📁 active       │ 名称/端口/到期/状态│ 连接信息/操作审计   │
│  📁 expired      │ ➕ ✏️ 🗑          │                   │
│  📁 revoked      │                  │                   │
└────────────────────────────────────────────────────────┘
```

### 9.5 组件复用
- 复用现有 `GroupPanel` / `TreeNode` / `TreeSearch` 模式（左侧树）
- 复用 `useTreeStore` / `useConnectionStore`
- 复用现有 Dialog/Button/Table 的 MUI 风格
- 颜色一律走 theme token，禁止硬编码 hex
