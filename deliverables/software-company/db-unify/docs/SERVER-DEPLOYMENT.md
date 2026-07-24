# DClaw 服务器部署完整指南

> 版本: v1.4.0-alpha.1
> 作者: 孙佑政 (浪潮 / 北方健康)
> 更新日期: 2026-07-23
> 目标: 一份**一人可独立执行完成**的生产级服务器部署手册

---

## 前言

**适用人群**
- 中级运维工程师
- 全栈开发者
- 项目经理 / 技术交付负责人

**运行环境要求**
- 现代 Linux 服务器 (Ubuntu / CentOS / 麒麟 / UOS)
- 具备 sudo 或 root 权限
- 服务器可访问互联网 (信创内网可镜像方式部署)

**预期完成时间**
- 熟练运维: **30 ~ 45 分钟**
- 初次部署: **1.5 ~ 2 小时** (含调试)

**涉及技术栈**
- Docker 20.10+ / Docker Compose v2
- PostgreSQL 16
- Node.js 20 (容器内已预置)
- SM4 国密加密 (sm-crypto)
- Nginx (可选,反向代理 + HTTPS)

**约定**
- 命令中形如 `<xxxxx>` 表示需替换为实际值
- 命令块中的 `#` 为注释,直接复制粘贴也可执行
- 所有相对路径均以项目根目录 `/opt/dclaw/db-unify` 为基准

---

## 第 1 部分 · 服务器选型与硬件推荐

### 1.1 硬件推荐

| 环境类型 | vCPU | 内存 | 磁盘 | 带宽 | 备注 |
|----------|------|------|------|------|------|
| 开发/测试 | 2 | 4 GB | 40 GB SSD | 1 Mbps | 单人使用 |
| 小型生产 | 4 | 8 GB | 100 GB SSD | 5 Mbps | ≤ 20 并发用户 |
| 中大型生产 | 8 | 16 GB | 200 GB SSD | 10 Mbps | ≤ 200 并发用户 |
| 大型/集群 | 16+ | 32 GB+ | 500 GB SSD | 30 Mbps+ | 建议 PG 独立部署 |

> ⚠️ 磁盘请务必使用 **SSD** — PostgreSQL 对随机 IO 敏感,机械盘性能会掉一个数量级。

### 1.2 支持的操作系统

| 操作系统 | 状态 | 说明 |
|----------|------|------|
| **Ubuntu 22.04 LTS** | ✅ 强烈推荐 | 官方文档基于此系统 |
| Ubuntu 20.04 LTS | ✅ 支持 | Docker 需 20.10+ |
| CentOS 7.9 | ⚠️ 兼容 | Docker 需手动升级到 20.10+ |
| Rocky / Alma Linux 8/9 | ✅ 支持 | CentOS 替代 |
| **麒麟 v10 (Kylin)** | ✅ 信创兼容 | Docker 从信创物料源安装 |
| **统信 UOS (V20)** | ✅ 信创兼容 | 同上 |
| Windows Server 2019+ | ⚠️ 仅小型 | 需 Docker Desktop,不推荐生产 |

### 1.3 网络端口规划

| 端口 | 协议 | 用途 | 是否外网开放 |
|------|------|------|--------------|
| 22 | TCP | SSH 运维 | 建议限白名单 |
| 8080 | TCP | HTTP (Nginx,可选) | ✅ 开放 (跳转 HTTPS) |
| 8443 | TCP | HTTPS (Nginx,生产必备) | ✅ 开放 |
| 3001 | TCP | Web 容器 (内网直连或反代后端) | ⚠️ 反代后可关闭 |
| 5433 | TCP | PostgreSQL 宿主映射 | ❌ 仅 127.0.0.1 |

> 🔒 `docker-compose.yml` 已将 PG 绑定到 `127.0.0.1:5433`,外部无法访问,请勿更改。
>
> 🏥 **医院内网默认使用 8080/8443**：多数医院内网关闭了 22/80/443 以外的端口，
> 但也常常反过来禁用 80/443 而放行 8000–9000 段。请**在申请端口前先与医院信息科确认 8080/8443 是否放行**，
> 若仍不通再走 IT 变更申请（本项目 `docker-compose.yml` 已将 web 容器暴露到宿主 8080，
> Nginx 站点模板监听 8080/8443）。

---

## 第 2 部分 · 环境准备

### 2.1 安装 Docker (Ubuntu 22.04 / 20.04)

```bash
# ① 卸载旧版本(可选,新机跳过)
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# ② 一键安装 Docker (阿里云镜像,速度快)
curl -fsSL https://get.docker.com | sudo sh -s -- --mirror Aliyun

# ③ 验证安装
docker --version           # 应看到: Docker version 24.x.x 或更高
docker compose version     # 应看到: Docker Compose version v2.x.x

# ④ 启动服务并设为开机自启
sudo systemctl start docker
sudo systemctl enable docker

# ⑤ 当前用户加入 docker 组,避免每次 sudo
sudo usermod -aG docker $USER
newgrp docker   # 或退出重新登录
```

**预期输出**
```
Docker version 24.0.7, build afdd53b
Docker Compose version v2.23.3
```

