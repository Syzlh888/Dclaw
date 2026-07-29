# 数据同步功能 — 规划设计 v1.1

> **文档版本**: v1.1（v1.0 更新版）
> **创建日期**: 2025-07-10
> **v1.1 更新日期**: 2026-07-28
> **项目**: DClaw（db-unify）v1.2.0+
> **状态**: 待评审（v1.1 待评审，v1.0 已结案）
> **原文档**: `docs/data-sync-design.md`（v1.0，1381 行）

---

## 0. v1.0 → v1.1 变更说明（2026-07-28）

### 0.1 关键调整

| # | 变更点 | v1.0 | v1.1 决策 | 理由 |
|---|--------|------|-----------|------|
| 1 | CDC 实时同步 | E5（v2.2） | **永久剔除** | 引入 Kafka + Debezium，部署复杂度高 + 资源占用大；DClaw 信创场景资源有限；30秒级轮询延迟对绝大多数业务足够 |
| 2 | "准实时"模式 | 未规划 | **新增 F9：定时轮询模式**（P0） | 复用 v1.0 增量同步 + `node-cron` 调度器，实现"准实时"同步，最快 1s 轮询 |
| 3 | 持久化层 | JSON 文件 | **改为 PostgreSQL 表** | JSON 文件断电易丢、难查询。同步历史落 PG：3 张表 `sync_history` / `sync_tasks` / `sync_checkpoints` |
| 4 | 权限校验 | 未提及 | **新增：同步任务级 RBAC + 敏感表黑名单** | DROP/DELETE 是高危操作，复用 DClaw 现有角色权限系统 |
| 5 | 瀚高/达梦/金仓类型映射 | 附录 9.1 缺 | **新增：国产数据库类型映射表** | DClaw 实际场景中瀚高/达梦/金仓是高频目标，原映射表只覆盖 4 类 DB |
| 6 | Checkpoint 存储 | 未明确 | **同步任务级落 PG `sync_checkpoints` 表** | 增量模式必备，否则重启丢失 |
| 7 | 多任务依赖编排（E4） | v2.1 | 维持不变 | 用例不多 |
| 8 | DDL 同步（E3） | v2.0 | **提前到 v1.5（优先于 v2.0）** | 涉及差异比对+迁移，风险较高，先稳固数据同步主线 |

### 0.2 已确认的决策点（与用户对齐）

> **用户决策（2026-07-28）**：
> - ❌ 暂时不做 CDC 实时同步（基于日志/Debezium 解析）
> - ✅ 通过「**定时轮询**」实现"准实时"同步
> - ✅ 后续以"增量同步 + 调度器"为基础继续拓展
> - ✅ 准实时最常见周期：**30 秒 ~ 5 分钟**（用户实际运维场景）

---

## 1. 需求概述

### 1.1 业务背景

DClaw 当前的核心能力是「多库同一 SQL 批量执行与结果对比」——在大量同构/异构数据库上执行相同查询并聚合结果。然而在实际数据库运维场景中，数据同步（Data Sync）是一个高频刚需：

- **跨环境同步**：将生产库的配置表或基础数据同步到测试库
- **异构迁移**：MySQL 表数据迁移到 PostgreSQL（或瀚高等国产数据库）
- **增量采集**：定时将各业务库的新增数据聚合到中心数据仓库
- **表结构对齐**：将源库的 DDL 变更同步应用到目标库，保证 Schema 一致性

当前 DClaw 已有批量执行引擎（`/api/execute`）、元数据发现（`/api/connections/:id/metadata`）、DDL 获取（`/api/connections/:id/ddl`），这些基础设施直接支撑数据同步功能的实现。

### 1.2 目标用户

| 角色 | 场景 |
|------|------|
| **DBA / 运维工程师** | 日常跨库数据同步、生产→测试环境数据刷新 |
| **数据开发** | 异构数据库间的 ETL 式数据传输 |
| **平台管理员** | 定时将下辖各业务库数据汇总到中心库（30 秒/5 分钟轮询） |

### 1.3 功能边界

**在范围（v1.x 核心功能）：**

- 同构/异构数据库间的表级数据同步（全量 + 增量）
- 可视化字段映射 + 自动类型转换
- 同步前预览差异（INSERT/UPDATE/DELETE 统计）
- Dry-Run 模式（只生成 SQL 不执行）
- 过滤条件（WHERE 子句）
- 分批读取（大表分页）+ 事务保护
- **【v1.1 新增】定时轮询模式（准实时同步）**
- **【v1.1 新增】同步任务模板保存 + Checkpoint 持久化**
- **【v1.1 新增】任务级 RBAC + 敏感表黑名单**
- **【v1.1 新增】瀚高/达梦/金仓类型映射**

**不在范围（v1.x 永久剔除 + v2.x 未来特性）：**

- ❌ **CDC 实时同步（基于 Debezium / 日志解析）** — 永久剔除
- ❌ 整库同步（仅支持表级）
- ❌ 双向同步 / 冲突解决（单向同步为主）
- ⏸️ DDL 同步（推迟到 v1.5）
- ⏸️ 多任务依赖编排（v2.1+）

---

## 2. 功能规划

### 2.1 核心功能（v1.x）

