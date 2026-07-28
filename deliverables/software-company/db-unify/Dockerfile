# ============================================
# DClaw Docker 部署（多阶段构建）
# v1.4.0-alpha.1: 纯 Web + PG16 + 国密加密
# ============================================

# ---- 阶段 1：构建 ----
FROM node:20-alpine AS builder

WORKDIR /app

# 构建依赖（node-gyp / native modules）
RUN apk add --no-cache python3 make g++ git

# 国内 npm 镜像
RUN npm config set registry https://registry.npmmirror.com

COPY package.json package-lock.json* ./
RUN npm install --registry=https://registry.npmmirror.com

COPY tsconfig.json tsconfig.app.json tsconfig.node.json vite.config.ts index.html ./
COPY tailwind.config.ts postcss.config.js ./
COPY src/ src/
COPY public/ public/
COPY server/ server/

# 构建前端 (tsc + vite) 和后端 bundle
RUN npm run build \
 && npm run build:server-bundle

# ---- 阶段 2：运行 ----
FROM node:20-alpine

WORKDIR /app

RUN npm config set registry https://registry.npmmirror.com

# 运行时：纯 JS 运行时，无 native 依赖（JDBC 桥接需要 Java，按需另加）
RUN apk add --no-cache curl tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

# 仅拷贝 production 依赖清单，重新安装 prod-only 节省体积
COPY package.json package-lock.json* ./
RUN npm install --include=prod --legacy-peer-deps --registry=https://registry.npmmirror.com \
 && npm cache clean --force

# 复制前端产物 + 后端 bundle + 服务端源码 (兼容非 bundle 启动)
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/scripts/server-bundle.cjs ./scripts/server-bundle.cjs
COPY --from=builder /app/server ./server
COPY scripts/ ./scripts/

# 默认环境（可被 docker-compose 环境变量覆盖）
ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/app/data \
    LOG_DIR=/app/logs \
    DB_CONFIG_PATH=/app/config/db.enc

# 数据 & 日志目录
RUN mkdir -p /app/data /app/logs /app/config
VOLUME ["/app/data", "/app/logs"]

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1

# 启动服务端（使用 ESM 源码模式，支持 import.meta）
CMD ["node", "server/index.mjs"]
