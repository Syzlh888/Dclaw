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
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getById } from './database.mjs';

const __dirname = path.dirname(
  typeof import.meta !== 'undefined' && import.meta.url
    ? fileURLToPath(import.meta.url)
    : __filename
);
const BRIDGE_DIR = process.env.HGDB_BRIDGE_DIR || path.join(process.env.SERVER_ROOT || __dirname, 'hgdb-bridge');
// 确保 DATA_DIR 为绝对路径，避免 Java 子进程 cwd 不同导致相对路径解析失败
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));

/**
 * 在常见位置查找 Java 可执行文件（java.exe / javac.exe）
 * 解决 Windows 上 Java PATH 不稳定的问题
 * @returns {string|null} 找到的完整路径，或 null 表示未找到
 */
function findJavaBin(binName) {
  const isWin = process.platform === 'win32';
  const exeName = isWin ? `${binName}.exe` : binName;

  // 1. 直接搜索 PATH 环境变量（不依赖 spawn/exec，避免 asar 内 cmd.exe 问题）
  const pathDirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of pathDirs) {
    try {
      const candidate = path.resolve(path.join(dir, exeName));
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* 跳过无效路径 */ }
  }

  // 2. 检查 JAVA_HOME 环境变量
  const javaHome = process.env.JAVA_HOME;
  if (javaHome) {
    const candidate = path.join(javaHome, 'bin', exeName);
    if (fs.existsSync(candidate)) return candidate;
  }

  // 3. Windows 注册表查询（最可靠的方式）
  if (isWin) {
    try {
      // JDK 注册表
      const regKeys = [
        'HKLM\\SOFTWARE\\JavaSoft\\JDK',
        'HKLM\\SOFTWARE\\JavaSoft\\Java Development Kit',
        'HKLM\\SOFTWARE\\JavaSoft\\Java Runtime Environment',
        'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\JDK',
        'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Development Kit',
        'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft\\Java Runtime Environment',
      ];
      for (const rk of regKeys) {
        try {
          const regResult = spawnSync('reg', ['query', rk, '/s'], {
            stdio: 'pipe', timeout: 5000,
          });
          if (regResult.status !== 0) continue;
          const regOut = regResult.stdout.toString();
          // 从输出中提取 JavaHome 路径
          const matches = regOut.matchAll(/JavaHome\s+REG_(?:SZ|EXPAND_SZ)\s+(.+)/gi);
          for (const m of matches) {
            let homePath = m[1].trim();
            // 展开 %ProgramFiles% 等环境变量
            homePath = homePath.replace(/%([^%]+)%/g, (_, v) => process.env[v] || `%${v}%`);
            const candidate = path.join(homePath, 'bin', exeName);
            if (fs.existsSync(candidate)) return candidate;
          }
        } catch { /* 该注册表项不存在 */ }
      }
    } catch { /* 注册表查询失败 */ }
  }

  // 4. Windows 常见安装路径（按可能性排序）
  if (isWin) {
    const baseDirs = [
      process.env['ProgramFiles'],            // C:\Program Files
      process.env['ProgramFiles(x86)'],       // C:\Program Files (x86)
      process.env['ProgramW6432'],            // C:\Program Files (64-bit)
      process.env.LOCALAPPDATA,               // C:\Users\xxx\AppData\Local
      'C:\\Program Files',
      'C:\\Program Files (x86)',
    ].filter(Boolean);

    const javaDirs = [
      'Eclipse Adoptium', 'Amazon Corretto', 'Microsoft', 'Zulu', 'Java',
      'BellSoft', 'Oracle', 'Semeru', 'Temurin', 'RedHat',
    ];

    for (const base of baseDirs) {
      for (const jd of javaDirs) {
        const vendorDir = path.join(base, jd);
        if (!fs.existsSync(vendorDir)) continue;
        try {
          const entries = fs.readdirSync(vendorDir);
          // 按版本号降序排列（最新的优先）
          const jdkDirs = entries
            .filter(e => /^jdk[-_]?\d/i.test(e) || /^jdk/i.test(e) && !e.endsWith('.zip'))
            .sort((a, b) => {
              const va = parseFloat((a.match(/(\d+\.?\d*)/) || [])[1] || '0');
              const vb = parseFloat((b.match(/(\d+\.?\d*)/) || [])[1] || '0');
              return vb - va;
            });
          for (const dir of jdkDirs) {
            const candidate = path.join(vendorDir, dir, 'bin', exeName);
            if (fs.existsSync(candidate)) return candidate;
          }
          // 也检查直接在该目录下的 bin
          const directBin = path.join(vendorDir, 'bin', exeName);
          if (fs.existsSync(directBin)) return directBin;
        } catch { /* 跳过无法读取的目录 */ }
      }
    }
  }

  // 5. Linux/macOS 常见路径
  if (!isWin) {
    const candidates = [
      '/usr/bin', '/usr/local/bin', '/opt/homebrew/bin',
      '/usr/lib/jvm', '/Library/Java/JavaVirtualMachines',
    ];
    for (const base of candidates) {
      if (!fs.existsSync(base)) continue;
      try {
        const files = fs.readdirSync(base, { recursive: false });
        for (const f of files) {
          const candidate = path.join(base, f, 'bin', exeName);
          if (fs.existsSync(candidate)) return candidate;
        }
      } catch { /* skip */ }
    }
  }

  // 6. 彻底找不到 → 返回 null（不再兜底返回 'java'，避免无意义的 ENOENT）
  return null;
}

