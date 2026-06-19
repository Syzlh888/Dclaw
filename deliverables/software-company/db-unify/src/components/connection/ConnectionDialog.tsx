import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  IconButton,
  Checkbox,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Box,
  Chip,
  Typography,
  Snackbar,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import LanIcon from '@mui/icons-material/Lan';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeStore } from '../../stores/treeStore';
import { ConnectionStatus, DbDriver } from '../../types/connection';
import type { DbConnection } from '../../types/connection';
import ConnectionForm from './ConnectionForm';
import type { TreePathInfo } from './ConnectionForm';
import BulkImportDialog from './BulkImportDialog';
import DriverManager from '../driver/DriverManager';

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
}

const ConnectionDialog: React.FC<ConnectionDialogProps> = ({ open, onClose }) => {
  const connections = useConnectionStore((s) => s.connections);
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const addConnection = useConnectionStore((s) => s.addConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const addHospitalNode = useTreeStore((s) => s.addHospitalNode);
  const loadTree = useTreeStore((s) => s.loadTree);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  /** 批量选择 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // 每次打开对话框时同步最新连接列表
  useEffect(() => {
    if (open) {
      loadConnections();
      setSelectedIds(new Set());
    }
  }, [open, loadConnections]);

  const connectionList = Object.values(connections);

  const handleAdd = () => {
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await deleteConnection(id);
    await loadTree();
  };

  /** 切换选中 */
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  /** 全选/取消全选 */
  const handleToggleAll = () => {
    if (selectedIds.size === connectionList.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(connectionList.map((c) => c.id)));
    }
  };

  /** 批量删除 */
  const handleBatchDelete = async () => {
    for (const id of selectedIds) {
      await deleteConnection(id);
    }
    await loadTree();
    setSelectedIds(new Set());
    setSnackMsg(`已删除 ${selectedIds.size} 个连接`);
  };

  const handleSave = (data: Omit<DbConnection, 'id'>) => {
    if (editingId) {
      updateConnection(editingId, data);
    } else {
      addConnection(data);
    }
    setShowForm(false);
    setEditingId(null);
  };

  /** 保存连接并在树中创建 Hospital 节点 */
  const handleSaveWithTree = async (data: Omit<DbConnection, 'id'>, treePath: TreePathInfo) => {
    try {
      // 1. 创建连接
      const connectionId = await addConnection(data);
      if (!connectionId) throw new Error('创建连接失败');

      // 2. 如果选了层级路径，创建 Hospital 节点并关联
      if (treePath.districtId) {
        await addHospitalNode(treePath.districtId, treePath.hospitalName, connectionId);
        loadTree(); // 刷新左侧树
      }

      setSnackMsg('连接已创建并关联到树节点');
    } catch (err: any) {
      setSnackMsg(`保存失败: ${err.message || '未知错误'}`);
    }
    setShowForm(false);
    setEditingId(null);
  };

  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case ConnectionStatus.Online:
        return 'success';
      case ConnectionStatus.Offline:
        return 'default';
      case ConnectionStatus.Error:
        return 'error';
      default:
        return 'default';
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          maxWidth: 540,
          maxHeight: '50vh',
          height: '50vh',
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LanIcon color="primary" />
          数据库连接管理 ({connectionList.length})
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            size="small"
            color="error"
            startIcon={<DeleteSweepIcon />}
            onClick={handleBatchDelete}
            disabled={selectedIds.size === 0}
            variant="outlined"
            sx={{ textTransform: 'none' }}
          >
            批量删除 ({selectedIds.size})
          </Button>
          <Button
            size="small"
            startIcon={<SettingsInputComponentIcon />}
            onClick={() => setDriverDialogOpen(true)}
            variant="outlined"
            color="inherit"
            sx={{ textTransform: 'none' }}
          >
            驱动管理
          </Button>
          <Button
            size="small"
            startIcon={<UploadFileIcon />}
            onClick={() => setBulkImportOpen(true)}
            variant="outlined"
            sx={{ textTransform: 'none' }}
          >
            批量导入
          </Button>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            variant="contained"
            sx={{ textTransform: 'none' }}
          >
            添加连接
          </Button>
        </Box>
      </DialogTitle>
      <DialogContent dividers sx={{ p: 0 }}>
        {showForm ? (
          <Box sx={{ p: 2, maxWidth: 460, mx: 'auto' }}>
            <ConnectionForm
              key={editingId || 'new'}
              connection={editingId ? connections[editingId] : undefined}
              onSave={handleSave}
              onSaveWithTree={handleSaveWithTree}
              showTreePath={true}
              onCancel={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            />
          </Box>
        ) : (
          <List dense disablePadding>
            {/* 全选行 */}
            {connectionList.length > 0 && (
              <ListItem
                sx={{
                  px: 2,
                  py: 0.25,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'action.hover',
                }}
              >
                <Checkbox
                  size="small"
                  checked={selectedIds.size === connectionList.length}
                  indeterminate={selectedIds.size > 0 && selectedIds.size < connectionList.length}
                  onChange={handleToggleAll}
                  sx={{ mr: 1 }}
                />
                <Typography variant="caption" color="text.secondary">
                  全选
                </Typography>
              </ListItem>
            )}
            {connectionList.map((conn) => (
              <ListItem key={conn.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 2, py: 0.5 }}>
                <Checkbox
                  size="small"
                  checked={selectedIds.has(conn.id)}
                  onChange={() => handleToggleSelect(conn.id)}
                  sx={{ mr: 1 }}
                />
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Typography variant="body2">{conn.name}</Typography>
                      <Chip
                        label={conn.driver.toUpperCase()}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.7rem' }}
                      />
                      <Chip
                        label={conn.status === ConnectionStatus.Online ? '在线' : conn.status === ConnectionStatus.Offline ? '离线' : '异常'}
                        size="small"
                        color={getStatusColor(conn.status) as any}
                        sx={{ fontSize: '0.7rem' }}
                      />
                    </Box>
                  }
                  secondary={`${conn.host}:${conn.port}/${conn.database}`}
                />
                <ListItemSecondaryAction>
                  <IconButton size="small" onClick={() => handleEdit(conn.id)}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDelete(conn.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
            {connectionList.length === 0 && (
              <ListItem>
                <ListItemText
                  primary="暂无连接"
                  sx={{ textAlign: 'center', color: 'text.disabled' }}
                />
              </ListItem>
            )}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          关闭
        </Button>
      </DialogActions>

      {/* 批量导入对话框 */}
      <BulkImportDialog
        open={bulkImportOpen}
        onClose={() => setBulkImportOpen(false)}
      />

      {/* 驱动管理对话框 */}
      <DriverManager
        open={driverDialogOpen}
        onClose={() => setDriverDialogOpen(false)}
      />

      {/* 保存反馈 */}
      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackMsg.includes('失败') ? 'error' : 'success'} sx={{ width: '100%' }}>
          {snackMsg}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default ConnectionDialog;
