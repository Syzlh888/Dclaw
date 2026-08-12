-- ============================================================
-- 011_api_service.sql — 对外数据接口（API 服务）
--
-- 新增三张表：
--   1. api_endpoints  接口定义（SQL 或表自动生成）
--   2. api_tokens     独立 API Token（与登录 JWT 分离），支持跨接口授权
--   3. api_call_logs  调用审计日志（接口/Token/IP/状态/耗时）
-- ============================================================

-- ------------------------------------------------------------
-- 1. api_endpoints
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_endpoints (
  id             VARCHAR(20)  PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,                -- 接口名称
  description    TEXT,                                 -- 接口说明
  type           VARCHAR(16) NOT NULL DEFAULT 'sql',    -- 'sql' | 'table'
  connection_id  VARCHAR(20)  NOT NULL,                -- 关联数据库连接
  schema_name    VARCHAR(128),                         -- schema（表接口用）
  table_name     VARCHAR(128),                         -- 目标表（表接口用）
  sql_text       TEXT,                                 -- SQL（sql 接口用，含 :param 占位符）
  params_json    TEXT,                                 -- 参数定义 [{name,type,required,label}]
  page_size_max  INTEGER     NOT NULL DEFAULT 100,     -- 单页最大条数
  mask_fields    TEXT,                                 -- 脱敏字段列表（JSON 数组）
  status         VARCHAR(16) NOT NULL DEFAULT 'active', -- active | disabled
  created_by     VARCHAR(64),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ
);

COMMENT ON TABLE api_endpoints IS 'API 服务：发布的对外接口定义';
COMMENT ON COLUMN api_endpoints.type IS 'sql 预定义 SQL | table 表自动生成 REST';
COMMENT ON COLUMN api_endpoints.params_json IS '参数定义 JSON，元素形如 {name,type,required,label}';
COMMENT ON COLUMN api_endpoints.mask_fields IS '脱敏字段 JSON 数组，例如 ["name","idcard","phone"]';

CREATE INDEX IF NOT EXISTS idx_api_endpoints_status
  ON api_endpoints(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_endpoints_connection
  ON api_endpoints(connection_id);

-- ------------------------------------------------------------
-- 2. api_tokens
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_tokens (
  id             VARCHAR(20)  PRIMARY KEY,
  scope          VARCHAR(16)  NOT NULL DEFAULT 'all',   -- all 全部接口 | select 指定接口
  endpoint_ids   TEXT,                                  -- scope='select' 时逗号分隔接口ID（空 = 全部）
  token          TEXT         NOT NULL UNIQUE,          -- SM4 加密存储（GM1: 前缀）
  name           VARCHAR(255),                          -- Token 名称
  ip_whitelist   TEXT,                                  -- 逗号分隔 IP / CIDR
  qps_limit      INTEGER      NOT NULL DEFAULT 10,      -- 每秒请求上限
  daily_limit    INTEGER      NOT NULL DEFAULT 1000,    -- 每日调用上限
  expires_at     TIMESTAMPTZ,                           -- 过期时间（NULL 永久）
  status         VARCHAR(16)  NOT NULL DEFAULT 'active',-- active | disabled
  created_by     VARCHAR(64),
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_used_at   TIMESTAMPTZ
);

COMMENT ON TABLE api_tokens IS 'API 服务：独立 API Token（与登录 JWT 分离，GM1 SM4 加密存储）';
COMMENT ON COLUMN api_tokens.scope IS 'all 全部接口 | select 指定接口';
COMMENT ON COLUMN api_tokens.endpoint_ids IS 'scope=select 时指定接口的 ID，逗号分隔；空=全部';
COMMENT ON COLUMN api_tokens.token IS 'Token 密文（SM4 CBC + SM3 MAC），明文只返回一次';

CREATE INDEX IF NOT EXISTS idx_api_tokens_status
  ON api_tokens(status, created_at DESC);

-- ------------------------------------------------------------
-- 3. api_call_logs
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_call_logs (
  id             BIGSERIAL    PRIMARY KEY,
  endpoint_id    VARCHAR(20)  NOT NULL,
  token_id       VARCHAR(20),
  ip             VARCHAR(64),
  params_hash    VARCHAR(64),                           -- SM3(params)，用于审计追踪，不存明文
  status_code    INTEGER     NOT NULL DEFAULT 0,        -- 0 成功 / 401 鉴权失败 / 403 白名单拒绝 / 429 限流 / 500 错误
  error_msg      TEXT,
  duration_ms    INTEGER,
  called_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE api_call_logs IS 'API 服务：对外调用审计日志';

CREATE INDEX IF NOT EXISTS idx_api_logs_endpoint
  ON api_call_logs(endpoint_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_token
  ON api_call_logs(token_id, called_at DESC);
CREATE INDEX IF NOT EXISTS idx_api_logs_called_at
  ON api_call_logs(called_at DESC);