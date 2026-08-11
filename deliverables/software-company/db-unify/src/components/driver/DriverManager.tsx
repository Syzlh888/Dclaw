import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Box,
  Typography,
  TextField,
  InputAdornment,
  IconButton,
  Chip,
  Snackbar,
  Alert,
  CircularProgress,
  Divider,
  DialogActions as ConfirmActions,
  DialogContent as ConfirmContent,
  DialogContentText,
} from '@mui/material';
import ClearIcon from '@mui/icons-material/Clear';
import SearchIcon from '@mui/icons-material/Search';
import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import UndoIcon from '@mui/icons-material/Undo';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ExtensionIcon from '@mui/icons-material/Extension';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import * as MuiDialog from '@mui/material/Dialog';
import { useDriverStore } from '../../stores/driverStore';
import DriverUpload from './DriverUpload';

interface DriverManagerProps {
  open: boolean;
  onClose: () => void;
}

/** 数据库类型 → 品牌颜色映射 */
const DB_BRAND_COLORS: Record<string, string> = {
  mysql: '#00758F',
  postgresql: '#336791',
  mariadb: '#003545',
  sqlite: '#003B57',
  oracle: '#F80000',
  sqlserver: '#CC2927',
  highgo: '#1E6B4F',
  kingbase: '#2E7D32',
  dameng: '#E65100',
  db2: '#0033A0',
  h2: '#0A8A8A',
};

/** 获取驱动品牌色（自定义驱动用橙色） */
const getDriverColor = (driver: { dbType: string; isBuiltIn?: boolean }): string => {
  if (!driver.isBuiltIn) return '#FFA726';
  return DB_BRAND_COLORS[driver.dbType.toLowerCase()] || '#757575';
};

/** 获取驱动名称的首字母（用于图标 fallback） */
const getInitial = (name: string): string => {
  return name.charAt(0).toUpperCase();
};