### 2.2 CentOS 7 / Rocky / Alma 安装

```bash
# ① 卸载旧版
sudo yum remove -y docker docker-common docker-selinux docker-engine 2>/dev/null || true

# ② 安装依赖 + 添加阿里云 docker-ce repo
sudo yum install -y yum-utils device-mapper-persistent-data lvm2
sudo yum-config-manager --add-repo \
  https://mirrors.aliyun.com/docker-ce/linux/centos/docker-ce.repo

# ③ 安装最新 Docker + Compose 插件
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# ④ 启动
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER
newgrp docker

# ⑤ 验证
docker --version
docker compose version
```

### 2.3 麒麟 v10 / 统信 UOS (信创环境)

信创环境通常无法直连互联网,请从**内部物料源**下载 rpm 包。

```bash
# ① 从内部 yum 源或物料包安装 Docker
sudo dnf install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
#   或使用离线 rpm:
sudo dnf install -y ./docker-ce-*.rpm ./containerd.io-*.rpm ./docker-compose-plugin-*.rpm

# ② 启动
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -aG docker $USER

# ③ 若 SELinux 干扰容器,请设为 permissive (临时)
sudo setenforce 0
# 永久: 编辑 /etc/selinux/config, SELINUX=permissive
```

> 📌 **信创兼容性**: `sm-crypto` 是纯 JS 实现,支持 x86_64 / arm64 / mips64el 全部架构。PostgreSQL 16 官方 alpine 镜像亦支持 arm64。若目标机为龙芯 (mips64el),需自行构建 postgres:16 镜像 (或采用 openEuler 官方仓库版本)。

### 2.4 配置 Docker 国内镜像加速

**国内环境**必须配置,否则镜像拉取速度极慢。

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<'EOF'
{
  "registry-mirrors": [
    "https://docker.mirrors.ustc.edu.cn",
    "https://mirror.baidubce.com",
    "https://hub-mirror.c.163.com"
  ],
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "3"
  }
}
EOF

sudo systemctl restart docker

# 验证
docker info | grep -A 3 "Registry Mirrors"
```

**预期输出**
```
Registry Mirrors:
  https://docker.mirrors.ustc.edu.cn/
  https://mirror.baidubce.com/
  https://hub-mirror.c.163.com/
```

### 2.5 防火墙 & 系统调优

```bash
# 开放必要端口 (Ubuntu ufw)
sudo ufw allow 22/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 8443/tcp
sudo ufw enable

# CentOS firewalld
sudo firewall-cmd --permanent --add-port=22/tcp
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --permanent --add-port=8443/tcp
sudo firewall-cmd --reload

# 增大文件句柄数(PG 高并发建议)
echo '* soft nofile 65536' | sudo tee -a /etc/security/limits.conf
echo '* hard nofile 65536' | sudo tee -a /etc/security/limits.conf
```

---

## 第 3 部分 · 代码发布

### 3.1 上传项目代码

**方式 A: 打包上传 (推荐,项目暂未开源)**

```bash
# 在开发机 (Windows 使用 git-bash)
tar --exclude='node_modules' \
    --exclude='.git' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='data.snapshots' \
    --exclude='logs' \
    -czf dclaw-1.4.0-alpha.1.tar.gz \
    -C 'D:/Work Space/DClaw/deliverables/software-company' db-unify

# 上传到服务器
scp dclaw-1.4.0-alpha.1.tar.gz root@<服务器IP>:/tmp/
```

**方式 B: git clone (内部 GitLab)**

```bash
ssh root@<服务器IP>
sudo mkdir -p /opt/dclaw && sudo chown $USER:$USER /opt/dclaw
cd /opt/dclaw
git clone git@gitlab.inspur.com:dclaw/db-unify.git
```

### 3.2 服务器端解压

```bash
sudo mkdir -p /opt/dclaw
sudo chown -R $USER:$USER /opt/dclaw
cd /opt/dclaw
tar -xzf /tmp/dclaw-1.4.0-alpha.1.tar.gz
cd db-unify

# 应看到项目结构
ls -la
# 预期: docker-compose.yml  Dockerfile  package.json  server/  src/  scripts/  ...
```

### 3.3 (可选) 安装本地 Node 20

只有想在**宿主机**上运行 CLI 工具 (如 `npm run encrypt:db`) 时才需要。
容器内已包含完整 Node 20 环境,可跳过本节。

```bash
# 使用 tj/n 安装管理器
curl -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n | sudo bash -s lts

# 配置 npm 国内镜像
npm config set registry https://registry.npmmirror.com

# 项目根目录安装依赖(仅在需要本地跑脚本时)
cd /opt/dclaw/db-unify
npm install --omit=dev
```

---

## 第 4 部分 · 🔐 密钥初始化 (核心)

**⚠️ 本步骤是整个部署的核心。密钥一旦生成必须妥善保管,丢失后已加密数据无法恢复。**

### 4.1 生成 4 个密钥

```bash
cd /opt/dclaw/db-unify

# ① GM_MASTER_KEY — 国密 SM4 主密钥(严格 32 hex 字符 = 16 字节)
echo "GM_MASTER_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")"

