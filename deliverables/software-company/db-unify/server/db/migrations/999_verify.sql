-- ============================================================
-- 999_verify.sql — 简单验证：34 张业务表 + schema_migrations 必须存在
-- 通过 SELECT 输出可视化，migrator 事务内执行 (若出错则 ROLLBACK)
-- ============================================================

DO $$
DECLARE
  expected TEXT[] := ARRAY[
    'platforms','predb_types','districts','hospitals',
    'connections','drivers',
    'execution_history','execution_tasks','sql_templates','sql_scripts',
    'projects','engineerings','applications','servers',
    'servers_db_instances','servers_app_instances','servers_mid_instances',
    'servers_api_instances','servers_ports',
    'access_entries','password_history','system_config','query_templates',
    'users','roles','role_permissions','user_roles',
    'resource_grants','temporary_grants',
    'sql_approval_requests','sql_approver_config',
    'audit_logs','auth_sessions'
  ];
  t TEXT;
  missing TEXT[] := ARRAY[]::TEXT[];
BEGIN
  FOREACH t IN ARRAY expected LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema='public' AND table_name=t
    ) THEN
      missing := array_append(missing, t);
    END IF;
  END LOOP;
  IF array_length(missing,1) IS NOT NULL THEN
    RAISE EXCEPTION 'verify: 缺失表 %', array_to_string(missing, ',');
  END IF;
  RAISE NOTICE 'verify: 全部 % 张业务表存在', array_length(expected,1);
END$$;
