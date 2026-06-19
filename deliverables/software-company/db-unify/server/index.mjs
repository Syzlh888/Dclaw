/**
 * DClaw 数据钳 后端服务入口
 * 
 * 模块化架构：
 * - database.mjs    数据持久化（JSON 文件存储 + 异步写入队列）
 * - crypto.mjs      密码加密（AES-256-GCM）
 * - logger.mjs      Winston 结构化日志（含 traceId）
 * - middleware/
 *   - auth.mjs      JWT 认证中间件
 * - routes/
 *   - auth.mjs          登录/注册
 *   - connections.mjs   连接管理 CRUD + 测试 + Schema/Database 发现
 *   - tree.mjs          层级树 CRUD（项目→业务模块→区域节点→连接实例）
 *   - execute.mjs       SQL 批量执行（SSE 流式进度推送）
 *   - history.mjs       执行历史记录
 *   - templates.mjs      SQL 模板库
 *   - scripts.mjs        SQL 脚本管理
 */
import 'dotenv/config';
// force nodemon restart for bridge fix
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { nanoid } from 'nanoid';
import { initDatabase, initDefaultData } from './database.mjs';
import { log, runWithTrace } from './logger.mjs';
import { authMiddleware } from './middleware/auth.mjs';
import { getMachineInfo, validateLicense, saveLicense, loadLicense } from './license.mjs';

import authRouter from './routes/auth.mjs';
import connectionsRouter from './routes/connections.mjs';
import treeRouter from './routes/tree.mjs';
import executeRouter from './routes/execute.mjs';
import historyRouter, { autoCleanup, isCleanupEnabled } from './routes/history.mjs';
import templatesRouter from './routes/templates.mjs';
import scriptsRouter from './routes/scripts.mjs';
import driversRouter from './routes/drivers.mjs';
import backupRouter, { startAutoBackup } from './routes/backup.mjs';
import projectsRouter from './routes/projects.mjs';
import engineeringsRouter from './routes/engineerings.mjs';
import applicationsRouter from './routes/applications.mjs';
import serversRouter from './routes/servers.mjs';
import systemConfigRouter from './routes/systemConfig.mjs';
import accessRouter from './routes/access.mjs';

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3001;
const isProduction = process.env.NODE_ENV === 'production';
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : (isProduction ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173']);

// ========= 安全中间件 =========

// HTTP 安全头
app.use(helmet({
  contentSecurityPolicy: false, // SPA 需要 CSP 单独配置
}));

// CORS：生产环境严格限制
app.use(cors({
  origin: corsOrigin.length > 0 ? corsOrigin : false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// 响应压缩
app.use(compression());

// 请求体限制
app.use(express.json({ limit: '10mb' }));

// 全局限流
const globalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 分钟
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});
app.use(globalLimiter);

// 登录接口特殊限流（防暴力破解）
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '登录尝试过于频繁，请15分钟后再试' },
});

// ========= 请求追踪中间件 =========

app.use((req, res, next) => {
  const traceId = req.headers['x-trace-id'] || nanoid(10);
  res.setHeader('X-Trace-Id', traceId);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 400 ? 'warn' : 'info';
    log[level](`${req.method} ${req.originalUrl} → ${res.statusCode} (${duration}ms)`);
  });

  runWithTrace(traceId, () => next());
});

// 静态文件服务（生产环境）
// APP_DIST 由 Electron 主进程注入，指向 asar 虚拟文件系统中的 dist/ 目录
const staticDir = process.env.APP_DIST || 'dist';
if (isProduction) {
  app.use(express.static(staticDir));
}

// ========= 初始化数据库 =========

initDatabase();
initDefaultData();

// 启动时不自动清理（默认关闭，用户需在界面上手动开启）
// 每小时检查：仅当用户启用时执行
const HISTORY_RETENTION_DAYS = parseInt(process.env.HISTORY_RETENTION_DAYS, 10) || 7;
setInterval(() => {
  if (isCleanupEnabled()) {
    autoCleanup(HISTORY_RETENTION_DAYS);
  }
}, 60 * 60 * 1000);

// 启动自动备份（如果有配置）
startAutoBackup();

// ========= 路由挂载 =========

// 认证路由（公开）
app.use('/api/auth', authLimiter, authRouter);