# ② GM_JWT_SECRET — JWT 签名密钥
echo "GM_JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# ③ GM_PWD_PEPPER — 密码 pepper (与 bcrypt 结合)
echo "GM_PWD_PEPPER=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"

# ④ POSTGRES_PASSWORD — PG 强密码
echo "POSTGRES_PASSWORD=$(node -e "console.log(require('crypto').randomBytes(20).toString('base64').replace(/[+/=]/g,'x'))")"
```

**若服务器没有 Node**,改用 openssl:

```bash
echo "GM_MASTER_KEY=$(openssl rand -hex 16)"
echo "GM_JWT_SECRET=$(openssl rand -hex 32)"
echo "GM_PWD_PEPPER=$(openssl rand -hex 32)"
echo "POSTGRES_PASSWORD=$(openssl rand -base64 20 | tr -d '+/=' )"
```

### 4.2 🔒 密钥保管强制要求

**请立即将 4 个密钥保存到以下位置之一**:

- 🥇 企业密码管理系统 (1Password / Bitwarden / 腾讯 iOA / 华为云 KMS)
- 🥈 硬件密码本 / 加密 U 盘 (离线)
- 🥉 双人红信封 (纸质签字保管,合规审计推荐)

> 🚨 **绝对禁止**:
> - 明文粘贴到微信 / 邮件 / 钉钉
> - 提交到 Git (即使私有仓库)
> - 写在 Excel / Wiki 中不加密
> - 只保存一份 (至少异地二备份)

### 4.3 创建 .env 文件

```bash
cd /opt/dclaw/db-unify

cat > .env <<EOF
# ==========================================================
# DClaw 生产环境变量 — 严禁提交 Git
# ==========================================================
POSTGRES_PASSWORD=<上面第 ④ 步生成的 PG 密码>
GM_MASTER_KEY=<上面第 ① 步生成的 32-hex 主密钥>
GM_JWT_SECRET=<上面第 ② 步生成的 jwt secret>
GM_PWD_PEPPER=<上面第 ③ 步生成的 pepper>
EOF

# 严格权限
chmod 600 .env
ls -la .env
# 预期: -rw------- 1 user user ...  .env
```

**验证**

```bash
# 加载并检查
set -a; source .env; set +a
echo "MASTER_KEY 长度: ${#GM_MASTER_KEY}"
# 预期: 32
```

---

## 第 5 部分 · 启动 PostgreSQL 容器

```bash
cd /opt/dclaw/db-unify

# 拉起 postgres (首次会下载 postgres:16-alpine ~ 240 MB)
docker compose up -d postgres

# 观察容器状态,等到 healthy
docker compose ps
```

**预期输出** (等 10~30 秒)

```
NAME             IMAGE                COMMAND         STATUS                    PORTS
dclaw-postgres   postgres:16-alpine   "docker-en..."  Up 15 seconds (healthy)   127.0.0.1:5433->5432/tcp
```

**看启动日志**

```bash
docker compose logs postgres | tail -20
# 应看到: database system is ready to accept connections
```

### 常见问题

| 现象 | 排查 | 修复 |
|------|------|------|
| healthy 不了 | `docker compose logs postgres` | 检查 volume 权限 / 端口占用 |
| 5433 端口被占 | `sudo lsof -i:5433` | 修改 docker-compose.yml 端口映射 |
| 内存不足直接 OOM | `dmesg \| tail` | 加 swap 或换更大机器 |

---

## 第 6 部分 · 加密 PG 连接配置

**⚠️ 连接配置必须加密存入 `config/db.enc`,不得明文保存。**

### 6.1 交互式加密 (推荐)

```bash
cd /opt/dclaw/db-unify
set -a; source .env; set +a    # 导入环境变量到当前 shell

# 若无本地 Node,通过容器跑脚本
docker run --rm -it \
  -v $(pwd):/app -w /app \
  -e GM_MASTER_KEY=$GM_MASTER_KEY \
  node:20-alpine node scripts/encrypt-db-config.mjs

# 若已有本地 Node
npm run encrypt:db
```

**交互填写** (⚠️ 关键: 容器内部网!)

```
? host:      postgres          ← 容器内部 DNS 名,不是 localhost
? port:      5432              ← 容器内部端口,不是 5433
? user:      dclaw
? password:  <即 POSTGRES_PASSWORD 的值>
? database:  dclaw
? ssl:       n
```

### 6.2 验证加密文件

```bash
ls -la config/db.enc
# 预期: -rw-r--r-- 1 user user 200~400 bytes

head -c 40 config/db.enc; echo
# 预期看到 "GM1:" 开头的密文,例如: GM1:v1:xxxxx...
```

**严格权限**

```bash
chmod 600 config/db.enc
```

### 6.3 反向验证 (可选,确认能解密)

```bash
GM_MASTER_KEY=$GM_MASTER_KEY npm run decrypt:db
# 预期打印出 host/port/user/database 等原文
```

---

## 第 7 部分 · 初始化数据库结构

### 方法 A · 由 web 容器自动 migrate (**推荐**)

Web 容器首次启动会自动执行 `initDatabase()` → `migrator.mjs`,建表并写入种子数据。
**跳过本节,直接进入第 8 或第 9 部分。**

### 方法 B · 手工控制 (需本地 Node)

```bash
cd /opt/dclaw/db-unify
set -a; source .env; set +a

