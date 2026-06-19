import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, TextField, Box, Alert, IconButton, Tooltip,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { fetchPasswordHistory, decryptPasswordHistory } from '../../services/serverService';

interface Props {
  open: boolean;
  serverId: string;
  fieldName: string;
  instanceName: string;
  onClose: () => void;
}

const AUTO_MASK_SECONDS = 30;

const InstancePwdHistoryDialog: React.FC<Props> = ({ open, serverId, fieldName, instanceName, onClose }) => {
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [decryptedItems, setDecryptedItems] = useState<any[] | null>(null);
  const [verifyPwd, setVerifyPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [countdown, setCountdown] = useState(AUTO_MASK_SECONDS);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const maskTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (open && serverId && fieldName) {
      fetchPasswordHistory(serverId, fieldName).then(d => setHistoryItems(d.history || []));
      setDecryptedItems(null);
      setVerifyPwd('');
      setError('');
      setRevealed(new Set());
      setCountdown(AUTO_MASK_SECONDS);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (maskTimerRef.current) clearTimeout(maskTimerRef.current);
    };
  }, [open, serverId, fieldName]);

  const startAutoMask = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (maskTimerRef.current) clearTimeout(maskTimerRef.current);
    setCountdown(AUTO_MASK_SECONDS);
    timerRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    maskTimerRef.current = setTimeout(() => {
      setRevealed(new Set());
      setCountdown(0);
      if (timerRef.current) clearInterval(timerRef.current);
    }, AUTO_MASK_SECONDS * 1000);
  };

  const handleDecrypt = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await decryptPasswordHistory(serverId, verifyPwd, fieldName);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setDecryptedItems(result.history || []);
      setLoading(false);
      startAutoMask();
    } catch (err: any) {
      setError(err?.message || '解密失败');
      setLoading(false);
    }
  };

  const toggleReveal = (itemId: string) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      // 如果全部隐藏了，刷新倒计时
      if (next.size === 0 && decryptedItems) startAutoMask();
      return next;
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const items = decryptedItems || historyItems;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
        <HistoryIcon fontSize="small" /> 密码历史 - {instanceName}
      </DialogTitle>
      <DialogContent>
        {historyItems.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            暂无密码修改记录
          </Typography>
        ) : (
          <>
            {/* 解密验证区域 */}
            {!decryptedItems && (
              <Box sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  size="small" type="password" autoComplete="new-password" label="二次验证密码"
                  value={verifyPwd} onChange={e => { setVerifyPwd(e.target.value); setError(''); }}
                  error={!!error} helperText={error}
                  sx={{ flex: 1 }}
                  onKeyDown={e => { if (e.key === 'Enter') handleDecrypt(); }}
                />
                <Button size="small" variant="contained" onClick={handleDecrypt} disabled={loading || !verifyPwd} sx={{ mt: 0.5 }}>
                  {loading ? '验证中...' : '验证并查看'}
                </Button>
              </Box>
            )}

            {decryptedItems && (
              <Typography variant="caption" color={countdown <= 10 ? 'error.main' : 'warning.main'} sx={{ mb: 1, display: 'block' }}>
                明文密码将在 {countdown}s 后自动掩码
              </Typography>
            )}

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8rem' }}>密码</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8rem' }}>修改时间</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8rem' }}>操作者</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {items.map((h: any) => {
                    const isRevealed = revealed.has(h.id);
                    const hasPwd = !!h.password;
                    return (
                      <TableRow key={h.id}>
                        <TableCell sx={{ fontSize: '0.8rem' }}>
                          {hasPwd ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <TextField
                                size="small"
                                type={isRevealed ? 'text' : 'password'}
                                value={h.password}
                                InputProps={{ readOnly: true, sx: { fontSize: '0.8rem' } }}
                                sx={{ width: 180 }}
                              />
                              <Tooltip title={isRevealed ? '隐藏' : '显示'}>
                                <IconButton size="small" onClick={() => toggleReveal(h.id)}>
                                  {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 14 }} /> : <VisibilityIcon sx={{ fontSize: 14 }} />}
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="复制">
                                <IconButton size="small" onClick={() => handleCopy(h.password)}>
                                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              {decryptedItems ? '-' : '需验证后查看'}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>
                          {new Date(h.changed_at).toLocaleString('zh-CN')}
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{h.changed_by || '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

export default InstancePwdHistoryDialog;
