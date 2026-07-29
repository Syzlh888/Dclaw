# 数据同步 + 临时导出 功能 — 规划设计 v1.3

> **文档版本**: v1.3（v1.2 + 临时导出模式）
> **创建日期**: 2025-07-10
> **v1.1 更新日期**: 2026-07-28（删 CDC、加定时轮询、PG 化）
> **v1.2 更新日期**: 2026-07-28（项目/任务/表 三层结构）
> **v1.3 更新日期**: 2026-07-28（同日，加入 DBeaver 风格临时导出模式）
> **项目**: DClaw（db-unify）v1.2.0+
> **状态**: 待评审

---

## 0. 版本演进

| 版本 | 日期 | 主要变化 |
|------|------|----------|
| v1.0 | 2025-07-10 | 初版设计：单层任务（1 任务 = 1 张表） |
| v1.1 | 2026-07-28 | 删 CDC，加定时轮询，JSON→PG，国产 DB 映射补全 |
| v1.2 | 2026-07-28 | 三层结构：项目 → 任务 → 同步表 |
| **v1.3** | **2026-07-28** | **加入临时导出模式（DBeaver 风格的文件/数据库导出向导）** |

### 0.1 v1.2 → v1.3 关键变化

| # | 变更点 | v1.2 | v1.3 | 理由 |
|---|--------|------|------|------|
| 1 | **新增临时导出模式** | ❌ 仅同步任务 | ✅ 临时导出（不入库、单次） | DBeaver 风格；高频刚需（数据备份、一次性迁移） |
| 2 | **触发入口** | 仅任务管理 | + 右键菜单 / SQL 编辑器 / 顶部工具栏 | 三入口覆盖 |
| 3 | **支持导出格式** | 仅 DB→DB 同步 | + CSV / SQL INSERT / JSON / XLSX / TSV | 用户实际需求 |
| 4 | **导出目标** | 仅数据库 | + 本地文件 + 数据库（同/异构） | 一站式 |
| 5 | **自动建表** | v1.7 DDL | v1.3 第一阶段支持（导出时） | 文件→DB 体验 |
| 6 | **首版可用** | v1.6.0 (8.5 周) | **v1.3.0（3 周）** — 临时导出 MVP | 提前交付高价值功能 |
| 7 | **同步任务实施** | 阶段一 | **推后到阶段二/三** | 先做临时导出验证引擎 |

### 0.2 已确认决策（用户拍板）

| # | 决策点 | 选择 |
|---|--------|------|
| 1 | 三层结构 | 项目 → 任务 → 表 |
| 2 | 多表执行 | 任务内串行 + 容错 |
| 3 | Checkpoint | 每张表独立 |
| 4 | 失败处理 | 部分成功 + 失败列表 |
| 5 | 源/目标 | 任务级默认，每表可覆盖 |
| 6 | 权限 | 项目级继承 |
| 7 | 持久化 | PostgreSQL |
| 8 | 临时导出 | 纳入 v1.3 第一阶段 |
| 9 | 默认编码 | UTF-8（医疗行业标准） |
| 10 | 默认行数限制 | 50 万行（CSV/SQL/JSON）；10 万行（XLSX） |
| 11 | 依赖 | `node-cron` + 暂不新增（CSV/JSON/SQL 用 Node 内置） |
| 12 | XLSX 实现 | 暂用 `exceljs`（轻量、StreamWriter 支持） |

---

## 1. 需求概述

### 1.1 业务背景

DClaw 当前的核心能力是「多库同一 SQL 批量执行与结果对比」。运维场景中两类需求并存：

1. **计划性同步**：业务 ETL、定时数据汇聚 → 沿用三层结构 + 定时轮询
2. **临时性导出**：数据备份、一次性迁移、临时分析、文件交换 → DBeaver 风格

实际中后者频率更高：**"导出某张表给研发 / 导出查询结果到 Excel / 导一份 SQL 迁移脚本给运维"** 是 DBA 每天都在做的事情。

### 1.2 目标用户