DB_HOST=localhost \
DB_PORT=5433 \
DB_USER=dclaw \
DB_PASSWORD=$POSTGRES_PASSWORD \
DB_NAME=dclaw \
  npm run db:migrate
```

**预期输出**

```
[migrate] 已应用 3 个迁移
[migrate] ✅ 完成
```

**验证表结构**

```bash
docker exec -it dclaw-postgres psql -U dclaw -d dclaw -c "\dt"
# 预期: 34 张表 (33 业务表 + schema_migrations)
```

---

## 第 8 部分 · (可选) 历史数据导入

**部署默认以空库启动**。web 容器启动时自动初始化:
- 用户 `admin` / 密码 `admin123` (**首要任务: 立即修密!**)
- 4 个预置角色 (admin / editor / executor / viewer)
- 64 个权限点
- 34 张空表 (由 migration 建立)

如果需要把旧环境的历史数据（项目 / 服务器 / 连接等）带过来，
**推荐采用 pg_dump 备份还原方式**（`npm run db:import` 仅保留作为“首次从旧 JSON 版本迁移”的兜底途径，
新部署不再走这条路径）。

### 8.1 在旧环境导出备份

```bash
cd /opt/dclaw/db-unify   # 或开发机项目根目录

# 方法 A: 使用项目内置脚本 (推荐)
npm run backup:pg
# 生成 backups/dclaw-YYYYMMDD_HHMMSS.sql.gz

# 方法 B: 手工
docker exec dclaw-postgres pg_dump -U dclaw -d dclaw --clean --if-exists > dclaw-backup.sql
gzip dclaw-backup.sql
```

### 8.2 上传到新服务器

```bash
scp backups/dclaw-*.sql.gz root@<新服务器IP>:/opt/dclaw/db-unify/backups/
```

### 8.3 在新服务器还原

前置条件: `docker compose up -d postgres` 已就绪、`npm run db:migrate` 已执行（结构已创建）。

```bash
cd /opt/dclaw/db-unify

# 方法 A: 使用项目内置脚本 (会交互确认)
npm run restore:pg backups/dclaw-YYYYMMDD_HHMMSS.sql.gz

