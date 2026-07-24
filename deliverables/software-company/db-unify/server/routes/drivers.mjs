/**
 * 数据库驱动管理 API
 * 支持内置驱动（只读）和自定义驱动（增删 + 文件上传）
 * 
 * 上传的 JAR 文件存储在: data/drivers/{driverId}/{filename}
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove } from '../database.mjs';

const __dirname = path.dirname(
  typeof import.meta !== 'undefined' && import.meta.url
    ? fileURLToPath(import.meta.url)
    : __filename
);
// database.mjs 定义 DATA_DIR 为 server/../data，此处与其保持一致
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');

const router = Router();

// ========= Multer 配置 =========
const driversStorageDir = path.join(DATA_DIR, 'drivers');

// 确保 drivers 存储目录存在
if (!fs.existsSync(driversStorageDir)) {
  fs.mkdirSync(driversStorageDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    // 使用临时 driverId 作为目录名
    const tmpId = req.body._tmpId || nanoid(8);
    const dir = path.join(driversStorageDir, tmpId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    // 保留原始文件名（安全处理：移除路径分隔符）
    const safeName = file.originalname.replace(/[/\\:]/g, '_');
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.jar', '.zip', '.gz', '.tar'].includes(ext) ||
        file.originalname.toLowerCase().endsWith('.tar.gz')) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 .jar / .zip / .tar.gz 文件'));
    }
  },
});

/**
 * GET /api/drivers
 * 获取所有驱动列表
 */
router.get('/', async (_req, res) => {
  const drivers = await getAll('drivers');
  res.json(drivers);
});

/**
 * GET /api/drivers/:id
 * 获取单个驱动详情
 */
router.get('/:id', async (req, res) => {
  const driver = await getById('drivers', req.params.id);
  if (!driver) return res.status(404).json({ error: '驱动不存在' });
  res.json(driver);
});

/**
 * POST /api/drivers
 * 创建自定义驱动（支持文件上传）
 * Content-Type: multipart/form-data
 * 字段: name, version, driverClass, dbType, description
 * 文件: driverFile (.jar / .zip / .tar.gz)
 */
router.post('/', upload.single('driverFile'), async (req, res) => {
  const { name, version, driverClass, dbType, description } = req.body;
  const uploadedFile = req.file;

  if (!name || !version || !driverClass) {
    // 清理已上传的文件
    if (uploadedFile) cleanupTempDir(uploadedFile.path);
    return res.status(400).json({ error: '数据库类型、版本号、驱动类名为必填项' });
  }

  if (!uploadedFile) {
    return res.status(400).json({ error: '请上传驱动文件（.jar / .zip / .tar.gz）' });
  }

  const driverId = nanoid(8);
  const driverDir = path.join(driversStorageDir, driverId);

  // 将文件从临时目录移到正式目录
  try {
    if (!fs.existsSync(driverDir)) {
      fs.mkdirSync(driverDir, { recursive: true });
    }
    const targetPath = path.join(driverDir, uploadedFile.originalname);
    fs.renameSync(uploadedFile.path, targetPath);

    // 如果临时目录与正式目录不同，清理空临时目录
    const tmpDir = path.dirname(uploadedFile.path);
    if (tmpDir !== driverDir) {
      try { fs.rmdirSync(tmpDir); } catch {}
    }
  } catch (err) {
    console.error('驱动文件移动失败:', err);
    return res.status(500).json({ error: '驱动文件保存失败' });
  }

  const driver = {
    id: driverId,
    name: String(name).trim(),
    version: String(version).trim(),
    driverClass: String(driverClass).trim(),
    fileName: uploadedFile.originalname,
    fileSize: uploadedFile.size,
    dbType: String(dbType || name).trim(),
    description: description ? String(description).trim() : undefined,
    isBuiltIn: false,
    uploadTime: new Date().toISOString(),
  };

  await insert('drivers', driver);
  res.status(201).json(driver);
});

/**
 * PUT /api/drivers/:id
 * 更新自定义驱动（内置驱动不可编辑）
 * 注意：编辑时不可更换文件，如需更换请删除后重新创建
 */
