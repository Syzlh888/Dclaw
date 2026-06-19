import React, { useState, useImperativeHandle, forwardRef } from 'react';
import {
  Box,
  Button,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Chip,
  Typography,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeStore } from '../../stores/treeStore';
import { ConnectionStatus, DbDriver } from '../../types/connection';
import type { DbConnection } from '../../types/connection';
import ConnectionForm from './ConnectionForm';
import BulkImportDialog from './BulkImportDialog';

/** 暴露给父组件的方法 */
export interface ConnectionPanelHandle {
  addConnection: () => void;
}

interface ConnectionPanelProps {
  onOpenDriverManager: () => void;
  /** 当 embedded=true 时，隐藏自身标题栏（由父容器提供标题和操作按钮） */
  embedded?: boolean;
}

const ConnectionPanel = forwardRef<ConnectionPanelHandle, ConnectionPanelProps>(
  ({ onOpenDriverManager, embedded = false }, ref) => {
  const connections = useConnectionStore((s) => s.connections);
  const addConnection = useConnectionStore((s) => s.addConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const loadTree = useTreeStore((s) => s.loadTree);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const connectionList = Object.values(connections);

  const handleAdd = () => {
    setEditingId(null);
    setShowForm(true);
  };

  // 暴露 addConnection 方法给父组件
  useImperativeHandle(ref, () => ({
    addConnection: handleAdd,
  }));

  const handleEdit = (id: string) => {
    setEditingId(id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await deleteConnection(id);
    await loadTree();
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

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const getStatusColor = (status: ConnectionStatus): 'success' | 'default' | 'error' => {
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

  const getStatusLabel = (status: ConnectionStatus): string => {
    switch (status) {
      case ConnectionStatus.Online:
        return '在线';
      case ConnectionStatus.Offline:
        return '离线';
      case ConnectionStatus.Error:
        return '异常';
      default:
        return '未知';
    }
  };

  const getDriverLabel = (driver: DbDriver): string => {
    switch (driver) {
      case DbDriver.MySQL:
        return 'MySQL';
      case DbDriver.PostgreSQL:
        return 'PG';
      case DbDriver.Oracle:
        return 'Oracle';
      case DbDriver.SQLServer:
        return 'MSSQL';
      case DbDriver.Custom:
        return '自定义';
      default:
        return driver;
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
      }}
    >
      {/* 标题行 —— 仅在非嵌入式模式下显示 */}
      {!embedded && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 1.5,
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            连接管理
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="批量导入">
              <IconButton size="small" onClick={() => setBulkImportOpen(true)} color="inherit">
                <UploadFileIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="驱动管理">
              <IconButton size="small" onClick={onOpenDriverManager} color="inherit">
                <SettingsInputComponentIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="添加连接">
              <IconButton size="small" onClick={handleAdd} color="primary">
                <AddIcon sx={{ fontSize: 18 }} />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      )}

      {/* 内容区域 */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {showForm ? (
          <Box sx={{ p: 1.5 }}>
            <ConnectionForm
              key={editingId || 'new'}
              connection={editingId ? connections[editingId] : undefined}
              onSave={handleSave}
              onCancel={handleCancel}
            />
          </Box>
        ) : (
          <List dense disablePadding>
            {connectionList.map((conn) => (
              <ListItem
                key={conn.id}
                sx={{
                  px: 1.5,
                  py: 0.75,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:hover': {
                    bgcolor: 'action.hover',
                  },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                      <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem' }}>
                        {conn.name}
                      </Typography>
                      <Chip
                        label={getDriverLabel(conn.driver)}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.6rem', height: 18 }}
                      />
                      <Chip
                        label={getStatusLabel(conn.status)}
                        size="small"
                        color={getStatusColor(conn.status)}
                        sx={{ fontSize: '0.6rem', height: 18 }}
                      />
                    </Box>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                      {conn.host}:{conn.port}/{conn.database}
                    </Typography>
                  }
                />
                <Box sx={{ display: 'flex', gap: 0, ml: 0.5, flexShrink: 0 }}>
                  <IconButton size="small" onClick={() => handleEdit(conn.id)} sx={{ p: 0.25 }}>
                    <EditIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDelete(conn.id)} sx={{ p: 0.25 }}>
                    <DeleteIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                </Box>
              </ListItem>
            ))}
            {connectionList.length === 0 && (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <Typography variant="body2" color="text.disabled">
                  暂无连接
                </Typography>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={handleAdd}
                  sx={{ mt: 1, textTransform: 'none' }}
                >
                  添加连接
                </Button>
              </Box>
            )}
          </List>
        )}
      </Box>

      <BulkImportDialog open={bulkImportOpen} onClose={() => setBulkImportOpen(false)} />
    </Box>
  );
  }
);

export default ConnectionPanel;