# 方法 B: 手工
gunzip -c backups/dclaw-*.sql.gz | docker exec -i dclaw-postgres psql -U dclaw -d dclaw
```

脚本使用 `pg_dump --clean --if-exists` 生成的备份，会先 `DROP ... IF EXISTS` 再重建，
可安全地在**已初始化过结构的空库**上重复还原。

### 8.4 验证还原结果

```bash
docker exec dclaw-postgres psql -U dclaw -d dclaw -c "SELECT COUNT(*) FROM projects"
docker exec dclaw-postgres psql -U dclaw -d dclaw -c "SELECT COUNT(*) FROM servers"
docker exec dclaw-postgres psql -U dclaw -d dclaw -c "SELECT COUNT(*) FROM connections"
```

### 8.5 (兜底/不推荐) 从旧 JSON 数据首次迁移

仅当你**没有任何 pg_dump 备份**、只有旧的 `data/*.json` 时，才走 `db:import`：

```bash
cd /opt/dclaw/db-unify
set -a; source .env; set +a

# 干跑预览 (不写入)
DB_HOST=localhost DB_PORT=5433 DB_USER=dclaw \
DB_PASSWORD=$POSTGRES_PASSWORD DB_NAME=dclaw \
  npm run db:import:dry

# 正式导入
DB_HOST=localhost DB_PORT=5433 DB_USER=dclaw \
DB_PASSWORD=$POSTGRES_PASSWORD DB_NAME=dclaw \
  npm run db:import
```

导入完成后**立即** `npm run backup:pg` 生成 pg_dump 基线，后续跨环境搬迁一律走 8.1–8.3。

---

## 第 9 部分 · 启动 Web 容器

### 9.1 (可选) 修改暴露端口

默认容器暴露到宿主 **8080**（映射到容器内 3001）。若医院内网也放行 80/443，可改回:

```yaml
    ports:
      - '80:3001'   # 直接 80,不建议;生产建议前置 Nginx
```

**推荐保持 8080,通过 Nginx 反向代理监听 8080/8443**。

### 9.2 构建镜像 + 启动

```bash
cd /opt/dclaw/db-unify

# 构建 (首次 ~ 5-15 分钟,取决于网络)
docker compose build web

# 启动 web (postgres 会自动依赖启动)
docker compose up -d web

# 观察状态
docker compose ps
```

**预期状态**

```
NAME             IMAGE          STATUS                    PORTS
dclaw-postgres   postgres:16-.. Up 5 min (healthy)        127.0.0.1:5433->5432/tcp
dclaw-web        db-unify-web   Up 30 seconds (healthy)   0.0.0.0:8080->3001/tcp
```

### 9.3 观察启动日志

```bash
docker compose logs -f web
```

**应看到关键行**

```
[db-config] ✅ 国密 SM4 解密成功
[pg] ✅ 数据库连接成功
[migrate] 已应用 X 个迁移,完成
[Auth] initAuthDefaults 完成 (admin / 4 roles)
Server listening on port 3001
```

按 `Ctrl+C` 退出日志跟随 (不会停止容器)。

### 9.4 健康验证

```bash
# 后端健康检查
curl -sS http://localhost:3001/api/health
# 预期: {"status":"ok","version":"1.4.0-alpha.1",...}

# 登录测试
curl -sS -X POST http://localhost:3001/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}'
# 预期: {"token":"eyJ...","user":{...},"permissions":[...]}
```

### 9.5 浏览器访问

```
# 内网直连 web 容器（无 Nginx 时）
http://<服务器 IP>:8080

# 前置 Nginx + HTTPS 后（推荐）
https://dclaw.example.com:8443
```

用 `admin` / `admin123` 登录,**首要任务: 立即修改密码!**

---

## 第 10 部分 · 🌐 反向代理 + HTTPS (生产必备)

### 10.1 安装 Nginx

```bash
# Ubuntu
sudo apt install -y nginx
# CentOS/信创
sudo dnf install -y nginx

sudo systemctl enable --now nginx
```

### 10.2 创建站点配置

```bash
sudo tee /etc/nginx/conf.d/dclaw.conf >/dev/null <<'EOF'
# HTTP (8080) → HTTPS (8443) 强制跳转
server {
    listen 8080;
    server_name dclaw.example.com;
    return 301 https://$host:8443$request_uri;
}

# HTTPS 主站 (8443)
server {
    listen 8443 ssl http2;
    server_name dclaw.example.com;

    ssl_certificate     /etc/nginx/ssl/dclaw.crt;
    ssl_certificate_key /etc/nginx/ssl/dclaw.key;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         'ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305';
    ssl_prefer_server_ciphers on;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    add_header Strict-Transport-Security "max-age=63072000" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    client_max_body_size 100M;   # 允许上传大 Excel/JSON

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;

        # WebSocket 支持 (未来功能)
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";

        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
EOF

sudo nginx -t && sudo systemctl reload nginx
```

### 10.3 配置 HTTPS 证书

> ⚠️ 因端口调整为 **8080/8443**（80/443 已不再对外开放），
> **certbot 的 standalone/http-01 challenge 会失败**（Let's Encrypt 只从公网 80 回访验证）。
> 生产建议优先走内部 CA / 自签 / 商业证书；
> 若必须用 Let's Encrypt，请改用 **DNS-01 challenge**（见方式 C）。

**方式 A · 企业 / 内网 / 信创环境 (推荐)**

从企业内部 CA 申请证书,或使用商业证书 (阿里云 SSL / 数安时代 / 沃通)、
或医院/单位内部 PKI 签发的证书:

```bash
sudo mkdir -p /etc/nginx/ssl
sudo cp dclaw.crt /etc/nginx/ssl/dclaw.crt
sudo cp dclaw.key /etc/nginx/ssl/dclaw.key
sudo chmod 600 /etc/nginx/ssl/dclaw.key
sudo nginx -s reload
```

**方式 B · 自签证书 (仅内网测试, 浏览器会告警)**

```bash
sudo mkdir -p /etc/nginx/ssl
sudo openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout /etc/nginx/ssl/dclaw.key \
  -out    /etc/nginx/ssl/dclaw.crt \
  -subj "/CN=dclaw.example.com"
sudo chmod 600 /etc/nginx/ssl/dclaw.key
sudo nginx -s reload
```

**方式 C · Let's Encrypt (仅公网 + 域名, 需 DNS-01)**

因 80 端口不开放,不能用 `certbot --nginx` 或 standalone。必须用 DNS 供应商插件 (阿里云/腾讯云/Cloudflare 等):

```bash
sudo apt install -y certbot python3-certbot-dns-cloudflare  # 或其它 DNS 插件
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /root/.cf.ini \
  -d dclaw.example.com
# 证书路径: /etc/letsencrypt/live/dclaw.example.com/{fullchain,privkey}.pem
sudo certbot renew --dry-run
```
颁发后把 nginx.conf 中的 `ssl_certificate` / `ssl_certificate_key` 指向 letsencrypt 路径即可。

### 10.4 关闭 3001 对外访问

在 `docker-compose.yml` 将 3001 端口限制到本机:

```yaml
    ports:
      - '127.0.0.1:3001:3001'
```

然后 `docker compose up -d web` 重启。

---

## 第 11 部分 · 备份与恢复

### 11.1 自动备份脚本

```bash
sudo mkdir -p /opt/dclaw/backups
sudo chown $USER:$USER /opt/dclaw/backups

cat > /opt/dclaw/db-unify/scripts/backup.sh <<'EOF'
#!/bin/bash
# DClaw 每日自动备份脚本
set -euo pipefail

BACKUP_DIR=/opt/dclaw/backups
TS=$(date +%Y%m%d_%H%M%S)
DUMP_FILE=$BACKUP_DIR/dclaw-$TS.sql

mkdir -p $BACKUP_DIR

echo "[$(date)] 开始备份..."
docker exec dclaw-postgres pg_dump -U dclaw -d dclaw --clean --if-exists > $DUMP_FILE

gzip $DUMP_FILE
echo "[$(date)] 备份完成: $DUMP_FILE.gz ($(du -h $DUMP_FILE.gz | cut -f1))"

# 保留 30 天
find $BACKUP_DIR -name 'dclaw-*.sql.gz' -mtime +30 -delete

# 同步 config/db.enc 一起备份 (无 master key 无用,可放心)
cp /opt/dclaw/db-unify/config/db.enc $BACKUP_DIR/db-$TS.enc.bak

# (可选) rsync 到异地 NAS
# rsync -a $BACKUP_DIR/ backup@nas.example.com:/backups/dclaw/
EOF

chmod +x /opt/dclaw/db-unify/scripts/backup.sh
```

### 11.2 配置 cron 定时任务

```bash
sudo tee /etc/cron.d/dclaw-backup <<'EOF'
# 每日凌晨 2 点自动备份
0 2 * * * root /opt/dclaw/db-unify/scripts/backup.sh >> /var/log/dclaw-backup.log 2>&1
EOF
```

**测试**

```bash
sudo /opt/dclaw/db-unify/scripts/backup.sh
ls -la /opt/dclaw/backups/
```

### 11.3 手动恢复

**优雅恢复 (无数据丢失)**

```bash
BACKUP=/opt/dclaw/backups/dclaw-20260723_020000.sql.gz
gunzip -c $BACKUP | docker exec -i dclaw-postgres psql -U dclaw -d dclaw
```

**灾难恢复 (从零)**

```bash
cd /opt/dclaw/db-unify
docker compose down                     # 停止服务
docker volume rm dclaw-pg-data          # 删除 PG volume
docker compose up -d postgres           # 重建空库
sleep 15                                # 等 PG 就绪
gunzip -c /opt/dclaw/backups/dclaw-XXXX.sql.gz \
  | docker exec -i dclaw-postgres psql -U dclaw -d dclaw
docker compose up -d web
```

---

## 第 12 部分 · 日常运维

### 12.1 启停/重启

```bash
cd /opt/dclaw/db-unify

# 单独重启 web (不影响 PG)
docker compose restart web

# 停止/启动
docker compose stop web
docker compose start web

# 全部停止
docker compose down

# 全部启动
docker compose up -d
```

### 12.2 查看日志

```bash
# 实时跟随
docker compose logs -f web
docker compose logs -f postgres

# 最近 100 行
docker compose logs --tail 100 web

# 带时间戳
docker compose logs -t --since 1h web
```

### 12.3 进入容器 (调试)

```bash
# web 容器 shell
docker compose exec web sh

# 直接连 PG
docker compose exec postgres psql -U dclaw -d dclaw
```

### 12.4 简单健康监控 (cron)

```bash
sudo tee /etc/cron.d/dclaw-health <<'EOF'
*/5 * * * * root curl -sf -m 5 http://localhost:3001/api/health >/dev/null 2>&1 \
  || echo "[$(date)] DClaw 健康检查失败" >> /var/log/dclaw-alert.log