// 健康检查（公开）
app.get('/api/health', (_req, res) => {
  const os = process
    ? { memory: process.memoryUsage(), uptime: process.uptime() }
    : null;

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: os?.uptime || 0,
    memory: os ? {
      heapUsed: Math.round(os.memory.heapUsed / 1024 / 1024),
      heapTotal: Math.round(os.memory.heapTotal / 1024 / 1024),
    } : null,
    version: '1.0.0',
  });
});

// ========= 授权 API（公开，Electron 客户端使用）=========

// 获取机器信息（供激活页使用）
app.get('/api/license/machine-info', (_req, res) => {
  res.json(getMachineInfo());
});

// 验证激活码
app.post('/api/license/activate', (req, res) => {
  const { licenseKey } = req.body;
  if (!licenseKey) {
    return res.status(400).json({ error: '请提供激活码' });
  }
  const result = validateLicense(licenseKey);
  if (result.valid) {
    saveLicense(licenseKey);
  }
  res.json(result);
});

// 检查激活状态
app.get('/api/license/status', (_req, res) => {
  res.json(loadLicense());
});

// 业务路由（需认证）
app.use('/api/connections', authMiddleware, connectionsRouter);
app.use('/api/tree', authMiddleware, treeRouter);
app.use('/api/execute', authMiddleware, executeRouter);
app.use('/api/history', authMiddleware, historyRouter);
app.use('/api/templates', authMiddleware, templatesRouter);
app.use('/api/scripts', authMiddleware, scriptsRouter);
app.use('/api/drivers', authMiddleware, driversRouter);

// 向后兼容
app.use('/api/connection', authMiddleware, connectionsRouter);

// 备份还原（需认证）
app.use('/api/backup', authMiddleware, backupRouter);

// 服务器资源管理（需认证）
app.use('/api/servers', authMiddleware, serversRouter);
app.use('/api/projects', authMiddleware, projectsRouter);
app.use('/api/engineerings', authMiddleware, engineeringsRouter);
app.use('/api/applications', authMiddleware, applicationsRouter);
app.use('/api/system', authMiddleware, systemConfigRouter);
app.use('/api/access', authMiddleware, accessRouter);

// ========= 生产环境 SPA 回退 =========

if (isProduction) {
  const indexPath = path.join(staticDir, 'index.html');
  app.get('*', (_req, res) => {
    res.sendFile(indexPath);
  });
}

// ========= 错误处理 =========

// 404
app.use((req, res) => {
  res.status(404).json({ error: '请求的资源不存在' });
});

// 全局错误处理（不泄露内部错误信息）
app.use((err, _req, res, _next) => {
  log.error('服务器内部错误', { error: err.message, stack: err.stack });
  res.status(500).json({
    error: isProduction ? '服务器内部错误，请稍后重试' : (err.message || '服务器内部错误'),
  });
});

// ========= 全局异常保护 =========

// 防止未捕获异常导致进程崩溃
process.on('uncaughtException', (err) => {
  log.error('[uncaughtException] 未捕获的异常（进程未退出）', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  log.warn('[unhandledRejection] 未处理的 Promise 拒绝', { error: reason?.message || String(reason) });
});

// ========= 启动 =========

app.listen(PORT, () => {
  const routes = [
    'POST /api/auth/login          - 用户登录',
    'POST /api/auth/register       - 用户注册',
    'GET  /api/health              - 健康检查',
    'GET  /api/tree                - 获取层级树',
    'PUT  /api/tree/reorder        - 节点排序',
    'GET  /api/connections         - 获取连接列表',
    'POST /api/connections         - 创建连接',
    'POST /api/connections/test    - 测试连接',
    'POST /api/executions          - 批量执行 SQL (SSE)',
    'GET  /api/history             - 执行历史',
    'GET  /api/drivers             - 驱动管理',
  ];

  const env = isProduction ? 'PROD' : 'DEV';
  const auth = isProduction ? '已启用' : '已跳过（开发环境）';

  log.info(`🚀 DClaw 数据钳 后端启动 [${env}]`, {
    port: PORT,
    corsOrigin: corsOrigin.length > 0 ? corsOrigin : '禁用',
    auth,
  });

  if (!isProduction) {
    console.log(`\n${'='.repeat(50)}`);
    console.log(`  DClaw 数据钳 API [${env}]`);
    console.log(`  http://localhost:${PORT}`);
    console.log(`  认证: ${auth}`);
    console.log(`${'='.repeat(50)}`);
    console.log('  端点:');
    routes.forEach((r) => console.log(`    ${r}`));
    console.log(`${'='.repeat(50)}\n`);
  }
});
