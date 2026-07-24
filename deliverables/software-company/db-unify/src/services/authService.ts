/**
 * 认证相关 API 封装
 * 项目未使用 axios，统一走 apiFetch (基于 fetch)
 */
import { apiFetch } from './apiClient';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  status: string;
  lastLoginAt: string | null;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
  permissions: string[];
}

export interface MeResult {
  user: AuthUser;
  permissions: string[];
}

async function parseError(r: Response, fallback: string): Promise<string> {
  try {
    const j = await r.json();
    return j?.error || fallback;
  } catch {
    return fallback;
  }
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error(await parseError(r, '登录失败'));
  return r.json();
}

export async function logout(): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' });
}

export async function fetchMe(): Promise<MeResult> {
  const r = await apiFetch('/api/auth/me');
  if (!r.ok) throw new Error(await parseError(r, '获取用户信息失败'));
  return r.json();
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<void> {
  const r = await apiFetch('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify({ oldPassword, newPassword }),
  });
  if (!r.ok) throw new Error(await parseError(r, '修改密码失败'));
}
