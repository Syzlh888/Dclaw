# 数据同步功能 — 规划设计 v1

> **文档版本**: v1.0  
> **创建日期**: 2025-07-10  
> **项目**: DClaw（db-unify）v1.2.0+  
> **状态**: 待评审

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
| **平台管理员** | 定时将下辖各业务库数据汇总到中心库 |

### 1.3 功能边界

**在范围（v1.0 核心功能）：**

- 同构/异构数据库间的表级数据同步（全量 + 增量）
- 可视化字段映射 + 自动类型转换
- 同步前预览差异（INSERT/UPDATE/DELETE 统计）
- Dry-Run 模式（只生成 SQL 不执行）
- 过滤条件（WHERE 子句）
- 分批读取（大表分页）+ 事务保护

**不在范围（v1.0）：**

- CDC（Change Data Capture）实时变更捕获
- 整库同步（仅支持表级）
- DDL 同步（仅同步数据）
- 多表 JOIN 同步
- 双向同步 / 冲突解决（单向同步为主）

---

## 2. 功能规划

### 2.1 核心功能（v1.0）

| # | 功能 | 说明 | 优先级 |
|---|------|------|--------|
| F1 | 全量同步 | 源表全量数据 SELECT → INSERT 到目标表 | P0 |
| F2 | 增量同步 | 基于时间戳字段或自增 ID 字段筛选新增/变更行 | P0 |
| F3 | 字段映射 | 自动按名称匹配 + 手动拖拽编辑映射关系 | P0 |
| F4 | 类型转换 | 跨数据库类型自动转换（如 MySQL INT → PG INTEGER） | P0 |
| F5 | 过滤条件 | 用户自定义 WHERE 子句筛选同步数据 | P1 |
| F6 | 预览模式 | 执行前比对源/目标表，展示 INSERT/UPDATE/DELETE 行数统计 | P1 |
| F7 | Dry-Run | 仅生成同步 SQL 脚本，不实际执行 | P1 |
| F8 | 分批读取 | 大表按行数分批读取，避免内存溢出 | P0 |
| F9 | 事务保护 | 每批数据在一个事务内写入（同构数据库），失败回滚 | P1 |
| F10 | 同步历史 | 记录每次同步的配置、行数、耗时、状态 | P2 |

### 2.2 扩展功能（v2.0+）

| # | 功能 | 说明 | 规划版本 |
|---|------|------|----------|
| E1 | 定时调度 | 配置 Cron 表达式定期执行同步任务 | v2.0 |
| E2 | 保存同步任务 | 将同步配置保存为可复用的任务模板 | v2.0 |
| E3 | DDL 同步 | 目标表自动创建/变更（需结构化比对源/目标 Schema） | v2.0 |
| E4 | 多任务依赖 | 任务编排，T1 完成后触发 T2 | v2.1 |
| E5 | CDC 实时同步 | 基于 Debezium / 日志解析的实时增量同步 | v2.2 |
| E6 | 邮件/Webhook 通知 | 同步完成/失败时发送通知 | v2.0 |

---

## 3. 总体架构

### 3.1 模块划分

