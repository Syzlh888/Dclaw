/**
 * 代理网关 — 瀚高(HighGo) 协议适配器
 *
 * 瀚高数据库完全兼容 PostgreSQL 线协议，因此直接复用 PG 适配器逻辑。
 * 本模块仅做 db_type 映射标识，实际认证/转发/审计全部走 pg-adapter。
 *
 * 统一接口：handleAuth / connectReal / authSuccess / buildAuthError / extractSqls / classifySql
 */
import { createPgAdapter } from './pg-adapter.mjs';

export function createHighgoAdapter(session) {
  // 瀚高 = PG 协议，直接委托给 pg 适配器
  return createPgAdapter(session);
}
