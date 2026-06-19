import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, List, ListItem, ListItemText, IconButton, Typography, Box,
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

  return (
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
                    <IconButton size="small" onClick={() => removeProject(p.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                  </>
                )}
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions><Button size="small" onClick={onClose}>关闭</Button></DialogActions>
    </Dialog>
  );
};

export default ProjectDictDialog;
