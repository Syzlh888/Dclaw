/**
 * Electron 主进程
 * 负责：启动 Express 后端、创建窗口、处理授权流程
 */
import { app, BrowserWindow, ipcMain, shell } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.NODE_ENV === 'development' && !app.isPackaged;

let mainWindow = null;
let serverStarted = false;

// ==================== 持久化配置 ====================

function getConfigPath() {
  return path.join(app.getPath('userData'), 'app-config.json');
}

function loadConfig() {
  try {
    if (fs.existsSync(getConfigPath())) {
      return JSON.parse(fs.readFileSync(getConfigPath(), 'utf8'));
    }
  } catch { /* ignore */ }
  return {};
}

function saveConfig(config) {
  try {
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.error('[DClaw] 保存配置失败:', e.message);
  }
}

function getAppPort() {
  const cfg = loadConfig();
  return cfg.port || 3001;
}

// ==================== 加密密钥管理 ====================

/**
 * 加载或生成持久化的 ENCRYPTION_KEY（存放于 userData 目录）
 * 首次运行自动生成，后续启动复用，保证加密过的数据库密码可解密
 */
function ensureEncryptionKey() {
  const userDataPath = app.getPath('userData');
  const keyFilePath = path.join(userDataPath, '.encryption-key');

  try {
    if (fs.existsSync(keyFilePath)) {
      const key = fs.readFileSync(keyFilePath, 'utf8').trim();
      if (key.length === 64) {
        return key;
      }
    }
  } catch {
    // 读取失败则生成新 key
  }

  // 首次启动：生成新密钥并持久化
  const key = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(keyFilePath, key, { mode: 0o600 });
  } catch (e) {
    console.error('[DClaw] 保存加密密钥失败:', e.message);
  }
  return key;
}

// ==================== 后端服务 ====================

/**
 * 检测端口是否被占用，如果是且是本应用之前的残留进程则尝试终止
 * @param {number} port
 */
async function ensurePortFree(port) {
  const isFree = await new Promise((resolve) => {
    const srv = http.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => {
      srv.close();
      resolve(true);
    });
    srv.listen(port, '127.0.0.1');
  });
  if (isFree) return true;

  // 端口被占用 — 尝试查找并终止占用端口的 Node 进程（很可能是上一次未正常退出的 DClaw 实例）
  console.warn(`[DClaw] 端口 ${port} 已被占用，尝试清理残留进程...`);
  try {
    const { execSync } = await import('node:child_process');
    // Windows: 用 netstat 找到 PID
    let pid = null;
    try {
      const output = execSync(
        `netstat -ano -p tcp | findstr :${port} | findstr LISTENING`,
        { encoding: 'utf8', timeout: 3000 }
      ).trim();
      const match = output.match(/\s(\d+)\s*$/);
      if (match) pid = parseInt(match[1], 10);
    } catch {}

    if (pid && pid > 0) {
      console.log(`[DClaw] 发现占用进程 PID: ${pid}，正在终止...`);
      try {
        execSync(`taskkill /F /PID ${pid}`, { encoding: 'utf8', timeout: 5000 });
        // 等待端口释放
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 200));
          const free = await new Promise((res) => {
            const s = http.createServer();
            s.once('error', () => res(false));
            s.once('listening', () => { s.close(); res(true); });
            s.listen(port, '127.0.0.1');
          });
          if (free) return true;
        }
      } catch (killErr) {
        console.warn('[DClaw] 终止残留进程失败:', killErr.message);
      }
    }
  } catch (e) {
    console.warn('[DClaw] 端口检测异常:', e.message);
  }

  return false;
}

async function startBackendServer() {
  if (isDev) {
    // 开发环境：假设后端已通过 npm run dev:backend 启动
    return;
  }

  if (serverStarted) return;

  // 生产环境：在 Electron 进程内直接 import Express 后端（同进程运行，避免 fork 炸弹）
  try {
    const appPort = getAppPort();

    // 先确保端口空闲
    const portFree = await ensurePortFree(appPort);
    if (!portFree) {
      throw new Error(`端口 ${appPort} 被其他程序占用，请关闭占用该端口的程序后重试。\n提示：可以在命令行运行 netstat -ano | findstr :${appPort} 查看哪个程序在占用。`);
    }

    // 生产环境切换到 resources 目录（asar 禁用时 app/ 是真实目录，含 dist/ 和 server/）
    const appRoot = app.isPackaged ? path.join(path.dirname(app.getAppPath()), '..') : path.join(__dirname, '..');
    process.chdir(appRoot);
    // 数据目录（asar 外可读写）
    process.env.DATA_DIR = path.join(appRoot, 'data');
    // dist 静态文件目录
    process.env.APP_DIST = path.join(__dirname, '..', 'dist');
    // 设置为生产模式，Express 会提供静态文件服务，同时 API 和前端同源，避免 file:// 跨域问题
    process.env.NODE_ENV = 'production';
    // Electron 桌面模式标志：auth 中间件将信任同源请求（已通过许可证激活保护入口）
    process.env.ELECTRON_MODE = 'true';
    process.env.PORT = String(appPort);
    // crypto.mjs 在生产环境要求 ENCRYPTION_KEY
    process.env.ENCRYPTION_KEY = ensureEncryptionKey();
    await import('../server/index.mjs');
    serverStarted = true;

    // 轮询健康检查，确认服务器真正开始监听后再继续
    const maxWaitMs = 10000;
    const startTime = Date.now();
    let ready = false;
    while (Date.now() - startTime < maxWaitMs) {
      try {
        const ok = await new Promise((resolve) => {
          const req = http.get(`http://127.0.0.1:${appPort}/api/health`, (res) => {
            resolve(res.statusCode === 200);
            res.resume(); // 消费响应体，避免内存泄漏
          });
          req.on('error', () => resolve(false));
          req.setTimeout(2000, () => { req.destroy(); resolve(false); });
        });
        if (ok) {
          ready = true;
          console.log(`[DClaw] 后端服务已就绪 (端口 ${appPort})`);
          break;
        }
      } catch {
        // 尚未就绪，等待重试
      }
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) {
      throw new Error(`后端服务在 ${maxWaitMs}ms 内未就绪 (端口 ${appPort})`);
    }
  } catch (e) {
    console.error('[DClaw] 后端服务启动失败:', e.message);
    throw new Error(`后端启动失败: ${e.message}`);
  }
}

