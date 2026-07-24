/**
 * 系统数据备份与还原 API
 *
 * 备份内容：data/ 目录下全部 JSON 数据文件
 * 不包含：授权文件（license.dat / trial.dat，存储在 %APPDATA%/db-unify/）
 *         还原时不影响激活状态和剩余时长
 */
import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(
  typeof import.meta !== 'undefined' && import.meta.url
    ? fileURLToPath(import.meta.url)
    : __filename
);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

/** 备份配置存储路径（与 data 目录同级） */
const BACKUP_CONFIG_FILE = path.join(path.dirname(DATA_DIR), 'backup_config.json');

const router = Router();

// ===== 默认配置 =====
const DEFAULT_CONFIG = {
  autoBackupEnabled: false,       // 是否启用自动备份
  backupIntervalHours: 24,        // 自动备份间隔（小时）
  backupPath: '',                 // 备份保存路径（为空则默认 data/../backups/）
  maxBackupCount: 10,             // 保留最近 N 个备份
  lastManualBackupPath: '',       // 上次手动备份的自定义路径，用于还原列表
};

/** 读取备份配置 */
function loadConfig() {
  try {
    if (fs.existsSync(BACKUP_CONFIG_FILE)) {
      const data = JSON.parse(fs.readFileSync(BACKUP_CONFIG_FILE, 'utf8'));
      return { ...DEFAULT_CONFIG, ...data };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG };
}

/** 保存备份配置 */
function saveConfig(config) {
  try {
    const dir = path.dirname(BACKUP_CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = BACKUP_CONFIG_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2), 'utf8');
    fs.renameSync(tmp, BACKUP_CONFIG_FILE);
  } catch { /* ignore */ }
}

/** 获取实际备份目录 */
function getBackupDir(config) {
  const cfg = config || loadConfig();
  return cfg.backupPath || path.join(path.dirname(DATA_DIR), 'backups');
}

/** 驱动文件存储目录 */
const DRIVERS_DIR = path.join(DATA_DIR, 'drivers');

/** 加密密钥文件路径（Electron userData 下）
 *  ensureEncryptionKey() 把它写到 app.getPath('userData') 下的 .encryption-key
 *  这里通过 DATA_DIR 的父目录反推（DATA_DIR = <userData>/data）
 */
const ENCRYPTION_KEY_FILE = path.join(path.dirname(DATA_DIR), '.encryption-key');

/**
 * 读取本机加密密钥（用于跨机还原时随备份一起打包）
 * 返回 hex 字符串 或 null
 */
function collectEncryptionKey() {
  try {
    if (fs.existsSync(ENCRYPTION_KEY_FILE)) {
      const key = fs.readFileSync(ENCRYPTION_KEY_FILE, 'utf8').trim();
      if (key.length === 64) return key;
    }
  } catch (e) {
    console.warn('[backup] 读取加密密钥失败:', e.message);
  }
  return null;
}

/**
 * 还原备份中的加密密钥。返回是否替换了本机密钥
 * 注意：替换后必须重启进程，crypto.mjs 模块级常量才会重新读取
 */
function restoreEncryptionKey(keyHex) {
  if (!keyHex || typeof keyHex !== 'string' || keyHex.length !== 64) return false;
  try {
    // 先备份现有 key，防止意外
    if (fs.existsSync(ENCRYPTION_KEY_FILE)) {
      const oldKey = fs.readFileSync(ENCRYPTION_KEY_FILE, 'utf8').trim();
      if (oldKey === keyHex) return false; // 同 key，无需替换
      fs.writeFileSync(ENCRYPTION_KEY_FILE + '.pre-restore-' + Date.now(), oldKey, { mode: 0o600 });
    }
    fs.writeFileSync(ENCRYPTION_KEY_FILE, keyHex, { mode: 0o600 });
    console.log('[backup] 加密密钥已还原（重启后生效）');
    return true;
  } catch (e) {
    console.error('[backup] 还原加密密钥失败:', e.message);
    return false;
  }
}

/**
 * 收集 drivers/ 目录下所有二进制驱动文件（jar/zip/tar.gz 等）
 * 返回结构: { "driverId/filename.jar": base64string, ... }
 */
