/**
 * 代理网关 — MySQL / MariaDB 协议适配器
 *
 * 实现：
 *  - 服务端握手：发送 HandshakeV10，解析客户端 HandshakeResponse41
 *  - 认证：mysql_native_password（SHA1 双重哈希），caching_sha2_password（SHA256）
 *  - 认证成功后发送 OK 包，进入转发
 *  - 转发方向扫描 COM_QUERY(0x03) / COM_STMT_PREPARE(0x16) 提取 SQL
 *  - 以 MySQL 客户端身份连接真实库（握手 + 认证 + OK 确认）
 *  - 危险 SQL / 只读判断复用 audit.mjs
 *
 * 统一接口：handleAuth / connectReal / authSuccess / buildAuthError / extractSqls / classifySql
 */
import net from 'node:net';
import crypto from 'node:crypto';
import { classifySql } from '../audit.mjs';

// ---------- MySQL 能力位 ----------
const CLIENT_LONG_PASSWORD = 0x00000001;
const CLIENT_LONG_FLAG = 0x00000004;
const CLIENT_CONNECT_WITH_DB = 0x00000008;
const CLIENT_PROTOCOL_41 = 0x00000200;
const CLIENT_SSL = 0x00000800;
const CLIENT_TRANSACTIONS = 0x00002000;
const CLIENT_SECURE_CONNECTION = 0x00008000;
const CLIENT_MULTI_STATEMENTS = 0x00010000;
const CLIENT_MULTI_RESULTS = 0x00020000;
const CLIENT_PS_MULTI_RESULTS = 0x00040000;
const CLIENT_PLUGIN_AUTH = 0x00080000;
const CLIENT_CONNECT_ATTRS = 0x00100000;
const CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA = 0x00200000;
const CLIENT_DEPRECATE_EOF = 0x01000000;

/** 代理对外宣称的能力（服务端） */
const SERVER_CAPS = CLIENT_LONG_PASSWORD | CLIENT_LONG_FLAG | CLIENT_CONNECT_WITH_DB
  | CLIENT_PROTOCOL_41 | CLIENT_TRANSACTIONS | CLIENT_SECURE_CONNECTION
  | CLIENT_MULTI_STATEMENTS | CLIENT_MULTI_RESULTS | CLIENT_PS_MULTI_RESULTS
  | CLIENT_PLUGIN_AUTH | CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA;

const CHARSET_UTF8MB4 = 45;

// ---------- 编码工具 ----------
function lenencInt(n) {
  const b = [];
  if (n < 0xfb) b.push(n);
  else if (n <= 0xffff) { b.push(0xfc, n & 0xff, (n >> 8) & 0xff); }
  else if (n <= 0xffffff) { b.push(0xfd, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff); }
  else { b.push(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff, 0, 0, 0, 0); }
  return Buffer.from(b);
}

function readLenenc(buf, off) {
  if (off >= buf.length) return null;
  const first = buf[off];
  if (first < 0xfb) return { value: first, size: 1 };
  if (first === 0xfc) return { value: buf.readUInt16LE(off + 1), size: 3 };
  if (first === 0xfd) return { value: buf.readUIntLE(off + 1, 3), size: 4 };
  if (first === 0xfe) return { value: buf.readBigUInt64LE(off + 1), size: 9 };
  return null;
}

/** 构造一个 MySQL 数据包（3 字节小端长度 + 1 字节序号 + payload） */
function packet(payload, seq = 0) {
  const len = payload.length;
  const header = Buffer.alloc(4);
  header.writeUInt8(len & 0xff, 0);
  header.writeUInt8((len >> 8) & 0xff, 1);
  header.writeUInt8((len >> 16) & 0xff, 2);
  header.writeUInt8(seq, 3);
  return Buffer.concat([header, payload]);
}

/** 从 buffer 中解析一个完整数据包（不足返回 null） */
function parsePacket(buf) {
  if (buf.length < 4) return null;
  const len = buf[0] | (buf[1] << 8) | (buf[2] << 16);
  if (buf.length < 4 + len) return null;
  const seq = buf[3];
  const payload = buf.subarray(4, 4 + len);
  return { seq, payload, consumed: 4 + len };
}

// ---------- 认证哈希 ----------
/** mysql_native_password：SHA1 双重哈希 + XOR */
function nativeScramble(password, nonce) {
  const pw = Buffer.from(password || '', 'utf8');
  const stage1 = crypto.createHash('sha1').update(pw).digest();
  const stage2 = crypto.createHash('sha1').update(stage1).digest();
  const nonceStage2 = crypto.createHash('sha1')
    .update(Buffer.concat([nonce, stage2])).digest();
  const token = Buffer.alloc(20);
  for (let i = 0; i < 20; i += 1) token[i] = stage1[i] ^ nonceStage2[i];
  return token;
}