| # | 功能 | 说明 | 优先级 | 版本 |
|---|------|------|--------|------|
| F1 | 全量同步 | 源表全量数据 SELECT → INSERT 到目标表 | P0 | v1.0 |
| F2 | 增量同步 | 基于时间戳字段或自增 ID 字段筛选新增/变更行 | P0 | v1.0 |
| F3 | 字段映射 | 自动按名称匹配 + 手动拖拽编辑映射关系 | P0 | v1.0 |
| F4 | 类型转换 | 跨数据库类型自动转换（MySQL↔PG↔瀚高↔达梦↔金仓） | P0 | v1.1 |
| F5 | 过滤条件 | 用户自定义 WHERE 子句筛选同步数据 | P1 | v1.0 |
| F6 | 预览模式 | 执行前比对源/目标表，展示 INSERT/UPDATE/DELETE 行数统计 | P1 | v1.0 |
| F7 | Dry-Run | 仅生成同步 SQL 脚本，不实际执行 | P1 | v1.0 |
| F8 | 分批读取 | 大表按行数分批读取，避免内存溢出 | P0 | v1.0 |
| F9 | 事务保护 | 每批数据在一个事务内写入（同构数据库），失败回滚 | P0 | v1.0 |
| F10 | 同步历史 | 记录每次同步的配置、行数、耗时、状态（落 PG） | P0 | v1.1 |
| **F11** | **【v1.1】定时轮询（准实时）** | **基于 `node-cron`，按配置间隔（如 1s/5s/30s/1min/5min）自动触发增量同步，实现"准实时"** | **P0** | **v1.1** |
| **F12** | **【v1.1】任务模板保存** | **将同步配置（源/目标/字段映射/增量字段/过滤条件）保存为可复用的任务模板，下次直接「打开任务 → 立即执行」** | **P0** | **v1.1** |
| **F13** | **【v1.1】Checkpoint 持久化** | **增量同步进度（最后更新时间戳/最大 ID）落到 PG `sync_checkpoints` 表，重启不丢** | **P0** | **v1.1** |
| **F14** | **【v1.1】任务级 RBAC** | **执行/查看/删除/启停 任务按角色控制；敏感表黑名单（不允许同步含 `password`/`id_card` 的表）；操作审计日志** | **P0** | **v1.1** |
| **F15** | **【v1.1】国产数据库类型映射** | **新增瀚高/达梦/金仓类型映射表（DClaw 实际高频目标）** | **P0** | **v1.1** |

### 2.2 扩展功能（v2.0+ / 永久剔除）

| # | 功能 | 说明 | 规划版本 |
|---|------|------|----------|
| ~~E5~~ | ~~CDC 实时同步~~ | ~~基于 Debezium / 日志解析~~ | **❌ 永久剔除（v1.1 决策）** |
| E1 | 多任务并行编排 | 配置多任务并发执行（线程池） | v2.0 |
| E2 | 任务依赖（DAG） | T1 → T2 → T3 串/并混跑 | v2.1 |
| E3 | DDL 同步 | 目标表自动创建/变更（结构化 Schema diff） | **v1.5（提前）** |
| E4 | 邮件/Webhook 通知 | 同步完成/失败时钉钉/企微/飞书 webhook 推送 | v2.0 |
| E6 | 回滚（Rollback） | 同步前快照 → 自动生成反向 SQL | v2.0 |
| E7 | 数据脱敏（Masking） | 同步时自动脱敏身份证/手机号等敏感字段 | v2.1 |
| E8 | Web 管理界面 | 任务列表 + 运行统计面板 | v2.0 |

---

## 3. 总体架构（v1.1 增量调整）

### 3.1 新增模块