```
┌──────────────────────────────────────────────────────────────────┐
│                          前端 (React)                             │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  DataSyncPage                                  (新增)    │   │
│  │  ├── SyncConfigPanel    — 源/目标选择 + 模式配置          │   │
│  │  ├── FieldMappingPanel  — 拖拽映射（自动+手动）           │   │
│  │  ├── FilterPanel        — WHERE 条件编辑                  │   │
│  │  ├── PreviewPanel       — 差异统计 + 数据预览             │   │
│  │  ├── DryRunResultPanel  — 生成的 SQL 脚本展示             │   │
│  │  └── ExecProgressPanel  — 同步执行进度（复用 ExecutionST) │   │
│  └───────────────────────────────────────────────────────────┘   │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  dataSyncStore         (新增)                             │   │
│  │  dataSyncService       (新增)                             │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│                       后端 API (Express)                          │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  /api/sync/*                    (新增路由 sync.mjs)       │   │
│  │  ├── POST /configure     — 获取源/目标元数据               │   │
│  │  ├── POST /preview       — 差异比对 + 统计                 │   │
│  │  ├── POST /dry-run       — 生成同步 SQL（不执行）          │   │
│  │  ├── POST /execute       — 执行同步（SSE 流式推送）       │   │
│  │  ├── GET  /history       — 同步历史列表                   │   │
│  │  └── GET  /history/:id   — 同步详情                       │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│                     同步引擎层 (新增)                              │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  syncEngine.mjs               — 同步引擎核心逻辑           │   │
│  │  ├── compare.mjs              — 差异比对算法               │   │
│  │  ├── transformer.mjs          — 字段映射 + 类型转换        │   │
│  │  ├── batchReader.mjs          — 分批读取器                 │   │
│  │  └── sqlBuilder.mjs           — 跨库 SQL 生成器            │   │
│  └───────────────────────────────────────────────────────────┘   │
├──────────────────────────────────────────────────────────────────┤
│                   持久化层 (JSON 文件)                             │
│  ┌───────────────────────────────────────────────────────────┐   │
│  │  data/sync_history.json         (新增)                    │   │
│  │  data/sync_tasks.json           (新增, v2.0)              │   │
│  └───────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

### 3.2 新增文件清单

#### 后端新增

| 文件 | 路径 | 说明 |
|------|------|------|
| `sync.mjs` | `server/routes/sync.mjs` | 数据同步路由（配置、预览、Dry-Run、执行、历史） |
| `syncEngine.mjs` | `server/sync/syncEngine.mjs` | 同步引擎核心：全量、增量、批量执行 |
| `compare.mjs` | `server/sync/compare.mjs` | 差异比对算法（全表比对 / 键值比对） |
| `transformer.mjs` | `server/sync/transformer.mjs` | 字段映射解析 + 类型转换规则 |
| `batchReader.mjs` | `server/sync/batchReader.mjs` | 分批读取器（分页流式读取） |
| `sqlBuilder.mjs` | `server/sync/sqlBuilder.mjs` | 跨库 SQL 生成（INSERT/UPDATE/DELETE） |

#### 前端新增

| 文件 | 路径 | 说明 |
|------|------|------|
| `DataSyncPage.tsx` | `src/components/data-sync/DataSyncPage.tsx` | 数据同步主页面 |
| `SyncConfigPanel.tsx` | `src/components/data-sync/SyncConfigPanel.tsx` | 源/目标选择面板 |
| `FieldMappingPanel.tsx` | `src/components/data-sync/FieldMappingPanel.tsx` | 字段映射拖拽面板 |
| `FilterPanel.tsx` | `src/components/data-sync/FilterPanel.tsx` | WHERE 过滤条件编辑 |
| `PreviewPanel.tsx` | `src/components/data-sync/PreviewPanel.tsx` | 差异预览面板 |
| `DryRunResultPanel.tsx` | `src/components/data-sync/DryRunResultPanel.tsx` | Dry-Run SQL 展示 |
| `dataSyncStore.ts` | `src/stores/dataSyncStore.ts` | 数据同步 Zustand 状态管理 |
| `dataSyncService.ts` | `src/services/dataSyncService.ts` | 数据同步 API 调用封装 |
| `sync.ts` | `src/types/sync.ts` | 数据同步 TypeScript 类型定义 |

#### 持久化新增

| 文件 | 路径 | 说明 |
|------|------|------|
| `sync_history.json` | `data/sync_history.json` | 同步执行历史记录 |
| `sync_tasks.json` | `data/sync_tasks.json` | 保存的同步任务配置（v2.0） |

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
| `database.mjs` 中的 `getAll/insert/update` | 复用 — 持久化同步历史 |
| `crypto.mjs` 中的 `decryptPassword` | 复用 — 解密连接密码 |
| `sqlValidator.mjs` | 复用 — 检查生成的 SQL 安全性 |
| `Stores` 模式（executionStore 等） | 复用 — dataSyncStore 按相同范式编写 |
| `Services` 模式（executionService 等） | 复用 — dataSyncService 按相同范式编写 |

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

**实现要点：**

- 全量同步通过 `batchReader.mjs` 按 `pageSize`（默认 5000 行/批）分批读取源表
- 每批数据由 `sqlBuilder.mjs` 生成批量 INSERT 语句执行写入
- 支持两种策略：
  - **覆盖模式**（默认）：写入前先 `TRUNCATE target_table` 或 `DELETE FROM target_table`
  - **追加模式**：不清理目标表，直接 INSERT

#### 4.1.2 增量同步（Incremental Sync）

```
流程:
1. 确定增量字段（时间戳或自增 ID）
2. 记录上次同步的 checkpoint（最大时间戳 / 最大 ID）
3. SELECT * FROM source_table WHERE inc_field > last_checkpoint [AND condition]
4. 对目标表执行 INSERT（新增行）/ UPDATE（变更行）混合操作
```

**两种增量策略：**

| 策略 | 增量字段 | 适用场景 | 实现方式 |
|------|---------|---------|---------|
| **基于时间戳** | `updated_at`, `modified_date` 等 | 有更新时间戳的表 | `WHERE updated_at > '2025-07-09 12:00:00'` |
| **基于自增 ID** | `id`, `seq_no` 等 | 只增不删的表 | `WHERE id > 1000` |

**Checkpoint 持久化：**

Checkpoint 存储在同步历史记录中（`sync_history.json` 的 `checkpoint` 字段）：
```json
{
  "id": "sync_abc123",
  "source": { "connectionId": "conn_001", "table": "orders", "schema": "public" },
  "target": { "connectionId": "conn_002", "table": "orders" },
  "mode": "incremental",
  "incrementalField": "updated_at",
  "checkpoint": "2025-07-10T08:00:00.000Z",
  "status": "success"
}
```

#### 4.1.3 差异同步（Diff Sync）— v1.0 重点

先比对源表和目标表的数据差异，然后只同步差异部分。适用于目标表已有部分数据的场景。

```
流程:
1. 读取源表所有行 → Map<主键值, row>
2. 读取目标表所有行 → Map<主键值, row>
3. 比对：循环遍历源表 Map
   a. 主键在目标表不存在 → INSERT 标记
   b. 主键在目标表存在但字段值不同 → UPDATE 标记
   c. 主键在目标表存在且值相同 → 跳过
4. 循环遍历目标表 Map
   a. 主键在源表不存在 → DELETE 标记（可选）
5. 返回差异统计和差异数据
```

**注意**：差异同步要求源表和目标表**必须有主键**。无主键表无法进行差异比对，退化为全量同步。

### 4.2 字段映射机制

#### 4.2.1 自动映射（Auto-Mapping）

```
算法:
1. 获取源表列名列表 S = [source_col1, source_col2, ...]
2. 获取目标表列名列表 T = [target_col1, target_col2, ...]
3. 对 S 中每个 name，在 T 中查找 name（不区分大小写）
4. 匹配上的建立映射关系
5. 未匹配的源字段标记为「未映射」
6. 未匹配的目标字段标记为「未填充」
```

**匹配优先级：**
1. 大小写不敏感精确匹配：`userId` ↔ `userid` / `userid` ↔ `USERID`
2. 去除下划线后匹配：`user_id` ↔ `userid`
3. 去除下划线后拼音/缩写匹配（v2.0 可选）

#### 4.2.2 手动映射

```typescript
interface FieldMapping {
  sourceField: string;
  sourceType: string;
  targetField: string;
  targetType: string;
  /** 转换表达式，为空则直接映射 */
  transformExpr?: string;
  /** 是否为主键（用于差异比对） */
  isPrimaryKey: boolean;
  /** 是否跳过该字段 */
  skip: boolean;
  /** 映射状态 */
  status: 'matched' | 'unmatched_source' | 'unmatched_target' | 'custom';
}
```

前端交互：
- 左侧列出源字段，右侧列出目标字段
- 用户点击源字段后，点击目标字段建立映射连接（连线可视化）
- 支持拖拽配对
- 未映射的源字段显示警告图标
- 点击映射关系可编辑类型转换表达式

#### 4.2.3 主键配置

用户需指定源表和目标表的主键字段（用于差异同步的比对 key）。自动检测逻辑：
1. 通过元数据 API 获取表的主键信息（MySQL：`SHOW KEYS WHERE Key_name = 'PRIMARY'`，PG：`pg_constraint`）
2. 若无法自动获取（如无主键约束），由用户手动选择
3. 无主键的表在差异同步模式下提示用户降级为全量同步

### 4.3 类型转换规则

#### 4.3.1 内置转换映射表

转换规则在 `transformer.mjs` 中以对象映射形式定义：

```javascript
// 核心类型映射：MySQL → PostgreSQL
const MYSQL_TO_POSTGRESQL = {
  'tinyint':            { type: 'smallint',           cast: '::smallint' },
  'smallint':           { type: 'smallint',           cast: '::smallint' },
  'mediumint':          { type: 'integer',            cast: '::integer' },
  'int':                { type: 'integer',            cast: '::integer' },
  'bigint':             { type: 'bigint',             cast: '::bigint' },
  'float':              { type: 'real',               cast: '::real' },
  'double':             { type: 'double precision',   cast: '::double precision' },
  'decimal':            { type: 'numeric',            cast: '::numeric' },
  'varchar':            { type: 'varchar',            cast: '::varchar' },
  'char':               { type: 'char',               cast: '::char' },
  'text':               { type: 'text',               cast: '::text' },
  'tinytext':           { type: 'text',               cast: '::text' },
  'mediumtext':         { type: 'text',               cast: '::text' },
  'longtext':           { type: 'text',               cast: '::text' },
  'blob':               { type: 'bytea',              cast: '::bytea' },
  'datetime':           { type: 'timestamp',          cast: '::timestamp' },
  'timestamp':          { type: 'timestamptz',        cast: '::timestamptz' },
  'date':               { type: 'date',               cast: '::date' },
  'time':               { type: 'time',               cast: '::time' },
  'year':               { type: 'integer',            cast: '::integer' },
  'boolean':            { type: 'boolean',            cast: '::boolean' },
  'tinyint(1)':         { type: 'boolean',            cast: '::boolean' },
  'json':               { type: 'jsonb',              cast: '::jsonb' },
  'enum':               { type: 'varchar',            cast: '::varchar' },
  'set':                { type: 'text[]',             cast: '::text[]' },
};

