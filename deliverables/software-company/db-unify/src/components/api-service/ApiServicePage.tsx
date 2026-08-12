import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, List, ListItemButton, ListItemIcon, ListItemText, Snackbar, Alert,
  Stack, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import HttpIcon from '@mui/icons-material/Http';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';
import EndpointDialog from './EndpointDialog';
import TokenManager from './TokenManager';
import CallLogsPanel from './CallLogsPanel';
import {
  ApiEndpoint, ApiToken, deleteEndpoint, listEndpoints, listEndpointTokens, testEndpoint,
} from '../../services/apiService';

type RightTab = 'detail' | 'tokens' | 'logs';

const ApiServicePage: React.FC = () => {
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<RightTab>('detail');
  const [search, setSearch] = useState('');

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ApiEndpoint | null>(null);

  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testPayload, setTestPayload] = useState<Record<string, string>>({});
  const [testPage, setTestPage] = useState(1);
  const [testPageSize, setTestPageSize] = useState(20);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const loadEndpoints = async () => {
    try {
      const list = await listEndpoints();
      setEndpoints(list);
      if (list.length > 0 && !selectedId) setSelectedId(list[0].id);
    } catch (e) {
      setSnackbar({ message: e instanceof Error ? e.message : '加载接口失败', severity: 'error' });
    }
  };
  useEffect(() => { loadEndpoints(); /* eslint-disable-next-line */ }, [refreshKey]);

  const loadTokens = async () => {
    if (!selectedId) { setTokens([]); return; }
    try { setTokens(await listEndpointTokens(selectedId)); } catch { setTokens([]); }
  };
  useEffect(() => { loadTokens(); /* eslint-disable-next-line */ }, [selectedId, refreshKey]);

  const filtered = useMemo(() => {
    if (!search.trim()) return endpoints;
    const k = search.toLowerCase();
    return endpoints.filter((e) => (e.name + e.description + e.id).toLowerCase().includes(k));
  }, [endpoints, search]);

  const selected = endpoints.find((e) => e.id === selectedId) || null;

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该接口？相关 Token 将自动撤销对该接口的授权。')) return;
    try {
      await deleteEndpoint(id);
      if (selectedId === id) {
        setSelectedId(null);
        setActiveTab('detail');
      }
      setRefreshKey((k) => k + 1);
      setSnackbar({ message: '已删除', severity: 'success' });
    } catch (e) {
      setSnackbar({ message: e instanceof Error ? e.message : '删除失败', severity: 'error' });
    }
  };

  const handleTest = async () => {
    if (!selected) return;
    setTestRunning(true);
    setTestError(null);
    setTestResult(null);
    try {
      // 把 string → 数字（number 类型）
      const defs = selected.params || [];
      const coerced: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(testPayload)) {
        const def = defs.find((d) => d.name === k);
        if (!def || v === '') { coerced[k] = v; continue; }
        if (def.type === 'number') coerced[k] = Number(v);
        else if (def.type === 'boolean') coerced[k] = v === 'true';
        else coerced[k] = v;
      }
      const r = await testEndpoint(selected.id, { params: coerced, page: testPage, pageSize: testPageSize });
      if (!r.success) setTestError(r.error || '测试失败');
      else setTestResult(r);
    } catch (e) {
      setTestError(e instanceof Error ? e.message : '测试失败');
    } finally {
      setTestRunning(false);
    }
  };

  const openCreate = () => { setEditing(null); setEditDialogOpen(true); };
  const openEdit = (ep: ApiEndpoint) => { setEditing(ep); setEditDialogOpen(true); };
  const openTest = () => {
    if (!selected) return;
    setTestPayload({}); setTestPage(1); setTestPageSize(20); setTestResult(null); setTestError(null);
    setTestDialogOpen(true);
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default' }}>
      {/* 顶部状态条 */}
      <Box sx={{
        height: 32, px: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider',
        bgcolor: 'background.paper', color: 'text.secondary',
        fontSize: 'calc(0.74rem * var(--dc-scale, 1))',
      }}>
        <Typography sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))', fontWeight: 600, color: 'text.primary' }}>
          API 服务
        </Typography>
        <Typography sx={{ ml: 1.5, fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
          将表或 SQL 发布为对外 HTTP API · 独立 Token 鉴权 · 只读强制 · 限流 · 审计
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
          共 {endpoints.length} 个接口
        </Typography>
        <Tooltip title="刷新">
          <IconButton size="small" sx={{ ml: 0.5 }} onClick={() => setRefreshKey((k) => k + 1)}>
            <RefreshIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左列：接口列表 */}
        <Box sx={{
          width: 280, minWidth: 240, maxWidth: 360,
          borderRight: '1px solid', borderColor: 'divider',
          display: 'flex', flexDirection: 'column', bgcolor: 'background.default',
        }}>
          <Stack direction="row" sx={{ p: 1, gap: 0.5 }} alignItems="center">
            <TextField
              size="small" placeholder="搜索接口名 / ID" value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: <SearchIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))', color: 'text.secondary', mr: 0.5 }} />,
              }}
              sx={{ flex: 1, '& input': { fontSize: 'calc(0.74rem * var(--dc-scale, 1))' } }} />
            <Button size="small" variant="contained" color="primary" startIcon={<AddIcon />}
              onClick={openCreate} sx={{ textTransform: 'none', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', minWidth: 0, px: 1 }}>
              新建
            </Button>
          </Stack>
          <List dense disablePadding sx={{ flex: 1, overflow: 'auto' }}>
            {filtered.length === 0 && (
              <Box sx={{ p: 2, textAlign: 'center', color: 'text.disabled',
                fontSize: 'calc(0.74rem * var(--dc-scale, 1))' }}>暂无接口</Box>
            )}
            {filtered.map((ep) => {
              const active = ep.id === selectedId;
              return (
                <ListItemButton key={ep.id} selected={active} onClick={() => { setSelectedId(ep.id); setActiveTab('detail'); }}
                  sx={{
                    borderBottom: '1px solid', borderColor: 'divider',
                    py: 0.75, pl: 1.5, pr: 0.75,
                    '&.Mui-selected': { bgcolor: 'action.selected' },
                    '&:hover': { bgcolor: 'action.hover' },
                  }}>
                  <ListItemIcon sx={{ minWidth: 24 }}>
                    {ep.type === 'sql'
                      ? <HttpIcon sx={{ fontSize: 'calc(0.95rem * var(--dc-scale, 1))', color: 'primary.main' }} />
                      : <StorageIcon sx={{ fontSize: 'calc(0.95rem * var(--dc-scale, 1))', color: 'secondary.main' }} />}
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Stack direction="row" alignItems="center" spacing={0.5}>
                        <Typography sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))', color: 'text.primary',
                          fontWeight: active ? 600 : 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {ep.name}
                        </Typography>
                        <Chip size="small" label={ep.status === 'active' ? '启用' : '停用'}
                          sx={{ height: 16, fontSize: 'calc(0.56rem * var(--dc-scale, 1))',
                            color: ep.status === 'active' ? 'success.main' : 'text.disabled' }} />
                      </Stack>
                    }
                    secondary={
                      <Typography sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))', color: 'text.secondary',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {ep.type === 'sql' ? `SQL · ${ep.params.length} 个参数` : `表 · ${ep.table_name || '(未选)'}`}
                        <Box component="span" sx={{ color: 'text.disabled', ml: 0.5 }}>
                          ({ep.id})
                        </Box>
                      </Typography>
                    }
                  />
                </ListItemButton>
              );
            })}
          </List>
        </Box>

        {/* 右列：详情 */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {!selected ? (
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }}>
                请选择或新建一个接口
              </Typography>
            </Box>
          ) : (
            <>
              {/* 接口标题 + 操作 */}
              <Stack direction="row" alignItems="center" sx={{
                px: 2, py: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper',
              }}>
                <HttpIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', color: 'primary.main', mr: 1 }} />
                <Box>
                  <Typography sx={{ fontSize: 'calc(0.92rem * var(--dc-scale, 1))', fontWeight: 600, color: 'text.primary' }}>
                    {selected.name}
                  </Typography>
                  <Typography sx={{ fontSize: 'calc(0.68rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
                    ID: {selected.id} · 类型：{selected.type === 'sql' ? '预定义 SQL' : '表自动生成'} ·
                    状态：<span style={{ color: selected.status === 'active' ? '#4ADE80' : '#F87171' }}>{selected.status}</span> ·
                    创建：{selected.created_by || '-'}
                  </Typography>
                </Box>
                <Box sx={{ flex: 1 }} />
                <Button size="small" startIcon={<PlayArrowIcon />} variant="outlined" color="primary"
                  onClick={openTest} sx={{ textTransform: 'none', mr: 0.5,
                    fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
                  测试调用
                </Button>
                <Button size="small" startIcon={<EditIcon />} variant="outlined"
                  onClick={() => openEdit(selected)} sx={{ textTransform: 'none', mr: 0.5,
                    fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
                  编辑
                </Button>
                <Button size="small" startIcon={<DeleteIcon />} variant="outlined" color="error"
                  onClick={() => handleDelete(selected.id)} sx={{ textTransform: 'none',
                    fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
                  删除
                </Button>
              </Stack>

              {/* Tab 切换 */}
              <Stack direction="row" sx={{
                px: 1, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.default',
              }}>
                {([
                  { id: 'detail' as const, label: '基本信息' },
                  { id: 'tokens' as const, label: 'Token 管理' },
                  { id: 'logs' as const, label: '调用日志' },
                ] as const).map((t) => (
                  <Box key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    sx={{
                      px: 1.5, py: 0.5, cursor: 'pointer',
                      fontSize: 'calc(0.74rem * var(--dc-scale, 1))',
                      color: activeTab === t.id ? 'primary.main' : 'text.secondary',
                      fontWeight: activeTab === t.id ? 600 : 400,
                      borderBottom: '2px solid',
                      borderColor: activeTab === t.id ? 'primary.main' : 'transparent',
                      transition: 'all 150ms ease',
                    }}>
                    {t.label}
                  </Box>
                ))}
              </Stack>

              <Box sx={{ flex: 1, overflow: 'auto', p: 2, bgcolor: 'background.default' }}>
                {activeTab === 'detail' && (
                  <Box>
                    {/* 描述 */}
                    {selected.description && (
                      <Box sx={{ mb: 2 }}>
                        <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>说明</Typography>
                        <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'background.paper',
                          border: '1px solid', borderColor: 'divider',
                          fontSize: 'calc(0.78rem * var(--dc-scale, 1))', color: 'text.primary' }}>
                          {selected.description}
                        </Box>
                      </Box>
                    )}

                    {/* 基本信息表格 */}
                    <Box sx={{
                      display: 'grid', gridTemplateColumns: '120px 1fr 120px 1fr', rowGap: 0.75, columnGap: 1,
                      mb: 2, p: 1.5, borderRadius: 1, bgcolor: 'background.paper',
                      border: '1px solid', borderColor: 'divider',
                    }}>
                      <DetailField label="数据库连接" value={selected.connection_id} />
                      <DetailField label="Schema" value={selected.schema_name || '—'} />
                      <DetailField label="目标表" value={selected.table_name || '—'} />
                      <DetailField label="单页最大" value={`${selected.page_size_max} 条`} />
                      <DetailField label="参数数量" value={`${selected.params.length}`} />
                      <DetailField label="脱敏字段" value={
                        selected.mask_fields.length > 0
                          ? selected.mask_fields.join(', ')
                          : '—'
                      } />
                      <DetailField label="创建时间" value={selected.created_at || '—'} />
                      <DetailField label="更新时间" value={selected.updated_at || '—'} />
                    </Box>

                    {/* SQL */}
                    {selected.type === 'sql' && (
                      <Box sx={{ mb: 2 }}>
                        <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>SQL（只读）</Typography>
                        <Box sx={{
                          p: 1, borderRadius: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider',
                          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          fontSize: 'calc(0.74rem * var(--dc-scale, 1))',
                          whiteSpace: 'pre-wrap', color: 'text.primary', maxHeight: 200, overflow: 'auto',
                        }}>
                          {selected.sql_text || '—'}
                        </Box>
                      </Box>
                    )}

                    {/* 参数 */}
                    {selected.params.length > 0 && (
                      <Box>
                        <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>参数定义</Typography>
                        <Stack direction="row" flexWrap="wrap" gap={0.5}>
                          {selected.params.map((p, i) => (
                            <Chip key={i} size="small"
                              label={`${p.name} : ${p.type}${p.required ? ' *' : ''}`}
                              sx={{ height: 20, fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }} />
                          ))}
                        </Stack>
                      </Box>
                    )}
                  </Box>
                )}

                {activeTab === 'tokens' && (
                  <TokenManager endpoints={endpoints} endpointId={selected.id} refreshKey={refreshKey} />
                )}

                {activeTab === 'logs' && (
                  <CallLogsPanel endpointId={selected.id} tokens={tokens} />
                )}
              </Box>
            </>
          )}
        </Box>
      </Box>

      {/* 新建/编辑 */}
      <EndpointDialog
        open={editDialogOpen}
        endpoint={editing}
        onClose={() => setEditDialogOpen(false)}
        onSaved={() => { setEditDialogOpen(false); setRefreshKey((k) => k + 1);
          setSnackbar({ message: '已保存', severity: 'success' });
        }}
      />

      {/* 测试调用 */}
      {selected && (
        <Dialog open={testDialogOpen} onClose={() => setTestDialogOpen(false)} maxWidth="md" fullWidth
          PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.25 } }}>
          <DialogTitle sx={{ fontSize: 'calc(0.95rem * var(--dc-scale, 1))', fontWeight: 600, pb: 1 }}>
            测试调用 · {selected.name}
          </DialogTitle>
          <DialogContent sx={{ pt: '12px !important' }}>
            <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 1 }}>
              内部调用（不走 Token / 限流 / 审计），用于接口联调
            </Typography>
            {selected.params.length > 0 && (
              <Box sx={{ mb: 1.5 }}>
                <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>参数</Typography>
                <Stack spacing={0.75}>
                  {selected.params.map((p) => (
                    <Stack key={p.name} direction="row" spacing={1} alignItems="center">
                      <Typography sx={{ minWidth: 140, color: 'text.primary',
                        fontSize: 'calc(0.74rem * var(--dc-scale, 1))' }}>
                        {p.name} <Box component="span" sx={{ color: 'text.secondary', fontSize: 'calc(0.66rem * var(--dc-scale, 1))' }}>
                          ({p.type}{p.required ? ' · 必填' : ''})
                        </Box>
                      </Typography>
                      <TextField size="small" fullWidth
                        value={testPayload[p.name] ?? ''}
                        onChange={(e) => setTestPayload((cur) => ({ ...cur, [p.name]: e.target.value }))} />
                    </Stack>
                  ))}
                </Stack>
              </Box>
            )}
            <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
              <TextField size="small" type="number" label="页码" value={testPage}
                onChange={(e) => setTestPage(Math.max(1, Number(e.target.value) || 1))} sx={{ width: 100 }} />
              <TextField size="small" type="number" label="每页" value={testPageSize}
                onChange={(e) => setTestPageSize(Math.max(1, Number(e.target.value) || 20))} sx={{ width: 100 }} />
            </Stack>

            {testError && (
              <Box sx={{ p: 1, borderRadius: 1, bgcolor: 'rgba(248,113,113,0.12)', color: 'error.main',
                fontSize: 'calc(0.74rem * var(--dc-scale, 1))' }}>{testError}</Box>
            )}
            {testResult && (
              <Box>
                <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>
                  结果（耗时 {testResult.duration_ms}ms · 返回 {testResult.total_returned ?? (testResult.data || []).length} 行）
                </Typography>
                <Box sx={{
                  maxHeight: 220, overflow: 'auto', borderRadius: 1, bgcolor: 'background.default',
                  border: '1px solid', borderColor: 'divider',
                  fontFamily: 'ui-monospace, monospace', fontSize: 'calc(0.7rem * var(--dc-scale, 1))',
                  color: 'text.primary', p: 1, whiteSpace: 'pre-wrap',
                }}>
                  {JSON.stringify(testResult.data, null, 2)}
                </Box>
                {testResult.bounded_sql && (
                  <Box sx={{ mt: 1 }}>
                    <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.68rem * var(--dc-scale, 1))' }}>
                      绑定后 SQL（$n 参数化）
                    </Typography>
                    <Box sx={{
                      fontFamily: 'ui-monospace, monospace', fontSize: 'calc(0.68rem * var(--dc-scale, 1))',
                      color: 'text.secondary', p: 0.75, borderRadius: 1, bgcolor: 'background.default',
                      border: '1px solid', borderColor: 'divider', whiteSpace: 'pre-wrap',
                    }}>
                      {testResult.bounded_sql}
                    </Box>
                  </Box>
                )}
              </Box>
            )}
          </DialogContent>
          <DialogActions sx={{ px: 2.5, pb: 1.75 }}>
            <Button size="small" onClick={() => setTestDialogOpen(false)}
              sx={{ color: 'text.secondary', textTransform: 'none' }}>关闭</Button>
            <Button size="small" variant="contained" color="primary" onClick={handleTest} disabled={testRunning}
              sx={{ textTransform: 'none' }}>
              {testRunning ? '执行中…' : '执行'}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      <Snackbar open={!!snackbar} autoHideDuration={2500} onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        {snackbar ? (
          <Alert severity={snackbar.severity} variant="filled"
            sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>{snackbar.message}</Alert>
        ) : undefined}
      </Snackbar>
    </Box>
  );
};

/* ============================================================
 * DetailField：两列展示 kv
 * ============================================================ */
const DetailField: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <>
    <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.68rem * var(--dc-scale, 1))', fontWeight: 600 }}>
      {label}
    </Typography>
    <Box sx={{
      color: 'text.primary', fontSize: 'calc(0.76rem * var(--dc-scale, 1))',
      wordBreak: 'break-all', fontFamily: typeof value === 'string' ? 'ui-monospace, monospace' : 'inherit',
    }}>
      {value}
    </Box>
  </>
);

export default ApiServicePage;