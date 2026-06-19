/**
 * 统一 API 客户端
 * 自动附加 JWT Token，处理 401 重新登录
 */

const TOKEN_KEY = 'dc_auth_token';

let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void) {
  onUnauthorized = handler;
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch { /* ignore */ }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* ignore */ }
}

export async function apiFetch(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (options.body && typeof options.body === 'string') {
    headers['Content-Type'] = headers['Content-Type'] || 'application/json';
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401 && onUnauthorized) {
    onUnauthorized();
  }

  return response;
}