| 角色 | 场景 |
|------|------|
| **DBA / 运维工程师** | 跨库同步、生产→测试数据刷新、临时数据备份 |
| **数据开发** | 异构 DB ETL、临时查询结果分析 |
| **业务用户** | 导出 Excel 给领导、临时数据交换 |
| **平台管理员** | 定时同步下辖各业务库数据 |

### 1.3 功能边界

**在范围（v1.3）：**

- ✅ **临时导出**：4 种文件格式 + 数据库目标，3 步向导
- ✅ **同步任务三层结构**：项目 → 任务 → 同步表
- ✅ **同步任务定时轮询**（node-cron）
- ✅ **自动建表**（导出到不存在的目标表）
- ✅ 容错模式（部分成功 + 失败列表）
- ✅ 复用 DClaw `connections` 表
- ✅ 瀚高/达梦/金仓类型映射

**不在范围：**

- ❌ CDC（永久剔除）
- ❌ 整库同步
- ❌ 双向同步 / 冲突解决
- ⏸️ DDL Schema diff（v2.0）
- ⏸️ 任务依赖 DAG（v2.1）

---

## 2. 总体架构 v1.3

### 2.1 双模式架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                       数据流转中枢 — DClaw                              │
├────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌────────────────────────┐              ┌────────────────────────┐  │
│  │  【A】临时导出模式          │              │  【B】同步任务模式        │  │
│  │  ⭐ v1.3 优先实现           │              │  v1.5/v1.6 实现         │  │
│  │                     │              │                     │  │
│  │  • 单次触发           │              │  • 保存到 PG         │  │
│  │  • 不入库             │              │  • 定时轮询           │  │
│  │  • 文件 + DB 目标      │              │  • 文件? 仅 DB 目标    │  │
│  │  • 无调度             │              │  • 三层结构           │  │
│  │  • 3 步向导           │              │  • API/调度/审计       │  │
│  └──────────┬───────────┘              └──────────┬─────────────┘  │
│             │                                       │                 │
│             └───────────────┬───────────────────────┘                │
│                             │                                         │
│                  ┌──────────▼─────────────┐                          │
│                  │   syncEngine 同步引擎   │                          │
│                  │   (单表同步核心)         │                          │
│                  │  - batchReader           │                          │
│                  │  - sqlBuilder            │                          │
│                  │  - transformer           │                          │
│                  │  - compare               │                          │
│                  └──────────┬─────────────┘                          │
│                             │                                         │
│                  ┌──────────▼─────────────┐                          │
│                  │   DBeaver-style 引擎    │                          │
│                  │  ⭐ exportEngine        │                          │
│                  │  - fileExporters:       │                          │
│                  │    - CSV / TSV          │                          │
│                  │    - SQL INSERT         │                          │
│                  │    - JSON               │                          │
│                  │    - XLSX (exceljs)     │                          │
│                  │  - dbExporter           │                          │
│                  │    - 自动建表（DDL生成） │                          │
│                  │    - INSERT/UPSERT       │                          │
│                  └────────────────────────┘                          │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 ⭐ 临时导出模式详解

#### 触发入口（三处）

| 入口 | UI 位置 | 行为 |
|------|--------|------|
| **元数据树右键菜单** | `MetadataBrowser.tsx` 表节点右键 | 表/视图 → 选中触发 |
| **SQL 编辑器** | `SqlEditor.tsx` 顶部工具栏「导出」按钮 | 当前查询结果 → 触发 |
| **顶部工具栏** | 顶部「数据导出」按钮 | 通用入口，需选源 |

#### 3 步向导

