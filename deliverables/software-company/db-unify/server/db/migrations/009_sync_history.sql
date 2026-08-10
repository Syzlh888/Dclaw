-- ============================================================
-- 009_sync_history.sql — 数据同步增强 (并发 / 重试 / 历史 / 映射状态)
--
-- 新增：
--   1. sync_run_history   每次 taskRunner 跑映射都写一条历史
--   2. sync_table_mappings.last_run_*   单映射级别的最后运行状态
--   3. sync_tasks.max_concurrent / retry_count / from_scratch  支持可配置并发与重试
-- ============================================================

-- ------------------------------------------------------------
-- 同步运行历史 (sync_run_history)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_run_history (
  id             BIGSERIAL PRIMARY KEY,
  task_id        VARCHAR(20) NOT NULL,
  mapping_id     VARCHAR(20),
  status         VARCHAR(32)  NOT NULL,    -- success | failed | running | skipped
  rows_synced    INTEGER      NOT NULL DEFAULT 0,
  duration_ms    INTEGER      NOT NULL DEFAULT 0,
  attempts       INTEGER      NOT NULL DEFAULT 1,
  error_message  TEXT,
  started_at     TIMESTAMPTZ  NOT NULL,
  finished_at    TIMESTAMPTZ
);
COMMENT ON TABLE sync_run_history IS '数据同步运行历史（按 mapping 粒度记录每次执行结果）';
COMMENT ON COLUMN sync_run_history.task_id IS '所属任务 ID';
COMMENT ON COLUMN sync_run_history.mapping_id IS '所属映射 ID（任务级历史可为空）';
COMMENT ON COLUMN sync_run_history.status IS 'success=成功 / failed=失败 / running=执行中 / skipped=跳过';
COMMENT ON COLUMN sync_run_history.rows_synced IS '本次同步行数';
COMMENT ON COLUMN sync_run_history.duration_ms IS '本次执行耗时（毫秒）';
COMMENT ON COLUMN sync_run_history.attempts IS '尝试次数（含重试）';
COMMENT ON COLUMN sync_run_history.error_message IS '失败原因';

CREATE INDEX IF NOT EXISTS idx_sync_run_history_task
  ON sync_run_history(task_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_run_history_mapping
  ON sync_run_history(mapping_id, started_at DESC) WHERE mapping_id IS NOT NULL;

-- ------------------------------------------------------------
-- sync_table_mappings 增加 last_run_* 字段
-- ------------------------------------------------------------
ALTER TABLE sync_table_mappings
  ADD COLUMN IF NOT EXISTS last_run_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_run_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS last_run_rows   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_run_error  TEXT;

COMMENT ON COLUMN sync_table_mappings.last_run_at IS
  '单映射级别：最近一次执行开始时间';
COMMENT ON COLUMN sync_table_mappings.last_run_status IS
  '单映射级别：最近一次执行结果 success | failed | running';
COMMENT ON COLUMN sync_table_mappings.last_run_rows IS
  '单映射级别：最近一次同步行数';
COMMENT ON COLUMN sync_table_mappings.last_run_error IS
  '单映射级别：最近一次失败原因';

-- ------------------------------------------------------------
-- sync_tasks 增加可配置并发 / 重试参数
-- ------------------------------------------------------------
ALTER TABLE sync_tasks
  ADD COLUMN IF NOT EXISTS max_concurrent  INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS retry_count     INTEGER NOT NULL DEFAULT 2;

COMMENT ON COLUMN sync_tasks.max_concurrent IS
  'taskRunner 同时执行的映射数（默认 3，最大 16）';
COMMENT ON COLUMN sync_tasks.retry_count IS
  '单映射失败时的最大重试次数（默认 2，指数退避 1s/2s/4s）';
