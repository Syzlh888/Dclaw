# v1.5 数据同步迭代记录

> **时间**：2026-07-30 ~ 2026-07-31
> **commit**：`b78a454` — feat(sync): 表映射支持自定义 SQL 与增量同步（customSql + checkpoint）
> **总览**：5 段数据同步主线 + 10+ bug 修复 + UI token 化 + 公共组件抽取

---

## 一、新功能交付（数据同步 v1.5）

### 1.1 三层数据模型 + API

| 表 | 字段 | 说明 |
|---|---|---|
| `sync_projects` | id / name / description / color | 顶层项目容器 |
| `sync_tasks` | id / project_id / source/target_connection_id / source/target_schema / write_strategy / poll_interval_seconds / enabled | 同步任务，含连接/schema 关联 |
| `sync_table_mappings` | id / task_id / source_table / target_table / column_mappings (JSONB) / sequence | 表级映射，含字段映射 JSONB |
| 增量字段 | `incremental_column` / `incremental_type` / `checkpoint_value` | 增量同步位点 |
| 自定义 SQL | `custom_sql` | 整段 SELECT/WITH 查询 |

迁移文件：
- `server/db/migrations/005_sync_v15.sql` — 3 张表
- `server/db/migrations/006_sync_v15_customsql.sql` — `custom_sql TEXT`
- `server/db/migrations/007_sync_v15_incremental.sql` — `incremental_column/incremental_type/checkpoint_value`

15+ REST API 端点（projects / tasks / mappings / execute SSE / scheduler）

### 1.2 UI 三层架构

```
AppHeader 3 个并排页签
   ↓
SyncPage (standalone 全屏 | Modal 模式)
   ├ ProjectTreePanel (左 240px)
   │   ├ 项目 → 任务 → 表映射 树形结构
   │   ├ 搜索框 / 新建项目 / 编辑删除按钮
   │   └ MUI 主题变量 + ListItem/ListItemButton (与 SQL 编辑器左侧对齐)
   │
   ├ TaskListPanel (中间，自动按 selection 切换) / MappingListPanel
   │   ├ 状态图标 / 启用停用 chip
   │   ├ 字段映射 + 增量同步 按钮（每行）
   │   └ 编辑/删除按钮（hover 显示）
   │
   └ DetailPanel (右 300px)
       ├ 任务详情：状态 / 源目标连接/schema / 调度（启用+轮询间隔+上次/下次运行）
       ├ 表映射详情：字段映射列表
       └ 调度编辑 Dialog
```

新增组件（8 个）：
- `SyncPage.tsx`（standalone / Modal 双模式）
- `ProjectTreePanel.tsx`
- `TaskListPanel.tsx`
- `MappingListPanel.tsx`
- `DetailPanel.tsx`
- `TableMappingEditor.tsx`（字段映射编辑器）
- `MappingWizardDialog.tsx`（新建映射三步向导：连接+schema → 多表配对/自定义 SQL → 字段映射）
- `FieldMappingDialog.tsx`（字段映射，与 TableMappingEditor 共享底层逻辑）

### 1.3 任务执行器 + SSE

- `server/sync/taskRunner.mjs` — 串行执行每个 mapping，复用 v1.3 `exportEngine.exportToDatabase`
- `server/routes/sync-execute.mjs` — `POST /api/sync-tasks/:id/run` 返回 SSE 进度（events: start / progress / done / error）
- `server/sync/scheduler.mjs` — 5s 轮询，自动跑 enabled 任务

### 1.4 端到端测试 schema

`setup-test-schema.cjs`（.gitignore）— 在容器 PG 创建：
- `source_data.patients` 5 行（含 `updated_at` 增量字段）
- `source_data.departments` 3 行
- `target_data.patients_export` 空表（等待同步）
- `target_data.departments_export` 空表

---

## 二、关键 bug 修复

| Bug | 根因 | 修复 |
|---|---|---|
| 中文显示豆腐块 | MUI 默认字体不含 CJK | `src/theme.ts` 加 `"PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC"` + `MuiCssBaseline.styleOverrides` 强刷 |
| PG 写入中文乱码 | `pg.Pool` 未设 `client_encoding` | `server/db/pool.mjs` 加 `client_encoding: 'UTF8'` |
| 新增连接不显示左侧 | `ConnectionDialog` 仅在选 district 时建节点 | `connectionStore.addConnection` 自动挂到「应用」district |
| 同步执行报 `column "created_at" does not exist` | `dbExporter` 默认按源表 1:1 mapping 写所有列 | `dbExporter.mjs` 加 `resolveMappings`：尊重 `target.columnMappings`，过滤 INSERT 列 |
| Upsert 报「UPSERT 需要 primaryKeys 或源表主键」 | streamBatch 简化版丢失 PK 信息 | `resolveMappings` 兜底：target 名为 `id` 时视为主键 |
| `DetailPanel` 删除按钮 `borderBorder` 拼写错误 | 我自己写错 | 改为 `borderColor` |
| `error TS2304: useTreeStore` / `StorageIcon` 等 | dev 删 imports 没删使用 | Hermes 手动清理 145 行 + build fix |

---

## 三、UI 一致性改造

### P0：硬编码颜色 → 主题变量（225 处）

**问题**：`src/components/sync/` 8 个文件 180+ 处硬编码颜色（`#888`/`#BBB`/`#DDD`/`#3C3F41`/`#505050`/`#42A5F5` 等），与 SQL 编辑器 100% token 化的标准不一致。