```
┌──────────────────────────────────────────────────────────────────┐
│                          前端 (React)                             │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  DataSyncPage                                              │   │
│  │  ├── SyncConfigPanel    — 源/目标选择 + 模式配置          │   │
│  │  ├── FieldMappingPanel  — 拖拽映射（自动+手动）           │   │
│  │  ├── FilterPanel        — WHERE 条件编辑                  │   │
│  │  ├── PreviewPanel       — 差异统计 + 数据预览             │   │
│  │  ├── DryRunResultPanel  — 生成的 SQL 脚本展示             │   │
│  │  ├── ExecProgressPanel  — 同步执行进度（SSE）             │   │
│  │  ├──  ⭐【v1.1】SchedulePanel  — 定时轮询配置              │   │
│  │  │     ├── IntervalSelector  — 间隔选择（1s/5s/30s/1m/5m） │   │
│  │  │     ├── CronEditor        — Cron 表达式高级模式         │   │
│  │  │     └── EnableToggle      — 启停轮询                   │   │
│  │  └──  ⭐【v1.1】TaskListPanel — 保存的任务模板列表         │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│                       后端 API (Express)                          │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  /api/sync/*                                              │   │
│  │  ├── POST   /configure     — 获取源/目标元数据            │   │
│  │  ├── POST   /preview       — 差异比对 + 统计              │   │
│  │  ├── POST   /dry-run       — 生成同步 SQL（不执行）       │   │
│  │  ├── POST   /execute       — 执行同步（SSE 流式推送）    │   │
│  │  ├── GET    /history       — 同步历史列表                 │   │
│  │  ├── GET    /history/:id   — 同步详情                     │   │
│  │  ├── ⭐【v1.1】POST   /tasks            — 保存任务模板    │   │
│  │  ├── ⭐【v1.1】GET    /tasks            — 任务模板列表    │   │
│  │  ├── ⭐【v1.1】PUT    /tasks/:id        — 更新任务模板    │   │
│  │  ├── ⭐【v1.1】DELETE /tasks/:id        — 删除任务模板    │   │
│  │  ├── ⭐【v1.1】POST   /tasks/:id/run    — 立即执行任务    │   │
│  │  ├── ⭐【v1.1】POST   /tasks/:id/start  — 启动轮询      │   │
│  │  ├── ⭐【v1.1】POST   /tasks/:id/stop   — 停止轮询      │   │
│  │  └── ⭐【v1.1】GET    /tasks/:id/checkpoint — 当前 checkpoint │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│  同步引擎层 + 调度器层（v1.1 新增调度器）                        │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  syncEngine.mjs               — 同步引擎核心             │   │
│  │  ├── compare.mjs              — 差异比对算法              │   │
│  │  ├── transformer.mjs          — 字段映射 + 类型转换        │   │
│  │  ├── batchReader.mjs          — 分批读取器                │   │
│  │  └── sqlBuilder.mjs           — 跨库 SQL 生成器           │   │
│  │  ⭐【v1.1】syncScheduler.mjs — 定时轮询调度器            │   │
│  │       • 基于 `node-cron`                                    │   │
│  │       • 支持简单间隔（1s/5s/30s/1m/5m/15m/30m/1h）       │   │
│  │       • 支持 Cron 表达式（高级模式）                       │   │
│  │       • 启停控制（任务级）                                 │   │
│  │       • 并发锁（防重叠执行）                               │   │
│  │       • 任务执行日志                                       │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│  持久化层（v1.1 由 JSON 文件改为 PostgreSQL 表）                  │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  sync_history         — 每次同步执行的详情                │   │
│  │  sync_tasks           — 保存的同步任务模板                │   │
│  │  sync_checkpoints     — 增量同步进度（按任务粒度）       │   │
│  │  sync_audit_log       — ⭐【v1.1】同步操作审计日志      │   │
│  │  sync_table_blacklist — ⭐【v1.1】敏感表黑名单          │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 新增/修改文件清单

#### 后端新增（v1.1）

| 文件 | 路径 | 说明 |
|------|------|------|
| `sync.mjs` | `server/routes/sync.mjs` | 数据同步路由（v1.0 含配置/预览/Dry-Run/执行/历史；v1.1 新增任务模板/启停 API） |
| `syncEngine.mjs` | `server/sync/syncEngine.mjs` | 同步引擎核心：全量、增量、批量执行 |
| `compare.mjs` | `server/sync/compare.mjs` | 差异比对算法（全表比对 / 键值比对） |
| `transformer.mjs` | `server/sync/transformer.mjs` | 字段映射解析 + 类型转换规则 |
| `batchReader.mjs` | `server/sync/batchReader.mjs` | 分批读取器（分页流式读取） |
| `sqlBuilder.mjs` | `server/sync/sqlBuilder.mjs` | 跨库 SQL 生成（INSERT/UPDATE/DELETE） |
| **`syncScheduler.mjs`** ⭐ | `server/sync/syncScheduler.mjs` | **v1.1 新增：定时轮询调度器** |
| **`syncTypes.mjs`** ⭐ | `server/sync/syncTypes.mjs` | **v1.1 新增：CRUD 持久化（PG 表操作）** |

#### 前端新增（v1.1）

| 文件 | 路径 | 说明 |
|------|------|------|
| `DataSyncPage.tsx` | `src/components/data-sync/DataSyncPage.tsx` | 数据同步主页面 |
| `SyncConfigPanel.tsx` | `src/components/data-sync/SyncConfigPanel.tsx` | 源/目标选择面板 |
| `FieldMappingPanel.tsx` | `src/components/data-sync/FieldMappingPanel.tsx` | 字段映射拖拽面板 |
| `FilterPanel.tsx` | `src/components/data-sync/FilterPanel.tsx` | WHERE 过滤条件编辑 |
| `PreviewPanel.tsx` | `src/components/data-sync/PreviewPanel.tsx` | 差异预览面板 |
| `DryRunResultPanel.tsx` | `src/components/data-sync/DryRunResultPanel.tsx` | Dry-Run SQL 展示 |
| **`SchedulePanel.tsx`** ⭐ | `src/components/data-sync/SchedulePanel.tsx` | **v1.1 新增：定时轮询配置** |
| **`TaskListPanel.tsx`** ⭐ | `src/components/data-sync/TaskListPanel.tsx` | **v1.1 新增：任务模板列表** |
| `dataSyncStore.ts` | `src/stores/dataSyncStore.ts` | 数据同步 Zustand 状态管理 |
| `dataSyncService.ts` | `src/services/dataSyncService.ts` | 数据同步 API 调用封装 |
| `sync.ts` | `src/types/sync.ts` | 数据同步 TypeScript 类型定义 |

#### 持久化新增（v1.1 由 JSON 改 PG）

| 文件 | 路径 | 说明 |
|------|------|------|
| `sync_history.json` → `sync_history` PG 表 | — | 同步执行历史记录 |
| `sync_tasks.json` → `sync_tasks` PG 表 | — | 保存的同步任务配置 |
| `sync_checkpoints` ⭐ PG 表 | — | **v1.1 新增：增量同步 checkpoint** |
| `sync_audit_log` ⭐ PG 表 | — | **v1.1 新增：同步操作审计** |
| `sync_table_blacklist` ⭐ PG 表 | — | **v1.1 新增：敏感表黑名单** |

> **迁移说明**：v1.0 原计划的 JSON 文件存储，v1.1 起改为 PostgreSQL 表。原因：JSON 文件断电易丢、难查询、不支持索引。DClaw 主存储本来就用 PG，统一存储方案。

### 3.3 与现有系统集成

#### 复用已有基础设施

| 现有模块 | 复用方式 |
|---------|---------|
| `connections.mjs` 中的 `createDbConnection` | 直接复用 — 同步引擎需要同时连接源库和目标库 |
| `connections.mjs` 中的 `executeQuery` | 直接复用 — 执行 SELECT 读取源数据 |
| `connections.mjs` 中的 `closeConnection` | 直接复用 — 同步完成后关闭连接 |
| `connections.mjs` 中的 `discoverMetadata` | 复用 — 获取源/目标表的列信息用于字段映射 |
| `connections.mjs` 中的 `resolveRealDriver` | 复用 — 判断实际数据库类型以适配 SQL 语法 |
| `execute.mjs` 中的 SSE 推送模式 | 复用 — 同步执行状态也通过 SSE 流式推送 |
| `execute.mjs` 中的并发池模式 | 复用 — 多目标库同步时并发执行 |
| `database.mjs` 中的 `getAll/insert/update` | 复用 — 持久化同步历史（从 PG JSON 改成 PG 表） |
| `crypto.mjs` 中的 `decryptPassword` | 复用 — 解密连接密码 |
| `sqlValidator.mjs` | 复用 — 检查生成的 SQL 安全性 |
| `Stores` 模式（executionStore 等） | 复用 — dataSyncStore 按相同范式编写 |
| `Services` 模式（executionService 等） | 复用 — dataSyncService 按相同范式编写 |
| **`node-cron`** ⭐ | **新增依赖 — 用于定时轮询调度器** |

> **新增依赖清单**：
> - `node-cron`（npm 包，轻量、稳定、生态成熟）

> **不需要安装**：
> - ❌ Kafka（CDC 永久剔除）
> - ❌ Debezium（CDC 永久剔除）
> - ❌ Redis（暂未规划为依赖）
> - ❌ 其他重型中间件

#### 导航集成

在左侧导航栏或顶部标签栏新增「数据同步」入口，可复用已有的路由切换机制。建议在数据库树和 SQL 编辑器之间增加一个同步按钮，用户选中源库/源表后点击即可跳转到同步配置界面。

---

## 4. 同步引擎设计

### 4.1 同步模式详解

#### 4.1.1 全量同步（Full Sync）

```
流程:
1. SELECT * FROM source_table [WHERE condition]
2. TRUNCATE / DELETE target_table（可选，由用户决定）
3. INSERT INTO target_table (col1, col2, ...) VALUES (v1, v2, ...)
```

**说明**：
- 最简单的同步模式，每次都重新生成目标数据
- 适用于首次迁移、配置表同步、生产→测试数据刷新
- 大表（千万级以上）需要分批读取 + 事务

#### 4.1.2 增量同步（Incremental Sync）⭐ 是 v1.1 重点

```
流程:
1. 读取 checkpoint（最后同步成功的最大时间戳/最大 ID）
2. SELECT * FROM source_table
   WHERE updated_at > :checkpoint  
      OR id > :checkpoint
