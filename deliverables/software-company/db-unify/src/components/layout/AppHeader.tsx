import React, { useState, useEffect } from 'react';
import { Box, Typography, IconButton, Tooltip, Button } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import LogoutIcon from '@mui/icons-material/Logout';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import AssessmentIcon from '@mui/icons-material/Assessment';
import CodeIcon from '@mui/icons-material/Code';
import LanIcon from '@mui/icons-material/Lan';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import LockIcon from '@mui/icons-material/Lock';
import SettingsIcon from '@mui/icons-material/Settings';
import { useThemeMode } from '../../contexts/ThemeModeContext';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import HelpGuide from './HelpGuide';
import BackupDialog from '../backup/BackupDialog';
import ConnectionDialog from '../connection/ConnectionDialog';
import DriverManager from '../driver/DriverManager';
import SystemConfigDialog from '../server-resource/SystemConfigDialog';
import AccessManagementDialog from '../server-resource/AccessManagementDialog';

const SCALE_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5];

interface Props {
  mainView?: string;
  onNavigate?: (view: 'sql-editor' | 'server-resource' | 'asset-summary') => void;
}

const AppHeader: React.FC<Props> = ({ mainView, onNavigate }) => {
  const { mode, toggleTheme, scale, setScale } = useThemeMode();
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const loadDrivers = useDriverStore((s) => s.loadDrivers);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [connDialogOpen, setConnDialogOpen] = useState(false);
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [accessDialogOpen, setAccessDialogOpen] = useState(false);

  useEffect(() => {
    loadDrivers();
  }, [loadDrivers]);

  const handleZoomOut = () => {
    const idx = SCALE_STEPS.indexOf(scale);
    if (idx > 0) setScale(SCALE_STEPS[idx - 1]);
  };

  const handleZoomIn = () => {
    const idx = SCALE_STEPS.indexOf(scale);
    if (idx < SCALE_STEPS.length - 1) setScale(SCALE_STEPS[idx + 1]);
  };

  const scalePercent = Math.round(scale * 100);

  const isSqlEditor = mainView === 'sql-editor';
  const isServerResource = mainView === 'server-resource';
  const isAssetSummary = mainView === 'asset-summary';

  return (
    <Box
      sx={{
        height: 48,
        display: 'flex',
        alignItems: 'center',
        px: 2,
        bgcolor: 'primary.main',
        color: 'white',
        flexShrink: 0,
        boxShadow: 1,
      }}
    >
      {/* Logo */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorageIcon sx={{ fontSize: 28 }} />
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1rem', letterSpacing: 0.5 }}>
          DClaw 数据钳
        </Typography>
      </Box>

      {/* 视图切换按钮 */}
      {mainView !== undefined && (
        <Button
          size="small"
          onClick={() => onNavigate?.(isSqlEditor ? 'server-resource' : 'sql-editor')}
          sx={{
            textTransform: 'none',
            fontSize: '0.8rem',
            px: 1.5,
            py: 0.5,
            minHeight: 30,
            borderRadius: 1,
            ml: 2,
            bgcolor: 'rgba(255,255,255,0.15)',
            color: 'white',
            '&:hover': { bgcolor: 'rgba(255,255,255,0.25)' },
          }}
        >
          <CodeIcon sx={{ fontSize: 16, mr: 0.5 }} />
          <Typography component="span" sx={{ fontSize: 'inherit', fontWeight: 500 }}>
            {isSqlEditor ? '服务器资源管理' : 'SQL编辑器'}
          </Typography>
        </Button>
      )}

      <Box sx={{ flex: 1 }} />

      {/* 缩放控制 */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 1 }}>
        <Tooltip title="缩小">
          <span>
            <IconButton
              onClick={handleZoomOut}
              disabled={scale <= SCALE_STEPS[0]}
              sx={{ color: 'white', opacity: scale <= SCALE_STEPS[0] ? 0.4 : 1 }}
              size="small"
            >
              <ZoomOutIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{
            minWidth: 36,
            textAlign: 'center',
            fontWeight: 600,
            fontSize: '0.75rem',
            userSelect: 'none',
          }}
        >
          {scalePercent}%
        </Typography>
        <Tooltip title="放大">
          <span>
            <IconButton
              onClick={handleZoomIn}
              disabled={scale >= SCALE_STEPS[SCALE_STEPS.length - 1]}
              sx={{ color: 'white', opacity: scale >= SCALE_STEPS[SCALE_STEPS.length - 1] ? 0.4 : 1 }}
              size="small"
            >
              <ZoomInIcon fontSize="small" />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* SQL编辑器视图：驱动管理 + 连接管理 */}
      {isSqlEditor && (
        <>
          <Button
            size="small"
            startIcon={<SettingsInputComponentIcon />}
            onClick={() => setDriverDialogOpen(true)}
            variant="outlined"
            sx={{
              color: 'white',
              borderColor: 'rgba(255,255,255,0.4)',
              textTransform: 'none',
              mr: 0.5,
              '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' },
            }}
          >
            驱动管理
          </Button>
          <Button
            size="small"
            startIcon={<LanIcon />}
            onClick={() => setConnDialogOpen(true)}
            variant="outlined"
            sx={{
              color: 'white',
              borderColor: 'rgba(255,255,255,0.4)',
              textTransform: 'none',
              mr: 0.5,
              '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' },
            }}
          >
            连接管理
          </Button>
        </>
      )}

      {/* 服务器资源视图：访问管理 + 二次密码 */}
      {isServerResource && (
        <>
          <Button
            size="small"
            startIcon={<LockIcon />}
            onClick={() => setAccessDialogOpen(true)}
            variant="outlined"
            sx={{
              color: 'white',
              borderColor: 'rgba(255,255,255,0.4)',
              textTransform: 'none',
              mr: 0.5,
              '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' },
            }}
          >
            访问管理
          </Button>
          <Button
            size="small"
            startIcon={<SettingsIcon />}
            onClick={() => setConfigDialogOpen(true)}
            variant="outlined"
            sx={{
              color: 'white',
              borderColor: 'rgba(255,255,255,0.4)',
              textTransform: 'none',
              mr: 0.5,
              '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' },
            }}
          >
            二次密码
          </Button>
        </>
      )}

      {/* 资产汇总 - 非服务器资源视图显示 */}
      {mainView !== undefined && !isServerResource && (
        <Button
          size="small"
          startIcon={<AssessmentIcon />}
          onClick={() => onNavigate?.('asset-summary')}
          variant={isAssetSummary ? 'contained' : 'outlined'}
          sx={{
            color: isAssetSummary ? 'primary.main' : 'white',
            borderColor: 'rgba(255,255,255,0.4)',
            textTransform: 'none',
            mr: 0.5,
            bgcolor: isAssetSummary ? 'white' : 'transparent',
            '&:hover': {
              borderColor: 'white',
              bgcolor: isAssetSummary ? '#f0f0f0' : 'rgba(255,255,255,0.1)',
            },
          }}
        >
          资产汇总
        </Button>
      )}

      {/* 备份管理 */}
      <Button
        size="small"
        startIcon={<SettingsBackupRestoreIcon />}
        onClick={() => setBackupDialogOpen(true)}
        variant="outlined"
        sx={{
          color: 'white',
          borderColor: 'rgba(255,255,255,0.4)',
          textTransform: 'none',
          mr: 0.5,
          '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' },
        }}
      >
        备份管理
      </Button>

      <Tooltip title={mode === 'dark' ? '切换亮色模式' : '切换暗色模式'}>
        <IconButton onClick={toggleTheme} sx={{ color: 'white' }} size="small">
          {mode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
        </IconButton>
      </Tooltip>
      <Tooltip title="操作指南">
        <IconButton onClick={() => setHelpOpen(true)} sx={{ color: 'white', ml: 0.5 }} size="small">
          <HelpOutlineIcon />
        </IconButton>
      </Tooltip>
      {authUser && (
        <Tooltip title="退出登录">
          <IconButton onClick={logout} sx={{ color: 'white', ml: 0.5 }} size="small">
            <LogoutIcon />
          </IconButton>
        </Tooltip>
      )}

      {/* Dialogs */}
      <HelpGuide open={helpOpen} onClose={() => setHelpOpen(false)} />
      <BackupDialog open={backupDialogOpen} onClose={() => setBackupDialogOpen(false)} />
      <ConnectionDialog open={connDialogOpen} onClose={() => setConnDialogOpen(false)} />
      <DriverManager open={driverDialogOpen} onClose={() => setDriverDialogOpen(false)} />
      <SystemConfigDialog open={configDialogOpen} onClose={() => setConfigDialogOpen(false)} />
      <AccessManagementDialog open={accessDialogOpen} onClose={() => setAccessDialogOpen(false)} />
    </Box>
  );
};

export default AppHeader;
