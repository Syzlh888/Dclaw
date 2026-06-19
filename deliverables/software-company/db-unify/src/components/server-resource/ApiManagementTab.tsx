import React, { useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, Alert,
  TextField, Chip, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import PublicIcon from '@mui/icons-material/Public';
import type { ApiInstance, AppInstance } from '../../types/server';
import { useServerStore } from '../../stores/serverStore';

interface Props {
  serverId: string;
  instances: ApiInstance[];
  appInstances: AppInstance[];
}

const ENCRYPTION_METHODS = ['HTTPS (TLS)', 'mTLS', 'AES-128-GCM', 'AES-256-GCM', 'RSA-2048', 'RSA-4096', 'ECC', 'SM2 (国密非对称)', 'SM3 (国密哈希)', 'SM4 (国密对称)', 'SM9 (国密标识)', '自定义'];

export default function ApiManagementTab({ serverId, instances, appInstances }: Props) {
  const addApi = useServerStore(s => s.addApiInstance);
  const updApi = useServerStore(s => s.updateApiInstance);
  const delApi = useServerStore(s => s.deleteApiInstance);

  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<ApiInstance | null>(null);
  const [form, setForm] = useState<any>({});
  const [saveError, setSaveError] = useState('');
  const [customEncMethod, setCustomEncMethod] = useState('');

  const resetForm = () => { setForm({}); setSaveError(''); setCustomEncMethod(''); };

  const openAdd = () => { setEditItem(null); resetForm(); setOpen(true); };
  const openEdit = (item: ApiInstance) => {
    setEditItem(item);
    setForm({ ...item });
    // 如果加密方式是预设之外的值，归类为自定义
    if (item.encrypted && item.encryptionMethod && !ENCRYPTION_METHODS.slice(0, -1).includes(item.encryptionMethod)) {
      setCustomEncMethod(item.encryptionMethod);
      setForm({ ...item, encryptionMethod: '自定义' });
    } else {
      setCustomEncMethod('');
      setForm({ ...item });
    }
    setSaveError('');
    setOpen(true);
  };

  const handleSave = async () => {
    setSaveError('');
    if (!form.apiAddress || !form.apiAddress.trim()) { setSaveError('请填写API地址'); return; }
    if (!form.applicationName || !form.applicationName.trim()) { setSaveError('请选择所属应用'); return; }

    const finalMethod = form.encrypted
      ? (form.encryptionMethod === '自定义' ? customEncMethod : form.encryptionMethod)
      : '';

    const data: any = {
      apiAddress: form.apiAddress.trim(),
      port: form.port || undefined,
      applicationName: form.applicationName.trim(),
      encrypted: !!form.encrypted,
      encryptionMethod: finalMethod,
      requestExample: form.requestExample || '',
      responseExample: form.responseExample || '',
      notes: form.notes || '',
    };

    try {
      if (editItem) {
        await updApi(serverId, editItem.id, data);
      } else {
        await addApi(serverId, data);
      }
      setOpen(false);
    } catch (err: any) {
      const msg = err?.response?.data?.error || err?.message || '保存失败';
      setSaveError(msg);
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>API 管理 ({instances.length})</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={openAdd}>新增</Button>
      </Box>

      {instances.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>暂无API实例</Typography>
      ) : (
        <TableContainer><Table size="small">
          <TableHead><TableRow>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>API 地址</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>端口</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>所属应用</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>加密</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>加密方式</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>说明</TableCell>
            <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>操作</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {instances.map(a => (
              <TableRow key={a.id}>
                <TableCell sx={{ fontSize: '0.8rem' }}>
                  <span style={{ color: '#1565C0', wordBreak: 'break-all' }}>{a.apiAddress}</span>
                </TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{a.port || '-'}</TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{a.applicationName || '-'}</TableCell>
                <TableCell>
                  {a.encrypted
                    ? <VerifiedUserIcon sx={{ fontSize: 16, color: 'success.main' }} />
                    : <PublicIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
                </TableCell>
                <TableCell sx={{ fontSize: '0.8rem' }}>{a.encrypted ? (a.encryptionMethod || '-') : '-'}</TableCell>
                <TableCell sx={{ fontSize: '0.8rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.notes || '-'}
                </TableCell>
                <TableCell>
                  <Tooltip title="编辑"><IconButton size="small" onClick={() => openEdit(a)}><EditIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                  <Tooltip title="删除"><IconButton size="small" onClick={() => {
                    if (!confirm('确认删除该API？')) return;
                    delApi(serverId, a.id);
                  }} sx={{ color: 'error.main' }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table></TableContainer>
      )}

      {/* 新增/编辑弹窗 */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editItem ? '编辑 API' : '新增 API'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {saveError && <Alert severity="error" onClose={() => setSaveError('')}>{saveError}</Alert>}

            {/* 第一行：API地址 | 端口 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                size="small" label="API 地址"
                value={form.apiAddress || ''}
                onChange={e => setForm({ ...form, apiAddress: e.target.value })}
                placeholder="例如：https://api.example.com/v1/users"
                sx={{ flex: 3 }}
              />
              <TextField
                size="small" label="端口" type="number"
                value={form.port || ''}
                onChange={e => setForm({ ...form, port: e.target.value ? Number(e.target.value) : '' })}
                placeholder="例如：443"
                sx={{ flex: 1 }}
              />
            </Box>

            {/* 第二行：所属应用 | 加密 | 加密方式 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                size="small" label="所属应用" select
                value={form.applicationName || ''}
                onChange={e => setForm({ ...form, applicationName: e.target.value })}
                sx={{ flex: 2 }}
              >
                <MenuItem value=""><em>请选择</em></MenuItem>
                {appInstances.map(app => (
                  <MenuItem key={app.id} value={app.name}>{app.name}</MenuItem>
                ))}
              </TextField>
              <TextField
                size="small" label="加密" select
                value={form.encrypted == null ? '' : String(form.encrypted)}
                onChange={e => {
                  const isEnc = e.target.value === 'true';
                  setForm({ ...form, encrypted: isEnc, encryptionMethod: isEnc ? (form.encryptionMethod || '') : '' });
                  if (!isEnc) setCustomEncMethod('');
                }}
                sx={{ flex: 1 }}
              >
                <MenuItem value="true">是</MenuItem>
                <MenuItem value="false">否</MenuItem>
              </TextField>
              <TextField
                size="small" label="加密方式" select
                value={form.encrypted ? (form.encryptionMethod || '') : ''}
                disabled={!form.encrypted}
                onChange={e => {
                  setForm({ ...form, encryptionMethod: e.target.value });
                  if (e.target.value !== '自定义') setCustomEncMethod('');
                }}
                sx={{ flex: 1.5 }}
              >
                {ENCRYPTION_METHODS.map(m => (
                  <MenuItem key={m} value={m}>{m}</MenuItem>
                ))}
              </TextField>
            </Box>

            {/* 当加密方式选"自定义"时显示输入框 */}
            {form.encrypted && form.encryptionMethod === '自定义' && (
              <TextField
                size="small" label="自定义加密方式" fullWidth
                value={customEncMethod}
                onChange={e => setCustomEncMethod(e.target.value)}
                placeholder="请输入传输加密方式，例如：AES-256-GCM"
              />
            )}

            {/* 第三行：入参示例 | 出参示例 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField
                size="small" label="入参示例"
                value={form.requestExample || ''}
                onChange={e => setForm({ ...form, requestExample: e.target.value })}
                multiline rows={6}
                placeholder={`例如：
{
  "page": 1,
  "pageSize": 20,
  "keyword": ""
}`}
                sx={{ flex: 1 }}
              />
              <TextField
                size="small" label="出参示例"
                value={form.responseExample || ''}
                onChange={e => setForm({ ...form, responseExample: e.target.value })}
                multiline rows={6}
                placeholder={`例如：
{
  "code": 0,
  "data": [],
  "msg": "success"
}`}
                sx={{ flex: 1 }}
              />
            </Box>

            {/* 说明 */}
            <TextField
              size="small" label="说明" fullWidth
              value={form.notes || ''}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              multiline rows={2}
              placeholder="API 用途、认证方式等补充说明"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setOpen(false)}>取消</Button>
          <Button size="small" variant="contained" onClick={handleSave}>保存</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
