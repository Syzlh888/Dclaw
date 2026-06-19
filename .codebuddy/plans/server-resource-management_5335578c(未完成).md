---
name: server-resource-management
overview: 为 DClaw 增加「服务器资源管理」功能，统一管理服务器主机、数据库实例、应用 URL 三类资产，支持 Excel 导入导出、AES-256 密码加密、与现有数据库连接深度联动，以全屏视图方式切换使用。
design:
  architecture:
    framework: react
    component: mui
  styleKeywords:
    - Material Design
    - 左右分栏
    - 专业运维仪表板
    - 紧凑信息密度
  fontSystem:
    fontFamily: PingFang SC
    heading:
      size: 20px
      weight: 600
    subheading:
      size: 14px
      weight: 500
    body:
      size: 13px
      weight: 400
  colorSystem:
    primary:
      - "#1565C0"
      - "#1976D2"
      - "#1E88E5"
    background:
      - "#FFFFFF"
      - "#FAFAFA"
      - "#F5F5F5"
    text:
      - "#212121"
      - "#616161"
      - "#9E9E9E"
    functional:
      - "#2E7D32"
      - "#D32F2F"
      - "#ED6C02"
      - "#1565C0"
todos:
  - id: define-types
    content: 扩展 src/types/connection.ts（DbConnection 新增可选 serverId），新建 src/types/server.ts 定义 ServerHost/DbInstance/AppInstance 类型及 Excel 列映射配置
    status: pending
  - id: add-backend-route
    content: 在 server/database.mjs 的 DATA_FILES 新增 servers，新建 server/routes/servers.mjs（CRUD + 批量导入 + 密码解密接口），在 server/index.mjs 挂载路由
    status: pending
    dependencies:
      - define-types
  - id: add-server-store
    content: 新建 src/stores/serverStore.ts（Zustand，含 servers/map、选中ID、loading、CRUD actions、导入导出 actions）
    status: pending
    dependencies:
      - define-types
  - id: add-server-service
    content: 新建 src/services/serverService.ts（API 封装：fetchServers/createServer/updateServer/deleteServer/importServers/decryptPassword），复用 apiClient
    status: pending
    dependencies:
      - define-types
  - id: build-left-panel
    content: 新建 src/components/server-resource/ServerListPanel.tsx（左侧面板：搜索框 + 操作按钮组 + MUI List 服务器列表，选中高亮）
    status: pending
    dependencies:
      - add-server-store
      - add-server-service
  - id: build-detail-panel
    content: 新建 src/components/server-resource/ServerDetailPanel.tsx（右侧详情面板：顶部操作栏 + 四个 MUI Tab：基本信息/数据库实例/应用实例/关联连接）
    status: pending
    dependencies:
      - add-server-store
      - add-server-service
  - id: build-import-dialog
    content: 使用 [skill:xlsx] 分析用户 Excel 文档生成列映射表，新建 src/components/server-resource/ServerImportDialog.tsx（xlsx 解析 + 智能列映射 + 预览 + 批量入库 + 进度提示）
    status: pending
    dependencies:
      - add-server-service
  - id: build-main-view
    content: 新建 src/components/server-resource/ServerResourceView.tsx（全屏左右分栏主视图，整合左侧列表和右侧详情，可拖拽调整分栏宽度）
    status: pending
    dependencies:
      - build-left-panel
      - build-detail-panel
      - build-import-dialog
  - id: integrate-app
    content: 修改 src/App.tsx（新增 mainView 状态和条件渲染），修改 src/components/layout/AppHeader.tsx（新增"服务器资源"切换按钮），确保与现有 SQL 编辑器视图无缝切换
    status: pending
    dependencies:
      - build-main-view
  - id: link-connections
    content: 修改 src/types/connection.ts 确保 serverId 字段生效，修改 ConnectionForm 增加"从服务器资源快速填充"入口，实现连接与服务器的双向关联
    status: pending
    dependencies:
      - integrate-app
---

## 产品概述

在 DClaw（数据钳）中新增「服务器资源管理」功能模块。用户可从顶栏点击按钮切换到全屏管理视图，统一管理三类资产——**服务器主机**、**数据库实例**（子资源）、**应用实例**（子资源）。支持从用户现有 `临沂市卫健委服务器信息.xlsx` 一键导入 10 个 Sheet 的全部数据，密码使用 AES-256-GCM 加密存储。服务器记录可直接关联现有数据库连接（DbConnection），实现基础设施与数据库联动。

