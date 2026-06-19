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

interface Props { open: boolean; projectId: string; onClose: () => void; }

const EngineeringDictDialog: React.FC<Props> = ({ open, projectId, onClose }) => {
  const engineerings = useProjectStore(s => s.getEngineeringsByProject(projectId));
  const addEngineering = useProjectStore(s => s.addEngineering);
  const editEngineering = useProjectStore(s => s.editEngineering);
  const removeEngineering = useProjectStore(s => s.removeEngineering);
  const loadEngineerings = useProjectStore(s => s.loadEngineerings);
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');

  useEffect(() => { if (open && projectId) loadEngineerings(projectId); }, [open, projectId]);

  const handleAdd = () => {
    if (newName.trim()) { addEngineering(projectId, newName.trim(), newShortName.trim()); setNewName(''); setNewShortName(''); }
  };

  const startEdit = (e: { id: string; name: string; shortName?: string }) => {
    setEditingId(e.id);
    setEditName(e.name);
    setEditShortName(e.shortName || '');
  };

  const cancelEdit = () => { setEditingId(null); };

  const handleSaveEdit = async (id: string) => {
    if (editName.trim()) {
      await editEngineering(id, { name: editName.trim(), shortName: editShortName.trim() });
    }
    setEditingId(null);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>工程字典</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
          <TextField size="small" placeholder="工程名称" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 2 }} />
          <TextField size="small" placeholder="简称" value={newShortName} onChange={e => setNewShortName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 1 }} />
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleAdd} sx={{ flexShrink: 0 }}>添加</Button>
        </Box>
        {engineerings.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center">暂无工程</Typography>
        ) : (
          <List dense>
            {engineerings.map(e => (
              <ListItem key={e.id} disablePadding sx={{ mb: 0.5 }}>
                {editingId === e.id ? (
                  <Box sx={{ display: 'flex', gap: 0.5, width: '100%', alignItems: 'center' }}>
                    <TextField size="small" value={editName} onChange={ev => setEditName(ev.target.value)}
                      onKeyDown={ev => { if (ev.key === 'Enter') handleSaveEdit(e.id); }}
                      sx={{ flex: 2 }} />
                    <TextField size="small" value={editShortName} onChange={ev => setEditShortName(ev.target.value)}
                      onKeyDown={ev => { if (ev.key === 'Enter') handleSaveEdit(e.id); }}
                      sx={{ flex: 1 }} />
                    <IconButton size="small" onClick={() => handleSaveEdit(e.id)}><CheckIcon sx={{ fontSize: 16 }} color="success" /></IconButton>
                    <IconButton size="small" onClick={cancelEdit}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
                  </Box>
                ) : (
                  <>
                    <ListItemText
                      primary={e.shortName ? `${e.name}（${e.shortName}）` : e.name}
                      primaryTypographyProps={{ fontSize: '0.85rem' }}
                    />
                    <IconButton size="small" onClick={() => startEdit(e)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                    <IconButton size="small" onClick={() => removeEngineering(e.id)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
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

export default EngineeringDictDialog;