/** caching_sha2_password：SHA256 */
function sha2Scramble(password, nonce) {
  const pw = Buffer.from(password || '', 'utf8');
  const p1 = crypto.createHash('sha256').update(pw).digest();
  const p2 = crypto.createHash('sha256').update(p1).digest();
  const p3 = crypto.createHash('sha256')
    .update(Buffer.concat([p2, nonce])).digest();
  const token = Buffer.alloc(32);
  for (let i = 0; i < 32; i += 1) token[i] = p1[i] ^ p3[i];
  return token;
}

/** 校验客户端发来的 scramble 是否与期望密码匹配 */
function verifyScramble(plugin, password, nonce, clientToken) {
  if (plugin === 'caching_sha2_password') {
    const expected = sha2Scramble(password, nonce);
    return expected.equals(clientToken);
  }
  // 默认 mysql_native_password
  const expected = nativeScramble(password, nonce);
  return expected.equals(clientToken);
}

// ---------- 消息构造 ----------
/** 服务端 OK 包 */
function okPacket(seq = 2) {
  const body = Buffer.concat([
    Buffer.from([0x00]),
    lenencInt(0), // affected rows
    lenencInt(0), // last insert id
    Buffer.from([0x02, 0x00]), // status flags (autocommit)
    Buffer.from([0x00, 0x00]), // warnings
  ]);
  return packet(body, seq);
}

/** 服务端 ERR 包 */
function errPacket(message, seq = 2, code = 1045) {
  const body = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from([code & 0xff, (code >> 8) & 0xff]),
    Buffer.from('#28000'),
    Buffer.from(message || 'Access denied', 'utf8'),
  ]);
  return packet(body, seq);
}

/** 服务端 HandshakeV10 */
function handshakeV10({ connectionId, nonce, authPlugin = 'mysql_native_password' }) {
  const part1 = nonce.subarray(0, 8);
  const part2 = nonce.subarray(8);
  const parts = [];
  parts.push(Buffer.from([0x0a])); // protocol version
  parts.push(Buffer.from('8.0.30-dclaw-proxy\x00', 'utf8')); // server version
  const connId = Buffer.alloc(4);
  connId.writeUInt32LE(connectionId);
  parts.push(connId);
  parts.push(part1); // auth-plugin-data-part-1 (8 bytes)
  parts.push(Buffer.from([0x00])); // filler
  const caps = Buffer.alloc(2);
  caps.writeUInt16LE(SERVER_CAPS & 0xffff);
  parts.push(caps);
  parts.push(Buffer.from([CHARSET_UTF8MB4]));
  parts.push(Buffer.from([0x02, 0x00])); // status
  const capsUpper = Buffer.alloc(2);
  capsUpper.writeUInt16LE((SERVER_CAPS >> 16) & 0xffff);
  parts.push(capsUpper);
  parts.push(Buffer.from([21])); // auth-plugin-data-len
  parts.push(Buffer.alloc(10)); // reserved
  // auth-plugin-data-part-2：至少 13 字节，补齐到 auth-plugin-data-len
  const part2Buf = Buffer.alloc(13);
  part2.copy(part2Buf);
  part2Buf[12] = 0x00;
  parts.push(part2Buf);
  parts.push(Buffer.from(`${authPlugin}\x00`, 'utf8'));
  return packet(Buffer.concat(parts), 0);
}

/** 解析客户端 HandshakeResponse41 */
function parseHandshakeResponse(payload) {
  if (payload.length < 32) return null;
  const caps = payload.readUInt32LE(0);
  let off = 32;
  const nulIdx = payload.indexOf(0, off);
  if (nulIdx < 0) return null;
  const username = payload.toString('utf8', off, nulIdx);
  off = nulIdx + 1;

  let authResponse = Buffer.alloc(0);
  if (caps & CLIENT_PLUGIN_AUTH_LENENC_CLIENT_DATA) {
    const lr = readLenenc(payload, off);
    if (!lr) return null;
    authResponse = payload.subarray(off + lr.size, off + lr.size + lr.value);
    off += lr.size + lr.value;
  } else if (caps & CLIENT_SECURE_CONNECTION) {
    const len = payload[off];
    authResponse = payload.subarray(off + 1, off + 1 + len);
    off += 1 + len;
  } else {
    const n2 = payload.indexOf(0, off);
    if (n2 < 0) return null;
    authResponse = payload.subarray(off, n2);
    off = n2 + 1;
  }

  let database = null;
  if (caps & CLIENT_CONNECT_WITH_DB) {
    const n3 = payload.indexOf(0, off);
    if (n3 >= 0) {
      database = payload.toString('utf8', off, n3);
      off = n3 + 1;
    }
  }

  let authPlugin = 'mysql_native_password';
  if (caps & CLIENT_PLUGIN_AUTH) {
    const n4 = payload.indexOf(0, off);
    if (n4 >= 0) {
      authPlugin = payload.toString('utf8', off, n4);
    }
  }
  return { caps, username, authResponse, database, authPlugin };
}

