# DClaw V1.0 系统架构文档

## 一、系统概述

DClaw（数据钳）是一款跨数据库统一 SQL 执行与结果对比工具，支持 Web 应用和 Electron 桌面应用两种部署形态。核心价值是"一次编写 SQL，批量执行，实时对比查询结果"，帮助开发者和 DBA 在多数据库环境下高效工作。

---

## 二、整体架构

```
┌─────────────────────────────────────────────────────────┐
│                     用户界面层                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │   React 18 SPA (Vite 5 构建)                     │   │
│  │   ├── SQL 编辑器 (Monaco Editor)                 │   │
│  │   ├── 数据库树 (四层结构)                        │   │
│  │   ├── 结果展示 (虚拟滚动表格)                    │   │
│  │   ├── 连接管理面板                               │   │
│  │   ├── 执行历史                                   │   │
│  │   ├── 驱动管理                                   │   │
│  │   ├── 许可证激活                                 │   │
│  │   └── 备份恢复                                   │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
│  ┌───────────────────────┼───────────────────────────┐   │
│  │            Electron 壳 (可选)                      │   │
│  │    ┌──────────┐  ┌──────────┐  ┌──────────────┐  │   │
│  │    │ main.mjs │  │preload   │  │ 内嵌 Express  │  │   │
│  │    │ 窗口管理  │  │IPC 桥接  │  │ 后端服务      │  │   │
│  │    └──────────┘  └──────────┘  └──────────────┘  │   │
│  └───────────────────────────────────────────────────┘   │
│                          │                               │
├──────────────────────────┼───────────────────────────────┤
│                    API 层                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │   Express 4 HTTP API (REST + SSE)                │   │
│  │   ├── /api/auth/*      认证                      │   │
│  │   ├── /api/connections/* 连接管理                 │   │
│  │   ├── /api/tree/*       层级树                   │   │
│  │   ├── /api/execute       批量执行 (SSE)          │   │
│  │   ├── /api/history/*     执行历史                 │   │
│  │   ├── /api/drivers/*     驱动管理                 │   │
│  │   ├── /api/scripts/*     SQL 脚本                │   │
│  │   └── /api/backup/*      备份恢复                │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                               │
├──────────────────────────┼───────────────────────────────┤
│                    服务层                                 │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌─────────┐  │
│  │ 数据库执行 │ │ SQL校验  │ │ 许可管理  │ │ 加密服务 │  │
│  │ (mysql2   │ │(危险操作 │ │ (RSA 4096 │ │(AES-256 │  │
│  │  pg...)   │ │ 拦截)    │ │  机器绑定)│ │ -GCM)    │  │
│  └───────────┘ └──────────┘ └───────────┘ └─────────┘  │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌─────────┐  │
│  │ 日志服务   │ │ 认证中间件 │ │ 限流防护 │ │ JDBC桥  │  │
│  │ (Winston) │ │ (JWT)    │ │ (rate-limit)│ │(hgdb)  │  │
│  └───────────┘ └──────────┘ └───────────┘ └─────────┘  │
│                          │                               │
├──────────────────────────┼───────────────────────────────┤
│                    持久层                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │   JSON 文件存储 + 内存缓存 (database.mjs)         │   │
│  │   ├── data/connections.json    连接配置          │   │
│  │   ├── data/tree.json           层级树结构        │   │
│  │   ├── data/history.json        执行历史          │   │
│  │   ├── data/scripts.json        SQL 脚本         │   │
│  │   ├── data/users.json          用户数据          │   │
│  │   └── data/drivers.json        驱动配置          │   │
│  └──────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  外部数据库（运行时连接）                          │   │
│  │   MySQL │ PostgreSQL │ Oracle │ SQL Server        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 三、前端架构

### 目录结构

```
src/
├── components/
│   ├── auth/              # 登录页、激活页
│   ├── backup/            # 备份恢复界面
│   ├── connection/        # 连接表单、批量导入、连接面板
│   ├── database-tree/     # 四层树组件（拖拽排序）
│   ├── driver/            # 驱动管理界面
│   ├── execution/         # 执行状态进度面板
│   ├── history/           # 执行历史列表
│   ├── layout/            # 主布局框架（顶栏、底栏、面板）
│   ├── results/           # 结果表格、对比视图
│   └── sql-editor/        # Monaco Editor 封装
├── hooks/                 # 自定义 React Hooks
├── services/              # API 调用封装（12 个模块）
├── stores/                # Zustand 状态管理（7 个 store）
├── types/                 # TypeScript 类型定义
└── utils/                 # 通用工具函数
```

### 状态管理 (Zustand Store)

| Store | 职责 |
|-------|------|
| `connectionStore` | 连接列表、选中连接、连接测试状态 |
| `treeStore` | 四层树结构、节点 CRUD、展开/折叠、拖拽排序 |
| `executionStore` | 执行状态、SQL 内容、SSE 连接管理 |
| `resultStore` | 查询结果、对比视图、分页排序 |
| `historyStore` | 执行历史记录、搜索过滤 |
| `driverStore` | 驱动定义、状态检测 |
| `authStore` | JWT 令牌管理、登录/登出、Electron 激活状态 |

### 组件通信

- **Props 传递**：父子组件间数据传递
- **Zustand Store**：跨组件共享状态
- **回调模式**：子组件向上通知（如 `onActivated`）

### 视图模式 (App.tsx 核心逻辑)

```
isElectron?
  ├── yes → 检查许可证
  │   ├── 加载中 → Loading 动画
  │   ├── 已激活 → 主界面
  │   └── 未激活 → 激活页面（获取机器指纹 → 输入激活码 → 激活）
  └── no → 浏览器模式
      ├── 开发环境 → 自动跳过认证，直接进入主界面
      └── 生产环境 → JWT 登录 → 主界面
