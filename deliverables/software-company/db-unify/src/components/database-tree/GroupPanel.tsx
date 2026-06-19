import React, { useState } from 'react';
import {
  Box, Typography, Button, IconButton, Tooltip, TextField,
  Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItem, ListItemButton, ListItemText,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { useGroupStore } from '../../stores/groupStore';
import { useTreeStore } from '../../stores/treeStore';

const GroupPanel: React.FC = () => {
  const groups = useGroupStore((s) => s.groups);
  const activeGroupId = useGroupStore((s) => s.activeGroupId);
  const createGroup = useGroupStore((s) => s.createGroup);
  const deleteGroup = useGroupStore((s) => s.deleteGroup);
  const renameGroup = useGroupStore((s) => s.renameGroup);
  const setActiveGroup = useGroupStore((s) => s.setActiveGroup);
  const selectedDbIds = useTreeStore((s) => s.selectedDbIds);
  const nodes = useTreeStore((s) => s.nodes);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // 获取当前勾选的连接实例信息用于分组创建预览
  const selectedHospitals = Object.values(nodes).filter(
    (n) => n.type === 'hospital' && n.dbConnectionId && selectedDbIds.includes(n.dbConnectionId)
  );

  const handleCreateGroup = () => {
    if (!groupName.trim() || selectedDbIds.length === 0) return;
    const id = createGroup(groupName.trim(), selectedDbIds);
    setActiveGroup(id);
    setGroupName('');
    setCreateDialogOpen(false);
  };

  const handleOpenRename = (id: string, name: string) => {
    setRenameTarget({ id, name });
    setRenameValue(name);
    setRenameDialogOpen(true);
  };

  const handleRenameConfirm = () => {
    if (renameTarget && renameValue.trim()) {
      renameGroup(renameTarget.id, renameValue.trim());
    }
    setRenameDialogOpen(false);
    setRenameTarget(null);
  };

  const handleToggleActive = (id: string) => {
    setActiveGroup(activeGroupId === id ? null : id);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 头部：标题 + 新建按钮 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.5, py: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <GroupWorkIcon fontSize="small" /> 临时分组
        </Typography>
        <Tooltip title={selectedDbIds.length === 0 ? '请先在树中勾选数据库' : '从勾选节点创建分组'}>
          <span>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setGroupName('');
                setCreateDialogOpen(true);
              }}
              disabled={selectedDbIds.length === 0}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              新建分组
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* 分组列表 */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {groups.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.disabled', px: 2 }}>
            <GroupWorkIcon sx={{ fontSize: 36, mb: 1, opacity: 0.3 }} />
            <Typography variant="caption" display="block">
              暂无分组
            </Typography>
            <Typography variant="caption" display="block" sx={{ mt: 0.5, mb: 2 }}>
              先在「数据库」页中勾选连接实例，<br />再点击下方按钮创建临时分组
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setGroupName('');
                setCreateDialogOpen(true);
              }}
              disabled={selectedDbIds.length === 0}
              sx={{ textTransform: 'none', fontSize: '0.75rem' }}
            >
              {selectedDbIds.length === 0 ? '暂无勾选 (需先勾选数据库)' : '创建分组'}
            </Button>
          </Box>
        ) : (
          <List dense disablePadding>
            {groups.map((group) => {
              const isActive = group.id === activeGroupId;
              return (
                <ListItem
                  key={group.id}
                  disablePadding
                  secondaryAction={
                    <Box sx={{ display: 'flex', gap: 0.25 }}>
                      <Tooltip title="重命名">
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); handleOpenRename(group.id, group.name); }}
                          sx={{ p: 0.25 }}
                        >
                          <EditIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <IconButton
                          size="small"
                          onClick={(e) => { e.stopPropagation(); deleteGroup(group.id); }}
                          sx={{ p: 0.25 }}
                        >
                          <DeleteIcon sx={{ fontSize: 13 }} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  }
                  sx={{
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    bgcolor: isActive ? 'primary.50' : 'transparent',
                  }}
                >
                  <ListItemButton onClick={() => handleToggleActive(group.id)} sx={{ py: 1, px: 1.5 }}>
                    {isActive ? (
                      <RadioButtonCheckedIcon sx={{ fontSize: 16, color: 'primary.main', mr: 1 }} />
                    ) : (
                      <RadioButtonUncheckedIcon sx={{ fontSize: 16, color: 'text.disabled', mr: 1 }} />
                    )}
                    <ListItemText
                      primary={
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Typography variant="body2" sx={{ fontSize: '0.85rem', fontWeight: isActive ? 600 : 400 }}>
                            {group.name}
                          </Typography>
                          {isActive && (
                            <Chip label="当前执行" size="small" color="primary" sx={{ fontSize: '0.65rem', height: 18 }} />
                          )}
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {group.dbConnectionIds.length} 个数据库 · {new Date(group.createdAt).toLocaleDateString('zh-CN')}
                        </Typography>
                      }
                      primaryTypographyProps={{ fontSize: '0.85rem' }}
                      secondaryTypographyProps={{ fontSize: '0.7rem' }}
                    />
                  </ListItemButton>
                </ListItem>
              );
            })}
          </List>
        )}
      </Box>

      {/* 当前选择提示 */}
      {activeGroupId && (
        <Box
          sx={{
            px: 1.5, py: 1,
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'primary.50',
          }}
        >
          <Typography variant="caption" color="primary.main" sx={{ fontWeight: 500 }}>
            当前使用分组执行 SQL，树中勾选将暂时被忽略
          </Typography>
        </Box>
      )}

      {/* 创建分组对话框 */}
      <Dialog open={createDialogOpen} onClose={() => setCreateDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem', py: 1 }}>新建临时分组</DialogTitle>
        <DialogContent dividers sx={{ py: 1.5 }}>
          <TextField
            autoFocus
            label="分组名称"
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            size="small"
            fullWidth
            placeholder="例如：核心生产库"
            sx={{ mb: 1.5 }}
            inputProps={{ style: { paddingTop: 6, paddingBottom: 6 } }}
          />
          <Typography variant="caption" color="text.secondary">
            将包含以下 {selectedDbIds.length} 个已勾选的数据库：
          </Typography>
          <Box
            sx={{
              mt: 1, maxHeight: 160, overflow: 'auto',
              border: '1px solid', borderColor: 'divider', borderRadius: 1,
              bgcolor: '#F5F5F5', p: 1,
            }}
          >
            {selectedHospitals.length === 0 ? (
              <Typography variant="caption" color="text.disabled">暂未勾选任何数据库</Typography>
            ) : (
              selectedHospitals.map((h) => (
                <Typography key={h.id} variant="caption" display="block" sx={{ fontSize: '0.7rem', lineHeight: 1.6 }}>
                  {h.name}
                </Typography>
              ))
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreateDialogOpen(false)} size="small">取消</Button>
          <Button
            onClick={handleCreateGroup}
            variant="contained"
            size="small"
            disabled={!groupName.trim() || selectedDbIds.length === 0}
          >
            创建并激活
          </Button>
        </DialogActions>
      </Dialog>

      {/* 重命名对话框 */}
      <Dialog open={renameDialogOpen} onClose={() => setRenameDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem', py: 1 }}>重命名分组</DialogTitle>
        <DialogContent dividers sx={{ py: 1.5 }}>
          <TextField
            autoFocus
            label="分组名称"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            size="small"
            fullWidth
            inputProps={{ style: { paddingTop: 6, paddingBottom: 6 } }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialogOpen(false)} size="small">取消</Button>
          <Button onClick={handleRenameConfirm} variant="contained" size="small" disabled={!renameValue.trim()}>
            确认
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default GroupPanel;
