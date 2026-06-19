# DClaw（数据钳）V1.0 — 统一数据库查询平台

跨数据库统一 SQL 执行与结果对比工具，支持 MySQL / PostgreSQL / Oracle / SQL Server 等多数据源，一次编写 SQL，批量执行，实时对比查询结果。

支持 **Web 应用** 和 **Windows 桌面应用**（Electron）两种部署形态。

---

## 功能特性

### 数据库执行
- **多数据库并发执行** — 勾选多个数据库连接，同时执行 SQL 查询
- **SSE 实时进度推送** — 执行过程通过 Server-Sent Events 实时反馈
- **结果聚合对比** — 跨库结果聚合为一表，差异单元格高亮

### 连接与组织管理
- **四层树组织管理** — 项目 → 业务模块 → 区域节点 → 连接实例，拖拽排序
- **连接管理** — CRUD、测试连接、Schema 发现、数据库发现、批量 CSV 导入
- **驱动管理** — 内置 MySQL、PostgreSQL 驱动预设，支持自定义 JDBC 驱动

### SQL 编辑器
- **Monaco Editor** — 语法高亮、自动补全、格式化 (sql-formatter)、快捷键
- **执行历史** — 历史记录查看、回放
- **SQL 脚本管理** — 保存、加载常用脚本

### 安全与许可
- **只读安全模式** — 可切换只读模式，防止误操作（仅允许 SELECT）
- **许可证激活** — RSA 4096 机器指纹绑定授权，支持永久/有效期/24h 试用
- **JWT 认证** — 用户登录/注册，bcryptjs 密码哈希
- **密码加密** — 数据库连接密码 AES-256-GCM 加密存储

### 部署形态
- **Web 应用** — Docker 多阶段构建 + Nginx 反向代理
- **桌面应用** — Electron Windows x64，NSIS 安装包 + Portable 免安装版

---

## 技术栈

| 层 | 技术 |
|----|------|
| 前端 | React 18, TypeScript 5.4, MUI 5, Zustand 4, Monaco Editor, Tailwind CSS 3 |
| 后端 | Node.js, Express 4, SSE 流式推送 |
| 数据库驱动 | mysql2, pg, postgres.js |
| 桌面端 | Electron 42, electron-builder 26 |
| 认证 | JWT + bcryptjs |
| 加密 | AES-256-GCM + RSA 4096 |
| 日志 | Winston (结构化日志 + traceId) |
| 测试 | Vitest 4, Testing Library |
| 构建 | Vite 5 |
| 容器化 | Docker + docker-compose + Nginx |
| CI/CD | GitHub Actions |

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [README.md](./README.md) | 项目说明与快速启动（本文档） |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 系统架构文档 |
| [CHANGELOG.md](./CHANGELOG.md) | 版本变更记录 |

---

## 快速启动

### 环境要求

- Node.js >= 18
- npm >= 9

### 1. 配置环境变量

```bash
cp .env.example .env
```

**必须设置的环境变量：**

| 变量 | 说明 | 生成方式 |
|------|------|----------|
| `ENCRYPTION_KEY` | AES-256-GCM 加密密钥（64 位 hex） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_SECRET` | JWT 签名密钥（64 位 hex） | 同上 |

### 2. 安装依赖并启动

```bash
npm install
npm run dev
```

- 前端：http://localhost:5173
- 后端：http://localhost:3001

### 3. 登录

- **开发环境**：自动跳过认证，直接进入主界面
- **Web 生产环境**：默认管理员 `admin` / `admin123`
- **Electron 桌面端**：通过机器指纹 + 激活码授权

---

## 桌面应用

### 开发调试

```bash
npm run dev:electron
```

### 打包构建

```bash
# 生成安装包 (release/DClaw-Setup-1.0.0.exe)
npm run build:electron

# 生成解包目录（调试用）
npm run build:electron:dir
```

### 许可证激活流程

1. 启动 exe → 显示机器指纹（HWID）
2. 将指纹发给管理员获取激活码
3. 输入激活码完成授权
4. 或点击"试用"获得 24 小时试用期

### 生成激活码

```bash
# 生成 RSA 密钥对（首次）
npm run keygen:generate