EOF
```

生产环境建议接入 Prometheus / Zabbix / 云监控告警。

---

## 第 13 部分 · 升级流程

**标准升级步骤 (无停机)**

```bash
cd /opt/dclaw/db-unify

# ① 备份数据 (强制!)
./scripts/backup.sh

# ② 更新代码
# 方式 A: git
git fetch --all && git checkout v1.4.0-beta.1

# 方式 B: 覆盖式解压
tar -xzf /tmp/dclaw-new.tar.gz --strip-components=1 -C /opt/dclaw/db-unify

# ③ 重新构建 web 镜像 (postgres 无变化不需要)
docker compose build web

# ④ 滚动升级 (Compose 会先启新再停旧)
docker compose up -d web

# ⑤ 验证
sleep 10
curl -sS http://localhost:3001/api/health
docker compose logs --tail 50 web
```

**回滚**

```bash
docker compose down web
git checkout <旧版本 tag>          # 或恢复旧 tar 包
docker compose build web
docker compose up -d web
```

---

## 第 14 部分 · 🔑 密钥轮换

**建议每 12 个月轮换一次主密钥**。

```bash
cd /opt/dclaw/db-unify

# ① 备份原始加密文件
cp config/db.enc config/db.enc.bak.$(date +%Y%m%d)

# ② 用旧密钥导出明文连接
OLD_KEY=$GM_MASTER_KEY
GM_MASTER_KEY=$OLD_KEY npm run decrypt:db > /tmp/db-plain.txt
cat /tmp/db-plain.txt   # 记下 host/port/user/pwd/database

# ③ 生成新主密钥
NEW_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")
echo "新主密钥: $NEW_KEY  ← 立即保存到密码管理器!"

# ④ 用新密钥重新加密
GM_MASTER_KEY=$NEW_KEY npm run encrypt:db
# (按提示输入 ② 步记下的连接信息)