```
┌──────────────────────────────────────────────────────────────┐
│ 📤 数据导出向导                                          [×] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ●━━━━━━━━○━━━━━━━━○                                          │
│  1.选择源  2.选择目标  3.选项                                 │
│                                                               │
│  ── 步骤 1：选择源 ─────────────────────────────────────────   │
│                                                               │
│  ● 选中表                                                     │
│    数据库连接: [my-prod-db ▼]                                 │
│    目标表:   [health_syk.public.patients]  (82 张)              │
│                                                               │
│  ○ 自定义 SQL 查询                                            │
│    [Monaco Editor]                                            │
│    SELECT * FROM patients WHERE created_at > ...             │
│                                                               │
│                                       [下一步 →]              │
└──────────────────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────────────────┐
│ 📤 数据导出向导                                          [×] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ○━━━━━━━━●━━━━━━━━○                                          │
│  1.选择源  2.选择目标  3.选项                                 │
│                                                               │
│  ── 步骤 2：选择目标 ───────────────────────────────────────── │
│                                                               │
│  ● 文件导出                                                   │
│    格式: [CSV ▼] [SQL] [JSON] [XLSX] [TSV]                  │
│    编码: [UTF-8 ▼]                                            │
│    字段分隔符: [,]                                            │
│    文本限定符: ["]                                            │
│    保存路径: [C:\Users\admin\Desktop\export_2026-07-28.csv]   │
│              [📂 浏览...]                                     │
│                                                               │
│  ───────  或者  ───────                                       │
│                                                               │
│  ● 数据库导出                                                 │
│    目标连接: [analytics-db ▼]                                 │
│    目标 Schema: [public]                                      │
│    目标表名: [patients_export]                                │
│    ☑ 不存在则自动创建                                         │
│    写入策略: ● INSERT  ○ UPSERT (需主键)  ○ REPLACE           │
│                                                               │
│                            [← 上一步]  [下一步 →]            │
└──────────────────────────────────────────────────────────────┘
```

```
┌──────────────────────────────────────────────────────────────┐
│ 📤 数据导出向导                                          [×] │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ○━━━━━━━━○━━━━━━━━●                                          │
│  1.选择源  2.选择目标  3.选项                                 │
│                                                               │
│  ── 步骤 3：选项 ──────────────────────────────────────────── │
│                                                               │
│  ☑ 包含列标题行（仅文件）                                     │
│  ☑ 分批读取，每批 [10000] 行                                  │
│  分隔符: [,]  文本限定符: ["]                                 │
│  WHERE 过滤条件: [_____________________________________]      │
│                                                               │
│  ── 预估 ─────────────────────────────────────────             │
│  源行数: ~82,000                                              │
│  预估文件大小: ~6.5 MB                                        │
│  预估耗时: ~3 秒                                              │
│                                                               │
│              [← 上一步]  [👁 预览 100 行]  [▶ 开始导出]     │
└──────────────────────────────────────────────────────────────┘
```

**预览 100 行**：在向导内显示前 100 行数据，用户确认格式无误后再执行。

#### 执行进度（SSE 流式）

```
导出中...
██████████████░░░░░░░░  68%  55,000 / 82,000 行
已写入: 48 秒  剩余: ~22 秒  速率: 1,070 行/秒
[取消]
```

#### 完成提示

```
✅ 导出成功
📄 文件: C:\Users\admin\Desktop\export_2026-07-28.csv (8.2 MB)
📊 总行数: 82,000
⏱ 耗时: 73 秒
[打开文件] [打开位置] [完成]
```

### 2.3 文件格式详细规范

| 格式 | 编码 | 大小建议 | 实现方式 | 复用场景 |
|------|------|---------|---------|---------|
| **CSV** | UTF-8 / GBK | ≤ 50 万行 | Node 内置 `fs.createWriteStream` | Excel / 数据交换 |
| **TSV** | UTF-8 / GBK | ≤ 50 万行 | 同上，字段 `\t` 分隔 | 数据库导出兼容 |
| **SQL INSERT** | UTF-8 | ≤ 50 万行 | Node 内置 + 模板 | DB 迁移脚本 |
| **JSON** | UTF-8 | ≤ 50 万行 | Node 内置 + `JSON.stringify` | API 集成 |
| **XLSX** | UTF-8 | ≤ 10 万行 | `exceljs`（流式写入） | 业务报表 |

**SQL INSERT 格式示例**：

