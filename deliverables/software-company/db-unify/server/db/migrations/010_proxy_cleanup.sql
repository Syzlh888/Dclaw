-- ============================================================
-- 010_proxy_cleanup.sql — 代理网关增强（健康检查 + 危险SQL规则）
--
-- 本次新增：
--   1. proxy_connections 增加健康检查相关列
--      last_health_check_at  最近一次健康检查时间
--      health_status         ok | fail | unknown  状态
--      last_error            最近一次失败的错误信息
--   2. proxy_danger_rules   危险SQL规则表（可配置）
--      id / keyword / risk_level / action / enabled / sort_order / description
--      初值默认插入一组常见危险关键词（与旧 classifySql 兼容）
--   3. proxy_audit_logs 增加索引：proxy_connection_id + status，便于统计拦截数
-- ============================================================

-- ------------------------------------------------------------
-- 1. proxy_connections 健康检查字段
-- ------------------------------------------------------------
ALTER TABLE proxy_connections
  ADD COLUMN IF NOT EXISTS last_health_check_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS health_status        VARCHAR(16) NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS last_error           TEXT;

COMMENT ON COLUMN proxy_connections.last_health_check_at IS
  '最近一次 TCP 连通性检查时间（默认 60s 一次，由 server/proxy/index.mjs 周期探测）';
COMMENT ON COLUMN proxy_connections.health_status IS
  '健康状态：unknown=从未检查 / ok=可连 / fail=不可连';
COMMENT ON COLUMN proxy_connections.last_error IS
  '最近一次健康检查/同步失败的错误信息（仅供诊断，不暴露给外部用户）';

CREATE INDEX IF NOT EXISTS idx_proxy_conn_health
  ON proxy_connections(health_status, last_health_check_at DESC);

-- ------------------------------------------------------------
-- 2. proxy_danger_rules 危险SQL规则
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proxy_danger_rules (
  id            VARCHAR(20)  PRIMARY KEY,
  keyword       VARCHAR(64)  NOT NULL,                      -- 匹配关键字（不区分大小写、按整词匹配）
  risk_level    VARCHAR(8)   NOT NULL DEFAULT 'high',       -- low | medium | high
  action        VARCHAR(16)  NOT NULL DEFAULT 'block',      -- block=拦截 / warn=仅警告
  enabled       BOOLEAN      NOT NULL DEFAULT TRUE,
  sort_order    INTEGER      NOT NULL DEFAULT 0,            -- 显示顺序，越小越前
  description   VARCHAR(255),                                -- 备注（说明该规则的适用原因）
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ
);

COMMENT ON TABLE proxy_danger_rules IS '代理危险SQL规则表（audit_mode=intercept 时生效）';
COMMENT ON COLUMN proxy_danger_rules.keyword IS
  '匹配关键字（去除注释后 SQL 的首词/语句前缀，不区分大小写、按整词匹配）';
COMMENT ON COLUMN proxy_danger_rules.risk_level IS '命中时的风险等级：low|medium|high';
COMMENT ON COLUMN proxy_danger_rules.action IS
  '命中时的动作：block=拦截 / warn=仅记录日志';
COMMENT ON COLUMN proxy_danger_rules.enabled IS '是否启用';
COMMENT ON COLUMN proxy_danger_rules.sort_order IS '展示顺序';
COMMENT ON COLUMN proxy_danger_rules.description IS '规则说明';

CREATE UNIQUE INDEX IF NOT EXISTS idx_proxy_danger_rules_keyword
  ON proxy_danger_rules(LOWER(keyword));
CREATE INDEX IF NOT EXISTS idx_proxy_danger_rules_enabled
  ON proxy_danger_rules(enabled, sort_order);

-- 初始化一组常见危险SQL规则（与原 audit.mjs 内置规则保持兼容）
INSERT INTO proxy_danger_rules (id, keyword, risk_level, action, enabled, sort_order, description) VALUES
  ('pdr_drop',      'DROP',      'high',   'block', TRUE,  10, '删除数据库对象'),
  ('pdr_truncate',  'TRUNCATE',  'high',   'block', TRUE,  20, '清空表'),
  ('pdr_alter',     'ALTER',     'high',   'block', TRUE,  30, '修改表结构'),
  ('pdr_grant',     'GRANT',     'high',   'block', TRUE,  40, '授予权限'),
  ('pdr_revoke',    'REVOKE',    'high',   'block', TRUE,  50, '撤销权限'),
  ('pdr_rename',    'RENAME',    'high',   'block', TRUE,  60, '重命名对象'),
  ('pdr_update_no', 'UPDATE',    'medium', 'warn',  FALSE, 70, 'UPDATE 无 WHERE 时风险中等（默认仅警告，由 SQL 是否带 WHERE 决定）'),
  ('pdr_delete_no', 'DELETE',    'high',   'block', FALSE, 80, 'DELETE 无 WHERE 时风险高（默认仅启用拦截，由 SQL 是否带 WHERE 决定）')
ON CONFLICT (LOWER(keyword)) DO NOTHING;

-- ------------------------------------------------------------
-- 3. proxy_audit_logs 统计索引
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_proxy_audit_status
  ON proxy_audit_logs(proxy_connection_id, status, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_audit_executed
  ON proxy_audit_logs(executed_at DESC);