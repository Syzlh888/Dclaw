# ============================================
# DB-Unify Docker 多阶段构建
# ============================================

# ---------- 阶段 1: 构建前端 ----------
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---------- 阶段 2: 生产运行 ----------
FROM node:20-alpine
WORKDIR /app

# 安全：以非 root 用户运行
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 安装生产依赖
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 复制构建产物和后端代码
COPY --from=frontend-builder /app/dist ./dist
COPY server ./server
COPY data ./data

# 创建日志目录
RUN mkdir -p logs && chown -R nodejs:nodejs /app

# 切换用户
USER nodejs

# 暴露端口
EXPOSE 3001

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/health || exit 1

# 启动
CMD ["node", "server/index.mjs"]