3. UPSERT INTO target_table  
   ON CONFLICT (pk) DO UPDATE SET ...
4. 更新 checkpoint = max(updated_at) OR max(id)
5. 落 PG `sync_checkpoints` 表
```

**两种增量字段选择**：

| 类型 | 适用 DB | 优势 | 劣势 |
|------|--------|------|------|
| **时间戳**（`updated_at`） | MySQL、PG、瀚高、达梦、金仓 | 直观，可读 | 需源表已有该字段；不存在的要新增 |
| **自增 ID**（`id`） | 所有 DB | 必存在字段 | 不能捕获「更新但 ID 不变」的情况 |

**v1.1 推荐**：两种都支持，让用户选择。**定时轮询模式默认用时间戳**。

#### 4.1.3 差异同步（Diff Sync）

```
流程:
1. SELECT pk, row_hash FROM source_table
2. SELECT pk, row_hash FROM target_table
3. 比对差异：
   - 源存在 + 目标不存在 → INSERT
   - 源存在 + 目标存在 + hash 不同 → UPDATE
   - 源不存在 + 目标存在 → DELETE（可选）
4. 生成三类 SQL 批量执行
```

**复杂度最高**，需要 PK + 全字段 hash 计算，v1.1 列入 P1。

### 4.2 ⭐ v1.1 新增：定时轮询模式（"准实时"）

```
┌────────────────────────────────────────────────────────────────┐
│                   定时轮询调度器架构                            │
├────────────────────────────────────────────────────────────────┤
│                                                                 │
│   用户配置:                                                     │
│   ┌────────────────────────┐                                  │
│   │ Task: orders_sync      │                                  │
│   │ Source: production_db  │                                  │
│   │ Target: analytics_db   │                                  │
│   │ Interval: 30 秒        │                                  │
│   │ Mode: incremental      │                                  │
│   │ Field: updated_at      │                                  │
│   └────────────────────────┘                                  │
│              │                                                  │
│              ▼                                                  │
│   ┌────────────────────────────────────┐                      │
│   │   node-cron 调度器                 │                      │
│   │   ┌──────────────────────────┐    │                      │
│   │   │ 每 30s 触发一次           │    │                      │
│   │   └──────────────────────────┘    │                      │
│   └────────────────────────────────────┘                      │
│              │                                                  │
│              ▼                                                  │
│   ┌────────────────────────────────────┐                      │
│   │   同步引擎执行增量同步              │                      │
│   │   ① 读 checkpoint                    │                      │
│   │   ② 源库 SELECT WHERE > checkpoint   │                      │
│   │   ③ 目标库 UPSERT                   │                      │
│   │   ④ 更新 checkpoint 落 PG           │                      │
│   └────────────────────────────────────┘                      │
│              │                                                  │
│              ▼                                                  │
│   ┌────────────────────────────────────┐                      │
│   │   同步历史 + 审计日志                │                      │
│   │   sync_history + sync_audit_log    │                      │
│   └────────────────────────────────────┘                      │
└────────────────────────────────────────────────────────────────┘
```

**关键设计点**：

1. **并发锁**：同一任务的上一轮还没完成时，新一轮触发应跳过（防重叠）
2. **checkpoint 容错**：cron 漏触发/重启后 checkpoint 不丢（PG 持久化）
3. **执行统计**：每轮耗时、插入/更新/删除/错误数都记录到 sync_history
4. **启停控制**：用户随时可启动/停止/立即执行一次
5. **异常处理**：连续 N 次失败自动告警（v2.x 邮件/webhook 通知）

---

## 5. API 设计

### 5.1 原有 API（v1.0）

| Method | 路径 | 说明 |
|--------|------|------|
| POST | `/api/sync/configure` | 获取源/目标元数据 |
| POST | `/api/sync/preview` | 差异比对 + 统计 |
| POST | `/api/sync/dry-run` | 生成同步 SQL（不执行） |
| POST | `/api/sync/execute` | 执行同步（SSE 流式推送） |
| GET | `/api/sync/history` | 同步历史列表 |
| GET | `/api/sync/history/:id` | 同步详情 |

### 5.2 ⭐ v1.1 新增 API

#### 任务模板管理

| Method | 路径 | 说明 |
|--------|------|------|
| POST | `/api/sync/tasks` | 保存同步任务模板（含源/目标/字段映射/增量字段/过滤条件） |
| GET | `/api/sync/tasks` | 获取任务模板列表（分页 + 关键字搜索） |
| GET | `/api/sync/tasks/:id` | 获取单个任务模板详情 |
| PUT | `/api/sync/tasks/:id` | 更新任务模板 |
| DELETE | `/api/sync/tasks/:id` | 删除任务模板 |

#### 任务执行控制

| Method | 路径 | 说明 |
|--------|------|------|
| POST | `/api/sync/tasks/:id/run` | 立即执行一次（不等下次轮询） |
| POST | `/api/sync/tasks/:id/start` | 启动定时轮询 |
| POST | `/api/sync/tasks/:id/stop` | 停止定时轮询 |
| GET | `/api/sync/tasks/:id/status` | 查询任务当前状态（运行中/已停止/上次执行时间） |
| GET | `/api/sync/tasks/:id/checkpoint` | 查询当前 checkpoint 值 |

#### 安全管理

| Method | 路径 | 说明 |
|--------|------|------|
| GET | `/api/sync/blacklist` | 获取敏感表黑名单 |
| POST | `/api/sync/blacklist` | 添加敏感表到黑名单（需 admin 权限） |
| DELETE | `/api/sync/blacklist/:id` | 从黑名单移除（需 admin 权限） |
| GET | `/api/sync/audit-log` | 查询同步审计日志（分页） |

### 5.3 POST /api/sync/tasks 任务模板结构

```json
{
  "name": "订单数据同步到分析库",
  "description": "每 30 秒同步订单库到分析库",
  "source": {
    "connectionId": "conn_prod_orders",
    "table": "orders",
    "schema": "public"
  },
  "target": {
    "connectionId": "conn_analytics",
    "table": "orders_copy",
    "schema": "analytics"
  },
  "mode": "incremental",
  "incrementalField": {
    "name": "updated_at",
    "type": "timestamp"
  },
  "primaryKeys": ["id"],
  "fieldMappings": [
    { "source": "id", "target": "id", "isPrimaryKey": true },
    { "source": "user_id", "target": "user_id" },
    { "source": "amount", "target": "amount" },
    { "source": "status", "target": "status", "transform": "LOWER(:status)" },
    { "source": "created_at", "target": "created_at" },
    { "source": "updated_at", "target": "updated_at" }
  ],
  "filter": "status = 'active'",
  "schedule": {
    "type": "interval",           // "interval" | "cron"
    "intervalMs": 30000,          // 30 秒
    "cronExpr": null,             // 高级模式
    "enabled": true
  },
  "syncConfig": {
    "errorStrategy": "skip",
    "truncateBeforeSync": false,
    "deleteExtraInTarget": false,
    "useTransaction": true,
    "pageSize": 10000
  },
  "creator": "user_id_admin",
  "permissions": {
    "runnable": ["admin", "dba_team"],
    "viewable": ["admin", "dba_team", "audit_team"],
    "editable": ["admin", "task_creator"]
  }
}
```

---

## 6. 前端 UI 设计（v1.1 增量）

### 6.1 新增组件布局

```
┌──────────────────────────────────────────────────────────────────────┐
│  数据同步                                                    [返回]  │
├──────────────────────────────────────────────────────────────────────┤
│  [Tab 切换: 新建同步 | 任务管理 | 同步历史]                          │
│                                                                      │
│  === 新建同步 Tab（v1.0 已规划）===                                   │
│  ┌─ 第一步：选择源和目标 ─────────────────────────────────────────┐  │
│  │  ⭐【v1.1】从已保存任务快速加载:[任务下拉]                       │  │
│  │  源数据库: [conn_001 ▼]  源表: [orders ▼]  Schema: [public]   │  │
│  │  目标数据库: [conn_002 ▼] 目标表: [orders_copy ▼]             │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ 同步配置 ───────────────────────────────────────────────────┐  │
│  │  同步模式: ○ 全量同步   ● 增量同步   ○ 差异同步              │  │
│  │  增量字段: [updated_at ▼]                                    │  │
│  │  ⭐【v1.1】轮询调度:                                         │  │
│  │     ○ 不启用（仅手动执行）                                    │  │
│  │     ● 定时轮询: [30 秒 ▼]   [高级: Cron 表达式]              │  │
│  │     [▶ 立即执行]  [■ 停止轮询]  [⏸ 暂停]                     │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ 保存为任务 ────────────────────────────────────────────────┐  │
│  │  ⭐【v1.1】[💾 保存为任务模板] [✓ 自动启动轮询]               │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  === 任务管理 Tab ⭐【v1.1 新增】===                                │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 任务列表                                                    │  │
│  │ [搜索框] [筛选:运行中/已停止/全部] [刷新]                   │  │
│  │ ┌────────────────────────────────────────────────────┐     │  │
│  │ │ 任务名称              │ 模式 │ 间隔 │ 状态 │ 操作 │     │  │
│  │ ├────────────────────────────────────────────────────┤     │  │
│  │ │ 订单→分析库           │ 增量 │ 30秒 │ 运行 │ ▶■⋯ │     │  │
│  │ │ 用户表→数仓           │ 全量 │ -    │ 停止 │ ▶  ⋯ │     │  │
│  │ │ 配置表刷新             │ 全量 │ 1小时│ 运行 │ ▶■⋯ │     │  │
│  │ └────────────────────────────────────────────────────┘     │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                      │
│  === 同步历史 Tab（v1.0 已有）===                                   │
│  ...                                                                │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 ⭐ v1.1 新增组件

