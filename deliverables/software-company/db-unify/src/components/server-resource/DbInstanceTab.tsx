import React, { useState } from 'react';
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Button, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, FormControl, InputLabel, Select, MenuItem, Chip, Alert, CircularProgress,
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
import ParentNodeSelector from './ParentNodeSelector';
import type { DbInstance, PortInfo, ServerCredential, ServerHost } from '../../types/server';
import { useServerStore } from '../../stores/serverStore';
import { useTreeStore } from '../../stores/treeStore';
import { decryptCredentialPassword } from '../../services/serverService';
import { syncDbInstance, removeDbInstanceConnections, findAssociatedConnectionIds, findTreeNodeByConnectionId } from '../../services/dbInstanceSyncService';

interface Props {
  serverId: string;
  instances: DbInstance[];
  ports: PortInfo[];
  serverIps?: string[];
}

const DB_TYPES = ['MySQL', 'PostgreSQL', 'Oracle', 'SQL Server', '瀚高', '高斯', '达梦', '金仓', 'MongoDB', 'Redis', '其他'];

/** 数据库类型 → 默认端口映射 */
const DB_DEFAULT_PORTS: Record<string, number> = {
  MySQL: 3306,
  PostgreSQL: 5432,
  Oracle: 1521,
  'SQL Server': 1433,
  '瀚高': 5432,
  '高斯': 5432,
  '达梦': 5236,
  '金仓': 54321,
  MongoDB: 27017,
  Redis: 6379,
};

/** 凭据行结构 */
interface CredField { username: string; password: string; schema: string; region: string; connectionName: string }

