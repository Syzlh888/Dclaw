/**
 * 认证 API
 * 提供登录/注册功能
 */
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { generateToken, authMiddleware } from '../middleware/auth.mjs';

const router = Router();

// 简单的内存用户存储（生产环境应迁移到数据库）
const users = new Map();

// 初始化默认管理员账号
const defaultAdmin = {
  username: 'admin',
  // 默认密码: admin123（bcrypt hash）
  passwordHash: bcrypt.hashSync('admin123', 10),
  role: 'admin',
  createdAt: new Date().toISOString(),
};
users.set('admin', defaultAdmin);

/**
 * POST /api/auth/login
 * 用户登录，返回 JWT Token
 */
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  const user = users.get(username);
  if (!user) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }

  const token = generateToken({
    username: user.username,
    role: user.role,
  });

  res.json({
    token,
    user: {
      username: user.username,
      role: user.role,
    },
  });
});

/**
 * POST /api/auth/register
 * 注册新用户（仅管理员可操作，生产环境应加权限控制）
 */
router.post('/register', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: '请输入用户名和密码' });
  }

  if (username.length < 3) {
    return res.status(400).json({ error: '用户名至少需要3个字符' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少需要6个字符' });
  }

  if (users.has(username)) {
    return res.status(409).json({ error: '用户名已存在' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    username,
    passwordHash,
    role: 'user',
    createdAt: new Date().toISOString(),
  };
  users.set(username, user);

  const token = generateToken({
    username: user.username,
    role: user.role,
  });

  res.status(201).json({
    token,
    user: {
      username: user.username,
      role: user.role,
    },
  });
});

/**
 * POST /api/auth/verify-password
 * 验证当前登录用户密码（用于二次验证）
 */
router.post('/verify-password', authMiddleware, async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: '请输入密码' });

  const { username } = req.user || {};
  if (!username) return res.status(401).json({ error: '未认证' });

  const user = users.get(username);
  if (!user) return res.status(404).json({ error: '用户不存在' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(401).json({ error: '密码错误' });
  res.json({ success: true });
});

export function getUsers() {
  return users;
}

export default router;