#### SchedulePanel（定时轮询配置）
```typescript
interface ScheduleConfig {
  type: 'manual' | 'interval' | 'cron';
  intervalMs?: number;        // 1000 / 5000 / 30000 / 60000 / 300000 / 900000 / 1800000 / 3600000
  cronExpr?: string;          // 高级模式：'*/30 * * * * *' (秒级粒度)
  enabled: boolean;
}
```

**UI 简化版**（用户友好）：
- 下拉框选择：`[1秒] [5秒] [30秒] [1分钟] [5分钟] [15分钟] [30分钟] [1小时]`
- 默认：`30 秒`
- 高级按钮：点击展开 Cron 表达式编辑器

**并发锁提示**：
- UI 上显示：「上次执行耗时 X 秒，间隔 30 秒中可能存在重叠执行（自动跳过）」
- 当间隔 < 上次执行平均耗时，建议用户加大间隔

#### TaskListPanel（任务模板列表）
- 表格：任务名称 / 模式 / 间隔 / 状态 / 操作
- 操作列：`▶运行` `■停止` `⟳立即执行` `✎编辑` `🗑删除` `📊详情`
- 状态徽章：运行中（绿）/已停止（灰）/错误（红）

#### ExecutionStatusBadge（任务状态徽章）
```typescript
type TaskStatus = 'idle' | 'running' | 'polling' | 'error' | 'disabled';
//         idle = 未启动
//         running = 正在执行某一轮同步
//         polling = 轮询模式启用，但当前空闲
//         error = 最近一次执行失败
//         disabled = 用户主动禁用
```