// PostgreSQL → MySQL
const POSTGRESQL_TO_MYSQL = {
  'smallint':           { type: 'smallint',          cast: '' },
  'integer':            { type: 'int',               cast: '' },
  'bigint':             { type: 'bigint',            cast: '' },
  'real':               { type: 'float',             cast: '' },
  'double precision':   { type: 'double',            cast: '' },
  'numeric':            { type: 'decimal(65,30)',    cast: '' },
  'varchar':            { type: 'varchar',           cast: '' },
  'text':               { type: 'longtext',          cast: '' },
  'bytea':              { type: 'blob',              cast: '' },
  'timestamp':          { type: 'datetime',          cast: '' },
  'timestamptz':        { type: 'datetime',          cast: '' },
  'jsonb':              { type: 'json',              cast: '' },
  'boolean':            { type: 'tinyint(1)',        cast: '' },
};
```

#### 4.3.2 运行时转换

```javascript
// transformer.mjs 核心函数
function transformValue(value, sourceType, targetType) {
  if (value === null || value === undefined) return 'NULL';
  
  const rule = getTypeRule(sourceType, targetType);
  if (!rule) return escapeValue(value, targetType); // 无规则时按原始类型转义
  
  switch (rule.transform) {
    case 'boolean_to_int':
      return value ? 1 : 0;
    case 'int_to_boolean':
      return value !== 0;
    case 'numeric_cast':
      return `CAST(${escapeValue(value)} AS ${rule.targetType})`;
    case 'string_cast':
      return escapeValue(String(value));
    default:
      return escapeValue(value, targetType);
  }
}
```

#### 4.3.3 特殊值处理

| 场景 | 处理方式 |
|------|---------|
| NULL 值 | 写入 `NULL`，不做转换 |
| 空字符串 | 保持 `''`，不转为 NULL |
| 超出范围数值 | 抛出警告，截断或跳过 |
| 日期格式差异 | 统一转 ISO 8601 字符串，目标端 `CAST` |
| BLOB/二进制 | MySQL→PG 用 `\\x...` 十六进制格式 |
| JSON/JSONB | MySQL JSON → PG JSONB 直接传递 |

### 4.4 增量同步策略

#### 4.4.1 增量字段检测

自动检测用户选择的表中可能的增量字段：

```javascript
function detectIncrementalFields(columns) {
  const candidates = [];
  
  for (const col of columns) {
    const name = col.name.toLowerCase();
    const type = col.type.toLowerCase();
    
    // 时间戳类字段
    if (['timestamp', 'datetime', 'timestamptz', 'date'].includes(type)) {
      if (['updated_at', 'modified_at', 'update_time', 'last_modified', 'modified_date']
          .some(k => name.includes(k))) {
        candidates.push({ ...col, incType: 'timestamp' });
      }
    }
    
    // 自增 ID 类字段
    if (col.isAutoIncrement || col.default?.includes('nextval') 
        || col.extra?.includes('auto_increment')) {
      candidates.push({ ...col, incType: 'id' });
    }
  }
  
  return candidates;
}
```

#### 4.4.2 Checkpoint 管理

```javascript
// 从同步历史中获取上次 checkpoint
function getLastCheckpoint(sourceConnId, sourceTable, targetConnId, targetTable) {
  const history = getAll('syncHistory');
  // 找到同源/同目标的最近一次成功记录
  return history
    .filter(h => h.source.connectionId === sourceConnId 
              && h.source.table === sourceTable
              && h.target.connectionId === targetConnId
              && h.target.table === targetTable
              && h.status === 'success'
              && h.checkpoint !== undefined)
    .sort((a, b) => new Date(b.executedAt) - new Date(a.executedAt))[0]?.checkpoint;
}
```

### 4.5 差异比对算法

#### 4.5.1 基于主键的差异比对（默认方式）

```
时间复杂度：O(N + M)，N=源行数，M=目标行数
空间复杂度：O(min(N, M))，仅缓存较小一方的 Map
```

```javascript
async function diffByPrimaryKey(sourceConn, targetConn, config) {
  const { sourceTable, targetTable, primaryKeys, fieldMappings } = config;
  
  // 1. 分批读取源表和目标表
  const sourceRows = await readAllRows(sourceConn, sourceTable, config.filter);
  const targetRows = await readAllRows(targetConn, targetTable);
  
  // 2. 构建主键索引
  const sourceMap = buildKeyMap(sourceRows, primaryKeys);
  const targetMap = buildKeyMap(targetRows, primaryKeys);
  
  // 3. 比对差异
  const diff = {
    toInsert: [],    // 源有目标无
    toUpdate: [],    // 两者 key 相同但值不同
    toDelete: [],    // 目标有源无（可选）
    unchanged: 0,
  };
  
  // 映射后的字段（仅比较映射后存在的字段）
  const targetFields = fieldMappings.filter(m => !m.skip).map(m => m.targetField);
  
  for (const [key, sourceRow] of sourceMap) {
    const targetRow = targetMap.get(key);
    if (!targetRow) {
      diff.toInsert.push(sourceRow);
    } else if (!rowsEqual(sourceRow, targetRow, targetFields)) {
      diff.toUpdate.push({ source: sourceRow, target: targetRow });
    } else {
      diff.unchanged++;
    }
    sourceMap.delete(key); // 剩余的就是需要删除的
  }
  
  if (config.deleteExtra) {
    for (const [key, targetRow] of targetMap) {
      diff.toDelete.push(targetRow);
    }
  }
  
  return diff;
}
```

#### 4.5.2 分批差异比对（大表优化）

当源表或目标表行数超过 `maxRowsInMemory`（默认 50000 行）时，采用分批比对：

```javascript
async function batchedDiff(sourceConn, targetConn, config) {
  const { primaryKeys, pageSize = 50000 } = config;
  
  // 按主键排序后分页，逐页比对
  let offset = 0;
  const diff = { toInsert: [], toUpdate: [], toDelete: [], skipped: 0 };
  
  while (true) {
    const sourceBatch = await readPage(sourceConn, sourceTable, 
      `ORDER BY ${primaryKeys.join(', ')} LIMIT ${pageSize} OFFSET ${offset}`);
    
    if (sourceBatch.length === 0) break;
    
    const keyValues = sourceBatch.map(r => buildKey(r, primaryKeys));
    const targetBatch = await readByKeys(targetConn, targetTable, 
      primaryKeys, keyValues);
    
    // 比对这一批...
    // ...
    
    offset += pageSize;
  }
  
  return diff;
}
```

### 4.6 分批读取策略

#### 4.6.1 通用分页读取器

```javascript
// batchReader.mjs
export async function* batchRead(conn, driver, table, options = {}) {
  const {
    columns = '*',
    filter = '',
    orderBy = '',
    pageSize = 5000,
    schema = '',
    incrementalField = '',
    checkpoint = '',
    primaryKeys = [],
  } = options;
  
  const tableRef = buildTableRef(table, schema, driver);
  const colList = Array.isArray(columns) ? columns.map(c => quoteIdentifier(c, driver)).join(', ') : columns;
  
  // 构建基础 SELECT
  let baseSql = `SELECT ${colList} FROM ${tableRef}`;
  
  // 增量过滤
  const conditions = [];
  if (filter) conditions.push(`(${filter})`);
  if (incrementalField && checkpoint) {
    const quotedField = quoteIdentifier(incrementalField, driver);
    conditions.push(`${quotedField} > '${checkpoint}'`);
  }
  if (conditions.length > 0) baseSql += ` WHERE ${conditions.join(' AND ')}`;
  
  // 排序（确保分页一致）
  const order = orderBy || (primaryKeys.length > 0 
    ? primaryKeys.map(k => quoteIdentifier(k, driver)).join(', ')
    : '1');
  baseSql += ` ORDER BY ${order}`;
  
  // 分页
  let offset = 0;
  let totalRead = 0;
  
  while (true) {
    const pageSql = buildPageSql(baseSql, driver, pageSize, offset);
    const result = await executeQuery(conn, driver, pageSql);
    
    if (!result.rows || result.rows.length === 0) break;
    
    totalRead += result.rows.length;
    yield { rows: result.rows, offset, pageSize, totalRead };
    
    if (result.rows.length < pageSize) break; // 最后一页
    offset += pageSize;
  }
}
```

#### 4.6.2 跨库分页语法适配

```javascript
function buildPageSql(baseSql, driver, pageSize, offset) {
  switch (driver) {
    case 'mysql':
      return `${baseSql} LIMIT ${pageSize} OFFSET ${offset}`;
    case 'postgresql':
      return `${baseSql} LIMIT ${pageSize} OFFSET ${offset}`;
    case 'oracle':
      // Oracle 12c+
      return `SELECT * FROM (${baseSql}) WHERE ROWNUM BETWEEN ${offset + 1} AND ${offset + pageSize}`;
    case 'sqlserver':
      // SQL Server 2012+
      return `${baseSql} OFFSET ${offset} ROWS FETCH NEXT ${pageSize} ROWS ONLY`;
    default:
      return `${baseSql} LIMIT ${pageSize} OFFSET ${offset}`;
  }
}
```

### 4.7 事务与错误处理

#### 4.7.1 事务策略

| 场景 | 策略 | 说明 |
|------|------|------|
| 同构数据库（源=目标类型） | **环境事务** | 每批数据使用 BEGIN...COMMIT 包裹，失败 ROLLBACK |
| 异构数据库（源≠目标类型） | **无事务** | 无法跨数据库事务，逐行/逐批写入，失败记录日志 |
| 增量同步 | **逐批事务** | 每批数据独立事务，失败不影响已写入的批次 |

#### 4.7.2 错误处理

```javascript
// syncEngine.mjs
async function executeSyncBatch(conn, driver, sqlBatch, batchIndex) {
  const errors = [];
  let successCount = 0;
  
  for (let i = 0; i < sqlBatch.length; i++) {
    try {
      const result = await executeQuery(conn, driver, sqlBatch[i]);
      successCount += result.rowsAffected || 0;
    } catch (err) {
      errors.push({ index: i, sql: sqlBatch[i].substring(0, 200), error: err.message });
      
      if (config.errorStrategy === 'abort') {
        return { successCount, errors, aborted: true };
      }
      // 'skip' 策略：继续执行下一行
    }
  }
  
  return { successCount, errors, aborted: false };
}
```

**错误策略配置：**

| 策略 | 行为 | 适用场景 |
|------|------|---------|
| `skip`（默认） | 跳过错误行，继续执行 | 大部分表允许部分行失败 |
| `abort` | 遇到第一个错误就中止 | 数据一致性要求高的场景 |
| `retry` | 单行重试 2 次，仍失败则跳过 | 网络抖动场景 |

#### 4.7.3 同步中断恢复

同步引擎在执行过程中如果中断（重启、超时、网络问题），通过 SyncProgress 状态支持恢复：

```javascript
// 每批完成后更新进度
update('syncHistory', executionId, {
  progress: {
    totalBatches: estimatedBatchCount,
    completedBatches: completedCount,
    totalRows: totalRowsRead,
    insertedRows: insertedCount,
    updatedRows: updatedCount,
    deletedRows: deletedCount,
    currentOffset: offset,
  },
  checkpoint: lastIncrementalValue,
});
```

---

## 5. API 设计

### 5.1 数据同步 API

#### `POST /api/sync/configure` — 获取源/目标表元数据

**请求体：**
```json
{
  "sourceConnectionId": "conn_001",
  "sourceSchema": "public",
  "sourceTable": "orders",
  "targetConnectionId": "conn_002",
  "targetSchema": "",
  "targetTable": "orders_copy"
}
```

**响应：**
```json
{
  "source": {
    "connectionId": "conn_001",
    "table": "orders",
    "rowCount": 150000,
    "columns": [
      { "name": "id", "type": "int", "nullable": false, "isPrimaryKey": true, "autoIncrement": true },
      { "name": "user_id", "type": "int", "nullable": false, "isPrimaryKey": false },
      { "name": "total_amount", "type": "decimal(10,2)", "nullable": true },
      { "name": "created_at", "type": "datetime", "nullable": false },
      { "name": "updated_at", "type": "datetime", "nullable": true }
    ],
    "primaryKeys": ["id"],
    "incrementalCandidates": [
      { "field": "updated_at", "type": "timestamp" },
      { "field": "id", "type": "autoIncrement" }
    ]
  },
  "target": {
    "connectionId": "conn_002",
    "table": "orders_copy",
    "rowCount": 120000,
    "columns": [
      { "name": "id", "type": "integer", "nullable": false, "isPrimaryKey": true },
      { "name": "user_id", "type": "integer", "nullable": false },
      { "name": "total_amount", "type": "numeric", "nullable": true },
      { "name": "created_at", "type": "timestamp", "nullable": false },
      { "name": "updated_at", "type": "timestamp", "nullable": true }
    ],
    "primaryKeys": ["id"],
    "incrementalCandidates": []
  }
}
```

### 5.2 预览 API

#### `POST /api/sync/preview` — 差异比对预览

**请求体：**
```json
{
  "sourceConnectionId": "conn_001",
  "sourceTable": "orders",
  "sourceSchema": "public",
  "targetConnectionId": "conn_002",
  "targetTable": "orders_copy",
  "targetSchema": "",
  "mode": "diff",
  "primaryKeys": ["id"],
  "fieldMappings": [
    { "sourceField": "id", "targetField": "id", "isPrimaryKey": true },
    { "sourceField": "user_id", "targetField": "user_id" },
    { "sourceField": "total_amount", "targetField": "total_amount" },
    { "sourceField": "created_at", "targetField": "created_at" },
    { "sourceField": "updated_at", "targetField": "updated_at" }
  ],
  "filter": "created_at >= '2025-01-01'",
  "incrementalField": "updated_at",
  "maxPreviewRows": 100
}
```

**响应：**
```json
{
  "diff": {
    "toInsert": 4500,
    "toUpdate": 320,
    "toDelete": 150,
    "unchanged": 115030,
    "estimatedTotalBytes": "45 MB"
  },
  "sampleData": {
    "toInsert": [
      { "id": 10001, "user_id": 501, "total_amount": "299.00", "created_at": "2025-07-10T10:00:00", "updated_at": "2025-07-10T10:00:00" }
    ],
    "toUpdate": [
      { "source": { "id": 5001, "total_amount": "199.00", "updated_at": "2025-07-10T09:00:00" },
        "target": { "id": 5001, "total_amount": "99.00", "updated_at": "2025-07-09T18:00:00" } }
    ],
    "toDelete": [
      { "id": 9001, "user_id": 999, "total_amount": "0.00", "created_at": "2024-12-31" }
    ]
  },
  "totalSourceRows": 150000,
  "totalTargetRows": 120000,
  "pageSize": 5000,
  "estimatedBatches": 30
}
```

### 5.3 Dry-Run API

#### `POST /api/sync/dry-run` — 生成同步 SQL 但不执行

**请求体：** 同 `/api/sync/preview`

**响应（SSE 流式）：**
```
event: sql
data: {"batch": 1, "sql": "INSERT INTO \"orders_copy\" (\"id\",\"user_id\",\"total_amount\",\"created_at\",\"updated_at\") VALUES (10001,501,299.00,'2025-07-10 10:00:00','2025-07-10 10:00:00');"}