```sql
-- 由 DClaw 数据钳在 2026-07-28 13:30:00 导出
-- 源: my-prod-db.health_syk.public.patients (82 张)
SET client_encoding TO 'UTF8';

INSERT INTO "patients" ("id", "name", "age", "created_at") VALUES
(1, '张三', 30, '2026-07-01 10:00:00'),
(2, '李四', 25, '2026-07-02 11:30:00'),
...
;

-- 提交
COMMIT;
```

### 2.4 大文件保护

| 阈值 | 行为 |
|------|------|
| > 100 MB 文件 | 弹出"文件较大，是否继续"对话框 |
| > 50 万行 CSV/SQL/JSON | 提示"建议改用 SQL/TSV 或 XLSX" |
| > 10 万行 XLSX | 提示"分批写入每 1 万行保存一次" |
| 失败 | 写入 `_partial.{ext}` 备份文件 |

### 2.5 自动建表（导出到 DB 时）

用户勾选「不存在则自动创建」后：

1. 读源表结构（`information_schema.columns` 或 JDBC `DatabaseMetaData`）
2. 按 `transformer.mjs` 类型映射生成目标 DDL
3. 执行 `CREATE TABLE IF NOT EXISTS`
4. **记录 source/target 类型映射**到导出历史（如启用）

**支持的源→目标 DB 组合**：
- MySQL → MySQL / PostgreSQL / 瀚高 / 达梦 / 金仓
- PostgreSQL → 同上
- 瀚高 / 达梦 / 金仓 → 同上（国产 DB 互相导出也是常见场景）

---

## 3. 功能规划 v1.3

| # | 功能 | v1.3 优先级 | 说明 |
|---|------|------------|------|
| F1 | **临时导出模式** | **P0** ⭐ 首版核心 | 4 种文件格式 + DB 目标 + 3 步向导 |
| F2 | 临时导出自动建表 | P0 | 目标表不存在自动 DDL |
| F3 | 临时导出预览 | P1 | 前 100 行预览 |
| F4 | **同步任务 - 项目层** | P1 | 项目 CRUD + 权限 |
| F5 | **同步任务 - 任务层** | P1 | 任务 CRUD + 调度 |
| F6 | **同步任务 - 表层** | P1 | 表映射 CRUD + 字段映射编辑器 |
| F7 | 同步任务定时轮询 | P1 | 任务级 node-cron |
| F8 | 全量同步引擎 | P0（v1.3.0）+ 完善（v1.4） | 单表 SELECT → INSERT |
| F9 | 增量同步 + Checkpoint | P2 | v1.4 |
| F10 | 类型转换完善 | P1 | 含国产 DB 映射 |
| F11 | 字段映射可视化 | P1 | 拖拽映射 |
| F12 | 敏感表黑名单 | P2 | 跨临时导出 + 同步任务 |
| F13 | 操作审计 | P2 | 跨所有写操作 |

---

## 4. 数据模型（PG 表）

> **临时导出模式不入 PG**——它是单次操作，不入库。仅"导出历史"可选地记录到 sync_export_history（如要审计时启用）。

```sql
-- 同步项目（v1.2 已规划）
CREATE TABLE sync_projects ( ... );

-- 同步任务（v1.2 已规划）
CREATE TABLE sync_tasks ( ... );

-- 同步表映射（v1.2 已规划）
CREATE TABLE sync_table_mappings ( ... );

-- 同步执行历史（v1.2 已规划）
CREATE TABLE sync_history ( ... );

-- Checkpoint（v1.2 已规划）
CREATE TABLE sync_checkpoints ( ... );

-- 同步操作审计（v1.2 已规划）
CREATE TABLE sync_audit_log ( ... );

-- 敏感表黑名单（v1.2 已规划）
CREATE TABLE sync_table_blacklist ( ... );

-- ⭐ v1.3 新增：导出历史（可选，通常用于审计）
CREATE TABLE export_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         VARCHAR(100) NOT NULL,
  source_conn     VARCHAR(100) NOT NULL,
  source_table    VARCHAR(200),
  source_sql      TEXT,                                -- 如果是 SQL 查询导出
  target_type     VARCHAR(20) NOT NULL,                 -- 'file' | 'database'
  target_format   VARCHAR(20),                         -- 'csv' | 'sql' | ...
  target_path     TEXT,                                -- 文件路径
  target_conn     VARCHAR(100),                        -- 数据库目标
  target_table    VARCHAR(200),
  total_rows      INTEGER,
  file_size       BIGINT,
  duration_ms     INTEGER,
  status          VARCHAR(20),                         -- 'success' | 'failed' | 'cancelled'
  errors          JSONB DEFAULT '[]',
  ip              VARCHAR(45),
  timestamp       TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_export_history_user_id ON export_history(user_id);
CREATE INDEX idx_export_history_timestamp ON export_history(timestamp DESC);
```

