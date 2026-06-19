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
import { fileURLToPath } from 'node:url';
import { nanoid } from 'nanoid';
import { getAll, getById, insert, update, remove } from '../database.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
router.get('/', (_req, res) => {
  const drivers = getAll('drivers');
  res.json(drivers);
});

/**
 * GET /api/drivers/:id
 * 获取单个驱动详情
 */
router.get('/:id', (req, res) => {
  const driver = getById('drivers', req.params.id);
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
router.post('/', upload.single('driverFile'), (req, res) => {
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

  insert('drivers', driver);
  res.status(201).json(driver);
});

/**
 * PUT /api/drivers/:id
 * 更新自定义驱动（内置驱动不可编辑）
 * 注意：编辑时不可更换文件，如需更换请删除后重新创建
 */
router.put('/:id', (req, res) => {
  const driver = getById('drivers', req.params.id);
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

  const updated = update('drivers', req.params.id, updates);
  res.json(updated);
});

/**
 * DELETE /api/drivers/:id
 * 删除自定义驱动（内置驱动不可删除）
 * 同时删除磁盘上的 JAR 文件
 */
router.delete('/:id', (req, res) => {
  const driver = getById('drivers', req.params.id);
  if (!driver) return res.status(404).json({ error: '驱动不存在' });

  if (driver.isBuiltIn) {
    return res.status(403).json({ error: '内置驱动不可删除' });
  }

  // 删除磁盘上的 JAR 文件
  const driverDir = path.join(driversStorageDir, req.params.id);
  if (fs.existsSync(driverDir)) {
    fs.rmSync(driverDir, { recursive: true, force: true });
  }

  remove('drivers', req.params.id);
  res.json({ success: true });
});

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

export default router;