event: sql
data: {"batch": 2, "sql": "..."}

event: complete
data: {"totalBatches": 30, "totalStatements": 4820, "estimatedSize": "45 MB"}
```

### 5.4 执行 API

#### `POST /api/sync/execute` — 执行同步（SSE 流式）

**请求体：**
```json
{
  "sourceConnectionId": "conn_001",
  "sourceTable": "orders",
  "targetConnectionId": "conn_002",
  "targetTable": "orders_copy",
  "mode": "incremental",
  "primaryKeys": ["id"],
  "fieldMappings": [...],
  "filter": "",
  "incrementalField": "updated_at",
  "pageSize": 5000,
  "syncConfig": {
    "truncateBeforeSync": false,
    "deleteExtraInTarget": false,
    "errorStrategy": "skip",
    "useTransaction": true
  }
}
```

**SSE 事件：**

```
event: progress
data: {"stage": "reading_source", "batch": 1, "totalBatches": 30, "rowsRead": 5000}

event: progress
data: {"stage": "writing_target", "batch": 1, "inserted": 4500, "updated": 320, "deleted": 0, "errors": 0}

event: progress
data: {"stage": "reading_source", "batch": 2, "totalBatches": 30, "rowsRead": 10000}

...

event: complete
data: {
  "executionId": "sync_abc123",
  "summary": {
    "totalSourceRows": 150000,
    "totalTargetRows": 120000,
    "inserted": 4500,
    "updated": 320,
    "deleted": 150,
    "errors": 2,
    "durationMs": 28500,
    "batches": 30
  },
  "checkpoint": "2025-07-10T10:00:00.000Z"
}
```

**同步历史记录：**
```json
{
  "id": "sync_abc123",
  "source": {
    "connectionId": "conn_001",
    "connectionName": "MySQL-Prod",
    "table": "orders",
    "schema": "public",
    "rowCount": 150000
  },
  "target": {
    "connectionId": "conn_002",
    "connectionName": "PG-Test",
    "table": "orders_copy",
    "schema": ""
  },
  "mode": "incremental",
  "incrementalField": "updated_at",
  "checkpoint": "2025-07-10T10:00:00.000Z",
  "fieldMapping": [...],
  "filter": "",
  "config": { "truncateBeforeSync": false, "deleteExtraInTarget": false, "errorStrategy": "skip", "pageSize": 5000 },
  "summary": { "inserted": 4500, "updated": 320, "deleted": 150, "errors": 2, "durationMs": 28500 },
  "status": "success",
  "executedAt": "2025-07-10T10:05:00.000Z"
}
```

### 5.5 历史 API

#### `GET /api/sync/history` — 同步历史列表

**响应：**
```json
{
  "history": [
    {
      "id": "sync_abc123",
      "sourceTable": "orders",
      "targetTable": "orders_copy",
      "mode": "incremental",
      "status": "success",
      "inserted": 4500,
      "updated": 320,
      "deleted": 150,
      "durationMs": 28500,
      "executedAt": "2025-07-10T10:05:00.000Z"
    }
  ]
}
```

#### `GET /api/sync/history/:id` — 同步详情

返回完整的同步历史记录（含字段映射、配置、错误详情等）。

---

## 6. 前端 UI 设计

### 6.1 页面结构

```
┌──────────────────────────────────────────────────────────────────────┐
│  数据同步                                                    [返回]  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─ 第一步：选择源和目标 ─────────────────────────────────────────┐  │
│  │  源数据库: [conn_001 ▼]  源表: [orders ▼]  Schema: [public]   │  │
│  │  目标数据库: [conn_002 ▼] 目标表: [orders_copy ▼]             │  │
│  │  [获取元数据] [切换源/目标]                                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ 第二步：字段映射 ────────────────────────────────────────────┐  │
│  │  ┌──────────┐    ───→    ┌──────────┐                          │  │
│  │  │ 源字段    │  ───→     │ 目标字段  │                          │  │
│  │  │ ☑ id (PK) ├──────────┤ ☑ id     │                          │  │
│  │  │ ☑ user_id ├──────────┤ ☐ -----  │  [自动匹配]               │  │
│  │  │ ☑ amount  ├──────────┤ ☑ amount │  [清除映射]               │  │
│  │  │ ☑ created ├──────────┤ ☑ created│                          │  │
│  │  │ ☑ updated ├──────────┤ ☑ updated│                          │  │
│  │  └──────────┘            └──────────┘                          │  │
│  │  [主键设置: id] [自动检测增量字段: updated_at]                  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ 第三步：同步配置 ───────────────────────────────────────────┐  │
│  │  同步模式: ○ 全量同步   ● 增量同步   ○ 差异同步              │  │
│  │  增量字段: [updated_at ▼]  (上次 Checkpoint: 2025-07-09 ...) │  │
│  │  WHERE 过滤: [created_at >= '2025-01-01'                    ]│  │
│  │  错误策略: [跳过错误行 ▼]  □ 目标表同步前清空                  │  │
│  │  □ 删除目标表多余行  □ 使用事务（同构数据库）                  │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│  ┌─ 操作按钮 ──────────────────────────────────────────────────┐  │
│  │  [◀ 预览差异]  [📄 Dry-Run]  [▶ 执行同步]                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 交互流程