# 交互式生成激活码（需提供对方机器指纹）
npm run keygen
```

---

## 项目结构

```
db-unify/
├── src/                          # 前端源码
│   ├── components/
│   │   ├── auth/                 # 登录页、激活页
│   │   ├── backup/               # 备份恢复界面
│   │   ├── connection/           # 连接管理（表单、批量导入、面板）
│   │   ├── database-tree/        # 四层树组件
│   │   ├── driver/               # 驱动管理
│   │   ├── execution/            # 执行状态面板
│   │   ├── history/              # 执行历史
│   │   ├── layout/               # 布局组件（顶栏、底栏、面板）
│   │   ├── results/              # 结果展示（表格、对比视图）
│   │   └── sql-editor/           # SQL 编辑器 (Monaco)
│   ├── hooks/                    # 自定义 Hooks
│   ├── services/                 # API 服务层（12 个模块）
│   ├── stores/                   # Zustand 状态管理（7 个 Store）
│   ├── types/                    # TypeScript 类型定义
│   └── utils/                    # 工具函数
├── electron/                     # Electron 桌面端
│   ├── main.mjs                  # 主进程（窗口管理 + 后端启动 + IPC）
│   ├── preload.mjs               # 预加载脚本 (ESM, 开发)
│   └── preload.cjs               # 预加载脚本 (CJS, 生产)
├── server/                       # 后端
│   ├── index.mjs                 # 入口，中间件注册
│   ├── database.mjs              # JSON 文件持久化 + 内存缓存
│   ├── crypto.mjs                # AES-256-GCM 密码加解密
│   ├── license.mjs               # RSA 签名授权系统
│   ├── logger.mjs                # Winston 结构化日志
│   ├── sqlValidator.mjs          # SQL 校验（只读/危险操作拦截）
│   ├── hgdb-bridge.mjs           # Java JDBC 桥接
│   ├── middleware/
│   │   └── auth.mjs              # JWT 认证中间件
│   └── routes/
│       ├── auth.mjs              # 登录/注册
│       ├── connections.mjs       # 连接 CRUD + 测试
│       ├── tree.mjs              # 层级树 CRUD + 排序
│       ├── execute.mjs           # SSE 批量 SQL 执行
│       ├── history.mjs           # 执行历史
│       ├── scripts.mjs           # SQL 脚本管理
│       ├── drivers.mjs           # 驱动管理
│       └── backup.mjs            # 备份恢复
├── Dockerfile                    # 多阶段构建
├── docker-compose.yml            # 容器编排 (含 Nginx)
├── nginx.conf                    # Nginx 反向代理配置
├── electron-builder.yml          # Electron 打包配置
├── .env.example                  # 环境变量模板
└── .github/workflows/ci.yml      # CI 流水线
```

---

## API 端点

### 认证

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/auth/login` | 用户登录 | 否 |
| POST | `/api/auth/register` | 用户注册 | 否 |

### 连接管理

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/connections` | 连接列表（密码脱敏） | 是 |
| POST | `/api/connections` | 创建连接 | 是 |
| PUT | `/api/connections/:id` | 更新连接 | 是 |
| DELETE | `/api/connections/:id` | 删除连接 | 是 |
| POST | `/api/connections/test` | 测试连接 | 是 |
| POST | `/api/connections/schemas` | 发现 Schema | 是 |
| POST | `/api/connections/databases` | 发现数据库列表 | 是 |
| POST | `/api/connections/bulk-import` | CSV 批量导入连接 | 是 |

### 层级树

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/tree` | 获取层级树 | 是 |
| POST | `/api/tree/node` | 创建节点 | 是 |
| PUT | `/api/tree/node/:id` | 更新节点 | 是 |
| DELETE | `/api/tree/node/:id` | 删除节点 | 是 |
| PUT | `/api/tree/reorder` | 节点排序 | 是 |

### 执行与历史

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/api/execute` | 批量执行 SQL（SSE 流式） | 是 |
| GET | `/api/history` | 执行历史查询 | 是 |
| DELETE | `/api/history/:id` | 删除历史记录 | 是 |

### 其他

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/api/health` | 健康检查 | 否 |
| GET | `/api/drivers` | 驱动列表 | 是 |
| POST | `/api/drivers` | 添加驱动 | 是 |
| GET/POST/PUT/DELETE | `/api/scripts` | SQL 脚本 CRUD | 是 |
| POST | `/api/backup/export` | 导出数据备份 | 是 |
| POST | `/api/backup/import` | 导入数据恢复 | 是 |

---

## 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动前后端开发服务 |
| `npm run dev:frontend` | 仅启动前端 |
| `npm run dev:backend` | 仅启动后端（nodemon 热重载） |
| `npm run dev:electron` | 启动 Electron 开发模式 |
| `npm run build` | TSC + Vite 生产构建 |
| `npm run build:electron` | 构建 + electron-builder 打包 |
| `npm run build:electron:dir` | 构建 + 输出解包目录 |
| `npm test` | 运行测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run keygen` | 交互式激活码生成器 |
| `npm run keygen:generate` | 生成 RSA 4096 密钥对 |

---

## Docker 部署

```bash
# 构建并启动（含 Nginx 反向代理）
docker compose up -d

# 仅启动应用容器
docker compose up -d db-unify

# 查看日志
docker compose logs -f db-unify

# 停止
docker compose down
```

生产环境请务必在 `.env` 中设置 `ENCRYPTION_KEY` 和 `JWT_SECRET`。

---

## License

MIT
