import React from 'react';
import {
  Box, Typography, IconButton, Tooltip, Chip,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { useExecutionStore } from '../../stores/executionStore';

const SqlViewPanel: React.FC = () => {
  const currentSql = useExecutionStore((s) => s.currentSql);
  const currentConnections = useExecutionStore((s) => s.currentConnections);
  const tasks = useExecutionStore((s) => s.tasks);

  const hasData = currentSql && currentConnections.length > 0;

  const handleCopySql = (sql: string) => {
    navigator.clipboard.writeText(sql);
  };

  // 获取任务状态显示
  const getTaskStatus = (connId: string) => {
    const task = tasks.find(t => t.dbConnectionId === connId);
    if (!task) return null;
    const statusMap: Record<string, { label: string; color: any }> = {
      pending: { label: '等待中', color: 'default' },
      running: { label: '执行中', color: 'info' },
      success: { label: '成功', color: 'success' },
      failed: { label: '失败', color: 'error' },
      timeout: { label: '超时', color: 'warning' },
    };
    const s = statusMap[task.status];
    return s ? <Chip label={s.label} size="small" color={s.color as any} variant="outlined" sx={{ fontSize: '0.58rem', height: 16 }} /> : null;
  };

  if (!hasData) {
    return (
      <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography variant="caption" color="text.disabled">暂无执行记录</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* SQL 原文 */}
      <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>执行的 SQL</Typography>
          <Tooltip title="复制 SQL">
            <IconButton size="small" onClick={() => handleCopySql(currentSql)} sx={{ p: 0.25 }}>
              <ContentCopyIcon sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
        </Box>
        <Typography variant="caption" sx={{ fontSize: '0.72rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.5 }}>
          {currentSql}
        </Typography>
      </Box>

      {/* 各连接执行详情 */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, py: 1 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
          目标连接 ({currentConnections.length})
        </Typography>
        {currentConnections.map((conn) => {
          const statusChip = getTaskStatus(conn.id);
          const schemaSql = conn.schema
            ? `-- Schema: ${conn.schema}\nSET search_path TO "${conn.schema}", public;\n\n${currentSql}`
            : currentSql;

          return (
            <Box key={conn.id} sx={{ mb: 1.5, p: 1, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.72rem' }}>{conn.hospitalName}</Typography>
                {conn.preDbTypeName && <Chip label={conn.preDbTypeName} size="small" variant="outlined" sx={{ fontSize: '0.55rem', height: 16 }} />}
                {statusChip}
                {conn.schema && <Chip label={`schema: ${conn.schema}`} size="small" color="info" variant="outlined" sx={{ fontSize: '0.55rem', height: 16 }} />}
                <Tooltip title="复制此连接的 SQL">
                  <IconButton size="small" onClick={() => handleCopySql(schemaSql)} sx={{ p: 0.25, ml: 'auto' }}>
                    <ContentCopyIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                </Tooltip>
              </Box>
              <Typography variant="caption" sx={{ fontSize: '0.65rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', lineHeight: 1.4 }}>
                {schemaSql}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
};

export default SqlViewPanel;