```
1. 用户选择源数据库连接 → 自动查询可用 Schema → 查询可用表列表
2. 用户选择源表 → 获取表元数据（列名、类型、主键、行数）
3. 用户选择目标数据库连接 → 同理获取目标表元数据
4. 前端自动建立字段映射 → 渲染映射面板（源/目标列连线）
5. 用户可手动调整映射：拖拽匹配、添加/删除、编辑转换表达式
6. 用户选择同步模式 → 配置增量字段 / 主键 / 过滤条件
7. 用户点击「预览差异」→ POST /api/sync/preview → 展示差异统计 + 样本数据
8. 用户点击「Dry-Run」→ POST /api/sync/dry-run → SSE 流式展示生成的 SQL
9. 用户点击「执行同步」→ POST /api/sync/execute → SSE 流式展示执行进度
10. 执行完成后展示汇总报告，可查看同步历史
```

### 6.3 组件树

```
DataSyncPage
├── SyncConfigPanel
│   ├── SourceSelector (连接下拉 + 表下拉 + Schema 下拉)
│   ├── TargetSelector (连接下拉 + 表下拉)
│   ├── [切换源/目标按钮]
│   └── [获取元数据按钮]
├── FieldMappingPanel
│   ├── SourceColumnList (左侧字段树)
│   ├── TargetColumnList (右侧字段树)
│   ├── MappingLines (SVG 连接线)
│   ├── [自动匹配按钮] [清除映射按钮]
│   └── MappingEditor (编辑映射关系弹窗)
├── SyncConfigPanel
│   ├── ModeSelector (全量/增量/差异 radio group)
│   ├── IncrementalFieldSelect (增量字段下拉)
│   ├── PrimaryKeySelect (主键多选)
│   ├── FilterEditor (Monaco Editor 的 SQL 子集)
│   ├── ErrorStrategySelect
│   └── OptionsCheckboxes (清空/删除/事务)
├── ActionBar
│   ├── [PreviewButton]
│   ├── [DryRunButton]
│   ├── [ExecuteButton]
│   └── ProgressIndicator
├── PreviewPanel (条件渲染)
│   ├── DiffStats (INSERT/UPDATE/DELETE 数字卡片)
│   ├── SampleTable (样本数据表格)
│   └── BatchInfo (预计总批次数)
├── DryRunResultPanel (条件渲染)
│   ├── SqlViewer (Monaco Editor 只读)
│   └── DownloadButton (下载 SQL 文件)
├── SyncProgressPanel (条件渲染, 执行中)
│   ├── StageIndicator (reading/writing)
│   ├── BatchProgressBar
│   ├── LiveStats (已读/已写/错误数)
│   └── DetailList (每批明细)
└── SyncCompletePanel (条件渲染, 完成后)
    ├── SummaryCards (总行数/插入/更新/删除/耗时/错误)
    └── [新建同步] [查看历史]
```

