-- ============================================================
-- 008_proxy_gateway.sql — 数据库代理网关（阶段1：数据模型）
--
-- 场景：外部用户（医院工程师/第三方开发者）通过标准数据库客户端
--   (DBeaver/Navicat/psql) 访问真实业务库，但不暴露真实 IP/账号/密码，
--   支持时效控制、撤销、全量 SQL 审计、危险 SQL 拦截。
--
-- 设计要点（见 docs/db-proxy-gateway-design.md 3.1 / 3.2）：
--   proxy_connections  代理连接（对外临时授权：端口/账号/密码/审计策略/并发/IP白名单/有效期）
--   proxy_audit_logs   代理操作审计（每条 SQL 一条记录）
-- proxy_password 以国密 SM4 可逆加密（GM1: 前缀）存储，创建时明文仅返回一次
-- ============================================================

-- ---------- 3.1 代理连接 ----------
CREATE TABLE IF NOT EXISTS proxy_connections (
  id                 VARCHAR(32) PRIMARY KEY,
  name               VARCHAR(128) NOT NULL,          -- 对外名称
  db_type            VARCHAR(16)  NOT NULL DEFAULT 'postgresql', -- postgresql|mysql|highgo|dm|oracle|sqlserver
  real_connection_id VARCHAR(32)  NOT NULL,          -- 关联真实连接（内部，前端/外部不可见）
  proxy_port         INTEGER      UNIQUE NOT NULL,   -- 对外监听端口
  proxy_username     VARCHAR(64)  NOT NULL,          -- 对外临时账号
  proxy_password     VARCHAR(256) NOT NULL,          -- 对外临时密码（国密 SM4 可逆加密 GM1: 存储）
  audit_mode         VARCHAR(16)  NOT NULL DEFAULT 'record', -- record | intercept
  access_mode        VARCHAR(16)  NOT NULL DEFAULT 'writable', -- readonly | writable 只读/可写
  max_connections    INTEGER      NOT NULL DEFAULT 100,      -- 最大并发连接（上限100）
  allowed_ips        JSONB,                           -- 来源 IP 白名单（可选数组）
  proxy_port_base    INTEGER      DEFAULT 35000,      -- 端口段起始（可配置）
  expires_at         TIMESTAMPTZ  NOT NULL,           -- 到期时间
  status             VARCHAR(16)  NOT NULL DEFAULT 'active', -- active|expired|revoked
  allow_blind        BOOLEAN      NOT NULL DEFAULT FALSE,     -- 协议未逆向类型(dm/oracle/sqlserver)是否允许盲转发（自担风险）
  created_by         VARCHAR(64),
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at         TIMESTAMPTZ,
  last_connected_at  TIMESTAMPTZ
);

COMMENT ON TABLE proxy_connections IS '数据库代理连接（对外临时授权）';
COMMENT ON COLUMN proxy_connections.name IS '对外名称';
COMMENT ON COLUMN proxy_connections.db_type IS '数据库类型：postgresql|mysql|highgo|dm|oracle|sqlserver';
COMMENT ON COLUMN proxy_connections.real_connection_id IS '关联真实连接 id（内部，不对外暴露）';
COMMENT ON COLUMN proxy_connections.proxy_port IS '对外监听端口（段内唯一）';
COMMENT ON COLUMN proxy_connections.proxy_username IS '对外临时账号';
COMMENT ON COLUMN proxy_connections.proxy_password IS '对外临时密码（国密 SM4 可逆加密 GM1: 前缀）';
COMMENT ON COLUMN proxy_connections.audit_mode IS '审计模式：record=仅记录；intercept=记录并拦截危险SQL';
COMMENT ON COLUMN proxy_connections.max_connections IS '单代理连接最大并发连接数（上限100）';
COMMENT ON COLUMN proxy_connections.allowed_ips IS '来源 IP 白名单（JSON 数组，可空=不限制）';
COMMENT ON COLUMN proxy_connections.proxy_port_base IS '端口段起始（默认35000）';
COMMENT ON COLUMN proxy_connections.expires_at IS '到期时间，到期自动失效';
COMMENT ON COLUMN proxy_connections.status IS '状态：active|expired|revoked';
COMMENT ON COLUMN proxy_connections.created_by IS '创建人';
COMMENT ON COLUMN proxy_connections.revoked_at IS '撤销时间';
COMMENT ON COLUMN proxy_connections.last_connected_at IS '最近一次成功连接时间';

-- ---------- 3.2 代理操作审计 ----------
CREATE TABLE IF NOT EXISTS proxy_audit_logs (
  id                  BIGSERIAL PRIMARY KEY,
  proxy_connection_id VARCHAR(32)  NOT NULL,
  proxy_username      VARCHAR(64),
  db_type             VARCHAR(16),
  real_connection_id  VARCHAR(32),
  client_ip           INET,                          -- 来源 IP
  session_start       TIMESTAMPTZ,
  session_end         TIMESTAMPTZ,
  sql_text            TEXT,                          -- 执行的 SQL
  sql_type            VARCHAR(16),                   -- SELECT|INSERT|UPDATE|DELETE|DDL|OTHER
  affected_rows       INTEGER,
  status              VARCHAR(16),                   -- success|failed|blocked
  risk_level          VARCHAR(8),                    -- low|medium|high
  error_message       TEXT,
  executed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE proxy_audit_logs IS '数据库代理操作审计';
COMMENT ON COLUMN proxy_audit_logs.proxy_connection_id IS '代理连接 id';
COMMENT ON COLUMN proxy_audit_logs.client_ip IS '客户端来源 IP';
COMMENT ON COLUMN proxy_audit_logs.sql_text IS '执行的 SQL 文本';
COMMENT ON COLUMN proxy_audit_logs.sql_type IS 'SQL 类型：SELECT|INSERT|UPDATE|DELETE|DDL|OTHER';
COMMENT ON COLUMN proxy_audit_logs.status IS '执行状态：success|failed|blocked';
COMMENT ON COLUMN proxy_audit_logs.risk_level IS '风险等级：low|medium|high';
COMMENT ON COLUMN proxy_audit_logs.error_message IS '错误/拦截原因';

-- ---------- 索引 ----------
CREATE INDEX IF NOT EXISTS idx_proxy_audit_conn ON proxy_audit_logs(proxy_connection_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_proxy_audit_client ON proxy_audit_logs(client_ip);
