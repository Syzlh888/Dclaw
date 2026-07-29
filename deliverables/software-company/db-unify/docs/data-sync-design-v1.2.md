# 数据同步功能 — 规划设计 v1.2

> **文档版本**: v1.2（v1.1 三层架构升级版）
> **创建日期**: 2025-07-10
> **v1.1 更新日期**: 2026-07-28
> **v1.2 更新日期**: 2026-07-28（同日，三层结构调整）
> **项目**: DClaw（db-unify）v1.2.0+
> **状态**: 待评审

---

## 0. 版本演进

| 版本 | 日期 | 主要变化 |
|------|------|----------|
| v1.0 | 2025-07-10 | 初版设计：单层任务（1 任务 = 1 张表） |
| v1.1 | 2026-07-28 | 删 CDC，加定时轮询，JSON→PG，国产 DB 映射补全 |
| **v1.2** | **2026-07-28** | **三层结构：项目 → 任务 → 同步表** |

### 0.1 v1.1 → v1.2 关键变化

| # | 变更点 | v1.1 | v1.2 | 理由 |
|---|--------|------|------|------|
| 1 | 层级结构 | 1 层（任务） | **3 层（项目 → 任务 → 同步表）** | 真实运维场景：按业务/项目组织多个同步任务，每个任务可能包含多张表 |
| 2 | 任务内表数 | 1 张 | **1 张或多张** | 同一业务场景（如「订单中心 → 数据仓库」）往往是多张表同步 |
| 3 | Checkpoint 粒度 | 任务级 | **每张表独立** | 部分表失败不影响其他表 checkpoint；断点续传更精细 |
| 4 | 执行模式 | 单表执行 | **任务内串行执行多表** | v1.2 先串行，v2.x 再并行 |
| 5 | 失败处理 | 整体失败 | **容错模式（部分成功 + 失败列表）** | 一张表失败不影响其他表成功 |
| 6 | 源/目标连接 | 任务级 | **任务级（每张表可覆盖）** | 灵活性：同一任务可聚合多源多目标 |
| 7 | 权限模型 | 任务级 | **项目级（继承到任务、表）** | 一处配置，整个树生效 |
| 8 | UI 树形 | 单层列表 | **左侧三层树** | 项目/任务/表层级清晰 |

### 0.2 已确认决策（用户拍板）

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 权限继承 | ✅ 项目权限继承到任务、表 |
| 2 | 多表执行方式 | ✅ 串行（v1.2 先做稳定） |
| 3 | Checkpoint 粒度 | ✅ 每张表独立 |
| 4 | 失败处理 | ✅ 容错模式（部分成功） |
| 5 | 源/目标连接 | ✅ 任务级默认 + 每张表可覆盖 |
| 6 | 跨项目连接复用 | ✅ 复用 DClaw `connections` 表 |

---

## 1. 需求概述

### 1.1 业务背景

DClaw 当前的核心能力是「多库同一 SQL 批量执行与结果对比」。数据同步（Data Sync）是高频刚需：

- **跨环境同步**：将生产库的配置表或基础数据同步到测试库
- **异构迁移**：MySQL 表数据迁移到 PostgreSQL（或瀚高等国产数据库）
- **增量采集**：定时将各业务库的新增数据聚合到中心数据仓库
- **表结构对齐**：将源库的 DDL 变更同步应用到目标库，保证 Schema 一致性

实际场景中，DBA 往往按业务/项目组织任务：「**订单中心 → 数据仓库**」是一个项目，里面包含「订单全量同步」和「订单增量同步」两个任务，前者包含 5 张表，后者包含 8 张表。

### 1.2 目标用户

| 角色 | 场景 |
|------|------|
| **DBA / 运维工程师** | 日常跨库数据同步、生产→测试环境数据刷新 |
| **数据开发** | 异构数据库间的 ETL 式数据传输 |
| **平台管理员** | 定时将下辖各业务库数据汇总到中心库（30 秒/5 分钟轮询） |

### 1.3 功能边界

**在范围（v1.x）：**

- **三层结构**：项目 → 任务 → 同步表
- 同构/异构数据库间的表级数据同步（全量 + 增量）
- 可视化字段映射 + 自动类型转换
- 同步前预览差异（INSERT/UPDATE/DELETE 统计）
- Dry-Run 模式
- WHERE 过滤条件
- 分批读取 + 事务保护
- **【v1.2】定时轮询（准实时）**，挂在任务级
- **【v1.2】任务内多表串行执行 + 容错模式**
- **【v1.2】每张表独立 Checkpoint**
- **【v1.2】项目级权限继承**

