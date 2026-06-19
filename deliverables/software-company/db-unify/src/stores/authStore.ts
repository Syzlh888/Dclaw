/**
 * 认证状态管理
 */
import { create } from 'zustand';
import { getToken, setToken, clearToken, setUnauthorizedHandler } from '../services/apiClient';

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: { username: string; role: string } | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => {
  // 注册未授权回调
  setUnauthorizedHandler(() => {
    set({ isAuthenticated: false, token: null, user: null });
    clearToken();
  });

  return {
    isAuthenticated: !!getToken(),
    token: getToken(),
    user: null,

    login: async (username: string, password: string) => {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '登录失败' }));
        throw new Error(err.error || '登录失败');
      }

      const data = await response.json();
      setToken(data.token);
      set({ isAuthenticated: true, token: data.token, user: data.user });
    },

    logout: () => {
      clearToken();
      set({ isAuthenticated: false, token: null, user: null });
    },

    checkAuth: () => {
      const token = getToken();
      set({ isAuthenticated: !!token, token });
    },
  };
});