---

## 7. 数据流设计

### 7.1 主流程

```
┌──────────┐    ┌───────────┐    ┌───────────┐    ┌───────────┐
│ 用户操作  │───▶│ 前端服务   │───▶│ 后端 API  │───▶│ 同步引擎  │
└──────────┘    └───────────┘    └───────────┘    └───────────┘
                                                     │
                  ┌──────────────────────────────────┼──────────────┐
                  ▼                                  ▼              ▼
           ┌──────────────┐                  ┌──────────────┐
           │   源数据库    │                  │   目标数据库  │
           │  (SELECT)    │                  │  (INSERT/    │
           │              │                  │   UPDATE/    │
           │              │                  │   DELETE)    │
           └──────────────┘                  └──────────────┘
```

#### 执行同步的详细数据流：

```
1. 前端 dataSyncService.execute() → fetch POST /api/sync/execute
2. Express sync.mjs 路由接收请求：
   a. 验证参数完整性
   b. 解密源/目标连接的密码
   c. 创建 SSE 响应流
   d. 校验当前 checkpoint（增量模式）
3. 调用 syncEngine.mjs 执行同步：
   a. 连接源数据库 → createDbConnection(sourceConn)
   b. 连接目标数据库 → createDbConnection(targetConn)
   c. 根据 mode 选择执行策略：
      - 全量：batchReader 逐批读取 → sqlBuilder 生成 INSERT
      - 增量：带上 checkpoint 过滤 → 生成 INSERT/UPDATE
      - 差异：先 diffByPrimaryKey → 按差异类型生成 SQL
   d. 每批读取后通过 SSE 推送 progress 事件
   e. 每批写入后通过 SSE 推送 progress 事件
   f. 执行完成推送 complete 事件 + 更新 checkpoint
4. 前端 SSE 解析器更新 dataSyncStore 状态：
   a. progress 事件 → 更新进度条和统计数字
   b. complete 事件 → 显示汇总报告
   c. error 事件 → 显示错误信息
```

