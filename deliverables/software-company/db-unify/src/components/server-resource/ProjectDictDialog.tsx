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

interface Props { open: boolean; onClose: () => void; }

const ProjectDictDialog: React.FC<Props> = ({ open, onClose }) => {
  const projects = useProjectStore(s => s.projects);
  const addProject = useProjectStore(s => s.addProject);
  const editProject = useProjectStore(s => s.editProject);
  const removeProject = useProjectStore(s => s.removeProject);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });

  useEffect(() => { if (open) loadProjects(); }, [open]);

  const handleAdd = () => {
    if (newName.trim()) { addProject(newName.trim(), newShortName.trim()); setNewName(''); setNewShortName(''); }
  };

  const startEdit = (p: { id: string; name: string; shortName?: string }) => {
    setEditingId(p.id);
    setEditName(p.name);
    setEditShortName(p.shortName || '');
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleSaveEdit = async (id: string) => {
    if (editName.trim()) {
      await editProject(id, { name: editName.trim(), shortName: editShortName.trim() });
    }
    setEditingId(null);
  };

  const handleDeleteClick = (id: string) => {
    setConfirmDeleteId(id);
  };

  const handleDeleteConfirm = async () => {
    if (!confirmDeleteId) return;
    try {
      await removeProject(confirmDeleteId);
      setSnackbar({ open: true, message: '项目已删除', severity: 'success' });
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || '删除失败';
      setSnackbar({ open: true, message: msg, severity: 'error' });
    }
    setConfirmDeleteId(null);
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>项目字典</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
            <TextField size="small" placeholder="项目名称" value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 2 }} />
            <TextField size="small" placeholder="简称" value={newShortName} onChange={e => setNewShortName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 1 }} />
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleAdd} sx={{ flexShrink: 0 }}>添加</Button>
          </Box>
          {projects.length === 0 ? (
            <Typography variant="body2" color="text.secondary" align="center">暂无项目</Typography>
          ) : (
            <List dense>
              {projects.map(p => (
                <ListItem key={p.id} disablePadding sx={{ mb: 0.5 }}>
                  {editingId === p.id ? (
                    <Box sx={{ display: 'flex', gap: 0.5, width: '100%', alignItems: 'center' }}>
                      <TextField size="small" value={editName} onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(p.id); }}
                        sx={{ flex: 2 }} />
                      <TextField size="small" value={editShortName} onChange={e => setEditShortName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') handleSaveEdit(p.id); }}
                        sx={{ flex: 1 }} />
                      <IconButton size="small" onClick={() => handleSaveEdit(p.id)}><CheckIcon sx={{ fontSize: 16 }} color="success" /></IconButton>
                      <IconButton size="small" onClick={cancelEdit}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
                    </Box>
                  ) : (
                    <>
                      <ListItemText
                        primary={p.shortName ? `${p.name}（${p.shortName}）` : p.name}
                        primaryTypographyProps={{ fontSize: '0.85rem' }}
                      />
                      <IconButton size="small" onClick={() => startEdit(p)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                      <IconButton size="small" onClick={() => handleDeleteClick(p.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
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
          <Typography>确定要删除此项目吗？</Typography>
          <Typography variant="body2" color="warning.main" sx={{ mt: 1 }}>
            如果该项目下有关联的工程或被服务器引用，将无法删除。
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

export default ProjectDictDialog;
