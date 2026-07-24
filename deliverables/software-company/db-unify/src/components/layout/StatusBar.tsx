import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTreeStore } from '../../stores/treeStore';
import { useEditorStore } from '../../stores/editorStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useExecutionStore } from '../../stores/executionStore';
import { ConnectionStatus } from '../../types/connection';

const StatusBar: React.FC = () => {
  useTreeStore((s) => s.nodes);
  const tabDbIds = useEditorStore((s) => s.tabDbIds);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const connections = useConnectionStore((s) => s.connections);
  const tasks = useExecutionStore((s) => s.tasks);
  const stats = useExecutionStore((s) => s.executionStats);

  const onlineCount = Object.values(connections).filter(
    (c) => c.status === ConnectionStatus.Online
  ).length;
  const totalCount = Object.keys(connections).length;

  const lastDuration = tasks.length > 0
    ? tasks
        .filter((t) => t.duration)
        .reduce((max, t) => Math.max(max, t.duration ?? 0), 0)
    : null;

  return (
    <Box
      sx={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 2,
        bgcolor: 'background.default',
        borderTop: '1px solid',
        borderColor: 'divider',
        flexShrink: 0,
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        连接 {onlineCount}/{totalCount}
      </Typography>
      {lastDuration !== null && (
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          耗时: {(lastDuration / 1000).toFixed(1)}s
        </Typography>
      )}
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        选中: {(tabDbIds[activeTabId] || []).length} 库
      </Typography>
      {stats.totalCount > 0 && (
        <>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            成功率: {stats.totalCount > 0 ? Math.round((stats.successCount / Math.max(1, stats.successCount + stats.failCount)) * 100) : 0}%
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            总执行: {stats.totalCount}次
          </Typography>
        </>
      )}
    </Box>
  );
};

export default StatusBar;
