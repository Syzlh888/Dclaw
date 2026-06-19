/**
 * 执行历史记录 API
 */
import { Router } from 'express';
import { getAll, removeWhere, remove } from '../database.mjs';

const router = Router();

// ===== 自动清理配置（内存中维护） =====
let cleanupConfig = {
  enabled: false,          // 默认关闭，用户需手动开启
  retentionDays: parseInt(process.env.HISTORY_RETENTION_DAYS, 10) || 7,
};

export function getCleanupConfig() {
  return { ...cleanupConfig };
}

export function isCleanupEnabled() {
  return cleanupConfig.enabled;
}

/**
 * GET /api/history
 * 获取执行历史列表（按时间倒序，最近 100 条）
 */
router.get('/', (_req, res) => {
  const history = getAll('executionHistory')
    .sort((a, b) => new Date(b.executed_at) - new Date(a.executed_at))
    .slice(0, 100);

  res.json({ history });
});

/**
 * GET /api/history/:id
 * 获取单次执行详情（含每个执行任务结果）
 */
router.get('/:id', (req, res) => {
  const history = getAll('executionHistory').find((h) => h.id === req.params.id);
  if (!history) {
    return res.status(404).json({ error: '记录不存在' });
  }

  // 查找关联的执行任务记录
  const tasks = getAll('executionTasks').filter((t) => t.execution_id === req.params.id);

  res.json({ history, tasks });
});

/**
 * GET /api/history/cleanup-config
 * 获取自动清理配置
 */
router.get('/cleanup-config', (_req, res) => {
  res.json(cleanupConfig);
});

/**
 * PUT /api/history/cleanup-config
 * 更新自动清理配置（目前仅支持 enabled 字段）
 */
router.put('/cleanup-config', (req, res) => {
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled 必须为布尔值' });
  }
  cleanupConfig.enabled = enabled;
  console.log(`🔧 自动清理已${enabled ? '启用' : '停用'}（保留 ${cleanupConfig.retentionDays} 天）`);
  res.json(cleanupConfig);
});

/**
 * DELETE /api/history/batch
 * 批量删除多条执行历史记录
 */
router.delete('/batch', (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: '请提供要删除的记录 ID 列表' });
  }

  const idSet = new Set(ids);
  let deletedCount = 0;
  for (const id of idSet) {
    if (remove('executionHistory', id)) {
      deletedCount++;
      removeWhere('executionTasks', (t) => t.execution_id === id);
    }
  }
  res.json({ success: true, deletedCount });
});

/**
 * DELETE /api/history/:id
 * 删除单条执行历史记录
 */
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const success = remove('executionHistory', id);
  if (success) {
    removeWhere('executionTasks', (t) => t.execution_id === id);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: '记录不存在' });
  }
});

/**
 * DELETE /api/history
 * 清空所有执行历史
 */
router.delete('/', (_req, res) => {
  const count = removeWhere('executionHistory', () => true);
  removeWhere('executionTasks', () => true);
  res.json({ success: true, deletedCount: count });
});

/**
 * 自动清理过期历史记录
 * @param {number} retentionDays 保留天数，默认 7 天
 * @returns {number} 清理的记录数
 */
export function autoCleanup(retentionDays = 7) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

  // 找出过期的历史记录 ID
  const expiredIds = new Set();
  const expired = getAll('executionHistory').filter((h) => h.executed_at < cutoff);
  for (const h of expired) {
    expiredIds.add(h.id);
  }

  if (expiredIds.size === 0) return 0;

  // 删除过期历史记录及其关联任务
  const historyCount = removeWhere('executionHistory', (h) => expiredIds.has(h.id));
  const taskCount = removeWhere('executionTasks', (t) => expiredIds.has(t.execution_id));

  console.log(`🧹 自动清理执行历史：${historyCount} 条记录，${taskCount} 条任务明细`);
  return historyCount;
}

export default router;
