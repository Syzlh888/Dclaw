-- ============================================================
-- DClaw v1.4.0-alpha.1 初始 schema (34 张业务表)
-- 遵循原则:
--   1. 主键均为 nanoid(8~12) 字符串，统一 VARCHAR(20)
--   2. 时间字段统一 TIMESTAMPTZ
--   3. 加密字段 (password_encrypted / password / password_hash) 存 TEXT
--   4. 不使用外键，关联由应用层保证 (与 JSON 时代行为一致)
--   5. 不确定 / 松散字段用 JSONB extra
--   6. 所有 DDL 使用 IF NOT EXISTS，可幂等重放
-- ============================================================

-- ------------------------------------------------------------
-- 平台 / 前置库 / 区域 / 医院 (卫健域元数据)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS platforms (
  id           VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE platforms IS '业务平台 (如: 临沂市卫健委)';

CREATE TABLE IF NOT EXISTS predb_types (
  id           VARCHAR(20) PRIMARY KEY,
  platform_id  VARCHAR(20) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE predb_types IS '前置库类型 (如: 电子病历前置库/中心库)';

CREATE TABLE IF NOT EXISTS districts (
  id             VARCHAR(20) PRIMARY KEY,
  predb_type_id  VARCHAR(20) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,
  extra          JSONB
);
COMMENT ON TABLE districts IS '区域 (市直/县区)';

CREATE TABLE IF NOT EXISTS hospitals (
  id             VARCHAR(20) PRIMARY KEY,
  district_id    VARCHAR(20),
  name           VARCHAR(255) NOT NULL,
  connection_id  VARCHAR(20),
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,
  extra          JSONB
);
COMMENT ON TABLE hospitals IS '医院 (关联 connections)';

-- ------------------------------------------------------------
-- 数据库连接 / 驱动
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS connections (
  id                 VARCHAR(20) PRIMARY KEY,
  name               VARCHAR(255) NOT NULL,
  driver             VARCHAR(64),
  host               VARCHAR(255),
  port               INTEGER,
  username           VARCHAR(128),
  password_encrypted TEXT,
  database_name      VARCHAR(255),
  schema_name        VARCHAR(128),
  custom_driver_id   VARCHAR(64),
  status             VARCHAR(32) DEFAULT 'unknown',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ,
  extra              JSONB
);
COMMENT ON TABLE connections IS '数据库连接';
COMMENT ON COLUMN connections.password_encrypted IS '国密 SM4 加密';

CREATE TABLE IF NOT EXISTS drivers (
  id            VARCHAR(64) PRIMARY KEY,
  name          VARCHAR(128) NOT NULL,
  version       VARCHAR(64),
  driver_class  VARCHAR(255),
  file_name     VARCHAR(255),
  file_size     BIGINT,
  db_type       VARCHAR(64),
  is_builtin    BOOLEAN NOT NULL DEFAULT FALSE,
  description   TEXT,
  upload_time   TIMESTAMPTZ,
  extra         JSONB
);
COMMENT ON TABLE drivers IS 'JDBC 驱动';

-- ------------------------------------------------------------
-- 执行历史 / 任务 / SQL 模板 / SQL 脚本
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS execution_history (
  id                VARCHAR(20) PRIMARY KEY,
  sql_text          TEXT,
  connection_count  INTEGER NOT NULL DEFAULT 0,
  success_count     INTEGER NOT NULL DEFAULT 0,
  failed_count      INTEGER NOT NULL DEFAULT 0,
  timeout_count     INTEGER NOT NULL DEFAULT 0,
  duration_ms       BIGINT,
  read_only_mode    SMALLINT,
  config_json       JSONB,
  executed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ,
  extra             JSONB
);
COMMENT ON TABLE execution_history IS 'SQL 执行历史';

CREATE TABLE IF NOT EXISTS execution_tasks (
  id           VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(255),
  status       VARCHAR(32),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  data         JSONB,
  extra        JSONB
);
COMMENT ON TABLE execution_tasks IS '异步执行任务队列';

CREATE TABLE IF NOT EXISTS sql_templates (
  id           VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  sql_text     TEXT,
  category     VARCHAR(128),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE sql_templates IS 'SQL 模板库';

CREATE TABLE IF NOT EXISTS sql_scripts (
  id           VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  sql_text     TEXT,
  project_id   VARCHAR(20),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE sql_scripts IS 'SQL 脚本 (可复用的多语句脚本)';

-- ------------------------------------------------------------
-- 项目 / 工程 / 应用 / 服务器
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS projects (
  id           VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  short_name   VARCHAR(128),
  description  TEXT,
  status       VARCHAR(32),
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE projects IS '项目 (顶层业务单元)';

CREATE TABLE IF NOT EXISTS engineerings (
  id           VARCHAR(20) PRIMARY KEY,
  project_id   VARCHAR(20) NOT NULL,
  name         VARCHAR(255) NOT NULL,
  short_name   VARCHAR(128),
  description  TEXT,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE engineerings IS '工程 (项目下的子工程)';

CREATE TABLE IF NOT EXISTS applications (
  id              VARCHAR(20) PRIMARY KEY,
  engineering_id  VARCHAR(20) NOT NULL,
  name            VARCHAR(255) NOT NULL,
  short_name      VARCHAR(128),
  description     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  extra           JSONB
);
COMMENT ON TABLE applications IS '应用';

CREATE TABLE IF NOT EXISTS servers (
  id                          VARCHAR(20) PRIMARY KEY,
  project_id                  VARCHAR(20),
  engineering_id              VARCHAR(20),
  application_id              VARCHAR(20),
  name                        VARCHAR(255),
  ips                         TEXT,
  credentials                 TEXT,
  internal_ip                 VARCHAR(64),
  external_ip                 VARCHAR(64),
  public_ip                   VARCHAR(64),
  cross_network_ip            VARCHAR(64),
  os                          VARCHAR(128),
  cpu_cores                   INTEGER,
  memory_gb                   INTEGER,
  system_disk_gb              INTEGER,
  data_disk_gb                INTEGER,
  storage_type                VARCHAR(64),
  bandwidth_mbps              INTEGER,
  server_location             VARCHAR(128),
  server_type                 VARCHAR(64),
  username                    VARCHAR(128),
  password_encrypted          TEXT,
  bastion_host                VARCHAR(255),
  bastion_port                INTEGER,
  bastion_username            VARCHAR(128),
  bastion_password_encrypted  TEXT,
  vpn_info                    TEXT,
  mac_address                 VARCHAR(64),
  deployed_content            TEXT,
  tags                        TEXT,
  notes                       TEXT,
  access_list                 TEXT,
  linked_connection_ids       TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ,
  extra                       JSONB
);
COMMENT ON TABLE servers IS '服务器主表';

-- ------------------------------------------------------------
-- 服务器附属实例 (数据库/应用/中间件/API/端口)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS servers_db_instances (
  id                 VARCHAR(20) PRIMARY KEY,
  server_id          VARCHAR(20) NOT NULL,
  db_type            VARCHAR(64),
  version            VARCHAR(64),
  db_name            VARCHAR(255),
  schema_name        VARCHAR(128),
  username           VARCHAR(128),
  password_encrypted TEXT,
  credentials        TEXT,
  internal_ip        VARCHAR(64),
  external_ip        VARCHAR(64),
  port               INTEGER,
  notes              TEXT,
  is_cluster         SMALLINT,
  cluster_ips        TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ,
  extra              JSONB
);

CREATE TABLE IF NOT EXISTS servers_app_instances (
  id           VARCHAR(20) PRIMARY KEY,
  server_id    VARCHAR(20) NOT NULL,
  name         VARCHAR(255),
  version      VARCHAR(64),
  port         INTEGER,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);

CREATE TABLE IF NOT EXISTS servers_mid_instances (
  id           VARCHAR(20) PRIMARY KEY,
  server_id    VARCHAR(20) NOT NULL,
  mid_type     VARCHAR(64),
  name         VARCHAR(255),
  version      VARCHAR(64),
  port         INTEGER,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);

CREATE TABLE IF NOT EXISTS servers_api_instances (
  id           VARCHAR(20) PRIMARY KEY,
  server_id    VARCHAR(20) NOT NULL,
  name         VARCHAR(255),
  api_type     VARCHAR(64),
  endpoint     TEXT,
  port         INTEGER,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);

CREATE TABLE IF NOT EXISTS servers_ports (
  id            VARCHAR(20) PRIMARY KEY,
  server_id     VARCHAR(20) NOT NULL,
  port          INTEGER NOT NULL,
  protocol      VARCHAR(16),
  type          VARCHAR(64),
  service_name  VARCHAR(255),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ,
  extra         JSONB
);

-- ------------------------------------------------------------
-- 访问入口 / 密码历史 / 系统配置 / 查询模板
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS access_entries (
  id           VARCHAR(20) PRIMARY KEY,
  type         VARCHAR(64),
  address      TEXT,
  provider     VARCHAR(255),
  username     VARCHAR(255),
  password     TEXT,               -- 明文/占位 (历史遗留字段，见 credentials)
  credentials  TEXT,                -- JSON 字符串，含加密的多账号
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE access_entries IS '外部访问入口 (堡垒机/门户/VPN)';

CREATE TABLE IF NOT EXISTS password_history (
  id                 VARCHAR(20) PRIMARY KEY,
  server_id          VARCHAR(64) NOT NULL,
  field_name         VARCHAR(255) NOT NULL,
  password_encrypted TEXT,
  changed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by         VARCHAR(64),
  extra              JSONB
);
COMMENT ON TABLE password_history IS '密码变更审计 (加密快照)';

CREATE TABLE IF NOT EXISTS system_config (
  id                        VARCHAR(64) PRIMARY KEY,
  server_location_list      TEXT,
  os_list                   TEXT,
  secondary_password_hash   TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ,
  extra                     JSONB
);
COMMENT ON TABLE system_config IS '系统全局配置 (单例, id=default)';

CREATE TABLE IF NOT EXISTS query_templates (
  id           VARCHAR(20) PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  description  TEXT,
  sql_text     TEXT,
  category     VARCHAR(128),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);

-- ------------------------------------------------------------
-- 用户 / 角色 / 权限体系 (RBAC + 资源级授权)
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id                    VARCHAR(20) PRIMARY KEY,
  username              VARCHAR(64) UNIQUE NOT NULL,
  password_hash         TEXT NOT NULL,
  display_name          VARCHAR(128),
  email                 VARCHAR(128),
  phone                 VARCHAR(32),
  status                VARCHAR(16) NOT NULL DEFAULT 'active',
  last_login_at         TIMESTAMPTZ,
  last_login_ip         VARCHAR(64),
  password_updated_at   TIMESTAMPTZ,
  created_by            VARCHAR(20),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ,
  extra                 JSONB
);
COMMENT ON TABLE users IS '用户账号';
COMMENT ON COLUMN users.password_hash IS '国密 SM3 PBKDF hash，前缀 GMP1$ (或历史 bcrypt)';

CREATE TABLE IF NOT EXISTS roles (
  id           VARCHAR(20) PRIMARY KEY,
  code         VARCHAR(64) UNIQUE NOT NULL,
  name         VARCHAR(128) NOT NULL,
  description  TEXT,
  is_system    SMALLINT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE roles IS '角色 (admin/editor/executor/viewer 等)';

CREATE TABLE IF NOT EXISTS role_permissions (
  id               VARCHAR(20) PRIMARY KEY,
  role_id          VARCHAR(20) NOT NULL,
  permission_code  VARCHAR(128) NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extra            JSONB
);
COMMENT ON TABLE role_permissions IS '角色-权限点关联';

CREATE TABLE IF NOT EXISTS user_roles (
  id           VARCHAR(20) PRIMARY KEY,
  user_id      VARCHAR(20) NOT NULL,
  role_id      VARCHAR(20) NOT NULL,
  granted_by   VARCHAR(64),
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extra        JSONB
);
COMMENT ON TABLE user_roles IS '用户-角色关联';

CREATE TABLE IF NOT EXISTS resource_grants (
  id             VARCHAR(20) PRIMARY KEY,
  subject_type   VARCHAR(16) NOT NULL,      -- 'user' | 'role'
  subject_id     VARCHAR(20) NOT NULL,
  resource_type  VARCHAR(32) NOT NULL,      -- 'project'|'engineering'|'application'|'server'|'connection'
  resource_id    VARCHAR(20) NOT NULL,
  access_level   VARCHAR(16) NOT NULL,      -- 'read'|'write'|'admin'
  granted_by     VARCHAR(20),
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  notes          TEXT,
  extra          JSONB
);
COMMENT ON TABLE resource_grants IS '资源级授权 (user/role -> resource + access_level)';

CREATE TABLE IF NOT EXISTS temporary_grants (
  id             VARCHAR(20) PRIMARY KEY,
  user_id        VARCHAR(20) NOT NULL,
  resource_type  VARCHAR(32),              -- 'global' 表示全局临时授权
  resource_id    VARCHAR(20),
  permissions    TEXT NOT NULL,             -- JSON 数组字符串
  reason         TEXT,
  granted_by     VARCHAR(20),
  granted_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at     TIMESTAMPTZ NOT NULL,
  revoked_at     TIMESTAMPTZ,
  extra          JSONB
);
COMMENT ON TABLE temporary_grants IS '临时授权 (带过期时间)';

CREATE TABLE IF NOT EXISTS sql_approval_requests (
  id              VARCHAR(20) PRIMARY KEY,
  requester_id    VARCHAR(20) NOT NULL,
  connection_id   VARCHAR(20),
  sql_text        TEXT NOT NULL,
  reason          TEXT,
  status          VARCHAR(32) NOT NULL DEFAULT 'pending', -- pending|approved|rejected|expired
  approver_id     VARCHAR(20),
  approver_note   TEXT,
  approved_at     TIMESTAMPTZ,
  rejected_at     TIMESTAMPTZ,
  executed_at     TIMESTAMPTZ,
  execution_id    VARCHAR(20),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ,
  extra           JSONB
);
COMMENT ON TABLE sql_approval_requests IS '危险 SQL 审批请求';

CREATE TABLE IF NOT EXISTS sql_approver_config (
  id             VARCHAR(20) PRIMARY KEY,
  connection_id  VARCHAR(20),               -- 空表示全局
  approver_id    VARCHAR(20) NOT NULL,
  priority       INTEGER NOT NULL DEFAULT 0,
  enabled        SMALLINT NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ,
  extra          JSONB
);
COMMENT ON TABLE sql_approver_config IS 'SQL 审批人配置';

CREATE TABLE IF NOT EXISTS audit_logs (
  id            VARCHAR(20) PRIMARY KEY,
  user_id       VARCHAR(20),
  username      VARCHAR(64),
  action        VARCHAR(64) NOT NULL,
  resource_type VARCHAR(64),
  resource_id   VARCHAR(64),
  ip            VARCHAR(64),
  user_agent    TEXT,
  result        VARCHAR(16),               -- 'success' | 'failure'
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  extra         JSONB
);
COMMENT ON TABLE audit_logs IS '操作审计日志';

CREATE TABLE IF NOT EXISTS auth_sessions (
  id           VARCHAR(64) PRIMARY KEY,     -- session_id 可能较长
  user_id      VARCHAR(20) NOT NULL,
  ip           VARCHAR(64),
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  extra        JSONB
);
COMMENT ON TABLE auth_sessions IS '登录会话 (JWT sid 索引)';
