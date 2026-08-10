/**
 * 代理网关 — 单连接会话处理
 *
 * 流程：
 *  1. 读取客户端 StartupMessage，取 proxy_username
 *  2. 校验：端口对应代理连接、账号匹配、status=active、未过期、IP 白名单、并发<=max
 *  3. 请求明文密码 → 校验（国密解密 proxy_password 比对）
 *  4. 通过后以内部账号连真实库（PG 客户端握手，支持 cleartext/md5）
 *  5. 双向转发；客户端→真实库方向扫描 Q/P 消息提取 SQL，写入审计；
 *     若 audit_mode=intercept 且危险 SQL → 发送错误并断开（不转发）
 */
import { getPool } from '../db/pool.mjs';
import {
  parseStartup, nextMessage, extractSqlFromMessage,
  authCleartext, authOk, readyForQuery, parameterStatus, backendKeyData,
  errorResponse, connectRealAsClient,
} from './protocol.mjs';
import { classifySql, persistAudit } from './audit.mjs';
import { decryptPasswordGm } from '../crypto-gm.mjs';
import { decryptPassword } from '../crypto.mjs';

let nextPid = 1000;
let nextKey = 1;

export class ProxySession {
  /**
   * @param {net.Socket} clientSocket
   * @param {object} proxyConn   已装载的代理连接（含 real 内部连接信息）
   * @param {function} onClosed  连接关闭回调（用于并发计数）
   */
  constructor(clientSocket, proxyConn, onClosed) {
    this.client = clientSocket;
    this.proxy = proxyConn;
    this.onClosed = onClosed;
    this.real = null;
    this.buf = Buffer.alloc(0);
    this.state = 'startup'; // startup -> password -> forwarding
    this.sessionStart = new Date().toISOString();
    this.clientIp = clientSocket.remoteAddress || null;
    this.closed = false;

    this.client.on('data', (c) => this.onClientData(c));
    this.client.on('error', (e) => this.close(`client error: ${e.message}`));
    this.client.on('close', () => this.close('client closed'));
  }

  // ---------- 校验 ----------
  validate() {
    const p = this.proxy;
    // 状态
    if (p.status !== 'active') return { ok: false, reason: `代理连接状态非 active（${p.status}）` };
    // 有效期
    if (new Date(p.expires_at).getTime() < Date.now()) {
      return { ok: false, reason: '代理连接已过期' };
    }
    // IP 白名单
    const ips = p.allowed_ips;
    if (Array.isArray(ips) && ips.length && this.clientIp) {
      const ip = this.clientIp.replace(/^::ffff:/, '');
      if (!ips.some((a) => a === ip || (typeof a === 'string' && a.startsWith(`${ip}/`)))) {
        return { ok: false, reason: `来源 IP 不在白名单: ${ip}` };
      }
    }
    return { ok: true };
  }

  // ---------- 客户端数据 ----------
  onClientData(chunk) {
    if (this.closed) return;
    this.buf = Buffer.concat([this.buf, chunk]);

    if (this.state === 'startup') {
      // StartupMessage 长度在开头，等待完整
      if (this.buf.length < 8) return;
      const length = this.buf.readInt32BE(0);
      if (this.buf.length < length) return;
      const startup = parseStartup(this.buf);
      this.buf = this.buf.subarray(length);
      this.handleStartup(startup);
      return;
    }

    if (this.state === 'password') {
      // PasswordMessage
      const msg = nextMessage(this.buf);
      if (!msg) return;
      this.buf = this.buf.subarray(msg.consumed);
      if (msg.type !== 'p') {
        this.sendErrorAndClose('认证失败：未收到密码消息');
        return;
      }
      let pw = msg.payload.toString('utf8');
      while (pw.endsWith('\0')) pw = pw.slice(0, -1);
      this.handlePassword(pw);
      return;
    }

    if (this.state === 'forwarding' && this.real) {
      this.forwardClientToReal();
    }
  }

  handleStartup(startup) {
    if (!startup) {
      this.sendErrorAndClose('无法解析启动消息');
      return;
    }
    if (startup.sslRequest) {
      // 不支持 SSL：回复 'N'（拒绝），客户端会在同一连接上继续发送真正的 StartupMessage
      this.client.write(Buffer.from('N'));
      return;
    }
    if (startup.cancel || startup.unknown) {
      this.sendErrorAndClose('不支持的启动消息');
      return;
    }
    const username = startup.params && startup.params.user;
    const v = this.validate();
    if (!v.ok) {
      this.sendErrorAndClose(v.reason);
      return;
    }
    if (!username || username !== this.proxy.proxy_username) {
      this.sendErrorAndClose('临时账号无效');
      return;
    }
    // 并发校验
    if (this.proxy.currentConnections >= this.proxy.max_connections) {
      this.sendErrorAndClose(`超过最大并发连接数（${this.proxy.max_connections}）`);
      return;
    }
    this.state = 'password';
    this.client.write(authCleartext());
  }

