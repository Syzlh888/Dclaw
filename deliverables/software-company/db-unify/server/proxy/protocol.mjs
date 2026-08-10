/**
 * PostgreSQL 协议辅助函数（字节级）
 *
 * 供 server/proxy/ 独立代理进程使用：
 *  - 解析 StartupMessage / PasswordMessage
 *  - 构造后端消息（AuthOk / Cleartext / MD5 / ReadyForQuery / ErrorResponse）
 *  - 构造前端消息（Startup / Password）
 *  - 消息扫描 + SQL 提取（Q=Query / P=Parse）
 *  - MD5 密码哈希
 */
import crypto from 'node:crypto';
import net from 'node:net';

export const PROTOCOL_VERSION = 196608; // 3.0

/** 从 buffer 中取出一条完整的 PG 消息；不足则返回 null */
export function nextMessage(buf) {
  if (buf.length < 5) return null;
  const type = String.fromCharCode(buf[0]);
  const length = buf.readInt32BE(1);
  if (length < 4) return null;
  if (buf.length < 1 + length) return null;
  return {
    type,
    length,
    payload: buf.subarray(5, 1 + length),
    consumed: 1 + length,
  };
}

/** 解析 StartupMessage，返回 { protocol, params, sslRequest, cancel } */
export function parseStartup(buf) {
  if (buf.length < 8) return null;
  const length = buf.readInt32BE(0);
  const protocol = buf.readInt32BE(4);
  if (protocol === 80877102) return { protocol, cancel: true, length };
  if (protocol === 80877103) return { protocol, sslRequest: true, length };
  if (protocol !== PROTOCOL_VERSION) return { protocol, unknown: true, length };

  const params = {};
  let off = 8;
  while (off < length && off < buf.length) {
    const keyEnd = buf.indexOf(0, off);
    if (keyEnd < 0) break;
    const key = buf.toString('utf8', off, keyEnd);
    const valEnd = buf.indexOf(0, keyEnd + 1);
    if (valEnd < 0) break;
    params[key] = buf.toString('utf8', keyEnd + 1, valEnd);
    off = valEnd + 1;
  }
  return { protocol, params, length };
}

/** 构造后端消息（type + int32 length + payload） */
function backendMessage(type, payload) {
  const body = payload || Buffer.alloc(0);
  const header = Buffer.alloc(4);
  header.writeInt32BE(4 + body.length);
  return Buffer.concat([Buffer.from(type), header, body]);
}

function int32(v) {
  const b = Buffer.alloc(4);
  b.writeInt32BE(v);
  return b;
}

/** AuthenticationOk */
export function authOk() {
  return backendMessage('R', int32(0));
}

/** AuthenticationCleartextPassword */
export function authCleartext() {
  return backendMessage('R', int32(3));
}

/** AuthenticationMD5Password（4 字节 salt） */
export function authMd5(salt) {
  return backendMessage('R', Buffer.concat([int32(5), salt]));
}

/** ReadyForQuery */
export function readyForQuery(status = 'I') {
  return backendMessage('Z', Buffer.from(status));
}

/** ParameterStatus */
export function parameterStatus(key, value) {
  return backendMessage('S', Buffer.from(`${key}\0${value}\0`, 'utf8'));
}

/** BackendKeyData */
export function backendKeyData(pid, key) {
  return backendMessage('K', Buffer.concat([int32(pid), int32(key)]));
}

/** ErrorResponse */
export function errorResponse(msg) {
  const fields = Buffer.concat([
    Buffer.from('S'), Buffer.from('ERROR\0', 'utf8'),
    Buffer.from('M'), Buffer.from(`${msg || 'error'}\0`, 'utf8'),
    Buffer.from([0]),
  ]);
  return backendMessage('E', fields);
}

/** 前端 PasswordMessage（明文或 md5 响应，均以 \0 结尾） */
export function passwordMessage(pw) {
  return backendMessage('p', Buffer.from(`${pw}\0`, 'utf8'));
}

