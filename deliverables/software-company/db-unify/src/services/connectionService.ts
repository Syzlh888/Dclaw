import { DbDriver } from '../types/connection';
import { apiFetch } from './apiClient';

export interface FetchMetaParams {
  driver: DbDriver;
  host: string;
  port: number;
  username: string;
  password: string;
  customDriverId?: string;
}

/**
 * 从目标数据库实时查询 Schema 列表。
 * 通过后端代理 API 真正连接数据库并执行：
 *   SELECT schema_name FROM information_schema.schemata ORDER BY schema_name
 *
 * 仅做前端基础参数校验，真正的连接验证由后端完成。
 */
export async function fetchSchemas(
  params: FetchMetaParams & { database: string }
): Promise<string[]> {
  const host = params.host.trim();
  const username = params.username.trim();
  const password = params.password;
  const dbName = params.database.trim();

  // 前端基础校验
  if (!host) throw new Error('主机地址不能为空');
  if (!username) throw new Error('用户名不能为空');
  if (!dbName) throw new Error('数据库名不能为空');
  if (!password) throw new Error('密码不能为空');
  if (password.length < 3) throw new Error('密码长度不能少于 3 位');
  if (params.port < 1 || params.port > 65535) throw new Error(`端口 ${params.port} 无效`);
  if (!isValidHost(host)) throw new Error(`主机地址 "${host}" 格式无效`);

  // 调用后端 API 完成真实的连接测试和 Schema 查询
  const response = await apiFetch('/api/connection/schemas', {
    method: 'POST',
    body: JSON.stringify({
      driver: params.driver,
      host,
      port: params.port,
      username,
      password,
      database: dbName,
      customDriverId: params.customDriverId,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: `请求失败 (${response.status})` }));
    throw new Error(err.error || '连接失败');
  }

  const data = await response.json();
  return data.schemas || [];
}

/** 校验主机名/IP 是否看起来有效 */
function isValidHost(host: string): boolean {
  if (!host || host === 'invalid' || host === '0.0.0.0' || host === '255.255.255.255') {
    return false;
  }
  if (/^(test|demo|sample|example|abc|123|aaa|xxx|fake|none|nohost)$/i.test(host)) {
    return false;
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const m = host.match(ipv4);
  if (m) {
    const octets = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];
    if (octets.some((o) => o > 255)) return false;
    if (octets[0] === 0) return false;
    return true;
  }
  return host === 'localhost' || /^[a-zA-Z0-9][-a-zA-Z0-9.]*\.[a-zA-Z]{2,}$/.test(host);
}
