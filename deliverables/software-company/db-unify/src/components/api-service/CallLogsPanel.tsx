import React, { useEffect, useState } from 'react';
import {
  Box, Button, Chip, FormControl, InputLabel, MenuItem, Select, Stack, Typography, IconButton, Tooltip,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import NavigateBeforeIcon from '@mui/icons-material/NavigateBefore';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import { ApiCallLog, ApiToken, listEndpointLogs } from '../../services/apiService';

interface Props {
  endpointId: string;
  tokens: ApiToken[];
}

const STATUS_COLOR: Record<number, { label: string; color: string }> = {
  0: { label: '成功', color: '#4ADE80' },
  400: { label: '参数错误', color: '#FFB020' },
  401: { label: '鉴权失败', color: '#F87171' },
  403: { label: '拒绝（白名单/越权）', color: '#F87171' },
  404: { label: '接口不存在', color: '#FFB020' },
  429: { label: '限流', color: '#FFB020' },
  500: { label: '执行错误', color: '#F87171' },
};

const CallLogsPanel: React.FC<Props> = ({ endpointId, tokens }) => {
  const [logs, setLogs] = useState<ApiCallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(30);
  const [loading, setLoading] = useState(false);
  const [tokenId, setTokenId] = useState<string>('');
  const [statusCode, setStatusCode] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const r = await listEndpointLogs(endpointId, {
        page, pageSize,
        token_id: tokenId || undefined,
        status_code: statusCode ? Number(statusCode) : undefined,
      });
      setLogs(r.logs);
      setTotal(r.total);
    } catch {
      setLogs([]); setTotal(0);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [endpointId, page]);
  // 过滤条件变化：回到第 1 页
  useEffect(() => { setPage(1); /* eslint-disable-next-line */ }, [tokenId, statusCode]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>
          调用日志（共 {total} 条）
        </Typography>
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>Token</InputLabel>
          <Select label="Token" value={tokenId} onChange={(e) => setTokenId(e.target.value as string)}>
            <MenuItem value="">全部</MenuItem>
            {tokens.map((t) => <MenuItem key={t.id} value={t.id}>{t.name || t.id}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 110 }}>
          <InputLabel>状态</InputLabel>
          <Select label="状态" value={statusCode} onChange={(e) => setStatusCode(e.target.value as string)}>
            <MenuItem value="">全部</MenuItem>
            <MenuItem value="0">成功</MenuItem>
            <MenuItem value="400">参数错误</MenuItem>
            <MenuItem value="401">鉴权失败</MenuItem>
            <MenuItem value="403">拒绝</MenuItem>
            <MenuItem value="429">限流</MenuItem>
            <MenuItem value="500">执行错误</MenuItem>
          </Select>
        </FormControl>
        <Tooltip title="刷新"><IconButton size="small" onClick={load}>
          <RefreshIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />
        </IconButton></Tooltip>
      </Stack>

      <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
        {/* 表头 */}
        <Stack direction="row" sx={{
          px: 1, py: 0.5, bgcolor: 'background.default', borderBottom: '1px solid', borderColor: 'divider',
          color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', fontWeight: 600,
        }}>
          <Box sx={{ width: 130 }}>时间</Box>
          <Box sx={{ width: 120 }}>状态</Box>
          <Box sx={{ width: 110 }}>IP</Box>
          <Box sx={{ width: 100 }}>耗时</Box>
          <Box sx={{ width: 130 }}>Token</Box>
          <Box sx={{ flex: 1 }}>错误 / 备注</Box>
        </Stack>

        {loading && (
          <Box sx={{ p: 2, textAlign: 'center', color: 'text.secondary',
            fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>加载中…</Box>
        )}
        {!loading && logs.length === 0 && (
          <Box sx={{ p: 2, textAlign: 'center', color: 'text.disabled',
            fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>暂无日志</Box>
        )}
        {!loading && logs.map((log) => {
          const meta = STATUS_COLOR[log.status_code] || { label: `${log.status_code}`, color: '#8AA0AD' };
          const tk = tokens.find((t) => t.id === log.token_id);
          return (
            <Stack key={log.id} direction="row" alignItems="center" sx={{
              px: 1, py: 0.55, borderBottom: '1px solid', borderColor: 'divider',
              fontSize: 'calc(0.72rem * var(--dc-scale, 1))',
              '&:hover': { bgcolor: 'action.hover' },
            }}>
              <Box sx={{ width: 130, color: 'text.secondary' }}>
                {new Date(log.called_at).toLocaleString('zh-CN')}
              </Box>
              <Box sx={{ width: 120 }}>
                <Chip size="small" label={meta.label} sx={{
                  height: 18, fontSize: 'calc(0.6rem * var(--dc-scale, 1))',
                  color: meta.color, borderColor: meta.color,
                  bgcolor: `${meta.color}22`,
                }} variant="outlined" />
              </Box>
              <Box sx={{ width: 110, color: 'text.secondary', fontFamily: 'ui-monospace, monospace',
                fontSize: 'calc(0.68rem * var(--dc-scale, 1))' }}>
                {log.ip || '-'}
              </Box>
              <Box sx={{ width: 100, color: 'text.secondary' }}>
                {log.duration_ms != null ? `${log.duration_ms} ms` : '-'}
              </Box>
              <Box sx={{ width: 130, color: 'text.secondary',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {tk ? (tk.name || tk.id) : (log.token_id ? log.token_id.slice(0, 8) : '-')}
              </Box>
              <Box sx={{ flex: 1, color: log.error_msg ? 'error.main' : 'text.disabled',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {log.error_msg || (log.params_hash ? `paramsHash=${log.params_hash.slice(0, 16)}…` : '')}
              </Box>
            </Stack>
          );
        })}
      </Box>

      {/* 分页 */}
      <Stack direction="row" alignItems="center" sx={{ mt: 1 }}>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mx: 1 }}>
          第 {page} / {totalPages} 页 · 每页 {pageSize}
        </Typography>
        <IconButton size="small" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
          <NavigateBeforeIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
          <NavigateNextIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Box>
  );
};

export default CallLogsPanel;