import React from 'react';
import { Box, Button, Chip, LinearProgress, Switch, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useSyncStore } from '../../stores/syncStore';
import { statusMark } from './ProjectTreePanel';

interface Props {
  onCreateTask: () => void;
  /** 父组件传入：切换 task.enabled 时调用（持久化 + 刷新） */
  onToggleEnabled?: (taskId: string, enabled: boolean) => void;
}

const TaskListPanel: React.FC<Props> = ({ onCreateTask, onToggleEnabled }) => {
  const { tasks, selectedProjectId, selectTask, runningTaskId, runProgress, runTaskNow } = useSyncStore();
  const list = tasks.filter((task) => task.project_id === selectedProjectId);

  /** 计算「下次自动运行」时间：last_run_at + poll_interval_seconds */
  const computeNextRunText = (task: { last_run_at?: string | null; poll_interval_seconds?: number }): string | null => {
    if (!task.last_run_at || !task.poll_interval_seconds) return null;
    const lastMs = new Date(task.last_run_at).getTime();
    if (!Number.isFinite(lastMs)) return null;
    const next = new Date(lastMs + Number(task.poll_interval_seconds) * 1000);
    if (Number.isNaN(next.getTime())) return null;
    return `下次自动运行: ${next.toLocaleString('zh-CN')}`;
  };

  const handleToggle = (taskId: string, enabled: boolean) => {
    if (onToggleEnabled) {
      onToggleEnabled(taskId, enabled);
    }
  };

  return <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
      <Typography sx={{ color: 'text.primary', fontWeight: 600 }}>任务列表</Typography>
      <Chip size="small" label={list.length} sx={{ ml: 1, height: 20, color: 'text.secondary' }} />
      <Box sx={{ flex: 1 }} />
      <Button size="small" startIcon={<AddIcon />} onClick={onCreateTask} sx={{ color: 'primary.main' }}>新建任务</Button>
    </Box>
    {list.length === 0 && (
      <Typography sx={{ mt: 6, textAlign: 'center', color: 'text.disabled', fontSize: '0.8125rem' }}>该项目暂无同步任务</Typography>
    )}
    {list.map((task) => {
      const mark = statusMark(task.last_run_status);
      const isRunning = runningTaskId === task.id;
      const progress = runProgress[task.id];
      const enabled = task.enabled !== false;
      const nextRunText = enabled ? computeNextRunText(task) : null;
      return (
        <Box
          key={task.id}
          sx={{
            p: 1.5,
            mb: 1,
            bgcolor: 'background.paper',
            border: '1px solid', borderColor: 'divider',
            borderRadius: 1,
            '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
            cursor: 'pointer',
          }}
          onClick={() => selectTask(task.id)}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Typography sx={{ color: mark.color, fontSize: '1.125rem' }}>{mark.text}</Typography>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ color: 'text.primary', fontSize: '0.8438rem', fontWeight: 600 }}>
                {task.name}
              </Typography>
              <Typography noWrap sx={{ color: 'text.secondary', fontSize: '0.7188rem' }}>
                {task.source_schema || '默认 schema'} → {task.target_schema || '默认 schema'} ·{' '}
                {task.write_strategy || 'insert'}
              </Typography>
            </Box>

            {/* 自动调度开关 (v1.6) */}
            <Box
              onClick={(e) => e.stopPropagation()}
              sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
              title={enabled ? '已启用自动调度' : '未启用自动调度'}
            >
              <Typography sx={{ color: enabled ? 'success.main' : 'text.secondary', fontSize: '0.6875rem' }}>
                自动
              </Typography>
              <Switch
                size="small"
                checked={enabled}
                onChange={(e) => handleToggle(task.id, e.target.checked)}
                inputProps={{ 'aria-label': '启用自动调度' }}
                sx={{
                  '& .MuiSwitch-switchBase.Mui-checked': { color: 'success.main' },
                  '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { backgroundColor: 'success.main' },
                }}
              />
            </Box>

            <Chip
              size="small"
              label={enabled === false ? '已停用' : mark.label}
              sx={{ height: 22, color: mark.color, bgcolor: `${mark.color}18` }}
            />
            <Button
              size="small"
              variant="contained"
              startIcon={<PlayArrowIcon />}
              disabled={!!runningTaskId}
              onClick={(e) => {
                e.stopPropagation();
                runTaskNow(task.id);
              }}
              sx={{
                minWidth: 92,
                fontSize: '0.6875rem',
                py: 0.5,
                bgcolor: isRunning ? 'action.disabledBackground' : 'primary.main',
                '&:hover': { bgcolor: isRunning ? 'action.disabledBackground' : 'primary.dark' },
              }}
            >
              {isRunning ? '运行中...' : '立即运行'}
            </Button>
            <ArrowForwardIcon sx={{ color: 'text.disabled', fontSize: '1.125rem' }} />
          </Box>

          {isRunning && progress && (
            <Box sx={{ mt: 1, pl: 4 }}>
              <Typography sx={{ color: 'primary.light', fontSize: '0.6875rem' }} noWrap>
                {progress.currentTable} ·{' '}
                {progress.status === 'running'
                  ? '执行中'
                  : progress.status === 'success'
                    ? '完成'
                    : '失败'}{' '}
                ({progress.mappingIndex + 1}/{progress.totalMappings})
              </Typography>
              <LinearProgress
                variant={progress.pct != null ? 'determinate' : 'indeterminate'}
                value={progress.pct || 0}
                sx={{
                  mt: 0.5,
                  height: 3,
                  borderRadius: 1,
                  bgcolor: 'action.disabledBackground',
                  '& .MuiLinearProgress-bar': { bgcolor: 'primary.main' },
                }}
              />
            </Box>
          )}

          {/* 下次自动运行时间 */}
          {nextRunText && (
            <Typography
              variant="caption"
              onClick={(e) => e.stopPropagation()}
              sx={{ display: 'block', mt: 0.75, pl: 4, color: 'text.secondary', fontSize: '0.6875rem' }}
            >
              {nextRunText}
            </Typography>
          )}
        </Box>
      );
    })}
  </Box>;
};

export default TaskListPanel;