function collectDriverFiles() {
  const out = {};
  if (!fs.existsSync(DRIVERS_DIR)) return out;
  try {
    const driverDirs = fs.readdirSync(DRIVERS_DIR, { withFileTypes: true });
    for (const dir of driverDirs) {
      if (!dir.isDirectory()) continue;
      const subDir = path.join(DRIVERS_DIR, dir.name);
      const files = fs.readdirSync(subDir);
      for (const f of files) {
        const fp = path.join(subDir, f);
        if (!fs.statSync(fp).isFile()) continue;
        const buf = fs.readFileSync(fp);
        // key 用相对路径，跨平台统一 /
        out[`${dir.name}/${f}`] = buf.toString('base64');
      }
    }
  } catch (e) {
    console.warn('[backup] 收集驱动文件失败:', e.message);
  }
  return out;
}

/**
 * 将备份中的驱动文件写回 drivers/ 目录
 * 返回恢复文件数
 */
function restoreDriverFiles(driverFiles) {
  if (!driverFiles || typeof driverFiles !== 'object') return 0;
  if (!fs.existsSync(DRIVERS_DIR)) fs.mkdirSync(DRIVERS_DIR, { recursive: true });
  let n = 0;
  for (const [relPath, b64] of Object.entries(driverFiles)) {
    try {
      // 安全检查：禁止路径穿越
      if (relPath.includes('..') || path.isAbsolute(relPath)) continue;
      const target = path.join(DRIVERS_DIR, relPath);
      const targetDir = path.dirname(target);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
      const buf = Buffer.from(b64, 'base64');
      const tmp = target + '.tmp';
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, target);
      n++;
    } catch (e) {
      console.warn(`[restore] 恢复驱动文件失败 ${relPath}:`, e.message);
    }
  }
  return n;
}

// ===== API 路由 =====

/**
 * GET /api/backup/config
 * 获取备份配置
 */
router.get('/config', (_req, res) => {
  const config = loadConfig();
  res.json(config);
});

/**
 * PUT /api/backup/config
 * 更新备份配置
 */
router.put('/config', (req, res) => {
  const body = req.body || {};
  const current = loadConfig();

  const updated = {
    ...current,
    autoBackupEnabled: typeof body.autoBackupEnabled === 'boolean' ? body.autoBackupEnabled : current.autoBackupEnabled,
    backupIntervalHours: typeof body.backupIntervalHours === 'number' ? body.backupIntervalHours : current.backupIntervalHours,
    backupPath: typeof body.backupPath === 'string' ? body.backupPath : current.backupPath,
    maxBackupCount: typeof body.maxBackupCount === 'number' ? body.maxBackupCount : current.maxBackupCount,
    lastManualBackupPath: typeof body.lastManualBackupPath === 'string' ? body.lastManualBackupPath : current.lastManualBackupPath,
  };

  saveConfig(updated);
  res.json(updated);
});

/**
 * POST /api/backup/now
 * 立即执行一次手动备份
 * Body（可选）: { customPath?: string }  指定自定义保存目录
 * @returns { filePath, fileName, size, timestamp }
 */
router.post('/now', async (req, res) => {
  try {
    const config = loadConfig();
    const customPath = (req.body && req.body.customPath) || '';
    const backupDir = customPath || getBackupDir(config);

    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const fileName = `dclaw-backup-${timestamp}.dclaw`;
    const filePath = path.join(backupDir, fileName);

    // 收集所有数据文件
    const dataFiles = {};
    if (fs.existsSync(DATA_DIR)) {
      const entries = fs.readdirSync(DATA_DIR);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const content = fs.readFileSync(path.join(DATA_DIR, entry), 'utf8');
          dataFiles[entry] = JSON.parse(content);
        }
      }
    }

    // 构建备份结构：包含元数据和所有数据文件
    const driverFiles = collectDriverFiles();
    const encryptionKey = collectEncryptionKey();
    const backupData = {
      version: '1.2',
      timestamp: new Date().toISOString(),
      appVersion: '1.0.0',
      dataFiles,
      driverFiles, // { "driverId/filename.jar": base64 }
      encryptionKey, // hex string 或 null（跨机还原时用于解密数据库密码）
    };

    // Gzip 压缩后写入磁盘
    const jsonStr = JSON.stringify(backupData);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));
    fs.writeFileSync(filePath, compressed);

    const stat = fs.statSync(filePath);

    // 记住手动备份的自定义路径，以便还原列表能扫描到
    if (customPath) {
      saveConfig({ ...config, lastManualBackupPath: customPath });
    }

    // 清理旧备份（保留最近 N 个）
    cleanupOldBackups(backupDir, config.maxBackupCount);

    console.log(`💾 数据备份完成: ${fileName} (${(stat.size / 1024).toFixed(1)} KB) 数据文件=${Object.keys(dataFiles).length} 驱动文件=${Object.keys(driverFiles).length}`);
    res.json({
      success: true,
      fileName,
      filePath,
      size: stat.size,
      timestamp: new Date().toISOString(),
      dataFileCount: Object.keys(dataFiles).length,
      driverFileCount: Object.keys(driverFiles).length,
    });
  } catch (err) {
    console.error('备份失败:', err.message);
    res.status(500).json({ error: '备份失败: ' + err.message });
  }
});

