# DClaw Docker 部署指南

> 版本：v1.4.0-alpha.1 · 适用于纯 Web + PostgreSQL 16 + 国密加密的生产/信创部署形态。

本文覆盖 DClaw 数据钳（db-unify）的 Docker Compose 部署路径。桌面 Electron 形态在 1.3.x 系列，1.4 起主推 Web + 容器化。

---

## 一、环境准备

### 1.1 主机

- 操作系统：Linux（推荐 UOS/Kylin/CentOS 7+/Ubuntu 22.04+）或 Windows Server + WSL2
- CPU：2 核 起（4 核 推荐）
- 内存：4 GB 起（8 GB 推荐，PG 缓冲池 + Node 进程）
- 磁盘：50 GB 起，`/var/lib/docker/volumes` 所在分区建议 SSD
- 网络：容器 web 端口 3001 需对外可达；PG 端口 5432 **仅** 绑定 127.0.0.1

### 1.2 软件

- Docker Engine ≥ 24.0（信创环境可用 UOS 官方源 `dnf install docker-ce`）
- Docker Compose 插件 ≥ 2.20（`docker compose version` 可验证）
- 若使用国密合规审计：需在宿主机开启系统时间同步（chronyd/ntpd）

---

## 二、首次部署

### 2.1 拉取代码

```bash
git clone <repo-url> dclaw
cd dclaw
```

### 2.2 生成密钥

三把密钥需分别生成，任意一把泄露 = 敏感数据泄露风险，务必存入企业密钥管理平台（HashiCorp Vault / 国密 KMS）。

```bash
# GM_MASTER_KEY: 32 hex 字符（16 字节 SM4 主密钥）
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"

# GM_JWT_SECRET / GM_PWD_PEPPER: 各 64 hex 字符
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2.3 编写 .env

```bash
cp .env.example .env
# 编辑 .env，填入上一步的密钥；POSTGRES_PASSWORD 也设置为强密码
vi .env
```

### 2.4 加密 PG 连接配置

DClaw **禁止** 将明文的 PG 密码写入配置文件；`config/db.enc` 是国密加密后的 JSON。

```bash
# 加载 .env 让 GM_MASTER_KEY 可见
export $(grep -v '^#' .env | xargs)

# 交互式填写（host 用容器服务名 postgres）
npm run encrypt:db
# 完成后可验证
npm run decrypt:db
```

> 非交互脚本化方案（用于 CI）：
> ```bash
> printf 'postgres\n5432\ndclaw\n<pg-password>\ndclaw\nn\n' | node scripts/encrypt-db-config.mjs
> ```

### 2.5 启动服务

```bash
# 后台启动 PG + web
docker compose up -d

# 查看日志
docker compose logs -f web
```

首次启动 PG 会用 `POSTGRES_PASSWORD` 初始化 dclaw 库；后续启动数据卷 `dclaw-pg-data` 已存在，此变量被 postgres 官方镜像忽略。

### 2.6 健康检查

```bash
curl http://localhost:3001/api/health
docker compose ps       # 状态应为 (healthy)
docker compose exec postgres pg_isready -U dclaw
```

浏览器访问 `http://<host>:3001` 完成初始管理员登录。

---

## 三、升级步骤

```bash
# 1. 拉取新代码
git pull

# 2. 备份数据（见第四节）

# 3. 重建镜像 + 滚动重启（PG 不重建，仅 web）
docker compose build web
docker compose up -d --no-deps web

# 4. 查看新版本启动情况
docker compose logs -f web | head -50
```

若涉及数据库结构变更，先运行迁移：`docker compose exec web npm run db:migrate`。

---

## 四、备份与恢复

### 4.1 备份

```bash
# 逻辑备份（推荐）
docker compose exec -T postgres pg_dump -U dclaw -Fc dclaw > backups/dclaw-$(date +%Y%m%d-%H%M).dump

# 加密配置 + 密钥同时归档（放到 KMS/离线介质）
tar czf backups/keys-$(date +%Y%m%d).tgz .env config/db.enc
```

### 4.2 恢复

