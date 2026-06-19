import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  IconButton,
  Box,
  Typography,
  Chip,
  Divider,
  Tooltip,
  Snackbar,
  Alert,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import MemoryIcon from '@mui/icons-material/Memory';
import ExtensionIcon from '@mui/icons-material/Extension';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import { useDriverStore } from '../../stores/driverStore';
import DriverUpload from './DriverUpload';

interface DriverManagerProps {
  open: boolean;
  onClose: () => void;
}

const DriverManager: React.FC<DriverManagerProps> = ({ open, onClose }) => {
  const drivers = useDriverStore((s) => s.drivers);
  const loading = useDriverStore((s) => s.loading);
  const deleteDriver = useDriverStore((s) => s.deleteDriver);
  const loadDrivers = useDriverStore((s) => s.loadDrivers);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<ReturnType<typeof useDriverStore.getState>['drivers'][string] | null>(null);
  const [snackMsg, setSnackMsg] = useState('');
  const [snackSeverity, setSnackSeverity] = useState<'success' | 'error'>('success');

  const driverList = Object.values(drivers);
  const builtInDrivers = driverList.filter((d) => d.isBuiltIn);
  const customDrivers = driverList.filter((d) => !d.isBuiltIn);

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatUploadTime = (isoTime: string): string => {
    try {
      return new Date(isoTime).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoTime;
    }
  };

  const handleDeleteDriver = async (id: string) => {
    await deleteDriver(id);
    setSnackMsg('驱动已删除');
    setSnackSeverity('success');
  };

  const handleEditDriver = (driver: typeof customDrivers[number]) => {
    setEditingDriver(driver);
    setUploadOpen(true);
  };

  const handleUploadClose = () => {
    setUploadOpen(false);
    setEditingDriver(null);
  };

  const handleUploadComplete = () => {
    setUploadOpen(false);
    setEditingDriver(null);
    loadDrivers(); // 重新加载驱动列表
    setSnackMsg(editingDriver ? '驱动已更新' : '驱动已添加');
    setSnackSeverity('success');
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth={false} fullWidth PaperProps={{ sx: { maxWidth: 540 } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Inventory2Icon color="primary" />
            驱动管理
          </Box>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setUploadOpen(true)}
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            上传驱动
          </Button>
        </DialogTitle>
        <DialogContent dividers>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress size={32} />
            </Box>
          ) : (
            <>
              {/* 内置驱动 */}
              <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontWeight: 600 }}>
                <MemoryIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                内置驱动
              </Typography>
              <List dense sx={{ mb: 2 }}>
                {builtInDrivers.map((driver) => (
                  <ListItem
                    key={driver.id}
                    sx={{
                      bgcolor: 'action.hover',
                      borderRadius: 1,
                      mb: 0.5,
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 32 }}>
                      <MemoryIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {driver.name}
                          </Typography>
                          <Chip label={`v${driver.version}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {driver.driverClass} · {formatFileSize(driver.fileSize)}
                        </Typography>
                      }
                    />
                  </ListItem>
                ))}
              </List>

              <Divider sx={{ my: 1.5 }} />

              {/* 自定义驱动 */}
              <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary', fontWeight: 600 }}>
                <ExtensionIcon sx={{ fontSize: 16, mr: 0.5, verticalAlign: 'text-bottom' }} />
                自定义驱动
              </Typography>
              {customDrivers.length > 0 ? (
                <List dense>
                  {customDrivers.map((driver) => (
                    <ListItem
                      key={driver.id}
                      sx={{
                        bgcolor: 'background.paper',
                        borderRadius: 1,
                        mb: 0.5,
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <ExtensionIcon sx={{ fontSize: 20, color: 'warning.main' }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {driver.name}
                            </Typography>
                            <Chip label={`v${driver.version}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 20 }} />
                          </Box>
                        }
                        secondary={
                          <Typography variant="caption" color="text.secondary">
                            {driver.driverClass} · {driver.fileName} · {formatFileSize(driver.fileSize)} · {formatUploadTime(driver.uploadTime)}
                          </Typography>
                        }
                      />
                      <Tooltip title="编辑驱动">
                        <IconButton
                          size="small"
                          color="primary"
                          onClick={() => handleEditDriver(driver)}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除驱动">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteDriver(driver.id)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </ListItem>
                  ))}
                </List>
              ) : (
                <Box sx={{ py: 2, textAlign: 'center' }}>
                  <Typography variant="body2" color="text.disabled">
                    暂无自定义驱动，点击右上角"上传驱动"添加
                  </Typography>
                </Box>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} sx={{ textTransform: 'none' }}>
            关闭
          </Button>
        </DialogActions>
      </Dialog>

      {/* 上传/编辑驱动弹窗 */}
      <DriverUpload open={uploadOpen} onClose={handleUploadClose} editDriver={editingDriver} onSuccess={handleUploadComplete} />

      {/* 操作反馈 */}
      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackSeverity} sx={{ width: '100%' }}>
          {snackMsg}
        </Alert>
      </Snackbar>
    </>
  );
};

export default DriverManager;