### 7.2 状态管理

#### dataSyncStore（Zustand）

```typescript
// src/stores/dataSyncStore.ts
interface DataSyncState {
  // 配置阶段
  sourceConnectionId: string | null;
  sourceTable: string | null;
  sourceSchema: string | null;
  targetConnectionId: string | null;
  targetTable: string | null;
  targetSchema: string | null;
  
  // 元数据
  sourceMetadata: TableMeta | null;
  targetMetadata: TableMeta | null;
  fieldMappings: FieldMapping[];
  primaryKeys: string[];
  incrementalCandidates: IncrementalCandidate[];
  
  // 同步配置
  syncMode: 'full' | 'incremental' | 'diff';
  incrementalField: string | null;
  lastCheckpoint: string | null;
  filterSql: string;
  errorStrategy: 'skip' | 'abort' | 'retry';
  truncateBeforeSync: boolean;
  deleteExtraInTarget: boolean;
  useTransaction: boolean;
  pageSize: number;
  
  // 预览/Dry-Run
  previewResult: DiffPreview | null;
  isPreviewing: boolean;
  dryRunSqls: string[];
  isDryRunning: boolean;
  
  // 执行状态
  executionId: string | null;
  isExecuting: boolean;
  currentStage: 'idle' | 'reading_source' | 'writing_target' | 'completed' | 'error';
  currentBatch: number;
  totalBatches: number;
  rowsRead: number;
  inserted: number;
  updated: number;
  deleted: number;
  errors: number;
  errorDetails: SyncError[];
  
  // Actions
  setSource: (connId: string, table: string, schema?: string) => void;
  setTarget: (connId: string, table: string, schema?: string) => void;
  fetchMetadata: () => Promise<void>;
  autoMapFields: () => void;
  setFieldMappings: (mappings: FieldMapping[]) => void;
  setSyncConfig: (config: Partial<DataSyncState>) => void;
  preview: () => Promise<void>;
  dryRun: () => Promise<void>;
  execute: () => Promise<void>;
  reset: () => void;
}
```

**服务封装（dataSyncService.ts）：**

```typescript
// src/services/dataSyncService.ts
export async function executeSync(
  config: SyncExecuteRequest,
  callbacks: {
    onProgress?: (event: SyncProgressEvent) => void;
    onComplete?: (event: SyncCompleteEvent) => void;
    onError?: (message: string) => void;
  }
): Promise<AbortController>;
```

遵循与 `executionService.ts` 相同的 SSE 流式读取模式，使用 `fetch + ReadableStream` 解析 SSE 事件。

---

## 8. 分阶段实施计划

### 阶段一：基础能力（v1.3.0）— 2 周

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 实现 `syncEngine.mjs` 全量同步核心 | 3d | 全量 SELECT → INSERT 流程 |
| 实现 `batchReader.mjs` 分批读取器 | 2d | 流式分页读取 |
| 实现 `sqlBuilder.mjs` INSERT 生成 | 1d | 跨库 SQL 生成 |
| 实现 `transformer.mjs` 基础类型转换 | 2d | MySQL↔PG 类型映射表 |
| 实现 `POST /api/sync/execute` SSE 同步执行 | 2d | 同步执行 API |
| 添加同步历史持久化 | 1d | sync_history.json |
| 后端集成测试 | 2d | 通过率 ≥ 90% |

### 阶段二：增强功能（v1.4.0）— 2 周

| 任务 | 工时 | 交付物 |
|------|------|--------|
| 实现 `compare.mjs` 差异比对算法 | 3d | 基于主键的 diff |
| 实现增量同步（Checkpoint 管理） | 2d | 增量模式 |
| 实现 `POST /api/sync/preview` 预览 API | 2d | 差异预览 |
| 实现 `POST /api/sync/dry-run` Dry-Run API | 1d | SQL 生成 |
| 补充类型转换（Oracle/SQL Server 映射） | 2d | 完整映射表 |
| 事务保护 + 错误处理 | 1d | 事务回滚 |

### 阶段三：前端实现（v1.5.0）— 2 周

| 任务 | 工时 | 交付物 |
|------|------|--------|
| `DataSyncPage` 主页面 + `SyncConfigPanel` | 2d | 源/目标选择 UI |
| `FieldMappingPanel` 拖拽映射 | 3d | 可视化映射面板 |
| `FilterPanel` + `PreviewPanel` | 2d | 过滤 + 预览 |
| `DryRunResultPanel` + `SyncProgressPanel` | 2d | Dry-Run + 执行进度 |
| `dataSyncStore` + `dataSyncService` | 1d | 状态管理 + API 封装 |
| 集成测试 + 边界情况处理 | 2d | 端到端联调 |

### 阶段四：打磨与扩展（v1.6.0+）

| 任务 | 说明 |
|------|------|
| 同类型数据库差异比对性能优化 | 使用 `EXCEPT` / `MINUS` 语法在数据库内比对 |
| 定时调度（Cron）+ 保存同步任务 | 配合已有定时任务基础设施 |
| 大表同步性能优化 | 并行分片读取 + 并行写入 |
| 进度条精度优化 | 基于预估总行数计算进度百分比 |
| 同步结果通知 | 站内信 / Webhook |
| DDL 同步（CREATE TABLE IF NOT EXISTS） | 目标表不存在时自动创建 |

---

## 9. 附录

### 9.1 数据库类型映射表（完整）