export function createMysqlAdapter(session) {
  return new MysqlAdapter(session);
}

class MysqlAdapter {
  constructor(session) {
    this.session = session;
    this.nonce = crypto.randomBytes(20);
    this.connId = Math.floor(Math.random() * 0xffffffff);
    // authState: { step: 'greeting' | 'auth' }
    this.authState = { step: 'greeting' };
    this.greetingSent = false;
  }

  /** 连接建立后，主动向客户端发送 HandshakeV10 */
  sendGreeting() {
    if (this.greetingSent) return;
    this.greetingSent = true;
    this.session.client.write(handshakeV10({ connectionId: this.connId, nonce: this.nonce }));
  }

  /**
   * 处理客户端认证阶段数据。
   * @returns { status:'wait'|'auth-ok'|'error', errorMessage? }
   */
  handleAuth() {
    const s = this.session;
    this.sendGreeting(); // 确保已发握手（首次调用时发送）

    if (this.authState.step !== 'auth') {
      this.authState.step = 'auth';
      return { status: 'wait' }; // 等待客户端握手响应
    }

    const buf = s.buf;
    const pkt = parsePacket(buf);
    if (!pkt) return { status: 'wait' };
    s.buf = buf.subarray(pkt.consumed);

    // 处理 SSL 请求（我们暂不支持，忽略）
    if (pkt.payload.length >= 4 && pkt.payload.readUInt32LE(0) === CLIENT_SSL) {
      return { status: 'wait' };
    }

    const resp = parseHandshakeResponse(pkt.payload);
    if (!resp) {
      return { status: 'error', errorMessage: '无法解析 MySQL 握手响应' };
    }

    // 校验临时账号
    const v = s.validate();
    if (!v.ok) return { status: 'error', errorMessage: v.reason };
    if (!resp.username || resp.username !== s.proxy.proxy_username) {
      return { status: 'error', errorMessage: '临时账号无效' };
    }
    if (s.proxy.currentConnections >= s.proxy.max_connections) {
      return { status: 'error', errorMessage: `超过最大并发连接数（${s.proxy.max_connections}）` };
    }

    // 校验密码（mysql_native_password / caching_sha2_password）
    const expected = s.decryptProxyPassword();
    const plugin = resp.authPlugin || 'mysql_native_password';
    if (!expected || !verifyScramble(plugin, expected, this.nonce, resp.authResponse)) {
      return { status: 'error', errorMessage: '临时密码错误' };
    }

    this.authPlugin = plugin;
    return { status: 'auth-ok' };
  }