---

## 7. 数据流设计

### 7.1 v1.1 新增数据流：定时轮询

```
1. 用户在 DataSyncPage 配置并保存任务模板
   → POST /api/sync/tasks
   
2. 后端 syncTypes.mjs 写入 PG `sync_tasks` 表
   
3. 用户点击「▶启动轮询」
   → POST /api/sync/tasks/:id/start
   
4. 后端 syncScheduler.mjs 注册 cron job：
   a. 从 `sync_tasks` 表读任务配置
   b. 生成 cron 表达式（基于 intervalMs 或 cronExpr）
   c. 启动 scheduler.addJob(taskId, cronExpr, handler)
   d. handler 内部加并发锁 → 调 syncEngine.executeIncremental()
   
5. 每到间隔时间，handler 触发：
   a. 检查并发锁（如果上一轮还在跑，跳过本轮）
   b. 读 `sync_checkpoints` 表获取上次进度
   c. 调用 syncEngine.mjs 的 executeIncremental(taskId)
      - 源库 SELECT WHERE updated_at > checkpoint
      - 目标库 UPSERT
      - 写 sync_history（执行结果）
      - 更新 sync_checkpoints
      - 写 sync_audit_log
   d. 释放并发锁
   e. 返回执行统计
   
6. 前端可通过 GET /api/sync/tasks/:id/status 实时查看任务状态
7. 历史可通过 GET /api/sync/history 查询
```

### 7.2 状态管理（v1.1 增量）

```typescript
// dataSyncStore.ts 新增
interface DataSyncState {
  // ... v1.0 已有字段 ...
  
  // ⭐【v1.1】定时轮询
  currentTaskId: string | null;
  taskStatus: 'idle' | 'running' | 'polling' | 'error' | 'disabled';
  lastExecutionAt: number | null;
  lastExecutionDuration: number | null;
  
  // ⭐【v1.1】任务模板列表
  taskList: SyncTask[];
  selectedTask: SyncTask | null;
  isLoadingTasks: boolean;
  
  // ⭐【v1.1】Actions
  saveTask: (config: SyncConfig) => Promise<string>;
  loadTaskList: () => Promise<void>;
  loadTask: (taskId: string) => Promise<void>;
  startPolling: (taskId: string) => Promise<void>;
  stopPolling: (taskId: string) => Promise<void>;
  runOnce: (taskId: string) => Promise<void>;
  refreshStatus: (taskId: string) => Promise<void>;
}
```

---

## 8. 分阶段实施计划（v1.1 调整）

### 阶段零：基础与文档（v1.1 改造）— 1 周

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 撰写本 v1.1 设计文档 | 1d | ✅ 已完成（本文件） |
| 评审 v1.1 文档 | 1d | 用户/PM 评审通过 |
| PG 表结构设计 + 迁移脚本 | 2d | `sync_history`, `sync_tasks`, `sync_checkpoints`, `sync_audit_log`, `sync_table_blacklist` |
| 同步类型映射表扩充（瀚高/达梦/金仓） | 2d | transformer.mjs 完善 |

### 阶段一：基础能力（v1.3.0）— 2 周

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 实现 `syncEngine.mjs` 全量同步核心 | 3d | 全量 SELECT → INSERT 流程 |
| 实现 `batchReader.mjs` 分批读取器 | 2d | 流式分页读取 |
| 实现 `sqlBuilder.mjs` INSERT 生成 | 1d | 跨库 SQL 生成 |
| 实现 `transformer.mjs` 基础类型转换 | 2d | MySQL↔PG 类型映射表（**补充瀚高/达梦/金仓**） |
| 实现 `POST /api/sync/execute` SSE 同步执行 | 2d | 同步执行 API |
| 后端集成测试（MySQL→PG 真打通） | 2d | 通过率 ≥ 90% |

### 阶段二：增强功能（v1.4.0）— 2 周

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 实现 `compare.mjs` 差异比对算法 | 3d | 基于主键的 diff |
| 实现增量同步（Checkpoint 管理） | 2d | 增量模式 |
| 实现 `POST /api/sync/preview` 预览 API | 2d | 差异预览 |
| 实现 `POST /api/sync/dry-run` Dry-Run API | 1d | SQL 生成 |
| 补充类型转换（瀚高/达梦/金仓） | 2d | 完整国产数据库映射 |
| 事务保护 + 错误处理 | 1d | 事务回滚 |
| 同步历史落 PG | 1d | sync_history 表 + 操作 |

### 阶段三：⭐ v1.1 定时轮询 + 任务模板（v1.5.0）— 2 周

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 安装并集成 `node-cron` | 0.5d | 依赖、配置 |
| 实现 `syncScheduler.mjs` 调度器 | 3d | node-cron 集成 + 并发锁 |
| 实现 `syncTypes.mjs` 持久化层 | 2d | PG sync_tasks / sync_checkpoints / sync_audit_log |
| 任务模板 CRUD API | 2d | REST API |
| 任务启停 + 立即执行 API | 1d | 启停 + run |
| 前端 SchedulePanel 定时配置 UI | 2d | 间隔选择 + Cron 编辑 |
| 前端 TaskListPanel 任务管理 UI | 2d | 表格 + 操作按钮 |
| 前端任务状态徽章 | 0.5d | StatusBadge |
| 端到端测试 + 文档 | 2d | E2E 联调 |

