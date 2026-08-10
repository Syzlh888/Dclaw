import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem, Radio, RadioGroup,
  Select, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useConnectionStore } from '../../stores/connectionStore';
import { useProxyStore } from '../../stores/proxyStore';
import IpWhitelistEditor from './IpWhitelistEditor';
import type { AccessMode, AuditMode } from '../../types/proxy';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (password: string) => void;
}

const ProxyCreateDialog: React.FC<Props> = ({ open, onClose, onCreated }) => {
  const connectionsMap = useConnectionStore((s) => s.connections);
  const { createConnection, error } = useProxyStore();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ username: string; password: string; port: number } | null>(null);

  const [name, setName] = useState('');
  const [realConnectionId, setRealConnectionId] = useState('');
  const [dbType, setDbType] = useState('postgresql');
  const [auditMode, setAuditMode] = useState<AuditMode>('record');
  const [accessMode, setAccessMode] = useState<AccessMode>('writable');
  const [maxConnections, setMaxConnections] = useState(10);
  const [allowedIps, setAllowedIps] = useState<string[]>([]);
  const [durationType, setDurationType] = useState<'1h' | '8h' | '24h' | 'custom'>('1h');
  const [customHours, setCustomHours] = useState(1);

  const connections = useMemo(() => Object.values(connectionsMap), [connectionsMap]);

  useEffect(() => {
    if (open) {
      setName(''); setRealConnectionId(''); setDbType('postgresql');
      setAuditMode('record'); setAccessMode('writable'); setMaxConnections(10);
      setAllowedIps([]); setDurationType('1h'); setCustomHours(1);
      setResult(null); setLoading(false);
    }
  }, [open]);

  const computeExpiresAt = () => {
    const hours = durationType === '1h' ? 1 : durationType === '8h' ? 8 : durationType === '24h' ? 24 : customHours;
    return new Date(Date.now() + hours * 3600 * 1000).toISOString();
  };

  const handleCreate = async () => {
    if (!name || !realConnectionId) return;
    setLoading(true);
    const created = await createConnection({
      name,
      real_connection_id: realConnectionId,
      db_type: dbType,
      audit_mode: auditMode,
      access_mode: accessMode,
      max_connections: maxConnections,
      allowed_ips: allowedIps,
      expires_at: computeExpiresAt(),
    });
    setLoading(false);
    if (created) {
      setResult({ username: created.proxy_username, password: created.proxy_password || '', port: created.proxy_port });
      onCreated(created.proxy_password || '');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', color: 'text.primary', fontSize: '0.95rem', fontWeight: 600, pb: 1 }}>
        新建代理连接
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" onClick={onClose} sx={{ color: 'text.secondary' }}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>

      <DialogContent sx={{ pt: '12px !important' }}>
        {result ? (
          <Alert severity="success" sx={{ fontSize: '0.75rem', mb: 1 }}>
            代理连接创建成功！以下信息仅供本次查看：
          </Alert>
        ) : null}

        {result && (
          <Box sx={{ bgcolor: 'action.hover', p: 1.5, borderRadius: 1, mb: 2 }}>
            <Typography sx={{ fontSize: '0.75rem', color: 'text.primary' }}>
              端口：<strong>{result.port}</strong>　
              账号：<strong>{result.username}</strong>　
              密码：<strong>{result.password}</strong>
            </Typography>
            <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', mt: 0.5 }}>
              请立即把此信息提供给外部用户，密码仅展示一次。
            </Typography>
          </Box>
        )}

        {error && <Alert severity="error" sx={{ fontSize: '0.7rem', mb: 1 }}>{error}</Alert>}

        <TextField fullWidth size="small" label="代理连接名称" value={name} onChange={(e) => setName(e.target.value)} sx={{ mb: 1.5 }} />
        <FormControl fullWidth size="small" sx={{ mb: 1.5 }}>
          <InputLabel>关联真实连接</InputLabel>
          <Select value={realConnectionId} label="关联真实连接" onChange={(e) => setRealConnectionId(e.target.value)}>
            {connections.map((c) => (
              <MenuItem key={c.id} value={c.id}>{c.name} ({c.host}:{c.port})</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
          <TextField select size="small" label="数据库类型" value={dbType} onChange={(e) => setDbType(e.target.value)}>
            {['postgresql', 'mysql', 'highgo', 'dm', 'oracle', 'sqlserver'].map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
          </TextField>
          <TextField select size="small" label="审计模式" value={auditMode} onChange={(e) => setAuditMode(e.target.value as AuditMode)}>
            <MenuItem value="record">仅记录</MenuItem>
            <MenuItem value="intercept">记录并拦截</MenuItem>
          </TextField>
        </Box>

        <Typography sx={{ color: 'text.secondary', fontSize: '0.7rem', mb: 0.5 }}>访问权限</Typography>
        <RadioGroup row value={accessMode} onChange={(e) => setAccessMode(e.target.value as AccessMode)} sx={{ mb: 1.5 }}>
          <FormControlLabel value="readonly" control={<Radio size="small" sx={{ color: 'text.disabled' }} />} label={<Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>只读</Typography>} />
          <FormControlLabel value="writable" control={<Radio size="small" sx={{ color: 'text.disabled' }} />} label={<Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>可写</Typography>} />
        </RadioGroup>

        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
          <TextField select size="small" label="有效期" value={durationType} onChange={(e) => setDurationType(e.target.value as any)}>
            <MenuItem value="1h">1 小时</MenuItem>
            <MenuItem value="8h">8 小时</MenuItem>
            <MenuItem value="24h">24 小时</MenuItem>
            <MenuItem value="custom">自定义</MenuItem>
          </TextField>
          {durationType === 'custom' ? (
            <TextField size="small" type="number" label="时长（小时）" value={customHours} onChange={(e) => setCustomHours(Number(e.target.value))} />
          ) : (
            <TextField size="small" label="最大并发" type="number" value={maxConnections} onChange={(e) => setMaxConnections(Number(e.target.value))} />
          )}
        </Box>

        <IpWhitelistEditor value={allowedIps} onChange={setAllowedIps} label="来源 IP 白名单（多 IP/网段，回车或逗号添加，留空不限制）" />
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button size="small" onClick={onClose} disabled={loading} sx={{ color: 'text.secondary', textTransform: 'none' }}>关闭</Button>
        {!result && (
          <Button size="small" variant="contained" onClick={handleCreate} disabled={loading || !name || !realConnectionId} sx={{ textTransform: 'none' }}>
            创建
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ProxyCreateDialog;