```

---

## 四、后端架构

### 入口文件 `server/index.mjs`

1. 注册安全中间件（helmet、cors、rate-limit、compression）
2. 挂载路由模块
3. 静态文件服务（生产环境 serve dist/）
4. 错误处理中间件

### 中间件

| 中间件 | 功能 |
|--------|------|
| `helmet` | HTTP 安全头 |
| `cors` | 跨域请求控制 |
| `express-rate-limit` | API 限流（100 req/15min） |
| `compression` | Gzip 响应压缩 |
| `auth.mjs` | JWT 验证（排除 /api/auth/* 和 /api/health） |
| `multer` | 文件上传（CSV 批量导入） |

### 路由模块

| 文件 | 端点前缀 | 功能 |
|------|---------|------|
| `auth.mjs` | `/api/auth` | 登录 (POST /login)、注册 (POST /register) |
| `connections.mjs` | `/api/connections` | CRUD、测试、Schema/DB 发现、批量导入 |
| `tree.mjs` | `/api/tree` | 层级树 CRUD、节点排序 |
| `execute.mjs` | `/api/execute` | SSE 批量 SQL 执行 |
| `history.mjs` | `/api/history` | 执行历史查询 |
| `drivers.mjs` | `/api/drivers` | 驱动列表、状态 |
| `scripts.mjs` | `/api/scripts` | SQL 脚本 CRUD |
| `backup.mjs` | `/api/backup` | 数据备份与恢复 |

### 核心服务模块

| 模块 | 文件 | 职责 |
|------|------|------|
| **数据持久化** | `database.mjs` | JSON 文件存储 + 内存缓存 + 异步写入队列 |
| **密码加密** | `crypto.mjs` | AES-256-GCM 对称加密（密码安全存储） |
| **许可证** | `license.mjs` | RSA 4096 签名验证、HWID 绑定、24h 试用 |
| **日志** | `logger.mjs` | Winston 结构化日志 + AsyncLocalStorage traceId |
| **SQL 校验** | `sqlValidator.mjs` | 只读模式拦截、危险操作检测 |
| **JDBC 桥** | `hgdb-bridge.mjs` | Java JDBC 进程桥接（Oracle 等需要 JDBC 的库） |

### 数据流

```
用户操作（前端）→ fetch() → Express 路由 → 业务逻辑
    → JSON 文件存储 / 连接目标数据库
    → SSE 流式响应（执行场景）
    → JSON 响应（CRUD 场景）
    → React 状态更新 → UI 重渲染