router.put('/:id', async (req, res) => {
  const driver = await getById('drivers', req.params.id);
  if (!driver) return res.status(404).json({ error: '驱动不存在' });
  if (driver.isBuiltIn) {
    return res.status(403).json({ error: '内置驱动不可编辑' });
  }

  const { name, version, driverClass, description } = req.body;
  const updates = {};
  if (name !== undefined) updates.name = String(name).trim();
  if (version !== undefined) updates.version = String(version).trim();
  if (driverClass !== undefined) updates.driverClass = String(driverClass).trim();
  if (description !== undefined) {
    updates.description = description ? String(description).trim() : undefined;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: '无有效更新字段' });
  }

  const updated = await update('drivers', req.params.id, updates);
  res.json(updated);
});

/**
 * POST /api/drivers/:id/uninstall
 * 卸载驱动（移除已下载的 JAR 文件）
 * - 内置驱动：删除 JAR 文件，保留驱动记录，标记 downloaded=false
 * - 自定义驱动：同删除操作
 */
router.post('/:id/uninstall', async (req, res) => {
  const driver = await getById('drivers', req.params.id);
  if (!driver) return res.status(404).json({ error: '驱动不存在' });

  const driverDir = path.join(driversStorageDir, req.params.id);

  if (driver.isBuiltIn) {
    // 内置驱动：删除 JAR 文件，保留驱动记录
    if (fs.existsSync(driverDir)) {
      fs.rmSync(driverDir, { recursive: true, force: true });
    }
    const updated = await update('drivers', req.params.id, {
      fileSize: 0,
      downloaded: false,
    });
    return res.json({ success: true, driver: updated, message: `"${driver.name}" 驱动已卸载` });
  } else {
    // 自定义驱动：同删除操作
    if (fs.existsSync(driverDir)) {
      fs.rmSync(driverDir, { recursive: true, force: true });
    }
    await remove('drivers', req.params.id);
    return res.json({ success: true, message: `"${driver.name}" 驱动已删除` });
  }
});

/**
 * DELETE /api/drivers/:id
 * 删除驱动（自定义驱动彻底删除，内置驱动仅移除 JAR 文件）
 */
router.delete('/:id', async (req, res) => {
  const driver = await getById('drivers', req.params.id);
  if (!driver) return res.status(404).json({ error: '驱动不存在' });

  const driverDir = path.join(driversStorageDir, req.params.id);

  if (driver.isBuiltIn) {
    // 内置驱动：允许删除已下载的 JAR 文件，但保留驱动记录
    if (fs.existsSync(driverDir)) {
      fs.rmSync(driverDir, { recursive: true, force: true });
    }
    const updated = await update('drivers', req.params.id, {
      fileSize: 0,
      downloaded: false,
    });
    return res.json({ success: true, driver: updated, message: `"${driver.name}" 驱动 JAR 文件已移除` });
  }

  // 自定义驱动：彻底删除
  if (fs.existsSync(driverDir)) {
    fs.rmSync(driverDir, { recursive: true, force: true });
  }

  await remove('drivers', req.params.id);
  res.json({ success: true });
});

/**
 * POST /api/drivers/download
 * 在线下载内置驱动 JAR 文件（带国内镜像自动切换）
 * 请求体: { driverId: string }
 */
router.post('/download', async (req, res) => {
  const { driverId } = req.body;
  if (!driverId) {
    return res.status(400).json({ error: '请提供驱动 ID' });
  }

  const driver = await getById('drivers', driverId);
  if (!driver) {
    return res.status(404).json({ error: '驱动不存在' });
  }

  if (!driver.isBuiltIn) {
    return res.status(400).json({ error: '仅支持内置驱动的在线下载' });
  }

  if (!driver.downloadUrl) {
    return res.status(400).json({ error: `"${driver.name}" 没有在线下载地址，请手动下载后上传` });
  }

  const driverDir = path.join(driversStorageDir, driverId);
  if (!fs.existsSync(driverDir)) {
    fs.mkdirSync(driverDir, { recursive: true });
  }

  const filePath = path.join(driverDir, driver.fileName);

  // 使用国内镜像加速（阿里云 Maven 镜像）
  // 将 Maven Central URL 替换为阿里云镜像
  const aliMirror = driver.downloadUrl.replace(
    'https://repo1.maven.org/maven2',
    'https://maven.aliyun.com/repository/public'
  );
  const downloadUrls = [aliMirror, driver.downloadUrl]; // 先试镜像，再试官方

  let lastError = null;
  for (const url of downloadUrls) {
    try {
      await downloadFile(url, filePath, 90000); // 90s 超时
      const stats = fs.statSync(filePath);
      if (stats.size > 0) {
        await update('drivers', driverId, {
          fileSize: stats.size,
          downloaded: true,
        });
        return res.json({
          success: true,
          fileSize: stats.size,
          message: `"${driver.name}" 驱动下载完成（${(stats.size / 1024 / 1024).toFixed(1)} MB）`,
        });
      }
    } catch (err) {
      lastError = err;
      // 清理失败文件
      try { fs.rmSync(filePath, { force: true }); } catch {}
      console.warn(`驱动下载尝试失败 [${url}]:`, err.message);
    }
  }

  console.error(`驱动下载失败 [${driverId}]:`, lastError?.message);
  res.status(502).json({
    error: `驱动下载失败: ${lastError?.message || '连接超时'}`,
    detail: '已尝试阿里云镜像和 Maven 官方源，均无法下载。请手动下载 JAR 后通过"上传驱动"功能添加。',
  });
});

