import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Button, Chip, Tabs, Tab, IconButton, Tooltip,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Alert,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import KeyIcon from '@mui/icons-material/Key';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';

import DbInstanceTab from './DbInstanceTab';
import AppInstanceTab from './AppInstanceTab';
import ApiManagementTab from './ApiManagementTab';
import MiddlewareTab from './MiddlewareTab';
import PortInfoTab from './PortInfoTab';
import VerifyPasswordDialog from './VerifyPasswordDialog';
import PasswordHistoryDialog from './PasswordHistoryDialog';
import { useServerStore } from '../../stores/serverStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { apiFetch } from '../../services/apiClient';


interface Props {
  onEdit: () => void;
  onDelete: () => void;
}

const ServerDetailPanel: React.FC<Props> = ({ onEdit, onDelete }) => {
  const selectedId = useServerStore(s => s.selectedId);
  const serverMap = useServerStore(s => s.serverMap);
  const dbInstances = useServerStore(s => s.dbInstances[selectedId || '']) || [];
  const appInstances = useServerStore(s => s.appInstances[selectedId || '']) || [];
  const apiInstances = useServerStore(s => s.apiInstances[selectedId || '']) || [];
  const midInstances = useServerStore(s => s.midInstances[selectedId || '']) || [];
  const ports = useServerStore(s => s.ports[selectedId || '']) || [];

  const [tab, setTab] = useState(0);
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [decrypted, setDecrypted] = useState<any>(null);

  // 访问管理相关状态
  const [accessEntries, setAccessEntries] = useState<any[]>([]);
  const [decryptedCache, setDecryptedCache] = useState<Map<string, string>>(new Map());
  const [revealedPwds, setRevealedPwds] = useState<Set<string>>(new Set());
  const [accessVerifyOpen, setAccessVerifyOpen] = useState(false);
  const [accessVerifyTarget, setAccessVerifyTarget] = useState<{
    entryId: string; pwdKey: string; credIndex: number; username: string;
  } | null>(null);
  const [accessVerifyInput, setAccessVerifyInput] = useState('');
  const [accessVerifyError, setAccessVerifyError] = useState('');
  const [accessVerifyLoading, setAccessVerifyLoading] = useState(false);

  const connections = useConnectionStore(s => s.connections);
  const updateConnection = useConnectionStore(s => s.updateConnection);

  const server = selectedId ? serverMap[selectedId] : null;

  // 获取已关联的连接
  const linkedConnections = server
    ? Object.values(connections).filter(c => c.serverId === server.id || server.linkedConnectionIds?.includes(c.id))
    : [];

  // 拉取全局访问条目
  useEffect(() => {
    apiFetch('/api/access')
      .then(r => r.json())
      .then(d => setAccessEntries(d.entries || []))
      .catch(console.error);
  }, [selectedId]);

  // 获取访问条目的凭据列表
  const getEntryCreds = (e: any): (any & { _key: string; _index: number })[] => {
    if (e.credentials && e.credentials.length > 0) {
      return e.credentials.map((c: any, i: number) => ({ ...c, _key: `${e.id}-${i}`, _index: i }));
    }
    return [{ username: e.username || '', password: e.password || '******', _key: `${e.id}-0`, _index: 0 }];
  };

  // 根据 server.accessList 匹配全局访问条目
  const matchedAccessList = (() => {
    if (!server?.accessList || server.accessList.length === 0) return [];
    const matches: any[] = [];
    server.accessList.forEach((al: any) => {
      const entry = accessEntries.find((e: any) =>
        e.type === al.type && e.address === al.address
      );
      if (entry) {
        const creds = getEntryCreds(entry);
        const cred = creds.find((c: any) => c.username === al.user);
        matches.push({
          ...al,
          entryId: entry.id,
          entry,
          cred: cred || creds[0],
          credIndex: cred ? cred._index : 0,
          pwdKey: cred ? cred._key : `${entry.id}-0`,
        });
      } else {
        // 即使没有找到匹配的全局条目，也展示 server.accessList 里记录的信息
        matches.push({ ...al, entryId: '', entry: null, cred: null, credIndex: 0, pwdKey: '' });
      }
    });
    return matches;
  })();

  // 获取密码显示文本
  const getDisplayPassword = (pwdKey: string): string => {
    if (decryptedCache.has(pwdKey) && revealedPwds.has(pwdKey)) {
      return decryptedCache.get(pwdKey) || '';
    }
    return '••••••••';
  };

  // 查看/隐藏密码
  const requestViewPassword = (entryId: string, pwdKey: string, credIndex: number, username: string) => {
    if (decryptedCache.has(pwdKey)) {
      setRevealedPwds(prev => {
        const n = new Set(prev);
        if (n.has(pwdKey)) n.delete(pwdKey); else n.add(pwdKey);
        return n;
      });
      return;
    }
    setAccessVerifyTarget({ entryId, pwdKey, credIndex, username });
    setAccessVerifyInput('');
    setAccessVerifyError('');
    setAccessVerifyOpen(true);
  };

  // 二次验证密码
  const handleAccessVerify = async () => {
    if (!accessVerifyInput.trim() || !accessVerifyTarget) return;
    setAccessVerifyLoading(true);
    setAccessVerifyError('');
    try {
      const res = await apiFetch(`/api/access/${accessVerifyTarget.entryId}/decrypt-credential`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ verifyPassword: accessVerifyInput, credentialIndex: accessVerifyTarget.credIndex }),
      });
      const result = await res.json();
      if (result.error) { setAccessVerifyError(result.error); setAccessVerifyLoading(false); return; }
      const plaintext = result.password || '';
      setDecryptedCache(prev => { const next = new Map(prev); next.set(accessVerifyTarget.pwdKey, plaintext); return next; });
      setRevealedPwds(prev => new Set(prev).add(accessVerifyTarget.pwdKey));
      setAccessVerifyOpen(false);
      setAccessVerifyTarget(null);
      setAccessVerifyInput('');
    } catch (err: any) {
      setAccessVerifyError(err?.message || '验证失败');
    }
    setAccessVerifyLoading(false);
  };

  const handleUnlink = async (connId: string) => {
    await updateConnection(connId, { serverId: undefined });
  };

  if (!server) return (
    <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
      <Typography>请选择一台服务器查看详情</Typography>
    </Box>
  );

  const InfoRow = ({ label, value }: { label: string; value: any }) => {
    if (value === undefined || value === null || value === '') return null;
    return (
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
        <Typography variant="caption" color="text.secondary">{label}:</Typography>
        <Typography variant="body2" sx={{ ml: '2px' }}>{String(value)}</Typography>
      </Box>
    );
  };

  return (
    <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 上半部分：主机信息 */}
      <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#FAFAFA' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>{server.name}</Typography>
            </Box>
            {server.os && <Chip label={server.os} size="small" color="primary" variant="outlined" />}
            {server.serverType && <Chip label={server.serverType} size="small" />}
          </Box>
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title="查看密码"><IconButton size="small" onClick={() => setVerifyOpen(true)}><KeyIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
            <Tooltip title="密码历史"><IconButton size="small" onClick={() => setHistoryOpen(true)}><HistoryIcon sx={{ fontSize: 18 }} /></IconButton></Tooltip>
            <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={onEdit}>编辑</Button>
            <Button size="small" color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={onDelete}>删除</Button>
          </Box>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '6px', columnGap: 2 }}>
          {server.ips && Array.isArray(server.ips) && server.ips.length > 0 ? (
            server.ips.map((ip: any, i: number) => (
              <InfoRow key={i} label={`IP${server.ips.length > 1 ? ` ${i + 1}` : ''} (${ip.type})`} value={`${ip.ip}${ip.port ? `:${ip.port}` : ''}${ip.mappedIp ? ` → ${ip.mappedIp}` : ''}`} />
            ))
          ) : (
            <>
              <InfoRow label="内网IP" value={server.internalIp} />
              <InfoRow label="外网IP" value={server.externalIp} />
              <InfoRow label="公网IP" value={server.publicIp} />
              <InfoRow label="跨网IP" value={server.crossNetworkIp} />
            </>
          )}
          {server.credentials && Array.isArray(server.credentials) && server.credentials.length > 0 ? (
            server.credentials.map((cred: any, i: number) => (
              <InfoRow key={i} label={`用户${server.credentials.length > 1 ? ` ${i + 1}` : ''}`} value={cred.username} />
            ))
          ) : (
            <InfoRow label="用户名" value={server.username} />
          )}
          <InfoRow label="CPU" value={server.cpuCores != null ? `${server.cpuCores} 核` : undefined} />
          <InfoRow label="内存" value={server.memoryGB != null ? `${server.memoryGB} GB` : undefined} />
          <InfoRow label="系统盘" value={server.systemDiskGB != null ? `${server.systemDiskGB} GB` : undefined} />
          <InfoRow label="数据盘" value={server.dataDiskGB != null ? `${server.dataDiskGB} GB` : undefined} />
          <InfoRow label="存储类型" value={server.storageType} />
          <InfoRow label="带宽" value={server.bandwidthMbps != null ? `${server.bandwidthMbps} Mbps` : undefined} />
          <InfoRow label="位置" value={server.serverLocation} />
          <InfoRow label="堡垒机" value={server.bastionHost} />
          <InfoRow label="MAC" value={server.macAddress} />
          <InfoRow label="VPN" value={server.vpnInfo} />
          <InfoRow label="部署内容" value={server.deployedContent} />
        </Box>

        {(server.tags && server.tags.length > 0) && (
          <Box sx={{ mt: 1, display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {server.tags.map(t => <Chip key={t} label={t} size="small" sx={{ fontSize: '0.65rem', height: 20 }} />)}
          </Box>
        )}
        {server.notes && <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{server.notes}</Typography>}

        {/* 访问管理 — 内联行显示 */}
        {matchedAccessList.map((al: any, i: number) => {
          const isRevealed = al.pwdKey && decryptedCache.has(al.pwdKey) && revealedPwds.has(al.pwdKey);
          return (
            <Box key={`access-${i}`} sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                {al.type === '堡垒机' ? '堡垒机' : 'VPN'}:
              </Typography>
              <Typography variant="body2" sx={{ ml: '2px', color: '#1565C0' }}>
                {al.address}
              </Typography>
              <Typography variant="body2" sx={{ ml: '2px' }}>
                ({al.user})
              </Typography>
              {al.pwdKey ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0, ml: 0.5 }}>
                  <Typography sx={{
                    fontFamily: 'monospace', fontSize: '0.75rem',
                    userSelect: isRevealed ? 'text' : 'none',
                    letterSpacing: isRevealed ? '0' : '2px',
                    color: isRevealed ? 'text.primary' : 'text.disabled',
                  }}>
                    {getDisplayPassword(al.pwdKey)}
                  </Typography>
                  <Tooltip title="查看密码">
                    <IconButton size="small" onClick={() => requestViewPassword(al.entryId, al.pwdKey, al.credIndex, al.user)} sx={{ p: 0.2 }}>
                      {isRevealed ? <VisibilityOffIcon sx={{ fontSize: 14 }} /> : <VisibilityIcon sx={{ fontSize: 14 }} />}
                    </IconButton>
                  </Tooltip>
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>

      {/* 下半部分：Tab 页 */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36, borderBottom: '1px solid', borderColor: 'divider', px: 2 }}>
        <Tab label={`数据库 (${dbInstances.length})`} sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }} />
        <Tab label={`应用 (${appInstances.length})`} sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }} />
        <Tab label={`API (${apiInstances.length})`} sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }} />
        <Tab label={`中间件 (${midInstances.length})`} sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }} />
        <Tab label={`端口 (${ports.length})`} sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }} />
        <Tab label={`关联连接 (${linkedConnections.length})`} sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.8rem' }} />
      </Tabs>

      <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
        {tab === 0 && <DbInstanceTab serverId={server.id} instances={dbInstances} ports={ports} serverIps={(() => { const ips = (server.ips || []).map(ie => ie.ip).filter(Boolean); if (server.internalIp) ips.push(server.internalIp); if (server.externalIp) ips.push(server.externalIp); if (server.publicIp) ips.push(server.publicIp); if (server.crossNetworkIp) ips.push(server.crossNetworkIp); return [...new Set(ips)]; })()} />}
        {tab === 1 && <AppInstanceTab serverId={server.id} instances={appInstances} ports={ports} />}
        {tab === 2 && <ApiManagementTab serverId={server.id} instances={apiInstances} appInstances={appInstances} />}
        {tab === 3 && <MiddlewareTab serverId={server.id} instances={midInstances} ports={ports} />}
        {tab === 4 && <PortInfoTab serverId={server.id} ports={ports} />}
        {tab === 5 && (
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1.5 }}>已关联的数据库连接 ({linkedConnections.length})</Typography>
            {linkedConnections.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                暂无关联连接。在「连接管理」中编辑连接时，可选择关联到此服务器。
              </Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead><TableRow>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>连接名称</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>驱动</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>主机:端口</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>数据库</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>状态</TableCell>
                    <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>操作</TableCell>
                  </TableRow></TableHead>
                  <TableBody>
                    {linkedConnections.map(c => (
                      <TableRow key={c.id}>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{c.name}</TableCell>
                        <TableCell><Chip label={c.driver} size="small" sx={{ fontSize: '0.65rem' }} /></TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{c.host}:{c.port}</TableCell>
                        <TableCell sx={{ fontSize: '0.8rem' }}>{c.database || '-'}</TableCell>
                        <TableCell>
                          <Chip label={c.status} size="small" color={c.status === 'online' ? 'success' : 'default'} sx={{ fontSize: '0.65rem', height: 20 }} />
                        </TableCell>
                        <TableCell>
                          <Tooltip title="取消关联"><IconButton size="small" onClick={() => handleUnlink(c.id)}><LinkOffIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        )}
      </Box>

      <VerifyPasswordDialog
        open={verifyOpen}
        serverId={server.id}
        serverName={server.name}
        onClose={() => setVerifyOpen(false)}
        onVerified={(data) => setDecrypted(data)}
      />

      <PasswordHistoryDialog
        open={historyOpen}
        serverId={server.id}
        onClose={() => setHistoryOpen(false)}
      />

      {/* 访问管理 — 二次验证弹窗 */}
      <Dialog
        open={accessVerifyOpen}
        onClose={() => { setAccessVerifyOpen(false); setAccessVerifyTarget(null); setAccessVerifyError(''); setAccessVerifyInput(''); }}
        maxWidth="xs" fullWidth
      >
        <DialogTitle sx={{ fontWeight: 600, fontSize: '0.95rem' }}>
          二次验证 - 查看访问密码
        </DialogTitle>
        <DialogContent>
          {accessVerifyError && (
            <Alert severity="error" sx={{ mb: 1.5 }}>{accessVerifyError}</Alert>
          )}
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            请输入二次验证密码以查看用户「{accessVerifyTarget?.username || '-'}」的密码
          </Typography>
          <TextField
            autoFocus fullWidth size="small" type="password"
            autoComplete="new-password"
            label="二次验证密码"
            value={accessVerifyInput}
            onChange={e => { setAccessVerifyInput(e.target.value); setAccessVerifyError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') handleAccessVerify(); }}
          />
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => { setAccessVerifyOpen(false); setAccessVerifyTarget(null); setAccessVerifyError(''); setAccessVerifyInput(''); }}>
            取消
          </Button>
          <Button size="small" variant="contained" onClick={handleAccessVerify}
            disabled={accessVerifyLoading || !accessVerifyInput.trim()}>
            验证
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ServerDetailPanel;
