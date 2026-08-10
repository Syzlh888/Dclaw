import React, { useEffect } from 'react';
import { Box, Button, Chip, CircularProgress, Divider, Typography, Tooltip, IconButton } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useProxyStore } from '../../stores/proxyStore';
import type { ProxyConnection } from '../../types/proxy';

interface Props {
  connection: ProxyConnection | null;
  onEdit: (id: string) => void;
  onRevoke: (id: string) => void;
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <Box sx={{ py: 0.5 }}>
    <Typography sx={{ color: 'text.secondary', fontSize: '0.7rem' }}>{label}</Typography>
    <Typography sx={{ color: 'text.primary', fontSize: '0.8rem' }}>{value || '—'}</Typography>
  </Box>
);

const statusColor = (s: string) => (s === 'active' ? 'success.main' : s === 'revoked' ? 'error.main' : 'warning.main');

const ProxyDetailPanel: React.FC<Props> = ({ connection, onEdit, onRevoke }) => {
  const { auditLogs, auditLoading, loadAudit } = useProxyStore();

  useEffect(() => {
    if (connection) loadAudit(connection.id);
  }, [connection?.id]);

  if (!connection) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        <Typography sx={{ color: 'text.disabled', fontSize: '0.8rem' }}>选择左侧代理连接查看详情</Typography>
      </Box>
    );
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

  return (
    <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'background.default', p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.95rem' }}>{connection.name}</Typography>
        <Chip size="small" label={connection.status} sx={{ ml: 1, height: 20, fontSize: '0.65rem', color: statusColor(connection.status) }} />
        <Chip size="small" label={connection.access_mode === 'readonly' ? '只读' : '可写'} sx={{ ml: 0.5, height: 20, fontSize: '0.65rem', color: 'primary.main' }} />
        <Box sx={{ flex: 1 }} />
        <Tooltip title="编辑"><IconButton size="small" onClick={() => onEdit(connection.id)} sx={{ p: 0.5 }}><EditIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>
        <Tooltip title="撤销"><IconButton size="small" onClick={() => onRevoke(connection.id)} sx={{ p: 0.5 }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton></Tooltip>
      </Box>

      <Divider sx={{ mb: 1, borderColor: 'divider' }} />

      <Row label="对外端口" value={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {connection.proxy_port}
          <Tooltip title="复制"><IconButton size="small" onClick={() => copy(String(connection.proxy_port))} sx={{ p: 0.2 }}><ContentCopyIcon sx={{ fontSize: 11, color: 'text.disabled' }} /></IconButton></Tooltip>
        </Box>
      } />
      <Row label="临时账号" value={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {connection.proxy_username}
          <Tooltip title="复制"><IconButton size="small" onClick={() => copy(connection.proxy_username)} sx={{ p: 0.2 }}><ContentCopyIcon sx={{ fontSize: 11, color: 'text.disabled' }} /></IconButton></Tooltip>
        </Box>
      } />
      <Row label="数据库类型" value={connection.db_type} />
      <Row label="审计模式" value={connection.audit_mode === 'intercept' ? '记录并拦截' : '仅记录'} />
      <Row label="最大并发" value={connection.max_connections} />
      <Row label="到期时间" value={connection.expires_at ? new Date(connection.expires_at).toLocaleString('zh-CN') : '—'} />
      <Row label="创建人" value={connection.created_by} />
      <Row label="创建时间" value={connection.created_at ? new Date(connection.created_at).toLocaleString('zh-CN') : '—'} />
      {connection.last_connected_at && <Row label="最近连接" value={new Date(connection.last_connected_at).toLocaleString('zh-CN')} />}
      <Row label="来源IP白名单" value={connection.allowed_ips?.length ? connection.allowed_ips.join(', ') : '不限制'} />

      <Divider sx={{ my: 1.5, borderColor: 'divider' }} />

      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
        <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.85rem' }}>操作审计</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="text" onClick={() => loadAudit(connection.id)} sx={{ color: 'primary.main', textTransform: 'none', fontSize: '0.7rem' }}>刷新</Button>
      </Box>

      {auditLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}><CircularProgress size={16} /></Box>
      ) : auditLogs.length === 0 ? (
        <Typography sx={{ color: 'text.disabled', fontSize: '0.7rem', py: 2, textAlign: 'center' }}>暂无审计记录</Typography>
      ) : (
        auditLogs.slice(0, 30).map((log) => (
          <Box key={log.id} sx={{ py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Chip size="small" label={log.sql_type || 'OTHER'} sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'action.disabledBackground', color: 'text.secondary' }} />
              <Chip size="small" label={log.status || '-'} sx={{ height: 16, fontSize: '0.6rem', color: log.status === 'blocked' ? 'error.main' : 'success.main' }} />
              <Typography sx={{ color: 'text.disabled', fontSize: '0.6rem', ml: 'auto' }}>
                {log.executed_at ? new Date(log.executed_at).toLocaleString('zh-CN') : ''}
              </Typography>
            </Box>
            <Typography sx={{ color: 'text.secondary', fontSize: '0.68rem', mt: 0.25, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {log.sql_text}
            </Typography>
            {log.error_message && (
              <Typography sx={{ color: 'error.main', fontSize: '0.65rem' }}>{log.error_message}</Typography>
            )}
          </Box>
        ))
      )}
    </Box>
  );
};

export default ProxyDetailPanel;
