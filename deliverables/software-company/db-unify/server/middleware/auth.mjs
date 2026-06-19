/**
 * JWT 认证中间件
 * 验证请求中的 Bearer Token
 */
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

// 不需要认证的路由
const PUBLIC_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/health',
];

/**
 * 生成 JWT Token
 */
export function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 验证 JWT Token
 */
export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

/**
 * 认证中间件
 * 验证 Bearer Token，将用户信息注入 req.user
 */
export function authMiddleware(req, res, next) {
  // 开发环境跳过认证
  if (process.env.NODE_ENV !== 'production' && !process.env.FORCE_AUTH) {
    return next();
  }

  // Electron 桌面模式：后端仅监听 localhost，前端入口已受许可证激活保护，跳过 JWT 认证
  if (process.env.ELECTRON_MODE === 'true') {
    req.user = { username: 'electron', role: 'admin' };
    return next();
  }

  // 公开路由跳过认证
  if (PUBLIC_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证令牌' });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: '认证令牌已过期' });
    }
    return res.status(401).json({ error: '认证令牌无效' });
  }
}
