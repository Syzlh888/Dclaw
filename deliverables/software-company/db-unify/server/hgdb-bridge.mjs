/**
 * 数据库 JDBC 桥接 - Node.js 端
 * 通过子进程调用 Java JDBC 驱动，解决 SM3 等非标准认证问题
 * 
 * 工作流程：
 * 1. 根据 driverId 查找用户上传的驱动 JAR 文件
 * 2. 自动编译 Java 桥接类（首次使用）
 * 3. 通过子进程与 Java 通信，执行 SQL
 * 
 * 安全改进：
 * - 密码通过 stdin 首行传递，不再暴露在进程参数中
 * - JDBC URL 中的数据库名做 URL 编码，防止特殊字符
 */
import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getById } from './database.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIDGE_DIR = path.join(__dirname, 'hgdb-bridge');
// 确保 DATA_DIR 为绝对路径，避免 Java 子进程 cwd 不同导致相对路径解析失败
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

/**
 * 根据 dbType 推导 JDBC URL 前缀
 */
function getJdbcUrlPrefix(driverInfo) {
  const dt = (driverInfo.dbType || driverInfo.name || '').toLowerCase();
  if (dt.includes('highgo') || dt.includes('瀚高')) return 'jdbc:highgo';
  if (dt.includes('gauss') || dt.includes('高斯') || dt.includes('opengauss')) return 'jdbc:gaussdb';
  if (dt.includes('kingbase') || dt.includes('金仓')) return 'jdbc:kingbase8';
  if (dt.includes('达梦')) return 'jdbc:dm';
  return 'jdbc:postgresql';
}

/**
 * 确保 Java 桥接已编译（同步操作，仅在首次调用时执行）
 */
function ensureCompiled() {
  const classPath = path.join(BRIDGE_DIR, 'HgdbBridge.class');
  if (fs.existsSync(classPath)) return; // 已编译，跳过

  console.log('[hgdb-bridge] 首次使用，正在编译 Java 桥接...');
  try {
    execSync('javac -encoding UTF-8 HgdbBridge.java', {
      cwd: BRIDGE_DIR,
      stdio: 'pipe',
      timeout: 30000,
    });
    console.log('[hgdb-bridge] Java 桥接编译成功');
  } catch (err) {
    const msg = err.stderr ? err.stderr.toString() : err.message;
    throw new Error(
      `Java 桥接编译失败。请确保已安装 JDK（需要 javac 命令）。\n` +
      `下载地址: https://adoptium.net/\n` +
      `错误详情: ${msg}`
    );
  }
}

/**
 * 查找驱动 JAR 文件路径
 */
function findDriverJar(driverId) {
  // 优先从用户上传的驱动目录查找
  if (driverId) {
    const driverDir = path.join(DATA_DIR, 'drivers', driverId);
    if (fs.existsSync(driverDir)) {
      const files = fs.readdirSync(driverDir).filter(f => f.endsWith('.jar'));
      if (files.length > 0) {
        return path.join(driverDir, files[0]);
      }
    }
  }

  // 兜底：检查 hgdb-bridge 目录下是否有驱动
  const fallbackFiles = fs.readdirSync(BRIDGE_DIR).filter(f => f.endsWith('.jar'));
  if (fallbackFiles.length > 0) {
    return path.join(BRIDGE_DIR, fallbackFiles[0]);
  }

  return null;
}

/**
 * 创建 JDBC 桥接连接
 * 
 * 密码通过 stdin 首行传递（安全），不再作为 CLI 参数。
 * 如需兼容旧版本 Java 桥接（未更新），仍保留 --pass 参数的降级逻辑。
 */