**不在范围（v1.x 永久剔除 + v2.x 未来）：**

- ❌ **CDC 实时同步（基于 Debezium / 日志）** — 永久剔除
- ❌ 整库同步
- ❌ 双向同步 / 冲突解决
- ⏸️ DDL 同步（推迟 v1.5）
- ⏸️ 多任务并行执行（v2.x）

---

## 2. 三层架构核心设计

### 2.1 层级关系

```
┌────────────────────────────────────────────────────────────────────┐
│  项目（Project）                                                    │
│  ────────────────────────────────────────────────                   │
│  项目元数据：名称、描述、负责人、图标、颜色                          │
│  项目权限：runnable / viewable / editable 角色列表                 │
│  项目状态：active / archived                                        │
│  ────────────────────────────────────────────────                   │
│  │                                                                  │
│  ├─ 任务 A：订单全量同步                                            │
│  │  ─────────────────────────────────────────────                  │
│  │  任务元数据：名称、源/目标连接、调度策略、执行模式               │
│  │  任务权限：继承自项目（可独立覆盖）                              │
│  │  任务状态：idle / running / polling / error / disabled           │
│  │  ─────────────────────────────────────────────                  │
│  │  │                                                              │
│  │  ├─ 同步表 1：orders                                            │
│  │  │  源表: prod.orders  目标表: dw.orders                      │
│  │  │  模式: full    增量字段: -    checkpoint: -                │
│  │  │                                                              │
│  │  ├─ 同步表 2：order_items                                       │
│  │  │  源表: prod.order_items  目标表: dw.order_items             │
│  │  │  模式: incremental  增量字段: updated_at                  │
│  │  │  checkpoint: 2026-07-28 10:30:00                          │
│  │  │                                                              │
│  │  └─ 同步表 3：customers                                        │
│  │        ...                                                      │
│  │                                                                 │
│  └─ 任务 B：订单增量同步                                            │
│     ─────────────────────────────────────────────                  │
│     （同样包含多张表）                                              │
└────────────────────────────────────────────────────────────────────┘
```

### 2.2 关键设计原则

| 原则 | 说明 |
|------|------|
| **项目是组织容器** | 仅做分类、权限、UI 渲染，不参与执行逻辑 |
| **任务是调度单元** | 定时轮询挂在任务上，触发时**串行**执行其所有表 |
| **表是同步单元** | 拥有独立的字段映射、增量字段、checkpoint、执行历史 |
| **源/目标连接默认任务级** | 任务下所有表共享一对源/目标；每张表可独立覆盖 |
| **权限继承 + 单层覆盖** | 项目级权限自动应用到任务、表；任务/表可单独覆盖 |

### 2.3 与 v1.0/v1.1 兼容

- **v1.1 → v1.2 迁移**：v1.1 的 `sync_tasks` 表数据迁移：
  - 每个 task 自动归属到「默认项目」（"未分类"或"导入项目"）
  - task 的字段映射拆为 1 个 `sync_table_mapping`
- **v1.0 → v1.2**：JSON 文件历史数据可读后批量导入

---

## 3. 功能规划

### 3.1 核心功能（v1.x）

| # | 功能 | 说明 | 优先级 | 版本 |
|---|------|------|--------|------|
| F1 | 全量同步 | 源表全量 SELECT → INSERT 到目标表 | P0 | v1.2 |
| F2 | 增量同步 | 基于时间戳字段或自增 ID 字段筛选 | P0 | v1.2 |
| F3 | 字段映射 | 自动按名称匹配 + 手动拖拽 | P0 | v1.2 |
| F4 | 类型转换 | 跨数据库类型自动转换（含瀚高/达梦/金仓） | P0 | v1.2 |
| F5 | 过滤条件 | WHERE 子句 | P1 | v1.2 |
| F6 | 预览模式 | 差异统计 | P1 | v1.2 |
| F7 | Dry-Run | 生成 SQL 不执行 | P1 | v1.2 |
| F8 | 分批读取 + 事务 | 大表分页 + 同构库事务 | P0 | v1.2 |
| F9 | **【v1.2】三层结构** | 项目/任务/表 | P0 | v1.2 |
| F10 | **【v1.2】任务内多表** | 1 个任务包含 N 张表 | P0 | v1.2 |
| F11 | **【v1.2】任务级定时轮询** | `node-cron` 调度 | P0 | v1.2 |
| F12 | **【v1.2】每张表独立 Checkpoint** | 跨表互不影响 | P0 | v1.2 |
| F13 | **【v1.2】容错模式** | 部分表失败不影响其他表 | P0 | v1.2 |
| F14 | **【v1.2】项目级权限继承** | 项目 → 任务 → 表 继承 | P0 | v1.2 |
| F15 | **【v1.2】同步历史** | 记录到 PG（每次执行一条记录） | P0 | v1.2 |
| F16 | 同步操作审计 | 谁、何时、做了什么 | P1 | v1.2 |
| F17 | 敏感表黑名单 | 不允许同步含敏感字段的表 | P1 | v1.2 |

