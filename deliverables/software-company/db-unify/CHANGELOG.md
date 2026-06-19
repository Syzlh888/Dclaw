# Changelog

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