/** 缓存查找到的 Java 路径（避免每次连接都搜索一遍） */
let _cachedJavaPath = null;
let _cachedJavacPath = null;
let _javaSearchDone = false;
function getJavaPath() {
  if (!_javaSearchDone) {
    _javaSearchDone = true;
    _cachedJavaPath = findJavaBin('java');
    _cachedJavacPath = findJavaBin('javac');
  }
  if (!_cachedJavaPath) {
    throw new Error(
      '未找到 Java 运行环境（JRE/JDK）。\n' +
      '请安装 Java 17 或更高版本：\n' +
      '• 推荐下载: https://adoptium.net/download/\n' +
      '• 选择 Temurin JDK 17+ (x64 Windows .msi)\n' +
      '• 安装时勾选"将 Java 添加到 PATH"，或手动设置 JAVA_HOME 环境变量'
    );
  }
  return _cachedJavaPath;
}
function getJavacPath() {
  if (!_javaSearchDone) {
    _javaSearchDone = true;
    _cachedJavaPath = findJavaBin('java');
    _cachedJavacPath = findJavaBin('javac');
  }
  if (!_cachedJavacPath) {
    throw new Error(
      '未找到 Java 开发工具（JDK javac）。\n' +
      '如需第一次编译桥接程序，需要 JDK（而不仅仅是 JRE）。\n' +
      '请安装 JDK 17+: https://adoptium.net/download/'
    );
  }
  return _cachedJavacPath;
}

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
 * 编译目标 Java 8（release 8）：class 版本 52.0，兼容 Java 8+ 所有主流 JRE
 */
