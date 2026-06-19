import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, List, ListItem, ListItemText, Typography, CircularProgress, Box,
  TextField, IconButton, Tooltip,
} from '@mui/material';
import HistoryIcon from '@mui/icons-material/History';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { fetchPasswordHistory, decryptPasswordHistory } from '../../services/serverService';

interface HistoryItem {
  id: string;
  server_id: string;
  field_name: string;
  password_encrypted?: string;
  password?: string;
  changed_at: string;
  changed_by: string;
}

interface Props {
  open: boolean;
  serverId: string;
  credentialIndex: number;
  username: string;
  onClose: () => void;
}

const CredentialHistoryDialog: React.FC<Props> = ({ open, serverId, credentialIndex, username, onClose }) => {
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [verifyPwd, setVerifyPwd] = useState('');
  const [error, setError] = useState('');
  const [decrypted, setDecrypted] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open && serverId) {
      setLoading(true);
      setDecrypted(false);
      setVerifyPwd('');
      setError('');
      setRevealed(new Set());
      fetchPasswordHistory(serverId)
        .then(res => {
          const prefix = `credential-${credentialIndex}-`;
          const filtered = (res.history || []).filter((h: HistoryItem) =>
            h.field_name.startsWith(prefix)
          );
          setItems(filtered);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }
  }, [open, serverId, credentialIndex]);

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
      const prefix = `credential-${credentialIndex}-`;
      const filtered = (result.history || []).filter((h: HistoryItem) =>
        h.field_name.startsWith(prefix)
      );
      setItems(filtered);
      setDecrypted(true);
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

  const formatTime = (t: string) => {
    try { return new Date(t).toLocaleString('zh-CN'); } catch { return t; }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
        <HistoryIcon fontSize="small" />
        密码修改历史 - {username}
      </DialogTitle>
      <DialogContent>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}><CircularProgress size={24} /></Box>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'left' }}>
            暂无修改记录
          </Typography>
        ) : (
          <>
            {!decrypted && (
              <Box sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                <TextField
                  size="small" type="password" autoComplete="new-password" label="二次验证密码"
                  value={verifyPwd} onChange={e => { setVerifyPwd(e.target.value); setError(''); }}
                  error={!!error} helperText={error}
                  sx={{ flex: 1 }}
                  onKeyDown={e => { if (e.key === 'Enter') handleDecrypt(); }}
                />
                <Button size="small" variant="contained" onClick={handleDecrypt} disabled={!verifyPwd}
                  sx={{ mt: 0.5 }}>
                  验证并查看密码
                </Button>
              </Box>
            )}
            <List dense>
              {items.map(item => {
                const isRevealed = revealed.has(item.id);
                const hasPwd = !!item.password;
                return (
                  <ListItem key={item.id} sx={{ borderBottom: '1px solid', borderColor: 'divider', flexDirection: 'column', alignItems: 'flex-start' }}>
                    <ListItemText
                      primary={`修改时间: ${formatTime(item.changed_at)}`}
                      secondary={`操作人: ${item.changed_by}`}
                      primaryTypographyProps={{ fontSize: '0.85rem' }}
                      secondaryTypographyProps={{ fontSize: '0.75rem' }}
                    />
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 40 }}>密码:</Typography>
                      {hasPwd ? (
                        <>
                          <TextField
                            size="small"
                            type={isRevealed ? 'text' : 'password'}
                            value={item.password}
                            InputProps={{ readOnly: true, sx: { fontSize: '0.8rem' } }}
                            sx={{ width: 160 }}
                          />
                          <Tooltip title={isRevealed ? '隐藏' : '显示'}>
                            <IconButton size="small" onClick={() => toggleReveal(item.id)}>
                              {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 14 }} /> : <VisibilityIcon sx={{ fontSize: 14 }} />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="复制">
                            <IconButton size="small" onClick={() => handleCopy(item.password!)}>
                              <ContentCopyIcon sx={{ fontSize: 14 }} />
                            </IconButton>
                          </Tooltip>
                        </>
                      ) : (
                        <Typography variant="caption" color="text.secondary">需验证后查看</Typography>
                      )}
                    </Box>
                  </ListItem>
                );
              })}
            </List>
          </>
        )}
      </DialogContent>
      <DialogActions><Button size="small" onClick={onClose}>关闭</Button></DialogActions>
    </Dialog>
  );
};

export default CredentialHistoryDialog;