/**
 * 列出所有备份文件（扫描自动备份目录、手动备份目录、默认目录以及各盘符根目录）
 */
router.get('/list', (_req, res) => {
  try {
    const config = loadConfig();
    const autoBackupDir = getBackupDir(config);

    // 扫描多个目录：自动备份路径、手动备份自定义路径、默认备份路径
    const dirsToScan = new Set([autoBackupDir]);
    if (config.backupPath) dirsToScan.add(path.resolve(config.backupPath));
    if (config.lastManualBackupPath) dirsToScan.add(path.resolve(config.lastManualBackupPath));

    // 兼容旧版本：手动备份路径未记录时，也扫描各盘符根目录，找回已存在的 .dclaw 文件
    if (process.platform === 'win32') {
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const p = `${letter}:\\`;
        if (fs.existsSync(p)) dirsToScan.add(p);
      }
    } else {
      dirsToScan.add('/');
    }

    const seen = new Set();
    const backups = [];

    for (const backupDir of dirsToScan) {
      if (!fs.existsSync(backupDir)) continue;

      const entries = fs.readdirSync(backupDir);
      for (const f of entries) {
        if (!f.endsWith('.dclaw')) continue;
        // 按文件名去重，避免同一文件在不同路径出现多次
        if (seen.has(f)) continue;
        seen.add(f);
        const fp = path.join(backupDir, f);
        const stat = fs.statSync(fp);
        backups.push({
          fileName: f,
          filePath: fp,
          size: stat.size,
          createdAt: stat.birthtime || stat.mtime,
        });
      }
    }

    backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json(backups);
  } catch (err) {
    res.status(500).json({ error: '列出备份失败: ' + err.message });
  }
});

/**
 * POST /api/backup/restore
 * 从备份文件还原数据
 * Body: { filePath: string } - 备份文件的完整路径
 *
 * 注意：还原操作会覆盖当前 data/ 目录下的所有 JSON 文件
 * 但不会影响授权/激活状态
 */
router.post('/restore', async (req, res) => {
  const { filePath } = req.body || {};
  if (!filePath) {
    return res.status(400).json({ error: '请指定备份文件路径' });
  }

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: '备份文件不存在: ' + filePath });
  }

  if (!filePath.endsWith('.dclaw')) {
    return res.status(400).json({ error: '无效的备份文件格式（需要 .dclaw 文件）' });
  }

  try {
    // 读取并解压备份文件
    const compressed = fs.readFileSync(filePath);
    const jsonStr = zlib.gunzipSync(compressed).toString('utf8');
    const backupData = JSON.parse(jsonStr);

    if (!backupData.dataFiles || typeof backupData.dataFiles !== 'object') {
      return res.status(400).json({ error: '备份文件格式无效' });
    }

    // 先对当前数据做一次备份（安全回滚）
    const config = loadConfig();
    const backupDir = getBackupDir(config);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const rollbackTimestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const rollbackFile = path.join(backupDir, `dclaw-rollback-${rollbackTimestamp}.dclaw`);

    const currentData = {};
    if (fs.existsSync(DATA_DIR)) {
      const entries = fs.readdirSync(DATA_DIR);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const content = fs.readFileSync(path.join(DATA_DIR, entry), 'utf8');
          currentData[entry] = JSON.parse(content);
        }
      }
    }
    const rollbackBackup = {
      version: '1.2',
      timestamp: new Date().toISOString(),
      appVersion: '1.0.0',
      dataFiles: currentData,
      driverFiles: collectDriverFiles(),
      encryptionKey: collectEncryptionKey(),
    };
    const rollbackCompressed = zlib.gzipSync(Buffer.from(JSON.stringify(rollbackBackup), 'utf8'));
    fs.writeFileSync(rollbackFile, rollbackCompressed);

    // 将备份数据写入 data/ 目录
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    let restoredCount = 0;
    for (const [fileName, data] of Object.entries(backupData.dataFiles)) {
      if (!fileName.endsWith('.json')) continue;
      const targetPath = path.join(DATA_DIR, fileName);
      const tmpPath = targetPath + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(tmpPath, targetPath);
      restoredCount++;
    }

    // 恢复驱动 JAR 文件（版本 1.1+ 才有）
    const restoredDriverCount = restoreDriverFiles(backupData.driverFiles);

    // 恢复加密密钥（版本 1.2+ 才有）—— 用于跨机还原后能解密数据库密码
    const keyRestored = restoreEncryptionKey(backupData.encryptionKey);

    console.log(`🔄 数据已从备份还原，共恢复 ${restoredCount} 个数据文件、${restoredDriverCount} 个驱动文件${keyRestored ? '、加密密钥已同步' : ''}。回滚备份: ${rollbackFile}`);

    res.json({
      success: true,
      restoredCount,
      restoredDriverCount,
      encryptionKeyRestored: keyRestored,
      rollbackFile,
      timestamp: backupData.timestamp,
      message: `成功还原 ${restoredCount} 个数据文件${restoredDriverCount ? ` + ${restoredDriverCount} 个驱动文件` : ''}${keyRestored ? '，加密密钥已同步（请重启软件后连接密码才能解密）' : ''}。如果结果不符合预期，可使用回滚备份 ${path.basename(rollbackFile)} 恢复。`,
    });
  } catch (err) {
    console.error('还原失败:', err.message);
    res.status(500).json({ error: '还原失败: ' + err.message });
  }
});

