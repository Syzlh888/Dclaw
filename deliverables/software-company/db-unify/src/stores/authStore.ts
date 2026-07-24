/**
 * 认证状态管理
 * 兼容旧 API：isAuthenticated / user / login(u, p) / logout() / checkAuth()
 * 新增：permissions / hasPermission / refresh / changePassword / loading / error
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  getToken,
  setToken,
  clearToken,
  setUnauthorizedHandler,
} from '../services/apiClient';
import {
  login as apiLogin,
  logout as apiLogout,
  fetchMe,
  changePassword as apiChangePassword,
  AuthUser,
} from '../services/authService';

interface AuthState {
  isAuthenticated: boolean;
  token: string | null;
  user: AuthUser | null;
  /** 权限点 code 列表（persist 用数组存） */
  permissions: string[];
  loading: boolean;
  error: string | null;

  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => void;
  refresh: () => Promise<void>;
  changePassword: (oldPwd: string, newPwd: string) => Promise<void>;
  hasPermission: (code: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => {
      // 注册 401 未授权回调
      setUnauthorizedHandler(() => {
        clearToken();
        set({ isAuthenticated: false, token: null, user: null, permissions: [] });
      });

      return {
        isAuthenticated: !!getToken(),
        token: getToken(),
        user: null,
        permissions: [],
        loading: false,
        error: null,

        login: async (username, password) => {
          set({ loading: true, error: null });
          try {
            const r = await apiLogin(username, password);
            setToken(r.token);
            set({
              isAuthenticated: true,
              token: r.token,
              user: r.user,
              permissions: r.permissions || [],
              loading: false,
            });
          } catch (e: any) {
            const msg = e?.message || '登录失败';
            set({ loading: false, error: msg });
            throw new Error(msg);
          }
        },

        logout: async () => {
          try {
            await apiLogout();
          } catch { /* ignore */ }
          clearToken();
          set({ isAuthenticated: false, token: null, user: null, permissions: [] });
        },

        checkAuth: () => {
          const token = getToken();
          set({ isAuthenticated: !!token, token });
        },

        refresh: async () => {
          // 不再要求先有 token — 单机模式后端会兜底返回 admin。
          try {
            const r = await fetchMe();
            set({ user: r.user, permissions: r.permissions || [], isAuthenticated: true });
          } catch {
            // 只有真的失败(多用户模式无 token) 才清空
            if (get().token) {
              clearToken();
              set({ isAuthenticated: false, token: null, user: null, permissions: [] });
            }
          }
        },

        changePassword: async (oldPwd, newPwd) => {
          await apiChangePassword(oldPwd, newPwd);
        },

        hasPermission: (code) => get().permissions.includes(code),
      };
    },
    {
      name: 'dclaw-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        permissions: state.permissions,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