```

---

## 五、Electron 桌面端架构

### 主进程 `electron/main.mjs`

```
启动流程:
  1. 创建 BrowserWindow (1280x800)
  2. 检查 dev/prod 模式
  3. 生产模式 → fork Express 后端进程 (server/index.mjs)
  4. 加载 URL (dev: localhost:5173, prod: file://dist/index.html)
  5. 等待页面就绪信号 → 显示窗口
```

### IPC 通信

| 通道 | 方向 | 功能 |
|------|------|------|
| `get-platform-info` | renderer→main | 获取系统信息用于 HWID 生成 |
| `get-app-data-path` | renderer→main | 获取用户数据目录路径 |
| `confirm-close` | renderer→main | 关闭确认对话 |

### 预加载脚本

- `preload.mjs` — ESM 版（开发模式使用）
- `preload.cjs` — CommonJS 版（生产打包使用）

### 许可证激活流程

```
1. 应用启动 → checkLicense()
2. 读取 %APPDATA%/db-unify/license.dat / trial.dat
3. 文件存在且有效 → 已激活 → 进入主界面
4. 文件不存在 → 进入激活页面
5. 激活页面展示机器指纹（HWID）
6. 用户输入激活码 → 服务端 RSA 签名验证
7. 验证通过 → 写入 license.dat → 进入主界面
8. 点击"试用" → 写入 trial.dat (24h) → 进入主界面
```

---

## 六、构建与部署

### 开发模式

```
npm run dev            → 并发 Vite (5173) + nodemon Express (3001)
npm run dev:electron   → 并发 Vite + Electron
```

### 生产构建

```
npm run build               → TSC 类型检查 + Vite 构建 → dist/
npm run build:electron       → 构建 + electron-builder → release/
```

### 打包产物

| 文件 | 说明 |
|------|------|
| `DClaw-Setup-1.0.0.exe` | NSIS 安装包（可选安装目录） |
| `DClaw-Portable-1.0.0.exe` | 免安装版 |

### Docker 部署

```
docker compose up -d  →  构建镜像 + 启动 Nginx + 应用容器
```

---

## 七、安全设计

| 层面 | 机制 |
|------|------|
| **传输安全** | HTTPS（Nginx SSL 终端）+ Helmet 安全头 |
| **认证** | JWT (HS256) 令牌，7 天过期 |
| **密码存储** | bcryptjs 哈希（cost factor 10） |
| **连接密码** | AES-256-GCM 加密存储，密钥来自环境变量 |
| **API 限流** | express-rate-limit 100 req / 15 min |
| **SQL 安全** | 只读模式 + 危险操作关键词检测 |
| **许可证** | RSA 4096 非对称签名，机器指纹绑定 |
| **CORS** | 生产环境白名单控制 |

---

## 八、数据存储说明

所有业务数据以 JSON 文件形式存储在 `data/` 目录下。数据库连接密码经过 AES-256-GCM 加密后存储，密钥由环境变量 `ENCRYPTION_KEY` 提供。

```
data/
├── connections.json    # 数据库连接配置（密码加密）
├── tree.json           # 四层树结构
├── drivers.json        # 驱动预设
├── history.json        # SQL 执行历史
├── scripts.json        # 保存的 SQL 脚本
└── users.json          # 用户账号（密码 bcrypt 哈希）
```

运行时采用**内存缓存 + 异步写入队列**策略，确保读写性能和数据一致性。
