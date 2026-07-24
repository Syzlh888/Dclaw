# JSON → PostgreSQL 数据迁移指南 (D4)

本文档说明如何把 `data/*.json` 里的现有数据一次性搬到 PostgreSQL。适用于 v1.4 首次上 PG 时。

---

## 1. 前置检查

在开始迁移之前，请确认：

1. **PG 已启动** — `docker-compose up -d postgres` 或者本地 PG 已跑，能用 `psql` 连上；
2. **表结构已创建** — 已经跑过 `npm run db:migrate` (D2 交付的 33 张表)；
3. **`.env` 或 `.encryption-key` 已就位** — `server/db/config-loader.mjs` 能加载到 host/port/user/password/database；
4. **备份仍在** — 至少你要做过一次 `npm run backup:json`。

自检:

```bash
# 表数量应为 33
docker exec <pg-container> psql -U dclaw -d dclaw -c "\dt" | wc -l

# 或用 node
node -e "import('./server/db/pool.mjs').then(async ({pingDb, closePool}) => { await pingDb(); await closePool(); })"
```

---

## 2. 备份现有 JSON (必做)

```bash
npm run backup:json
```

会生成 `data.snapshots/pre-pg-migration-YYYYMMDD-HHMMSS.tgz`。

> ⚠️ 不要跳过。用户的 30+ 项目/连接/服务器数据一旦丢就麻烦。

---

## 3. 干跑验证

```bash
npm run db:import:dry
```

干跑会：

- 读所有 `data/*.json`；
- 检查目标表存在与否；
- 模拟按行 INSERT (但在事务内回滚, 不落库)；
- 输出每张表将会写入的行数。

如果干跑报错（`❌ 解析失败` / `❌ 表不存在` / `❌ 插入失败`），先解决问题，别急着实跑。

---

## 4. 实际迁移

```bash
npm run db:import
```

行为：

- 单事务写入 33 张表；
- 默认**只导入空表**，非空表跳过 (避免误覆盖你手工造的测试数据)；
- 幂等: 用 `ON CONFLICT (id) DO NOTHING`，重复执行不会产生重复行；
- JSONB 字段自动 `JSON.stringify`；
- 目标表若含 `extra` 列，JSON 里的未知字段会汇总进 `extra`（不会静默丢）。

如果你确认要覆盖/合并非空表：

```bash
npm run db:import:force
```

---

## 5. 验证

抽样 SELECT COUNT，对比 JSON 里的行数：

```bash
# 连接到 PG
docker exec -it <pg-container> psql -U dclaw -d dclaw

-- SQL 侧
SELECT COUNT(*) FROM projects;
SELECT COUNT(*) FROM servers;
SELECT COUNT(*) FROM connections;
SELECT id, name FROM projects LIMIT 5;
```

Shell 侧对拍：

```bash
jq 'length' data/projects.json
jq 'length' data/servers.json
```

两侧行数一致 = OK。

也可以看看 JSONB 字段有没有被正确塞进去：

```sql
SELECT id, jsonb_pretty(extra) FROM projects WHERE extra IS NOT NULL LIMIT 3;
```

---

## 6. 回滚方案

如果发现数据有问题，**别慌**，回退步骤:

```bash
# 1. 停容器
docker-compose down

# 2. 删 volume (清空 PG 数据)
docker volume rm db-unify_pgdata   # 名字以实际 volume 为准, 用 docker volume ls 查

# 3. 恢复 JSON (如果你还没删原始 data/, 其实什么都不用做)
tar -xzf data.snapshots/pre-pg-migration-YYYYMMDD-HHMMSS.tgz

# 4. 重启到 JSON 模式 (回退到迁移前的应用版本)
git checkout <pre-migration-tag>
npm run dev
```

> 提示: `data/*.json` 在迁移后**不要删**。至少保留到线上稳定跑一周再考虑归档。

---

## 7. 常见错误处理

| 错误信息 | 原因 | 解决 |
|---|---|---|
| `❌ 表不存在或不可访问` | 没跑 `db:migrate` | 先 `npm run db:migrate` |
| `duplicate key value violates unique constraint` | 表非空，但你没用 `--force`；或有硬冲突字段 | 检查 conflict 字段；或清空后再跑 |
| `invalid input syntax for type timestamp` | JSON 里的时间字符串格式非 ISO | 通常 pg driver 能吃；若失败, 手工修 JSON |
| `column "xxx" does not vote exist` | JSON 里的字段与表列名不一致 | 目标表若有 `extra` 列会自动兜住；否则被丢弃 |
| `password authentication failed` | `.env` 里 DB 密码错 | 核对 `DB_PASSWORD` |
| 干跑 OK, 实跑事务卡住 | 大表插入慢 | 稍等；日志会输出每行的进度 |

---

## 8. 集合 → 表映射

| JSON 文件 | PG 表 | 备注 |
|---|---|---|
| platforms.json | platforms | 平台字典 |
| predb_types.json | predb_types | 预置库类型 |
| districts.json | districts | 区县字典 |
| hospitals.json | hospitals | 医院 |
| connections.json | connections | 数据库连接 (含加密密码) |
| drivers.json | drivers | JDBC/驱动 |
| execution_history.json | execution_history | 执行历史 |
| execution_tasks.json | execution_tasks | 执行任务 |
| sql_templates.json | sql_templates | SQL 模板 |
| sql_scripts.json | sql_scripts | SQL 脚本 |
| projects.json | projects | 项目 |
| engineerings.json | engineerings | 工程 |
| applications.json | applications | 应用 |
| servers.json | servers | 服务器 |
| servers_db_instances.json | servers_db_instances | DB 实例 |
| servers_app_instances.json | servers_app_instances | 应用实例 |
| servers_mid_instances.json | servers_mid_instances | 中间件实例 |
| servers_api_instances.json | servers_api_instances | API 实例 |
| servers_ports.json | servers_ports | 端口 |
| access_entries.json | access_entries | 访问记录 |
| password_history.json | password_history | 密码历史 |
| system_config.json | system_config | 系统配置 |
| query_templates.json | query_templates | 查询模板 |
| users.json | users | 用户 |
| roles.json | roles | 角色 |
| role_permissions.json | role_permissions | 角色权限 |
| user_roles.json | user_roles | 用户角色 |
| resource_grants.json | resource_grants | 资源授权 |
| temporary_grants.json | temporary_grants | 临时授权 |
| sql_approval_requests.json | sql_approval_requests | SQL 审批 |
| sql_approver_config.json | sql_approver_config | 审批人配置 |
| audit_logs.json | audit_logs | 审计日志 |
| auth_sessions.json | auth_sessions | 认证会话 |

顺序按依赖：字典 → 业务 → 权限 → 审计。

---

## 9. 迁移后清单

- [ ] `npm run db:import` 成功, `stats.errors == 0`
- [ ] 抽样 3-5 张主要表 COUNT 匹配
- [ ] `SELECT extra` 抽查, 未知字段落到 extra 而非丢失
- [ ] `data.snapshots/*.tgz` 已生成并妥善保存
- [ ] `data/*.json` **保留** (仅备份, 不再作为数据源)
- [ ] `CHANGELOG.md` 记录本次迁移时间和结果