### 3.2 扩展功能（v2.x）

| # | 功能 | 说明 |
|---|------|------|
| ~~E5~~ | ~~CDC 实时同步~~ | **❌ 永久剔除** |
| E1 | 任务内多表并行 | v2.0（配置开关） |
| E2 | 任务依赖 DAG | v2.1 |
| E3 | DDL 同步 | v1.5（提前） |
| E4 | Webhook 通知 | v2.0 |
| E6 | 回滚（Rollback） | v2.0 |
| E7 | 数据脱敏 | v2.1 |

---

## 4. 总体架构

### 4.1 模块图

```
┌──────────────────────────────────────────────────────────────────┐
│                          前端 (React)                             │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  DataSyncPage                                              │   │
│  │  ┌──────────────────┐ ┌──────────────────────────────┐   │   │
│  │  │ ProjectTreePanel │ │ TaskDetailPanel               │   │   │
│  │  │ (左侧三层树)      │ │ (右侧选中任务后展示)          │   │   │
│  │  │  ├ 项目           │ │  - 任务基本信息               │   │   │
│  │  │  │  ├ 任务        │ │  - 调度配置                   │   │   │
│  │  │  │  │  └ 表      │ │  - 该任务所有表的列表         │   │   │
│  │  │  │  │             │ │  - 表的字段映射预览          │   │   │
│  │  │  │  │             │ │  - 执行历史                  │   │   │
│  │  └──────────────────┘ └──────────────────────────────┘   │   │
│  │  ┌────────────────────────────────────────────────────┐   │   │
│  │  │ TableMappingEditor (表映射编辑器)                  │   │   │
│  │  │  - 源表/目标表选择                                 │   │   │
│  │  │  - 字段映射（拖拽 + 自动）                         │   │   │
│  │  │  - 增量字段选择                                   │   │   │
│  │  │  - WHERE 过滤条件                                 │   │   │
│  │  │  - Dry-Run 预览                                   │   │   │
│  │  └────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│                       后端 API (Express)                          │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  /api/sync/projects/*      — 项目 CRUD                    │   │
│  │  /api/sync/tasks/*         — 任务 CRUD                    │   │
│  │  /api/sync/tables/*        — 同步表映射 CRUD              │   │
│  │  /api/sync/execute         — 执行（任务级 / 表级）       │   │
│  │  /api/sync/history/*       — 同步历史                     │   │
│  │  /api/sync/checkpoints     — Checkpoint 查询             │   │
│  │  /api/sync/scheduler/*    — 启停轮询（任务级）          │   │
│  │  /api/sync/blacklist       — 敏感表黑名单                │   │
│  │  /api/sync/audit-log       — 审计日志                    │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│  同步引擎 + 调度器层                                            │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  syncEngine.mjs       — 核心引擎                        │   │
│  │  scheduler.mjs        — 任务级 node-cron 调度器       │   │
│  │  taskRunner.mjs       — 任务执行器（串行调用各表）     │   │
│  │  compare.mjs / transformer.mjs / batchReader.mjs / sqlBuilder.mjs │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│  持久化层（PostgreSQL 7 张表）                                  │
│  sync_projects / sync_tasks / sync_table_mappings              │
│  sync_history / sync_checkpoints / sync_audit_log              │
│  sync_table_blacklist                                          │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 新增 / 修改文件

#### 后端

| 文件 | 路径 | 说明 |
|------|------|------|
| `server/routes/sync-projects.mjs` | 新增 | 项目 CRUD |
| `server/routes/sync-tasks.mjs` | 新增 | 任务 CRUD（含调度） |
| `server/routes/sync-tables.mjs` | 新增 | 同步表映射 CRUD |
| `server/routes/sync-execute.mjs` | 新增 | 执行（任务级 / 表级） |
| `server/routes/sync.mjs` | 保留 | 历史 / Checkpoint / 黑名单 / 审计 |
| `server/sync/syncEngine.mjs` | 改 | 单表执行 |
| `server/sync/taskRunner.mjs` | 新增 | 任务级调度器，串行跑多表 |
| `server/sync/scheduler.mjs` | 新增 | 任务级 node-cron |

#### 前端

| 文件 | 路径 | 说明 |
|------|------|------|
| `ProjectTreePanel.tsx` | 新增 | 左侧三层树 |
| `TaskDetailPanel.tsx` | 新增 | 右侧任务详情 |
| `TableMappingEditor.tsx` | 新增 | 表映射编辑器 |
| `dataSyncStore.ts` | 改 | 状态结构升级 |
| `dataSyncService.ts` | 改 | 三层 API |

---

## 5. 数据模型（PG 表结构）

```sql
-- 项目表
CREATE TABLE sync_projects (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(200) NOT NULL,
  description     TEXT,
  color           VARCHAR(20),                            -- 标签颜色
  icon            VARCHAR(50),                            -- 图标名
  status          VARCHAR(20) NOT NULL DEFAULT 'active',  -- active | archived
  permissions     JSONB NOT NULL DEFAULT '{"runnable":["admin"],"viewable":["admin"],"editable":["admin"]}',
  creator         VARCHAR(100) NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 任务表
CREATE TABLE sync_tasks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          UUID NOT NULL REFERENCES sync_projects(id) ON DELETE CASCADE,
  name                VARCHAR(200) NOT NULL,
  description         TEXT,
  mode                VARCHAR(20) NOT NULL,                -- full | incremental | diff
  source_conn         VARCHAR(100) NOT NULL,
  target_conn         VARCHAR(100) NOT NULL,
  source_schema       VARCHAR(200),
  target_schema       VARCHAR(200),
  schedule            JSONB NOT NULL,                       -- {type, intervalMs, cronExpr, enabled}
  sync_config         JSONB NOT NULL,                       -- {errorStrategy, truncateBeforeSync, ...}
  status              VARCHAR(20) NOT NULL DEFAULT 'idle',  -- idle | running | polling | error | disabled
  last_run_at         TIMESTAMP,
  last_run_status     VARCHAR(20),
  permissions_override JSONB,                              -- 可选覆盖项目权限
  creator             VARCHAR(100) NOT NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_tasks_project_id ON sync_tasks(project_id);

-- 同步表映射（核心表）
CREATE TABLE sync_table_mappings (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id                 UUID NOT NULL REFERENCES sync_tasks(id) ON DELETE CASCADE,
  name                    VARCHAR(200),                     -- 表映射名（便于识别）
  source_table            VARCHAR(200) NOT NULL,
  target_table            VARCHAR(200) NOT NULL,
  mode_override           VARCHAR(20),                      -- 覆盖任务默认 mode
  primary_keys            JSONB NOT NULL DEFAULT '[]',
  field_mappings          JSONB NOT NULL DEFAULT '[]',
  incremental_field_name  VARCHAR(100),
  incremental_field_type  VARCHAR(20),
  filter_sql              TEXT,
  enable                  BOOLEAN NOT NULL DEFAULT true,   -- 单独关闭某张表的同步
  sync_order              INTEGER NOT NULL DEFAULT 0,      -- 表执行顺序
  created_at              TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sync_table_mappings_task_id ON sync_table_mappings(task_id);

-- Checkpoint（每张表独立）
CREATE TABLE sync_checkpoints (
  table_mapping_id    UUID PRIMARY KEY REFERENCES sync_table_mappings(id) ON DELETE CASCADE,
  field_name          VARCHAR(100) NOT NULL,
  field_type          VARCHAR(20) NOT NULL,
  last_value          VARCHAR(200) NOT NULL,
  last_sync_at        TIMESTAMP NOT NULL
);

-- 同步执行历史（每次任务执行一条，包含各表结果 JSON）
CREATE TABLE sync_history (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id             UUID NOT NULL REFERENCES sync_tasks(id) ON DELETE CASCADE,
  task_name           VARCHAR(200),
  project_id          UUID,
  started_at          TIMESTAMP NOT NULL,
  finished_at         TIMESTAMP,
  duration_ms         INTEGER,
  status              VARCHAR(20) NOT NULL,                -- success | partial | failed | running
  triggered_by        VARCHAR(20) NOT NULL,                -- manual | schedule | api
  total_tables        INTEGER NOT NULL,
  success_tables      INTEGER NOT NULL DEFAULT 0,
  failed_tables       INTEGER NOT NULL DEFAULT 0,
  table_results       JSONB NOT NULL DEFAULT '[]',         -- [{tableMappingId, status, rowsRead, inserted, ...}]
  errors              JSONB DEFAULT '[]'
);
CREATE INDEX idx_sync_history_task_id ON sync_history(task_id);
CREATE INDEX idx_sync_history_started_at ON sync_history(started_at DESC);

-- 同步操作审计日志
CREATE TABLE sync_audit_log (
  id              BIGSERIAL PRIMARY KEY,
  user_id         VARCHAR(100) NOT NULL,
  action          VARCHAR(30) NOT NULL,                    -- project.create | task.run | ...
  target_type     VARCHAR(20) NOT NULL,                    -- project | task | table_mapping
  target_id       UUID,
  details         JSONB DEFAULT '{}',
  ip              VARCHAR(45),
  timestamp       TIMESTAMP NOT NULL DEFAULT NOW()
);

-- 敏感表黑名单
CREATE TABLE sync_table_blacklist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern         VARCHAR(500) NOT NULL UNIQUE,             -- 正则或精确匹配
  reason          TEXT,
  created_by      VARCHAR(100) NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);
```

---

## 6. API 设计（三层）

### 6.1 项目

| Method | 路径 | 说明 |
|--------|------|------|
| POST | `/api/sync/projects` | 创建项目 |
| GET | `/api/sync/projects` | 项目列表（含统计：任务数/表数） |
| GET | `/api/sync/projects/:id` | 项目详情 |
| PUT | `/api/sync/projects/:id` | 更新项目 |
| DELETE | `/api/sync/projects/:id` | 删除项目（含所有任务、表） |

### 6.2 任务

| Method | 路径 | 说明 |
|--------|------|------|
| POST | `/api/sync/projects/:projectId/tasks` | 创建任务 |
| GET | `/api/sync/projects/:projectId/tasks` | 任务列表 |
| GET | `/api/sync/tasks/:id` | 任务详情（含所有表） |
| PUT | `/api/sync/tasks/:id` | 更新任务 |
| DELETE | `/api/sync/tasks/:id` | 删除任务 |
| POST | `/api/sync/tasks/:id/run` | 立即执行（串行跑所有表） |
| POST | `/api/sync/tasks/:id/start` | 启动定时轮询 |
| POST | `/api/sync/tasks/:id/stop` | 停止定时轮询 |
| GET | `/api/sync/tasks/:id/status` | 任务状态 |
| POST | `/api/sync/tasks/:id/copy` | 复制任务（快速创建类似任务） |

### 6.3 同步表

| Method | 路径 | 说明 |
|--------|------|------|
| POST | `/api/sync/tasks/:taskId/tables` | 添加表映射 |
| GET | `/api/sync/tasks/:taskId/tables` | 表列表 |
| GET | `/api/sync/tables/:id` | 表详情 |
| PUT | `/api/sync/tables/:id` | 更新表 |
| DELETE | `/api/sync/tables/:id` | 删除表 |
| POST | `/api/sync/tables/:id/run` | 仅执行该表 |
| POST | `/api/sync/tables/:id/dry-run` | Dry-Run |
| POST | `/api/sync/tables/:id/preview` | 预览差异 |
| GET | `/api/sync/tables/:id/checkpoint` | 查 checkpoint |

### 6.4 其他

| Method | 路径 | 说明 |
|--------|------|------|
| GET | `/api/sync/history` | 历史（支持 task_id 过滤） |
| GET | `/api/sync/history/:id` | 详情 |
| GET | `/api/sync/blacklist` / POST / DELETE | 黑名单管理 |
| GET | `/api/sync/audit-log` | 审计日志 |

---

## 7. 关键执行流程

### 7.1 任务级执行

```
POST /api/sync/tasks/:id/run
  │
  ├─ 1. 鉴权（项目级权限检查）
  │
  ├─ 2. 加任务级锁（同任务不可并发执行）
  │
  ├─ 3. 创建 sync_history 记录（status=running）
  │
  ├─ 4. 加载所有该任务下的 sync_table_mappings（按 sync_order 排序）
  │
  ├─ 5. 串行执行每张表：
  │     for tableMapping in tableMappings:
  │       try:
  │         syncEngine.execute(tableMapping)
  │         → 读 checkpoint
  │         → SELECT WHERE / INSERT/UPSERT
  │         → 更新 checkpoint
  │         → 写 table_result
  │       except:
  │         → 写 table_result (status=failed)
  │         → 继续下一张（容错模式）
  │
  ├─ 6. 全部完成后：
  │     if 全成功：sync_history.status = success
  │     if 部分成功：sync_history.status = partial
  │     if 全失败：sync_history.status = failed
  │
  ├─ 7. SSE 推送执行进度（每完成一张表推送一次）
  │
  └─ 8. 释放锁
```

### 7.2 定时轮询（任务级）

```
node-cron 调度器：
  对每个 schedule.enabled=true 的 task 注册一个 cron job
  
每次触发：
  1. 检查该 task 的执行锁（防重叠）
  2. 如空闲 → 调 taskRunner.run(taskId)
  3. 如忙碌 → 记录"跳过本轮"到 audit_log，跳过
```

---

## 8. 前端 UI 设计

### 8.1 布局

```
┌──────────────────────────────────────────────────────────────────────────┐
│ 数据同步                                                                │
├────────────────┬─────────────────────────────────────────────────────────┤
│ 项目树 (左)     │ 任务详情 (右)                                             │
│                 │                                                          │
│ 📁 订单中心      │ 📋 任务：订单全量同步                                     │
│ ├ ⚡ 任务A       │ 模式: 全量    调度: 每 30 秒        状态: ▶运行中      │
│ │  └ order      │                                                          │
│ │  └ order_item │ 📊 包含 5 张表                                            │
│ │  └ customer   │ ┌──────────────────────────────────────────────────┐    │
│ ├ ⚡ 任务B       │ │ # │ 表名          │ 模式       │ 上次同步     │ 操作 │    │
│ │  └ log        │ │ 1 │ orders        │ full       │ 2 分钟前     │ ▶⋯   │    │
│ │                │ │ 2 │ order_items   │ incremental│ 5 秒前       │ ▶⋯   │    │
│ 📁 用户中心      │ │ 3 │ customers     │ incremental│ 失败          │ ▶⋯   │    │
│ ├ ⚡ 任务C       │ │ ...                                               │    │
│ │  └ profile    │ └──────────────────────────────────────────────────┘    │
│ │                │                                                          │
│ [+ 新建项目]     │ 📜 同步历史  [查看全部]                                  │
│ [+ 新建任务]     │                                                          │
│                 │  - 2026-07-28 10:30:00 | success | 5/5 表成功             │
│                 │  - 2026-07-28 10:29:30 | partial | 4/5 表成功            │
└────────────────┴─────────────────────────────────────────────────────────┘
```

### 8.2 组件树

```
DataSyncPage
├── ProjectTreePanel
│   ├── ProjectNode
│   │   ├── TaskNode
│   │   │   └── TableNode
│   │   └── [+ 添加任务按钮]
│   └── [+ 新建项目按钮]
├── TaskDetailPanel
│   ├── TaskHeader (名称、调度、状态徽章、操作按钮)
│   ├── TableListGrid (该任务下所有表)
│   │   └── TableRow → 打开 TableMappingEditor
│   └── ExecutionHistory (该任务历史)
└── TableMappingEditor (Dialog)
    ├── SourceTargetPicker
    ├── FieldMappingPanel
    ├── FilterPanel
    ├── IncrementalFieldPicker
    └── DryRunPreview
```

---

## 9. 分阶段实施计划（v1.2 重新排期）

> 用户在 2026-07-28 确认后采用此计划。

### 阶段零：基础与文档（**已完成**）

| 任务 | 状态 |
|------|------|
| ✅ v1.2 设计文档（本文） | 2026-07-28 完成 |

### 阶段一：基础能力 v1.3.0（**2 周**）

> 目标：跑通**单层任务 + 单表**全量同步 MVP，验证同步引擎核心

| 任务 | 工时 | 交付物 |
|------|------|--------|
| PG 表结构创建 + 迁移脚本 | 1d | 7 张表创建成功 |
| `syncEngine.mjs` 单表全量同步 | 2d | 全量 SELECT → INSERT |
| `batchReader.mjs` 分批读取 | 1d | 流式分页 |
| `sqlBuilder.mjs` INSERT 生成 | 1d | 跨库 SQL |
| `transformer.mjs` 基础类型转换 | 1d | MySQL↔PG 映射 |
| `POST /execute` 单表执行 | 1d | API + SSE 推送 |
| 集成测试 | 1d | 真打通 MySQL→PG |
| 单层 UI 验证（无项目/任务，只一张表） | 2d | 最小可演示 |

**⚠️ 阶段一不构建三层**，先验证核心引擎；这样如果引擎有设计问题影响小。

---

### 阶段二：三层结构 v1.4.0（**2.5 周**）

| 任务 | 工时 | 交付物 |
|------|------|--------|
| `sync-projects.mjs` 项目 CRUD | 1d | API |
| `sync-tasks.mjs` 任务 CRUD | 1.5d | API |
| `sync-tables.mjs` 表映射 CRUD | 2d | API（含字段映射编辑器后端） |
| `ProjectTreePanel` 左侧三层树 | 2d | UI |
| `TaskDetailPanel` 任务详情 + 表列表 | 2d | UI |
| `TableMappingEditor` 对话框 | 2.5d | UI（最复杂） |
| 项目权限 + 任务/表权限覆盖实现 | 1d | 后端 + 前端 |
| 集成测试 | 1d | 端到端 |

---

### 阶段三：定时轮询 + 容错 v1.5.0（**2 周**）

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 安装 `node-cron` 依赖 | 0.5d | 依赖 |
| `taskRunner.mjs` 任务级执行器（串行多表 + 容错） | 3d | 引擎 |
| `scheduler.mjs` 任务级 node-cron | 2d | 调度器 |
| `SchedulePanel` UI | 1.5d | 间隔 / Cron |
| 启动轮询 / 停止轮询 API | 1d | `/api/sync/tasks/:id/start\|stop` |
| 立即执行 API + UI | 1d | `/api/sync/tasks/:id/run` |
| 同步历史 query/UI | 1.5d | sync_history 表 + UI |
| 集成测试（轮询真跑通） | 1.5d | 30 秒轮询验证 |

---

### 阶段四：增量 + 国产 DB + 安全 v1.6.0（**2 周**）

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 增量同步（checkpoint 落 PG） | 3d | F12 + compare.mjs |
| 字段类型转换扩展（瀚高/达梦/金仓） | 2d | 附录 9.1 落实 |
| 预览差异 / Dry-Run 完整实现 | 2d | F6/F7 |
| 同步操作审计 | 1d | sync_audit_log |
| 敏感表黑名单 | 1d | sync_table_blacklist + 拦截 |
| E2E 测试（MySQL/PG/瀚高 三方） | 2d | 自动化 |
| 文档/帮助 | 0.5d | README + 用户手册 |

---

### 阶段五：DDL 同步 + 通知 v1.7.0（**3 周**）

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 目标表自动创建（CREATE TABLE IF NOT EXISTS） | 1.5周 | 异构 DB 类型差异处理 |
| DDL 同步（Schema diff） | 1周 | 加列/减列/类型变更 |
| Webhook 通知（钉钉/企微） | 0.5周 | E4 |

---

### 阶段六：v2.0+（增强）

| 任务 | 说明 |
|------|------|
| 多表并行执行 | E1 |
| 任务依赖 DAG | E2 |
| 回滚 | E6 |
| 数据脱敏 | E7 |

---

## 10. 里程碑总览

| 版本 | 时间 | 核心交付 | 累计 |
|------|------|----------|------|
| v1.3.0 | +2 周 | 单表全量同步 MVP | 2 周 |
| v1.4.0 | +2.5 周 | 三层结构 + 表映射编辑器 | 4.5 周 |
| v1.5.0 | +2 周 | 定时轮询 + 容错 | 6.5 周 |
| v1.6.0 | +2 周 | 增量 + 国产 DB + 安全 | 8.5 周 |
| v1.7.0 | +3 周 | DDL 同步 + 通知 | 11.5 周 |

**首版可演示**：v1.3.0（2 周后）— 用户验证引擎可行性
**用户级可用**：v1.5.0（6.5 周后）— 三层 + 轮询 + 容错
**生产可用**：v1.6.0（8.5 周后）— 含安全/审计全功能
**完整版（含 DDL）**：v1.7.0（11.5 周后）

---

## 11. 附录

### 11.1 三层关系矩阵

| 字段 | 项目 | 任务 | 表 |
|------|------|------|-----|
| 名称/描述 | ✅ | ✅ | ✅（表映射名） |
| 调度策略 | ❌ | ✅ | ❌（继承任务） |
| 源/目标连接 | ❌ | ✅（默认） | ✅（可覆盖） |
| 字段映射 | ❌ | ❌ | ✅ |
| 增量字段 | ❌ | ❌ | ✅ |
| WHERE 过滤 | ❌ | ❌ | ✅ |
| Checkpoint | ❌ | ❌ | ✅（每表独立） |
| 权限 | ✅（基础） | ✅（可覆盖） | ❌（继承任务） |
| 执行历史 | ❌ | ✅（聚合） | ✅（详情） |
| 状态 | ✅（active） | ✅（执行/调度） | ✅（成功/失败） |

### 11.2 TypeScript 类型定义（核心）

```typescript
// 项目
export interface SyncProject {
  id: string;
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  status: 'active' | 'archived';
  permissions: {
    runnable: string[];   // 角色列表
    viewable: string[];
    editable: string[];
  };
  creator: string;
  createdAt: string;
  updatedAt: string;
  stats?: {
    taskCount: number;
    tableCount: number;
    runningTasks: number;
  };
}

// 任务
export interface SyncTask {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  mode: 'full' | 'incremental' | 'diff';
  source: { connectionId: string; schema?: string; };
  target: { connectionId: string; schema?: string; };
  schedule: ScheduleConfig;
  syncConfig: SyncConfig;
  status: 'idle' | 'running' | 'polling' | 'error' | 'disabled';
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'partial' | 'failed';
  permissionsOverride?: {
    runnable?: string[];
    viewable?: string[];
    editable?: string[];
  };
  tableMappings?: SyncTableMapping[];
  creator: string;
  createdAt: string;
  updatedAt: string;
}

// 表映射
export interface SyncTableMapping {
  id: string;
  taskId: string;
  name?: string;
  sourceTable: string;
  targetTable: string;
  modeOverride?: 'full' | 'incremental' | 'diff';
  primaryKeys: string[];
  fieldMappings: FieldMapping[];
  incrementalField?: IncrementalFieldConfig;
  filterSql?: string;
  enable: boolean;
  syncOrder: number;
  status?: 'success' | 'failed' | 'skipped';
  lastRunDurationMs?: number;
  lastError?: string;
  checkpoint?: SyncCheckpoint;
  createdAt: string;
  updatedAt: string;
}

// Checkpoint
export interface SyncCheckpoint {
  tableMappingId: string;
  fieldName: string;
  fieldType: 'timestamp' | 'autoIncrement';
  lastValue: string | number;
  lastSyncAt: string;
}

// 表结果（嵌套在 sync_history.table_results）
export interface SyncTableResult {
  tableMappingId: string;
  tableName: string;
  status: 'success' | 'failed' | 'skipped';
  rowsRead: number;
  inserted: number;
  updated: number;
  deleted: number;
  errors: number;
  durationMs: number;
  errorDetails?: string[];
  checkpointBefore?: string;
  checkpointAfter?: string;
}

// 同步历史
export interface SyncHistory {
  id: string;
  taskId: string;
  taskName: string;
  projectId: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  status: 'success' | 'partial' | 'failed' | 'running';
  triggeredBy: 'manual' | 'schedule' | 'api';
  totalTables: number;
  successTables: number;
  failedTables: number;
  tableResults: SyncTableResult[];
  errors: any[];
}
```

---

## 12. 评审清单

请确认下列决策：

- [ ] **三层结构**：项目 → 任务 → 表
- [ ] **执行方式**：任务内串行
- [ ] **Checkpoint**：每表独立
- [ ] **失败容错**：部分成功 + 失败列表
- [ ] **权限模型**：项目级继承
- [ ] **持久化**：PostgreSQL 7 张表
- [ ] **依赖**：仅新增 `node-cron`
- [ ] **首要演示版本**：v1.3.0（单表 MVP，2 周后）
- [ ] **生产可用**：v1.6.0（8.5 周后）

---

**变更记录**
- 2025-07-10：v1.0 创建
- 2026-07-28：v1.1 升级（删 CDC，加轮询，PG 化）
- 2026-07-28（当日）：v1.2 升级（三层结构：项目/任务/表）
