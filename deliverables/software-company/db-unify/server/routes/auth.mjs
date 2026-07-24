import { Router } from 'express';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, query } from '../database.mjs';
import { hashPassword, verifyPassword, needsRehash } from '../gm-password.mjs';
import { signGm, verifyGm } from '../gm-jwt.mjs';
import { getUserPermissions } from '../permissions/compute.mjs';
import { getSystemConfig } from './systemConfig.mjs';

const router = Router();

function sanitizeUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    displayName: u.display_name || u.displayName || '',
    email: u.email || '',
    phone: u.phone || '',
    status: u.status || 'active',
    lastLoginAt: u.last_login_at || null,
  };
}

/** POST /api/auth/login */
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });

  const users = await query('users', u => u.username === username);
  if (users.length === 0) return res.status(401).json({ error: '用户名或密码错误' });
  const user = users[0];

  if (user.status === 'disabled') return res.status(403).json({ error: '账号已禁用' });
  if (user.status === 'locked') return res.status(423).json({ error: '账号已锁定' });

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: '用户名或密码错误' });

  // 登录成功。若为旧 bcrypt hash 则自动升级到 GMP1
  if (needsRehash(user.password_hash)) {
    try {
      await update('users', user.id, {
        password_hash: hashPassword(password),
        password_updated_at: new Date().toISOString(),
      });
    } catch { /* 升级失败不影响登录 */ }
  }

  // 更新 last_login
  await update('users', user.id, {
    last_login_at: new Date().toISOString(),
    last_login_ip: req.ip || '',
  });

  // 创建 session
  const sessionId = nanoid(16);
  const now = new Date();
  const expires = new Date(now.getTime() + 24 * 3600 * 1000);
  await insert('authSessions', {
    id: sessionId,
    user_id: user.id,
    ip: req.ip || '',
    user_agent: req.headers['user-agent'] || '',
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });

  const token = signGm({ userId: user.id, username: user.username, sid: sessionId });
  const perms = await getUserPermissions(user.id);

  res.json({
    token,
    user: sanitizeUser(user),
    permissions: [...perms],
  });
});

/** POST /api/auth/logout */
router.post('/logout', async (req, res) => {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = verifyGm(auth.slice(7));
      if (payload.sid) {
        await update('authSessions', payload.sid, {
          revoked_at: new Date().toISOString(),
          revoked_by: payload.userId,
        });
      }
    } catch {}
  }
  res.json({ ok: true });
});

/** GET /api/auth/me */
router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;
  let userId = null;

  if (auth && auth.startsWith('Bearer ')) {
    try {
      const payload = verifyGm(auth.slice(7));
      userId = payload.userId;
    } catch (e) {
      // token 无效,继续尝试单机模式兜底
    }
  }

  // 开发环境单机模式兜底: 未登录时自动返回 admin 用户（生产环境必须真实登录）
  if (!userId && process.env.NODE_ENV !== 'production') {
    const authMode = getSystemConfig('auth.mode', 'single');
    if (authMode === 'single') {
      const admins = await query('users', u => u.username === 'admin');
      if (admins.length > 0) userId = admins[0].id;
    }
  }

  if (!userId) return res.status(401).json({ error: '未登录' });

  const user = await getById('users', userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });
  const perms = await getUserPermissions(user.id);
  res.json({
    user: sanitizeUser(user),
    permissions: [...perms],
  });
});

/** POST /api/auth/change-password */
router.post('/change-password', async (req, res) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' });
  let payload;
  try { payload = verifyGm(auth.slice(7)); } catch { return res.status(401).json({ error: '无效令牌' }); }

  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '旧密码和新密码不能为空' });
  if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少 8 位' });

  const user = await getById('users', payload.userId);
  if (!user) return res.status(401).json({ error: '用户不存在' });

  const ok = await verifyPassword(oldPassword, user.password_hash);
  if (!ok) return res.status(400).json({ error: '旧密码错误' });

  await update('users', user.id, {
    password_hash: hashPassword(newPassword),
    password_updated_at: new Date().toISOString(),
  });
  res.json({ ok: true });
});

export default router;
