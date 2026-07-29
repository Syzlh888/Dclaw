-- DClaw v1.3 临时导出历史（运行时也会幂等创建，migration 用于正式部署）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS export_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(100) NOT NULL,
  source_conn VARCHAR(100) NOT NULL,
  source_table VARCHAR(200),
  source_sql TEXT,
  target_type VARCHAR(20) NOT NULL,
  target_format VARCHAR(20),
  target_path TEXT,
  target_conn VARCHAR(100),
  target_table VARCHAR(200),
  total_rows INTEGER,
  file_size BIGINT,
  duration_ms INTEGER,
  status VARCHAR(20),
  errors JSONB DEFAULT '[]',
  ip VARCHAR(45),
  timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_export_history_user_id ON export_history(user_id);
CREATE INDEX IF NOT EXISTS idx_export_history_timestamp ON export_history(timestamp DESC);