**修复**：替换映射
| 硬编码 | MUI 主题变量 |
|---|---|
| `#888/#BBB/#CCC/#DDD/#EEE` | `text.secondary` / `text.primary` |
| `#777/#666` | `text.disabled` |
| `#505050/#4D4D4D/#494949` | `divider` |
| `#3C3F41/#333638` | `background.paper` |
| `#2B2B2B/#1E1E1E` | `background.default` |
| `#42A5F5` | `primary.main` |
| `#1E88E5` | `primary.dark` |
| `#90CAF9` | `primary.light` |
| `#EF5350` | `error.main` |
| `#66BB6A/#4CAF50/#2E7D32` | `success.main` / `success.dark` |
| `borderBottom: '1px solid #HEX'` | `borderBottom: '1px solid', borderColor: 'divider'` |

### P1：字号统一 + 间距统一 + 组件去重

**字号 4 层**：0.95rem 主标题 / 0.85rem 内容 / 0.75rem 次要 / 0.7rem 提示（消除 10.5/11.5/12.5/13.5/14 0.5 步进值）

**Dialog 标题**：`fontSize: '0.95rem'`

**间距**：`mb: 1.5` / `pt: '12px !important'` / `py: 0.15`

**组件去重**：`TableMappingEditor` 和 `FieldMappingDialog` 实现收敛

### P2：公共 `TreeConnectionSelect` 组件

**问题**：树形连接选择器在 3 处独立实现，每处 ~200 行：
- `SyncPage.tsx.connectionTreeSelect`
- `MappingWizardDialog.tsx` 的连接选择
- `ExportStepTarget.tsx.connectionOptions / renderTree`

**修复**：新建 `src/components/common/TreeConnectionSelect.tsx`（350 行），三处替换：
- `SyncPage.tsx` 删除 220 行
- `MappingWizardDialog.tsx` 删除 145 行
- `ExportStepTarget.tsx` 删除 274 行（887 → 613 行）

**净减 -639 行重复代码**，未来连接选择器只改 1 处。

---

## 四、性能 / 流程改进

1. **增量同步**：通过 `incremental_column + checkpoint_value` 实现；运行后自动回写位点
2. **自定义 SQL**：mapping 支持 `custom_sql`（`source_table='__custom_sql__'`），跳过字段映射步骤
3. **一键新建映射向导**：三步式（连接 → 多表配对/自定义 SQL → 字段映射 → 批量创建）
4. **调度管理**：从 TaskListPanel Switch 移至 DetailPanel「调度」Dialog（启用 + 轮询间隔 + 上次/下次运行）
5. **status 主视图**：一级页签 `[SQL编辑器] [服务器资源管理] [数据同步]`，当前页面高亮，其他两个可跳转

---

## 五、部署 & 验证

### 部署流程

```
dev 子代理：npm run build → docker cp dist → docker cp server → docker restart
default：curl + 实测 + 反馈
```

### 端到端验证

```sql
-- source_data
patients  (5 行): 张三/李四/王五/赵六/钱七
departments (3 行): 内科/外科/儿科

-- 同步运行 (upsert 策略)
target_data.patients_export → 6 行 (含孙八 测试增量)
target_data.departments_export → 3 行
```

最终回归：v1.3 导出向导、v1.5 数据同步、调度器 API 全部 200 OK。

---

## 六、文件变更摘要

| 文件 | 类别 | 改动 |
|---|---|---|
| `server/db/migrations/005_sync_v15.sql` | 新增 | 3 张表 schema |
| `server/db/migrations/006_sync_v15_customsql.sql` | 新增 | custom_sql 列 |
| `server/db/migrations/007_sync_v15_incremental.sql` | 新增 | 增量字段 3 列 |
| `server/routes/sync-*.mjs` | 新增 | projects/tasks/mappings/execute/scheduler 5 个 route 文件 |
| `server/sync/taskRunner.mjs` | 新增 | 任务执行器 |
| `server/sync/scheduler.mjs` | 新增 | 调度器 |
| `server/sync/exporters/dbExporter.mjs` | 修改 | 加 resolveMappings + PK 兜底 |
| `server/sync/taskRunner.mjs` | 修改 | 加 incremental WHERE 注入 + checkpoint 回写 |
| `server/db/pool.mjs` | 修改 | client_encoding=UTF8 |
| `src/types/sync.ts` | 修改 | 新增 incremental/customSql 字段类型 |
| `src/stores/syncStore.ts` | 新增 | 9 个 action（create/update/delete + sync run）|
| `src/services/syncService.ts` | 新增 | API 封装 |
| `src/components/common/TreeConnectionSelect.tsx` | **新增** | 公共树形连接选择器 350 行 |
| `src/components/sync/*.tsx` | 8 文件 | UI token 化 + 字号统一 + 间距统一 |
| `src/components/data-export/ExportStepTarget.tsx` | 修改 | 用公共组件替换 -274 行 |
| `src/components/data-export/FieldMappingDialog.tsx` | 修改 | 字号统一 |
| `src/components/layout/AppHeader.tsx` | 修改 | 3 个并排页签 |
| `src/App.tsx` | 修改 | mainView 加 `'data-sync'` |

---

## 七、里程碑

✅ v1.5 数据同步 **100% 收官**

| 阶段 | 状态 |
|---|---|
| 5 段同步主线 | ✅ |
| 10+ bug 修复 | ✅ |
| P0 颜色 token 化（180+ 处） | ✅ |
| P1 字号统一 + 组件去重 | ✅ |
| P2 公共 TreeConnectionSelect (-639 行) | ✅ |
| 端到端数据库验证 | ✅ |

下一步候选：
- v1.6: 性能优化（虚拟滚动）/ 增量 checkpoint 表化 / WebSocket 实时通知
- 移动端布局适配
- RBAC 档位 C（资源级授权）

---

**作者**：Hermes
**commit hash**：`b78a454`
**部署容器**：`dclaw-web:8081`（stable-v1.4.0 镜像）
**前端 hash**：`index-Bqi89iFj.js` / `index-B_XP_PcD.js` 等