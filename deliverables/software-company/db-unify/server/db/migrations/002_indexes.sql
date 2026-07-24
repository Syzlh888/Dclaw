-- ============================================================
-- 常用索引 (v1.4.0-alpha.1)
-- 全部使用 CREATE INDEX IF NOT EXISTS
-- ============================================================

-- 用户/角色/权限
CREATE INDEX IF NOT EXISTS idx_user_roles_user     ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role     ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_pair     ON user_roles(user_id, role_id);
CREATE INDEX IF NOT EXISTS idx_role_perms_role     ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_perms_pair     ON role_permissions(role_id, permission_code);

-- 资源级授权
CREATE INDEX IF NOT EXISTS idx_res_grants_subject  ON resource_grants(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_res_grants_resource ON resource_grants(resource_type, resource_id);

-- 临时授权
CREATE INDEX IF NOT EXISTS idx_temp_grants_user    ON temporary_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_temp_grants_expires ON temporary_grants(expires_at);

-- 审计
CREATE INDEX IF NOT EXISTS idx_audit_created       ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_created  ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action        ON audit_logs(action);

-- 会话
CREATE INDEX IF NOT EXISTS idx_sessions_user       ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires    ON auth_sessions(expires_at);

-- 服务器归属
CREATE INDEX IF NOT EXISTS idx_servers_project     ON servers(project_id);
CREATE INDEX IF NOT EXISTS idx_servers_engineering ON servers(engineering_id);
CREATE INDEX IF NOT EXISTS idx_servers_application ON servers(application_id);

-- 项目树
CREATE INDEX IF NOT EXISTS idx_engineerings_project ON engineerings(project_id);
CREATE INDEX IF NOT EXISTS idx_applications_engineering ON applications(engineering_id);

-- 服务器附属实例
CREATE INDEX IF NOT EXISTS idx_srv_db_server        ON servers_db_instances(server_id);
CREATE INDEX IF NOT EXISTS idx_srv_app_server       ON servers_app_instances(server_id);
CREATE INDEX IF NOT EXISTS idx_srv_mid_server       ON servers_mid_instances(server_id);
CREATE INDEX IF NOT EXISTS idx_srv_api_server       ON servers_api_instances(server_id);
CREATE INDEX IF NOT EXISTS idx_srv_ports_server     ON servers_ports(server_id);

-- 卫健域树
CREATE INDEX IF NOT EXISTS idx_predb_platform       ON predb_types(platform_id);
CREATE INDEX IF NOT EXISTS idx_districts_predb      ON districts(predb_type_id);
CREATE INDEX IF NOT EXISTS idx_hospitals_district   ON hospitals(district_id);
CREATE INDEX IF NOT EXISTS idx_hospitals_connection ON hospitals(connection_id);

-- 执行历史
CREATE INDEX IF NOT EXISTS idx_exec_history_time    ON execution_history(executed_at DESC);

-- 密码历史
CREATE INDEX IF NOT EXISTS idx_pwd_hist_server      ON password_history(server_id);
CREATE INDEX IF NOT EXISTS idx_pwd_hist_time        ON password_history(changed_at DESC);

-- 审批
CREATE INDEX IF NOT EXISTS idx_sql_appr_status      ON sql_approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_sql_appr_requester   ON sql_approval_requests(requester_id);
CREATE INDEX IF NOT EXISTS idx_sql_appr_created     ON sql_approval_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sql_apprvcfg_conn    ON sql_approver_config(connection_id);
