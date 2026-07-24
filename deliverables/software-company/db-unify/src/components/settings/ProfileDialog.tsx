/**
 * 个人资料弹窗
 * 显示当前用户信息 + 修改密码
 */
import React, { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Box, Typography,
  Button, TextField, Alert, Stack, Divider, Chip, CircularProgress,
} from '@mui/material';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import LockIcon from '@mui/icons-material/Lock';
import { useAuthStore } from '../../stores/authStore';

interface Props { open: boolean; onClose: () => void; }

export default function ProfileDialog({ open, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const refresh = useAuthStore((s) => s.refresh);
  const changePassword = useAuthStore((s) => s.changePassword);

  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (open) {
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
      setError(''); setSuccess('');
      setRefreshing(true);
      refresh().finally(() => setRefreshing(false));
    }
  }, [open, refresh]);

  const handleSubmit = async () => {
    setError(''); setSuccess('');
    if (!oldPwd || !newPwd) { setError('请输入旧密码和新密码'); return; }
    if (newPwd.length < 8) { setError('新密码至少 8 位'); return; }
    if (newPwd !== confirmPwd) { setError('两次输入的新密码不一致'); return; }
    if (oldPwd === newPwd) { setError('新密码不能与旧密码相同'); return; }
    setSaving(true);
    try {
      await changePassword(oldPwd, newPwd);
      setSuccess('密码修改成功');
      setOldPwd(''); setNewPwd(''); setConfirmPwd('');
    } catch (e: any) {
      setError(e?.message || '修改失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider', py: 1.5 }}>
        <AccountCircleIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600}>个人资料</Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        {refreshing ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : !user ? (
          <Alert severity="warning">未登录或获取用户信息失败</Alert>
        ) : (
          <>
            <Box sx={{ mb: 2 }}>
              <Typography variant="overline" color="text.secondary">账号信息</Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                <Row label="用户名" value={user.username} />
                <Row label="显示名" value={user.displayName || '-'} />
                <Row label="邮箱" value={user.email || '-'} />
                <Row label="电话" value={user.phone || '-'} />
                <Row label="状态" value={
                  <Chip size="small"
                    label={user.status === 'active' ? '启用' : user.status}
                    color={user.status === 'active' ? 'success' : 'default'}
                    variant="outlined" />
                } />
                <Row label="最后登录" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '首次登录'} />
                <Row label="权限数" value={<Chip size="small" label={permissions.length} />} />
              </Stack>
            </Box>

            <Divider sx={{ my: 2 }} />

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <LockIcon fontSize="small" color="action" />
                <Typography variant="overline" color="text.secondary">修改密码</Typography>
              </Box>
              {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
              {success && <Alert severity="success" sx={{ mb: 2 }}>{success}</Alert>}
              <Stack spacing={2}>
                <TextField label="当前密码" type="password" size="small" fullWidth
                  value={oldPwd} onChange={(e) => setOldPwd(e.target.value)} />
                <TextField label="新密码" type="password" size="small" fullWidth
                  value={newPwd} onChange={(e) => setNewPwd(e.target.value)}
                  helperText="至少 8 位" />
                <TextField label="确认新密码" type="password" size="small" fullWidth
                  value={confirmPwd} onChange={(e) => setConfirmPwd(e.target.value)} />
              </Stack>
            </Box>
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !user}>
          {saving ? '提交中...' : '修改密码'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ minWidth: 80 }}>{label}</Typography>
      <Typography component="div" variant="body2">{value}</Typography>
    </Box>
  );
}