// ==================== 窗口管理 ====================

async function createWindow() {
  const preloadPath = path.join(__dirname, 'preload.cjs').replace(/\\/g, '/');
  if (!fs.existsSync(preloadPath)) {
    console.error('[DClaw] preload 脚本不存在:', preloadPath);
    throw new Error(`preload 脚本不存在: ${preloadPath}`);
  }
  console.log('[DClaw] preload 路径:', preloadPath);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'DClaw 数据钳',
    icon: path.join(__dirname, '../public/favicon.ico'),
    webPreferences: {
      preload: preloadPath,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // 去掉默认菜单
  mainWindow.setMenuBarVisibility(false);

  if (isDev) {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境：Express 同时提供前端静态文件和 API（同源，杜绝 CORS/file:// 问题）
    await mainWindow.loadURL(`http://localhost:${getAppPort()}`);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ==================== IPC 处理 ====================

// 异步加载 license 模块
async function getLicenseModule() {
  const { loadLicense, saveLicense, validateLicense, getMachineInfo, removeLicense, getLicenseStatus, startTrial } = await import('../server/license.mjs');
  return { loadLicense, saveLicense, validateLicense, getMachineInfo, removeLicense, getLicenseStatus, startTrial };
}

ipcMain.handle('get-machine-info', async () => {
  const { getMachineInfo } = await getLicenseModule();
  return getMachineInfo();
});

ipcMain.handle('validate-license', async (_event, licenseKey) => {
  const { validateLicense, saveLicense } = await getLicenseModule();
  const result = validateLicense(licenseKey);
  if (result.valid) {
    saveLicense(licenseKey);
  }
  return result;
});

ipcMain.handle('check-license', async () => {
  const { getLicenseStatus } = await getLicenseModule();
  return getLicenseStatus();
});

ipcMain.handle('get-license-status', async () => {
  const { getLicenseStatus } = await getLicenseModule();
  return getLicenseStatus();
});

ipcMain.handle('reset-license', async () => {
  const { removeLicense } = await getLicenseModule();
  removeLicense();
  return { success: true };
});

ipcMain.handle('start-trial', async () => {
  const { startTrial } = await getLicenseModule();
  return startTrial();
});

// 打开外部链接（二维码扫码后打开）
ipcMain.handle('open-external', async (_event, url) => {
  await shell.openExternal(url);
});

// 端口管理
ipcMain.handle('get-app-port', async () => {
  return getAppPort();
});

ipcMain.handle('set-app-port', async (_event, newPort) => {
  const port = parseInt(newPort, 10);
  if (isNaN(port) || port < 1024 || port > 65535) {
    return { success: false, message: '端口号范围：1024-65535' };
  }
  const cfg = loadConfig();
  cfg.port = port;
  saveConfig(cfg);
  return { success: true, port };
});

// ==================== 应用生命周期 ====================

app.whenReady().then(async () => {
  try {
    await startBackendServer();
    await createWindow();
  } catch (e) {
    console.error('[DClaw] 应用启动失败:', e.message);
    // 启动失败时创建错误提示窗口
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      title: 'DClaw - 启动失败',
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    mainWindow.setMenuBarVisibility(false);
    const errMsg = encodeURIComponent(e.message);
    await mainWindow.loadURL(`data:text/html;charset=utf-8,
      <html><body style="font-family:sans-serif;padding:40px;">
        <h1 style="color:#c00">启动失败</h1>
        <pre style="background:#f5f5f5;padding:16px;border-radius:8px;overflow:auto;">${errMsg}</pre>
        <p>请按 F12 打开开发者工具查看详细错误。</p>
      </body></html>`);
    mainWindow.webContents.openDevTools();
  }
});

app.on('window-all-closed', () => {
  // Express 运行在同进程内，进程退出时会自动释放
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