### 阶段四：v1.6.0+（安全与扩展）

| 任务 | 说明 |
|------|------|
| 任务级 RBAC | 复用 DClaw 现有权限系统 |
| 敏感表黑名单 | 同步前检查，不允许同步含敏感词的表 |
| 同步操作审计 | sync_audit_log |
| 钉钉/企微 webhook 通知 | E4 提前实现（业务上高频） |
| v1.5 提前：DDL 同步 | 目标表自动创建/变更 |

---

## 9. 附录

### 9.1 ⭐ v1.1 国产数据库类型映射表（补全）

| 分类 | MySQL | PostgreSQL | **瀚高** | **达梦** | **金仓** |
|------|-------|------------|----------|---------|---------|
| 整数 | TINYINT | SMALLINT | SMALLINT | TINYINT | TINYINT |
| | SMALLINT | SMALLINT | SMALLINT | SMALLINT | SMALLINT |
| | MEDIUMINT | INTEGER | INTEGER | INTEGER | INTEGER |
| | INT | INTEGER | INTEGER | INT | INT |
| | BIGINT | BIGINT | BIGINT | BIGINT | BIGINT |
| 浮点 | FLOAT | REAL | REAL | FLOAT | FLOAT |
| | DOUBLE | DOUBLE PRECISION | DOUBLE PRECISION | DOUBLE | DOUBLE |
| 定点 | DECIMAL(p,s) | NUMERIC(p,s) | NUMERIC(p,s) | DECIMAL(p,s) | DECIMAL(p,s) |
| 字符 | CHAR(n) | CHAR(n) | CHAR(n) | CHAR(n) | CHAR(n) |
| | VARCHAR(n) | VARCHAR(n) | VARCHAR(n) | VARCHAR(n) | VARCHAR(n) |
| 大文本 | TINYTEXT | TEXT | TEXT | TEXT | TEXT |
| | TEXT | TEXT | TEXT | TEXT | TEXT |
| | MEDIUMTEXT | TEXT | TEXT | CLOB | TEXT |
| | LONGTEXT | TEXT | TEXT | CLOB | CLOB |
| 二进制 | TINYBLOB | BYTEA | BYTEA | BLOB | BLOB |
| | BLOB | BYTEA | BYTEA | BLOB | BLOB |
| | MEDIUMBLOB | BYTEA | BYTEA | BLOB | BLOB |
| | LONGBLOB | BYTEA | BYTEA | BLOB | BLOB |
| 时间 | DATE | DATE | DATE | DATE | DATE |
| | TIME | TIME | TIME | TIME | TIME |
| | DATETIME | TIMESTAMP | TIMESTAMP | DATETIME | TIMESTAMP |
| | TIMESTAMP | TIMESTAMPTZ | TIMESTAMP | TIMESTAMP | TIMESTAMP |
| | YEAR | INTEGER | INTEGER | INTEGER | INTEGER |
| 其他 | BOOLEAN | BOOLEAN | BOOLEAN | BIT | BOOLEAN |
| | JSON | JSONB | JSONB | JSON | JSON |
| | ENUM('a','b') | VARCHAR | VARCHAR | VARCHAR | VARCHAR |

> **说明**：瀚高/达梦/金仓 都与 PostgreSQL 高度兼容，类型映射大部分沿用 PG 路径。

### 9.2 v1.1 风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|---------|
| **轮询冲突** | 同一任务两轮重叠执行 | 中 | scheduler 加并发锁，重叠时跳过本轮 |
| **轮询风暴** | 多个任务短间隔打爆源库 | 中 | scheduler 增加全局并发控制（如 10 个任务同时跑） |
| **大数据量表 OOM** | 服务崩溃 | 中 | 分批读取 + 限制 `maxRowsInMemory`（默认 50000），超过阈值启用分批比对 |
| **跨库事务不一致** | 部分数据丢失/重复 | 高 | 同构库使用事务；异构库记录每批写入的 key 范围，失败后支持从断点恢复 |
| **checkpoint 漂移** | 重启后丢失增量进度 | 低 | PG `sync_checkpoints` 表保证持久化 |
| **字段映射遗漏** | 数据错位 | 中 | 自动映射后高亮「未映射」字段，强制用户处理后再执行 |
| **目标表不存在** | 执行失败 | 低 | v1.0 要求用户手动创建目标表；预览 API 返回表存在性检查 |
| **异构数据库类型不兼容** | 写入失败 | 中 | 类型转换表覆盖 ≥ 80% 常见类型，不支持的显示警告，用户可自定义转换表达式 |
| **敏感表误同步** | 数据泄漏 | 高 | 敏感表黑名单（sync_table_blacklist）+ 任务级 RBAC + 审计日志三重防护 |
| **执行权限过大** | 普通用户误删目标表 | 中 | 复用 DClaw 角色权限，按角色限制 run/edit/delete |

### 9.3 参考资源

- **DBeaver Data Transfer 功能**：参考其「源/目标选择 → 字段映射 → 类型转换 → 执行」的四步交互流程
- **Apache SeaTunnel**：参考其多源多目标的同步引擎架构设计
- **Airflow**：参考其 DAG 任务编排（v2.1 任务依赖）
- **pg_wal / binlog**：仅作为了解背景，已确认不引入（CDC 永久剔除）
- **node-cron**：v1.1 实际选用的定时调度库（轻量、稳定、生态成熟）

### 9.4 关键类型定义增量（v1.1）

