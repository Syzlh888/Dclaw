import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  TextField, MenuItem, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import SecurityIcon from '@mui/icons-material/Security';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LockResetIcon from '@mui/icons-material/LockReset';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import HistoryIcon from '@mui/icons-material/History';
import PasswordGenerator from './PasswordGenerator';
import { apiFetch } from '../../services/apiClient';
import type { AccessEntry, ServerCredential } from '../../types/server';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface CredField { username: string; password: string; notes?: string }

const ACCESS_TYPES = ['VPN', '堡垒机'];

export default function AccessManagementDialog({ open, onClose }: Props) {
  const [entries, setEntries] = useState<AccessEntry[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [editItem, setEditItem] = useState<AccessEntry | null>(null);
  const [form, setForm] = useState<any>({});
  const [credentials, setCredentials] = useState<CredField[]>([{ username: '', password: '' }]);
  const [saveError, setSaveError] = useState('');
  const [showPwdGen, setShowPwdGen] = useState<number | null>(null);

  // 密码二次验证
  const [pwdVerifyOpen, setPwdVerifyOpen] = useState(false);
  const [pwdVerifyTarget, setPwdVerifyTarget] = useState<{
    entryId: string; pwdKey: string; credIndex: number; username: string; action?: 'copy' | 'view';
  } | null>(null);
  const [pwdVerifyInput, setPwdVerifyInput] = useState('');
  const [pwdVerifyError, setPwdVerifyError] = useState('');
  const [pwdVerifyLoading, setPwdVerifyLoading] = useState(false);
  const [decryptedCache, setDecryptedCache] = useState<Map<string, string>>(new Map());
  const [revealedPwds, setRevealedPwds] = useState<Set<string>>(new Set());

  // 密码修改弹窗
  const [pwdChangeOpen, setPwdChangeOpen] = useState(false);
  const [pwdChangeTarget, setPwdChangeTarget] = useState<{ entry: AccessEntry; credIndex: number; username: string } | null>(null);
  const [pwdChangeValue, setPwdChangeValue] = useState('');
  const [pwdChangeShowPwd, setPwdChangeShowPwd] = useState(false);
  const [pwdChangeShowGen, setPwdChangeShowGen] = useState(false);

  // 密码历史弹窗
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyEntry, setHistoryEntry] = useState<{ entry: AccessEntry; credIndex: number; username: string } | null>(null);
  const [historyItems, setHistoryItems] = useState<any[]>([]);
  const [historyDecrypted, setHistoryDecrypted] = useState(false);
  const [historyVfyPwd, setHistoryVfyPwd] = useState('');
  const [historyVfyError, setHistoryVfyError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevealed, setHistoryRevealed] = useState<Set<string>>(new Set());

  const loadEntries = async () => {
    try {
      const res = await apiFetch('/api/access');
      const data = await res.json();
      setEntries(data.entries || []);
    } catch (err) {
      console.error('加载访问条目失败:', err);
    }
  };

  useEffect(() => {
    if (open) loadEntries();
  }, [open]);

  const resetForm = () => { setForm({ type: 'VPN' }); setCredentials([{ username: '', password: '' }]); setShowPwdGen(null); setSaveError(''); };

  const openAdd = () => { setEditItem(null); resetForm(); setEditOpen(true); };

  const openEdit = (item: AccessEntry) => {
    setEditItem(item);
    setForm({ type: item.type, address: item.address, provider: item.provider, notes: item.notes });
    if (item.credentials && item.credentials.length > 0) {
      setCredentials(item.credentials.map(c => ({ username: c.username, password: '******', notes: (c as any).notes || '' })));
    } else if (item.username) {
      setCredentials([{ username: item.username, password: '******' }]);
    } else {
      setCredentials([{ username: '', password: '' }]);
    }
    setShowPwdGen(null);
    setEditOpen(true);
  };

  const addCred = () => setCredentials([...credentials, { username: '', password: '' }]);
  const removeCred = (i: number) => setCredentials(credentials.filter((_, idx) => idx !== i));
  const updateCred = (i: number, field: 'username' | 'password' | 'notes', val: string) => {
    const next = [...credentials];
    next[i][field] = val;
    setCredentials(next);
  };

  const handleSave = async () => {
    setSaveError('');
    if (!form.type) { setSaveError('请选择类型'); return; }
    if (!form.address || !form.address.trim()) { setSaveError('请填写地址'); return; }

    const validCreds = credentials.filter(c => c.username.trim());
    if (validCreds.length === 0) { setSaveError('请至少填写一个用户名'); return; }

    const body = {
      type: form.type,
      address: form.address.trim(),
      provider: form.provider || '',
      username: validCreds[0]?.username || '',
      notes: form.notes || '',
      credentials: validCreds.map(c => ({
        username: c.username,
        password: c.password,
        notes: c.notes || '',
      })),
    };

    try {
      if (editItem) {
        await apiFetch(`/api/access/${editItem.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/api/access', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      }
      setEditOpen(false);
      await loadEntries();
    } catch (err: any) {
      setSaveError(err?.message || '保存失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确认删除该访问条目？')) return;
    try {
      await apiFetch(`/api/access/${id}`, { method: 'DELETE' });
      await loadEntries();
    } catch (err) {
      console.error('删除失败:', err);
    }
  };

  const handleDeleteCredential = (entry: AccessEntry, credIndex: number) => {
    if (!confirm('确认删除该凭据？')) return;
    const newCreds = [...(entry.credentials || [])];
    newCreds.splice(credIndex, 1);
    const body = {
      type: entry.type,
      address: entry.address,
      provider: entry.provider || '',
      username: newCreds[0]?.username || '',
      notes: entry.notes || '',
      credentials: newCreds.map(c => ({ username: c.username, password: '******', notes: (c as any).notes || '' })),
    };
    apiFetch(`/api/access/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => loadEntries());
  };

  // 复制密码
  const handleCopyPassword = async (entryId: string, pwdKey: string, credIndex: number, username: string) => {
    const plainPwd = decryptedCache.get(pwdKey);
    if (plainPwd) {
      await navigator.clipboard.writeText(plainPwd);
      return;
    }
    setPwdVerifyTarget({ entryId, pwdKey, credIndex, username, action: 'copy' });
    setPwdVerifyInput('');
    setPwdVerifyError('');
    setPwdVerifyOpen(true);
  };

  // 查看/隐藏密码
  const requestViewPassword = (entryId: string, pwdKey: string, credIndex: number, username: string) => {
    if (decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey)) {
      setRevealedPwds(prev => { const n = new Set(prev); n.delete(pwdKey); return n; });
      return;
    }
    if (decryptedCache.has(pwdKey)) {
      setRevealedPwds(prev => new Set(prev).add(pwdKey));
      return;
    }
    setPwdVerifyTarget({ entryId, pwdKey, credIndex, username });
    setPwdVerifyInput('');
    setPwdVerifyError('');
    setPwdVerifyOpen(true);
  };

  const handleVerifyPassword = async () => {
    if (!pwdVerifyInput.trim() || !pwdVerifyTarget) return;
    setPwdVerifyLoading(true);
    setPwdVerifyError('');
    try {
      const res = await apiFetch(`/api/access/${pwdVerifyTarget.entryId}/decrypt-credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyPassword: pwdVerifyInput, credentialIndex: pwdVerifyTarget.credIndex }),
      });
      const result = await res.json();
      if (result.error) { setPwdVerifyError(result.error); setPwdVerifyLoading(false); return; }
      const plaintext = result.password || '';
      setDecryptedCache(prev => { const next = new Map(prev); next.set(pwdVerifyTarget.pwdKey, plaintext); return next; });
      setRevealedPwds(prev => new Set(prev).add(pwdVerifyTarget.pwdKey));
      if (pwdVerifyTarget.action === 'copy') {
        await navigator.clipboard.writeText(plaintext);
      }
      setPwdVerifyOpen(false);
      setPwdVerifyTarget(null);
      setPwdVerifyInput('');
    } catch (err: any) {
      setPwdVerifyError(err?.message || '验证失败');
    }
    setPwdVerifyLoading(false);
  };

  // 密码修改
  const openPwdChange = (entry: AccessEntry, credIndex: number, username: string) => {
    setPwdChangeTarget({ entry, credIndex, username });
    setPwdChangeValue('');
    setPwdChangeShowPwd(false);
    setPwdChangeShowGen(false);
    setPwdChangeOpen(true);
  };

  const handlePwdChangeSave = () => {
    if (!pwdChangeTarget || !pwdChangeValue.trim()) return;
    const { entry, credIndex } = pwdChangeTarget;
    const creds = entry.credentials && entry.credentials.length > 0
      ? [...entry.credentials]
      : [{ username: entry.username || '', password: '******' }];
    if (credIndex < creds.length) {
      creds[credIndex] = { ...creds[credIndex], password: pwdChangeValue };
    }
    const body = {
      type: entry.type,
      address: entry.address,
      provider: entry.provider || '',
      username: creds[0]?.username || '',
      notes: entry.notes || '',
      credentials: creds.map(c => ({ username: c.username, password: c.password, notes: (c as any).notes || '' })),
    };
    apiFetch(`/api/access/${entry.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then(() => {
      loadEntries();
      setPwdChangeOpen(false);
      setPwdChangeTarget(null);
    });
  };

  // 密码历史
  const openHistory = (entry: AccessEntry, credIndex: number, username: string) => {
    setHistoryEntry({ entry, credIndex, username });
    setHistoryItems([]);
    setHistoryDecrypted(false);
    setHistoryVfyPwd('');
    setHistoryVfyError('');
    setHistoryRevealed(new Set());
    setHistoryOpen(true);
    // 预加载历史（不包含明文）
    apiFetch(`/api/access/${entry.id}/password-history`)
      .then(r => r.json())
      .then(d => setHistoryItems(d.history || []));
  };

  const handleHistoryDecrypt = async () => {
    if (!historyEntry || !historyVfyPwd) return;
    setHistoryLoading(true);
    setHistoryVfyError('');
    try {
      const res = await apiFetch(`/api/access/${historyEntry.entry.id}/password-history/decrypt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyPassword: historyVfyPwd }),
      });
      const data = await res.json();
      if (data.error) { setHistoryVfyError(data.error); setHistoryLoading(false); return; }
      setHistoryItems(data.history || []);
      setHistoryDecrypted(true);
    } catch (err: any) {
      setHistoryVfyError(err?.message || '解密失败');
    }
    setHistoryLoading(false);
  };

  const toggleHistoryReveal = (itemId: string) => {
    setHistoryRevealed(prev => {
      const next = new Set(prev);
      next.has(itemId) ? next.delete(itemId) : next.add(itemId);
      return next;
    });
  };

  const getDisplayPassword = (pwdKey: string): string => {
    if (decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey)) {
      return decryptedCache.get(pwdKey) || '';
    }
    return '••••••••';
  };

  const getEntryCreds = (e: AccessEntry): (ServerCredential & { _key: string; _index: number })[] => {
    if (e.credentials && e.credentials.length > 0) {
      return e.credentials.map((c, i) => ({ ...c, _key: `${e.id}-${i}`, _index: i }));
    }
    return [{ username: e.username || '', password: e.password || '******', _key: `${e.id}-0`, _index: 0 }];
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>访问管理</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5, mt: 0.5 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              访问条目 ({entries.length})
            </Typography>
            <Button size="small" startIcon={<AddIcon />} onClick={openAdd}>新增</Button>
          </Box>

          {entries.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              暂无访问条目
            </Typography>
          ) : (
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>类型</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>地址</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>提供方</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>用户</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>密码</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>备注</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>操作</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map(e => {
                    const creds = getEntryCreds(e);
                    const credCount = creds.length;
                    return creds.map((cred, ci) => {
                      const pwdKey = cred._key;
                      const isRevealed = decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey);
                      return (
                        <TableRow key={pwdKey}>
                          {ci === 0 && (
                            <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem' }}>
                              <Chip
                                icon={e.type === 'VPN' ? <VpnKeyIcon sx={{ fontSize: 14 }} /> : <SecurityIcon sx={{ fontSize: 14 }} />}
                                label={e.type}
                                size="small"
                                color={e.type === 'VPN' ? 'primary' : 'warning'}
                                variant="outlined"
                                sx={{ fontSize: '0.7rem', height: 22 }}
                              />
                            </TableCell>
                          )}
                          {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem', color: '#1565C0' }}>{e.address}</TableCell>}
                          {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem' }}>{e.provider || '-'}</TableCell>}
                          <TableCell sx={{ fontSize: '0.8rem' }}>{cred.username || '-'}</TableCell>
                          <TableCell sx={{ fontSize: '0.85rem' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, flexWrap: 'nowrap' }}>
                              <Typography sx={{
                                fontFamily: 'monospace', fontSize: '0.85rem', minWidth: 90,
                                userSelect: isRevealed ? 'text' : 'none',
                                letterSpacing: isRevealed ? '0' : '2px',
                              }}>
                                {getDisplayPassword(pwdKey)}
                              </Typography>
                              <Tooltip title="复制密码">
                                <IconButton size="small" onClick={() => handleCopyPassword(e.id, pwdKey, cred._index, cred.username || '')}>
                                  <ContentCopyIcon sx={{ fontSize: 15, color: '#1976d2' }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="修改密码">
                                <IconButton size="small" onClick={() => openPwdChange(e, ci, cred.username || '')}>
                                  <LockResetIcon sx={{ fontSize: 15, color: '#ed6c02' }} />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={isRevealed ? '隐藏密码' : '查看密码（需二次验证）'}>
                                <IconButton size="small" onClick={() => requestViewPassword(e.id, pwdKey, cred._index, cred.username || '')}>
                                  {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 15 }} /> : <VisibilityIcon sx={{ fontSize: 15 }} />}
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="密码历史">
                                <IconButton size="small" onClick={() => cred.username ? openHistory(e, ci, cred.username) : null}>
                                  <HistoryIcon sx={{ fontSize: 15 }} />
                                </IconButton>
                              </Tooltip>
                              {credCount > 1 && (
                                <Tooltip title="删除此凭据">
                                  <IconButton size="small" onClick={() => handleDeleteCredential(e, ci)} sx={{ color: 'error.main' }}>
                                    <DeleteIcon sx={{ fontSize: 15 }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Box>
                          </TableCell>
                          {ci === 0 && (
                            <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {e.notes || '-'}
                            </TableCell>
                          )}
                          {ci === 0 && (
                            <TableCell rowSpan={credCount} sx={{ verticalAlign: 'middle', textAlign: 'center' }}>
                              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                                <Tooltip title="编辑"><IconButton size="small" onClick={() => openEdit(e)}><EditIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                                <Tooltip title="删除"><IconButton size="small" onClick={() => handleDelete(e.id)} sx={{ color: 'error.main' }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                              </Box>
                            </TableCell>
                          )}
                        </TableRow>
                      );
                    });
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={onClose}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 新增/编辑弹窗 */}
      <Dialog open={editOpen} onClose={() => setEditOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editItem ? '编辑访问条目' : '新增访问条目'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {saveError && <Alert severity="error" onClose={() => setSaveError('')}>{saveError}</Alert>}

            {/* 第一行：类型 | 地址 | 提供方 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                size="small" label="类型" select
                value={form.type || 'VPN'}
                onChange={e => setForm({ ...form, type: e.target.value })}
                sx={{ flex: 1 }}
              >
                {ACCESS_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
              </TextField>
              <TextField
                size="small" label="地址"
                value={form.address || ''}
                onChange={e => setForm({ ...form, address: e.target.value })}
                placeholder="IP 或域名"
                sx={{ flex: 2 }}
              />
              <TextField
                size="small" label="提供方"
                value={form.provider || ''}
                onChange={e => setForm({ ...form, provider: e.target.value })}
                placeholder="如：阿里云、腾讯云"
                sx={{ flex: 1.5 }}
              />
            </Box>

            {/* 用户凭据 */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>用户凭据</Typography>
                <Button size="small" variant="outlined" sx={{ minWidth: 32, p: '2px 6px', fontSize: '0.7rem' }} onClick={addCred}>+ 添加</Button>
              </Box>
              {credentials.map((cred, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <TextField size="small" label="用户名" value={cred.username} onChange={e => updateCred(i, 'username', e.target.value)} sx={{ flex: 1 }} />
                  <TextField size="small" label="密码" type="password" autoComplete="new-password" value={cred.password}
                    onChange={e => updateCred(i, 'password', e.target.value)} sx={{ flex: 1.5 }}
                    onFocus={e => { if (cred.password === '******') { updateCred(i, 'password', ''); } }}
                  />
                  <TextField size="small" label="备注" value={cred.notes || ''} onChange={e => updateCred(i, 'notes', e.target.value)} sx={{ flex: 2 }} />
                  <Box sx={{ display: 'flex', flexShrink: 0, gap: 0.5, alignItems: 'center', height: 40 }}>
                    <Button size="small" variant="outlined" onClick={() => setShowPwdGen(showPwdGen === i ? null : i)}
                      sx={{ minWidth: 56, fontSize: '0.7rem', height: 36 }}>生成</Button>
                    {editItem && (
                      <Tooltip title="历史密码查看">
                        <IconButton size="small" onClick={() => {
                          const creds = getEntryCreds(editItem);
                          if (creds[i]?.username) openHistory(editItem, i, creds[i].username);
                        }}>
                          <HistoryIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                  {credentials.length > 1 && (
                    <IconButton size="small" onClick={() => removeCred(i)} sx={{ color: 'error.main', flexShrink: 0, alignSelf: 'center' }}>
                      <DeleteIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                </Box>
              ))}
              {showPwdGen !== null && showPwdGen < credentials.length && (
                <Box sx={{ mb: 1 }}>
                  <PasswordGenerator
                    open={true}
                    onApply={p => { updateCred(showPwdGen, 'password', p); setShowPwdGen(null); }}
                    onClose={() => setShowPwdGen(null)}
                  />
                </Box>
              )}
            </Box>

          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setEditOpen(false)}>取消</Button>
          <Button size="small" variant="contained" onClick={handleSave}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 二次验证弹窗 */}
      <Dialog open={pwdVerifyOpen} onClose={() => { setPwdVerifyOpen(false); setPwdVerifyTarget(null); setPwdVerifyError(''); setPwdVerifyInput(''); }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
          二次验证 - {pwdVerifyTarget?.action === 'copy' ? '复制凭据密码' : '查看凭据密码'}
        </DialogTitle>
        <DialogContent>
          {pwdVerifyError && <Box sx={{ mb: 1.5, p: 1, bgcolor: 'error.light', borderRadius: 1, color: 'error.contrastText', fontSize: '0.85rem' }}>{pwdVerifyError}</Box>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            请输入二次验证密码以查看凭据「{pwdVerifyTarget?.username || '-'}」的明文密码
          </Typography>
          <TextField autoFocus fullWidth size="small" type="password" autoComplete="new-password" label="二次验证密码"
            value={pwdVerifyInput} onChange={e => { setPwdVerifyInput(e.target.value); setPwdVerifyError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleVerifyPassword(); }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => { setPwdVerifyOpen(false); setPwdVerifyTarget(null); setPwdVerifyError(''); setPwdVerifyInput(''); }}>取消</Button>
          <Button size="small" variant="contained" onClick={handleVerifyPassword} disabled={pwdVerifyLoading || !pwdVerifyInput.trim()}>
            {pwdVerifyLoading ? <Chip size="small" label="..." sx={{ mr: 0.5, height: 16 }} /> : null}验证
          </Button>
        </DialogActions>
      </Dialog>

      {/* 密码修改弹窗 */}
      <Dialog open={pwdChangeOpen} onClose={() => { setPwdChangeOpen(false); setPwdChangeTarget(null); }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '0.95rem' }}>修改密码 - {pwdChangeTarget?.username || ''}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <TextField
                fullWidth size="small"
                type={pwdChangeShowPwd ? 'text' : 'password'}
                autoComplete="new-password"
                label="新密码"
                value={pwdChangeValue}
                onChange={e => setPwdChangeValue(e.target.value)}
              />
              <Tooltip title={pwdChangeShowPwd ? '隐藏' : '显示'}>
                <IconButton size="small" onClick={() => setPwdChangeShowPwd(!pwdChangeShowPwd)}>
                  {pwdChangeShowPwd ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
            <Box>
              <Button size="small" variant="outlined" onClick={() => setPwdChangeShowGen(!pwdChangeShowGen)}
                sx={{ minWidth: 56, fontSize: '0.7rem' }}>生成密码</Button>
              {pwdChangeShowGen && (
                <Box sx={{ mt: 1 }}>
                  <PasswordGenerator
                    open={true}
                    onApply={p => { setPwdChangeValue(p); setPwdChangeShowGen(false); }}
                    onClose={() => setPwdChangeShowGen(false)}
                  />
                </Box>
              )}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => { setPwdChangeOpen(false); setPwdChangeTarget(null); }}>取消</Button>
          <Button size="small" variant="contained" onClick={handlePwdChangeSave} disabled={!pwdChangeValue.trim()}>
            确认修改
          </Button>
        </DialogActions>
      </Dialog>

      {/* 密码历史弹窗 */}
      <Dialog open={historyOpen} onClose={() => setHistoryOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: 1 }}>
          <HistoryIcon fontSize="small" />
          密码修改历史 - {historyEntry?.username || ''}
        </DialogTitle>
        <DialogContent>
          {historyItems.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
              暂无修改记录
            </Typography>
          ) : (
            <>
              {!historyDecrypted && (
                <Box sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                  <TextField
                    size="small" type="password" autoComplete="new-password" label="二次验证密码"
                    value={historyVfyPwd} onChange={e => { setHistoryVfyPwd(e.target.value); setHistoryVfyError(''); }}
                    error={!!historyVfyError} helperText={historyVfyError}
                    sx={{ flex: 1 }}
                    onKeyDown={e => { if (e.key === 'Enter') handleHistoryDecrypt(); }}
                  />
                  <Button size="small" variant="contained" onClick={handleHistoryDecrypt} disabled={historyLoading || !historyVfyPwd} sx={{ mt: 0.5 }}>
                    验证并查看
                  </Button>
                </Box>
              )}
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8rem' }}>密码</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8rem' }}>修改时间</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.8rem' }}>操作者</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {historyItems.map((h: any) => {
                    const isRevealed = historyRevealed.has(h.id);
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
                                <IconButton size="small" onClick={() => toggleHistoryReveal(h.id)}>
                                  {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 14 }} /> : <VisibilityIcon sx={{ fontSize: 14 }} />}
                                </IconButton>
                              </Tooltip>
                              <Tooltip title="复制">
                                <IconButton size="small" onClick={() => navigator.clipboard.writeText(h.password)}>
                                  <ContentCopyIcon sx={{ fontSize: 14 }} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          ) : (
                            <Typography variant="caption" color="text.secondary">
                              {historyDecrypted ? '-' : '需验证后查看'}
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
            </>
          )}
        </DialogContent>
        <DialogActions><Button size="small" onClick={() => setHistoryOpen(false)}>关闭</Button></DialogActions>
      </Dialog>
    </>
  );
}
