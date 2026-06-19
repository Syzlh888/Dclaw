import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Typography, Box, Alert, IconButton, Tooltip,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { decryptServerPasswords } from '../../services/serverService';

interface Props {
  open: boolean;
  serverId: string;
  serverName: string;
  loading?: boolean;
  onClose: () => void;
  onVerified: (data: { password?: string; bastionPassword?: string; username?: string; bastionUsername?: string }) => void;
}

const AUTO_MASK_SECONDS = 30;

const VerifyPasswordDialog: React.FC<Props> = ({ open, serverId, serverName, loading, onClose, onVerified }) => {
  const [verifyPassword, setVerifyPassword] = useState('');
  const [error, setError] = useState('');
  const [decrypted, setDecrypted] = useState<any>(null);
  const [showBastion, setShowBastion] = useState(false);
  // 每条凭据独立的显隐状态：{ [index]: boolean }
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({});
  const [countdown, setCountdown] = useState(AUTO_MASK_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setVerifyPassword('');
      setError('');
      setDecrypted(null);
      setShowBastion(false);
      setShowPasswords({});
      setCountdown(AUTO_MASK_SECONDS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (maskTimerRef.current) clearTimeout(maskTimerRef.current);
    };
  }, [open]);

  const startAutoMask = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (maskTimerRef.current) clearTimeout(maskTimerRef.current);
    setCountdown(AUTO_MASK_SECONDS);

    // 每秒更新倒计时
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // 30 秒后自动掩码
    maskTimerRef.current = setTimeout(() => {
      setShowPasswords({});
      setShowBastion(false);
      setCountdown(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }, AUTO_MASK_SECONDS * 1000);
  };

  const toggleShowPassword = (index: number) => {
    setShowPasswords(prev => {
      const next = { ...prev, [index]: !prev[index] };
      // 如果所有密码都隐藏了，刷新倒计时
      const anyVisible = Object.values(next).some(v => v) || showBastion;
      if (!anyVisible) startAutoMask();
      return next;
    });
  };

  const handleVerify = async () => {
    setError('');
    try {
      const data = await decryptServerPasswords(serverId, verifyPassword);
      if (data.error) { setError(data.error); return; }
      setDecrypted(data);
      // 默认显示所有凭据的密码
      const initialShow: Record<number, boolean> = {};
      if (data.credentials) {
        data.credentials.forEach((_: any, i: number) => { initialShow[i] = true; });
      }
      setShowPasswords(initialShow);
      setShowBastion(true);
      startAutoMask();
      onVerified(data);
    } catch (err: any) {
      setError(err.message || '验证失败');
    }
  };

  const handleCopy = (val: string) => {
    navigator.clipboard.writeText(val);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>
        查看密码 - {serverName}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {!decrypted ? (
          <Box sx={{ mt: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              请输入当前登录密码以查看明文密码
            </Typography>
            <TextField
              fullWidth size="small" type="password"
              autoComplete="new-password"
              label="登录密码"
              value={verifyPassword}
              onChange={e => setVerifyPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleVerify(); }}
              autoFocus
            />
          </Box>
        ) : (
          <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="caption" color={countdown <= 10 ? 'error.main' : 'warning.main'}>
              明文密码将在 {countdown}s 后自动掩码
            </Typography>

            {/* 多用户凭据列表 */}
            {decrypted.credentials && decrypted.credentials.length > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {decrypted.credentials.map((cred: any, i: number) => (
                  <Box key={i} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                    <Typography variant="caption" color="primary.main" sx={{ fontWeight: 600 }}>
                      凭据 {i + 1}
                    </Typography>
                    <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                      <TextField
                        size="small"
                        label="用户名"
                        fullWidth
                        value={cred.username}
                        InputProps={{ readOnly: true }}
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        size="small"
                        label="密码"
                        fullWidth
                        type={showPasswords[i] ? 'text' : 'password'}
                        value={cred.password}
                        InputProps={{ readOnly: true }}
                        sx={{ flex: 2 }}
                      />
                      <Tooltip title={showPasswords[i] ? '隐藏' : '显示'}>
                        <IconButton size="small" onClick={() => toggleShowPassword(i)}>
                          {showPasswords[i] ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="复制密码">
                        <IconButton size="small" onClick={() => handleCopy(cred.password)}><ContentCopyIcon fontSize="small" /></IconButton>
                      </Tooltip>
                    </Box>
                  </Box>
                ))}
              </Box>
            )}

            {/* 兼容旧版单凭据显示 */}
            {!decrypted.credentials && decrypted.username && (
              <Box>
                <Typography variant="caption" color="text.secondary">用户名</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField size="small" fullWidth value={decrypted.username} InputProps={{ readOnly: true }} />
                  <Tooltip title="复制"><IconButton size="small" onClick={() => handleCopy(decrypted.username)}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                </Box>
              </Box>
            )}

            {!decrypted.credentials && decrypted.password && (
              <Box>
                <Typography variant="caption" color="text.secondary">服务器密码</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    size="small" fullWidth
                    type={showPasswords[0] ? 'text' : 'password'}
                    value={decrypted.password}
                    InputProps={{ readOnly: true }}
                  />
                  <Tooltip title={showPasswords[0] ? '隐藏' : '显示'}>
                    <IconButton size="small" onClick={() => toggleShowPassword(0)}>
                      {showPasswords[0] ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="复制"><IconButton size="small" onClick={() => handleCopy(decrypted.password)}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                </Box>
              </Box>
            )}

            {decrypted.bastionUsername && (
              <Box>
                <Typography variant="caption" color="text.secondary">堡垒机用户名</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField size="small" fullWidth value={decrypted.bastionUsername} InputProps={{ readOnly: true }} />
                  <Tooltip title="复制"><IconButton size="small" onClick={() => handleCopy(decrypted.bastionUsername)}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                </Box>
              </Box>
            )}

            {decrypted.bastionPassword && (
              <Box>
                <Typography variant="caption" color="text.secondary">堡垒机密码</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <TextField
                    size="small" fullWidth
                    type={showBastion ? 'text' : 'password'}
                    value={decrypted.bastionPassword}
                    InputProps={{ readOnly: true }}
                  />
                  <Tooltip title={showBastion ? '隐藏' : '显示'}>
                    <IconButton size="small" onClick={() => { setShowBastion(!showBastion); if (!showBastion) startAutoMask(); }}>
                      {showBastion ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="复制"><IconButton size="small" onClick={() => handleCopy(decrypted.bastionPassword)}><ContentCopyIcon fontSize="small" /></IconButton></Tooltip>
                </Box>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">{decrypted ? '关闭' : '取消'}</Button>
        {!decrypted && (
          <Button variant="contained" size="small" onClick={handleVerify} disabled={loading || !verifyPassword}>
            验证
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default VerifyPasswordDialog;