/** 前端 StartupMessage */
export function buildStartup({ user, database, applicationName = 'dclaw-proxy' }) {
  const pairs = [];
  pairs.push(['user', user]);
  if (database) pairs.push(['database', database]);
  pairs.push(['client_encoding', 'UTF8']);
  pairs.push(['application_name', applicationName]);
  let body = Buffer.alloc(0);
  for (const [k, v] of pairs) {
    body = Buffer.concat([body, Buffer.from(`${k}\0${v}\0`, 'utf8')]);
  }
  body = Buffer.concat([body, Buffer.from([0])]);
  const header = Buffer.alloc(4);
  header.writeInt32BE(4 + 4 + body.length);
  const proto = Buffer.alloc(4);
  proto.writeInt32BE(PROTOCOL_VERSION);
  return Buffer.concat([header, proto, body]);
}

/** 前端 Terminate */
export function terminateMessage() {
  return backendMessage('X', Buffer.alloc(0));
}

/** 从 'Q' / 'P' 消息中提取 SQL 文本；其它消息返回 null */
export function extractSqlFromMessage(msg) {
  if (msg.type === 'Q') {
    let s = msg.payload.toString('utf8');
    while (s.endsWith('\0')) s = s.slice(0, -1);
    return s;
  }
  if (msg.type === 'P') {
    const p = msg.payload;
    const nameEnd = p.indexOf(0);
    if (nameEnd < 0) return null;
    const queryEnd = p.indexOf(0, nameEnd + 1);
    if (queryEnd < 0) return null;
    return p.toString('utf8', nameEnd + 1, queryEnd);
  }
  return null;
}

/** 从 ErrorResponse 中提取 message 字段 */
export function extractError(msg) {
  const p = msg.payload;
  let off = 0;
  while (off < p.length) {
    const code = String.fromCharCode(p[off]);
    const end = p.indexOf(0, off + 1);
    if (end < 0) break;
    const str = p.toString('utf8', off + 1, end);
    if (code === 'M') return str;
    off = end + 1;
  }
  return '数据库错误';
}

/** PG MD5 密码哈希 */
export function md5Password(user, password, salt) {
  const inner = crypto.createHash('md5').update(password + user, 'utf8').digest('hex');
  const hash = crypto.createHash('md5')
    .update(Buffer.concat([Buffer.from(inner, 'ascii'), salt]))
    .digest('hex');
  return `md5${hash}`;
}

/** 以 PG 客户端身份连接真实库，认证完成后 resolve 原始 socket */
export function connectRealAsClient(cfg) {
  return new Promise((resolve, reject) => {
    const sock = netConnect(cfg.host, cfg.port);
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
      sock.write(buildStartup({ user: cfg.user, database: cfg.database }));
    });
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const msg = nextMessage(buf);
        if (!msg) break;
        buf = buf.subarray(msg.consumed);
        if (msg.type === 'R') {
          const code = msg.payload.readInt32BE(0);
          if (code === 0) {
            // auth ok
          } else if (code === 3) {
            sock.write(passwordMessage(cfg.password));
          } else if (code === 5) {
            const salt = msg.payload.subarray(4, 8);
            sock.write(passwordMessage(md5Password(cfg.user, cfg.password, salt)));
          } else if (code === 10) {
            fail(new Error('真实库要求 SCRAM-SHA-256 认证，当前代理仅支持 cleartext/md5'));
            return;
          } else {
            fail(new Error(`真实库不支持的认证方式 code=${code}`));
            return;
          }
        } else if (msg.type === 'E') {
          fail(new Error(extractError(msg)));
          return;
        } else if (msg.type === 'Z') {
          if (resolved) return;
          resolved = true;
          sock.removeAllListeners('error');
          resolve({ socket: sock, leftover: buf });
          return;
        }
      }
    });
  });
}

function netConnect(host, port) {
  return net.createConnection({ host, port });
}
