import React, { useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  TextField, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LockResetIcon from '@mui/icons-material/LockReset';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PasswordGenerator from './PasswordGenerator';
import InstancePwdHistoryDialog from './InstancePwdHistoryDialog';
import CredentialHistoryDialog from './CredentialHistoryDialog';
import type { AppInstance, PortInfo, ServerCredential } from '../../types/server';
import { useServerStore } from '../../stores/serverStore';
import { decryptCredentialPassword } from '../../services/serverService';

interface Props {
  serverId: string;
  instances: AppInstance[];
  ports: PortInfo[];
}

interface CredField { username: string; password: string; notes: string }

export default function AppInstanceTab({ serverId, instances, ports }: Props) {
  const add = useServerStore(s => s.addAppInstance);
  const upd = useServerStore(s => s.updateAppInstance);
  const del = useServerStore(s => s.deleteAppInstance);
  const addPort = useServerStore(s => s.addPort);
  const updatePort = useServerStore(s => s.updatePort);
  const deletePort = useServerStore(s => s.deletePort);

  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<AppInstance | null>(null);
  const [form, setForm] = useState<any>({});
  const [credentials, setCredentials] = useState<CredField[]>([{ username: '', password: '' }]);
  const [showPwdGen, setShowPwdGen] = useState<number | null>(null);
  const [saveError, setSaveError] = useState('');

  // 密码二次验证
  const [pwdVerifyOpen, setPwdVerifyOpen] = useState(false);
  const [pwdVerifyTarget, setPwdVerifyTarget] = useState<{ pwdKey: string; credIndex: number; username: string; action?: 'copy' | 'view' } | null>(null);
  const [pwdVerifyInput, setPwdVerifyInput] = useState('');
  const [pwdVerifyError, setPwdVerifyError] = useState('');
  const [pwdVerifyLoading, setPwdVerifyLoading] = useState(false);
  const [decryptedCache, setDecryptedCache] = useState<Map<string, string>>(new Map());
  const [revealedPwds, setRevealedPwds] = useState<Set<string>>(new Set());

  // 凭据级密码历史弹窗
  const [credHistoryDialog, setCredHistoryDialog] = useState<{ instance: AppInstance; credIndex: number; username: string } | null>(null);
  const [credHistoryOpen, setCredHistoryOpen] = useState<{ index: number; username: string } | null>(null);
  // 实例级密码历史弹窗
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyInstance, setHistoryInstance] = useState<AppInstance | null>(null);

  // 主页面密码修改弹窗
  const [pwdChangeOpen, setPwdChangeOpen] = useState(false);
  const [pwdChangeTarget, setPwdChangeTarget] = useState<{ instance: AppInstance; credIndex: number; username: string } | null>(null);
  const [pwdChangeValue, setPwdChangeValue] = useState('');
  const [pwdChangeShowPwd, setPwdChangeShowPwd] = useState(false);
  const [pwdChangeShowGen, setPwdChangeShowGen] = useState(false);

  const resetForm = () => { setForm({}); setCredentials([{ username: '', password: '', notes: '' }]); setShowPwdGen(null); setSaveError(''); };

  const openAdd = () => { setEditItem(null); resetForm(); setOpen(true); };
  const openEdit = (item: AppInstance) => {
    setEditItem(item);
    setForm({ ...item, password: '******' });
    if (item.credentials && item.credentials.length > 0) {
      setCredentials(item.credentials.map((c: any) => ({ username: c.username, password: c.password && c.password !== '******' ? '******' : (c.password || ''), notes: c.notes || '' })));
    } else if (item.username) {
      setCredentials([{ username: item.username, password: item.password || '******', notes: item.notes || '' }]);
    } else {
      setCredentials([{ username: '', password: '', notes: '' }]);
    }
    setShowPwdGen(null);
    setOpen(true);
  };

  const handleSave = async () => {
    const validCreds = credentials.filter(c => c.username.trim()).map(c => ({ username: c.username, password: c.password, notes: c.notes }));
    const data: any = { ...form, credentials: validCreds, notes: validCreds[0]?.notes || form.notes || '' };
    setSaveError('');
    try {
      if (editItem) {
        await upd(serverId, editItem.id, data);
        // 编辑时同步端口信息：根据原端口号匹配并更新
        if (form.port && editItem.port) {
          const matchedPort = ports.find(p => p.port === editItem.port);
          if (matchedPort) {
            updatePort(serverId, matchedPort.id, {
              port: form.port,
              protocol: 'TCP',
              type: '应用',
              serviceName: form.name || editItem.name,
              notes: form.notes || '',
            });
          }
        }
      } else {
        await add(serverId, data);
        // 新增时自动同步关键信息到端口管理
        if (form.port) {
          addPort(serverId, {
            port: form.port,
            protocol: 'TCP',
            type: '应用',
            serviceName: form.name || 'unknown',
            notes: form.notes || '',
          });
        }
      }
      setOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || '保存失败';
      setSaveError(msg);
    }
  };

  const openHistory = (item: AppInstance) => {
    setHistoryInstance(item);
    setHistoryOpen(true);
  };

  const addCred = () => setCredentials([...credentials, { username: '', password: '', notes: '' }]);
  const removeCred = (i: number) => setCredentials(credentials.filter((_, idx) => idx !== i));
  const updateCred = (i: number, field: 'username' | 'password' | 'notes', val: string) => {
    const next = [...credentials];
    next[i][field] = val;
    setCredentials(next);
  };

  // 删除单个凭据
  const handleDeleteCredential = (instance: AppInstance, credIndex: number) => {
    if (!confirm('确认删除该凭据？')) return;
    const newCreds = [...(instance.credentials || [])];
    newCreds.splice(credIndex, 1);
    upd(serverId, instance.id, { credentials: newCreds });
  };

  // 打开密码修改弹窗
  const openPwdChange = (instance: AppInstance, credIndex: number, username: string) => {
    setPwdChangeTarget({ instance, credIndex, username });
    setPwdChangeValue('');
    setPwdChangeShowPwd(false);
    setPwdChangeShowGen(false);
    setPwdChangeOpen(true);
  };

  // 提交密码修改
  const handlePwdChangeSave = () => {
    if (!pwdChangeTarget || !pwdChangeValue.trim()) return;
    const { instance, credIndex } = pwdChangeTarget;
    const creds = instance.credentials && instance.credentials.length > 0
      ? [...instance.credentials]
      : [{ username: instance.username || '', password: '******', notes: instance.notes || '' }];
    if (credIndex < creds.length) {
      creds[credIndex] = { ...creds[credIndex], password: pwdChangeValue };
    }
    upd(serverId, instance.id, { credentials: creds });
    setPwdChangeOpen(false);
    setPwdChangeTarget(null);
  };

  // 点击眼睛图标
  const requestViewPassword = (pwdKey: string, credIndex: number, username: string) => {
    if (decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey)) {
      setRevealedPwds(prev => { const n = new Set(prev); n.delete(pwdKey); return n; });
      return;
    }
    if (decryptedCache.has(pwdKey)) {
      setRevealedPwds(prev => new Set(prev).add(pwdKey));
      return;
    }
    setPwdVerifyTarget({ pwdKey, credIndex, username });
    setPwdVerifyInput('');
    setPwdVerifyError('');
    setPwdVerifyOpen(true);
  };

  const handleVerifyPassword = async () => {
    if (!pwdVerifyInput.trim() || !pwdVerifyTarget) return;
    setPwdVerifyLoading(true);
    setPwdVerifyError('');
    try {
      const result = await decryptCredentialPassword(serverId, pwdVerifyTarget.credIndex, pwdVerifyInput);
      if (result.error) { setPwdVerifyError(result.error); setPwdVerifyLoading(false); return; }
      const plaintext = result.password || '';
      setDecryptedCache(prev => { const next = new Map(prev); next.set(pwdVerifyTarget.pwdKey, plaintext); return next; });
      setRevealedPwds(prev => new Set(prev).add(pwdVerifyTarget.pwdKey));
      // 如果是复制操作，复制到剪贴板
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

  const getDisplayPassword = (pwdKey: string, rawPwd: string): string => {
    if (decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey)) {
      return decryptedCache.get(pwdKey) || '';
    }
    return '••••••••';
  };

  // 复制密码到剪贴板
  const handleCopyPassword = async (pwdKey: string, credIndex: number, username: string) => {
    const plainPwd = decryptedCache.get(pwdKey);
    if (plainPwd) {
      await navigator.clipboard.writeText(plainPwd);
      return;
    }
    // 未解密，先验证再复制
    setPwdVerifyTarget({ pwdKey, credIndex, username, action: 'copy' });
    setPwdVerifyInput('');
    setPwdVerifyError('');
    setPwdVerifyOpen(true);
  };

  const getInstanceCreds = (a: AppInstance): (ServerCredential & { _key: string; _index: number })[] => {
    if (a.credentials && a.credentials.length > 0) {
      return a.credentials.map((c, i) => ({ ...c, _key: `${a.id}-${i}`, _index: i }));
    }
    return [{ username: a.username || '', password: a.password || '******', notes: a.notes || '', _key: `${a.id}-0`, _index: 0 }];
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>应用实例 ({instances.length})</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={openAdd}>新增</Button>
      </Box>
      {instances.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>暂无应用实例</Typography>
      ) : (
        <TableContainer><Table size="small">
          <TableHead><TableRow>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>名称</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>端口</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>URL</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>用户</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>密码</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>负责人</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>电话</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>备注</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>操作</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {instances.map(a => {
              const creds = getInstanceCreds(a);
              const credCount = creds.length;
              return creds.map((cred, ci) => {
                const pwdKey = cred._key;
                const isRevealed = decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey);
                return (
                  <TableRow key={pwdKey}>
                    {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem' }}>{a.name}</TableCell>}
                    {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem' }}>{a.port || '-'}</TableCell>}
                    {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem' }}><a href={a.url} target="_blank" rel="noreferrer" style={{ color: '#1565C0' }}>{a.url}</a></TableCell>}
                    <TableCell sx={{ fontSize: '0.8rem' }}>{cred.username || '-'}</TableCell>
                    <TableCell sx={{ fontSize: '0.85rem' }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, flexWrap: 'nowrap' }}>
                        <Typography sx={{ fontFamily: 'monospace', fontSize: '0.85rem', minWidth: 90, userSelect: isRevealed ? 'text' : 'none', letterSpacing: isRevealed ? '0' : '2px' }}>
                          {getDisplayPassword(pwdKey, cred.password || '')}
                        </Typography>
                        <Tooltip title="复制密码">
                          <IconButton size="small" onClick={() => handleCopyPassword(pwdKey, cred._index, cred.username || '')}>
                            <ContentCopyIcon sx={{ fontSize: 15, color: '#1976d2' }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="修改密码">
                          <IconButton size="small" onClick={() => openPwdChange(a, ci, cred.username || '')}>
                            <LockResetIcon sx={{ fontSize: 15, color: '#ed6c02' }} />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={isRevealed ? '隐藏密码' : '查看密码（需二次验证）'}>
                          <IconButton size="small" onClick={() => requestViewPassword(pwdKey, cred._index, cred.username || '')}>
                            {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 15 }} /> : <VisibilityIcon sx={{ fontSize: 15 }} />}
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="密码历史">
                          <IconButton size="small" onClick={() => cred.username ? setCredHistoryDialog({ instance: a, credIndex: ci, username: cred.username }) : null}>
                            <HistoryIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                        {credCount > 1 && (
                          <Tooltip title="删除此凭据">
                            <IconButton size="small" onClick={() => handleDeleteCredential(a, ci)} sx={{ color: 'error.main' }}>
                              <DeleteIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Box>
                    </TableCell>
                    {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem' }}>{a.contactPerson || '-'}</TableCell>}
                    {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.8rem' }}>{a.contactPhone || '-'}</TableCell>}
                    <TableCell sx={{ fontSize: '0.8rem', maxWidth: 120 }}>{(cred as any).notes || a.notes || '-'}</TableCell>
                    {ci === 0 && (
                      <TableCell rowSpan={credCount} sx={{ verticalAlign: 'middle', textAlign: 'center' }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                          <Tooltip title="编辑"><IconButton size="small" onClick={() => openEdit(a)}><EditIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                          <Tooltip title="删除"><IconButton size="small" onClick={() => {
                            if (!confirm('确认删除？')) return;
                            del(serverId, a.id);
                            if (a.port) {
                              const matchedPort = ports.find(p => p.port === a.port);
                              if (matchedPort) deletePort(serverId, matchedPort.id);
                            }
                          }} sx={{ color: 'error.main' }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                );
              });
            })}
          </TableBody>
        </Table></TableContainer>
      )}

      {/* 新增/编辑弹窗 */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editItem ? '编辑应用实例' : '新增应用实例'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {saveError && <Alert severity="error">{saveError}</Alert>}
            {/* 第一行：应用名称 | 端口 | 负责人 | 联系电话 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField size="small" label="应用名称" value={form.name || ''} onChange={e => setForm({ ...form, name: e.target.value })} sx={{ flex: 2 }} />
              <TextField size="small" label="端口" type="number" value={form.port || ''} onChange={e => setForm({ ...form, port: Number(e.target.value) || '' })} sx={{ flex: 1 }} />
              <TextField size="small" label="负责人" value={form.contactPerson || ''} onChange={e => setForm({ ...form, contactPerson: e.target.value })} sx={{ flex: 1 }} />
              <TextField size="small" label="联系电话" value={form.contactPhone || ''} onChange={e => setForm({ ...form, contactPhone: e.target.value })} sx={{ flex: 1 }} />
            </Box>
            {/* 第二行：URL */}
            <TextField size="small" label="URL" value={form.url || ''} onChange={e => setForm({ ...form, url: e.target.value })} fullWidth />

            {/* 用户凭据 */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>用户凭据</Typography>
                <Button size="small" variant="outlined" sx={{ minWidth: 32, p: '2px 6px', fontSize: '0.7rem' }} onClick={addCred}>+ 添加</Button>
              </Box>
              {credentials.map((cred, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, mb: 1, alignItems: 'flex-start', p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <TextField size="small" label="用户名" value={cred.username} onChange={e => updateCred(i, 'username', e.target.value)} sx={{ flex: 1 }} />
                  <TextField size="small" label="密码" type="password" autoComplete="new-password" value={cred.password} onChange={e => updateCred(i, 'password', e.target.value)} sx={{ flex: 1 }} />
                  <TextField size="small" label="备注" value={cred.notes} onChange={e => updateCred(i, 'notes', e.target.value)} sx={{ flex: 2 }} />
                  <Button size="small" variant="outlined" onClick={() => setShowPwdGen(showPwdGen === i ? null : i)} sx={{ minWidth: 56, flexShrink: 0, fontSize: '0.7rem', height: 40 }}>生成</Button>
                  <Tooltip title="密码历史">
                    <IconButton size="small" onClick={() => cred.username ? setCredHistoryOpen({ index: i, username: cred.username }) : null} sx={{ flexShrink: 0, height: 40, width: 40 }}>
                      <HistoryIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  {credentials.length > 1 && (
                    <IconButton size="small" onClick={() => removeCred(i)} sx={{ color: 'error.main', flexShrink: 0 }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                  )}
                </Box>
              ))}
              {/* 内联密码生成器 */}
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
          <Button size="small" onClick={() => setOpen(false)}>取消</Button>
          <Button size="small" variant="contained" onClick={handleSave}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 主页面密码修改弹窗 */}
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

      {/* 凭据密码二次验证弹窗 */}
      <Dialog open={pwdVerifyOpen} onClose={() => { setPwdVerifyOpen(false); setPwdVerifyTarget(null); setPwdVerifyError(''); setPwdVerifyInput(''); }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '0.95rem' }}>二次验证 - {pwdVerifyTarget?.action === 'copy' ? '复制凭据密码' : '查看凭据密码'}</DialogTitle>
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

      {/* 实例级密码历史弹窗 */}
      {historyInstance && (
        <InstancePwdHistoryDialog
          open={historyOpen}
          serverId={serverId}
          fieldName={`appInstance-${historyInstance.name}`}
          instanceName={historyInstance.name}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      {/* 编辑弹窗中凭据密码历史 */}
      {credHistoryOpen && form.name && (
        <InstancePwdHistoryDialog
          open={true}
          serverId={serverId}
          fieldName={`appInstance-${form.name}-cred-${credHistoryOpen.username}`}
          instanceName={`${form.name} - ${credHistoryOpen.username}`}
          onClose={() => setCredHistoryOpen(null)}
        />
      )}

      {/* 表格中凭据级密码历史弹窗 */}
      {credHistoryDialog && (
        <CredentialHistoryDialog
          open={true}
          serverId={serverId}
          credentialIndex={credHistoryDialog.credIndex}
          username={credHistoryDialog.username}
          onClose={() => setCredHistoryDialog(null)}
        />
      )}
    </Box>
  );
}
