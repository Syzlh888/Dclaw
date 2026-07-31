-- ============================================================
-- 007_sync_v15_incremental.sql — sync_table_mappings 增加增量同步字段
--
-- 设计：复用 mapping.where_clause + 新字段 incremental_column / incremental_type / checkpoint_value
--   - taskRunner 自动把 checkpoint_value 注入 where_clause 末尾
--   - 运行成功后用 MAX(incremental_column) 更新 checkpoint_value
--
-- 字段说明：
--   incremental_column  VARCHAR(128)  源表用于增量比对的列名（如 updated_at / id）
--   incremental_type    VARCHAR(16)   'timestamp' | 'numeric'
--                                       - timestamp: 列值是日期/时间字符串/ISO，SQL 里以字符串字面量比较
--                                       - numeric:   列值是数字，SQL 里以数字字面量比较（避免引号）
--   checkpoint_value    TEXT          上一次同步成功的位点；为空/未配置 = 全量同步
-- ============================================================

ALTER TABLE sync_table_mappings
  ADD COLUMN IF NOT EXISTS incremental_column VARCHAR(128),
  ADD COLUMN IF NOT EXISTS incremental_type   VARCHAR(16),
  ADD COLUMN IF NOT EXISTS checkpoint_value   TEXT;

COMMENT ON COLUMN sync_table_mappings.incremental_column IS
  '增量同步列名（源表字段）。为空表示未启用增量。';
COMMENT ON COLUMN sync_table_mappings.incremental_type IS
  '增量列类型：timestamp | numeric。决定 checkpoint_value 在 SQL 里以字符串还是数字形式参与比较。';
COMMENT ON COLUMN sync_table_mappings.checkpoint_value IS
  '上次增量同步成功的位点值；每次 run 后用 MAX(incremental_column) 自动更新。';