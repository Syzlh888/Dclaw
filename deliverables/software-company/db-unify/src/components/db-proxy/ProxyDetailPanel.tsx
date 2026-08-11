import React, { useEffect, useState } from 'react';
import {
  Box, Button, Chip, CircularProgress, Divider, Typography, Tooltip, IconButton,
  MenuItem, Select, FormControl, InputLabel, TextField,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useProxyStore } from '../../stores/proxyStore';
import IpWhitelistEditor from './IpWhitelistEditor';
import StatsOverview from './StatsOverview';
import type { HealthStatus, ProxyConnection } from '../../types/proxy';

interface Props {
  connection: ProxyConnection | null;
  onEdit: (id: string) => void;
  onRevoke: (id: string) => void;
}

const Row = ({
  label, value, span = 1,
}: { label: string; value: React.ReactNode; span?: 1 | 2 }) => (
  <Box sx={{ gridColumn: span === 2 ? 'span 2' : 'auto', minWidth: 0 }}>
    <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.62rem * var(--dc-scale, 1))', fontWeight: 600, lineHeight: 1.2 }}>
      {label}
    </Typography>
    <Box sx={{ color: 'text.primary', fontSize: 'calc(0.78rem * var(--dc-scale, 1))', mt: 0.1, lineHeight: 1.25, wordBreak: 'break-all' }}>
      {value || '—'}
    </Box>
  </Box>
);

const statusColor = (s: string) => (s === 'active' ? 'success.main' : s === 'revoked' ? 'error.main' : 'warning.main');

const HEALTH_COLOR: Record<HealthStatus, string> = {
  ok: 'success.main',
  fail: 'error.main',
  unknown: 'text.disabled',
};
const HEALTH_TEXT: Record<HealthStatus, string> = {
  ok: '健康',
  fail: '异常',
  unknown: '未检查',
};

const SQL_TYPES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DDL', 'OTHER'];
const STATUS_OPTS = ['success', 'failed', 'blocked'];

