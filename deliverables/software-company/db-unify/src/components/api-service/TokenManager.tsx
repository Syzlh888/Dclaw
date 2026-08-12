import React, { useEffect, useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem,
  Select, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LockResetIcon from '@mui/icons-material/LockReset';
import { createToken, deleteToken, listTokens, updateToken, ApiToken, ApiEndpoint } from '../../services/apiService';

interface Props {
  endpoints: ApiEndpoint[];
  /** 如果传了 endpointId，列表过滤该接口相关 Token；否则显示全部 */
  endpointId?: string;
  refreshKey: number;
}

const TokenManager: React.FC<Props> = ({ endpoints, endpointId, refreshKey }) => {
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [editing, setEditing] = useState<ApiToken | null>(null);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ token: ApiToken; plaintext: string; reminder: string } | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await listTokens();
      setTokens(list);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [refreshKey]);

  const handleCreate = async (payload: {
    name: string;
    scope: 'all' | 'select';
    endpoint_ids: string[];
    ip_whitelist: string[];
    qps_limit: number;
    daily_limit: number;
    expires_at: string | null;
  }) => {
    const r = await createToken(payload);
    setCreated(r);
    setCreating(false);
    await load();
  };

  const handleUpdate = async (id: string, payload: Partial<ApiToken>) => {
    await updateToken(id, payload);
    setEditing(null);
    await load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该 Token？删除后调用方将无法访问。')) return;
    await deleteToken(id);
    await load();
  };

  // 过滤当前接口相关 Token（仅展示用途；不影响接口实际授权）
  const display = endpointId
    ? tokens.filter((t) => t.scope === 'all' || t.endpoint_ids.includes(endpointId))
    : tokens;

  return (
    <Box>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>
          独立 API Token（与登录 JWT 分离）
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<AddIcon />} variant="contained" color="primary"
          onClick={() => setCreating(true)} sx={{ textTransform: 'none', fontSize: 'calc(0.72rem * var(--dc-scale, 1))' }}>
          新建 Token
        </Button>
      </Stack>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        {/* 表头 */}
        <Stack direction="row" sx={{
          px: 1, py: 0.5, bgcolor: 'background.default', borderBottom: '1px solid', borderColor: 'divider',
          color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', fontWeight: 600,
        }}>
          <Box sx={{ width: 90 }}>名称</Box>
          <Box sx={{ width: 80 }}>作用域</Box>
          <Box sx={{ flex: 1 }}>接口</Box>
          <Box sx={{ width: 120 }}>白名单 IP</Box>
          <Box sx={{ width: 90 }}>限流</Box>
          <Box sx={{ width: 110 }}>过期</Box>
          <Box sx={{ width: 60 }}>状态</Box>
          <Box sx={{ width: 90 }}>操作</Box>
        </Stack>

        {loading && (
          <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary',
            fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>加载中…</Box>
        )}
        {!loading && display.length === 0 && (
          <Box sx={{ p: 2, textAlign: 'center', color: 'text.disabled',
            fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>暂无 Token</Box>
        )}

        {!loading && display.map((tk) => (
          <Stack key={tk.id} direction="row" alignItems="center" sx={{
            px: 1, py: 0.6, borderBottom: '1px solid', borderColor: 'divider',
            fontSize: 'calc(0.74rem * var(--dc-scale, 1))',
            '&:hover': { bgcolor: 'action.hover' },
          }}>
            <Box sx={{ width: 90, color: 'text.primary', fontWeight: 600 }}>{tk.name || '(未命名)'}</Box>
            <Box sx={{ width: 80 }}>
              <Chip size="small" label={tk.scope === 'all' ? '全部接口' : '指定接口'}
                color={tk.scope === 'all' ? 'primary' : 'default'}
                variant={tk.scope === 'all' ? 'filled' : 'outlined'}
                sx={{ height: 18, fontSize: 'calc(0.62rem * var(--dc-scale, 1))' }} />
            </Box>
            <Box sx={{ flex: 1, color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tk.scope === 'all'
                ? <span style={{ color: '#4FC3F7' }}>★ 所有接口</span>
                : tk.endpoint_ids.length === 0
                  ? <span style={{ color: '#FFB020' }}>未指定接口</span>
                  : tk.endpoint_ids.map((id) => {
                      const ep = endpoints.find((e) => e.id === id);
                      return (
                        <Chip key={id} size="small" label={ep ? ep.name : id}
                          sx={{ mr: 0.4, height: 18, fontSize: 'calc(0.6rem * var(--dc-scale, 1))' }} />
                      );
                    })}
            </Box>
            <Box sx={{ width: 120, color: 'text.secondary', fontSize: 'calc(0.68rem * var(--dc-scale, 1))',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {tk.ip_whitelist.length === 0
                ? <span style={{ color: '#FFB020' }}>不限</span>
                : tk.ip_whitelist.join(', ')}
            </Box>
            <Box sx={{ width: 90, color: 'text.secondary' }}>
              {tk.qps_limit}/s · {tk.daily_limit}/d
            </Box>
            <Box sx={{ width: 110, color: 'text.secondary' }}>
              {tk.expires_at
                ? <Tooltip title={tk.expires_at}><span>{new Date(tk.expires_at).toLocaleDateString('zh-CN')}</span></Tooltip>
                : <span style={{ color: '#4ADE80' }}>永久</span>}
            </Box>
            <Box sx={{ width: 60 }}>
              <Chip size="small" label={tk.status === 'active' ? '启用' : '停用'}
                color={tk.status === 'active' ? 'success' : 'default'}
                sx={{ height: 18, fontSize: 'calc(0.6rem * var(--dc-scale, 1))' }} />
            </Box>
            <Box sx={{ width: 90 }}>
              <Tooltip title="编辑"><IconButton size="small" onClick={() => setEditing(tk)}>
                <LockResetIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />
              </IconButton></Tooltip>
              <Tooltip title="删除"><IconButton size="small" onClick={() => handleDelete(tk.id)}>
                <DeleteIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />
              </IconButton></Tooltip>
            </Box>
          </Stack>
        ))}
      </Box>

      {/* 新建 Token 弹窗 */}
      {creating && (
        <TokenFormDialog
          open
          token={null}
          endpoints={endpoints}
          defaultScope="all"
          onClose={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* 编辑 Token 弹窗 */}
      {editing && (
        <TokenFormDialog
          open
          token={editing}
          endpoints={endpoints}
          defaultScope={editing.scope}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => handleUpdate(editing.id, payload)}
        />
      )}

      {/* 新建后展示明文（一次性） */}
      {created && (
        <Dialog open onClose={() => setCreated(null)} maxWidth="sm" fullWidth
          PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' } }}>
          <DialogTitle sx={{ fontSize: 'calc(0.95rem * var(--dc-scale, 1))', fontWeight: 600 }}>
            Token 已生成（明文仅展示一次）
          </DialogTitle>
          <DialogContent>
            <Typography sx={{ color: 'warning.main', mb: 1,
              fontSize: 'calc(0.72rem * var(--dc-scale, 1))' }}>
              ⚠ {created.reminder}
            </Typography>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Box sx={{
                flex: 1, p: 1, borderRadius: 1, bgcolor: 'background.default',
                border: '1px solid', borderColor: 'divider',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: 'calc(0.78rem * var(--dc-scale, 1))',
                color: 'text.primary', wordBreak: 'break-all',
              }}>
                {created.plaintext}
              </Box>
              <Tooltip title="复制">
                <IconButton size="small" onClick={() => {
                  navigator.clipboard?.writeText(created.plaintext);
                }}><ContentCopyIcon fontSize="small" /></IconButton>
              </Tooltip>
            </Stack>
            <Typography sx={{ mt: 1.5, color: 'text.secondary',
              fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
              名称：{created.token.name || '(未命名)'}　作用域：{created.token.scope === 'all' ? '全部接口' : '指定接口'}
            </Typography>
            <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
              调用示例：<code>curl -H "Authorization: Bearer {created.plaintext.slice(0, 12)}..." /api/public/v1/&lt;apiId&gt;</code>
            </Typography>
          </DialogContent>
          <DialogActions sx={{ px: 2.5, pb: 1.75 }}>
            <Button variant="contained" color="primary" onClick={() => setCreated(null)}
              sx={{ textTransform: 'none' }}>我已保存</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

/* ============================================================
 * 新建 / 编辑 弹窗
 * ============================================================ */
interface FormProps {
  open: boolean;
  token: ApiToken | null;
  endpoints: ApiEndpoint[];
  defaultScope: 'all' | 'select';
  onClose: () => void;
  onSubmit: (payload: {
    name: string;
    scope: 'all' | 'select';
    endpoint_ids: string[];
    ip_whitelist: string[];
    qps_limit: number;
    daily_limit: number;
    expires_at: string | null;
  }) => Promise<void>;
}

const TokenFormDialog: React.FC<FormProps> = ({ open, token, endpoints, defaultScope, onClose, onSubmit }) => {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'all' | 'select'>(defaultScope);
  const [endpointIds, setEndpointIds] = useState<string[]>([]);
  const [ipText, setIpText] = useState('');
  const [qps, setQps] = useState(10);
  const [daily, setDaily] = useState(1000);
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (token) {
      setName(token.name);
      setScope(token.scope);
      setEndpointIds(token.endpoint_ids);
      setIpText(token.ip_whitelist.join(', '));
      setQps(token.qps_limit);
      setDaily(token.daily_limit);
      setExpiresAt(token.expires_at ? token.expires_at.slice(0, 16) : '');
    } else {
      setName(''); setScope(defaultScope); setEndpointIds([]);
      setIpText(''); setQps(10); setDaily(1000); setExpiresAt('');
    }
    setErr(null);
  }, [open, token, defaultScope]);

  const handleSubmit = async () => {
    setErr(null);
    if (scope === 'select' && endpointIds.length === 0) {
      setErr('作用域为「指定接口」时，必须勾选至少一个接口'); return;
    }
    const iplist = ipText.split(',').map((s) => s.trim()).filter(Boolean);
    setSaving(true);
    try {
      await onSubmit({
        name: name.trim(),
        scope,
        endpoint_ids: scope === 'all' ? [] : endpointIds,
        ip_whitelist: iplist,
        qps_limit: Math.max(1, qps),
        daily_limit: Math.max(1, daily),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth
      PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.25 } }}>
      <DialogTitle sx={{ fontSize: 'calc(0.95rem * var(--dc-scale, 1))', fontWeight: 600, pb: 1 }}>
        {token ? '编辑 Token' : '新建 Token'}
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        {err && <Box sx={{ mb: 1.5, p: 1, borderRadius: 1, bgcolor: 'rgba(248,113,113,0.12)', color: 'error.main',
          fontSize: 'calc(0.72rem * var(--dc-scale, 1))' }}>{err}</Box>}

        <Stack spacing={1.25}>
          <TextField size="small" fullWidth label="Token 名称（仅展示）" value={name}
            onChange={(e) => setName(e.target.value)} />

          <FormControl size="small">
            <InputLabel>作用域</InputLabel>
            <Select label="作用域" value={scope}
              onChange={(e) => setScope(e.target.value as 'all' | 'select')}>
              <MenuItem value="all">全部接口（任意接口）</MenuItem>
              <MenuItem value="select">指定接口（需勾选）</MenuItem>
            </Select>
          </FormControl>

          {scope === 'select' && (
            <Box>
              <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>
                授权接口（可多选）
              </Typography>
              <Box sx={{
                border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, maxHeight: 180, overflow: 'auto',
              }}>
                {endpoints.length === 0 && (
                  <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.72rem * var(--dc-scale, 1))' }}>
                    暂无可用接口，请先创建接口
                  </Typography>
                )}
                {endpoints.map((ep) => {
                  const on = endpointIds.includes(ep.id);
                  return (
                    <Box key={ep.id} sx={{ display: 'flex', alignItems: 'center', py: 0.3 }}>
                      <FormControlLabel
                        control={<Switch size="small" checked={on}
                          onChange={(_, v) => setEndpointIds((cur) => v ? [...cur, ep.id] : cur.filter((x) => x !== ep.id))} />}
                        label={<Box>
                          <Typography sx={{ fontSize: 'calc(0.74rem * var(--dc-scale, 1))', color: 'text.primary', display: 'inline' }}>
                            {ep.name}
                          </Typography>
                          <Typography sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))', color: 'text.secondary', ml: 0.5, display: 'inline' }}>
                            （{ep.type === 'sql' ? 'SQL' : '表'} · {ep.status}）
                          </Typography>
                        </Box>} />
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}

          <TextField size="small" fullWidth label="IP 白名单（逗号分隔，留空 = 不限制）"
            placeholder="例如：192.168.1.10, 10.0.0.0/24, 172.16.*.*"
            value={ipText} onChange={(e) => setIpText(e.target.value)} />

          <Stack direction="row" spacing={1}>
            <TextField size="small" type="number" label="QPS 限制" value={qps}
              onChange={(e) => setQps(Number(e.target.value) || 10)}
              inputProps={{ min: 1, max: 10000 }}
              sx={{ flex: 1 }} />
            <TextField size="small" type="number" label="每日上限" value={daily}
              onChange={(e) => setDaily(Number(e.target.value) || 1000)}
              inputProps={{ min: 1, max: 10000000 }}
              sx={{ flex: 1 }} />
            <TextField size="small" type="datetime-local" label="过期时间（可选）"
              InputLabelProps={{ shrink: true }} value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              sx={{ flex: 1.5 }} />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 1.75 }}>
        <Button size="small" onClick={onClose} sx={{ color: 'text.secondary', textTransform: 'none' }}>取消</Button>
        <Button size="small" variant="contained" color="primary" onClick={handleSubmit} disabled={saving}
          sx={{ textTransform: 'none' }}>
          {saving ? '保存中…' : (token ? '保存' : '生成 Token')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TokenManager;