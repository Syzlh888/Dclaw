import React, { useState } from 'react';
import {
  Box, Typography, Button, Chip, Tabs, Tab, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import KeyIcon from '@mui/icons-material/Key';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import DbInstanceTab from './DbInstanceTab';
import AppInstanceTab from './AppInstanceTab';
import ApiManagementTab from './ApiManagementTab';
import MiddlewareTab from './MiddlewareTab';
import PortInfoTab from './PortInfoTab';
import VerifyPasswordDialog from './VerifyPasswordDialog';
import PasswordHistoryDialog from './PasswordHistoryDialog';
import { useServerStore } from '../../stores/serverStore';
import { useConnectionStore } from '../../stores/connectionStore';


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

  const connections = useConnectionStore(s => s.connections);
  const updateConnection = useConnectionStore(s => s.updateConnection);

  const server = selectedId ? serverMap[selectedId] : null;

  // 获取已关联的连接
  const linkedConnections = server
    ? Object.values(connections).filter(c => c.serverId === server.id || server.linkedConnectionIds?.includes(c.id))
    : [];

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
    </Box>
  );
};

export default ServerDetailPanel;