---

## 5. API 设计

### 5.1 ⭐ v1.3 临时导出 API（即刻实现）

| Method | 路径 | 说明 |
|--------|------|------|
| POST | `/api/export/preview` | 预览前 100 行（不入库） |
| POST | `/api/export/execute` | 执行导出（SSE 流式进度） |
| POST | `/api/export/cancel/:id` | 取消执行中的导出 |
| GET | `/api/export/formats` | 获取支持的导出格式配置 |
| GET | `/api/export/history` | 导出历史（可选） |

### 5.2 同步任务 API（v1.3.1+ 再实现）

> 与 v1.2 规划一致，本节省略。

#### POST /api/export/execute 请求体

```json
{
  "source": {
    "connectionId": "conn_xxx",
    "schema": "public",
    "table": "patients",
    "sql": null,
    "filter": "created_at >= '2026-01-01'"
  },
  "target": {
    "type": "file",                           // 'file' | 'database'
    "file": {
      "format": "csv",                        // csv | tsv | sql | json | xlsx
      "encoding": "utf-8",
      "delimiter": ",",
      "quote": "\"",
      "includeHeader": true,
      "path": "/tmp/export_2026-07-28.csv"
    },
    "database": {
      "connectionId": "conn_yyy",
      "schema": "public",
      "table": "patients_export",
      "autoCreate": true,
      "writeStrategy": "insert",              // insert | upsert | replace
      "primaryKeys": ["id"]
    }
  },
  "options": {
    "batchSize": 10000,
    "maxRows": 500000,
    "previewOnly": false
  }
}
```

#### POST /api/export/execute 响应（SSE）

```
event: progress
data: {"stage":"reading","readRows":50000,"totalRows":82000,"pct":61}

event: progress
data: {"stage":"writing","writtenRows":50000,"totalRows":82000,"pct":61}

event: progress
data: {"stage":"complete","totalRows":82000,"durationMs":73000,"fileSize":8388608}

event: error
data: {"message":"...","stack":"..."}
```

---

## 6. 文件 / 模块清单

### 6.1 后端新增（v1.3.0）

| 文件 | 路径 | 说明 |
|------|------|------|
| `exportEngine.mjs` | `server/sync/exportEngine.mjs` | 导出核心 |
| `fileExporters.mjs` | `server/sync/exporters/fileExporters.mjs` | CSV/TSV/SQL/JSON/XLSX 5 种格式 |
| `dbExporter.mjs` | `server/sync/exporters/dbExporter.mjs` | DB 目标导出 + 自动建表 |
| `routes/export.mjs` | `server/routes/export.mjs` | 导出 API（SSE） |
| `exportTypes.mjs` | `server/sync/exportTypes.mjs` | 导出历史持久化 |

### 6.2 前端新增（v1.3.0）

| 文件 | 路径 | 说明 |
|------|------|------|
| `ExportWizard.tsx` | `src/components/data-export/ExportWizard.tsx` | 3 步向导 |
| `ExportStepSource.tsx` | 同目录 | 步骤 1：选择源 |
| `ExportStepTarget.tsx` | 同目录 | 步骤 2：选择目标 |
| `ExportStepOptions.tsx` | 同目录 | 步骤 3：选项 + 预览 |
| `ExportProgress.tsx` | 同目录 | SSE 进度条 |
| `exportStore.ts` | `src/stores/exportStore.ts` | 导出状态 |
| `exportService.ts` | `src/services/exportService.ts` | 导出 API 调用 |

