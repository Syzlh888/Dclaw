/**
 * 代理网关 — 单连接会话处理（协议适配器模式）
 *
 * 流程：
 *  1. 根据 proxy.db_type 选择对应协议适配器（pg / mysql / dm）
 *  2. 认证阶段：调 adapter.handleAuth()（PG 握手 / MySQL 握手 / DM 盲放行）
 *  3. 校验：端口对应代理连接、账号匹配、status=active、未过期、IP 白名单、并发<=max
 *  4. 密码校验：adapter 内完成（PG 明文 / MySQL scramble / DM 不校验）
 *  5. 通过后以内部账号连真实库（adapter.connectReal），认证成功发 adapter.authSuccess()
 *  6. 双向转发；客户端→真实库方向调 adapter.extractSqls() 提取 SQL，写审计；
 *     若 audit_mode=intercept 且危险 SQL → 发送错误并断开（不转发）
 *
 * 铁律：只改代码，不验收。适配器必须实现统一接口。
 */
import { getPool } from '../db/pool.mjs';
import { getAdapter } from './adapters/index.mjs';
import { classifySql, persistAudit } from './audit.mjs';
import { decryptPasswordGm } from '../crypto-gm.mjs';
import { decryptPassword } from '../crypto.mjs';

/** IPv4 字符串 → 无符号 32 位整数 */
function ipToInt(ip) {
  const parts = String(ip).split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = Number(p);
    if (!Number.isInteger(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

/** 判断 clientIp 是否在单个白名单条目（IP 或 CIDR）范围内 */
function ipInRange(clientIp, entry) {
  if (typeof entry !== 'string' || !clientIp) return false;
  const cleanEntry = entry.trim();
  if (cleanEntry.includes('/')) {
    const [net, prefixStr] = cleanEntry.split('/');
    const prefix = Number(prefixStr);
    const c = ipToInt(clientIp);
    const n = ipToInt(net);
    if (c === null || n === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (c & mask) === (n & mask);
  }
  return ipToInt(clientIp) === ipToInt(cleanEntry);
}

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
    this.state = 'startup'; // startup -> forwarding
    this.sessionStart = new Date().toISOString();
    this.clientIp = clientSocket.remoteAddress || null;
    this.closed = false;

    // 根据 db_type 选择协议适配器
    this.adapter = getAdapter(proxyConn.db_type, this);

    // DM/Oracle/SQLServer：服务器先发握手的协议，客户端不会先发数据触发 handleAuth。
    // 连接建立时立即执行 fail-closed 检查（不允许盲放行则直接拒绝）。
    if (proxyConn.db_type && ['dm', 'oracle', 'sqlserver'].includes(proxyConn.db_type)) {
      try {
        const r = this.adapter.handleAuth();
        if (r && r.status === 'error') {
          this.sendErrorAndClose(r.errorMessage || '该数据库类型暂不支持代理认证');
          return;
        }
        if (r && r.status === 'auth-ok') {
          // connectReal() 是 async；必须在构造函数内捕获异常，
          // 否则构造器返回后 Promise 失败会变成 unhandledRejection，
          // 整个会话挂死直到 TCP 超时。
          this.connectReal().catch((err) => {
            console.error(`[proxy-session] connectReal failed for ${this.clientIp}:`, err?.message || err);
            this.sendErrorAndClose(`连接真实数据库失败: ${err?.message || err}`);
          });
          return;
        }
      } catch (e) {
        this.sendErrorAndClose(`认证失败: ${e?.message || e}`);
        return;
      }
    }

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
    // IP 白名单（支持单 IP 与 CIDR 网段）
    const ips = p.allowed_ips;
    if (Array.isArray(ips) && ips.length && this.clientIp) {
      const clientIp = this.clientIp.replace(/^::ffff:/, '');
      const inWhitelist = ips.some((entry) => ipInRange(clientIp, entry));
      if (!inWhitelist) {
        return { ok: false, reason: `来源 IP 不在白名单: ${clientIp}` };
      }
    }
    return { ok: true };
  }

  /** 解密代理临时密码（国密） */
  decryptProxyPassword() {
    return decryptPasswordGm(this.proxy.proxy_password);
  }

  // ---------- 客户端数据 ----------
  onClientData(chunk) {
    if (this.closed) return;
    this.buf = Buffer.concat([this.buf, chunk]);

    try {
      if (this.state === 'startup') {
        this.handleAuth();
        return;
      }

      if (this.state === 'forwarding' && this.real) {
        this.forwardClientToReal();
      }
    } catch (err) {
      // 适配器异常不应让进程崩溃
      console.error(`[proxy-session] onClientData 异常 ${this.clientIp}:`, err.message);
      this.sendErrorAndClose(`协议处理异常: ${err.message}`);
    }
  }

  /** 认证阶段：交给适配器处理 */
  handleAuth() {
    const r = this.adapter.handleAuth();
    if (!r) return;
    if (r.status === 'wait') return;
    if (r.status === 'error') {
      this.sendErrorAndClose(r.errorMessage || '认证失败');
      return;
    }
    if (r.status === 'auth-ok') {
      // connectReal() 是 async；这里同样需要捕获异常防 unhandledRejection
      this.connectReal().catch((err) => {
        console.error(`[proxy-session] connectReal failed for ${this.clientIp}:`, err?.message || err);
        this.sendErrorAndClose(`连接真实数据库失败: ${err?.message || err}`);
      });
    }
  }

  // ---------- 连真实库 ----------
  async connectReal() {
    const r = this.proxy.real;
    let socket;
    let leftover;
    try {
      const result = await this.adapter.connectReal(r);
      socket = result.socket;
      leftover = result.leftover;
    } catch (err) {
      this.sendErrorAndClose(`连接真实数据库失败: ${err.message}`);
      return;
    }
    // 竞态保护：await 期间客户端可能已断开
    if (this.closed) {
      try { socket.destroy(); } catch { /* ignore */ }
      return;
    }

    this.real = socket;
    this.state = 'forwarding';

    // 认证成功后发给客户端（adapter 返回对应协议的成功包）
    try {
      const successBuf = this.adapter.authSuccess();
      if (successBuf && successBuf.length) this.client.write(successBuf);
    } catch (e) {
      this.close(`client write failed after auth: ${e.message}`);
      return;
    }

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
      if (this.closed) return;
      try { this.client.write(c); } catch { /* socket closed */ }
    });
    this.real.on('end', () => this.close('real ended'));
    this.real.on('error', (e) => this.close(`real error: ${e.message}`));
    this.real.on('close', () => this.close('real closed'));

    // 残余数据（握手后剩余，若有则转发）
    if (leftover && leftover.length) {
      try { this.real.write(leftover); } catch { /* ignore */ }
    }
  }

  // ---------- 转发 + 审计 ----------
  forwardClientToReal() {
    const msgs = this.adapter.extractSqls();
    for (const m of msgs) {
      // 审计并可能拦截
      if (m.sql) {
        const cls = this.adapter.classifySql(m.sql) || classifySql(m.sql);
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
          sqlText: m.sql,
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
              ? `只读代理不允许执行写操作：${m.sql.slice(0, 200)}`
              : `危险 SQL 已被代理拦截（${cls.riskLevel}）：${m.sql.slice(0, 200)}`
          );
          return;
        }
      }
      const raw = this.buf.subarray(0, m.consumed);
      this.buf = this.buf.subarray(m.consumed);
      this.real.write(raw);
    }
  }

  // ---------- 关闭 ----------
  sendErrorAndClose(msg) {
    console.error(`[proxy-session] 拒绝连接 ${this.clientIp} (${this.proxy?.proxy_username}): ${msg}`);
    try {
      const errBuf = this.adapter.buildAuthError(msg);
      if (errBuf && errBuf.length) this.client.write(errBuf);
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