# ⑤ 更新 .env
sed -i.bak "s|^GM_MASTER_KEY=.*|GM_MASTER_KEY=$NEW_KEY|" .env

# ⑥ 重启 web
docker compose down web && docker compose up -d web

# ⑦ 验证
docker compose logs web | grep '国密' | tail -5
# 预期看到: [db-config] ✅ 国密 SM4 解密成功

# ⑧ 确认成功后销毁临时文件
shred -u /tmp/db-plain.txt
```

> 🚨 若 GM_JWT_SECRET / GM_PWD_PEPPER 需要轮换,会导致**所有存量用户登录 token 失效** (jwt) 或**必须重设所有用户密码** (pepper)。请谨慎评估。

---

## 第 15 部分 · 🚨 故障排查

### 15.1 web 容器 crash loop (启动即退出)

- **现象**: `docker compose ps` 显示 `Restarting`
- **定位**: `docker compose logs --tail 50 web`
- **常见原因**:
  - `.env` 缺失或密钥格式错 → 检查 `GM_MASTER_KEY` 长度是否 32
  - `config/db.enc` 不存在 → 回到第 6 部分重加密
  - postgres 未就绪 → 先 `docker compose up -d postgres` 等 healthy

### 15.2 "GM_MASTER_KEY 环境变量未设置"

```bash
# 检查
docker compose exec web env | grep GM_MASTER_KEY
# 若为空 → .env 未生效,确保 .env 与 docker-compose.yml 同目录
```

### 15.3 "国密 SM4 解密失败"

- **原因**: `.env` 中 `GM_MASTER_KEY` 与生成 `config/db.enc` 时用的**不一致**
- **修复**:
  1. 恢复正确的原始 master key
  2. 若已丢失,只能删除 `config/db.enc` 后**重新加密** (需知道 PG 密码)

### 15.4 "connection refused localhost:5432"

- **原因**: web 内部指向了错误主机
- **修复**: 加密时 host 应填 **`postgres`** (容器名),端口 **5432** (容器内部)

### 15.5 前端登录报 500

```bash
docker compose logs --tail 100 web | grep -E 'error|Error'
# 通常是 pepper 缺失或数据库表未初始化
```

### 15.6 迁移报 "district_id NULL"

- **原因**: 003 迁移未跑到旧数据
- **修复**: 手工重跑 migrator: `npm run db:migrate`

### 15.7 build web 卡在 npm install

- **原因**: npm 镜像未生效
- **修复**: 检查网络,Dockerfile 内已配置 `npmmirror.com`;必要时重启 Docker

### 15.8 3001 端口不通

```bash
sudo ss -tlnp | grep 3001         # 应看到 docker-proxy
sudo iptables -L DOCKER-USER      # 无阻塞
# 云主机需检查安全组是否放通
```

### 15.9 "password authentication failed for user dclaw"

- **原因**: `.env` 里的 `POSTGRES_PASSWORD` 改了,但 PG volume 里保存的还是旧密码
- **修复** (⚠️ 会删数据,先备份):
  ```bash
  ./scripts/backup.sh
  docker compose down -v          # -v 删 volume
  docker compose up -d postgres
  # 再走一遍第 6/7 部分
  ```

### 15.10 中文乱码

- 检查 PG encoding: `docker exec dclaw-postgres psql -U dclaw -d dclaw -c "SHOW SERVER_ENCODING;"` → 应为 `UTF8`
- 检查 Nginx: `charset utf-8;`
- 浏览器 F12 → Response Headers 是否有 `Content-Type: ...; charset=utf-8`

### 15.11 磁盘打满

```bash
df -h                              # 定位分区
docker system df                   # docker 用量
docker system prune -a --volumes   # ⚠️ 谨慎,会删无用镜像/volume
```

### 15.12 内存持续增长

- Node 服务端默认 `--max-old-space-size=` 未设 → 大导入时 OOM
- 修改 `docker-compose.yml`,在 web 服务下:
  ```yaml
      environment:
        NODE_OPTIONS: "--max-old-space-size=2048"
  ```

---

## 第 16 部分 · ✅ 上线前检查清单

打印本清单,逐项打勾:

- [ ] 已与医院/机房信息科**书面确认 8080/8443 已放行**（部分医院仅开 8000-9000 段，个别环境甚至 8080 也需申请）
- [ ] `admin` 默认密码 `admin123` 已修改为强密码
- [ ] `.env` 权限已 chmod 600,备份到密码管理器
- [ ] `config/db.enc` 权限已 chmod 600,已异地备份 (与主密钥分开)
- [ ] `scripts/backup.sh` 已加 cron,并**手工验证过恢复流程**
- [ ] Nginx 已部署,HTTPS 证书 SSL Labs 评级 A/A+
- [ ] `docker-compose.yml` 中 PG 端口限制 `127.0.0.1:5433`
- [ ] `docker-compose.yml` 中 web 端口已限 `127.0.0.1:3001` (若前置 Nginx)
- [ ] 服务器防火墙仅开 22/8080/8443,SSH 密码登录已关闭 (仅密钥)
- [ ] `/api/health` 5 分钟监控告警已接入
- [ ] Runbook / 应急预案已发给运维值班
- [ ] 日志滚动策略已配置 (`/etc/docker/daemon.json` log-opts)
- [ ] 数据卷 `dclaw-pg-data` 所在磁盘剩余 > 60%
- [ ] 已进行一次完整功能冒烟测试 (登录 / CRUD / 导出 / 权限切换)

---

## 附录 A · 完整 .env 模板

```env
# ==========================================================
# DClaw v1.4.0-alpha.1 Docker 部署环境变量
# 复制为 .env, chmod 600, 严禁提交 Git
# ==========================================================