### 6.3 修改

- `MetadataBrowser.tsx`：表右键菜单增加「导出数据」
- `SqlEditor.tsx`：工具栏增加「导出」按钮
- `TopBar.tsx`：增加「数据导出」按钮

---

## 7. 复用 v1.2 引擎

```
┌──────────────────────────────────────────────────────┐
│                syncEngine.mjs                         │
│  ┌────────────────┐  ┌────────────────┐              │
│  │ batchReader.mjs │  │ transformer.mjs │              │
│  │ 流式分批 SELECT │  │ 类型映射         │              │
│  └────────────────┘  └────────────────┘              │
│           ▼                    ▼                     │
│  ┌────────────────────────────────────┐              │
│  │ ⭐ exportEngine (复用 batchReader)   │              │
│  │                                    │              │
│  │ • file path → 文件流式写入          │              │
│  │ • db path → 复用 batchReader 读 +    │              │
│  │           sqlBuilder 写             │              │
│  └────────────────────────────────────┘              │
└──────────────────────────────────────────────────────┘
```

**核心代码复用**：导出和同步任务的"读源数据"环节共用 `batchReader.mjs`，"类型转换"共用 `transformer.mjs`。区别只在"目标写入"：
- 同步任务 → 写 DB（INSERT/UPDATE/UPSERT）
- 临时导出 → 写文件 或 写 DB

---

## 8. 分阶段实施计划（v1.3 重排版）

> 用户 2026-07-28 确认：临时导出进 v1.3.0 第一阶段，先于同步任务。

### 阶段一：**临时导出 MVP（v1.3.0）** — **3 周**

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 后端 `syncEngine.mjs` 单表 SELECT → INSERT 基础 | 2d | 核心引擎 |
| 后端 `batchReader.mjs` 流式分批 | 1d | 读取器 |
| 后端 `transformer.mjs` 基础类型转换 | 1d | MySQL↔PG 映射 |
| 后端 `exportEngine.mjs` 框架 | 1d | 导出引擎骨架 |
| 后端 `fileExporters.mjs` CSV/TSV 实现 | 1.5d | 2 种文件格式 |
| 后端 `fileExporters.mjs` SQL/JSON 实现 | 1.5d | 2 种文件格式 |
| 后端 `fileExporters.mjs` XLSX 实现（exceljs） | 1d | xlsx 流式写入 |
| 后端 `routes/export.mjs` API + SSE | 2d | 临时导出 API |
| 前端 `ExportWizard.tsx` 3 步向导 | 2d | UI 骨架 |
| 前端 5 个步骤组件 | 2d | UI 细节 |
| 前端 SSE 进度组件 | 1d | 实时进度条 |
| 前端触发入口 3 处 | 1d | 右键菜单 + 工具栏 |
| 集成测试 | 2d | MySQL→CSV / MySQL→PG / CSV 上传→PG |

**v1.3.0 交付**：用户可从元数据树右键 / SQL 编辑器 / 顶部按钮进入向导，导出 5 种格式到本地文件，或导出到数据库（自动建表）。

---

### 阶段二：**数据库导出完善（v1.4.0）** — **2 周**

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 自动建表（DDL 生成）— DDL 同步能力 v1.7 提前 | 1.5周 | 不存在则自动建表 |
| WHERE 复杂条件编辑 | 1d | UI |
| 字段子集选择 | 1d | 导出部分列 |
| UTF-8 / GBK 编码切换 | 0.5d | 中文字段支持 |
| 文件大时性能优化 | 1d | 流式优化 + 50 万行阈值 |
| 集成测试（异构 DB） | 1d | MySQL→瀚高 / 瀚高→PG |

---