/**
 * 下载文件并保存到本地
 */
function downloadFile(url, destPath, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? https : http;
    const fileStream = fs.createWriteStream(destPath);
    let aborted = false;

    const request = protocol.get(url, (response) => {
      // 处理重定向
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        fileStream.close();
        return resolve(downloadFile(response.headers.location, destPath, timeout));
      }

      if (response.statusCode !== 200) {
        fileStream.close();
        try { fs.rmSync(destPath, { force: true }); } catch {}
        return reject(new Error(`服务器返回状态码 ${response.statusCode}`));
      }

      response.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        if (!aborted) resolve();
      });
    });

    request.on('error', (err) => {
      fileStream.close();
      try { fs.rmSync(destPath, { force: true }); } catch {}
      reject(err);
    });

    request.setTimeout(timeout, () => {
      aborted = true;
      request.destroy();
      fileStream.close();
      try { fs.rmSync(destPath, { force: true }); } catch {}
      reject(new Error('下载超时'));
    });
  });
}

/**
 * 清理上传失败的临时目录
 */
function cleanupTempDir(filePath) {
  try {
    const dir = path.dirname(filePath);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch {}
}

/**
 * POST /api/drivers/:id/upload-jar
 * 为内置驱动手动上传 JAR 文件（用于下载失败的场景）
 * Content-Type: multipart/form-data
 */
router.post('/:id/upload-jar', upload.single('driverFile'), async (req, res) => {
  const driverId = req.params.id;
  const uploadedFile = req.file;

  const driver = await getById('drivers', driverId);
  if (!driver) {
    if (uploadedFile) cleanupTempDir(uploadedFile.path);
    return res.status(404).json({ error: '驱动不存在' });
  }

  if (!uploadedFile) {
    return res.status(400).json({ error: '请选择驱动 JAR 文件' });
  }

  const { name, version, driverClass } = req.body;

  const driverDir = path.join(driversStorageDir, driverId);
  if (!fs.existsSync(driverDir)) {
    fs.mkdirSync(driverDir, { recursive: true });
  }

  try {
    const targetPath = path.join(driverDir, uploadedFile.originalname);
    // 清理旧文件
    if (driver.fileName) {
      const oldPath = path.join(driverDir, driver.fileName);
      try { fs.rmSync(oldPath, { force: true }); } catch {}
    }
    fs.renameSync(uploadedFile.path, targetPath);

    // 清理空临时目录
    const tmpDir = path.dirname(uploadedFile.path);
    if (tmpDir !== driverDir) {
      try { fs.rmdirSync(tmpDir); } catch {}
    }

    const updates = {
      fileName: uploadedFile.originalname,
      fileSize: uploadedFile.size,
      downloaded: true,
    };
    if (name) updates.name = String(name).trim();
    if (version) updates.version = String(version).trim();
    if (driverClass) updates.driverClass = String(driverClass).trim();

    await update('drivers', driverId, updates);

    res.json({
      fileName: uploadedFile.originalname,
      fileSize: uploadedFile.size,
      message: `"${updates.name || driver.name}" 驱动 JAR 上传完成（${(uploadedFile.size / 1024 / 1024).toFixed(1)} MB）`,
    });
  } catch (err) {
    console.error('上传内置驱动 JAR 失败:', err);
    if (uploadedFile) cleanupTempDir(uploadedFile.path);
    res.status(500).json({ error: '上传驱动文件失败' });
  }
});

export default router;