function ensureCompiled() {
  const classPath = path.join(BRIDGE_DIR, 'HgdbBridge.class');

  // 若 .class 存在，先探测其 class 版本；版本过高（编译机 JDK 太新）时强制重编
  if (fs.existsSync(classPath)) {
    try {
      const buf = fs.readFileSync(classPath);
      // JVM class 文件魔数 0xCAFEBABE 后是 minor(2B) + major(2B)
      if (buf.length >= 8 && buf.readUInt32BE(0) === 0xCAFEBABE) {
        const major = buf.readUInt16BE(6);
        // major=52(Java8), 55(Java11), 61(Java17), 65(Java21), 70(Java26)
        // 只要不高于 65（Java 21，主流 LTS 上限）就复用
        if (major <= 65) return;
        console.log(`[hgdb-bridge] 检测到 HgdbBridge.class 版本过高 (major=${major})，将重新编译为 Java 8 兼容字节码`);
        try { fs.unlinkSync(classPath); } catch { /* ignore */ }
      }
    } catch (e) {
      console.warn('[hgdb-bridge] 探测 class 版本失败，将重新编译:', e.message);
      try { fs.unlinkSync(classPath); } catch { /* ignore */ }
    }
  }

  const javacPath = getJavacPath();
  console.log(`[hgdb-bridge] 正在编译 Java 桥接为 Java 8 兼容字节码... (javac: ${javacPath})`);
  try {
    // 先尝试 --release 8（Java 9+ 支持），失败降级到 -source 1.8 -target 1.8（Java 8 用）
    let result = spawnSync(javacPath, ['-encoding', 'UTF-8', '--release', '8', 'HgdbBridge.java'], {
      cwd: BRIDGE_DIR,
      stdio: 'pipe',
      timeout: 30000,
    });
    if (result.status !== 0) {
      console.warn('[hgdb-bridge] --release 8 编译失败，降级尝试 -source 1.8 -target 1.8');
      result = spawnSync(javacPath, ['-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8', 'HgdbBridge.java'], {
        cwd: BRIDGE_DIR,
        stdio: 'pipe',
        timeout: 30000,
      });
    }
    if (result.status !== 0) {
      const stderr = result.stderr ? result.stderr.toString() : 'unknown error';
      throw new Error(stderr);
    }
    console.log('[hgdb-bridge] Java 桥接编译成功（目标 Java 8 兼容）');
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
  const driverInfo = driverId ? await getById('drivers', driverId) : null;

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

  const javaPath = getJavaPath();
  console.log(`[hgdb-bridge] using java: ${javaPath}`);

  let proc;
  try {
    proc = spawn(javaPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: BRIDGE_DIR,
      windowsHide: true,        // Windows: 隐藏控制台窗口，防止干扰父进程
      detached: false,           // 保持父子关系以便监控退出状态
    });
  } catch (err) {
    throw new Error(`无法启动 Java: ${err.message}（检测到 java 路径: ${javaPath}）。请确认已安装 Java 并加入 PATH`);
  }

  // 通过 stdin 首行传递密码（比 CLI 参数更安全）
  // Windows 管道缓冲问题：write 后必须显式 flush（通过 cork/uncork 或立即再 write 触发 drain）
  // 密码尾部换行必要，Java 的 Scanner.nextLine 靠它切分
  try {
    // 使用 cork+uncork 组合确保 Node.js 底层 pipe 立即刷新（Windows 上尤其重要）
    proc.stdin.cork();
    proc.stdin.write(password + '\n', 'utf-8');
    proc.stdin.uncork();
    // 兜底：等一个 tick 后再确认写入完成
    setImmediate(() => {
      try {
        if (proc.stdin && !proc.stdin.destroyed) {
          proc.stdin.write('', 'utf-8'); // 触发 drain
        }
      } catch { /* ignore */ }
    });
    console.log(`[hgdb-bridge] password written to stdin (${password.length} chars)`);
  } catch (err) {
    // Java 进程可能已退出（如认证失败），write 会抛 EPIPE
    // 捕获后交给下游 Promise 处理
    console.warn(`[hgdb-bridge] stdin write failed: ${err.message}`);
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
        const bridge = createBridgeClient(proc, stderrBuf);
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
        // 从 stderr 提取错误信息（Java 异常栈）—— 放宽到 2000 字，避免关键堆栈被截断
        const stderrFull = stderrBuf.join('\n');
        const stderrOutput = stderrFull.substring(0, 2000);
        console.error(`[hgdb-bridge] process closed with code=${code}, stderr FULL:\n${stderrFull}`);

        // 提取 FATAL 消息（可能是嵌套的 "FATAL: FATAL: xxx"）
        let fatalMsg = '';
        if (stderrOutput) {
          const fatalMatch = stderrOutput.match(/FATAL:\s*(.+)/);
          if (fatalMatch) {
            const inner = fatalMatch[1];
            const innerMatch = inner.match(/^FATAL:\s*(.+)/);
            fatalMsg = (innerMatch ? innerMatch[1] : inner).trim();
          }
        }

        // 判断是否为数据库侧错误 → 以数据库错误为主提示，Java 环境信息作为参考
        const isDbError = fatalMsg && (
          fatalMsg.includes('does not exist') ||
          fatalMsg.includes('password authentication failed') ||
          fatalMsg.includes('no pg_hba.conf') ||
          fatalMsg.includes('Connection refused') ||
          fatalMsg.includes('timeout') ||
          fatalMsg.includes('already in use') ||
          fatalMsg.includes('too many clients') ||
          fatalMsg.includes('role') ||
          fatalMsg.includes('database') ||
          fatalMsg.includes('syntax error')
        );

        if (isDbError) {
          reject(new Error(`数据库连接失败: ${fatalMsg}\n` +
            `目标: ${host}:${port}/${database}\n` +
            `驱动: ${driverClass} (${urlPrefix}://)`));
        } else if (fatalMsg) {
          // 其他 FATAL 错误（可能是驱动/JDBC 配置问题）
          reject(new Error(`数据库返回错误: ${fatalMsg}\n` +
            `目标: ${host}:${port}/${database}\n` +
            `驱动: ${driverClass}`));
        } else {
          // 无明确 stderr → 按 Java 环境问题提示
          let detail = '';
          if (stderrOutput) {
            const lines = stderrOutput.split('\n').map(l => l.trim()).filter(l => l);
            // 找异常头（含冒号且不是缩进的 "at ..." 栈行）
            const excLine = lines.find(l => l.includes(':') && !l.startsWith('at ') && !l.startsWith('java:'));
            if (excLine) {
              detail = `\n异常详情: ${excLine.substring(0, 500)}`;
            }
            // 无论如何都附上前 8 行原始 stderr，避免关键信息被过滤掉
            const preview = lines.slice(0, 8).join('\n  ');
            if (preview) detail += `\n\nstderr 原始输出:\n  ${preview}`;
          } else {
            detail = '\n\nstderr 为空 —— Java 进程可能启动时立即崩溃，无输出即退出';
          }
          reject(new Error(`Java 桥接进程异常退出 (code=${code})，请确认:\n` +
            `1. Java 已安装 (java -version)\n` +
            `2. 驱动 JAR 文件: ${jarPath}\n` +
            `3. 驱动类名: ${driverClass}\n` +
            `4. JDBC URL 前缀: ${urlPrefix}\n` +
            `5. 目标数据库: ${host}:${port}/${database}${detail}`));
        }
      }
    });

    setTimeout(() => {
      if (!readyResolved && !closed) {
        closed = true;
        const stderrPreview = stderrBuf.join('\n').substring(0, 2000);
        proc.kill();
        reject(new Error(
          `Java 桥接启动超时 (45s)。可能原因：\n` +
          `  · 网络到 ${host}:${port} 慢或被防火墙拦截\n` +
          `  · JDBC 驱动加载耗时过长\n` +
          `  · 数据库无响应\n\n` +
          `诊断信息（Java stderr）:\n${stderrPreview || '(无输出)'}`
        ));
      }
    }, 45000);
  });
}

async function createBridgeClient(proc, stderrBuf) {
  async function exec(sql) {
    const encoded = Buffer.from(sql, 'utf-8').toString('base64');

    return new Promise((resolve, reject) => {
      const chunks = [];
      let timer;

      const onClose = (code) => {
        clearTimeout(timer);
        cleanup();
        const stderrOutput = (stderrBuf || []).join('\n').substring(0, 500);
        const fatalMatch = stderrOutput.match(/FATAL:\s*(.+)/);
        if (fatalMatch) {
          const inner = fatalMatch[1];
          const innerMatch = inner.match(/^FATAL:\s*(.+)/);
          reject(new Error(`查询执行失败: ${innerMatch ? innerMatch[1] : inner}`));
        } else {
          reject(new Error(`Java 桥接进程意外退出 (code=${code})${stderrOutput ? '\n详情: ' + stderrOutput.substring(0, 200) : ''}`));
        }
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