| 分类 | MySQL | PostgreSQL | Oracle | SQL Server |
|------|-------|------------|--------|------------|
| 整数 | TINYINT | SMALLINT | NUMBER(3) | TINYINT |
| | SMALLINT | SMALLINT | NUMBER(5) | SMALLINT |
| | MEDIUMINT | INTEGER | NUMBER(7) | INT |
| | INT | INTEGER | NUMBER(10) | INT |
| | BIGINT | BIGINT | NUMBER(19) | BIGINT |
| 浮点 | FLOAT | REAL | BINARY_FLOAT | REAL |
| | DOUBLE | DOUBLE PRECISION | BINARY_DOUBLE | FLOAT |
| 定点 | DECIMAL(p,s) | NUMERIC(p,s) | NUMBER(p,s) | DECIMAL(p,s) |
| 字符 | CHAR(n) | CHAR(n) | CHAR(n) | CHAR(n) |
| | VARCHAR(n) | VARCHAR(n) | VARCHAR2(n) | VARCHAR(n) |
| 大文本 | TINYTEXT | TEXT | VARCHAR2(4000) | VARCHAR(MAX) |
| | TEXT | TEXT | CLOB | VARCHAR(MAX) |
| | MEDIUMTEXT | TEXT | CLOB | VARCHAR(MAX) |
| | LONGTEXT | TEXT | CLOB | VARCHAR(MAX) |
| 二进制 | TINYBLOB | BYTEA | BLOB | VARBINARY(MAX) |
| | BLOB | BYTEA | BLOB | VARBINARY(MAX) |
| | MEDIUMBLOB | BYTEA | BLOB | VARBINARY(MAX) |
| | LONGBLOB | BYTEA | BLOB | VARBINARY(MAX) |
| 时间 | DATE | DATE | DATE | DATE |
| | TIME | TIME | INTERVAL DS | TIME |
| | DATETIME | TIMESTAMP | DATE | DATETIME2 |
| | TIMESTAMP | TIMESTAMPTZ | TIMESTAMP | DATETIMEOFFSET |
| | YEAR | INTEGER | NUMBER(4) | INT |
| 其他 | BOOLEAN | BOOLEAN | NUMBER(1) | BIT |
| | JSON | JSONB | JSON | NVARCHAR(MAX) |
| | ENUM('a','b') | VARCHAR | VARCHAR2(1) | VARCHAR(1) |

### 9.2 风险与应对

| 风险 | 影响 | 概率 | 应对措施 |
|------|------|------|---------|
| 大数据量表 OOM | 服务崩溃 | 中 | 分批读取 + 限制 `maxRowsInMemory`（默认50000），超过阈值启用分批比对 |
| 跨库事务不一致 | 部分数据丢失/重复 | 高 | 同构库使用事务；异构库记录每批写入的 key 范围，失败后支持从断点恢复 |
| 字段映射遗漏 | 数据错位 | 中 | 自动映射后高亮「未映射」字段，强制用户处理后再执行 |
| 目标表不存在 | 执行失败 | 低 | v1.0 要求用户手动创建目标表；预览 API 返回表存在性检查 |
| 异构数据库类型不兼容 | 写入失败 | 中 | 类型转换表覆盖 ≥ 80% 常见类型，不支持的显示警告，用户可自定义转换表达式 |
| 同步过程中源表数据变化 | 数据不一致 | 中 | 文档性说明「同步期间请勿修改源表数据」；v2.0 可选 `SELECT ... FOR UPDATE` |
| 连接密码内存泄漏 | 安全风险 | 低 | 使用 `try/finally` 确保 `closeConnection` 被调用，密码变量使用后立即置空 |

### 9.3 参考资源

- **DBeaver Data Transfer 功能**：参考其「源/目标选择 → 字段映射 → 类型转换 → 执行」的四步交互流程
- **Apache SeaTunnel**：参考其多源多目标的同步引擎架构设计
- **Debezium**：参考其 CDC（Change Data Capture）范式（v2.x 扩展）
- **py-mysql2pgsql**：参考其 MySQL→PG 类型转换规则集合
- **现有 execute.mjs**：参考其 SSE 流式推送模式和并发池实现

### 9.4 关键类型定义（TypeScript）

```typescript
// src/types/sync.ts

/** 同步模式 */
export type SyncMode = 'full' | 'incremental' | 'diff';

/** 错误策略 */
export type ErrorStrategy = 'skip' | 'abort' | 'retry';

/** 同步阶段 */
export type SyncStage = 'idle' | 'reading_source' | 'writing_target' | 'completed' | 'error';

/** 字段映射 */
export interface FieldMapping {
  sourceField: string;
  sourceType: string;
  targetField: string;
  targetType: string;
  transformExpr?: string;
  isPrimaryKey: boolean;
  skip: boolean;
  status: 'matched' | 'unmatched_source' | 'unmatched_target' | 'custom';
}

/** 自增字段候选 */
export interface IncrementalCandidate {
  field: string;
  type: 'timestamp' | 'autoIncrement';
}

/** 同步配置 */
export interface SyncConfig {
  mode: SyncMode;
  incrementalField?: string;
  filter?: string;
  errorStrategy: ErrorStrategy;
  truncateBeforeSync: boolean;
  deleteExtraInTarget: boolean;
  useTransaction: boolean;
  pageSize: number;
}

/** 同步请求 */
export interface SyncExecuteRequest {
  sourceConnectionId: string;
  sourceTable: string;
  sourceSchema?: string;
  targetConnectionId: string;
  targetTable: string;
  targetSchema?: string;
  mode: SyncMode;
  primaryKeys: string[];
  fieldMappings: FieldMapping[];
  filter?: string;
  incrementalField?: string;
  pageSize?: number;
  syncConfig: SyncConfig;
}

/** 差异预览结果 */
export interface DiffPreview {
  toInsert: number;
  toUpdate: number;
  toDelete: number;
  unchanged: number;
  sampleData: {
    toInsert: Record<string, any>[];
    toUpdate: { source: Record<string, any>; target: Record<string, any> }[];
    toDelete: Record<string, any>[];
  };
  totalSourceRows: number;
  totalTargetRows: number;
  estimatedBatches: number;
}

/** 同步进度（SSE） */
export interface SyncProgressEvent {
  executionId: string;
  stage: SyncStage;
  batch: number;
  totalBatches: number;
  rowsRead?: number;
  inserted?: number;
  updated?: number;
  deleted?: number;
  errors?: number;
  currentOffset?: number;
  timestamp: number;
}

/** 同步完成事件 */
export interface SyncCompleteEvent {
  executionId: string;
  summary: {
    totalSourceRows: number;
    totalTargetRows: number;
    inserted: number;
    updated: number;
    deleted: number;
    errors: number;
    durationMs: number;
    batches: number;
  };
  checkpoint?: string;
  timestamp: number;
}

/** 同步错误详情 */
export interface SyncError {
  batch: number;
  index: number;
  sql: string;
  error: string;
}
```
