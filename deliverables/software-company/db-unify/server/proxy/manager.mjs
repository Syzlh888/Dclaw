/**
 * DClaw 数据库代理网关 — 代理进程生命周期管理器（阶段3）
 *
 * 职责：
 *  - 通过 child_process.spawn 运行独立代理进程 `node server/proxy/index.mjs`
 *  - 管理 PID / 运行状态 / 启动时间 / 日志（server/proxy/proxy.log）
 *  - 提供 start / stop / restart / status
 *  - status 时顺带检查所有 active 代理连接的端口是否真实在监听（TCP connect 探测）
 *
 * 全局单例：本模块默认导出一个共享实例。
 * 独立进程运行，主服务崩溃不影响代理（见 docs/db-proxy-gateway-design.md）。
 */
import { spawn } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool } from '../db/pool.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 日志文件：默认 server/proxy/proxy.log，可用 PROXY_LOG_DIR 覆盖 */
const LOG_FILE = process.env.PROXY_LOG_DIR
  ? path.resolve(process.env.PROXY_LOG_DIR)
  : path.join(__dirname, 'proxy.log');

/** 代理进程入口脚本：server/proxy/index.mjs */
const PROXY_SCRIPT = path.join(__dirname, 'index.mjs');
/** 进程工作目录：项目根（dev = db-unify，docker = /app） */
const PROXY_CWD = path.resolve(__dirname, '..', '..');

/** SIGTERM 后未退出的强杀超时 */
const KILL_TIMEOUT_MS = 5000;
/** 端口探测超时 */
const PORT_CHECK_TIMEOUT_MS = 1500;

let child = null;
let running = false;
let startedAt = null;

function writeLog(line) {
  try {
    fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${line}\n`);
  } catch (err) {
    // 日志写入失败不影响功能
    console.error('[proxy-manager] 写日志失败:', err?.message);
  }
}

/**
 * 启动代理子进程。
 * 返回 { ok, running, pid, started_at } 或 { ok:false, running:true, error }（已在运行）。
 */
function start() {
  if (running) {
    return { ok: false, running: true, pid: child?.pid || null, error: '代理进程已在运行' };
  }

  writeLog('启动代理子进程: node ' + PROXY_SCRIPT);

  child = spawn(process.execPath, [PROXY_SCRIPT], {
    cwd: PROXY_CWD,
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false,
  });

  running = true;
  startedAt = new Date();

  const pipe = (stream, label) => {
    stream.on('data', (d) => {
      const s = d.toString();
      s.split('\n').filter(Boolean).forEach((line) => writeLog(`${label}${line}`));
    });
  };
  pipe(child.stdout, '[proxy] ');
  pipe(child.stderr, '[proxy:err] ');

  child.on('error', (err) => {
    writeLog(`代理子进程启动失败: ${err.message}`);
    running = false;
    child = null;
    startedAt = null;
  });

  child.on('exit', (code, signal) => {
    writeLog(`代理子进程退出 code=${code} signal=${signal}`);
    running = false;
    child = null;
    startedAt = null;
  });

  return { ok: true, running: true, pid: child.pid, started_at: startedAt.toISOString() };
}

/**
 * 停止代理子进程：SIGTERM → 超时 SIGKILL。
 * 返回 { ok, running, pid } 或 { ok:false, running:false, error }（未运行）。
 */
function stop() {
  if (!child || !running) {
    return Promise.resolve({ ok: false, running: false, error: '代理进程未在运行' });
  }
  const pid = child.pid;
  writeLog(`发送 SIGTERM 停止代理进程 (pid=${pid})`);

  return new Promise((resolve) => {
    const killer = setTimeout(() => {
      writeLog(`SIGTERM 超时未退出，发送 SIGKILL (pid=${pid})`);
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
    }, KILL_TIMEOUT_MS);

    child.once('exit', () => {
      clearTimeout(killer);
      resolve({ ok: true, running: false, pid });
    });

    try {
      child.kill('SIGTERM');
    } catch (err) {
      clearTimeout(killer);
      resolve({ ok: true, running: false, pid, warning: err?.message });
    }
  });
}

/** 重启：先停后启（未运行则直接启动） */
async function restart() {
  if (running) {
    await stop();
  }
  return start();
}

/** 探测某个 TCP 端口是否在监听 */
function checkPort(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host });
    const done = (v) => { try { sock.destroy(); } catch { /* ignore */ } resolve(v); };
    sock.setTimeout(PORT_CHECK_TIMEOUT_MS);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/**
 * 进程状态。
 * - 进程是否运行 / pid / 启动时间 / 运行秒数
 * - 所有 active 且未过期的代理连接及其端口监听情况
 */
async function status() {
  const listeningPorts = [];
  let activeCount = 0;
  let totalActive = 0;

  try {
    const { rows } = await getPool().query(
      `SELECT id, name, proxy_port, audit_mode, status
       FROM proxy_connections
       WHERE status = 'active' AND expires_at > NOW()
       ORDER BY proxy_port ASC`
    );
    totalActive = rows.length;
    for (const r of rows) {
      const listening = await checkPort(r.proxy_port);
      if (listening) activeCount += 1;
      listeningPorts.push({
        id: r.id,
        name: r.name,
        port: r.proxy_port,
        audit_mode: r.audit_mode,
        listening,
      });
    }
  } catch (err) {
    // DB 不可用时不阻塞状态返回
    // eslint-disable-next-line no-console
    console.error('[proxy-manager] 查询代理连接失败:', err?.message);
  }

  return {
    running,
    pid: running ? child?.pid || null : null,
    started_at: running && startedAt ? startedAt.toISOString() : null,
    uptime: running && startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0,
    logFile: LOG_FILE,
    listeningPorts,
    activeCount,
    totalActive,
  };
}

/** 全局单例 */
const proxyManager = {
  start,
  stop,
  restart,
  status,
  get isRunning() {
    return running;
  },
  get pid() {
    return running ? child?.pid || null : null;
  },
  get logFile() {
    return LOG_FILE;
  },
};

export default proxyManager;
