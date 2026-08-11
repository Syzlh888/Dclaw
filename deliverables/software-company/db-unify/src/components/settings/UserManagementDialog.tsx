/**
 * 用户管理弹窗
 * 列出/新建/编辑/删除/重置密码/启用禁用
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Tooltip, TextField, Chip, Alert, MenuItem, Select,
  FormControl, InputLabel, OutlinedInput, Checkbox, ListItemText, Stack,
  CircularProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import LockResetIcon from '@mui/icons-material/LockReset';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';
import GroupIcon from '@mui/icons-material/Group';
import { apiFetch } from '../../services/apiClient';

interface UserRow {
  id: string;
  username: string;
  display_name?: string;
  email?: string;
  phone?: string;
  status: string;
  last_login_at: string | null;
  roles: string[];
}
interface RoleRow { id: string; code: string; name: string; }

interface Props { open: boolean; onClose: () => void; }

const emptyForm = {
  id: '',
  username: '',
  password: '',
  displayName: '',
  email: '',
  phone: '',
  roles: [] as string[],
  status: 'active',
};

export default function UserManagementDialog({ open, onClose }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [isCreate, setIsCreate] = useState(true);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState<UserRow | null>(null);
  const [resetPwd, setResetPwd] = useState('');
  const [resetError, setResetError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [u, r] = await Promise.all([
        apiFetch('/api/users').then(x => x.json()),
        apiFetch('/api/roles').then(x => x.json()),
      ]);
      setUsers(u.users || []);
      setRoles(r.roles || []);
    } catch (e: any) {
      setError(e?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (open) loadAll(); }, [open, loadAll]);

  const handleCreate = () => {
    setIsCreate(true);
    setForm(emptyForm);
    setFormError('');
    setEditOpen(true);
  };
  const handleEdit = (u: UserRow) => {
    setIsCreate(false);
    setForm({
      id: u.id,
      username: u.username,
      password: '',
      displayName: u.display_name || '',
      email: u.email || '',
      phone: u.phone || '',
      roles: u.roles || [],
      status: u.status || 'active',
    });
    setFormError('');
    setEditOpen(true);
  };

  const handleSave = async () => {
    setFormError(''); setSaving(true);
    try {
      if (isCreate) {
        if (!form.username || form.username.length < 3) throw new Error('用户名至少 3 位');
        if (!form.password || form.password.length < 8) throw new Error('密码至少 8 位');
        const r = await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            username: form.username,
            password: form.password,
            displayName: form.displayName,
            email: form.email,
            phone: form.phone,
            roles: form.roles,
          }),
        });
        if (!r.ok) throw new Error((await r.json()).error || '创建失败');
      } else {
        const r = await apiFetch(`/api/users/${form.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            displayName: form.displayName,
            email: form.email,
            phone: form.phone,
            status: form.status,
            roles: form.roles,
          }),
        });
        if (!r.ok) throw new Error((await r.json()).error || '更新失败');
      }
      setEditOpen(false);
      await loadAll();
    } catch (e: any) {
      setFormError(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (u: UserRow) => {
    if (!confirm(`确定删除用户 "${u.username}"？`)) return;
    const r = await apiFetch(`/api/users/${u.id}`, { method: 'DELETE' });
    if (!r.ok) { alert((await r.json()).error || '删除失败'); return; }
    await loadAll();
  };

  const handleToggleStatus = async (u: UserRow) => {
    const r = await apiFetch(`/api/users/${u.id}/toggle-status`, { method: 'POST' });
    if (!r.ok) { alert((await r.json()).error || '操作失败'); return; }
    await loadAll();
  };

  const openReset = (u: UserRow) => {
    setResetTarget(u); setResetPwd(''); setResetError(''); setResetOpen(true);
  };
  const handleReset = async () => {
    if (!resetTarget) return;
    if (resetPwd.length < 8) { setResetError('新密码至少 8 位'); return; }
    const r = await apiFetch(`/api/users/${resetTarget.id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword: resetPwd }),
    });
    if (!r.ok) { setResetError((await r.json()).error || '重置失败'); return; }
    setResetOpen(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ sx: { height: '85vh' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider', py: 1.5 }}>
        <GroupIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600}>用户管理</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={handleCreate}>新建用户</Button>
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
                  <TableCell>用户名</TableCell>
                  <TableCell>显示名</TableCell>
                  <TableCell>邮箱</TableCell>
                  <TableCell>电话</TableCell>
                  <TableCell>角色</TableCell>
                  <TableCell>状态</TableCell>
                  <TableCell>最后登录</TableCell>
                  <TableCell align="right">操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {users.map((u) => (
                  <TableRow key={u.id} hover>
                    <TableCell sx={{ fontWeight: 600 }}>{u.username}</TableCell>
                    <TableCell>{u.display_name || '-'}</TableCell>
                    <TableCell>{u.email || '-'}</TableCell>
                    <TableCell>{u.phone || '-'}</TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(u.roles || []).map(rc => <Chip key={rc} label={rc} size="small" />)}
                      </Stack>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={u.status === 'active' ? '启用' : u.status === 'disabled' ? '禁用' : u.status}
                        color={u.status === 'active' ? 'success' : 'default'}
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: 'calc(0.75rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
                      {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '从未登录'}
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title="编辑"><IconButton size="small" onClick={() => handleEdit(u)}><EditIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title="重置密码"><IconButton size="small" onClick={() => openReset(u)}><LockResetIcon fontSize="small" /></IconButton></Tooltip>
                      <Tooltip title={u.status === 'active' ? '禁用' : '启用'}>
                        <IconButton size="small" onClick={() => handleToggleStatus(u)}>
                          {u.status === 'active' ? <ToggleOnIcon fontSize="small" color="success" /> : <ToggleOffIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="删除">
                        <span>
                          <IconButton size="small" onClick={() => handleDelete(u)} disabled={u.username === 'admin'}>
                            <DeleteIcon fontSize="small" color={u.username === 'admin' ? 'disabled' : 'error'} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
                {users.length === 0 && (
                  <TableRow><TableCell colSpan={8} align="center" sx={{ py: 4, color: 'text.secondary' }}>暂无用户</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>

      {/* 编辑/新建弹窗 */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', fontWeight: 600 }}>
          {isCreate ? '新建用户' : `编辑用户: ${form.username}`}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {formError && <Alert severity="error" sx={{ mb: 2 }}>{formError}</Alert>}
          {/* honeypot 字段：诱导浏览器把自动填充灌到这里而不是真正的用户名/密码 */}
          <Box component="form" autoComplete="off" onSubmit={(e) => e.preventDefault()}>
            <input type="text" name="fakeusernameremembered" style={{ display: 'none' }} />
            <input type="password" name="fakepasswordremembered" style={{ display: 'none' }} />
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="用户名" size="small" fullWidth
              value={form.username} disabled={!isCreate}
              autoComplete="off"
              inputProps={{ autoComplete: 'new-password', 'data-lpignore': 'true', 'data-1p-ignore': 'true' }}
              onChange={(e) => setForm(f => ({ ...f, username: e.target.value }))} />
            {isCreate && (
              <TextField label="密码" type="password" size="small" fullWidth
                value={form.password} helperText="至少 8 位"
                autoComplete="new-password"
                inputProps={{ autoComplete: 'new-password', 'data-lpignore': 'true', 'data-1p-ignore': 'true' }}
                onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))} />
            )}
            <TextField label="显示名" size="small" fullWidth
              value={form.displayName} autoComplete="off"
              onChange={(e) => setForm(f => ({ ...f, displayName: e.target.value }))} />
            <TextField label="邮箱" size="small" fullWidth
              value={form.email} autoComplete="off"
              onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} />
            <TextField label="电话" size="small" fullWidth
              value={form.phone} autoComplete="off"
              onChange={(e) => setForm(f => ({ ...f, phone: e.target.value }))} />

            <FormControl size="small" fullWidth>
              <InputLabel>角色</InputLabel>
              <Select
                multiple
                value={form.roles}
                onChange={(e) => setForm(f => ({ ...f, roles: e.target.value as string[] }))}
                input={<OutlinedInput label="角色" />}
                renderValue={(sel) => (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap">
                    {(sel as string[]).map(c => <Chip key={c} label={c} size="small" />)}
                  </Stack>
                )}
              >
                {roles.map((r) => (
                  <MenuItem key={r.id} value={r.code}>
                    <Checkbox size="small" checked={form.roles.includes(r.code)} />
                    <ListItemText primary={r.name} secondary={r.code} />
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {!isCreate && (
              <FormControl size="small" fullWidth>
                <InputLabel>状态</InputLabel>
                <Select value={form.status} label="状态"
                  onChange={(e) => setForm(f => ({ ...f, status: e.target.value }))}>
                  <MenuItem value="active">启用</MenuItem>
                  <MenuItem value="disabled">禁用</MenuItem>
                  <MenuItem value="locked">锁定</MenuItem>
                </Select>
              </FormControl>
            )}
          </Stack>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 重置密码弹窗 */}
      <Dialog open={resetOpen} onClose={() => setResetOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', fontWeight: 600 }}>
          重置密码: {resetTarget?.username}
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          {resetError && <Alert severity="error" sx={{ mb: 2 }}>{resetError}</Alert>}
          <TextField
            autoFocus fullWidth size="small" type="password" label="新密码"
            value={resetPwd} onChange={(e) => setResetPwd(e.target.value)}
            helperText="至少 8 位"
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResetOpen(false)}>取消</Button>
          <Button variant="contained" onClick={handleReset}>确定重置</Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
