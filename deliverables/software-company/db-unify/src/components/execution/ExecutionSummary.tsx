import React from 'react';
import { Box, Chip, LinearProgress, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import TimerIcon from '@mui/icons-material/Timer';
import { ExecutionStatus } from '../../types/execution';
import type { ExecutionTask } from '../../types/execution';

interface ExecutionSummaryProps {
  tasks: ExecutionTask[];
}

/** 状态配置：颜色、图标 */
const STATUS_CONFIG = {
  [ExecutionStatus.Success]:  { color: '#2E7D32', bg: '#E8F5E9', icon: <CheckCircleIcon sx={{ fontSize: 16 }} />, label: '成功' },
  [ExecutionStatus.Failed]:   { color: '#D32F2F', bg: '#FFEBEE', icon: <ErrorIcon sx={{ fontSize: 16 }} />, label: '失败' },
  [ExecutionStatus.Running]:  { color: '#1976D2', bg: '#E3F2FD', icon: <AutorenewIcon sx={{ fontSize: 16 }} />, label: '执行中' },
  [ExecutionStatus.Pending]:  { color: '#757575', bg: '#F5F5F5', icon: <HourglassEmptyIcon sx={{ fontSize: 16 }} />, label: '等待' },
  [ExecutionStatus.Timeout]:  { color: '#ED6C02', bg: '#FFF3E0', icon: <TimerIcon sx={{ fontSize: 16 }} />, label: '超时' },
} as const;

type StatusKey = keyof typeof STATUS_CONFIG;

const ExecutionSummary: React.FC<ExecutionSummaryProps> = ({ tasks }) => {
  const total = tasks.length;
  const counts: Record<StatusKey, number> = {
    [ExecutionStatus.Success]: 0,
    [ExecutionStatus.Failed]: 0,
    [ExecutionStatus.Running]: 0,
    [ExecutionStatus.Pending]: 0,
    [ExecutionStatus.Timeout]: 0,
  };

  for (const t of tasks) {
    if (t.status in counts) counts[t.status as StatusKey]++;
  }

  // 按数量降序排列，隐藏数量为 0 的状态
  const sortedEntries = (Object.entries(counts) as [StatusKey, number][])
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <Box sx={{ py: 1 }}>
      {/* 统计 Chips 行 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: total > 0 ? 1 : 0 }}>
        <Chip label={`总计: ${total}`} size="small" variant="outlined" sx={{ fontWeight: 600 }} />
        {(Object.entries(STATUS_CONFIG) as [StatusKey, typeof STATUS_CONFIG[StatusKey]][]).map(([key, cfg]) => (
          <Chip
            key={key}
            icon={cfg.icon}
            label={`${cfg.label}: ${counts[key]}`}
            size="small"
            color={
              key === ExecutionStatus.Success ? 'success'
              : key === ExecutionStatus.Failed ? 'error'
              : key === ExecutionStatus.Timeout ? 'warning'
              : key === ExecutionStatus.Running ? 'info' : undefined
            }
            variant={counts[key] > 0 ? 'filled' : 'outlined'}
          />
        ))}
      </Box>

      {/* 执行状态分析（进度条 + 占比） */}
      {total > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            px: 0.5,
          }}
        >
          {/* 总进度条 */}
          <Box sx={{ flex: '1 1 280px', minWidth: 200 }}>
            <LinearProgress
              variant="determinate"
              value={100}
              sx={{
                height: 10,
                borderRadius: 5,
                backgroundColor: '#eee',
                position: 'relative',
                '& .MuiLinearProgress-bar': {
                  display: 'none',
                },
              }}
            />
            <Box
              sx={{
                display: 'flex',
                height: 10,
                borderRadius: 5,
                mt: -1.25,
                overflow: 'hidden',
              }}
            >
              {sortedEntries.map(([key, count]) => (
                <Box
                  key={key}
                  sx={{
                    width: `${(count / total) * 100}%`,
                    bgcolor: STATUS_CONFIG[key].color,
                    transition: 'width 0.3s ease',
                  }}
                />
              ))}
            </Box>
          </Box>

          {/* 各状态占比标签 */}
          {sortedEntries.map(([key, count]) => {
            const pct = ((count / total) * 100).toFixed(1);
            const cfg = STATUS_CONFIG[key];
            return (
              <Box
                key={key}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.4,
                  px: 1,
                  py: 0.25,
                  borderRadius: 1,
                  bgcolor: cfg.bg,
                  border: `1px solid ${cfg.color}40`,
                }}
              >
                {cfg.icon}
                <Typography variant="caption" sx={{ fontWeight: 600, color: cfg.color }}>
                  {pct}%
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  ({count})
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};

export default ExecutionSummary;