export default function DbInstanceTab({ serverId, instances, ports, serverIps = [] }: Props) {
  const addDbInstance = useServerStore(s => s.addDbInstance);
  const updateDbInstance = useServerStore(s => s.updateDbInstance);
  const deleteDbInstance = useServerStore(s => s.deleteDbInstance);
  const addPort = useServerStore(s => s.addPort);
  const updatePort = useServerStore(s => s.updatePort);
  const deletePort = useServerStore(s => s.deletePort);
  const [open, setOpen] = useState(false);
  const [editItem, setEditItem] = useState<DbInstance | null>(null);
  const [form, setForm] = useState<any>({});
  const [credentials, setCredentials] = useState<CredField[]>([{ username: '', password: '', schema: '', region: '', connectionName: '' }]);
  // 密码生成弹窗索引
  const [pwdGenDialog, setPwdGenDialog] = useState<number | null>(null);
  // 保存错误提示
  const [saveError, setSaveError] = useState('');
  // 实例级密码历史弹窗
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyInstance, setHistoryInstance] = useState<DbInstance | null>(null);
  // 父节点选择对话框
  const [parentSelectorOpen, setParentSelectorOpen] = useState(false);
  const [pendingSaveData, setPendingSaveData] = useState<any>(null);
  const [pendingIsEdit, setPendingIsEdit] = useState(false);

  // 密码二次验证弹窗
  const [pwdVerifyOpen, setPwdVerifyOpen] = useState(false);
  const [pwdVerifyTarget, setPwdVerifyTarget] = useState<{ pwdKey: string; credIndex: number; username: string; action?: 'copy' | 'view' } | null>(null);
  const [pwdVerifyInput, setPwdVerifyInput] = useState('');
  const [pwdVerifyError, setPwdVerifyError] = useState('');
  const [pwdVerifyLoading, setPwdVerifyLoading] = useState(false);
  // 已验证通过并缓存的密码: Map<pwdKey, decryptedPlaintext>
  const [decryptedCache, setDecryptedCache] = useState<Map<string, string>>(new Map());
  // 当前显示/隐藏状态 (仅对已验证通过的密码有效): Set<pwdKey>
  const [revealedPwds, setRevealedPwds] = useState<Set<string>>(new Set());

  // 凭据级密码历史弹窗（表格中触发）
  const [credHistoryDialog, setCredHistoryDialog] = useState<{ instance: DbInstance; credIndex: number; username: string } | null>(null);

  // 主页面密码修改弹窗
  const [pwdChangeOpen, setPwdChangeOpen] = useState(false);
  const [pwdChangeTarget, setPwdChangeTarget] = useState<{ instance: DbInstance; credIndex: number; username: string } | null>(null);
  const [pwdChangeValue, setPwdChangeValue] = useState('');
  const [pwdChangeShowPwd, setPwdChangeShowPwd] = useState(false);
  const [pwdChangeShowGen, setPwdChangeShowGen] = useState(false);

  const resetForm = () => { setForm({}); setCredentials([{ username: '', password: '', schema: '', region: '', connectionName: '' }]); setPwdGenDialog(null); setSaveError(''); };

  const openAdd = () => { setEditItem(null); resetForm(); setForm({ internalIp: serverIps[0] || '' }); setOpen(true); };
  const openEdit = (item: DbInstance) => {
    setEditItem(item);
    setForm({ ...item, password: '******' });
    if (item.credentials && item.credentials.length > 0) {
      setCredentials(item.credentials.map((c: any) => ({ username: c.username, schema: c.schema || '', region: c.region || '', connectionName: c.connectionName || '', password: c.password && c.password !== '******' ? '******' : (c.password || '') })));
    } else if (item.username) {
      setCredentials([{ username: item.username, schema: (item as any).schema || '', region: '', connectionName: '', password: item.password || '******' }]);
    } else {
      setCredentials([{ username: '', password: '', schema: '', region: '', connectionName: '' }]);
    }
    setPwdGenDialog(null);
    setOpen(true);
  };

  const handleDelete = async (item: DbInstance) => {
    if (!confirm('确认删除该数据库实例？')) return;
    // 先同步删除关联的连接和树节点
    try {
      await removeDbInstanceConnections(serverId, item.id);
    } catch (err) {
      console.error('删除关联连接失败:', err);
    }
    // 删除数据库实例
    deleteDbInstance(serverId, item.id);
    // 同步删除端口管理中的对应记录
    if (item.port) {
      const matchedPort = ports.find(p => p.port === item.port);
      if (matchedPort) deletePort(serverId, matchedPort.id);
    }
  };

  const handleSave = async () => {
    // 校验必填字段
    if (!form.dbType) { setSaveError('请选择数据库类型'); return; }
    if (!form.dbName || !form.dbName.trim()) { setSaveError('请填写数据库名'); return; }
    if (!form.port) { setSaveError('请填写端口'); return; }
    
    const validCreds = credentials.filter(c => c.username.trim());
    if (validCreds.length === 0) {
      setSaveError('请至少填写一个有效的用户凭据（用户名不能为空）');
      return;
    }
    const data: any = { ...form, credentials: validCreds };
    console.log('[sync] handleSave data:', { dbType: data.dbType, dbName: data.dbName, port: data.port, internalIp: data.internalIp, credsCount: validCreds.length });
    setSaveError('');
    
    if (editItem) {
      // 编辑模式：直接保存
      try {
        await updateDbInstance(serverId, editItem.id, data);
        // 编辑时同步端口信息：根据原端口号匹配并更新
        if (form.port && editItem.port) {
          const matchedPort = ports.find(p => p.port === editItem.port);
          if (matchedPort) {
            updatePort(serverId, matchedPort.id, {
              port: form.port,
              protocol: 'TCP',
              type: '数据库',
              serviceName: `${form.dbType || '数据库'}/${form.dbName || 'unknown'}`,
              notes: form.notes || '',
            });
          }
        }
        // 编辑时同步到连接管理和树节点
        try {
          const editStoreState = useServerStore.getState();
          const serverHost = editStoreState.serverMap[serverId];
          const editDbInstances = editStoreState.dbInstances[serverId] || [];
          if (serverHost) {
            const updatedInstance = editDbInstances.find((di: DbInstance) => di.id === editItem.id);
            if (updatedInstance) {
              // 查找已关联的连接 ID
              const existingConnIds = findAssociatedConnectionIds(serverId, editItem.id);
              // 找到第一个关联连接的树节点父节点
              let parentNodeId = '';
              if (existingConnIds.length > 0) {
                const nodeId = findTreeNodeByConnectionId(existingConnIds[0]);
                if (nodeId) {
                  const treeNode = useTreeStore.getState().nodes[nodeId];
                  if (treeNode) {
                    parentNodeId = treeNode.parentId || '';
                  }
                }
              }
              if (parentNodeId) {
                await syncDbInstance(serverHost, updatedInstance, parentNodeId, existingConnIds);
              }
            }
          }
        } catch (syncErr) {
          console.error('同步到连接管理失败:', syncErr);
        }
        setOpen(false);
      } catch (err: any) {
        const msg = err?.response?.data?.error || err?.message || '保存失败';
        setSaveError(msg);
      }
    } else {
      // 新增模式：先打开父节点选择对话框
      setPendingSaveData(data);
      setPendingIsEdit(false);
      setParentSelectorOpen(true);
    }
  };

  // 父节点选择确认回调
  const handleParentSelect = async (parentNodeId: string) => {
    // 立即保存 pendingSaveData 到局部变量，防止被 onClose 清理
    const saveData = pendingSaveData;
    if (!saveData) {
      console.warn('[sync] handleParentSelect: pendingSaveData 为空');
      return;
    }
    // 先清理状态，防止重复调用
    setPendingSaveData(null);
    setParentSelectorOpen(false);
    
    try {
      console.log('[sync] 开始新增数据库实例:', saveData.dbName, 'serverId:', serverId);
      console.log('[sync] 请求体:', JSON.stringify({
        dbType: saveData.dbType,
        dbName: saveData.dbName,
        port: saveData.port,
        internalIp: saveData.internalIp,
        externalIp: saveData.externalIp,
        schema: saveData.schema,
        notes: saveData.notes,
        credentials: saveData.credentials?.map((c: any) => ({ username: c.username, hasPwd: !!c.password, schema: c.schema })),
      }));
      // 新增数据库实例
      await addDbInstance(serverId, saveData);
      console.log('[sync] addDbInstance 完成');
      
      // 获取最新实例数据
      const storeState = useServerStore.getState();
      const serverHost = storeState.serverMap[serverId];
      const latestDbInstances = storeState.dbInstances[serverId] || [];
      
      console.log('[sync] serverHost:', serverHost?.name, 'dbInstances count:', latestDbInstances.length);
      
      if (!serverHost) {
        console.error('[sync] 未找到 serverHost，serverId:', serverId, 'serverMap keys:', Object.keys(storeState.serverMap));
        return;
      }
      if (latestDbInstances.length === 0) {
        console.error('[sync] dbInstances 为空，serverId:', serverId);
        return;
      }
      
      const newInstance = latestDbInstances[latestDbInstances.length - 1];
      console.log('[sync] 新实例:', newInstance.dbName, 'credentials:', newInstance.credentials?.length);
      
      // 用 saveData 中的原始明文凭据覆盖脱敏后的凭据，否则 syncDbInstance 会把 ****** 当空密码发给后端导致 "连接参数不完整"
      const instanceWithPlainCreds = {
        ...newInstance,
        credentials: saveData.credentials || newInstance.credentials,
      };
      
      // 同步到连接管理和树节点
      try {
        await syncDbInstance(serverHost, instanceWithPlainCreds, parentNodeId);
        console.log('[sync] syncDbInstance 完成');
      } catch (syncErr) {
        console.error('[sync] 同步到连接管理失败:', syncErr);
      }
      
      // 新增时不需要同步到端口管理——端口信息已记录在数据库实例中
      // 若再 addPort 会导致后端 checkPortUnique 查出端口已被自身实例占用而报 409
      
      setOpen(false);
    } catch (err: any) {
      const httpStatus = err?.response?.status;
      const errMsg = err?.response?.data?.error || err?.message || '保存失败';
      console.error('[sync] 保存失败:', errMsg, 'HTTP', httpStatus);
      
      // 如果是端口冲突(409)，尝试查找已有同名实例并直接同步连接（可能是上次创建成功但同步失败）
      if (httpStatus === 409 && saveData?.dbName) {
        try {
          const retryStore = useServerStore.getState();
          const retryHost = retryStore.serverMap[serverId];
          const conflicted = (retryStore.dbInstances[serverId] || [])
            .find(d => d.port === saveData.port || d.dbName === saveData.dbName);
          if (conflicted && retryHost) {
            console.log('[sync] 端口冲突但找到同名实例，改为直接同步连接:', conflicted.dbName);
            const instanceWithPlainCreds = {
              ...conflicted,
              credentials: saveData.credentials || conflicted.credentials,
            };
            await syncDbInstance(retryHost, instanceWithPlainCreds, parentNodeId);
            console.log('[sync] 重试同步完成');
            setOpen(false);
            return; // 成功，跳过错误提示
          }
        } catch (retryErr: any) {
          console.error('[sync] 冲突重试也失败:', retryErr);
        }
      }
      setSaveError(errMsg);
    }
  };

  const openHistory = (item: DbInstance) => {
    setHistoryInstance(item);
    setHistoryOpen(true);
  };

  const addCred = () => setCredentials([...credentials, { username: '', password: '', schema: '', region: '', connectionName: '' }]);
  const removeCred = (i: number) => setCredentials(credentials.filter((_, idx) => idx !== i));
  const updateCred = (i: number, field: 'username' | 'password' | 'schema' | 'region' | 'connectionName', val: string) => {
    const next = [...credentials];
    next[i][field] = val;
    setCredentials(next);
  };

  // 编辑弹窗中的凭据密码历史
  const [credHistoryOpen, setCredHistoryOpen] = useState<{ index: number; username: string } | null>(null);

  // 删除单个凭据
  const handleDeleteCredential = (instance: DbInstance, credIndex: number) => {
    if (!confirm('确认删除该凭据？')) return;
    const newCreds = [...(instance.credentials || [])];
    newCreds.splice(credIndex, 1);
    updateDbInstance(serverId, instance.id, { credentials: newCreds });
  };

  // 打开密码修改弹窗
  const openPwdChange = (instance: DbInstance, credIndex: number, username: string) => {
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
      : [{ username: instance.username || '', password: '******', schema: instance.schema || '', region: '', connectionName: '' }];
    if (credIndex < creds.length) {
      creds[credIndex] = { ...creds[credIndex], password: pwdChangeValue };
    }
    updateDbInstance(serverId, instance.id, { credentials: creds });
    setPwdChangeOpen(false);
    setPwdChangeTarget(null);
  };

  // 点击眼睛图标 → 弹出二次验证弹窗
  const requestViewPassword = (pwdKey: string, credIndex: number, username: string) => {
    // 已缓存且当前可见 → 隐藏
    if (decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey)) {
      setRevealedPwds(prev => { const n = new Set(prev); n.delete(pwdKey); return n; });
      return;
    }
    // 已缓存但隐藏 → 直接显示
    if (decryptedCache.has(pwdKey)) {
      setRevealedPwds(prev => new Set(prev).add(pwdKey));
      return;
    }
    // 未验证 → 弹出验证弹窗
    setPwdVerifyTarget({ pwdKey, credIndex, username });
    setPwdVerifyInput('');
    setPwdVerifyError('');
    setPwdVerifyOpen(true);
  };

  // 提交二次验证
  const handleVerifyPassword = async () => {
    if (!pwdVerifyInput.trim() || !pwdVerifyTarget) return;
    setPwdVerifyLoading(true);
    setPwdVerifyError('');
    try {
      const result = await decryptCredentialPassword(serverId, pwdVerifyTarget.credIndex, pwdVerifyInput);
      if (result.error) {
        setPwdVerifyError(result.error);
        setPwdVerifyLoading(false);
        return;
      }
      const plaintext = result.password || '';
      setDecryptedCache(prev => {
        const next = new Map(prev);
        next.set(pwdVerifyTarget.pwdKey, plaintext);
        return next;
      });
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

  // 获取凭据显示用的密码文本
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

  // 获取实例的所有凭据列表（兼容旧版单字段）
  const getInstanceCreds = (d: DbInstance): (ServerCredential & { _key: string; _index: number })[] => {
    if (d.credentials && d.credentials.length > 0) {
      return d.credentials.map((c, i) => ({ ...c, _key: `${d.id}-${i}`, _index: i }));
    }
    // 兼容旧版单凭据
    return [{ username: d.username || '', password: d.password || '******', schema: d.schema || '', region: '', connectionName: '', _key: `${d.id}-0`, _index: 0 }];
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>数据库实例 ({instances.length})</Typography>
        <Button size="small" startIcon={<AddIcon />} onClick={openAdd}>新增</Button>
      </Box>
      {instances.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ pt: 0.5, textAlign: 'left', fontSize: '0.9rem' }}>暂无数据库实例</Typography>
      ) : (
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>类型</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>库名</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>IP:端口</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>Schema</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>所属区域</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>连接名称</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>用户</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>密码</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>备注</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.85rem' }}>操作</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {instances.map(d => {
                const creds = getInstanceCreds(d);
                const credCount = creds.length;
                return creds.map((cred, ci) => {
                  const pwdKey = cred._key;
                  const isRevealed = decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey);
                  return (
                    <TableRow key={pwdKey}>
                      {ci === 0 && <TableCell rowSpan={credCount}><Chip label={d.dbType} size="small" sx={{ fontSize: '0.8rem' }} /></TableCell>}
                      {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.9rem' }}>{d.dbName}</TableCell>}
                      {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.9rem' }}>{d.internalIp || d.externalIp || '-'}:{d.port}</TableCell>}
                      <TableCell sx={{ fontSize: '0.9rem' }}>{cred.schema || '-'}</TableCell>
                      <TableCell sx={{ fontSize: '0.9rem' }}>{cred.region || '-'}</TableCell>
                      <TableCell sx={{ fontSize: '0.9rem' }}>{cred.connectionName || '-'}</TableCell>
                      <TableCell sx={{ fontSize: '0.9rem' }}>{cred.username || '-'}</TableCell>
                      <TableCell sx={{ fontSize: '0.85rem' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, flexWrap: 'nowrap' }}>
                          <Typography
                            sx={{
                              fontFamily: 'monospace',
                              fontSize: '0.85rem',
                              minWidth: 90,
                              userSelect: isRevealed ? 'text' : 'none',
                              letterSpacing: isRevealed ? '0' : '2px',
                            }}
                          >
                            {getDisplayPassword(pwdKey, cred.password || '')}
                          </Typography>
                          <Tooltip title="复制密码">
                            <IconButton size="small" onClick={() => handleCopyPassword(pwdKey, cred._index, cred.username || '')}>
                              <ContentCopyIcon sx={{ fontSize: 15, color: '#1976d2' }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="修改密码">
                            <IconButton size="small" onClick={() => openPwdChange(d, ci, cred.username || '')}>
                              <LockResetIcon sx={{ fontSize: 15, color: '#ed6c02' }} />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title={isRevealed ? '隐藏密码' : '查看密码（需二次验证）'}>
                            <IconButton size="small" onClick={() => requestViewPassword(pwdKey, cred._index, cred.username || '')}>
                              {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 15 }} /> : <VisibilityIcon sx={{ fontSize: 15 }} />}
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="密码历史">
                            <IconButton size="small" onClick={() => cred.username ? setCredHistoryDialog({ instance: d, credIndex: ci, username: cred.username }) : null}>
                              <HistoryIcon sx={{ fontSize: 15 }} />
                            </IconButton>
                          </Tooltip>
                          {credCount > 1 && (
                            <Tooltip title="删除此凭据">
                              <IconButton size="small" onClick={() => handleDeleteCredential(d, ci)} sx={{ color: 'error.main' }}>
                                <DeleteIcon sx={{ fontSize: 15 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                      {ci === 0 && <TableCell rowSpan={credCount} sx={{ fontSize: '0.9rem', maxWidth: 160 }}>{d.notes || '-'}</TableCell>}
                      {ci === 0 && (
                        <TableCell rowSpan={credCount} sx={{ verticalAlign: 'middle', textAlign: 'center' }}>
                          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
                            <Tooltip title="编辑实例">
                              <IconButton size="small" onClick={() => openEdit(d)}><EditIcon sx={{ fontSize: 16 }} /></IconButton>
                            </Tooltip>
                            <Tooltip title="删除实例">
                              <IconButton size="small" onClick={() => handleDelete(d)} sx={{ color: 'error.main' }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                            </Tooltip>
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

      {/* 新增/编辑弹窗 */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editItem ? '编辑数据库实例' : '新增数据库实例'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            {saveError && <Alert severity="error">{saveError}</Alert>}
            {/* 第一行：访问IP | 数据库类型 | 版本 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <FormControl size="small" sx={{ flex: 1 }}><InputLabel>访问IP</InputLabel>
                <Select value={form.internalIp || ''} label="访问IP" onChange={e => setForm({ ...form, internalIp: e.target.value })}>
                  {serverIps.map(ip => <MenuItem key={ip} value={ip}>{ip}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ flex: 1 }}><InputLabel>数据库类型</InputLabel>
                <Select value={form.dbType || ''} label="数据库类型" onChange={e => {
                  const dbType = e.target.value;
                  const defaultPort = DB_DEFAULT_PORTS[dbType];
                  setForm({ ...form, dbType, port: form.port || defaultPort || '' });
                }}>
                  {DB_TYPES.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField size="small" label="版本" value={form.version || ''} onChange={e => setForm({ ...form, version: e.target.value })} sx={{ flex: 1 }} />
            </Box>
            {/* 第二行：数据库名 | 端口 | 备注 */}
            <Box sx={{ display: 'flex', gap: 2 }}>
              <TextField size="small" label="数据库名" value={form.dbName || ''} onChange={e => setForm({ ...form, dbName: e.target.value })} sx={{ flex: 1 }} />
              <TextField size="small" label="端口" type="number" value={form.port || ''} onChange={e => { const v = Number(e.target.value); setForm({ ...form, port: isNaN(v) ? '' : v }); }} sx={{ flex: 1 }} />
              <TextField size="small" label="备注" value={form.notes || ''} onChange={e => setForm({ ...form, notes: e.target.value })} sx={{ flex: 1 }} />
            </Box>

            {/* 多用户凭据列表（含Schema） */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>用户凭据</Typography>
                <Button size="small" variant="outlined" sx={{ minWidth: 32, p: '2px 6px', fontSize: '0.7rem' }} onClick={addCred}>+ 添加</Button>
              </Box>
              {credentials.map((cred, i) => (
                <Box key={i} sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mb: 1, p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                    <TextField size="small" label="所属区域" value={cred.region} onChange={e => updateCred(i, 'region', e.target.value)} sx={{ flex: 1 }} />
                    <TextField size="small" label="连接名称" value={cred.connectionName} onChange={e => updateCred(i, 'connectionName', e.target.value)} sx={{ flex: 1 }} />
                    <TextField size="small" label="Schema" value={cred.schema} onChange={e => updateCred(i, 'schema', e.target.value)} sx={{ flex: 1 }} />
                    <TextField size="small" label="用户名" value={cred.username} onChange={e => updateCred(i, 'username', e.target.value)} sx={{ flex: 1 }} />
                    <TextField size="small" label="密码" type="password" autoComplete="new-password" value={cred.password} onChange={e => updateCred(i, 'password', e.target.value)} sx={{ flex: 1.5 }} />
                    <Button size="small" variant="outlined" onClick={() => setPwdGenDialog(i)} sx={{ minWidth: 56, flexShrink: 0, fontSize: '0.7rem', height: 40 }}>生成</Button>
                    <Tooltip title="密码历史">
                      <IconButton
                        size="small"
                        onClick={() => cred.username ? setCredHistoryOpen({ index: i, username: cred.username }) : null}
                        sx={{ flexShrink: 0, height: 40, width: 40 }}
                      ><HistoryIcon sx={{ fontSize: 16 }} /></IconButton>
                    </Tooltip>
                    {credentials.length > 1 && (
                      <IconButton size="small" onClick={() => removeCred(i)} sx={{ color: 'error.main', flexShrink: 0 }}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setOpen(false)}>取消</Button>
          <Button size="small" variant="contained" onClick={handleSave}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 密码生成弹窗 */}
      {pwdGenDialog !== null && (
        <PasswordGenerator
          open={true}
          onApply={p => { updateCred(pwdGenDialog, 'password', p); setPwdGenDialog(null); }}
          onClose={() => setPwdGenDialog(null)}
        />
      )}

      {/* 单个凭据密码历史弹窗 */}
      {credHistoryOpen && form.dbName && (
        <InstancePwdHistoryDialog
          open={true}
          serverId={serverId}
          fieldName={`dbInstance-${form.dbName}-cred-${credHistoryOpen.username}`}
          instanceName={`${form.dbType || 'DB'} / ${form.dbName} - ${credHistoryOpen.username}`}
          onClose={() => setCredHistoryOpen(null)}
        />
      )}

      {/* 实例级密码历史弹窗 */}
      {historyInstance && (
        <InstancePwdHistoryDialog
          open={historyOpen}
          serverId={serverId}
          fieldName={`dbInstance-${historyInstance.dbName}`}
          instanceName={`${historyInstance.dbType} / ${historyInstance.dbName}`}
          onClose={() => setHistoryOpen(false)}
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
        <DialogTitle sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
          二次验证 - {pwdVerifyTarget?.action === 'copy' ? '复制凭据密码' : '查看凭据密码'}
        </DialogTitle>
        <DialogContent>
          {pwdVerifyError && <Alert severity="error" sx={{ mb: 1.5 }}>{pwdVerifyError}</Alert>}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            请输入二次验证密码以查看凭据「{pwdVerifyTarget?.username || '-'}」的明文密码
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            type="password"
            autoComplete="new-password"
            label="二次验证密码"
            value={pwdVerifyInput}
            onChange={e => { setPwdVerifyInput(e.target.value); setPwdVerifyError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleVerifyPassword(); }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => { setPwdVerifyOpen(false); setPwdVerifyTarget(null); setPwdVerifyError(''); setPwdVerifyInput(''); }}>取消</Button>
          <Button size="small" variant="contained" onClick={handleVerifyPassword} disabled={pwdVerifyLoading || !pwdVerifyInput.trim()}>
            {pwdVerifyLoading ? <CircularProgress size={16} sx={{ mr: 0.5 }} /> : null}
            验证
          </Button>
        </DialogActions>
      </Dialog>

      {/* 父节点选择对话框 */}
      <ParentNodeSelector
        open={parentSelectorOpen}
        onClose={() => { setParentSelectorOpen(false); setPendingSaveData(null); }}
        onSelect={handleParentSelect}
      />
    </Box>
  );
}
