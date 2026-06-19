import React, { useState, useCallback } from 'react';
import {
  Box,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  IconButton,
  Snackbar,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import { useTreeStore } from '../../stores/treeStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeCheck } from '../../hooks/useTreeCheck';
import TreeNodeComponent from './TreeNode';
import ConnectionForm from '../connection/ConnectionForm';
import type { TreeNode } from '../../types/tree';
import { TreeNodeType } from '../../types/tree';
import type { DbConnection } from '../../types/connection';

type DialogMode = 'add' | 'edit';

const DatabaseTree: React.FC = () => {
  const nodes = useTreeStore((s) => s.nodes);
  const rootNodeIds = useTreeStore((s) => s.rootNodeIds);
  const toggleExpand = useTreeStore((s) => s.toggleExpand);
  const addNode = useTreeStore((s) => s.addNode);
  const addHospitalNode = useTreeStore((s) => s.addHospitalNode);
  const updateNode = useTreeStore((s) => s.updateNode);
  const deleteNode = useTreeStore((s) => s.deleteNode);
  const reorderChildren = useTreeStore((s) => s.reorderChildren);
  const addConnection = useConnectionStore((s) => s.addConnection);
  const connections = useConnectionStore((s) => s.connections);
  const { handleCheck } = useTreeCheck();

  // Dialog state for add/edit (for L1/L2)
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>('add');
  const [dialogName, setDialogName] = useState('');
  const [dialogTargetId, setDialogTargetId] = useState('');

  // Connection dialog state (for L3 adding Hospital)
  const [connDialogOpen, setConnDialogOpen] = useState(false);
  const [connDialogParentId, setConnDialogParentId] = useState('');

  // Connection edit dialog state (for L4 editing Hospital connection)
  const [connEditDialogOpen, setConnEditDialogOpen] = useState(false);
  const [connEditNodeId, setConnEditNodeId] = useState('');

  // Delete confirmation dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState('');
  const [deleteTargetName, setDeleteTargetName] = useState('');

  // Copy feedback snackbar
  const [snackbarOpen, setSnackbarOpen] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('');

  /** Handle "添加项目" click */
  const handleAddPlatform = () => {
    setDialogMode('add');
    setDialogName('');
    setDialogTargetId('');
    setDialogOpen(true);
  };

  /** Open add dialog - L3 shows connection form, others show name input */
  const handleAddChild = (nodeId: string) => {
    const node = nodes[nodeId];
    if (!node) return;

    if (node.type === TreeNodeType.District) {
      // 区域节点：打开连接配置表单
      setConnDialogParentId(nodeId);
      setConnDialogOpen(true);
    } else {
      // 项目/业务模块：简单名称输入弹窗
      setDialogMode('add');
      setDialogName('');
      setDialogTargetId(nodeId);
      setDialogOpen(true);
    }
  };

  /** Open edit dialog - Hospital opens connection form, others open name input */
  const handleEditNode = (nodeId: string) => {
    const node = nodes[nodeId];
    if (!node) return;

    if (node.type === TreeNodeType.Hospital) {
      // 连接实例：打开连接编辑表单
      setConnEditNodeId(nodeId);
      setConnEditDialogOpen(true);
    } else {
      // 项目/业务模块/区域节点：简单名称输入弹窗
      setDialogMode('edit');
      setDialogName(node.name);
      setDialogTargetId(nodeId);
      setDialogOpen(true);
    }
  };

  /** Open delete confirmation */
  const handleDeleteNode = (nodeId: string) => {
    const node = nodes[nodeId];
    if (!node) return;
    setDeleteTargetId(nodeId);
    setDeleteTargetName(node.name);
    setDeleteDialogOpen(true);
  };

  /** Clone Hospital node: copy connection config and create a new sibling node */
  const handleCopyNode = async (nodeId: string) => {
    const node = nodes[nodeId];
    if (!node || !node.dbConnectionId) return;
    const conn = connections[node.dbConnectionId];
    if (!conn || !node.parentId) return;

    try {
      // 1. Create a new connection with same config
      const newConnId = await addConnection({
        name: `${conn.name} (副本)`,
        driver: conn.driver,
        host: conn.host,
        port: conn.port,
        username: conn.username,
        password: conn.password,
        database: conn.database,
        schema: conn.schema,
        customDriverId: conn.customDriverId,
      } as any);
      if (!newConnId) throw new Error('创建连接失败');

      // 2. Add hospital tree node under the same parent
      await addHospitalNode(node.parentId, `${conn.name} (副本)`, newConnId);

      // Also copy connection config to clipboard
      const text = `${conn.name}\n驱动: ${conn.driver}\n主机: ${conn.host}\n端口: ${conn.port}\n数据库: ${conn.database}\n用户名: ${conn.username}`;
      navigator.clipboard.writeText(text);

      setSnackbarMsg(`已复制 "${conn.name}" 并创建副本`);
      setSnackbarOpen(true);
    } catch (err) {
      console.error('复制节点失败:', err);
      setSnackbarMsg('复制节点失败');
      setSnackbarOpen(true);
    }
  };

  /** Handle drag reorder: move dragId to before/after dropId within the same parent */
  const handleReorder = useCallback(
    (dragId: string, dropId: string, position: 'before' | 'after') => {
      const dragNode = nodes[dragId];
      const dropNode = nodes[dropId];
      if (!dragNode || !dropNode) return;
      // 必须在同一父节点下
      if (dragNode.parentId !== dropNode.parentId) return;

      const parentId = dropNode.parentId || '';
      // 获取当前父节点的 childrenIds（如果是 root 级，用 rootNodeIds）
      const currentIds = parentId ? nodes[parentId]?.childrenIds || [] : rootNodeIds;
      const newIds = currentIds.filter((id) => id !== dragId);

      const dropIdx = newIds.indexOf(dropId);
      const insertIdx = position === 'before' ? dropIdx : dropIdx + 1;
      newIds.splice(insertIdx, 0, dragId);

      reorderChildren(parentId, newIds);
    },
    [nodes, rootNodeIds, reorderChildren],
  );

  /** Confirm add/edit dialog */
  const handleDialogConfirm = async (overrideName?: string) => {
    const name = (overrideName ?? dialogName).trim();
    if (!name) return;
    if (dialogMode === 'add') {
      await addNode(dialogTargetId, name);
    } else {
      await updateNode(dialogTargetId, name);
    }
    setDialogOpen(false);
  };

  /** Confirm delete */
  const handleDeleteConfirm = () => {
    deleteNode(deleteTargetId);
    setDeleteDialogOpen(false);
  };

  /** Save connection form -> create connection + hospital node */
  const handleConnectionSave = async (data: Omit<DbConnection, 'id'>) => {
    // 1. Create connection (server generates ID)
    const connectionId = await addConnection(data as any);
    if (!connectionId) return;
    // 2. Add hospital tree node linked to this connection
    await addHospitalNode(connDialogParentId, data.name, connectionId);
    setConnDialogOpen(false);
  };

  /** Save edited connection for existing Hospital node */
  const handleConnectionEditSave = async (data: Omit<DbConnection, 'id'>) => {
    const node = nodes[connEditNodeId];
    if (!node || !node.dbConnectionId) return;
    // 1. Update existing connection
    await useConnectionStore.getState().updateConnection(node.dbConnectionId, {
      name: data.name,
      driver: data.driver,
      host: data.host,
      port: data.port,
      username: data.username,
      password: data.password,
      database: data.database,
      schema: data.schema,
      customDriverId: data.customDriverId,
    });
    // 2. Update tree node name if changed
    if (data.name !== node.name) {
      await updateNode(connEditNodeId, data.name);
    }
    setConnEditDialogOpen(false);
  };

  if (rootNodeIds.length === 0) {
    return (
      <Box sx={{ py: 0.5, px: 1.5 }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 4 }}>
          <Box sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
            暂无数据，请先创建项目
          </Box>
          <Button
            variant="outlined"
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 16 }} />}
            onClick={handleAddPlatform}
          >
            创建项目
          </Button>
        </Box>

        {/* Add/Edit dialog (project) */}
        <Dialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontSize: '0.95rem', pb: 1 }}>
            {dialogMode === 'add' ? '新增项目' : '修改项目'}
          </DialogTitle>
          <DialogContent>
            <TextField
              autoFocus
              size="small"
              margin="dense"
              label="项目名称"
              value={dialogName}
              onChange={(e) => setDialogName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleDialogConfirm((e.target as HTMLInputElement).value);
              }
            }}
              fullWidth
            />
          </DialogContent>
          <DialogActions sx={{ px: 3, pb: 2 }}>
            <Button onClick={() => setDialogOpen(false)} size="small">
              取消
            </Button>
            <Button
              onClick={() => handleDialogConfirm()}
              variant="contained"
              size="small"
              disabled={!dialogName.trim()}
            >
              确定
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    );
  }

  /** Recursively render tree nodes that are visible */
  const renderNode = (node: TreeNode): React.ReactNode => {
    if (!node.visible) return null;

    return (
      <React.Fragment key={node.id}>
        <TreeNodeComponent
          node={node}
          nodes={nodes}
          onToggleCheck={handleCheck}
          onToggleExpand={toggleExpand}
          onAddChild={handleAddChild}
          onEditNode={handleEditNode}
          onDeleteNode={handleDeleteNode}
          onCopyNode={handleCopyNode}
          onReorder={handleReorder}
        />
        {node.expanded &&
          node.childrenIds.map((childId) => {
            const child = nodes[childId];
            if (!child || !child.visible) return null;
            return renderNode(child);
          })}
      </React.Fragment>
    );
  };

  return (
    <Box sx={{ py: 0.5 }}>
      {rootNodeIds.map((id) => {
        const node = nodes[id];
        if (!node || !node.visible) return null;
        return renderNode(node);
      })}

      {/* 添加项目按钮 - 始终可见 */}
      <Box sx={{ px: 1, pt: 0.5, pb: 0.5 }}>
        <Button
          variant="text"
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 14 }} />}
          onClick={handleAddPlatform}
          sx={{
            fontSize: '0.8rem',
            color: 'text.secondary',
            textTransform: 'none',
            width: '100%',
            justifyContent: 'flex-start',
            '&:hover': { bgcolor: 'action.hover', color: 'primary.main' },
          }}
        >
          添加项目
        </Button>
      </Box>

      {/* Add/Edit dialog */}
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: '0.95rem', pb: 1 }}>
          {!dialogTargetId
            ? (dialogMode === 'add' ? '新增项目' : '修改项目')
            : (dialogMode === 'add' ? '新增节点' : '修改节点')}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            size="small"
            margin="dense"
            label={!dialogTargetId ? '项目名称' : '名称'}
            value={dialogName}
            onChange={(e) => setDialogName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleDialogConfirm((e.target as HTMLInputElement).value);
              }
            }}
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDialogOpen(false)} size="small">
            取消
          </Button>
          <Button
            onClick={() => handleDialogConfirm()}
            variant="contained"
            size="small"
            disabled={!dialogName.trim()}
          >
            确定
          </Button>
        </DialogActions>
      </Dialog>

      {/* Connection management dialog for L3 adding Hospital */}
      <Dialog
        open={connDialogOpen}
        onClose={() => setConnDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pb: 1,
            fontSize: '0.95rem',
          }}
        >
          新增连接
          <IconButton size="small" onClick={() => setConnDialogOpen(false)} sx={{ ml: 1 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <ConnectionForm
            key={connDialogParentId || 'new-conn'}
            defaultName={nodes[connDialogParentId]?.name ?? ''}
            onSave={handleConnectionSave}
            onCancel={() => setConnDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Connection edit dialog for L4 editing Hospital */}
      <Dialog
        open={connEditDialogOpen}
        onClose={() => setConnEditDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { borderRadius: 2 } }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            pb: 1,
            fontSize: '0.95rem',
          }}
        >
          修改连接
          <IconButton size="small" onClick={() => setConnEditDialogOpen(false)} sx={{ ml: 1 }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <ConnectionForm
            key={connEditNodeId || 'edit-conn'}
            connection={
              (() => {
                const node = nodes[connEditNodeId];
                if (!node?.dbConnectionId) return undefined;
                return connections[node.dbConnectionId];
              })()
            }
            onSave={handleConnectionEditSave}
            onCancel={() => setConnEditDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontSize: '0.95rem', pb: 1 }}>
          确认删除
        </DialogTitle>
        <DialogContent>
          <Box sx={{ fontSize: '0.85rem', color: 'text.secondary' }}>
            确定要删除 "{deleteTargetName}" 及其所有子节点吗？此操作不可撤销。
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} size="small">
            取消
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            variant="contained"
            color="error"
            size="small"
          >
            删除
          </Button>
        </DialogActions>
      </Dialog>

      {/* Copy feedback snackbar */}
      <Snackbar
        open={snackbarOpen}
        autoHideDuration={2000}
        onClose={() => setSnackbarOpen(false)}
        message={snackbarMsg}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};

export default DatabaseTree;
