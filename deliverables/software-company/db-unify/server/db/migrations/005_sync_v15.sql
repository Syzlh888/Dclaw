-- ============================================================
-- DClaw v1.5 数据同步（三层结构：项目 / 任务 / 表映射）
--
-- 原则 (与 001 一致):
--   1. 主键 VARCHAR(20) 字符串，nanoid 生成
--   2. 时间字段 TIMESTAMPTZ
--   3. 不使用外键，关联由应用层保证
--   4. 可选 / 松散字段进 JSONB extra
--   5. 全部 IF NOT EXISTS 幂等
-- ============================================================

-- ------------------------------------------------------------
-- 同步项目 (sync_projects)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_projects (
  id          VARCHAR(20) PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  color       VARCHAR(16)  DEFAULT '#1976D2',
  sort_order  INTEGER      NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ,
  extra       JSONB
);
COMMENT ON TABLE sync_projects IS '数据同步项目（顶层容器）';

CREATE INDEX IF NOT EXISTS idx_sync_projects_sort
  ON sync_projects(sort_order);

-- ------------------------------------------------------------
-- 同步任务 (sync_tasks)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_tasks (
  id                    VARCHAR(20) PRIMARY KEY,
  project_id            VARCHAR(20) NOT NULL,
  name                  VARCHAR(255) NOT NULL,
  source_connection_id  VARCHAR(20) NOT NULL,
  source_schema         VARCHAR(128),
  target_connection_id  VARCHAR(20) NOT NULL,
  target_schema         VARCHAR(128),
  poll_interval_seconds INTEGER      NOT NULL DEFAULT 60,
  enabled               BOOLEAN      NOT NULL DEFAULT TRUE,
  write_strategy        VARCHAR(32)  NOT NULL DEFAULT 'insert',
  last_run_at           TIMESTAMPTZ,
  last_run_status       VARCHAR(32),
  last_run_rows         INTEGER      NOT NULL DEFAULT 0,
  sort_order            INTEGER      NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ,
  extra                 JSONB
);
COMMENT ON TABLE sync_tasks IS '数据同步任务（项目 → 任务的中间层）';

CREATE INDEX IF NOT EXISTS idx_sync_tasks_project
  ON sync_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_sync_tasks_enabled
  ON sync_tasks(enabled) WHERE enabled = TRUE;

-- ------------------------------------------------------------
-- 表映射 (sync_table_mappings)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_table_mappings (
  id              VARCHAR(20) PRIMARY KEY,
  task_id         VARCHAR(20)  NOT NULL,
  source_table    VARCHAR(255) NOT NULL,
  target_table    VARCHAR(255) NOT NULL,
  enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
  where_clause    TEXT,
  orderby         VARCHAR(256),
  sequence        INTEGER      NOT NULL DEFAULT 0,
  sort_order      INTEGER      NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  -- columnMappings 数组 (JSON) 存这里: [{source,target,type}]
  column_mappings JSONB        DEFAULT '[]'::jsonb,
  extra           JSONB
);
COMMENT ON TABLE sync_table_mappings IS '数据同步表映射（任务的列级规则）';

CREATE INDEX IF NOT EXISTS idx_sync_table_mappings_task
  ON sync_table_mappings(task_id);
CREATE INDEX IF NOT EXISTS idx_sync_table_mappings_seq
  ON sync_table_mappings(task_id, sequence);
