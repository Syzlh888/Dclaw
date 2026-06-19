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
import { useSystemConfigStore } from '../../stores/systemConfigStore';

interface Props { open: boolean; onClose: () => void; }

const ServerLocationDictDialog: React.FC<Props> = ({ open, onClose }) => {
  const list = useSystemConfigStore(s => s.serverLocationList);
  const loadDict = useSystemConfigStore(s => s.loadServerLocationDict);
  const saveDict = useSystemConfigStore(s => s.saveServerLocationDict);
  const [newName, setNewName] = useState('');
  const [newShortName, setNewShortName] = useState('');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editShortName, setEditShortName] = useState('');

  useEffect(() => { if (open) loadDict(); }, [open]);

  const handleAdd = () => {
    if (newName.trim() && !list.some(o => o.name === newName.trim())) {
      saveDict([...list, { name: newName.trim(), shortName: newShortName.trim() }]);
      setNewName(''); setNewShortName('');
    }
  };

  const handleDelete = (name: string) => {
    saveDict(list.filter(o => o.name !== name));
  };

  const startEdit = (item: { name: string; shortName: string }) => {
    setEditingName(item.name);
    setEditName(item.name);
    setEditShortName(item.shortName || '');
  };

  const cancelEdit = () => { setEditingName(null); };

  const handleSaveEdit = () => {
    if (!editName.trim() || !editingName) return;
    const next = list.map(o =>
      o.name === editingName ? { name: editName.trim(), shortName: editShortName.trim() } : o
    );
    saveDict(next);
    setEditingName(null);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>服务器位置字典</DialogTitle>
      <DialogContent>
        <Box sx={{ display: 'flex', gap: 1, mb: 2, alignItems: 'center' }}>
          <TextField size="small" placeholder="服务器位置名称" value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 2 }} />
          <TextField size="small" placeholder="简称" value={newShortName} onChange={e => setNewShortName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }} sx={{ flex: 1 }} />
          <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleAdd} sx={{ flexShrink: 0 }}>添加</Button>
        </Box>
        {list.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center">暂无可选位置，请添加</Typography>
        ) : (
          <List dense>
            {list.map(item => (
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
                    <IconButton size="small" onClick={() => handleDelete(item.name)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
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

export default ServerLocationDictDialog;