/**
 * DELETE /api/backup/:fileName
 * 删除指定备份文件。
 * 优先从 query 或 body 里读 filePath（列表接口返回的完整路径），
 * 兼容旧行为：只给 fileName 则从默认 backupDir 找
 */
router.delete('/:fileName', (req, res) => {
  try {
    const config = loadConfig();
    const backupDir = getBackupDir(config);
    const fileName = decodeURIComponent(req.params.fileName);

    // 安全检查：文件名不允许路径穿越字符
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({ error: '无效的文件名' });
    }

    // 尝试多种路径来源：query filePath / body filePath / 默认 backupDir
    let filePath = req.query.filePath || (req.body && req.body.filePath) || '';
    if (filePath) filePath = decodeURIComponent(String(filePath));

    // 若外部传了 filePath，校验它确实指向一个 .dclaw 文件
    if (filePath) {
      const resolved = path.resolve(filePath);
      if (!resolved.endsWith('.dclaw') || path.basename(resolved) !== fileName) {
        return res.status(400).json({ error: 'filePath 与文件名不匹配' });
      }
      if (!fs.existsSync(resolved)) {
        return res.status(404).json({ error: `备份文件不存在: ${resolved}` });
      }
      fs.unlinkSync(resolved);
      return res.json({ success: true, deleted: resolved });
    }

    // 兜底：从 list 接口扫描的所有目录里找该文件
    const dirsToScan = new Set([backupDir]);
    if (config.backupPath) dirsToScan.add(path.resolve(config.backupPath));
    if (config.lastManualBackupPath) dirsToScan.add(path.resolve(config.lastManualBackupPath));
    for (const dir of dirsToScan) {
      const candidate = path.join(dir, fileName);
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
        return res.json({ success: true, deleted: candidate });
      }
    }
    return res.status(404).json({ error: '备份文件不存在（已扫描默认与自定义目录）' });
  } catch (err) {
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

/**
 * GET /api/backup/download/:fileName
 * 下载备份文件。同 delete，优先用 query filePath 定位真实路径
 */
router.get('/download/:fileName', (req, res) => {
  try {
    const config = loadConfig();
    const backupDir = getBackupDir(config);
    const fileName = decodeURIComponent(req.params.fileName);

    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({ error: '无效的文件名' });
    }

    let filePath = req.query.filePath ? decodeURIComponent(String(req.query.filePath)) : '';
    let resolved = '';
    if (filePath) {
      resolved = path.resolve(filePath);
      if (!resolved.endsWith('.dclaw') || path.basename(resolved) !== fileName) {
        return res.status(400).json({ error: 'filePath 与文件名不匹配' });
      }
    } else {
      // 兜底扫描
      const dirsToScan = new Set([backupDir]);
      if (config.backupPath) dirsToScan.add(path.resolve(config.backupPath));
      if (config.lastManualBackupPath) dirsToScan.add(path.resolve(config.lastManualBackupPath));
      for (const dir of dirsToScan) {
        const candidate = path.join(dir, fileName);
        if (fs.existsSync(candidate)) { resolved = candidate; break; }
      }
    }

    if (!resolved || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(resolved).pipe(res);
  } catch (err) {
    res.status(500).json({ error: '下载失败: ' + err.message });
  }
});

// ===== 自动备份函数（由 index.mjs 定时调用） =====

/**
 * GET /api/backup/browse
 * 浏览服务器目录结构，用于前端文件夹选择器
 * Query: ?dir=/path/to/dir（可选，默认 CWD）
 */
router.get('/browse', (req, res) => {
  try {
    const dir = req.query.dir || process.cwd();
    const resolved = path.resolve(dir);
    const parent = path.dirname(resolved);

    if (!fs.existsSync(resolved)) {
      return res.status(404).json({ error: '目录不存在' });
    }
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) {
      return res.status(400).json({ error: '不是目录' });
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const dirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(resolved, e.name) }));

    // 返回父目录（根目录时 parent === resolved）
    const parentDir = parent !== resolved ? parent : null;

    res.json({ current: resolved, parent: parentDir, dirs });
  } catch (err) {
    res.status(400).json({ error: '无法浏览目录: ' + err.message });
  }
});

