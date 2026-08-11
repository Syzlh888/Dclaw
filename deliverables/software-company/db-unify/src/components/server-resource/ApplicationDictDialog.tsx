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
import { useProjectStore } from '../../stores/projectStore';

interface Props { open: boolean; engineeringId: string; onClose: () => void; }

const ApplicationDictDialog: React.FC<Props> = ({ open, engineeringId, onClose }) => {
  const applications = useProjectStore(s => s.getApplicationsByEngineering(engineeringId));
  const addApp = useProjectStore(s => s.addApplication);
  const editApp = useProjectStore(s => s.editApplication);
  const removeApp = useProjectStore(s => s.removeApplication);
  const loadApps = useProjectStore(s => s.loadApplications);
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  useEffect(() => { if (open && engineeringId) loadApps(engineeringId); }, [open, engineeringId]);

  const handleAdd = () => {
    if (newName.trim()) { addApp(engineeringId, newName.trim(), newShortName.trim()); setNewName(''); setNewShortName(''); }
  };

  const startEdit = (a: { id: string; name: string; shortName?: string }) => {
    setEditingId(a.id);
    setEditName(a.name);
    setEditShortName(a.shortName || '');
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleSaveEdit = async (id: string) => {
    if (editName.trim()) {
      await editApp(id, { name: editName.trim(), shortName: editShortName.trim() });
    }
    setEditingId(null);
  };

  const handleDeleteClick = (id: string) => {
    setConfirmDeleteId(id);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteId) return;
    try {
      await removeApp(confirmDeleteId);
      setSnackbar({ open: true, message: '应用已删除', severity: 'success' });
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '删除失败';
      setSnackbar({ open: true, message: msg, severity: 'error' });
    }
    setConfirmDeleteId(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: 'calc(1rem * var(--dc-scale, 1))' }}>应用字典</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
            <TextField size="small" placeholder="应用名称" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 2 }} />
            <TextField size="small" placeholder="简称" value={newShortName} onChange={e => setNewShortName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 1 }} />
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleAdd} sx={{ flexShrink: 0 }}>添加</Button>
          </Box>
          {applications.length === 0 ? (
            <Typography variant="body2" color="text.secondary" align="center">暂无应用</Typography>
          ) : (
            <List dense>
              {applications.map(a => (
                <ListItem key={a.id} disablePadding sx={{ mb: 0.5 }}>
                  {editingId === a.id ? (
                    <Box sx={{ display: 'flex', gap: 0.5, width: '100%', alignItems: 'center' }}>
                      <TextField size="small" value={editName} onChange={ev => setEditName(ev.target.value)}
                        onKeyDown={ev => { if (ev.key === 'Enter') handleSaveEdit(a.id); }}
                        sx={{ flex: 2 }} />
                      <TextField size="small" value={editShortName} onChange={ev => setEditShortName(ev.target.value)}
                        onKeyDown={ev => { if (ev.key === 'Enter') handleSaveEdit(a.id); }}
                        sx={{ flex: 1 }} />
                      <IconButton size="small" onClick={() => handleSaveEdit(a.id)}><CheckIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} color="success" /></IconButton>
                      <IconButton size="small" onClick={cancelEdit}><CloseIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /></IconButton>
                    </Box>
                  ) : (
                    <>
                      <ListItemText
                        primary={a.shortName ? `${a.name}（${a.shortName}）` : a.name}
                        primaryTypographyProps={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }}
                      />
                      <IconButton size="small" onClick={() => startEdit(a)}><EditIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /></IconButton>
                      <IconButton size="small" onClick={() => handleDeleteClick(a.id)}><DeleteIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /></IconButton>
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
      <Dialog open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} maxWidth="xs">
        <DialogContent>
          <Typography>确定要删除此应用吗？</Typography>
          <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
            如果该应用被服务器引用，将无法删除。
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setConfirmDeleteId(null)}>取消</Button>
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

export default ApplicationDictDialog;
