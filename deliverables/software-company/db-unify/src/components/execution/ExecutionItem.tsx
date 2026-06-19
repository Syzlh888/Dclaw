import React from 'react';
import { Box, Typography, Tooltip, IconButton } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import TimerIcon from '@mui/icons-material/Timer';
import PushPinIcon from '@mui/icons-material/PushPin';
import { ExecutionStatus } from '../../types/execution';
import type { ExecutionTask } from '../../types/execution';
import { useResultStore } from '../../stores/resultStore';

interface ExecutionItemProps {
  task: ExecutionTask;
}

const ExecutionItem: React.FC<ExecutionItemProps> = ({ task }) => {
  const setSelectedDbId = useResultStore((s) => s.setSelectedDbId);
  const pinResult = useResultStore((s) => s.pinResult);
  const unpinResult = useResultStore((s) => s.unpinResult);
  const pinnedResults = useResultStore((s) => s.pinnedResults);

  const getStatusIcon = () => {
    switch (task.status) {
      case ExecutionStatus.Success:
        return <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />;
      case ExecutionStatus.Failed:
        return <ErrorIcon sx={{ fontSize: 18, color: 'error.main' }} />;
      case ExecutionStatus.Running:
        return <AutorenewIcon sx={{ fontSize: 18, color: 'info.main', animation: 'spin 1s linear infinite' }} />;
      case ExecutionStatus.Pending:
        return <HourglassEmptyIcon sx={{ fontSize: 18, color: 'text.disabled' }} />;
      case ExecutionStatus.Timeout:
        return <TimerIcon sx={{ fontSize: 18, color: 'warning.main' }} />;
      default:
        return null;
    }
  };

  const handleClickName = () => {
    if (task.status === ExecutionStatus.Success && task.dbConnectionId) {
      setSelectedDbId(task.dbConnectionId);
    }
  };

  const getRightContent = () => {
    switch (task.status) {
      case ExecutionStatus.Success:
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {task.preDbTypeName}
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {task.duration ? `${(task.duration / 1000).toFixed(1)}s` : ''}
            </Typography>
          </Box>
        );
      case ExecutionStatus.Failed:
      case ExecutionStatus.Timeout:
        return (
          <Tooltip title={task.errorMessage ?? ''}>
            <Typography variant="caption" sx={{ color: 'error.main', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {task.errorMessage}
            </Typography>
          </Tooltip>
        );
      case ExecutionStatus.Running:
        return (
          <Typography variant="caption" sx={{ color: 'info.main' }}>
            执行中...
          </Typography>
        );
      default:
        return null;
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        py: 0.5,
        px: 1,
        borderRadius: 0.5,
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {getStatusIcon()}

      {/* 连接实例（可点击跳转） */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flex: 1,
          cursor: task.status === ExecutionStatus.Success ? 'pointer' : 'default',
        }}
        onClick={handleClickName}
      >
        <Typography variant="body2" sx={{ fontSize: '0.85rem' }}>
          {task.hospitalName}
        </Typography>
        {task.status === ExecutionStatus.Success && (
          <Typography
            variant="caption"
            sx={{
              color: task.result && task.result.totalRows > 0 ? 'success.main' : 'text.disabled',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <Box
              component="span"
              sx={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                display: 'inline-block',
                bgcolor: task.result && task.result.totalRows > 0 ? 'success.main' : 'text.disabled',
              }}
            />
            {task.result && task.result.totalRows > 0 ? `${task.result.totalRows} 行` : '无数据'}
          </Typography>
        )}
      </Box>

      <Box sx={{ ml: 'auto' }}>{getRightContent()}</Box>

      {/* Pin button for successful results */}
      {task.status === ExecutionStatus.Success && task.dbConnectionId && (
        <Tooltip title={pinnedResults[task.dbConnectionId] ? '已钉选' : '钉选结果'}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              if (pinnedResults[task.dbConnectionId!]) {
                unpinResult(task.dbConnectionId!);
              } else {
                pinResult(task.dbConnectionId!);
              }
            }}
            sx={{ p: 0.25, ml: 0.5 }}
          >
            <PushPinIcon
              sx={{
                fontSize: 14,
                color: pinnedResults[task.dbConnectionId!] ? 'primary.main' : 'text.disabled',
              }}
            />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  );
};

export default ExecutionItem;
