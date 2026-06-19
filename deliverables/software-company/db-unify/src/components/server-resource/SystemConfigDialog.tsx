import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Alert, Typography, Box,
} from '@mui/material';
import { useSystemConfigStore } from '../../stores/systemConfigStore';

interface Props { open: boolean; onClose: () => void; }

const SystemConfigDialog: React.FC<Props> = ({ open, onClose }) => {
  const hasSecondaryPassword = useSystemConfigStore(s => s.hasSecondaryPassword);
  const loadConfig = useSystemConfigStore(s => s.loadConfig);
  const setSecondaryPassword = useSystemConfigStore(s => s.setSecondaryPassword);

  const [oldPwd, setOldPwd] = useState('');
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [severity, setSeverity] = useState<'success' | 'error'>('success');

  useEffect(() => { if (open) { loadConfig(); setOldPwd(''); setPwd(''); setConfirm(''); setMsg(''); } }, [open]);

  const handleSave = async () => {
    setMsg('');
    if (pwd !== confirm) { setMsg('两次输入不一致'); setSeverity('error'); return; }
    try {
      await setSecondaryPassword(pwd, hasSecondaryPassword ? oldPwd : undefined);
      setMsg('二次验证密码已设置'); setSeverity('success');
      setOldPwd(''); setPwd(''); setConfirm('');
      loadConfig();
    } catch { setMsg('设置失败'); setSeverity('error'); }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>系统设置</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5, fontSize: '0.85rem' }}>
          二次验证密码配置
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          查看服务器明文密码时需验证此密码（独立于登录密码）
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {hasSecondaryPassword && (
            <TextField size="small" type="password" autoComplete="new-password" label="当前密码"
              value={oldPwd} onChange={e => setOldPwd(e.target.value)}
              helperText="修改密码需先验证当前密码" />
          )}
          <TextField size="small" type="password" autoComplete="new-password" label={hasSecondaryPassword ? '新密码' : '二次验证密码'}
            value={pwd} onChange={e => setPwd(e.target.value)}
            helperText={hasSecondaryPassword ? '留空则不修改' : '尚未设置'} />
          <TextField size="small" type="password" autoComplete="new-password" label="确认密码"
            value={confirm} onChange={e => setConfirm(e.target.value)} />
        </Box>
        {msg && <Alert severity={severity} sx={{ mt: 1.5 }}>{msg}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button size="small" onClick={onClose}>关闭</Button>
        <Button size="small" variant="contained" onClick={handleSave} disabled={!pwd}>保存</Button>
      </DialogActions>
    </Dialog>
  );
};

export default SystemConfigDialog;
