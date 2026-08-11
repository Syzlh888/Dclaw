import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, List, ListItem, ListItemText, Chip,
  IconButton, Tooltip, Button, Alert,
  Snackbar, CircularProgress, Checkbox, FormControlLabel,
} from '@mui/material';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoDeleteIcon from '@mui/icons-material/AutoDelete';
import { fetchHistory, clearHistory, deleteHistory, deleteHistoryBatch, fetchCleanupConfig, updateCleanupConfig } from '../../services/historyService';
import { useEditorStore } from '../../stores/editorStore';
import type { ExecutionHistory } from '../../types/history';

const HistoryPanel: React.FC = () => {
  const [list, setList] = useState<ExecutionHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const setSql = useEditorStore((s) => s.setSql);
  const [cleanupEnabled, setCleanupEnabled] = useState(false);

  const RETENTION_DAYS = 7; // 历史保留天数

  const showMsg = (msg: string, severity: 'success' | 'error' = 'success') => {
    setSnackbar({ open: true, message: msg, severity });
  };

  // 加载自动清理配置
  useEffect(() => {
    fetchCleanupConfig()
      .then((cfg) => setCleanupEnabled(cfg.enabled))
      .catch(() => {}); // 静默失败
  }, []);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchHistory();
      setList(data);
    } catch (err: any) {
      showMsg(err.message || '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const handleDoubleClick = (sqlText: string) => {
    setSql(sqlText);
    showMsg('SQL 已导入编辑器');
  };

  // ===== 勾选逻辑 =====
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedIds.size === list.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(list.map((item) => item.id)));
    }
  };

  // ===== 删除逻辑 =====
  const handleDeleteOne = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteHistory(id);
      setList((prev) => prev.filter((item) => item.id !== id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      showMsg('已删除');
    } catch (err: any) {
      showMsg(err.message || '删除失败', 'error');
    }
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`确定删除选中的 ${ids.length} 条记录吗？`)) return;
    try {
      await deleteHistoryBatch(ids);
      setList((prev) => prev.filter((item) => !selectedIds.has(item.id)));
      setSelectedIds(new Set());
      showMsg(`已删除 ${ids.length} 条记录`);
    } catch (err: any) {
      showMsg(err.message || '批量删除失败', 'error');
    }
  };

  // ===== 删除逻辑 =====
  const handleClear = async () => {
    if (!window.confirm('确定清空全部执行历史吗？此操作不可撤销。')) return;
    try {
      await clearHistory();
      setList([]);
      showMsg('已清空全部执行历史');
    } catch (err: any) {
      showMsg(err.message || '清空失败', 'error');
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', {
      month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  };

  const truncateSql = (sql: string, maxLen = 80) => {
    const oneLine = sql.replace(/\s+/g, ' ').trim();
    return oneLine.length > maxLen ? oneLine.slice(0, maxLen) + '...' : oneLine;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 标题栏 */}
      <Box sx={{ px: 0.5, mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {list.length > 0 && (
              <Checkbox
                size="small"
                sx={{ p: 0.25 }}
                checked={selectedIds.size === list.length && list.length > 0}
                indeterminate={selectedIds.size > 0 && selectedIds.size < list.length}
                onChange={handleSelectAll}
              />
            )}
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              执行历史 {list.length > 0 && `(${list.length})`}
              {selectedIds.size > 0 && ` - 已选 ${selectedIds.size}`}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
            <FormControlLabel
              control={
                <Checkbox
                  size="small"
                  checked={cleanupEnabled}
                  onChange={async (e) => {
                    const enabled = e.target.checked;
                    setCleanupEnabled(enabled);
                    try {
                      await updateCleanupConfig(enabled);
                    } catch {
                      setCleanupEnabled(!enabled); // 回滚
                    }
                  }}
                  sx={{ py: 0, px: 0.5 }}
                />
              }
              label={
                <Typography variant="caption" sx={{ fontSize: 'calc(0.65rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
                  自动清理{RETENTION_DAYS}天前记录
                </Typography>
              }
              sx={{ mr: 0.5 }}
            />
            {selectedIds.size > 0 && (
              <Button
                size="small"
                color="error"
                variant="outlined"
                onClick={handleDeleteSelected}
                startIcon={<DeleteOutlineIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />}
                sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', py: 0.25, px: 1, minWidth: 'auto' }}
              >
                删除({selectedIds.size})
              </Button>
            )}
            <Tooltip title="刷新">
              <IconButton size="small" onClick={loadHistory} disabled={loading}>
                <RefreshIcon sx={{ fontSize: 'calc(1.125rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="清空全部历史">
              <IconButton size="small" onClick={handleClear} disabled={list.length === 0} color="error">
                <DeleteSweepIcon sx={{ fontSize: 'calc(1.125rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Box>

      {/* 列表 */}
      {loading ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={24} />
        </Box>
      ) : list.length === 0 ? (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled', fontSize: 'calc(0.9rem * var(--dc-scale, 1))' }}>
          暂无执行记录
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <List dense disablePadding>
            {list.map((item) => {
              const isSelected = selectedIds.has(item.id);
              return (
                <Box key={item.id}>
                  <ListItem
                    sx={{
                      cursor: 'pointer',
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:hover': { bgcolor: 'action.hover' },
                      py: 0.5,
                      px: 1,
                      bgcolor: isSelected ? 'action.selected' : 'transparent',
                    }}
                    onClick={() => handleDoubleClick(item.sql_text)}
                  >
                    <Checkbox
                      size="small"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleToggleSelect(item.id);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      sx={{ p: 0.25, mr: 0.5 }}
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 0.5 }}>
                    </Box>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: 'calc(0.78rem * var(--dc-scale, 1))' }}>
                          {truncateSql(item.sql_text)}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: 'calc(0.68rem * var(--dc-scale, 1))' }}>
                          {formatTime(item.executed_at)}
                        </Typography>
                      }
                      sx={{ my: 0 }}
                    />
                    <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0, ml: 1, alignItems: 'center' }}>
                      <Chip
                        label={`${item.success_count}/${item.connection_count}`}
                        size="small"
                        color={item.failed_count === 0 ? 'success' : 'warning'}
                        variant="outlined"
                        sx={{ fontSize: 'calc(0.65rem * var(--dc-scale, 1))', height: 18, '& .MuiChip-label': { px: 0.75 } }}
                      />
                      <Chip
                        label={formatDuration(item.duration_ms)}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: 'calc(0.65rem * var(--dc-scale, 1))', height: 18, '& .MuiChip-label': { px: 0.75 } }}
                      />
                      <Tooltip title="删除此记录">
                        <IconButton
                          size="small"
                          onClick={(e) => handleDeleteOne(item.id, e)}
                          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' }, p: 0.25 }}
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItem>
                </Box>
              );
            })}
          </List>
        </Box>
      )}

      {/* 提示 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }} onClose={() => setSnackbar((p) => ({ ...p, open: false }))}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default HistoryPanel;