```typescript
// src/types/sync.ts 增量

/** v1.1 新增：同步模式 */
export type SyncMode = 'full' | 'incremental' | 'diff';

/** v1.1 新增：调度类型 */
export type ScheduleType = 'manual' | 'interval' | 'cron';

/** v1.1 新增：调度配置 */
export interface ScheduleConfig {
  type: ScheduleType;
  intervalMs?: number;          // type=interval 时必填
  cronExpr?: string;            // type=cron 时必填
  enabled: boolean;
}

/** v1.1 新增：增量字段类型 */
export type IncrementalFieldType = 'timestamp' | 'autoIncrement';

/** v1.1 新增：增量字段配置 */
export interface IncrementalFieldConfig {
  name: string;
  type: IncrementalFieldType;
}

/** v1.1 新增：同步任务模板 */
export interface SyncTask {
  id: string;
  name: string;
  description?: string;
  source: {
    connectionId: string;
    table: string;
    schema?: string;
  };
  target: {
    connectionId: string;
    table: string;
    schema?: string;
  };
  mode: SyncMode;
  incrementalField?: IncrementalFieldConfig;
  primaryKeys: string[];
  fieldMappings: FieldMapping[];
  filter?: string;
  schedule: ScheduleConfig;
  syncConfig: SyncConfig;
  creator: string;
  createdAt: string;
  updatedAt: string;
  status: 'idle' | 'running' | 'polling' | 'error' | 'disabled';
  lastExecutionAt?: string;
  lastExecutionDurationMs?: number;
  lastCheckpoint?: string;
  permissions: {
    runnable: string[];
    viewable: string[];
    editable: string[];
  };
}

/** v1.1 新增：Checkpoint 数据 */
export interface SyncCheckpoint {
  taskId: string;
  field: string;
  fieldType: IncrementalFieldType;
  lastValue: string | number;
  lastSyncAt: string;
}

/** v1.1 新增：审计日志 */
export interface SyncAuditLog {
  id: string;
  userId: string;
  action: 'create' | 'update' | 'delete' | 'run' | 'start' | 'stop' | 'view';
  taskId: string;
  taskName: string;
  details?: Record<string, any>;
  ip: string;
  userAgent: string;
  timestamp: string;
}

/** v1.1 新增：敏感表黑名单 */
export interface BlacklistEntry {
  id: string;
  pattern: string;             // 正则表达式或精确表名
  reason: string;
  createdBy: string;
  createdAt: string;
}
```

### 9.5 PG 表结构（v1.1 落地）

```sql
-- 同步任务模板表
CREATE TABLE sync_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  source_conn     VARCHAR(100) NOT NULL,
  source_table    VARCHAR(200) NOT NULL,
  source_schema   VARCHAR(200),
  target_conn     VARCHAR(100) NOT NULL,
  target_table    VARCHAR(200) NOT NULL,
  target_schema   VARCHAR(200),
  mode            VARCHAR(20) NOT NULL,         -- 'full' | 'incremental' | 'diff'
  incremental_field_name VARCHAR(100),
  incremental_field_type VARCHAR(20),
  primary_keys    JSONB NOT NULL DEFAULT '[]',
  field_mappings  JSONB NOT NULL DEFAULT '[]',
  filter_sql      TEXT,
  schedule        JSONB NOT NULL,
  sync_config     JSONB NOT NULL,
  creator         VARCHAR(100) NOT NULL,
  permissions     JSONB NOT NULL DEFAULT '{}',
  status          VARCHAR(20) NOT NULL DEFAULT 'idle',
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- 同步执行历史表
CREATE TABLE sync_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID REFERENCES sync_tasks(id) ON DELETE CASCADE,
  task_name           VARCHAR(200),
  mode                VARCHAR(20),
  started_at          TIMESTAMP NOT NULL,
  finished_at         TIMESTAMP,
  duration_ms         INTEGER,
  status              VARCHAR(20),             -- 'success' | 'failed' | 'partial' | 'running'
  source_conn         VARCHAR(100),
  target_conn         VARCHAR(100),
  total_read          INTEGER DEFAULT 0,
  total_inserted      INTEGER DEFAULT 0,
  total_updated       INTEGER DEFAULT 0,
  total_deleted       INTEGER DEFAULT 0,
  total_errors        INTEGER DEFAULT 0,
  error_details       JSONB DEFAULT '[]',
  checkpoint_before   VARCHAR(200),
  checkpoint_after    VARCHAR(200)
);

-- 增量同步 Checkpoint 表
CREATE TABLE sync_checkpoints (
  task_id             UUID PRIMARY KEY REFERENCES sync_tasks(id) ON DELETE CASCADE,
  field_name          VARCHAR(100) NOT NULL,
  field_type          VARCHAR(20) NOT NULL,
  last_value          VARCHAR(200) NOT NULL,
  last_sync_at        TIMESTAMP NOT NULL
);

-- 同步操作审计日志表
CREATE TABLE sync_audit_log (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             VARCHAR(100) NOT NULL,
  action              VARCHAR(20) NOT NULL,
  task_id             UUID,
  task_name           VARCHAR(200),
  details             JSONB DEFAULT '{}',
  ip                  VARCHAR(45),
  user_agent          TEXT,
  timestamp           TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 敏感表黑名单表
CREATE TABLE sync_table_blacklist (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern             VARCHAR(500) NOT NULL UNIQUE,    -- 正则或精确匹配
  reason              TEXT,
  created_by          VARCHAR(100) NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_sync_history_task_id ON sync_history(task_id);
CREATE INDEX idx_sync_history_started_at ON sync_history(started_at DESC);
CREATE INDEX idx_sync_audit_log_user_id ON sync_audit_log(user_id);
CREATE INDEX idx_sync_audit_log_timestamp ON sync_audit_log(timestamp DESC);
```

---

## 10. v1.1 评审要点 & 待确认问题

### 10.1 待用户确认

1. **轮询最常见间隔**：30 秒 / 5 分钟 / 其他？默认用哪个？
2. **PG 表结构**：上面 9.5 节是否合理？
3. **依赖**：确认接受 `node-cron` 作为新增 npm 依赖？

### 10.2 待 PM 确认

4. **里程碑定档**：v1.5（同步任务+定时轮询）计划哪个版本发布？
5. **人员投入**：是否有专人持续推进？

---

**变更记录**
- 2025-07-10: v1.0 创建
- 2026-07-28: v1.1 升级 — 删除 CDC，新增定时轮询，PG 持久化，国产数据库映射，待用户评审
