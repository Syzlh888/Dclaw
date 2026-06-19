import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box, FormControl, InputLabel, Select, MenuItem,
  IconButton, Tooltip, InputAdornment, Typography, Snackbar, Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import HistoryIcon from '@mui/icons-material/History';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PasswordGenerator from './PasswordGenerator';
import EngineeringDictDialog from './EngineeringDictDialog';
import ApplicationDictDialog from './ApplicationDictDialog';
import OsDictDialog from './OsDictDialog';
import ProjectDictDialog from './ProjectDictDialog';
import ServerLocationDictDialog from './ServerLocationDictDialog';
import CredentialHistoryDialog from './CredentialHistoryDialog';
import { useProjectStore } from '../../stores/projectStore';
import { useSystemConfigStore } from '../../stores/systemConfigStore';
import { decryptCredentialPassword } from '../../services/serverService';
import { apiFetch } from '../../services/apiClient';
import type { AccessEntry, AccessLinkage, IpEntry, ServerCredential } from '../../types/server';

interface Props {
  open: boolean;
  server?: any;
  loading?: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
}

const ServerFormDialog: React.FC<Props> = ({ open, server, loading, onClose, onSave }) => {
  const projects = useProjectStore(s => s.projects);
  const allEngineerings = useProjectStore(s => s.engineerings);
  const allApplications = useProjectStore(s => s.applications);

  const osList = useSystemConfigStore(s => s.osList);
  const loadOsDict = useSystemConfigStore(s => s.loadOsDict);
  const serverLocationList = useSystemConfigStore(s => s.serverLocationList);
  const loadServerLocationDict = useSystemConfigStore(s => s.loadServerLocationDict);

  const [form, setForm] = useState<any>({});
  const [pwdDialogOpen, setPwdDialogOpen] = useState(false);
  const [pwdTargetIndex, setPwdTargetIndex] = useState(0);
  const [engDictOpen, setEngDictOpen] = useState(false);
  const [appDictOpen, setAppDictOpen] = useState(false);
  const [osDictOpen, setOsDictOpen] = useState(false);
  const [projectDictOpen, setProjectDictOpen] = useState(false);
  const [locationDictOpen, setLocationDictOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedEngId, setSelectedEngId] = useState('');
  const [credentials, setCredentials] = useState<ServerCredential[]>([]);
  const [ipList, setIpList] = useState<IpEntry[]>([]);

  // 凭据密码验证/历史
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyPwd, setVerifyPwd] = useState('');
  const [verifyTargetIdx, setVerifyTargetIdx] = useState(0);
  const [verifyError, setVerifyError] = useState('');
  const [credHistoryOpen, setCredHistoryOpen] = useState(false);
  const [credHistoryIdx, setCredHistoryIdx] = useState(0);

  // 关联访问管理
  const [accessEntries, setAccessEntries] = useState<AccessEntry[]>([]);
  const [accessList, setAccessList] = useState<AccessLinkage[]>([]);

  // 已解密的凭据索引集合（查看后暂时可见）
  const [revealedCreds, setRevealedCreds] = useState<Set<number>>(new Set());

  // 复制提示
  const [copySnackbar, setCopySnackbar] = useState(false);

  // 用 ref 追踪是否已初始化，防止重复挂载导致表单被重置
  const initializedRef = useRef(false);

  useEffect(() => {
    if (open && !initializedRef.current) {
      initializedRef.current = true;
      loadOsDict();
      loadServerLocationDict();
      // 加载访问条目列表
      apiFetch('/api/access').then(r => r.json()).then(d => {
        setAccessEntries(d.entries || []);
      }).catch(() => {});
      if (server) {
        setForm({
          ...server,
          applicationId: server.applicationId || '',
        });
        const existingCreds = server.credentials && Array.isArray(server.credentials) ? server.credentials : [];
        if (existingCreds.length > 0) {
          setCredentials(existingCreds);
        } else if (server.username) {
          const users = server.username.split(',').map((s: string) => s.trim()).filter(Boolean);
          setCredentials(users.map((u: string) => ({ username: u, password: '******' })));
        } else {
          setCredentials([]);
        }
        const existingIps = server.ips && Array.isArray(server.ips) ? server.ips : [];
        setIpList(existingIps.length > 0 ? existingIps : [{ ip: '', type: '局域' as const, port: undefined, mappedIp: '' }]);

        // 直接使用服务器中保存的 projectId / engineeringId
        setSelectedProjectId(server.projectId || '');
        setSelectedEngId(server.engineeringId || '');

        // 初始化访问管理字段
        setAccessList(server.accessList && server.accessList.length > 0 ? server.accessList : []);
      } else {
        setForm({});
        setCredentials([]);
        setIpList([{ ip: '', type: '局域', port: undefined, mappedIp: '' }]);
        setSelectedProjectId('');
        setSelectedEngId('');
        setAccessList([]);
      }
      setRevealedCreds(new Set());
    }
    if (!open) {
      initializedRef.current = false;
    }
  }, [open, server]);

  const engineerings = allEngineerings.filter(e => e.projectId === selectedProjectId);
  const applications = allApplications.filter(a => a.engineeringId === selectedEngId);

  // 根据访问条目获取可选的访问方式列表
  const accessTypeOptions = Array.from(new Set(accessEntries.map(e => e.type).filter(Boolean)));
  
  // 根据选中的访问方式过滤可选地址
  const getAccessAddrs = (type: string) =>
    accessEntries.filter(e => e.type === type && e.address).map(e => e.address);
  
  // 根据选中的地址获取可选用户
  const getUsersForAddr = (addr: string, type: string) => {
    const entry = accessEntries.find(e => e.type === type && e.address === addr);
    if (!entry) return [];
    if (entry.credentials && entry.credentials.length > 0)
      return entry.credentials.map(c => c.username).filter(Boolean);
    if (entry.username) return [entry.username];
    return [];
  };
  
  // access list helpers
  const addAccessEntry = () => setAccessList([...accessList, { type: '', address: '', user: '' }]);
  const removeAccessEntry = (i: number) => setAccessList(accessList.filter((_, idx) => idx !== i));
  const updateAccessEntry = (i: number, patch: Partial<AccessLinkage>) => {
    const next = [...accessList];
    next[i] = { ...next[i], ...patch };
    // Reset downstream fields when upstream changes
    if ('type' in patch) { next[i].address = ''; next[i].user = ''; }
    if ('address' in patch) { next[i].user = ''; }
    setAccessList(next);
  };

  const handleProjectChange = (pid: string) => {
    setSelectedProjectId(pid);
    setSelectedEngId('');
    setForm({ ...form, applicationId: '' });
  };

  const handleEngChange = (eid: string) => {
    setSelectedEngId(eid);
    setForm({ ...form, applicationId: '' });
  };

  // IP list helpers
  const addIpEntry = () => setIpList([...ipList, { ip: '', type: '局域', port: undefined, mappedIp: '' }]);
  const removeIpEntry = (idx: number) => setIpList(ipList.filter((_, i) => i !== idx));
  const updateIpEntry = (idx: number, patch: Partial<IpEntry>) => {
    const next = [...ipList];
    next[idx] = { ...next[idx], ...patch };
    setIpList(next);
  };

  // Credential list helpers
  const addCredential = () => setCredentials([...credentials, { username: '', password: '' }]);
  const removeCredential = (idx: number) => setCredentials(credentials.filter((_, i) => i !== idx));
  const updateCredential = (idx: number, patch: Partial<ServerCredential>) => {
    const next = [...credentials];
    next[idx] = { ...next[idx], ...patch };
    setCredentials(next);
  };

  // 查看凭据密码
  const handleViewCredPassword = (idx: number) => {
    // 如果已显示明文，点击切换隐藏
    if (revealedCreds.has(idx)) {
      setRevealedCreds(prev => { const n = new Set(prev); n.delete(idx); return n; });
      return;
    }
    // 编辑模式需要验证身份
    if (server?.id) {
      setVerifyTargetIdx(idx);
      setVerifyPwd('');
      setVerifyError('');
      setVerifyOpen(true);
    } else {
      // 新增模式无需验证
      setRevealedCreds(prev => { const n = new Set(prev); n.add(idx); return n; });
    }
  };

  const handleVerifySubmit = async () => {
    if (!verifyPwd || !server?.id) {
      setVerifyError('请输入二次验证密码');
      return;
    }
    try {
      const result = await decryptCredentialPassword(server.id, verifyTargetIdx, verifyPwd);
      if (result.password) {
        updateCredential(verifyTargetIdx, { password: result.password });
        setRevealedCreds(prev => { const n = new Set(prev); n.add(verifyTargetIdx); return n; });
        setVerifyOpen(false);
      } else {
        setVerifyError('解密失败');
      }
    } catch (err: any) {
      setVerifyError(err?.message || '验证失败');
    }
  };

  const handleCopyPassword = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopySnackbar(true);
    }).catch(() => {});
  }, []);

  // 查看凭据历史
  const handleViewCredHistory = (idx: number) => {
    setCredHistoryIdx(idx);
    setCredHistoryOpen(true);
  };

  const handleSave = () => {
    const data: any = {};
    const fields = ['os', 'cpuCores', 'memoryGB',
      'systemDiskGB', 'dataDiskGB', 'bandwidthMbps', 'serverLocation', 'serverType',
      'tags', 'notes'];
    fields.forEach(f => { if (form[f] !== undefined) data[f] = form[f]; });
    data.projectId = selectedProjectId || '';
    data.engineeringId = selectedEngId || '';
    data.applicationId = form.applicationId || '';
    data.ips = ipList.filter(e => e.ip.trim());
    data.credentials = credentials.filter(c => c.username.trim());
    data.accessList = accessList.filter(a => a.type && a.address && a.user);
    if (form.tags && typeof form.tags === 'string') data.tags = form.tags.split(',').map((t: string) => t.trim()).filter(Boolean);
    onSave(data);
  };

  const renderNumField = (label: string, field: string, unit: string) => (
    <TextField size="small" label={label} type="number"
      value={form[field] ?? ''}
      onChange={e => {
        const v = e.target.value;
        if (v === '') { setForm({ ...form, [field]: '' }); return; }
        const n = Number(v);
        if (!isNaN(n) && n >= 0) setForm({ ...form, [field]: n });
      }}
      fullWidth
      inputProps={{ min: 0 }}
      InputProps={{ endAdornment: <InputAdornment position="end">{unit}</InputAdornment> }}
    />
  );

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>
          {server ? '编辑服务器' : '新增服务器'}
        </DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
            {/* 项目/工程/应用 三个下拉 */}
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>项目</InputLabel>
                  <Select value={selectedProjectId} label="项目" onChange={e => handleProjectChange(e.target.value)}>
                    <MenuItem value="">--</MenuItem>
                    {projects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Tooltip title="维护项目字典"><IconButton size="small" onClick={() => setProjectDictOpen(true)}><SettingsIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
              </Box>

              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>工程</InputLabel>
                  <Select value={selectedEngId} label="工程" onChange={e => handleEngChange(e.target.value)}>
                    <MenuItem value="">--</MenuItem>
                    {engineerings.map(e => <MenuItem key={e.id} value={e.id}>{e.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Tooltip title="维护工程字典"><IconButton size="small" onClick={() => setEngDictOpen(true)}><SettingsIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
              </Box>

              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', gap: 0.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>应用</InputLabel>
                  <Select value={form.applicationId || ''} label="应用" onChange={e => setForm({ ...form, applicationId: e.target.value })}>
                    <MenuItem value="">--</MenuItem>
                    {applications.map(a => <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Tooltip title="维护应用字典"><IconButton size="small" onClick={() => setAppDictOpen(true)}><SettingsIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
              </Box>
            </Box>

            {/* IP 地址信息 - 动态列表 */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>IP地址信息</Typography>
              {ipList.map((entry, idx) => (
                <Box key={idx} sx={{ display: 'flex', gap: 0.5, mb: 0.5 }}>
                  <TextField size="small" label="IP地址"
                    value={entry.ip}
                    onChange={e => updateIpEntry(idx, { ip: e.target.value })}
                    sx={{ flex: 2, minWidth: 0 }} />
                  <TextField size="small" label="映射端口" type="number"
                    value={entry.port ?? ''}
                    onChange={e => {
                      const v = e.target.value;
                      if (v === '') { updateIpEntry(idx, { port: undefined }); return; }
                      const n = Number(v);
                      if (!isNaN(n) && n >= 0) updateIpEntry(idx, { port: n });
                    }}
                    sx={{ flex: 1.2, minWidth: 0 }}
                    inputProps={{ min: 0 }} />
                  <TextField size="small" label="映射IP地址"
                    value={entry.mappedIp ?? ''}
                    onChange={e => updateIpEntry(idx, { mappedIp: e.target.value })}
                    sx={{ flex: 1.5, minWidth: 0 }} />
                  <FormControl size="small" sx={{ flex: 0.9, minWidth: 0 }}>
                    <InputLabel>类型</InputLabel>
                    <Select value={entry.type} label="类型"
                      onChange={e => updateIpEntry(idx, { type: e.target.value as IpEntry['type'] })}>
                      <MenuItem value="局域">局域</MenuItem>
                      <MenuItem value="政务外">政务外</MenuItem>
                      <MenuItem value="政务内">政务内</MenuItem>
                      <MenuItem value="互联网">互联网</MenuItem>
                    </Select>
                  </FormControl>
                  <IconButton size="small" onClick={() => removeIpEntry(idx)}
                    sx={{ flexShrink: 0, alignSelf: 'center' }}>
                    <CloseIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              ))}
              <Button size="small" startIcon={<AddIcon />} onClick={addIpEntry} type="button">
                添加IP地址
              </Button>
            </Box>

            {/* 服务器位置 + 服务器类型 + 操作系统 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>服务器位置</InputLabel>
                  <Select value={form.serverLocation || ''} label="服务器位置"
                    onChange={e => setForm({ ...form, serverLocation: e.target.value })}>
                    <MenuItem value="">--</MenuItem>
                    {serverLocationList.map(item => <MenuItem key={item.name} value={item.name}>{item.shortName ? `${item.name}（${item.shortName}）` : item.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Tooltip title="维护位置字典"><IconButton size="small" onClick={() => setLocationDictOpen(true)}><SettingsIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
              </Box>
              <FormControl size="small" fullWidth>
                <InputLabel>服务器类型</InputLabel>
                <Select value={form.serverType || ''} label="服务器类型"
                  onChange={e => setForm({ ...form, serverType: e.target.value })}>
                  <MenuItem value="">--</MenuItem>
                  <MenuItem value="虚拟机">虚拟机</MenuItem>
                  <MenuItem value="物理机">物理机</MenuItem>
                </Select>
              </FormControl>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <FormControl size="small" fullWidth>
                  <InputLabel>操作系统</InputLabel>
                  <Select value={form.os || ''} label="操作系统" onChange={e => setForm({ ...form, os: e.target.value })}>
                    <MenuItem value="">--</MenuItem>
                    {osList.map(item => <MenuItem key={item.name} value={item.name}>{item.shortName ? `${item.name}（${item.shortName}）` : item.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <Tooltip title="维护操作系统字典"><IconButton size="small" onClick={() => setOsDictOpen(true)}><SettingsIcon sx={{ fontSize: 16 }} /></IconButton></Tooltip>
              </Box>
            </Box>

            {/* 数值字段 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 1.5 }}>
              {renderNumField('CPU核数', 'cpuCores', '核')}
              {renderNumField('内存', 'memoryGB', 'G')}
              {renderNumField('系统盘', 'systemDiskGB', 'G')}
              {renderNumField('数据盘', 'dataDiskGB', 'G')}
              {renderNumField('带宽', 'bandwidthMbps', 'M')}
            </Box>

            {/* 凭据（用户名+密码） */}
            <Box>
              <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>用户凭据</Typography>
              {credentials.map((cred, idx) => {
                const isRevealed = revealedCreds.has(idx);
                return (
                  <Box key={idx} sx={{ display: 'flex', gap: 0.5, mb: 0.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <TextField size="small" label="用户名"
                      value={cred.username}
                      onChange={e => updateCredential(idx, { username: e.target.value })}
                      sx={{ minWidth: 120 }} />
                    <TextField size="small" label="密码"
                      type={isRevealed ? 'text' : 'password'}
                      value={cred.password}
                      onChange={e => updateCredential(idx, { password: e.target.value })}
                      sx={{ minWidth: 140 }}
                    />
                    <Tooltip title={isRevealed ? '隐藏密码' : '查看密码'}>
                      <IconButton size="small" onClick={() => handleViewCredPassword(idx)}>
                        {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 16 }} /> : <VisibilityIcon sx={{ fontSize: 16 }} />}
                      </IconButton>
                    </Tooltip>
                    {isRevealed && cred.password && cred.password !== '******' && (
                      <Tooltip title="复制密码">
                        <IconButton size="small" onClick={() => handleCopyPassword(cred.password)}>
                          <ContentCopyIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <Button size="small" variant="outlined"
                      onClick={() => { setPwdTargetIndex(idx); setPwdDialogOpen(true); }}
                      sx={{ textWrap: 'nowrap', flexShrink: 0, fontSize: '0.75rem' }}>
                      生成
                    </Button>
                    {server && (
                      <Tooltip title="修改历史">
                        <IconButton size="small" onClick={() => handleViewCredHistory(idx)}>
                          <HistoryIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Tooltip>
                    )}
                    <IconButton size="small" onClick={() => removeCredential(idx)}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                );
              })}
              <Button size="small" startIcon={<AddIcon />} onClick={addCredential} type="button">
                添加凭据
              </Button>
            </Box>

            {/* 关联访问管理 */}
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>关联访问管理</Typography>
                <Button size="small" variant="outlined" sx={{ minWidth: 32, p: '2px 6px', fontSize: '0.7rem' }} onClick={addAccessEntry}>+ 添加</Button>
              </Box>
              {accessList.map((al, i) => {
                const addrs = getAccessAddrs(al.type);
                const users = getUsersForAddr(al.address, al.type);
                return (
                  <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'center' }}>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                      <InputLabel>访问方式</InputLabel>
                      <Select
                        value={al.type}
                        label="访问方式"
                        onChange={e => updateAccessEntry(i, { type: e.target.value })}
                      >
                        <MenuItem value="">--</MenuItem>
                        {accessTypeOptions.map(t => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1.5, minWidth: 0 }}>
                      <InputLabel>地址</InputLabel>
                      <Select
                        value={al.address}
                        label="地址"
                        onChange={e => updateAccessEntry(i, { address: e.target.value })}
                        disabled={!al.type || addrs.length === 0}
                      >
                        <MenuItem value="">--</MenuItem>
                        {addrs.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                      <InputLabel>用户</InputLabel>
                      <Select
                        value={al.user}
                        label="用户"
                        onChange={e => updateAccessEntry(i, { user: e.target.value })}
                        disabled={!al.address || users.length === 0}
                      >
                        <MenuItem value="">--</MenuItem>
                        {users.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                      </Select>
                    </FormControl>
                    <IconButton size="small" onClick={() => removeAccessEntry(i)} sx={{ flexShrink: 0 }}>
                      <CloseIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Box>
                );
              })}
            </Box>

            {/* 标签和备注 */}
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5 }}>
              <TextField size="small" label="标签(逗号分隔)"
                value={form.tags || ''}
                onChange={e => setForm({ ...form, tags: e.target.value })} />
              <TextField size="small" label="备注"
                value={form.notes || ''}
                onChange={e => setForm({ ...form, notes: e.target.value })} />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} size="small">取消</Button>
          <Button variant="contained" size="small" onClick={handleSave} disabled={loading}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 密码生成弹窗 */}
      <Dialog open={pwdDialogOpen} onClose={() => setPwdDialogOpen(false)} maxWidth="xs" fullWidth>
        <PasswordGenerator
          onApply={p => { updateCredential(pwdTargetIndex, { password: p }); setPwdDialogOpen(false); }}
          onClose={() => setPwdDialogOpen(false)}
        />
      </Dialog>

      {/* 密码验证弹窗 */}
      <Dialog open={verifyOpen} onClose={() => setVerifyOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>验证身份</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            请输入二次验证密码以查看凭据密码
          </Typography>
          <TextField
            size="small" type="password" autoComplete="new-password" label="二次验证密码" fullWidth
            value={verifyPwd}
            onChange={e => { setVerifyPwd(e.target.value); setVerifyError(''); }}
            error={!!verifyError}
            helperText={verifyError}
            onKeyDown={e => { if (e.key === 'Enter') handleVerifySubmit(); }}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setVerifyOpen(false)}>取消</Button>
          <Button size="small" variant="contained" onClick={handleVerifySubmit}>确认</Button>
        </DialogActions>
      </Dialog>

      <ProjectDictDialog open={projectDictOpen} onClose={() => setProjectDictOpen(false)} />
      <EngineeringDictDialog open={engDictOpen} projectId={selectedProjectId} onClose={() => setEngDictOpen(false)} />
      <ApplicationDictDialog open={appDictOpen} engineeringId={selectedEngId} onClose={() => setAppDictOpen(false)} />
      <OsDictDialog open={osDictOpen} onClose={() => setOsDictOpen(false)} />
      <ServerLocationDictDialog open={locationDictOpen} onClose={() => setLocationDictOpen(false)} />
      <CredentialHistoryDialog
        open={credHistoryOpen}
        serverId={server?.id || ''}
        credentialIndex={credHistoryIdx}
        username={credentials[credHistoryIdx]?.username || ''}
        onClose={() => setCredHistoryOpen(false)}
      />

      {/* 复制成功提示 */}
      <Snackbar open={copySnackbar} autoHideDuration={2000} onClose={() => setCopySnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" sx={{ width: '100%' }}>密码已复制到剪贴板</Alert>
      </Snackbar>
    </>
  );
};

export default ServerFormDialog;
