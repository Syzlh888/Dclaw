/**
 * 代理网关 — 达梦(DM) 协议适配器（盲转发 + 字节级 SQL 提取）
 *
 * 达梦协议未公开，无法完整解析。策略：
 *  - 盲转发所有字节（不解析协议），真实库握手/认证/数据原样透传
 *  - 认证阶段不校验（放行，记录为 unknown），因无法解析 DM 协议认证帧
 *  - 从客户端→真实库方向的数据流中，用正则尽力提取 SQL 文本用于审计
 *  - audit_mode=record：尽力记录；audit_mode=intercept：dangerous SQL 尽力拦截（断开）
 *
 * 统一接口：handleAuth / connectReal / authSuccess / buildAuthError / extractSqls / classifySql
 */
import net from 'node:net';
import { classifySql } from '../audit.mjs';

export function createDmAdapter(session) {
  return new DmAdapter(session);
}

/** 常见 SQL 关键字（SELECT/INSERT/UPDATE/DELETE/DDL/DCL 等） */
const SQL_KEYWORD_RE = /\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE|GRANT|REVOKE|EXEC|CALL|MERGE|REPLACE|COMMENT|LOCK|UNLOCK|BEGIN|COMMIT|ROLLBACK)\b/i;

/** 从字节流中尽力提取一段 SQL 文本 */
function extractSqlFromBytes(buf) {
  const text = buf.toString('utf8');
  const idx = text.search(SQL_KEYWORD_RE);
  if (idx < 0) return null;
  // 从关键字位置向后截取一段可打印文本（最多 500 字符）
  let end = idx;
  const max = Math.min(text.length, idx + 500);
  for (let i = idx; i < max; i += 1) {
    const c = text.charCodeAt(i);
    if (c === 0) break;
    // 遇到不可打印字符（除空白/常见标点）即停
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) break;
    end = i;
  }
  const chunk = text.slice(idx, end + 1).trim();
  if (chunk.length < 4) return null;
  return chunk;
}

class DmAdapter {
  constructor(session) {
    this.session = session;
    this.authState = { step: 'blind' };
  }

  /**
   * DM 认证无法解析 → 直接放行（记录为 unknown）。
   * 返回 auth-ok，不消耗任何字节（后续全部盲转发）。
   */
  handleAuth() {
    const s = this.session;
    s.dmBlind = true; // 标记盲转发
    return { status: 'auth-ok' };
  }

  /** DM 真实库：纯 TCP 连接（无 PG 式握手），返回 socket */
  async connectReal(realCfg) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: realCfg.host, port: realCfg.port });
      let resolved = false;
      const fail = (err) => {
        if (resolved) return;
        resolved = true;
        sock.destroy();
        reject(err);
      };
      sock.on('error', (e) => fail(new Error(`连接真实库失败: ${e.message}`)));
      sock.on('connect', () => {
        if (resolved) return;
        resolved = true;
        sock.removeAllListeners('error');
        resolve({ socket: sock, leftover: Buffer.alloc(0) });
      });
    });
  }

  /** DM 盲转发：不额外给客户端发任何认证成功字节（真实库握手原样透传） */
  authSuccess() {
    return Buffer.alloc(0);
  }

  /** DM 无法构造协议错误包 → 返回空（session 直接断开） */
  buildAuthError() {
    return Buffer.alloc(0);
  }

  /**
   * 盲转发：无法按帧解析，将整个缓冲作为一条"消息"转发。
   * 同时尽力提取 SQL 用于审计。
   * 返回 [{ sql, consumed }]，consumed = buf.length（全部转发）。
   */
  extractSqls() {
    const s = this.session;
    const buf = s.buf;
    if (!buf.length) return [];
    const sql = extractSqlFromBytes(buf);
    return [{ sql, consumed: buf.length }];
  }

  /** 分类（复用 audit.mjs） */
  classifySql(sql) {
    return classifySql(sql);
  }
}