### 阶段三：**同步任务三层结构（v1.5.0）** — **3 周**

| 任务 | 工时 | 交付物 |
|------|------|--------|
| PG 表结构创建（已在阶段零准备好） | 0d | 7 张表 |
| `sync-projects.mjs` 项目 CRUD API | 1.5d | 项目管理 |
| `sync-tasks.mjs` 任务 CRUD API | 2d | 任务管理 |
| `sync-tables.mjs` 表映射 CRUD API | 2d | 表映射管理 |
| `ProjectTreePanel` 左侧三层树 | 2d | UI |
| `TaskDetailPanel` 任务详情 + 表列表 | 2d | UI |
| `TableMappingEditor` 对话框 | 3d | 字段映射编辑器（最复杂） |
| 任务-表执行器（串行多表 + 容错） | 2d | `taskRunner.mjs` |
| 集成测试 | 1.5d | 端到端 |

---

### 阶段四：**定时轮询 + 调度（v1.6.0）** — **2 周**

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 集成 `node-cron` 依赖 | 0.5d | npm 包 |
| `scheduler.mjs` 任务级调度器 | 2d | 调度器核心 |
| 启停 API + UI | 1d | `/api/sync/tasks/:id/{start,stop}` |
| 立即执行 API + UI | 0.5d | `/api/sync/tasks/:id/run` |
| 同步历史 UI | 1d | 执行历史可视化 |
| 增量同步 + Checkpoint 落 PG | 3d | F9 + checkpoint 表 |
| 集成测试（30 秒轮询真跑通） | 1.5d | |

---

### 阶段五：**安全 + 完善（v1.7.0）** — **2 周**

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 项目级权限继承 | 1.5d | RBAC |
| 敏感表黑名单 | 1d | sync_table_blacklist |
| 同步操作审计 | 1d | sync_audit_log |
| 类型转换扩展（瀚高/达梦/金仓） | 2d | 国产 DB 全覆盖 |
| DDL Schema diff（CREATE TABLE IF NOT EXISTS） | 2d | DDL 同步 |
| E2E 测试（MySQL/PG/瀚高/达梦/金仓 互通） | 2d | 5 类 DB 全打通 |

---

### 阶段六：v2.0+（增强）

| 任务 | 说明 |
|------|------|
| 任务内多表并行执行 | E1 |
| 任务依赖 DAG | E2 |
| Webhook 通知（钉钉/企微） | E4 |
| 数据脱敏 | E7 |
| 回滚（Rollback） | E6 |

---

## 9. 里程碑总览

| 版本 | 时间 | 核心交付 | 累计工时 | 用户价值 |
|------|------|----------|---------|---------|
| **v1.3.0** | **+3 周** | **临时导出 MVP（文件 + DB）** | **3 周** | **数据备份/迁移/分析** |
| v1.4.0 | +2 周 | DB 导出完善（自动建表） | 5 周 | 一次性迁移流 |
| v1.5.0 | +3 周 | 同步任务三层结构 | 8 周 | 项目组织能力 |
| v1.6.0 | +2 周 | 定时轮询 | 10 周 | 准实时同步 |
| v1.7.0 | +2 周 | 安全 + 完善 | 12 周 | 生产可用 |

**首版可演示（v1.3.0）= 3 周后**：DBeaver 风格数据导出全部能力上线
**业务级可用（v1.6.0）= 10 周后**：完整数据流转（导出 + 同步）

---

## 10. 待评审项

请确认下列：

- [ ] **v1.3.0 临时导出 MVP 范围**（CSV/TSV/SQL/JSON/XLSX + DB 目标）
- [ ] **首版行数限制**（CSV/SQL/JSON 50 万行，XLSX 10 万行）
- [ ] **大文件保护阈值**（> 100MB 弹确认）
- [ ] **新增依赖** `exceljs`（用于 XLSX 流式导出）
- [ ] **导出历史表** 默认不启用（不影响用户）；启用需用户在系统设置中开
- [ ] **触发入口优先级**（元数据树右键 / SQL 编辑器 / 顶部工具栏）