export async function createHgdbConnection({ host, port, username, password, database, driverId }) {
  const driverInfo = driverId ? getById('drivers', driverId) : null;

  const jarPath = findDriverJar(driverId);
  if (!jarPath) {
    throw new Error(
      `找不到驱动 JAR 文件。\n` +
      (driverId
        ? `驱动ID: ${driverId}\n请在"驱动管理"页面上传对应的 JAR 文件。`
        : `请通过"驱动管理"页面上传数据库驱动 JAR 文件。`)
    );
  }

  const urlPrefix = driverInfo ? getJdbcUrlPrefix(driverInfo) : 'jdbc:postgresql';
  const driverClass = driverInfo?.driverClass || 'org.postgresql.Driver';

  // 确保 Java 桥接类已编译
  ensureCompiled();

  // 密码不再通过 --pass CLI 参数传递
  // 改为通过 stdin 首行传递，避免密码暴露在进程参数中
  const classpath = `${BRIDGE_DIR}${path.delimiter}${jarPath}`;
  const args = [
    '-Dfile.encoding=UTF-8',
    '-Dsun.stdout.encoding=UTF-8',
    '-Dsun.stderr.encoding=UTF-8',
    '-cp', classpath,
    'HgdbBridge',
    '--driverClass', driverClass,
    '--urlPrefix', urlPrefix,
    '--host', host,
    '--port', String(port),
    '--user', username,
    '--db', database,
  ];

  console.log(`[hgdb-bridge] spawning java -cp "${classpath}"`);
  console.log(`[hgdb-bridge] driverClass=${driverClass} urlPrefix=${urlPrefix} host=${host}:${port}`);

  let proc;
  try {
    proc = spawn('java', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: BRIDGE_DIR,
      windowsHide: true,        // Windows: 隐藏控制台窗口，防止干扰父进程
      detached: false,           // 保持父子关系以便监控退出状态
    });
  } catch (err) {
    throw new Error(`无法启动 Java: ${err.message}。请确认已安装 Java 并加入 PATH`);
  }

  // 通过 stdin 首行传递密码（比 CLI 参数更安全）
  // 旧版本 Java 桥接（HgdbBridge 未更新）仍接受 --pass 参数
  try {
    proc.stdin.write(password + '\n');
  } catch (err) {
    // Java 进程可能已退出（如认证失败），write 会抛 EPIPE
    // 捕获后交给下游 Promise 处理
  }

  return new Promise((resolve, reject) => {
    const stdoutBuf = [];
    const stderrBuf = [];
    let readyResolved = false;
    let closed = false;

    // READY 检测监听器 —— 检测到后立即移除，避免与 exec 的 stdout 监听器冲突
    const onReadyCheck = (chunk) => {
      const text = chunk.toString('utf-8');
      stdoutBuf.push(text);
      if (!readyResolved && text.includes('READY')) {
        readyResolved = true;
        proc.stdout.removeListener('data', onReadyCheck);
        const bridge = createBridgeClient(proc);
        resolve(bridge);
      }
    };
    proc.stdout.on('data', onReadyCheck);

    proc.stderr.on('data', (chunk) => {
      let text = chunk.toString('utf-8').trim();
      // 检测是否含乱码特征（替换字符 � / \uFFFD），可能为 GBK 编码
      if (text.includes('\uFFFD')) {
        try {
          const decoder = new TextDecoder('gbk');
          text = decoder.decode(chunk).trim();
        } catch {
          // 保留原 UTF-8 解码结果
        }
      }
      stderrBuf.push(text);
      console.error(`[hgdb-bridge stderr] ${text}`);
    });

    // 防止子进程流错误导致 Node 进程崩溃（Windows 上 EPIPE 常见）
    proc.stdout.on('error', (err) => {
      console.error(`[hgdb-bridge stdout error] ${err.message}`);
    });
    proc.stderr.on('error', (err) => {
      console.error(`[hgdb-bridge stderr error] ${err.message}`);
    });
    proc.stdin.on('error', (err) => {
      console.error(`[hgdb-bridge stdin error] ${err.message}`);
    });

    proc.on('error', (err) => {
      if (!readyResolved) reject(new Error(`启动 Java 桥接失败: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (!readyResolved && !closed) {
        closed = true;
        // 从 stderr 提取错误信息（Java 异常栈）
        const stderrOutput = stderrBuf.join('\n').substring(0, 500);
        let detail = '';
        if (stderrOutput) {
          // 提取 FATAL 后的消息
          const fatalMatch = stderrOutput.match(/FATAL:\s*(.+)/);
          if (fatalMatch) {
            // 如果 FATAL 后还嵌套了另一个 FATAL（如 "FATAL: FATAL: xxx"），取最内层
            const inner = fatalMatch[1];
            const innerMatch = inner.match(/^FATAL:\s*(.+)/);
            detail = `\n数据库返回: ${innerMatch ? innerMatch[1] : inner}`;
          } else {
            // 提取所有异常消息（取第一行有意义的消息）
            const lines = stderrOutput.split('\n').map(l => l.trim()).filter(l => l);
            const excLine = lines.find(l => l.includes(':') && !l.startsWith('at ') && !l.startsWith('java:'));
            if (excLine) {
              detail = `\n异常详情: ${excLine.substring(0, 200)}`;
            } else if (lines.length > 0) {
              detail = `\n详情: ${lines.slice(0, 3).join(' | ')}`;
            }
          }
        }
        console.error(`[hgdb-bridge] process closed with code=${code}, stderr:\n${stderrOutput}`);
        reject(new Error(`Java 桥接进程异常退出 (code=${code})，请确认:\n` +
          `1. Java 已安装 (java -version)\n` +
          `2. 驱动 JAR 文件: ${jarPath}\n` +
          `3. 驱动类名: ${driverClass}\n` +
          `4. JDBC URL 前缀: ${urlPrefix}\n` +
          `5. 目标数据库: ${host}:${port}/${database}${detail}`));
      }
    });

    setTimeout(() => {
      if (!readyResolved && !closed) {
        closed = true;
        proc.kill();
        reject(new Error('Java 桥接启动超时 (15s)'));
      }
    }, 15000);
  });
}

function createBridgeClient(proc) {
  async function exec(sql) {
    const encoded = Buffer.from(sql, 'utf-8').toString('base64');

    return new Promise((resolve, reject) => {
      const chunks = [];
      let timer;

      const onClose = (code) => {
        clearTimeout(timer);
        cleanup();
        reject(new Error(`Java 桥接进程意外退出 (code=${code})`));
      };

      const onData = (data) => {
        clearTimeout(timer);
        chunks.push(data.toString('utf-8'));
        const full = chunks.join('');

        // 兼容 Windows (\r\n) 和 Linux (\n) 行尾
        const normalized = full.replace(/\r\n/g, '\n');
        const endIdx = normalized.indexOf('__END__\n');
        if (endIdx === -1) {
          timer = setTimeout(() => {
            cleanup();
            reject(new Error('JDBC 查询超时 (30s)，请检查数据库服务器网络连通性'));
          }, 30000);
          return;
        }

        const jsonStr = normalized.substring(0, endIdx).trim();
        cleanup();

        if (jsonStr === 'PONG') {
          resolve({ columns: [], rows: [] });
          return;
        }

        try {
          const result = JSON.parse(jsonStr);
          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (e) {
          reject(new Error(`JDBC 返回数据解析失败: ${e.message}`));
        }
      };

      const cleanup = () => {
        proc.stdout.removeListener('data', onData);
        proc.removeListener('close', onClose);
      };

      proc.stdout.on('data', onData);
      proc.on('close', onClose);
      timer = setTimeout(() => {
        cleanup();
        reject(new Error('JDBC 查询超时 (30s)，请检查数据库服务器网络连通性'));
      }, 30000);

      try {
        proc.stdin.write(encoded + '\n');
      } catch (writeErr) {
        cleanup();
        reject(new Error(`JDBC 进程通信失败: ${writeErr.message}`));
      }
    });
  }

  async function end() {
    try {
      if (proc && !proc.killed && proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write('__EXIT__\n');
        proc.stdin.end();
      }
    } catch { /* ignore */ }
    await new Promise(r => setTimeout(r, 500));
    if (!proc.killed) proc.kill();
  }

  return { exec, end };
}