const DriverManager: React.FC<DriverManagerProps> = ({ open, onClose }) => {
  const drivers = useDriverStore((s) => s.drivers);
  const loading = useDriverStore((s) => s.loading);
  const deleteDriver = useDriverStore((s) => s.deleteDriver);
  const uninstallDriver = useDriverStore((s) => s.uninstallDriver);
  const downloadDriver = useDriverStore((s) => s.downloadDriver);
  const loadDrivers = useDriverStore((s) => s.loadDrivers);

  const [searchText, setSearchText] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editingDriver, setEditingDriver] = useState<NonNullable<ReturnType<typeof useDriverStore.getState>['drivers'][string]> | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'delete' | 'uninstall' | null>(null);
  const [snackMsg, setSnackMsg] = useState('');
  const [snackSeverity, setSnackSeverity] = useState<'success' | 'error'>('success');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  // 搜索过滤
  const filteredDrivers = useMemo(() => {
    const list = Object.values(drivers);
    if (!searchText.trim()) return list;
    const q = searchText.toLowerCase();
    return list.filter((d) => d.name.toLowerCase().includes(q) || d.dbType.toLowerCase().includes(q));
  }, [drivers, searchText]);

  const selectedDriver = selectedId ? drivers[selectedId] : null;

  const isCustomDriver = selectedDriver && !selectedDriver.isBuiltIn;
  const isDownloadedBuiltIn = selectedDriver && selectedDriver.isBuiltIn && selectedDriver.downloaded;
  const hasDownloadUrl = selectedDriver && !!selectedDriver.downloadUrl;

  const handleSearchClear = () => setSearchText('');

  const handleSelect = (id: string) => {
    setSelectedId(id === selectedId ? null : id);
  };

  const handleNew = () => {
    setEditingDriver(null);
    setUploadOpen(true);
  };

  const handleEdit = () => {
    if (!selectedDriver || selectedDriver.isBuiltIn) return;
    setEditingDriver(selectedDriver);
    setUploadOpen(true);
  };

  const handleDeleteOrUninstall = () => {
    if (!selectedDriver) return;
    if (selectedDriver.isBuiltIn && selectedDriver.downloaded) {
      // 内置驱动已下载 → 卸载（移除 JAR）
      setConfirmAction('uninstall');
    } else if (!selectedDriver.isBuiltIn) {
      // 自定义驱动 → 删除
      setConfirmAction('delete');
    }
    setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    setConfirmOpen(false);
    try {
      if (confirmAction === 'uninstall') {
        const ok = await uninstallDriver(selectedId);
        if (ok) {
          setSnackMsg('驱动已卸载');
          setSnackSeverity('success');
        } else {
          setSnackMsg('卸载失败');
          setSnackSeverity('error');
        }
      } else if (confirmAction === 'delete') {
        await deleteDriver(selectedId);
        setSnackMsg('驱动已删除');
        setSnackSeverity('success');
      }
      setSelectedId(null);
    } catch {
      setSnackMsg('操作失败');
      setSnackSeverity('error');
    }
  };

  const handleUncancel = () => {
    setSelectedId(null);
    loadDrivers();
    setSnackMsg('已刷新驱动列表');
    setSnackSeverity('success');
  };

  const handleDownload = async (driverId: string) => {
    setDownloadingId(driverId);
    try {
      const ok = await downloadDriver(driverId);
      if (ok) {
        setSnackMsg('驱动下载成功');
        setSnackSeverity('success');
        loadDrivers();
      } else {
        setSnackMsg('驱动下载失败，请检查网络或尝试手动下载 JAR 后上传');
        setSnackSeverity('error');
      }
    } catch (err: any) {
      setSnackMsg(err?.message || '驱动下载失败，请检查网络或尝试手动下载 JAR 后上传');
      setSnackSeverity('error');
    } finally {
      setDownloadingId(null);
    }
  };

  /** 打开手动上传弹窗（用于下载失败的驱动） */
  const handleManualUpload = (driver: any) => {
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
    loadDrivers();
    setSnackMsg(editingDriver ? '驱动已更新' : '驱动已添加');
    setSnackSeverity('success');
  };

  /** 获取驱动状态 Chip */
  const renderStatusChip = (driver: typeof filteredDrivers[number]) => {
    if (!driver.isBuiltIn) {
      return (
        <Chip
          icon={<ExtensionIcon sx={{ fontSize: 'calc(0.8125rem * var(--dc-scale, 1))' }} />}
          label="用户定义"
          size="small"
          variant="outlined"
          sx={{
            fontSize: 'calc(0.6rem * var(--dc-scale, 1))',
            height: 20,
            borderColor: '#FFA726',
            color: '#FFA726',
            '& .MuiChip-icon': { color: '#FFA726' },
          }}
        />
      );
    }
    if (driver.downloaded) {
      return (
        <Chip
          icon={<CheckCircleIcon sx={{ fontSize: 'calc(0.8125rem * var(--dc-scale, 1))' }} />}
          label="已下载"
          size="small"
          variant="outlined"
          color="success"
          sx={{ fontSize: 'calc(0.6rem * var(--dc-scale, 1))', height: 20 }}
        />
      );
    }
    if (driver.downloadUrl) {
      return (
        <Chip
          label="未下载"
          size="small"
          variant="outlined"
          sx={{ fontSize: 'calc(0.6rem * var(--dc-scale, 1))', height: 20, color: 'text.disabled', borderColor: 'divider' }}
        />
      );
    }
    return (
      <Chip
        icon={<CancelIcon sx={{ fontSize: 'calc(0.8125rem * var(--dc-scale, 1))' }} />}
        label="不可获得"
        size="small"
        variant="outlined"
        color="error"
        sx={{ fontSize: 'calc(0.6rem * var(--dc-scale, 1))', height: 20 }}
      />
    );
  };

  const confirmMessage =
    confirmAction === 'uninstall'
      ? `确定要卸载驱动"${selectedDriver?.name}"吗？这将移除已下载的 JAR 文件，但保留驱动记录，可随时重新下载。`
      : `确定要删除驱动"${selectedDriver?.name}"吗？此操作不可恢复。`;

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            maxWidth: 720,
            minHeight: 480,
            maxHeight: 600,
          },
        }}
      >
        {/* 标题栏 */}
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1.5,
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Inventory2Icon sx={{ fontSize: 'calc(1.25rem * var(--dc-scale, 1))', color: 'primary.main' }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: 'calc(0.95rem * var(--dc-scale, 1))' }}>
            驱动管理器
          </Typography>
        </DialogTitle>

        {/* 主内容区 */}
        <DialogContent sx={{ p: 0, display: 'flex', flex: 1, overflow: 'hidden', minHeight: 380 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <Box sx={{ display: 'flex', flex: 1 }}>
              {/* ===== 左栏：搜索 + 驱动列表 ===== */}
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderRight: '1px solid', borderColor: 'divider' }}>
                {/* 搜索框 */}
                <Box sx={{ px: 1.5, py: 1 }}>
                  <TextField
                    size="small"
                    placeholder="搜索驱动..."
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    fullWidth
                    variant="outlined"
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        fontSize: 'calc(0.8rem * var(--dc-scale, 1))',
                        borderRadius: 1,
                      },
                    }}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon sx={{ fontSize: 'calc(1.125rem * var(--dc-scale, 1))', color: 'text.disabled' }} />
                        </InputAdornment>
                      ),
                      endAdornment: searchText ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={handleSearchClear} edge="end">
                            <ClearIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    }}
                  />
                </Box>

                <Divider />

                {/* 驱动列表头部 */}
                <Box sx={{ px: 2, py: 0.75, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: 'calc(0.7rem * var(--dc-scale, 1))', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    数据库驱动
                  </Typography>
                </Box>

                {/* 驱动列表 */}
                <List dense sx={{ flex: 1, overflow: 'auto', px: 0.5, py: 0 }}>
                  {filteredDrivers.length === 0 ? (
                    <Box sx={{ py: 4, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.disabled" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>
                        {searchText ? '未找到匹配的驱动' : '暂无驱动'}
                      </Typography>
                    </Box>
                  ) : (
                    filteredDrivers.map((driver) => {
                      const color = getDriverColor(driver);
                      const isSelected = selectedId === driver.id;
                      return (
                        <ListItem key={driver.id} disablePadding sx={{ mb: 0.25 }}>
                          <ListItemButton
                            selected={isSelected}
                            onClick={() => handleSelect(driver.id)}
                            sx={{
                              borderRadius: 0.5,
                              py: 0.5,
                              px: 1.5,
                              '&.Mui-selected': {
                                bgcolor: 'primary.dark',
                                '&:hover': {
                                  bgcolor: 'primary.dark',
                                },
                              },
                            }}
                          >
                            {/* 彩色品牌图标 */}
                            <ListItemIcon sx={{ minWidth: 28 }}>
                              <Box
                                sx={{
                                  width: 22,
                                  height: 22,
                                  borderRadius: '4px',
                                  bgcolor: color,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#fff',
                                  fontSize: 'calc(0.65rem * var(--dc-scale, 1))',
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {getInitial(driver.name)}
                              </Box>
                            </ListItemIcon>

                            {/* 驱动名称 */}
                            <ListItemText
                              primary={
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 500,
                                    fontSize: 'calc(0.8rem * var(--dc-scale, 1))',
                                    color: isSelected ? '#fff' : 'text.primary',
                                  }}
                                >
                                  {driver.name}
                                </Typography>
                              }
                              sx={{ my: 0 }}
                            />

                            {/* 状态标识 */}
                            <Box sx={{ ml: 1, flexShrink: 0 }}>
                              {renderStatusChip(driver)}
                            </Box>

                            {/* 未下载且有下载链接时显示下载按钮 */}
                            {!driver.downloaded && driver.downloadUrl && (
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDownload(driver.id);
                                }}
                                disabled={downloadingId === driver.id}
                                sx={{
                                  ml: 0.5,
                                  color: isSelected ? '#fff' : 'primary.main',
                                  p: 0.5,
                                }}
                              >
                                {downloadingId === driver.id ? (
                                  <CircularProgress size={14} color="inherit" />
                                ) : (
                                  <CloudDownloadIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />
                                )}
                              </IconButton>
                            )}
                            {/* 未下载/不可获得 → 手动上传 JAR */}
                            {!driver.downloaded && !downloadingId && (
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleManualUpload(driver);
                                }}
                                sx={{
                                  ml: 0.25,
                                  color: isSelected ? '#fff' : 'warning.main',
                                  p: 0.5,
                                }}
                                title="手动上传 JAR"
                              >
                                <CloudUploadIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />
                              </IconButton>
                            )}
                          </ListItemButton>
                        </ListItem>
                      );
                    })
                  )}
                </List>
              </Box>

              {/* ===== 右栏：操作按钮 + 图例 ===== */}
              <Box
                sx={{
                  width: 130,
                  display: 'flex',
                  flexDirection: 'column',
                  p: 1.5,
                  gap: 0.75,
                  flexShrink: 0,
                }}
              >
                {/* 操作按钮 */}
                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />}
                  onClick={handleNew}
                  sx={{
                    textTransform: 'none',
                    justifyContent: 'flex-start',
                    fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                    px: 1,
                  }}
                >
                  新建(N)
                </Button>

                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<ContentCopyIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />}
                  disabled
                  sx={{
                    textTransform: 'none',
                    justifyContent: 'flex-start',
                    fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                    px: 1,
                  }}
                >
                  复制(C)
                </Button>

                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<EditIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />}
                  onClick={handleEdit}
                  disabled={!selectedDriver || selectedDriver.isBuiltIn}
                  sx={{
                    textTransform: 'none',
                    justifyContent: 'flex-start',
                    fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                    px: 1,
                  }}
                >
                  编辑(E)...
                </Button>

                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<DeleteIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />}
                  onClick={handleDeleteOrUninstall}
                  disabled={
                    !selectedDriver ||
                    (!selectedDriver.isBuiltIn ? false : !selectedDriver.downloaded)
                  }
                  color="error"
                  sx={{
                    textTransform: 'none',
                    justifyContent: 'flex-start',
                    fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                    px: 1,
                  }}
                >
                  {selectedDriver?.isBuiltIn ? '卸载(D)' : '删除(D)'}
                </Button>

                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<UndoIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />}
                  onClick={handleUncancel}
                  sx={{
                    textTransform: 'none',
                    justifyContent: 'flex-start',
                    fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                    px: 1,
                  }}
                >
                  取消删除
                </Button>

                <Box sx={{ flex: 1 }} />

                {/* 图例 */}
                <Divider />

                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: '#FFA726', flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ fontSize: 'calc(0.65rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
                      用户定义
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <CancelIcon sx={{ fontSize: 'calc(0.75rem * var(--dc-scale, 1))', color: 'error.main', flexShrink: 0 }} />
                    <Typography variant="caption" sx={{ fontSize: 'calc(0.65rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
                      不可获得
                    </Typography>
                  </Box>
                </Box>
              </Box>
            </Box>
          )}
        </DialogContent>

        {/* 底部 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            py: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: 'calc(0.65rem * var(--dc-scale, 1))' }}>
            可以在驱动设置中更改全局首选项
          </Typography>
          <Button onClick={onClose} variant="outlined" size="small" sx={{ textTransform: 'none', fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>
            关闭(C)
          </Button>
        </Box>
      </Dialog>

      {/* 确认对话框 */}
      <MuiDialog.default
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <ConfirmContent>
          <DialogContentText sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }}>
            {confirmMessage}
          </DialogContentText>
        </ConfirmContent>
        <ConfirmActions>
          <Button onClick={() => setConfirmOpen(false)} sx={{ textTransform: 'none', fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>
            取消
          </Button>
          <Button
            onClick={handleConfirm}
            color="error"
            variant="contained"
            sx={{ textTransform: 'none', fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}
          >
            {confirmAction === 'uninstall' ? '卸载' : '删除'}
          </Button>
        </ConfirmActions>
      </MuiDialog.default>

      {/* 上传/编辑驱动弹窗 */}
      <DriverUpload open={uploadOpen} onClose={handleUploadClose} editDriver={editingDriver} onSuccess={handleUploadComplete} />

      {/* 操作反馈 */}
      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackSeverity} sx={{ width: '100%', fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>
          {snackMsg}
        </Alert>
      </Snackbar>
    </>
  );
};

export default DriverManager;
