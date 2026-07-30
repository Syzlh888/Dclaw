/**
 * 导出执行进度（SSE）
 */
import React from 'react';
import {
  Box,
  LinearProgress,
  Typography,
  Alert,
  Button,
} from '@mui/material';
import { useExportStore } from '../../stores/exportStore';

interface ExportProgressProps {
  onClose: () => void;
  onCancel: () => void;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec} 秒`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min} 分 ${s} 秒`;
}

export const ExportProgress: React.FC<ExportProgressProps> = ({
  onClose,
  onCancel,
}) => {
  const progress = useExportStore((s) => s.progress);
  const result = useExportStore((s) => s.result);
  const errorMessage = useExportStore((s) => s.errorMessage);
  const mode = useExportStore((s) => s.mode);

  return (
    <Box sx={{ pt: 1, minHeight: 180 }}>
      {mode === 'executing' && (
        <>
          <Typography variant="subtitle2" sx={{ mb: 2, color: '#BBBBBB' }}>
            导出进行中…
          </Typography>
          <LinearProgress
            variant="determinate"
            value={progress.pct}
            sx={{
              mb: 2,
              height: 8,
              borderRadius: 1,
              '& .MuiLinearProgress-bar': { bgcolor: '#5A5A5A' },
            }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" sx={{ color: '#BBBBBB' }}>
              {progress.processedRows.toLocaleString()} /{' '}
              {(progress.totalRows || 0).toLocaleString()} 行
            </Typography>
            <Typography variant="caption" sx={{ color: '#BBBBBB' }}>
              {progress.pct}%
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="caption" sx={{ color: '#BBBBBB' }}>
              速率 {Math.round(progress.speed).toLocaleString()} 行/秒
            </Typography>
            <Typography variant="caption" sx={{ color: '#BBBBBB' }}>
              剩余 {formatMs(progress.eta)}
            </Typography>
          </Box>
          <Button color="error" onClick={onCancel}>
            取消
          </Button>
        </>
      )}

      {mode === 'done' && result && (
        <Box>
          <Alert severity="success" sx={{ mb: 2 }}>
            导出成功完成！
          </Alert>
          <Box sx={{ mb: 2, color: '#BBBBBB' }}>
            <Typography variant="body2">
              📊 总行数: <b>{result.totalRows.toLocaleString()}</b>
            </Typography>
            <Typography variant="body2">
              ⏱ 耗时: <b>{formatMs(result.durationMs)}</b>
            </Typography>
            {result.filePath && (
              <Typography variant="body2">
                ⬇ 已下载文件: <code style={{ color: '#DAAA4E' }}>{result.filePath}</code>
              </Typography>
            )}
            {result.tableName && (
              <Typography variant="body2">
                🗄 目标表: <code style={{ color: '#DAAA4E' }}>{result.tableName}</code>
              </Typography>
            )}
          </Box>
          <Button variant="contained" onClick={onClose} sx={{ mt: 1 }}>
            完成
          </Button>
        </Box>
      )}

      {mode === 'error' && (
        <Box>
          <Alert severity="error" sx={{ mb: 2 }}>
            {errorMessage || '导出失败'}
          </Alert>
          <Button onClick={onClose}>关闭</Button>
        </Box>
      )}
    </Box>
  );
};
