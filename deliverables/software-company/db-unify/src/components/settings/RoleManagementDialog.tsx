/**
 * 角色管理弹窗
 * 列出角色 / 新建 / 编辑基本信息 / 编辑权限矩阵 / 删除
 */
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Tooltip, TextField, Chip, Alert, Stack,
  CircularProgress, Accordion, AccordionSummary, AccordionDetails,
  Checkbox, FormControlLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SecurityIcon from '@mui/icons-material/Security';
import ShieldIcon from '@mui/icons-material/Shield';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { apiFetch } from '../../services/apiClient';

interface Role {
  id: string;
  code: string;
  name: string;
  description?: string;
  is_system?: number | boolean;
  permissions: string[];
}
interface PermissionMeta {
  code: string; module: string; name: string; sensitive: boolean;
}
interface ModuleMeta { code: string; name: string; order: number; }

interface Props { open: boolean; onClose: () => void; }

export default function RoleManagementDialog({ open, onClose }: Props) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [perms, setPerms] = useState<PermissionMeta[]>([]);
  const [modules, setModules] = useState<ModuleMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [isCreate, setIsCreate] = useState(true);
  const [form, setForm] = useState({ id: '', code: '', name: '', description: '', is_system: false });
  const [formError, setFormError] = useState('');

  const [permOpen, setPermOpen] = useState(false);
  const [permRole, setPermRole] = useState<Role | null>(null);
  const [permSelected, setPermSelected] = useState<Set<string>>(new Set());
  const [permSaving, setPermSaving] = useState(false);
  const [permError, setPermError] = useState('');
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [allExpanded, setAllExpanded] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [r, p] = await Promise.all([
        apiFetch('/api/roles').then(x => x.json()),
        apiFetch('/api/permissions').then(x => x.json()),
      ]);
      setRoles(r.roles || []);
      setPerms(p.permissions || []);
      setModules((p.modules || []).slice().sort((a: ModuleMeta, b: ModuleMeta) => a.order - b.order));
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) loadAll(); }, [open, loadAll]);

  const permsByModule = useMemo(() => {
    const m = new Map<string, PermissionMeta[]>();
    for (const p of perms) {
      if (!m.has(p.module)) m.set(p.module, []);
      m.get(p.module)!.push(p);
    }
    return m;
  }, [perms]);

  const handleCreate = () => {
    setIsCreate(true);
    setForm({ id: '', code: '', name: '', description: '', is_system: false });
    setFormError('');
    setEditOpen(true);
  };
  const handleEdit = (r: Role) => {
    setIsCreate(false);
    setForm({
      id: r.id, code: r.code, name: r.name,
      description: r.description || '', is_system: !!r.is_system,
    });
    setFormError('');
    setEditOpen(true);
  };
  const handleSave = async () => {
    setFormError('');
    try {
      if (isCreate) {
        if (!form.code || !form.name) throw new Error('code 和 name 不能为空');
        const r = await apiFetch('/api/roles', {
          method: 'POST',
          body: JSON.stringify({ code: form.code, name: form.name, description: form.description }),
        });
        if (!r.ok) throw new Error((await r.json()).error || '创建失败');
      } else {
        const r = await apiFetch(`/api/roles/${form.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: form.name, description: form.description }),
        });
        if (!r.ok) throw new Error((await r.json()).error || '更新失败');
      }
      setEditOpen(false);
      await loadAll();
    } catch (e: any) {
      setFormError(e?.message || '保存失败');
    }
  };

  const handleDelete = async (r: Role) => {
    if (r.is_system) return;
    if (!confirm(`确定删除角色 "${r.name}"？`)) return;
    const resp = await apiFetch(`/api/roles/${r.id}`, { method: 'DELETE' });
    if (!resp.ok) { alert((await resp.json()).error || '删除失败'); return; }
    await loadAll();
  };

  const openPermMatrix = (r: Role) => {
    setPermRole(r);
    setPermSelected(new Set(r.permissions || []));
    setPermError('');
    // 默认全部展开
    setExpandedModules(new Set(modules.map(m => m.code)));
    setAllExpanded(true);
    setPermOpen(true);
  };
  const toggleAllExpand = () => {
    if (allExpanded) {
      setExpandedModules(new Set());
      setAllExpanded(false);
    } else {
      setExpandedModules(new Set(modules.map(m => m.code)));
      setAllExpanded(true);
    }
  };
  const selectAllPerms = () => setPermSelected(new Set(perms.map(p => p.code)));
  const clearAllPerms = () => setPermSelected(new Set());
  const togglePerm = (code: string) => {
    setPermSelected(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const toggleModule = (moduleCode: string) => {
    const modPerms = permsByModule.get(moduleCode) || [];
    const allSelected = modPerms.every(p => permSelected.has(p.code));
    setPermSelected(prev => {
      const next = new Set(prev);
      if (allSelected) modPerms.forEach(p => next.delete(p.code));
      else modPerms.forEach(p => next.add(p.code));
      return next;
    });
  };
  const savePerms = async () => {
    if (!permRole) return;
    setPermSaving(true); setPermError('');
    try {
      const r = await apiFetch(`/api/roles/${permRole.id}/permissions`, {
        method: 'PUT',
        body: JSON.stringify({ permissions: [...permSelected] }),
      });
      if (!r.ok) throw new Error((await r.json()).error || '保存失败');
      setPermOpen(false);
      await loadAll();
    } catch (e: any) {
      setPermError(e?.message || '保存失败');
    } finally {
      setPermSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '85vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider', py: 1.5 }}>
        <ShieldIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600}>角色与权限管理</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>新建角色</Button>
      </DialogTitle>
      <DialogContent sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
        {error && <Alert severity="error" sx={{ mb: 1 }}>{error}</Alert>}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 }}>
            <CircularProgress size={28} />
          </Box>
        ) : (
          <TableContainer sx={{ flex: 1 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Code</TableCell>
                  <TableCell>名称</TableCell>
                  <TableCell>描述</TableCell>
                  <TableCell align="center">权限数</TableCell>
                  <TableCell align="center">类型</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {roles.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ fontFamily: 'monospace', fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>{r.code}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>{r.description || '-'}</TableCell>
                    <TableCell align="center">
                      <Chip size="small" label={(r.permissions || []).length} />
                    </TableCell>
                    <TableCell align="center">
                      {r.is_system
                        ? <Chip size="small" label="预置" color="primary" variant="outlined" />
                        : <Chip size="small" label="自定义" variant="outlined" />}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="编辑权限矩阵">
                        <IconButton size="small" onClick={() => openPermMatrix(r)}>
                          <SecurityIcon fontSize="small" color="primary" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="编辑基础信息">
                        <span>
                          <IconButton size="small" onClick={() => handleEdit(r)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                      <Tooltip title={r.is_system ? '预置角色不可删除' : '删除'}>
                        <span>
                          <IconButton size="small" onClick={() => handleDelete(r)} disabled={!!r.is_system}>
                            <DeleteIcon fontSize="small" color={r.is_system ? 'disabled' : 'error'} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {roles.length === 0 && (
                  <TableRow><TableCell colSpan={6} align="center" sx={{ py: 4, color: 'text.secondary' }}>暂无角色</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>

      {/* 编辑角色基本信息 */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', fontWeight: 600 }}>
          {isCreate ? '新建角色' : `编辑角色: ${form.code}`}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Code" size="small" fullWidth
              value={form.code} disabled={!isCreate}
              onChange={(e) => setForm(f => ({ ...f, code: e.target.value }))}
              helperText={isCreate ? '英文标识，如 dev / auditor' : '预置或已创建角色不可修改 code'}
            />
            <TextField label="名称" size="small" fullWidth
              value={form.name} disabled={!isCreate && form.is_system}
              onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
              helperText={!isCreate && form.is_system ? '预置角色名称不可修改' : ''}
            />
            <TextField label="描述" size="small" fullWidth multiline minRows={2}
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSave}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 权限矩阵 */}
      <Dialog open={permOpen} onClose={() => setPermOpen(false)} maxWidth="md" fullWidth
        PaperProps={{ sx: { height: '85vh' } }}>
        <DialogTitle sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', fontWeight: 600, borderBottom: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              编辑权限矩阵: {permRole?.name} ({permRole?.code})
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                已选 {permSelected.size} / {perms.length} 项
              </Typography>
            </Box>
            <Button size="small" variant="outlined" onClick={toggleAllExpand}>
              {allExpanded ? '全部折叠' : '全部展开'}
            </Button>
            <Button size="small" variant="outlined" color="primary" onClick={selectAllPerms}>全选</Button>
            <Button size="small" variant="outlined" color="inherit" onClick={clearAllPerms}>全不选</Button>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 1.5 }}>
          {permError && <Alert severity="error" sx={{ mb: 1 }}>{permError}</Alert>}
          {modules.map((m) => {
            const modPerms = permsByModule.get(m.code) || [];
            if (modPerms.length === 0) return null;
            const selectedCount = modPerms.filter(p => permSelected.has(p.code)).length;
            const allSelected = selectedCount === modPerms.length;
            const partial = selectedCount > 0 && !allSelected;
            return (
              <Accordion key={m.code} disableGutters
                expanded={expandedModules.has(m.code)}
                onChange={(_, isExp) => {
                  setExpandedModules(prev => {
                    const next = new Set(prev);
                    if (isExp) next.add(m.code); else next.delete(m.code);
                    return next;
                  });
                }}
                sx={{ '&:before': { display: 'none' }, boxShadow: 0, border: '1px solid', borderColor: 'divider', mb: 0.5 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon fontSize="small" />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center' } }}>
                  <FormControlLabel
                    onClick={(e) => e.stopPropagation()}
                    control={
                      <Checkbox size="small" checked={allSelected} indeterminate={partial}
                        onChange={() => toggleModule(m.code)} onClick={(e) => e.stopPropagation()} />
                    }
                    label={
                      <Typography variant="body2" fontWeight={600}>
                        {m.name}
                        <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                          {selectedCount} / {modPerms.length}
                        </Typography>
                      </Typography>
                    }
                  />
                </AccordionSummary>
                <AccordionDetails sx={{ pt: 0, pl: 4 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 0 }}>
                    {modPerms.map((p) => (
                      <FormControlLabel key={p.code}
                        control={<Checkbox size="small" checked={permSelected.has(p.code)} onChange={() => togglePerm(p.code)} sx={p.sensitive ? { color: 'error.main', '&.Mui-checked': { color: 'error.main' } } : undefined} />}
                        label={
                          <Box>
                            <Typography variant="body2" component="span" sx={p.sensitive ? { color: 'error.main', fontWeight: 600 } : undefined}>{p.name}</Typography>
                            {p.sensitive && <Chip label="敏感" size="small" color="error" sx={{ ml: 0.5, height: 16, fontSize: 'calc(0.65rem * var(--dc-scale, 1))' }} />}
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontFamily: 'monospace' }}>{p.code}</Typography>
                          </Box>
                        }
                      />
                    ))}
                  </Box>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </DialogContent>
        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
          <Button onClick={() => setPermOpen(false)}>取消</Button>
          <Button variant="contained" onClick={savePerms} disabled={permSaving}>
            {permSaving ? '保存中...' : '保存权限'}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
