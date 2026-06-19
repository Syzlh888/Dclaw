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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
    const backupData = {
      version: '1.0',
      timestamp: new Date().toISOString(),
      appVersion: '1.0.0',
      dataFiles,
    };

    // Gzip 压缩后写入磁盘
    const jsonStr = JSON.stringify(backupData);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf8'));
    fs.writeFileSync(filePath, compressed);

    const stat = fs.statSync(filePath);

    // 清理旧备份（保留最近 N 个）
    cleanupOldBackups(backupDir, config.maxBackupCount);

    console.log(`💾 数据备份完成: ${fileName} (${(stat.size / 1024).toFixed(1)} KB)`);
    res.json({
      success: true,
      fileName,
      filePath,
      size: stat.size,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('备份失败:', err.message);
    res.status(500).json({ error: '备份失败: ' + err.message });
  }
});

/**
 * GET /api/backup/list
 * 列出所有备份文件
 */
router.get('/list', (_req, res) => {
  try {
    const config = loadConfig();
    const backupDir = getBackupDir(config);

    if (!fs.existsSync(backupDir)) {
      return res.json([]);
    }

    const entries = fs.readdirSync(backupDir);
    const backups = entries
      .filter(f => f.endsWith('.dclaw'))
      .map(f => {
        const fp = path.join(backupDir, f);
        const stat = fs.statSync(fp);
        return {
          fileName: f,
          filePath: fp,
          size: stat.size,
          createdAt: stat.birthtime || stat.mtime,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
    const rollbackBackup = { version: '1.0', timestamp: new Date().toISOString(), appVersion: '1.0.0', dataFiles: currentData };
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

    console.log(`🔄 数据已从备份还原，共恢复 ${restoredCount} 个数据文件。回滚备份: ${rollbackFile}`);

    res.json({
      success: true,
      restoredCount,
      rollbackFile,
      timestamp: backupData.timestamp,
      message: `成功还原 ${restoredCount} 个数据文件。如果结果不符合预期，可使用回滚备份 ${path.basename(rollbackFile)} 恢复。`,
    });
  } catch (err) {
    console.error('还原失败:', err.message);
    res.status(500).json({ error: '还原失败: ' + err.message });
  }
});

/**
 * DELETE /api/backup/:fileName
 * 删除指定备份文件（需 URL 编码文件名）
 */
router.delete('/:fileName', (req, res) => {
  try {
    const config = loadConfig();
    const backupDir = getBackupDir(config);
    const fileName = decodeURIComponent(req.params.fileName);

    // 安全检查：防止路径穿越
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({ error: '无效的文件名' });
    }

    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: '删除失败: ' + err.message });
  }
});

/**
 * GET /api/backup/download/:fileName
 * 下载备份文件
 */
router.get('/download/:fileName', (req, res) => {
  try {
    const config = loadConfig();
    const backupDir = getBackupDir(config);
    const fileName = decodeURIComponent(req.params.fileName);

    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return res.status(400).json({ error: '无效的文件名' });
    }

    const filePath = path.join(backupDir, fileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: '备份文件不存在' });
    }

    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
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

    const backupData = { version: '1.0', timestamp: new Date().toISOString(), appVersion: '1.0.0', dataFiles };
    const compressed = zlib.gzipSync(Buffer.from(JSON.stringify(backupData), 'utf8'));
    fs.writeFileSync(filePath, compressed);

    const stat = fs.statSync(filePath);
    console.log(`📦 自动备份完成: ${fileName} (${(stat.size / 1024).toFixed(1)} KB)`);

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