  /**
   * 以 MySQL 客户端身份连接真实库。
   * 完成握手 + 认证（native/sha2 快速认证），resolve socket + leftover。
   */
  async connectReal(realCfg) {
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: realCfg.host, port: realCfg.port });
      let buf = Buffer.alloc(0);
      let resolved = false;
      const fail = (err) => {
        if (resolved) return;
        resolved = true;
        sock.destroy();
        reject(err);
      };
      sock.on('error', (e) => fail(new Error(`连接真实库失败: ${e.message}`)));
      sock.on('connect', () => {
        // 等待真实库握手包
      });

      let handshakeDone = false;
      let nonce = null;
      let serverPlugin = 'mysql_native_password';
      let seq = 1;
      let pendingSha2 = false;

      const sendClientHandshake = () => {
        const caps = SERVER_CAPS;
        const parts = [];
        const capsB = Buffer.alloc(4);
        capsB.writeUInt32LE(caps);
        parts.push(capsB);
        const maxpkt = Buffer.alloc(4);
        maxpkt.writeUInt32LE(16777215);
        parts.push(maxpkt);
        parts.push(Buffer.from([CHARSET_UTF8MB4]));
        parts.push(Buffer.alloc(23));
        parts.push(Buffer.from(`${realCfg.username}\x00`, 'utf8'));
        // 认证响应
        let token;
        if (serverPlugin === 'caching_sha2_password') {
          token = sha2Scramble(realCfg.password, nonce);
        } else {
          token = nativeScramble(realCfg.password, nonce);
        }
        parts.push(Buffer.from([token.length]));
        parts.push(token);
        if (realCfg.database_name) parts.push(Buffer.from(`${realCfg.database_name}\x00`, 'utf8'));
        parts.push(Buffer.from(`${serverPlugin}\x00`, 'utf8'));
        sock.write(packet(Buffer.concat(parts), 1));
      };

      sock.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        for (;;) {
          const pkt = parsePacket(buf);
          if (!pkt) break;
          buf = buf.subarray(pkt.consumed);
          const pl = pkt.payload;
          const header = pl[0];

          if (!handshakeDone) {
            // 真实库 HandshakeV10
            if (pl.length < 2) continue;
            // 解析 auth-plugin-data
            let off = pl[0] + 1; // 跳过 protocol version + server version NUL
            // server version 以 NUL 结尾
            let i = 1;
            while (i < pl.length && pl[i] !== 0) i += 1;
            off = i + 1;
            off += 4; // connection id
            // part1 = 8 bytes
            const part1 = pl.subarray(off, off + 8);
            off += 8 + 1; // + filler
            off += 2 + 1 + 2 + 2; // caps low + charset + status + caps high
            const authLen = pl[off];
            off += 1 + 10; // auth-len + reserved
            const part2 = pl.subarray(off, off + Math.max(13, authLen - 8));
            nonce = Buffer.concat([part1, part2.subarray(0, 12)]);
            // auth plugin name
            const plgIdx = pl.indexOf(0, off);
            if (plgIdx >= 0) {
              serverPlugin = pl.toString('utf8', off, plgIdx) || 'mysql_native_password';
            }
            handshakeDone = true;
            sendClientHandshake();
            continue;
          }

          if (header === 0x00) {
            // OK → 认证完成
            if (resolved) return;
            resolved = true;
            sock.removeAllListeners('error');
            resolve({ socket: sock, leftover: buf });
            return;
          }
          if (header === 0xff) {
            // ERR
            let msg = 'MySQL 认证失败';
            const mIdx = pl.indexOf(0, 3);
            if (mIdx >= 0) msg = pl.toString('utf8', mIdx + 1);
            fail(new Error(msg));
            return;
          }
          if (header === 0xfe && pl.length < 9) {
            // AuthSwitchRequest：服务器要求切换认证方式
            const nulIdx = pl.indexOf(0, 1);
            const newPlugin = nulIdx >= 0 ? pl.toString('utf8', 1, nulIdx) : 'mysql_native_password';
            const newNonce = pl.subarray(nulIdx + 1, nulIdx + 21);
            if (newNonce.length >= 20) nonce = newNonce;
            serverPlugin = newPlugin;
            let token;
            if (newPlugin === 'caching_sha2_password') {
              token = sha2Scramble(realCfg.password, nonce);
            } else {
              token = nativeScramble(realCfg.password, nonce);
            }
            seq = (pkt.seq + 1) & 0xff;
            sock.write(packet(Buffer.concat([Buffer.from([token.length]), token]), seq));
            if (newPlugin === 'caching_sha2_password') pendingSha2 = true;
            continue;
          }
          if (header === 0x01) {
            // AuthMoreData（caching_sha2_password 快速认证流程）
            if (pl[1] === 0x03) {
              // fast auth success → 发送 0x02 确认
              seq = (pkt.seq + 1) & 0xff;
              sock.write(packet(Buffer.from([0x02]), seq));
            } else if (pl[1] === 0x04) {
              // full auth（需要 RSA 公钥），暂不支持
              fail(new Error('真实库要求 caching_sha2 完整认证（RSA），暂不支持'));
              return;
            }
            continue;
          }
        }
      });
    });
  }

  /** 认证成功后发给客户端：OK 包 */
  authSuccess() {
    return okPacket(2);
  }

  /** 认证/拦截错误：ERR 包 */
  buildAuthError(msg) {
    return errPacket(msg);
  }

  /**
   * 从客户端→真实库方向提取 SQL。
   * MySQL 每个命令都是一个数据包：COM_QUERY(0x03) / COM_STMT_PREPARE(0x16) 携带 SQL。
   * 返回 [{ sql, consumed }]。
   */
  extractSqls() {
    const s = this.session;
    const buf = s.buf;
    const out = [];
    let remaining = buf;
    for (;;) {
      const pkt = parsePacket(remaining);
      if (!pkt) break;
      const cmd = pkt.payload[0];
      let sql = null;
      if (cmd === 0x03 || cmd === 0x16) {
        // COM_QUERY / COM_STMT_PREPARE
        const text = pkt.payload.subarray(1).toString('utf8');
        if (text.trim()) sql = text;
      }
      out.push({ sql, consumed: pkt.consumed });
      remaining = remaining.subarray(pkt.consumed);
    }
    return out;
  }

  /** 分类（复用 audit.mjs） */
  classifySql(sql) {
    return classifySql(sql);
  }
}
