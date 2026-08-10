import React, { useEffect } from 'react';
import { Box, Button, Chip, Typography, Tooltip, CircularProgress } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useProxyStore } from '../../stores/proxyStore';

const ProxyStatusBar: React.FC = () => {
  const { processStatus, processLoading, processError, loadProcessStatus, startProcess, stopProcess, restartProcess } =
    useProxyStore();

  useEffect(() => {
    loadProcessStatus();
    const iv = setInterval(loadProcessStatus, 8000);
    return () => clearInterval(iv);
  }, [loadProcessStatus]);

  const running = processStatus?.running;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.5,
        py: 0.5,
        bgcolor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        minHeight: 28,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: running ? 'success.main' : 'error.main',
          }}
        />
        <Typography sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
          代理网关：{running ? '运行中' : '已停止'}
        </Typography>
      </Box>

      {processStatus?.running && (
        <Chip
          size="small"
          label={`PID ${processStatus.pid} · 监听 ${processStatus.listeningPorts?.length || 0} 端口 · 活跃 ${processStatus.activeCount ?? 0}/${processStatus.totalActive ?? 0}`}
          sx={{ height: 20, fontSize: '0.65rem', bgcolor: 'action.disabledBackground', color: 'text.secondary' }}
        />
      )}

      <Box sx={{ flex: 1 }} />

      {processError && (
        <Typography sx={{ color: 'error.main', fontSize: '0.65rem' }}>{processError}</Typography>
      )}

      <Tooltip title="启动代理网关进程">
        <span>
          <Button
            size="small"
            variant="text"
            startIcon={<PlayArrowIcon sx={{ fontSize: 14 }} />}
            onClick={startProcess}
            disabled={processLoading || !!running}
            sx={{ color: running ? 'text.disabled' : 'success.main', textTransform: 'none', fontSize: '0.75rem' }}
          >
            启动
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="停止代理网关进程">
        <span>
          <Button
            size="small"
            variant="text"
            startIcon={<StopIcon sx={{ fontSize: 14 }} />}
            onClick={stopProcess}
            disabled={processLoading || !running}
            sx={{ color: running ? 'error.main' : 'text.disabled', textTransform: 'none', fontSize: '0.75rem' }}
          >
            停止
          </Button>
        </span>
      </Tooltip>
      <Tooltip title="重启代理网关进程">
        <span>
          <Button
            size="small"
            variant="text"
            startIcon={processLoading ? <CircularProgress size={12} /> : <RestartAltIcon sx={{ fontSize: 14 }} />}
            onClick={restartProcess}
            disabled={processLoading}
            sx={{ color: 'primary.main', textTransform: 'none', fontSize: '0.75rem' }}
          >
            重启
          </Button>
        </span>
      </Tooltip>
    </Box>
  );
};

export default ProxyStatusBar;
