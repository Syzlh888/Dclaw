import React, { useState } from 'react';
import { Box, Typography, Tooltip } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import VerifiedIcon from '@mui/icons-material/Verified';
import TimerIcon from '@mui/icons-material/Timer';
import { useTreeStore } from '../../stores/treeStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useExecutionStore } from '../../stores/executionStore';
import { ConnectionStatus } from '../../types/connection';
import LicenseDialog from './LicenseDialog';
import type { LicenseStatus } from '../../App';

interface StatusBarProps {
  licenseStatus: LicenseStatus | null;
  isElectron: boolean;
  onShowActivation: () => void;
}

const StatusBar: React.FC<StatusBarProps> = ({ licenseStatus, isElectron, onShowActivation }) => {
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const nodes = useTreeStore((s) => s.nodes);
  const selectedDbIds = useTreeStore((s) => s.selectedDbIds);
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

  // 渲染授权状态（可点击）
  const renderLicenseBadge = () => {
    if (!isElectron || !licenseStatus) return null;

    if (licenseStatus.status === 'activated') {
      const tooltip = licenseStatus.isPermanent
        ? '已激活 · 永久有效（点击查看详情）'
        : `已激活 · 有效期至 ${licenseStatus.expiryDate?.split('T')[0] || '未知'}（点击查看详情）`;
      const color = licenseStatus.isPermanent
        ? '#388E3C'
        : (licenseStatus.daysLeft !== null && licenseStatus.daysLeft <= 7 ? '#F57C00' : '#388E3C');

      return (
        <Tooltip title={tooltip}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto', cursor: 'pointer',
              '&:hover': { opacity: 0.8 } }}
            onClick={() => setLicenseDialogOpen(true)}
          >
            <VerifiedIcon sx={{ fontSize: 14, color }} />
            <Typography variant="caption" sx={{ color, fontWeight: 500, userSelect: 'none' }}>
              {licenseStatus.statusText}
            </Typography>
          </Box>
        </Tooltip>
      );
    }

    if (licenseStatus.status === 'trial') {
      const hoursLeft = licenseStatus.hoursLeft ?? 0;
      const minsLeft = licenseStatus.minsLeft ?? 0;
      let label = `试用 · ${hoursLeft}小时剩余`;
      if (hoursLeft === 0) label = `试用 · ${minsLeft}分钟剩余`;
      const color = hoursLeft < 4 ? '#D32F2F' : hoursLeft < 12 ? '#F57C00' : '#1976D2';

      return (
        <Tooltip title={`试用将于 ${licenseStatus.trialEnd?.split('.')[0]?.replace('T', ' ')} 到期（点击查看详情）`}>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto', cursor: 'pointer',
              '&:hover': { opacity: 0.8 } }}
            onClick={() => setLicenseDialogOpen(true)}
          >
            <TimerIcon sx={{ fontSize: 14, color }} />
            <Typography variant="caption" sx={{ color, fontWeight: 500, userSelect: 'none' }}>
              {label}
            </Typography>
          </Box>
        </Tooltip>
      );
    }

    return (
      <Tooltip title="未激活，请立即激活以免试用到期后无法使用（点击查看详情）">
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 'auto', cursor: 'pointer',
            '&:hover': { opacity: 0.8 } }}
          onClick={() => setLicenseDialogOpen(true)}
        >
          <LockIcon sx={{ fontSize: 14, color: '#D32F2F' }} />
          <Typography variant="caption" sx={{ color: '#D32F2F', fontWeight: 500, userSelect: 'none' }}>
            {licenseStatus.statusText}
          </Typography>
        </Box>
      </Tooltip>
    );
  };

  return (
    <>
      <Box
        sx={{
          height: 28,
          display: 'flex',
          alignItems: 'center',
          gap: 3,
          px: 2,
          bgcolor: '#E0E0E0',
          borderTop: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          已连接 {onlineCount}/{totalCount} 库 · 选中 {selectedDbIds.length} 库
        </Typography>
        {lastDuration !== null && (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            上次执行: {(lastDuration / 1000).toFixed(1)}s
          </Typography>
        )}
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

        {/* 授权状态（靠右，可点击） */}
        {renderLicenseBadge()}
      </Box>

      {/* 授权详情弹窗 */}
      <LicenseDialog
        open={licenseDialogOpen}
        onClose={() => setLicenseDialogOpen(false)}
        licenseStatus={licenseStatus}
        onShowActivation={onShowActivation}
      />
    </>
  );
};

export default StatusBar;
