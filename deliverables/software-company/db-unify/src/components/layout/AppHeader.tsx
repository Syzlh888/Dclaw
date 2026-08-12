import React, { useState, useEffect } from 'react';
import { Box, Typography, IconButton, Tooltip, Button, Menu, MenuItem, ListItemIcon, ListItemText, Divider } from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import ApiIcon from '@mui/icons-material/Api';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import LightModeIcon from '@mui/icons-material/LightMode';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import LogoutIcon from '@mui/icons-material/Logout';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import CodeIcon from '@mui/icons-material/Code';
import LanIcon from '@mui/icons-material/Lan';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import LockIcon from '@mui/icons-material/Lock';
import SettingsIcon from '@mui/icons-material/Settings';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import { useThemeMode } from '../../contexts/ThemeModeContext';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import HelpGuide from './HelpGuide';
import BackupDialog from '../backup/BackupDialog';
import ConnectionDialog from '../connection/ConnectionDialog';
import DriverManager from '../driver/DriverManager';
import SystemConfigDialog from '../server-resource/SystemConfigDialog';
import AccessManagementDialog from '../server-resource/AccessManagementDialog';
import UserManagementDialog from '../settings/UserManagementDialog';
import RoleManagementDialog from '../settings/RoleManagementDialog';
import ProfileDialog from '../settings/ProfileDialog';
// SyncPage 已改为独立页面，在 App.tsx 中渲染
import GroupIcon from '@mui/icons-material/Group';
import ShieldIcon from '@mui/icons-material/Shield';
import AccountCircleIcon from '@mui/icons-material/AccountCircle';
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts';

const SCALE_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5];

type NavigableView = 'sql-editor' | 'server-resource' | 'comprehensive-query' | 'data-sync' | 'db-proxy' | 'api-service';

interface Props {
  mainView?: string;
  onNavigate?: (view: NavigableView) => void;
  onToggleAI?: () => void;
}

const AppHeader: React.FC<Props> = ({ mainView, onNavigate, onToggleAI }) => {
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
  const [userMgmtOpen, setUserMgmtOpen] = useState(false);
  const [roleMgmtOpen, setRoleMgmtOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  // 数据同步已改为独立页面
  const [settingsAnchor, setSettingsAnchor] = useState<null | HTMLElement>(null);

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
  const isComprehensiveQuery = mainView === 'comprehensive-query';
  const isDataSync = mainView === 'data-sync';

  return (
    <Box
      sx={(theme) => ({
        height: 40,
        display: 'flex',
        alignItems: 'center',
        px: 2,
        bgcolor: theme.palette.mode === 'dark' ? '#1a1d23' : '#0d47a1',
        color: 'white',
        flexShrink: 0,
        boxShadow: 1,
      })}
    >
      {/* Logo */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <StorageIcon sx={{ fontSize: 'calc(1.75rem * var(--dc-scale, 1))' }} />
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: 'calc(1rem * var(--dc-scale, 1))', letterSpacing: 0.5 }}>
          DClaw 数据钳
        </Typography>
      </Box>

      {/* 三个主视图页签：SQL编辑器 / 服务器资源管理 / 数据同步 */}
      <Box sx={{ display: 'flex', gap: 0.5, ml: 2 }}>
        {([
          { id: 'sql-editor' as const, label: 'SQL编辑器', icon: <CodeIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /> },
          { id: 'server-resource' as const, label: '服务器资源管理', icon: <LanIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /> },
          { id: 'data-sync' as const, label: '数据同步', icon: <SyncAltIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /> },
          { id: 'db-proxy' as const, label: '数据库代理', icon: <StorageIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /> },
          { id: 'api-service' as const, label: 'API服务', icon: <ApiIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /> },
        ] as const).map((tab) => {
          const active = mainView === tab.id || (mainView === 'comprehensive-query' && tab.id === 'server-resource');
          return (
            <Button
              key={tab.id}
              size="small"
              startIcon={tab.icon}
              onClick={() => onNavigate?.(tab.id)}
              sx={{
                textTransform: 'none',
                fontSize: 'calc(0.78rem * var(--dc-scale, 1))',
                px: 1.2,
                py: 0.25,
                minHeight: 26,
                borderRadius: 1,
                bgcolor: active ? 'rgba(255,255,255,0.25)' : 'transparent',
                color: active ? '#FFF' : 'rgba(255,255,255,0.7)',
                border: active ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent',
                fontWeight: active ? 600 : 400,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.15)', color: '#FFF' },
              }}
            >
              {tab.label}
            </Button>
          );
        })}
      </Box>

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
            fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
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
              display: 'none', // 已迁移至左侧树顶部工具栏，此入口隐藏
              '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' },
            }}
          >
            连接管理
          </Button>
        </>
      )}

      {/* 服务器资源 & 综合查询视图：综合查询按钮 */}
      {(isServerResource || isComprehensiveQuery) && (
        <Button
          size="small"
          startIcon={<AnalyticsIcon />}
          onClick={() => onNavigate?.('comprehensive-query')}
          variant={isComprehensiveQuery ? 'contained' : 'outlined'}
          sx={{
            color: isComprehensiveQuery ? 'primary.main' : 'white',
            borderColor: 'rgba(255,255,255,0.4)',
            textTransform: 'none',
            mr: 0.5,
            bgcolor: isComprehensiveQuery ? 'white' : 'transparent',
            '&:hover': {
              borderColor: 'white',
              bgcolor: isComprehensiveQuery ? '#f0f0f0' : 'rgba(255,255,255,0.1)',
            },
          }}
        >
          综合查询
        </Button>
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



      {/* 数据同步入口 — 同级别页面 */}

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
      <Tooltip title="设置">
        <IconButton onClick={(e) => setSettingsAnchor(e.currentTarget)} sx={{ color: 'white', ml: 0.5 }} size="small">
          <ManageAccountsIcon />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={settingsAnchor}
        open={!!settingsAnchor}
        onClose={() => setSettingsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={() => { setProfileOpen(true); setSettingsAnchor(null); }}>
          <ListItemIcon><AccountCircleIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="个人资料" secondary={authUser?.username || undefined} />
        </MenuItem>
        <Divider />
        <MenuItem onClick={() => { setUserMgmtOpen(true); setSettingsAnchor(null); }}>
          <ListItemIcon><GroupIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="用户管理" />
        </MenuItem>
        <MenuItem onClick={() => { setRoleMgmtOpen(true); setSettingsAnchor(null); }}>
          <ListItemIcon><ShieldIcon fontSize="small" /></ListItemIcon>
          <ListItemText primary="角色与权限" />
        </MenuItem>
      </Menu>
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
      <UserManagementDialog open={userMgmtOpen} onClose={() => setUserMgmtOpen(false)} />
      <RoleManagementDialog open={roleMgmtOpen} onClose={() => setRoleMgmtOpen(false)} />
      <ProfileDialog open={profileOpen} onClose={() => setProfileOpen(false)} />

    </Box>
  );
};

export default AppHeader;
