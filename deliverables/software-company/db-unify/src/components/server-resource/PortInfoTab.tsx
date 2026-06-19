import React, { useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  TextField, FormControl, InputLabel, Select, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import type { PortInfo } from '../../types/server';
import { useServerStore } from '../../stores/serverStore';

interface Props { serverId: string; ports: PortInfo[]; }

const PROTOCOLS = ['TCP', 'UDP', 'HTTP', 'HTTPS', 'Other'];
const PORT_TYPES = ['数据库', '应用', '中间件', '其它'];

interface PortEntry {
  port: number | '';
  protocol: string;
  type: string;
  serviceName: string;
  notes: string;
}

export default function PortInfoTab({ serverId, ports }: Props) {
  const add = useServerStore(s => s.addPort);
  const upd = useServerStore(s => s.updatePort);
  const del = useServerStore(s => s.deletePort);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<PortInfo | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [entries, setEntries] = useState<PortEntry[]>([{ port: '', protocol: 'TCP', type: '', serviceName: '', notes: '' }]);

  const openAdd = () => {
    setEditItem(null);
    setSaveError('');
    setEntries([{ port: '', protocol: 'TCP', type: '', serviceName: '', notes: '' }]);
    setOpen(true);
  };
  const openEdit = (item: PortInfo) => {
    setEditItem(item);
    setSaveError('');
    setEntries([{
      port: item.port, protocol: item.protocol, type: item.type || '',
      serviceName: item.serviceName, notes: item.notes || '',
    }]);
    setOpen(true);
  };

  const addEntry = () => setEntries([...entries, { port: '', protocol: 'TCP', type: '', serviceName: '', notes: '' }]);
  const removeEntry = (i: number) => setEntries(entries.filter((_, idx) => idx !== i));
  const updateEntry = (i: number, field: keyof PortEntry, val: string | number) => {
    const next = [...entries];
    (next[i] as any)[field] = val;
    setEntries(next);
  };

  const handleSave = async () => {
    const valid = entries.filter(e => e.port !== '' && e.serviceName.trim());
    if (valid.length === 0) { setOpen(false); return; }
    setSaving(true);
    setSaveError('');
    try {
      if (editItem) {
        const e = entries[0];
        if (e.port !== '' && e.serviceName.trim()) {
          await upd(serverId, editItem.id, { port: e.port, protocol: e.protocol, type: e.type, serviceName: e.serviceName.trim(), notes: e.notes });
        }
      } else {
        for (const e of valid) {
          await add(serverId, { port: e.port, protocol: e.protocol, type: e.type, serviceName: e.serviceName.trim(), notes: e.notes });
        }
      }
      setOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || '保存失败';
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>端口信息 ({ports.length})</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={openAdd}>新增</Button>
      </Box>
      {ports.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>暂无端口记录</Typography>
      ) : (
        <TableContainer><Table size="small">
          <TableHead><TableRow>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>端口</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>协议</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>类型</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>服务名称</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>备注</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>操作</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {ports.map(p => (
              <TableRow key={p.id}>
                <TableCell><Chip label={p.port} size="small" color="primary" variant="outlined" sx={{ fontSize: '0.75rem' }} /></TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{p.protocol}</TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{p.type || '-'}</TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{p.serviceName}</TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{p.notes || '-'}</TableCell>
                <TableCell>
                  <IconButton size="small" onClick={() => openEdit(p)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                  <IconButton size="small" onClick={() => { if (confirm('确认删除？')) del(serverId, p.id); }}><DeleteIcon sx={{ fontSize: 16, color: 'error.main' }} /></IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></TableContainer>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editItem ? '编辑端口' : '新增端口'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            {saveError && <Alert severity="error" sx={{ mb: 0.5 }}>{saveError}</Alert>}
            {!editItem && entries.length > 1 && (
              <Typography variant="caption" color="text.secondary">
                已添加 {entries.filter(e => e.port !== '' && e.serviceName.trim()).length} 个有效端口 / 共 {entries.length} 行
              </Typography>
            )}
            {entries.map((entry, i) => (
              <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                <TextField size="small" label="端口号" type="number" value={entry.port} onChange={e => updateEntry(i, 'port', Number(e.target.value))} sx={{ flex: 1, minWidth: 90 }} />
                <FormControl size="small" sx={{ flex: 1, minWidth: 90 }}>
                  <InputLabel>协议</InputLabel>
                  <Select value={entry.protocol} label="协议" onChange={e => updateEntry(i, 'protocol', e.target.value)}>
                    {PROTOCOLS.map(p => <MenuItem key={p} value={p}>{p}</MenuItem>)}
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ flex: 1, minWidth: 100 }}>
                  <InputLabel>类型</InputLabel>
                  <Select value={entry.type} label="类型" onChange={e => updateEntry(i, 'type', e.target.value)}>
                    {PORT_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField size="small" label="服务名称" value={entry.serviceName} onChange={e => updateEntry(i, 'serviceName', e.target.value)} sx={{ flex: 1.5, minWidth: 100 }} />
                <TextField size="small" label="备注" value={entry.notes} onChange={e => updateEntry(i, 'notes', e.target.value)} sx={{ flex: 1 }} />
                {!editItem && entries.length > 1 && (
                  <IconButton size="small" onClick={() => removeEntry(i)} sx={{ color: 'error.main', flexShrink: 0 }}><DeleteIcon sx={{ fontSize: 18 }} /></IconButton>
                )}
              </Box>
            ))}
            {!editItem && (
              <Button size="small" variant="outlined" onClick={addEntry} sx={{ alignSelf: 'flex-start' }}>+ 添加行</Button>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setOpen(false)}>取消</Button>
          <Button size="small" variant="contained" onClick={handleSave} disabled={saving}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
