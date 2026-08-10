/**
 * 代理网关 — PostgreSQL / 瀚高(HighGo) 协议适配器
 *
 * 瀚高数据库兼容 PG 协议，直接复用本适配器（db_type 映射由 index.mjs 处理）。
 *
 * 认证流程（PG 协议）：
 *  1. 客户端发 StartupMessage → 解析 user，校验（临时账号/有效期/IP/并发）
 *  2. 服务端回 AuthenticationCleartextPassword
 *  3. 客户端发 PasswordMessage（明文）→ 校验 proxy_password
 *  4. 通过后以内部账号连真实库（PG 客户端握手，支持 cleartext/md5）
 *  5. 双向转发；客户端→真实库方向扫描 Q/P 消息提取 SQL，写审计；
 *     若 audit_mode=intercept 且危险 SQL → 发送错误并断开（不转发）
 *
 * 统一接口：handleAuth / connectReal / authSuccess / buildAuthError / extractSqls / classifySql
 */
import {
  parseStartup, nextMessage, extractSqlFromMessage,
  authCleartext, authOk, readyForQuery, parameterStatus, backendKeyData,
  errorResponse, connectRealAsClient,
} from '../protocol.mjs';
import { classifySql } from '../audit.mjs';

let nextPid = 1000;
let nextKey = 1;

export function createPgAdapter(session) {
  return new PgAdapter(session);
}

class PgAdapter {
  constructor(session) {
    this.session = session;
    // authState: { step: 'startup' | 'password' }
    this.authState = { step: 'startup' };
  }

  /**
   * 处理客户端认证阶段数据。
   * @returns { status:'wait'|'auth-ok'|'error', errorMessage? }
   */
  handleAuth() {
    const s = this.session;
    const buf = s.buf;
    const st = this.authState;

    if (st.step === 'startup') {
      if (buf.length < 8) return { status: 'wait' };
      const length = buf.readInt32BE(0);
      if (buf.length < length) return { status: 'wait' };
      const startup = parseStartup(buf);
      s.buf = buf.subarray(length);
      if (startup.sslRequest) {
        // 不支持 SSL：回复 'N'（拒绝），客户端会在同一连接上继续发送真正的 StartupMessage
        s.client.write(Buffer.from('N'));
        return { status: 'wait' };
      }
      if (startup.cancel || startup.unknown) {
        return { status: 'error', errorMessage: '不支持的启动消息' };
      }
      const username = startup.params && startup.params.user;
      const v = s.validate();
      if (!v.ok) return { status: 'error', errorMessage: v.reason };
      if (!username || username !== s.proxy.proxy_username) {
        return { status: 'error', errorMessage: '临时账号无效' };
      }
      if (s.proxy.currentConnections >= s.proxy.max_connections) {
        return { status: 'error', errorMessage: `超过最大并发连接数（${s.proxy.max_connections}）` };
      }
      st.step = 'password';
      s.client.write(authCleartext());
      return { status: 'wait' };
    }

    // step === 'password'
    const msg = nextMessage(buf);
    if (!msg) return { status: 'wait' };
    s.buf = buf.subarray(msg.consumed);
    if (msg.type !== 'p') {
      return { status: 'error', errorMessage: '认证失败：未收到密码消息' };
    }
    let pw = msg.payload.toString('utf8');
    while (pw.endsWith('\0')) pw = pw.slice(0, -1);
    const expected = s.decryptProxyPassword();
    if (!expected || pw !== expected) {
      return { status: 'error', errorMessage: '临时密码错误' };
    }
    return { status: 'auth-ok' };
  }

  /** 以 PG 客户端身份连接真实库 */
  async connectReal(realCfg) {
    return connectRealAsClient({
      host: realCfg.host,
      port: realCfg.port,
      user: realCfg.username,
      password: realCfg.password,
      database: realCfg.database_name,
    });
  }

  /** 认证成功后发给客户端的字节（AuthOk + 参数 + BackendKeyData + ReadyForQuery） */
  authSuccess() {
    return Buffer.concat([
      authOk(),
      parameterStatus('server_version', '16.0'),
      parameterStatus('client_encoding', 'UTF8'),
      parameterStatus('server_encoding', 'UTF8'),
      backendKeyData(nextPid++, nextKey++),
      readyForQuery('I'),
    ]);
  }

  /** 认证/拦截错误响应字节 */
  buildAuthError(msg) {
    return errorResponse(msg);
  }

  /**
   * 从客户端→真实库方向的数据流中提取 SQL。
   * 返回 [{ sql, consumed }]，consumed 为该消息占用的字节数。
   * 非 SQL 消息（如其他协议类型）返回 { sql: null, consumed }，仍需转发。
   */
  extractSqls() {
    const s = this.session;
    const buf = s.buf;
    const out = [];
    let remaining = buf;
    for (;;) {
      const msg = nextMessage(remaining);
      if (!msg) break;
      let sql = null;
      if (msg.type === 'Q' || msg.type === 'P') {
        sql = extractSqlFromMessage(msg);
      }
      out.push({ sql, consumed: msg.consumed });
      remaining = remaining.subarray(msg.consumed);
    }
    return out;
  }

  /** 分类（复用 audit.mjs） */
  classifySql(sql) {
    return classifySql(sql);
  }
}