```bash
# 停 web，防止写入
docker compose stop web

# 用 pg_restore 恢复
cat backups/dclaw-<ts>.dump | docker compose exec -T postgres pg_restore -U dclaw -d dclaw --clean --if-exists

docker compose start web
```

---

## 五、密钥轮换

**核心约束**：`GM_MASTER_KEY` 用于对 `config/db.enc` 与业务表内敏感字段（密码/凭据）加密。轮换 = 用新密钥重加密全部密文，任何一步失败都会导致数据不可读。

### 5.1 只轮换 db.enc（PG 密码轮换）

```bash
# 1. 停 web
docker compose stop web

# 2. 用新 GM_MASTER_KEY 重新加密 db.enc
export GM_MASTER_KEY=<new-key>
npm run encrypt:db

# 3. 更新 .env 的 GM_MASTER_KEY 与 POSTGRES_PASSWORD
# 4. 若 PG 用户密码也变化，需在 PG 内改
docker compose exec postgres psql -U dclaw -c "ALTER USER dclaw WITH PASSWORD '<new-pg-password>';"

# 5. 启动
docker compose up -d
```

### 5.2 整体轮换（含表内密文）

计划在 T2 数据迁移任务中提供 `scripts/rotate-gm-key.mjs`。当前阶段（1.4.0-alpha.1）业务侧还未使用 PG 表，仅需按 5.1 处理。

---

## 六、故障排查

| 现象 | 排查步骤 |
| --- | --- |
| `web` 启动即退出，日志报 `GM_MASTER_KEY 环境变量未设置` | 检查 `.env` 中是否配置且 `docker compose` 是否加载了它（`docker compose config` 打印展开后的 env） |
| `解密失败：密钥不匹配或密文损坏` | 说明当前 `GM_MASTER_KEY` 与加密 `db.enc` 时使用的密钥不同；从 KMS 找回原始密钥，或用原密钥解密后再重加密 |
| `ECONNREFUSED postgres:5432` | `docker compose ps` 检查 postgres 是否 healthy；若 unhealthy 看 `docker compose logs postgres`，通常是 `POSTGRES_PASSWORD` 与旧卷冲突 |
| `password authentication failed for user "dclaw"` | 加密的 db.enc 中密码与 PG 实际密码不一致。先 `npm run decrypt:db` 核对，再选择：(a) 重新 encrypt:db 匹配 PG，或 (b) 在 PG 内 ALTER USER 匹配 db.enc |
| 端口 3001 不通 | 主机防火墙；`docker compose port web 3001` 查看映射；nginx/云安全组放行 |
| PG 数据看似"消失" | 检查是否 `docker compose down -v`（`-v` 会删数据卷）；正确停机用 `down` 或 `stop` |
| 时区不对 | Dockerfile 已设置 Asia/Shanghai；如需其他时区改 Dockerfile + rebuild |

### 日志

- web 应用日志：`docker compose logs web` 或容器内 `/app/logs/`
- PG 日志：`docker compose logs postgres`
- 结构化审计：登录 DClaw → 审计模块

### 常用调试命令

```bash
# 进容器
docker compose exec web sh
docker compose exec postgres psql -U dclaw

# 校验加密配置能被容器内解密
docker compose exec web node scripts/decrypt-db-config.mjs

# 查看 web 环境变量（脱敏后）
docker compose exec web env | grep -E 'GM_|DB_|NODE_ENV'
```

---

## 七、安全清单（上线前必查）

- [ ] `.env` 已从版本控制排除 (`.gitignore` 已包含)
- [ ] `config/db.enc` 已从版本控制排除
- [ ] `GM_MASTER_KEY` 已备份到 KMS 或加密介质
- [ ] PG 端口未暴露到公网（`docker compose port postgres 5432` 应返回 `127.0.0.1:...`）
- [ ] 反向代理（nginx/traefik）已强制 HTTPS 且 HSTS 开启
- [ ] 备份任务已配置到 cron（每日全量 + 每周异地）
- [ ] 首次启动完成后已删除默认管理员的初始密码提示

---

如需帮助，参见 `README.md` 与 `docs/gm-compliance.md`。