const ProxyDetailPanel: React.FC<Props> = ({ connection, onEdit, onRevoke }) => {
  const {
    auditLogs, auditTotal, auditPage, auditPageSize, auditLoading,
    auditFilters, loadAudit, setAuditFilters, exportAudit, updateConnection,
    healthMap, triggerHealthCheck,
  } = useProxyStore();

  const [editIps, setEditIps] = useState(false);
  const [draftIps, setDraftIps] = useState<string[]>([]);

  // 进入连接时刷新一次健康状态（确保概览点状态最新）
  useEffect(() => {
    if (connection?.id) {
      // 已有定时器在 ListPanel 周期刷新，这里仅做即时拉取一次
    }
  }, [connection?.id]);

  if (!connection) {
    return (
      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.default' }}>
        <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>选择左侧代理连接查看详情</Typography>
      </Box>
    );
  }

  const copy = (text: string) => navigator.clipboard?.writeText(text).catch(() => {});

  const totalPages = Math.max(1, Math.ceil(auditTotal / auditPageSize));

  const startEditIps = () => {
    setDraftIps(connection.allowed_ips || []);
    setEditIps(true);
  };

  const saveIps = async () => {
    try {
      await updateConnection(connection.id, { allowed_ips: draftIps });
      setEditIps(false);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: { message: e instanceof Error ? e.message : '保存失败', severity: 'error' as 'error' },
      }));
    }
  };

  const timeToLocal = (v: string) => (v ? new Date(v).toLocaleString('zh-CN') : '');

  const hs = (healthMap[connection.id]?.health_status as HealthStatus) || 'unknown';
  const lastCheck = healthMap[connection.id]?.last_health_check_at;
  const lastError = healthMap[connection.id]?.last_error;

  return (
    <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'background.default', p: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
        <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: 'calc(0.88rem * var(--dc-scale, 1))' }}>{connection.name}</Typography>
        <Chip size="small" label={connection.status} sx={{ ml: 1, height: 18, fontSize: 'calc(0.6rem * var(--dc-scale, 1))', color: statusColor(connection.status) }} />
        <Chip size="small" label={connection.access_mode === 'readonly' ? '只读' : '可写'} sx={{ ml: 0.5, height: 18, fontSize: 'calc(0.6rem * var(--dc-scale, 1))', color: 'primary.main' }} />
        <Tooltip title={`健康状态：${HEALTH_TEXT[hs]}${lastCheck ? `（${timeToLocal(lastCheck)}）` : ''}${lastError ? `\n最近错误：${lastError}` : ''}`}>
          <Chip
            size="small"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: HEALTH_COLOR[hs] }} />
                {HEALTH_TEXT[hs]}
              </Box>
            }
            sx={{ ml: 0.5, height: 18, fontSize: 'calc(0.6rem * var(--dc-scale, 1))', bgcolor: 'action.disabledBackground', color: HEALTH_COLOR[hs] }}
          />
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="立即探测健康">
          <IconButton size="small" onClick={() => triggerHealthCheck(connection.id)} sx={{ p: 0.4 }}>
            <RefreshIcon sx={{ fontSize: 'calc(0.82rem * var(--dc-scale, 1))' }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="编辑"><IconButton size="small" onClick={() => onEdit(connection.id)} sx={{ p: 0.4 }}><EditIcon sx={{ fontSize: 'calc(0.82rem * var(--dc-scale, 1))' }} /></IconButton></Tooltip>
        <Tooltip title="撤销"><IconButton size="small" onClick={() => onRevoke(connection.id)} sx={{ p: 0.4 }}><DeleteIcon sx={{ fontSize: 'calc(0.82rem * var(--dc-scale, 1))' }} /></IconButton></Tooltip>
      </Box>

      <Divider sx={{ mb: 0.75, borderColor: 'divider' }} />

      <StatsOverview connectionId={connection.id} />

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 1.5, rowGap: 0.5, mb: 0.75 }}>
        <Row label="对外端口" value={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {connection.proxy_port}
            <Tooltip title="复制"><IconButton size="small" onClick={() => copy(String(connection.proxy_port))} sx={{ p: 0.2 }}><ContentCopyIcon sx={{ fontSize: 'calc(0.62rem * var(--dc-scale, 1))', color: 'text.disabled' }} /></IconButton></Tooltip>
          </Box>
        } />
        <Row label="临时账号" value={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            {connection.proxy_username}
            <Tooltip title="复制"><IconButton size="small" onClick={() => copy(connection.proxy_username)} sx={{ p: 0.2 }}><ContentCopyIcon sx={{ fontSize: 'calc(0.62rem * var(--dc-scale, 1))', color: 'text.disabled' }} /></IconButton></Tooltip>
          </Box>
        } />
        <Row label="数据库类型" value={connection.db_type} />
        <Row label="审计模式" value={connection.audit_mode === 'intercept' ? '记录并拦截' : '仅记录'} />
        <Row label="最大并发" value={connection.max_connections} />
        <Row label="到期时间" value={connection.expires_at ? timeToLocal(connection.expires_at) : '—'} />
        <Row label="创建人" value={connection.created_by} />
        <Row label="创建时间" value={connection.created_at ? timeToLocal(connection.created_at) : '—'} />
        {connection.last_connected_at && (
          <>
            <Row label="最近连接" value={timeToLocal(connection.last_connected_at)} />
            <Box />
          </>
        )}
        <Row label="健康检查" value={
          <Box>
            <Typography sx={{ color: 'text.primary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
              {lastCheck ? timeToLocal(lastCheck) : '尚未检查'}
              {lastError ? ` · ${lastError}` : ''}
            </Typography>
          </Box>
        } />
        <Row label="来源IP白名单" span={2} value={
          <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 0.5 }}>
            {editIps ? (
              <IpWhitelistEditor value={draftIps} onChange={setDraftIps} label="编辑白名单（回车/逗号添加，删除直接点 chip 的 ×）" />
            ) : (
              <>
                {connection.allowed_ips?.length
                  ? connection.allowed_ips.map((ip) => (
                      <Chip key={ip} size="small" label={ip} sx={{ height: 16, fontSize: 'calc(0.58rem * var(--dc-scale, 1))', bgcolor: 'action.hover', color: 'text.primary' }} />
                    ))
                  : <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}>不限制</Typography>}
              </>
            )}
            {!editIps ? (
              <Tooltip title="编辑白名单"><IconButton size="small" onClick={startEditIps} sx={{ p: 0.2 }}><EditIcon sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', color: 'text.disabled' }} /></IconButton></Tooltip>
            ) : (
              <Box sx={{ display: 'flex', gap: 0.5, mt: 0.4 }}>
                <Button size="small" variant="contained" onClick={saveIps} sx={{ textTransform: 'none', fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}>保存</Button>
                <Button size="small" variant="text" onClick={() => setEditIps(false)} sx={{ textTransform: 'none', fontSize: 'calc(0.66rem * var(--dc-scale, 1))', color: 'text.secondary' }}>取消</Button>
              </Box>
            )}
          </Box>
        } />
      </Box>

      <Divider sx={{ my: 1, borderColor: 'divider' }} />

      {/* 审计筛选 + 导出 */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75, flexWrap: 'wrap', gap: 0.5 }}>
        <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: 'calc(0.78rem * var(--dc-scale, 1))' }}>操作审计</Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="导出当前筛选结果为 CSV（Excel 中文兼容）">
          <Button
            size="small"
            variant="text"
            startIcon={<FileDownloadIcon sx={{ fontSize: 'calc(0.82rem * var(--dc-scale, 1))' }} />}
            onClick={exportAudit}
            sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}
          >
            导出 CSV
          </Button>
        </Tooltip>
        <Button size="small" variant="text" onClick={() => loadAudit({})} sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}>刷新</Button>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0.5, mb: 0.75 }}>
        <FormControl size="small">
          <InputLabel sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}>SQL 类型</InputLabel>
          <Select
            size="small"
            value={auditFilters.sql_type || ''}
            label="SQL 类型"
            onChange={(e) => setAuditFilters({ sql_type: e.target.value || undefined })}
            sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}
          >
            <MenuItem value=""><em>全部</em></MenuItem>
            {SQL_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small">
          <InputLabel sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}>状态</InputLabel>
          <Select
            size="small"
            value={auditFilters.status || ''}
            label="状态"
            onChange={(e) => setAuditFilters({ status: e.target.value || undefined })}
            sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}
          >
            <MenuItem value=""><em>全部</em></MenuItem>
            {STATUS_OPTS.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </Select>
        </FormControl>
        <Box />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, mb: 0.75 }}>
        <TextField
          size="small"
          type="datetime-local"
          label="开始时间"
          value={auditFilters.start || ''}
          onChange={(e) => setAuditFilters({ start: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
          InputLabelProps={{ shrink: true }}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.66rem * var(--dc-scale, 1))' } }}
        />
        <TextField
          size="small"
          type="datetime-local"
          label="结束时间"
          value={auditFilters.end || ''}
          onChange={(e) => setAuditFilters({ end: e.target.value ? new Date(e.target.value).toISOString() : undefined })}
          InputLabelProps={{ shrink: true }}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.66rem * var(--dc-scale, 1))' } }}
        />
      </Box>

      {auditLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}><CircularProgress size={14} /></Box>
      ) : auditLogs.length === 0 ? (
        <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.66rem * var(--dc-scale, 1))', py: 1.5, textAlign: 'center' }}>暂无审计记录</Typography>
      ) : (
        auditLogs.map((log) => (
          <Box key={log.id} sx={{ py: 0.4, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Chip size="small" label={log.sql_type || 'OTHER'} sx={{ height: 14, fontSize: 'calc(0.55rem * var(--dc-scale, 1))', bgcolor: 'action.disabledBackground', color: 'text.secondary' }} />
              <Chip size="small" label={log.status || '-'} sx={{ height: 14, fontSize: 'calc(0.55rem * var(--dc-scale, 1))', color: log.status === 'blocked' ? 'error.main' : log.status === 'failed' ? 'warning.main' : 'success.main' }} />
              {log.risk_level === 'high' && <Chip size="small" label="高危" sx={{ height: 14, fontSize: 'calc(0.55rem * var(--dc-scale, 1))', color: 'error.main' }} />}
              <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.55rem * var(--dc-scale, 1))', ml: 'auto' }}>
                {timeToLocal(log.executed_at)}
              </Typography>
            </Box>
            <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.62rem * var(--dc-scale, 1))', mt: 0.2, fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {log.sql_text}
            </Typography>
            {log.error_message && (
              <Typography sx={{ color: 'error.main', fontSize: 'calc(0.6rem * var(--dc-scale, 1))' }}>{log.error_message}</Typography>
            )}
          </Box>
        ))
      )}

      {/* 分页 */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.75, mt: 1 }}>
        <Tooltip title="上一页">
          <span>
            <IconButton size="small" disabled={auditPage <= 1} onClick={() => loadAudit({ page: auditPage - 1 })} sx={{ color: 'text.secondary' }}>
              <ChevronLeftIcon sx={{ fontSize: 'calc(0.9rem * var(--dc-scale, 1))' }} />
            </IconButton>
          </span>
        </Tooltip>
        <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}>
          第 {auditPage} / {totalPages} 页 · 共 {auditTotal} 条
        </Typography>
        <Tooltip title="下一页">
          <span>
            <IconButton size="small" disabled={auditPage >= totalPages} onClick={() => loadAudit({ page: auditPage + 1 })} sx={{ color: 'text.secondary' }}>
              <ChevronRightIcon sx={{ fontSize: 'calc(0.9rem * var(--dc-scale, 1))' }} />
            </IconButton>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
};

export default ProxyDetailPanel;
