/**
 * 系统数据备份与还原对话框
 * - 手动备份：支持自定义保存路径（含文件夹选择器）
 * - 自动备份：支持路径选择（含文件夹选择器）
 * - 备份列表：支持还原、下载、删除
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Typography, Box, List, ListItem, ListItemText, ListItemSecondaryAction,
  IconButton, Tooltip, TextField, FormControlLabel, Switch,
  Snackbar, Alert, CircularProgress, Divider, Chip,
  InputAdornment,
} from '@mui/material';
import BackupIcon from '@mui/icons-material/Backup';
import RestoreIcon from '@mui/icons-material/Restore';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import {
  fetchBackupConfig, updateBackupConfig, backupNow,
  fetchBackupList, restoreBackup, deleteBackup, getBackupDownloadUrl,
} from '../../services/backupService';
import type { BackupConfig, BackupFile } from '../../services/backupService';
import FolderPicker from './FolderPicker';

interface BackupDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** 格式化时间 */
function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

const BackupDialog: React.FC<BackupDialogProps> = ({ open, onClose }) => {
  const [config, setConfig] = useState<BackupConfig>({
    autoBackupEnabled: false,
    backupIntervalHours: 24,
    backupPath: '',
    maxBackupCount: 10,
  });
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  // 手动备份自定义路径
  const [manualBackupPath, setManualBackupPath] = useState('');
  // 文件夹选择器
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerTarget, setFolderPickerTarget] = useState<'manual' | 'auto' | null>(null);

  const showMsg = (message: string, severity: 'success' | 'error' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, list] = await Promise.all([fetchBackupConfig(), fetchBackupList()]);
      setConfig(cfg);
      setBackups(list);
      // 手动备份路径默认同步自动备份路径
      if (!manualBackupPath && cfg.backupPath) {
        setManualBackupPath(cfg.backupPath);
      }
    } catch {
      showMsg('加载备份信息失败', 'error');
    } finally {
      setLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) loadData();
  }, [open, loadData]);

  const handleSaveConfig = async (partial: Partial<BackupConfig>) => {
    try {
      const updated = await updateBackupConfig(partial);
      setConfig(updated);
      showMsg('配置已保存', 'success');
    } catch {
      showMsg('保存配置失败', 'error');
    }
  };

  const handleBackupNow = async () => {
    setBackingUp(true);
    try {
      const result = await backupNow(manualBackupPath || undefined);
      showMsg(`备份成功: ${result.fileName}`, 'success');
      loadData();
    } catch (err: any) {
      showMsg(err.message || '备份失败', 'error');
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestore = async (file: BackupFile) => {
    if (!window.confirm(`确定要还原备份 "${file.fileName}" 吗？\n\n当前数据将被替换，系统会自动创建回滚备份。\n授权状态和剩余时长不受影响。`)) return;

    setRestoring(file.fileName);
    try {
      const result = await restoreBackup(file.filePath);
      showMsg(`还原成功！已恢复 ${result.restoredCount} 个数据文件`, 'success');
    } catch (err: any) {
      showMsg(err.message || '还原失败', 'error');
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (file: BackupFile) => {
    if (!window.confirm(`确定删除备份 "${file.fileName}"？`)) return;
    try {
      await deleteBackup(file.fileName);
      showMsg('已删除', 'success');
      loadData();
    } catch {
      showMsg('删除失败', 'error');
    }
  };

  /** 打开文件夹选择器 */
  const openFolderPicker = (target: 'manual' | 'auto') => {
    setFolderPickerTarget(target);
    setFolderPickerOpen(true);
  };

  /** 文件夹选择确认 */
  const handleFolderSelected = (selectedPath: string) => {
    if (folderPickerTarget === 'manual') {
      setManualBackupPath(selectedPath);
    } else if (folderPickerTarget === 'auto') {
      const updatedConfig = { ...config, backupPath: selectedPath };
      setConfig(updatedConfig);
      handleSaveConfig({ backupPath: selectedPath });
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <SettingsBackupRestoreIcon />
        数据备份与还原
      </DialogTitle>

      <DialogContent dividers>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : (
          <>
            {/* ===== 手动备份 ===== */}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              手动备份
            </Typography>

            {/* 自定义保存路径 */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <Typography variant="body2" sx={{ minWidth: 60, flexShrink: 0 }}>保存路径</Typography>
              <TextField
                size="small"
                value={manualBackupPath}
                onChange={(e) => setManualBackupPath(e.target.value)}
                placeholder="留空使用默认路径"
                sx={{ flex: 1 }}
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <Tooltip title="选择文件夹">
                        <IconButton
                          size="small"
                          onClick={() => openFolderPicker('manual')}
                          edge="end"
                        >
                          <FolderOpenIcon sx={{ fontSize: 20 }} />
                        </IconButton>
                      </Tooltip>
                    </InputAdornment>
                  ),
                }}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Button
                variant="contained"
                startIcon={backingUp ? <CircularProgress size={18} /> : <BackupIcon />}
                onClick={handleBackupNow}
                disabled={backingUp}
                sx={{ textTransform: 'none' }}
              >
                {backingUp ? '备份中...' : '立即备份'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                将当前所有数据打包备份为 .dclaw 文件
              </Typography>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* ===== 自动备份配置 ===== */}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              自动备份
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
              <FormControlLabel
                control={
                  <Switch
                    size="small"
                    checked={config.autoBackupEnabled}
                    onChange={(e) => handleSaveConfig({ autoBackupEnabled: e.target.checked })}
                  />
                }
                label={
                  <Typography variant="body2">
                    {config.autoBackupEnabled ? '已启用' : '已关闭'}
                  </Typography>
                }
              />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ minWidth: 60 }}>备份间隔</Typography>
                <TextField
                  type="number"
                  size="small"
                  value={config.backupIntervalHours}
                  onChange={(e) => setConfig(c => ({ ...c, backupIntervalHours: parseInt(e.target.value) || 24 }))}
                  onBlur={() => handleSaveConfig({ backupIntervalHours: config.backupIntervalHours })}
                  sx={{ width: 80 }}
                  inputProps={{ min: 1, max: 720 }}
                />
                <Typography variant="body2" color="text.secondary">小时</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ minWidth: 60 }}>保存路径</Typography>
                <TextField
                  size="small"
                  value={config.backupPath}
                  onChange={(e) => setConfig(c => ({ ...c, backupPath: e.target.value }))}
                  onBlur={() => handleSaveConfig({ backupPath: config.backupPath })}
                  placeholder="留空使用默认路径"
                  sx={{ flex: 1, minWidth: 200 }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <Tooltip title="选择文件夹">
                          <IconButton
                            size="small"
                            onClick={() => openFolderPicker('auto')}
                            edge="end"
                          >
                            <FolderOpenIcon sx={{ fontSize: 20 }} />
                          </IconButton>
                        </Tooltip>
                      </InputAdornment>
                    ),
                  }}
                />
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" sx={{ minWidth: 60 }}>保留数量</Typography>
                <TextField
                  type="number"
                  size="small"
                  value={config.maxBackupCount}
                  onChange={(e) => setConfig(c => ({ ...c, maxBackupCount: parseInt(e.target.value) || 10 }))}
                  onBlur={() => handleSaveConfig({ maxBackupCount: config.maxBackupCount })}
                  sx={{ width: 80 }}
                  inputProps={{ min: 1, max: 100 }}
                />
                <Typography variant="body2" color="text.secondary">个备份文件</Typography>
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* ===== 还原备份 ===== */}
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
              从备份还原 ({backups.length})
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              还原不会影响激活状态和剩余时长
            </Typography>

            {backups.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                暂无备份文件
              </Box>
            ) : (
              <List dense disablePadding sx={{ maxHeight: 300, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                {backups.map((f) => (
                  <ListItem
                    key={f.fileName}
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                    }}
                  >
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontSize: '0.8rem', fontWeight: 500 }}>
                            {f.fileName.replace(/^dclaw-(auto-)?/, '').replace('.dclaw', '')}
                          </Typography>
                          {f.fileName.includes('auto-') && (
                            <Chip label="自动" size="small" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />
                          )}
                          {f.fileName.includes('rollback-') && (
                            <Chip label="回滚" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.6rem', height: 18 }} />
                          )}
                        </Box>
                      }
                      secondary={`${formatSize(f.size)} · ${formatTime(f.createdAt)}`}
                      primaryTypographyProps={{ fontSize: '0.8rem' }}
                      secondaryTypographyProps={{ fontSize: '0.7rem' }}
                    />
                    <ListItemSecondaryAction>
                      <Tooltip title="下载备份">
                        <IconButton
                          size="small"
                          onClick={() => window.open(getBackupDownloadUrl(f.fileName))}
                        >
                          <DownloadIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="还原">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleRestore(f)}
                          disabled={restoring === f.fileName}
                        >
                          {restoring === f.fileName ? (
                            <CircularProgress size={18} />
                          ) : (
                            <RestoreIcon sx={{ fontSize: 18 }} />
                          )}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDelete(f)}
                        >
                          <DeleteIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </ListItem>
                ))}
              </List>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>

      {/* 文件夹选择器 */}
      <FolderPicker
        open={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        onSelect={handleFolderSelected}
        currentPath={
          folderPickerTarget === 'manual'
            ? (manualBackupPath || config.backupPath || undefined)
            : (config.backupPath || undefined)
        }
      />

      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default BackupDialog;
