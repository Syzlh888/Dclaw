import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, List, ListItem, ListItemText, Chip,
  IconButton, Tooltip, Collapse, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Button, Alert,
  Snackbar, CircularProgress, Checkbox, FormControlLabel,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import TimerIcon from '@mui/icons-material/Timer';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoDeleteIcon from '@mui/icons-material/AutoDelete';
import { fetchHistory, fetchHistoryDetail, clearHistory, deleteHistory, deleteHistoryBatch, fetchCleanupConfig, updateCleanupConfig } from '../../services/historyService';
import { useEditorStore } from '../../stores/editorStore';
import type { ExecutionHistory, ExecutionHistoryDetail, ExecutionHistoryTask } from '../../types/history';

const HistoryPanel: React.FC = () => {
  const [list, setList] = useState<ExecutionHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailCache, setDetailCache] = useState<Record<string, ExecutionHistoryDetail>>({});
  const [detailLoading, setDetailLoading] = useState(false);
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
    e.stopPropagation(); // 阻止触发展开
    try {
      await deleteHistory(id);
      setList((prev) => prev.filter((item) => item.id !== id));
      setDetailCache((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      if (expandedId === id) setExpandedId(null);
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
      setDetailCache((prev) => {
        const next = { ...prev };
        ids.forEach((id) => delete next[id]);
        return next;
      });
      if (expandedId && selectedIds.has(expandedId)) setExpandedId(null);
      setSelectedIds(new Set());
      showMsg(`已删除 ${ids.length} 条记录`);
    } catch (err: any) {
      showMsg(err.message || '批量删除失败', 'error');
    }
  };

  const handleToggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    // 如果缓存中没有详情，则请求
    if (!detailCache[id]) {
      setDetailLoading(true);
      try {
        const detail = await fetchHistoryDetail(id);
        setDetailCache((prev) => ({ ...prev, [id]: detail }));
      } catch {
        // 忽略，可能没有明细
      } finally {
        setDetailLoading(false);
      }
    }
  };

  const handleClear = async () => {
    if (!window.confirm('确定清空全部执行历史吗？此操作不可撤销。')) return;
    try {
      await clearHistory();
      setList([]);
      setDetailCache({});
      setExpandedId(null);
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

  const getStatusIcon = (task: ExecutionHistoryTask) => {
    switch (task.status) {
      case 'success': return <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />;
      case 'failed': return <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />;
      case 'timeout': return <TimerIcon sx={{ fontSize: 16, color: 'warning.main' }} />;
      default: return <HourglassEmptyIcon sx={{ fontSize: 16, color: 'text.disabled' }} />;
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'success': return '成功';
      case 'failed': return '失败';
      case 'timeout': return '超时';
      case 'running': return '执行中';
      default: return '等待';
    }
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
                <Typography variant="caption" sx={{ fontSize: '0.65rem', color: 'text.secondary' }}>
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
                startIcon={<DeleteOutlineIcon sx={{ fontSize: 16 }} />}
                sx={{ fontSize: '0.7rem', py: 0.25, px: 1, minWidth: 'auto' }}
              >
                删除({selectedIds.size})
              </Button>
            )}
            <Tooltip title="刷新">
              <IconButton size="small" onClick={loadHistory} disabled={loading}>
                <RefreshIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="清空全部历史">
              <IconButton size="small" onClick={handleClear} disabled={list.length === 0} color="error">
                <DeleteSweepIcon sx={{ fontSize: 18 }} />
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
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled', fontSize: '0.9rem' }}>
          暂无执行记录
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          <List dense disablePadding>
            {list.map((item) => {
              const isExpanded = expandedId === item.id;
              const isSelected = selectedIds.has(item.id);
              const detail = detailCache[item.id];
              const isExpanding = isExpanded && detailLoading && !detail;
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
                    onClick={() => handleToggleExpand(item.id)}
                    onDoubleClick={() => handleDoubleClick(item.sql_text)}
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
                      {isExpanded ? (
                        <ExpandLessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      ) : (
                        <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                      )}
                    </Box>
                    <ListItemText
                      primary={
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.78rem' }}>
                          {truncateSql(item.sql_text)}
                        </Typography>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.68rem' }}>
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
                        sx={{ fontSize: '0.65rem', height: 18, '& .MuiChip-label': { px: 0.75 } }}
                      />
                      <Chip
                        label={formatDuration(item.duration_ms)}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 18, '& .MuiChip-label': { px: 0.75 } }}
                      />
                      <Tooltip title="删除此记录">
                        <IconButton
                          size="small"
                          onClick={(e) => handleDeleteOne(item.id, e)}
                          sx={{ color: 'text.disabled', '&:hover': { color: 'error.main' }, p: 0.25 }}
                        >
                          <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </ListItem>

                  {/* 展开的明细 */}
                  <Collapse in={isExpanded}>
                    <Box sx={{ px: 3, py: 1, bgcolor: 'grey.50' }}>
                      {isExpanding ? (
                        <Box sx={{ textAlign: 'center', py: 2 }}>
                          <CircularProgress size={16} />
                        </Box>
                      ) : detail && detail.tasks && detail.tasks.length > 0 ? (
                        <TableContainer component={Paper} variant="outlined" sx={{ mb: 1 }}>
                          <Table size="small">
                            <TableHead>
                              <TableRow>
                                <TableCell sx={{ fontSize: '0.72rem', fontWeight: 600, py: 0.5 }}>连接</TableCell>
                                <TableCell sx={{ fontSize: '0.72rem', fontWeight: 600, py: 0.5 }}>状态</TableCell>
                                <TableCell sx={{ fontSize: '0.72rem', fontWeight: 600, py: 0.5 }}>耗时</TableCell>
                                <TableCell sx={{ fontSize: '0.72rem', fontWeight: 600, py: 0.5 }}>行数</TableCell>
                              </TableRow>
                            </TableHead>
                            <TableBody>
                              {detail.tasks.map((task) => (
                                <TableRow key={task.id}>
                                  <TableCell sx={{ fontSize: '0.72rem', py: 0.5 }}>{task.connection_name}</TableCell>
                                  <TableCell sx={{ py: 0.5 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                      {getStatusIcon(task)}
                                      <Typography variant="caption" sx={{ fontSize: '0.7rem' }}>
                                        {getStatusLabel(task.status)}
                                      </Typography>
                                    </Box>
                                  </TableCell>
                                  <TableCell sx={{ fontSize: '0.72rem', py: 0.5 }}>
                                    {task.duration_ms != null ? formatDuration(task.duration_ms) : '-'}
                                  </TableCell>
                                  <TableCell sx={{ fontSize: '0.72rem', py: 0.5 }}>
                                    {task.row_count != null ? task.row_count : '-'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </TableContainer>
                      ) : (
                        <Typography variant="caption" color="text.disabled">
                          暂无明细数据
                        </Typography>
                      )}
                    </Box>
                  </Collapse>
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