/**
 * GET /api/backup/drives
 * Windows 下返回盘符列表，其他系统返回 "/"
 */
router.get('/drives', (_req, res) => {
  try {
    if (process.platform === 'win32') {
      // Windows: 枚举 A-Z 盘
      const drives = [];
      for (let i = 65; i <= 90; i++) {
        const letter = String.fromCharCode(i);
        const p = `${letter}:\\`;
        if (fs.existsSync(p)) {
          drives.push({ name: `${letter}:`, path: p });
        }
      }
      res.json({ type: 'drives', items: drives });
    } else {
      res.json({ type: 'root', items: [{ name: '/', path: '/' }] });
    }
  } catch (err) {
    res.status(500).json({ error: '获取盘符失败: ' + err.message });
  }
});

// ===== 自动备份函数（由 index.mjs 定时调用） =====

let autoBackupTimer = null;

/**
 * 启动自动备份定时器
 * 启动时读取配置，按配置的间隔执行
 */
export function startAutoBackup() {
  stopAutoBackup();
  const config = loadConfig();
  if (!config.autoBackupEnabled) {
    console.log('📦 自动备份未启用');
    return;
  }

  const intervalMs = (config.backupIntervalHours || 24) * 60 * 60 * 1000;
  console.log(`📦 自动备份已启用，间隔 ${config.backupIntervalHours || 24} 小时`);

  // 启动后延迟 2 分钟再执行第一次（避免与系统启动冲突）
  setTimeout(() => performAutoBackup(), 2 * 60 * 1000);

  autoBackupTimer = setInterval(() => performAutoBackup(), intervalMs);
}

export function stopAutoBackup() {
  if (autoBackupTimer) {
    clearInterval(autoBackupTimer);
    autoBackupTimer = null;
  }
}

async function performAutoBackup() {
  try {
    const config = loadConfig();
    const backupDir = getBackupDir(config);
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const fileName = `dclaw-auto-${timestamp}.dclaw`;
    const filePath = path.join(backupDir, fileName);

    const dataFiles = {};
    if (fs.existsSync(DATA_DIR)) {
      const entries = fs.readdirSync(DATA_DIR);
      for (const entry of entries) {
        if (entry.endsWith('.json')) {
          const content = fs.readFileSync(path.join(DATA_DIR, entry), 'utf8');
          dataFiles[entry] = JSON.parse(content);
        }
      }
    }

    const driverFiles = collectDriverFiles();
    const backupData = { version: '1.2', timestamp: new Date().toISOString(), appVersion: '1.0.0', dataFiles, driverFiles, encryptionKey: collectEncryptionKey() };
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(backupData), 'utf8'));
    fs.writeFileSync(filePath, compressed);

    const stat = fs.statSync(filePath);
    console.log(`📦 自动备份完成: ${fileName} (${(stat.size / 1024).toFixed(1)} KB) 数据=${Object.keys(dataFiles).length} 驱动=${Object.keys(driverFiles).length}`);

    cleanupOldBackups(backupDir, config.maxBackupCount);
  } catch (err) {
    console.error('自动备份失败:', err.message);
  }
}

function cleanupOldBackups(backupDir, maxCount) {
  try {
    if (!fs.existsSync(backupDir)) return;
    const entries = fs.readdirSync(backupDir)
      .filter(f => f.endsWith('.dclaw'))
      .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);

    while (entries.length > maxCount) {
      const old = entries.pop();
      fs.unlinkSync(old.path);
      console.log(`🗑️ 清理过期备份: ${old.name}`);
    }
  } catch { /* ignore */ }
}

export default router;
