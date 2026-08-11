import React, { useEffect, useMemo, useState } from 'react';
import { Box, Button, CircularProgress, Divider, TextField, Tooltip, Typography } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useProxyStore } from '../../stores/proxyStore';

/**
 * 代理使用统计概览（详情面板顶部用）
 * - 顶部 4 个 KPI：审计总数 / 成功 / 失败 / 拦截
 * - 时间范围：最近 7 / 30 / 90 天 + 自定义
 * - 展示指定连接的统计（连接或全局）
 */
interface Props {
  connectionId?: string;
}

const toLocalInput = (iso: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60000);
  return local.toISOString().slice(0, 16);
};

const StatsOverview: React.FC<Props> = ({ connectionId }) => {
  const { stats, statsRange, statsLoading, loadStats } = useProxyStore();
  const [range, setRange] = useState<{ from: string; to: string }>(() => {
    const now = new Date();
    const from = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
  });

  useEffect(() => {
    loadStats({ from: range.from, to: range.to, connection_id: connectionId });
  }, [loadStats, connectionId, range.from, range.to]);

  // 当前连接或全局聚合
  const agg = useMemo(() => {
    if (connectionId) {
      const s = stats.find((x) => x.id === connectionId);
      if (!s) return { audit: 0, success: 0, failed: 0, blocked: 0, rate: null };
      const exec = s.success_count + s.failed_count;
      return {
        audit: s.audit_count,
        success: s.success_count,
        failed: s.failed_count,
        blocked: s.blocked_count,
        rate: exec > 0 ? Number((s.success_count / exec).toFixed(4)) : null,
      };
    }
    const r = stats.reduce(
      (acc, s) => ({
        audit: acc.audit + s.audit_count,
        success: acc.success + s.success_count,
        failed: acc.failed + s.failed_count,
        blocked: acc.blocked + s.blocked_count,
      }),
      { audit: 0, success: 0, failed: 0, blocked: 0 }
    );
    const exec = r.success + r.failed;
    return { ...r, rate: exec > 0 ? Number((r.success / exec).toFixed(4)) : null };
  }, [stats, connectionId]);

  const setDays = (days: number) => {
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
    setRange({ from: from.toISOString(), to: now.toISOString() });
  };

  return (
    <Box sx={{ mb: 1, p: 1, bgcolor: 'action.hover', borderRadius: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
        <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>
          {connectionId ? '本连接使用统计' : '全部代理使用统计'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" variant="text" onClick={() => setDays(7)} sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.65rem * var(--dc-scale, 1))', minWidth: 0, px: 0.5 }}>7天</Button>
        <Button size="small" variant="text" onClick={() => setDays(30)} sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.65rem * var(--dc-scale, 1))', minWidth: 0, px: 0.5 }}>30天</Button>
        <Button size="small" variant="text" onClick={() => setDays(90)} sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.65rem * var(--dc-scale, 1))', minWidth: 0, px: 0.5 }}>90天</Button>
        <Tooltip title="刷新">
          <span>
            <Button
              size="small"
              variant="text"
              startIcon={statsLoading ? <CircularProgress size={10} /> : <RefreshIcon sx={{ fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }} />}
              onClick={() => loadStats({ from: range.from, to: range.to, connection_id: connectionId })}
              sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.65rem * var(--dc-scale, 1))', minWidth: 0, px: 0.5 }}
            >
              刷新
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, mb: 0.75 }}>
        <Kpi label="审计总数" value={agg.audit} color="primary.main" />
        <Kpi label="成功" value={agg.success} color="success.main" />
        <Kpi label="失败" value={agg.failed} color="warning.main" />
        <Kpi label="拦截" value={agg.blocked} color="error.main" />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0.75, alignItems: 'center' }}>
        <TextField
          size="small"
          type="datetime-local"
          label="开始"
          value={toLocalInput(range.from)}
          onChange={(e) => setRange((r) => ({ ...r, from: new Date(e.target.value).toISOString() }))}
          InputLabelProps={{ shrink: true }}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.65rem * var(--dc-scale, 1))' }, '& .MuiInputLabel-root': { fontSize: 'calc(0.65rem * var(--dc-scale, 1))' } }}
        />
        <TextField
          size="small"
          type="datetime-local"
          label="结束"
          value={toLocalInput(range.to)}
          onChange={(e) => setRange((r) => ({ ...r, to: new Date(e.target.value).toISOString() }))}
          InputLabelProps={{ shrink: true }}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.65rem * var(--dc-scale, 1))' }, '& .MuiInputLabel-root': { fontSize: 'calc(0.65rem * var(--dc-scale, 1))' } }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.65rem * var(--dc-scale, 1))' }}>成功率</Typography>
          <Typography sx={{ color: agg.rate !== null ? (agg.rate >= 0.95 ? 'success.main' : agg.rate >= 0.8 ? 'warning.main' : 'error.main') : 'text.disabled', fontSize: 'calc(0.85rem * var(--dc-scale, 1))', fontWeight: 600 }}>
            {agg.rate !== null ? `${(agg.rate * 100).toFixed(1)}%` : '—'}
          </Typography>
        </Box>
      </Box>

      <Divider sx={{ mt: 1, borderColor: 'divider' }} />
    </Box>
  );
};

const Kpi: React.FC<{ label: string; value: number; color: string }> = ({ label, value, color }) => (
  <Box sx={{ bgcolor: 'background.paper', borderRadius: 1, p: 0.75, textAlign: 'center' }}>
    <Typography sx={{ color, fontSize: 'calc(1.05rem * var(--dc-scale, 1))', fontWeight: 700, lineHeight: 1.1 }}>
      {value.toLocaleString()}
    </Typography>
    <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.6rem * var(--dc-scale, 1))', mt: 0.25 }}>
      {label}
    </Typography>
  </Box>
);

export default StatsOverview;