---

## 11. 附录

### 11.1 TypeScript 类型增量

```typescript
// ⭐ v1.3 新增

export type ExportFormat = 'csv' | 'tsv' | 'sql' | 'json' | 'xlsx';
export type ExportTargetType = 'file' | 'database';

export interface ExportRequest {
  source: {
    connectionId: string;
    schema?: string;
    table?: string;
    sql?: string;              // SQL 查询导出
    filter?: string;
  };
  target: ExportTarget;
  options?: ExportOptions;
}

export interface ExportTarget {
  type: ExportTargetType;
  file?: FileExportConfig;
  database?: DatabaseExportConfig;
}

export interface FileExportConfig {
  format: ExportFormat;
  encoding: 'utf-8' | 'gbk';
  delimiter?: string;          // CSV/TSV
  quote?: string;              // CSV/SQL
  includeHeader?: boolean;
  path: string;
}

export interface DatabaseExportConfig {
  connectionId: string;
  schema?: string;
  table: string;
  autoCreate?: boolean;        // 自动建表
  writeStrategy: 'insert' | 'upsert' | 'replace';
  primaryKeys?: string[];
}

export interface ExportOptions {
  batchSize?: number;          // 默认 10000
  maxRows?: number;            // 默认 500000
  previewOnly?: boolean;       // 仅返回前 100 行
}

export interface ExportProgressEvent {
  stage: 'reading' | 'transforming' | 'writing' | 'complete' | 'error';
  readRows?: number;
  writtenRows?: number;
  totalRows?: number;
  pct?: number;
  speed?: number;              // 行/秒
  message?: string;
}

export interface ExportCompleteEvent {
  totalRows: number;
  durationMs: number;
  fileSize?: number;           // 文件导出
  tableCreated?: boolean;      // DB 导出自动建表
}
```

### 11.2 与 DBeaver 对齐能力清单

| DBeaver 功能 | DClaw v1.3 实现 | 备注 |
|--------------|-----------------|------|
| 表右键 → 导出数据 | ✅ 元数据树右键 | |
| 查询结果导出 | ✅ SQL 编辑器工具栏 | |
| CSV 导出 | ✅ | |
| TSV 导出 | ✅ | |
| SQL 导出（INSERT） | ✅ | |
| JSON 导出 | ✅ | |
| XLSX 导出 | ✅ exceljs 流式 | |
| 目标 = 本地文件 | ✅ | |
| 目标 = 数据库（同/异构） | ✅ | |
| 自动建表 | ✅（v1.4） | DBeaver 也支持 |
| 导出历史记录 | ⚠️ 可选表 | DBeaver 默认有 |
| 保存导出配置为模板 | ❌ v2.x | DBeaver 不支持 |
| 多张表批量导出 | ✅ v1.5 同步任务搞定 | DBeaver 通过 zip |

### 11.3 风险表 v1.3

| 风险 | 影响 | 概率 | 应对 |
|------|------|------|------|
| 大文件内存爆 | 服务 OOM | 中 | 流式写入 + 50 万行阈值 |
| 编码错乱 | 中文乱码 | 中 | 默认 UTF-8；GBK 选项 |
| XLSX 流式写入内存大 | 10 万行限制 | 中 | exceljs 流式 Writer |
| 自动建表类型映射错 | 写入失败 | 中 | transformer 类型表 + 警告 |
| SSE 长连接断 | 用户看不到进度 | 中 | 客户端自动重连 + 状态查询 |
| 同步/导出同时运行同一表 | 锁冲突 | 低 | 任务级锁（v1.6.0） |
| 用户误删目标表数据 | 数据丢失 | 中 | 导出向导二次确认 |

---

**变更记录**
- 2025-07-10：v1.0 创建
- 2026-07-28：v1.1（删 CDC、加定时轮询、PG 化）
- 2026-07-28（当日上午）：v1.2（三层结构）
- 2026-07-28（当日下午）：v1.3（加入临时导出模式，重新排期）