## 核心功能

- **全屏双栏视图**：左侧服务器列表（可搜索/筛选/分组），右侧详情面板（基本信息 + 子资源标签页）
- **三类资产统一管理**：服务器主机（IP/OS/资源规格/堡垒机/凭据）、数据库实例（类型/库名/端口/凭据）、应用实例（URL/凭据）
- **Excel 一键导入**：选择 xlsx 文件 → 自动解析所有 Sheet → 智能列映射 → 预览确认 → 批量合并入库，密码自动加密
- **连接联动**：服务器详情展示已关联的 DbConnection 列表；新建连接时可从服务器快速填入主机IP和端口
- **凭据加密**：所有密码字段（服务器密码、数据库密码、应用密码、堡垒机密码）统一使用 AES-256-GCM 加密，与现有 crypto.mjs 一致
- **CRUD 操作**：新增、编辑、删除服务器记录及其子资源
- **导出 Excel**：将当前服务器列表导出为结构化的 xlsx 文件

## 技术栈

- 前端：React 18 + TypeScript + MUI v5 + Zustand 4 + Tailwind CSS
- 后端：Express 4 (server/routes/servers.mjs) + JSON 文件持久化 (database.mjs)
- 加密：复用 server/crypto.mjs 的 AES-256-GCM
- Excel 解析：前端使用 `xlsx` 包（项目已依赖）解析用户文件，结构化数据后提交后端；后端 `multer` 处理上传（可选）

## 实现方案

### 整体策略

遵循 DClaw 现有架构模式：**types → store → services → components（前端）+ routes → database.mjs（后端）**。在 App.tsx 中新增 `view` 状态值 `'server-resource'`，通过 AppHeader 新增按钮切换视图，主内容区整体替换为服务器资源管理全屏界面。

### 核心数据模型

三类实体，以服务器主机为根，数据库实例和应用实例挂载其下：

```typescript
// src/types/server.ts
interface ServerHost {
  id: string;
  name: string;
  internalIp: string;
  externalIp?: string;
  publicIp?: string;
  crossNetworkIp?: string;
  os?: string;
  cpuCores?: number;
  memoryGB?: number;
  systemDiskGB?: number;
  dataDiskGB?: number;
  storageType?: string;
  bandwidthMbps?: number;
  location?: string;
  serverType?: string;
  category?: string;
  bastionHost?: string;
  bastionPort?: number;
  bastionUsername?: string;
  bastionPassword?: string;
  vpnInfo?: string;
  macAddress?: string;
  deployedContent?: string;
  notes?: string;
  // 关联的数据库连接 ID 列表
  linkedConnectionIds: string[];
  dbInstances: DbInstance[];
  appInstances: AppInstance[];
  createdAt: string;
  updatedAt: string;
}

interface DbInstance {
  id: string;
  dbType: string;
  version?: string;
  dbName: string;
  schema?: string;
  username: string;
  password: string;
  internalIp?: string;
  externalIp?: string;
  port?: number;
  location?: string;
  usageDescription?: string;
}

interface AppInstance {
  id: string;
  name: string;
  url: string;
  username?: string;
  password?: string;
}
```

### 与现有连接的联动

- `DbConnection` 新增可选字段 `serverId?: string`，指向关联的 ServerHost
- 服务器详情面板展示已关联连接列表（从 connectionStore 筛选）
- 新建连接表单增加"从服务器资源选择"的快速填充入口

### 视图切换机制

App.tsx 中新增 `mainView: 'sql-editor' | 'server-resource'` 状态，顶栏按钮切换。主内容区根据 mainView 条件渲染：

- `'sql-editor'`：现有 SqlEditor + 底部 Tab
- `'server-resource'`：新的 ServerResourceView 全屏组件

### 后端 API 设计

```
GET    /api/servers              — 列表（密码脱敏）
GET    /api/servers/:id          — 详情（密码脱敏）
POST   /api/servers              — 创建（密码加密存储）
PUT    /api/servers/:id          — 更新
DELETE /api/servers/:id          — 删除
POST   /api/servers/import       — Excel 批量导入（接收结构化 JSON）
POST   /api/servers/decrypt-pass — 请求解密指定记录的密码（需确认）
```

### 密码处理策略

