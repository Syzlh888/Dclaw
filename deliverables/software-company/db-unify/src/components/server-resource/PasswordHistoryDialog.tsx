import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Chip, TextField, Box, Alert, IconButton, Tooltip,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useServerStore } from '../../stores/serverStore';
import { decryptPasswordHistory } from '../../services/serverService';

interface Props {
  open: boolean;
  serverId: string;
  onClose: () => void;
}

const FIELD_LABELS: Record<string, string> = {
  password: '服务器密码',
  bastionPassword: '堡垒机密码',
};

const PasswordHistoryDialog: React.FC<Props> = ({ open, serverId, onClose }) => {
  const passwordHistory = useServerStore(s => s.passwordHistory[serverId]) || [];
  const loadPasswordHistory = useServerStore(s => s.loadPasswordHistory);
  const [decryptedItems, setDecryptedItems] = useState<any[] | null>(null);
  const [verifyPwd, setVerifyPwd] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open && serverId) {
      loadPasswordHistory(serverId);
      setDecryptedItems(null);
      setVerifyPwd('');
      setError('');
      setRevealed(new Set());
    }
  }, [open, serverId, loadPasswordHistory]);

  const handleDecrypt = async () => {
    setError('');
    setLoading(true);
    try {
      const result = await decryptPasswordHistory(serverId, verifyPwd);
      if (result.error) {
        setError(result.error);
        setLoading(false);
        return;
      }
      setDecryptedItems(result.history || []);
      setLoading(false);
    } catch (err: any) {
      setError(err?.message || '解密失败');
      setLoading(false);
    }
  };

  const toggleReveal = (itemId: string) => {
    setRevealed(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
      return next;
    });
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const items = decryptedItems || passwordHistory;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
        <HistoryIcon fontSize="small" /> 密码修改历史
      </DialogTitle>
      <DialogContent>
        {passwordHistory.length === 0 ? (
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
                <Button size="small" variant="contained" onClick={handleDecrypt} disabled={loading || !verifyPwd}
                  sx={{ mt: 0.5 }}>
                  {loading ? '验证中...' : '验证并查看密码'}
                </Button>
              </Box>
            )}

            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8rem' }}>字段</TableCell>
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
                        <TableCell>
                          <Chip label={FIELD_LABELS[h.field_name] || h.field_name} size="small" sx={{ fontSize: '0.75rem' }} />
                        </TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>
                          {hasPwd ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              <TextField
                                size="small"
                                type={isRevealed ? 'text' : 'password'}
                                value={h.password}
                                InputProps={{ readOnly: true, sx: { fontSize: '0.8rem' } }}
                                sx={{ width: 140 }}
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

export default PasswordHistoryDialog;
