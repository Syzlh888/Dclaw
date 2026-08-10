/**
 * 代理网关 — 协议适配器工厂
 *
 * 根据 proxy.db_type 选择对应数据库协议适配器。
 * 每个适配器统一接口：
 *   handleAuth(buffer)          → { status:'wait'|'auth-ok'|'error', errorMessage? }
 *   connectReal(realCfg)        → Promise<{ socket, leftover }>
 *   authSuccess(proxy)          → Buffer（认证成功后发给客户端的字节）
 *   buildAuthError(msg)         → Buffer（认证错误/拦截时发给客户端的字节）
 *   extractSqls(buffer)         → [{ sql, consumed }]
 *   classifySql(sql)            → { sqlType, riskLevel, dangerous, readOnly }
 *
 * db_type 支持：postgresql | highgo | mysql | dm | oracle | sqlserver
 *  - postgresql / highgo → pg 适配器（瀚高兼容 PG 协议）
 *  - mysql               → mysql 适配器
 *  - dm / oracle / sqlserver → dm 适配器（盲转发 + 字节级 SQL 提取，尽力审计）
 */
import { createPgAdapter } from './pg-adapter.mjs';
import { createMysqlAdapter } from './mysql-adapter.mjs';
import { createDmAdapter } from './dm-adapter.mjs';

/** 默认适配器：无法识别时回退到盲转发（dm） */
const DEFAULT = 'dm';

export function getAdapter(dbType, session) {
  const t = (dbType || '').toLowerCase();
  switch (t) {
    case 'postgresql':
    case 'postgres':
    case 'highgo':
      return createPgAdapter(session);
    case 'mysql':
    case 'mariadb':
      return createMysqlAdapter(session);
    case 'dm':
    case 'oracle':
    case 'sqlserver':
    default:
      // dm / oracle / sqlserver：达梦盲转发适配器（尽力审计）
      return createDmAdapter(session);
  }
}

/** 列出支持的 db_type → 适配器名（供日志/诊断） */
export function adapterInfo() {
  return {
    postgresql: 'pg',
    highgo: 'pg',
    mysql: 'mysql',
    dm: 'dm',
    oracle: 'dm',
    sqlserver: 'dm',
  };
}