- **存储**：所有密码字段经 encryptPassword() 加密后写入 `servers.json`
- **传输**：GET 列表/详情接口返回密码脱敏为 `'******'`
- **查看**：前端提供"显示密码"按钮，调用解密接口获取明文（需确认操作，可选二次认证）
- 加密模式完全复用 `server/crypto.mjs` 已有的 `encryptPassword`/`decryptPassword`

### 性能考量

- 服务器列表使用 MUI Table 分页（每页 50 条），877+ 条数据不会有性能压力
- Excel 解析在前端完成，避免大文件上传和内存占用（xlsx 包轻量解析）
- 导入采用批量写入，`database.mjs` 的 enqueueWrite 保证写入串行
- 左侧服务器列表支持按名称/IP/分类的关键词实时过滤

### 避免技术债务

- 严格遵循现有的 types → store → services → components 分层模式
- 复用 database.mjs 通用 CRUD（getAll/getById/insert/update/remove）
- 复用 crypto.mjs 加解密，不引入新的加密逻辑
- 复用 AppHeader 按钮样式，保持 UI 一致性
- 不在现有组件中植入服务器管理逻辑，保持模块独立

## 设计风格

延续 DClaw 现有 Material Design 风格，采用 MUI 组件体系。全屏视图采用左右分栏布局，左侧为可调宽度的服务器列表面板，右侧为详情展示区。

## 全屏视图布局

```
┌──────────────────────────────────────────────────────┐
│  AppHeader (48px)  [返回编辑器] [服务器资源]          │
├──────────────────┬───────────────────────────────────┤
│  左侧面板(320px)  │  右侧详情面板                       │
│  ┌──────────────┐│  ┌─────────────────────────────┐  │
│  │搜索框         ││  │ [服务器名称] [编辑] [删除]    │  │
│  ├──────────────┤│  ├─────────────────────────────┤  │
│  │[导入Excel]   ││  │ Tab: 基本信息 | 数据库实例 |   │  │
│  │[新建服务器]   ││  │      应用实例 | 关联连接        │  │
│  │[导出Excel]   ││  ├─────────────────────────────┤  │
│  ├──────────────┤│  │                             │  │
│  │服务器列表      ││  │  选中 Tab 的内容              │  │
│  │(虚拟滚动)     ││  │                             │  │
│  │- 服务器A      ││  │                             │  │
│  │- 服务器B ★    ││  │                             │  │
│  │- 服务器C      ││  │                             │  │
│  └──────────────┘│  └─────────────────────────────┘  │
└──────────────────┴───────────────────────────────────┘
```

## 页面区块

### 顶栏切换按钮

AppHeader 新增"服务器资源"按钮，与现有"驱动管理""连接管理"并列。点击切换到服务器管理全屏视图，视图内显示"返回编辑器"按钮退出。

### 左侧列表面板

顶部依次为搜索输入框（实时过滤）、操作按钮组（导入Excel/新建服务器/导出Excel）。下方为服务器列表，每行展示服务器名称、内网IP、操作系统图标、数据库实例数量徽章。选中行高亮，点击切换右侧详情。

### 右侧详情面板

顶部显示服务器名称、编辑和删除操作按钮。下方四个 MUI Tab 标签页：

- **基本信息**：IP地址组、操作系统、硬件规格（CPU/内存/存储）、堡垒机信息、VPN信息、备注。凭据字段旁有"显示/隐藏"按钮
- **数据库实例**：子表格列表，支持新增/编辑/删除，展示类型、库名、IP、端口、用户
- **应用实例**：子表格列表，展示系统名称、URL、用户名
- **关联连接**：显示关联的 DbConnection 列表，支持绑定/解绑操作

### 导入对话框

选择 xlsx 文件后，前端解析所有 Sheet，自动映射列名（支持中文列名智能匹配）。预览表格展示前 10 条数据，用户确认后批量入库。显示导入进度和统计结果。

## Agent Extensions

### Skill

- **xlsx**
- 用途：解析用户提供的 `临沂市卫健委服务器信息.xlsx`，分析 10 个 Sheet 的列结构，提取列名映射关系，为前端 Excel 导入功能生成智能列映射配置
- 预期结果：产出一个列名映射表（中文列名 → 统一数据模型字段），用于前端导入时自动识别各 Sheet 的列含义

### SubAgent

- **code-explorer**
- 用途：在实现阶段探索现有模块的详细代码模式（store 标准写法、API 路由结构、MUI 表单组件模式），确保新增代码与现有风格一致
- 预期结果：获取现有连接管理模块的完整代码模式参考，确保服务器管理模块实现与之对齐