# PostgreSQL 初始化密码 (强密码, 首次启动时写入)
POSTGRES_PASSWORD=change-me-strong-password

# 国密 SM4 主密钥 (32 hex 字符 = 16 字节)
# 生成: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
GM_MASTER_KEY=00112233445566778899aabbccddeeff

# JWT 签名密钥
# 生成: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
GM_JWT_SECRET=<64-hex-chars>

# 密码 pepper
# 生成: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
GM_PWD_PEPPER=<64-hex-chars>

# 可选: CORS 允许来源
# CORS_ORIGIN=https://dclaw.example.com

# 可选: Node 内存上限
# NODE_OPTIONS=--max-old-space-size=2048
```

---

## 附录 B · 完整 nginx.conf 模板

见第 10.2 节。生产建议增加:

```nginx
# /etc/nginx/nginx.conf 顶层
worker_processes auto;
worker_rlimit_nofile 65536;

events {
    worker_connections 4096;
    multi_accept on;
    use epoll;
}

http {
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;

    gzip on;
    gzip_vary on;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml application/xml+rss text/javascript
               image/svg+xml;

    limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;

    include /etc/nginx/conf.d/*.conf;
}
```

---

## 附录 C · 信创兼容性备注

| 组件 | 麒麟 v10 | UOS V20 | 龙芯 (mips64el) | 鲲鹏 (arm64) |
|------|----------|---------|-----------------|--------------|
| Docker CE | ✅ 内部源 | ✅ 内部源 | ⚠️ 需龙芯定制版 | ✅ 官方 |
| postgres:16-alpine | ✅ | ✅ | ⚠️ 需自建 | ✅ |
| node:20-alpine | ✅ | ✅ | ⚠️ 用 node:20-buster | ✅ |
| sm-crypto (纯 JS) | ✅ | ✅ | ✅ | ✅ |

**离线环境部署要点**:

1. 在有网机器上 `docker save postgres:16-alpine node:20-alpine -o dclaw-images.tar`
2. 上传后 `docker load -i dclaw-images.tar`
3. 项目 `docker compose build web` 若拉包失败,可在有网机器构建后:
   `docker save db-unify-web:latest -o web.tar`,上传 load 之。

---

## 附录 D · 与浪潮 / 北方健康交付环境对接

### 医院内网部署

- 医院内网通常无出口,需**离线镜像 + 内部 npm 私服**
- HIS/LIS 系统对接建议部署到**独立 VLAN**,通过 API 网关白名单
- 数据同步方向: DClaw → 数据钳中间库 (只读拉取)

### 等保 2.0 / 3.0 合规要点

- ✅ **国密 SM4** 加密敏感字段 (本项目已实现)
- ✅ **审计日志**: 全量操作日志留存 ≥ 180 天
- ✅ **访问控制**: RBAC + 最小权限
- ✅ **传输加密**: HTTPS + TLS 1.2+
- ✅ **密钥管理**: 密钥与数据分离存储

### 信创验收

- 提供项目 SBOM 清单 (依赖组件版本表)
- 说明 `sm-crypto` 库的国密算法合规声明
- 提供**部署白皮书** (即本文档) + 运维 Runbook

### 端口开放申请模板

```
系统名称: DClaw 数据钳 v1.4.0
部署环境: 生产 (北方健康云 / 医院内网)
需开放端口:
  - 入方向 TCP 8443 ← 用户浏览器 (HTTPS)
  - 入方向 TCP 8080 ← 用户浏览器 (HTTP，跳转至 8443)
  - 入方向 TCP 22   ← 运维 (限白名单)
  - 出方向 TCP 443  ← 拉取 npm/docker 镜像 (仅部署阶段)
说明:
  - 医院内网通常关闭 80/443，本系统改用 8080/8443 承载 HTTP/HTTPS
  - 若医院禁用 8080/8443 段，可与 IT 协商改为 8000-8999 内其它端口，同步修改
    docker-compose.yml 的宿主端口与 Nginx listen 指令即可
业务负责人: 孙佑政
联系方式: <邮箱/电话>
预计上线: <日期>
```

---

## 结语

至此,一台 DClaw 生产服务器的部署已经完成 🎉

- 数据备份是**生存底线**,请务必验证过一次完整恢复流程
- 主密钥丢失 = 加密数据永久丢失,请三份异地备份
- 遇到任何本文档未覆盖的问题,请提交到内部 issue 系统或联系作者

**祝部署顺利!**

—— 孙佑政 · 浪潮 / 北方健康 · 2026-07-23
