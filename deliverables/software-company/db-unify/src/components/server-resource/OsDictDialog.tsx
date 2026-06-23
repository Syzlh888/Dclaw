import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, List, ListItem, ListItemText, IconButton, Typography, Box,
  Snackbar, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import CheckIcon from '@mui/icons-material/Check';
import CloseIcon from '@mui/icons-material/Close';
import { useSystemConfigStore } from '../../stores/systemConfigStore';
import { checkDictUsage } from '../../services/serverService';

interface Props { open: boolean; onClose: () => void; }

const OsDictDialog: React.FC<Props> = ({ open, onClose }) => {
  const osList = useSystemConfigStore(s => s.osList);
  const loadOsDict = useSystemConfigStore(s => s.loadOsDict);
  const saveOsDict = useSystemConfigStore(s => s.saveOsDict);
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');
  const [confirmDeleteName, setConfirmDeleteName] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  useEffect(() => { if (open) loadOsDict(); }, [open]);

  const handleAdd = () => {
    if (newName.trim() && !osList.some(o => o.name === newName.trim())) {
      saveOsDict([...osList, { name: newName.trim(), shortName: newShortName.trim() }]);
      setNewName(''); setNewShortName('');
    }
  };

  const startEdit = (item: { name: string; shortName: string }) => {
    setEditingName(item.name);
    setEditName(item.name);
    setEditShortName(item.shortName || '');
  };

  const cancelEdit = () => { setEditingName(null); };

  const handleSaveEdit = () => {
    if (!editName.trim() || !editingName) return;
    const next = osList.map(o =>
      o.name === editingName ? { name: editName.trim(), shortName: editShortName.trim() } : o
    );
    saveOsDict(next);
    setEditingName(null);
  };

  const handleDeleteClick = (name: string) => {
    setConfirmDeleteName(name);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteName) return;
    const name = confirmDeleteName;
    try {
      // 检查是否被服务器引用
      const usage = await checkDictUsage('os', name);
      if (usage.inUse) {
        const serverNames = usage.serverNames?.join('、') || '';
        setSnackbar({
          open: true,
          message: `无法删除 "${name}"，有 ${usage.count} 台服务器使用此操作系统${serverNames ? `（如：${serverNames}）` : ''}`,
          severity: 'error',
        });
      } else {
        saveOsDict(osList.filter(o => o.name !== name));
        setSnackbar({ open: true, message: `"${name}" 已删除`, severity: 'success' });
      }
    } catch (e: any) {
      setSnackbar({ open: true, message: e?.response?.data?.error || e?.message || '删除失败', severity: 'error' });
    }
    setConfirmDeleteName(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>操作系统字典</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
            <TextField size="small" placeholder="操作系统名称" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 2 }} />
            <TextField size="small" placeholder="简称" value={newShortName} onChange={e => setNewShortName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 1 }} />
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleAdd} sx={{ flexShrink: 0 }}>添加</Button>
          </Box>
          {osList.length === 0 ? (
            <Typography variant="body2" color="text.secondary" align="center">暂无可选操作系统</Typography>
          ) : (
            <List dense>
              {osList.map(item => (
                <ListItem key={item.name} disablePadding sx={{ mb: 0.5 }}>
                  {editingName === item.name ? (
                    <Box sx={{ display: 'flex', gap: 0.5, width: '100%', alignItems: 'center' }}>
                      <TextField size="small" value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); }}
                        sx={{ flex: 2 }} />
                      <TextField size="small" value={editShortName} onChange={e => setEditShortName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(); }}
                        sx={{ flex: 1 }} />
                      <IconButton size="small" onClick={handleSaveEdit}><CheckIcon sx={{ fontSize: 16 }} color="success" /></IconButton>
                      <IconButton size="small" onClick={cancelEdit}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
                    </Box>
                  ) : (
                    <>
                      <ListItemText
                        primary={item.shortName ? `${item.name}（${item.shortName}）` : item.name}
                        primaryTypographyProps={{ fontSize: '0.85rem' }}
                      />
                      <IconButton size="small" onClick={() => startEdit(item)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                      <IconButton size="small" onClick={() => handleDeleteClick(item.name)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                    </>
                  )}
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions><Button size="small" onClick={onClose}>关闭</Button></DialogActions>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={!!confirmDeleteName} onClose={() => setConfirmDeleteName(null)} maxWidth="xs">
        <DialogContent>
          <Typography>确定要删除 "<strong>{confirmDeleteName}</strong>" 吗？</Typography>
          <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
            如果有服务器使用了此操作系统，将会阻止删除。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setConfirmDeleteName(null)}>取消</Button>
          <Button size="small" variant="contained" color="error" onClick={handleDeleteConfirm}>确认删除</Button>
        </DialogActions>
      </Dialog>

      {/* 提示消息 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} onClose={() => setSnackbar(s => ({ ...s, open: false }))} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </>
  );
};

export default OsDictDialog;