  handlePassword(password) {
    const expected = decryptPasswordGm(this.proxy.proxy_password);
    if (!expected || password !== expected) {
      this.sendErrorAndClose('临时密码错误');
      return;
    }
    this.connectReal();
  }

  // ---------- 连真实库 ----------
  async connectReal() {
    const r = this.proxy.real;
    try {
      const { socket, leftover } = await connectRealAsClient({
        host: r.host,
        port: r.port,
        user: r.username,
        password: r.password,
        database: r.database_name,
      });
      this.real = socket;
      this.state = 'forwarding';
      this.client.write(Buffer.concat([
        authOk(),
        parameterStatus('server_version', '16.0'),
        parameterStatus('client_encoding', 'UTF8'),
        parameterStatus('server_encoding', 'UTF8'),
        backendKeyData(nextPid++, nextKey++),
        readyForQuery('I'),
      ]));

      // 更新 last_connected_at
      getPool().query(
        'UPDATE proxy_connections SET last_connected_at = NOW() WHERE id = $1',
        [this.proxy.id]
      ).catch(() => {});

      // 记录会话开始（无 SQL）
      persistAudit({
        proxyConnectionId: this.proxy.id,
        proxyUsername: this.proxy.proxy_username,
        dbType: this.proxy.db_type,
        realConnectionId: this.proxy.real_connection_id,
        clientIp: this.clientIp,
        sessionStart: this.sessionStart,
      });

      this.real.on('data', (c) => {
        if (!this.closed) this.client.write(c);
      });
      this.real.on('error', (e) => this.close(`real error: ${e.message}`));
      this.real.on('close', () => this.close('real closed'));

      // 残余数据（理论上握手后无数据，若有则转发）
      if (leftover && leftover.length) this.real.write(leftover);
    } catch (err) {
      this.sendErrorAndClose(`连接真实数据库失败: ${err.message}`);
    }
  }

  // ---------- 转发 + 审计 ----------
  forwardClientToReal() {
    for (;;) {
      const msg = nextMessage(this.buf);
      if (!msg) break;
      // 审计并可能拦截 Q/P 消息
      if (msg.type === 'Q' || msg.type === 'P') {
        const sql = extractSqlFromMessage(msg);
        if (sql) {
          const cls = classifySql(sql);
          // readonly 模式：只允许 SELECT/WITH/SHOW/EXPLAIN 等只读操作
          const readOnlyViolation = this.proxy.access_mode === 'readonly' && !cls.readOnly;
          const blocked = readOnlyViolation || (this.proxy.audit_mode === 'intercept' && cls.dangerous);
          persistAudit({
            proxyConnectionId: this.proxy.id,
            proxyUsername: this.proxy.proxy_username,
            dbType: this.proxy.db_type,
            realConnectionId: this.proxy.real_connection_id,
            clientIp: this.clientIp,
            sessionStart: this.sessionStart,
            sqlText: sql,
            sqlType: cls.sqlType,
            status: blocked ? 'blocked' : 'success',
            riskLevel: cls.riskLevel,
            errorMessage: blocked
              ? (readOnlyViolation ? '只读代理不允许写操作' : '危险 SQL 已被代理拦截')
              : null,
          });
          if (blocked) {
            this.sendErrorAndClose(
              readOnlyViolation
                ? `只读代理不允许执行写操作：${sql.slice(0, 200)}`
                : `危险 SQL 已被代理拦截（${cls.riskLevel}）：${sql.slice(0, 200)}`
            );
            return;
          }
        }
      }
      const raw = this.buf.subarray(0, msg.consumed);
      this.buf = this.buf.subarray(msg.consumed);
      this.real.write(raw);
    }
  }

  // ---------- 关闭 ----------
  sendErrorAndClose(msg) {
    console.error(`[proxy-session] 拒绝连接 ${this.clientIp} (${this.proxy?.proxy_username}): ${msg}`);
    try {
      this.client.write(errorResponse(msg));
    } catch { /* ignore */ }
    this.close(msg);
  }

  close(reason) {
    if (this.closed) return;
    this.closed = true;
    if (this.real) { try { this.real.destroy(); } catch { /* ignore */ } }
    try { this.client.destroy(); } catch { /* ignore */ }
    if (this.onClosed) this.onClosed(this);
  }
}
