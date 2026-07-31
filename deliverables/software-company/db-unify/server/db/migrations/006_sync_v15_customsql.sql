-- ============================================================
-- 006_sync_v15_customsql.sql — sync_table_mappings 增加 custom_sql 字段
-- 当用户在「新建表映射」选择「自定义 SQL」时，源数据来自 custom_sql（SELECT）
-- target_table 仍用于写入目标表；source_table 可为空
-- ============================================================

ALTER TABLE sync_table_mappings
  ADD COLUMN IF NOT EXISTS custom_sql TEXT;

COMMENT ON COLUMN sync_table_mappings.custom_sql IS
  '可选：自定义 SELECT 查询（与 source_table 二选一）。为空时使用 source_table 取数。';
