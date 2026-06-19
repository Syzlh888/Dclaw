/**
 * 软件激活页面
 * 流程：校验私钥 → 不通过展示获取本机指纹按钮 → 点击后变成激活码输入框
 * 同时展示作者微信二维码 + 端口配置
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Alert,
  CircularProgress,
  Divider,
  Chip,
  InputAdornment,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import DnsIcon from '@mui/icons-material/Dns';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import TimerOffIcon from '@mui/icons-material/TimerOff';
import type { LicenseStatus } from '../../App';



interface MachineInfo {
  macs: { name: string; mac: string }[];
  hostname: string;
  platform: string;
  fingerprint: string;
}

type Stage = 'init' | 'fingerprint';

interface ActivationPageProps {
  onActivated?: () => void;
  onStartTrial?: () => void;
  licenseStatus?: LicenseStatus | null;
}

const ActivationPage: React.FC<ActivationPageProps> = ({ onActivated, onStartTrial, licenseStatus }) => {
  const [machineInfo, setMachineInfo] = useState<MachineInfo | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [stage, setStage] = useState<Stage>('init');
  const [status, setStatus] = useState<'loading' | 'idle' | 'activating' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);

  // 端口配置
  const [appPort, setAppPort] = useState(3001);
  const [portInput, setPortInput] = useState('3001');
  const [portSaved, setPortSaved] = useState(false);
  const [portMessage, setPortMessage] = useState('');

  const api = (window as any).electronAPI;

  // 初始化：检测激活状态 & 加载机器信息 & 加载端口配置
  useEffect(() => {
    if (!api) {
      setStatus('error');
      setMessage('请在桌面客户端中运行');
      return;
    }

    // 加载端口配置
    api.getAppPort().then((p: number) => {
      setAppPort(p);
      setPortInput(String(p));
    });

    // 先检测是否已激活
    api.checkLicense().then((result: { activated: boolean }) => {
      if (result.activated) {
        // 已激活 → 通知父组件切换到主界面
        if (onActivated) {
          onActivated();
        } else {
          window.location.reload();
        }
        return;
      }
      // 未激活 → 加载机器信息
      setStatus('idle');
      api.getMachineInfo().then((info: MachineInfo) => {
        setMachineInfo(info);
      }).catch(() => {});
    }).catch(() => {
      setStatus('idle');
    });
  }, []);

  // 获取本机指纹
  const handleGetFingerprint = useCallback(async () => {
    if (!api || !machineInfo) {
      // 重新获取
      try {
        const info: MachineInfo = await api.getMachineInfo();
        setMachineInfo(info);
      } catch {
        setMessage('获取机器信息失败，请重试');
        return;
      }
    }
    setStage('fingerprint');
  }, [api, machineInfo]);

  // 复制指纹
  const handleCopyFingerprint = () => {
    if (machineInfo) {
      navigator.clipboard.writeText(machineInfo.fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 激活
  const handleActivate = useCallback(async () => {
    if (!licenseKey.trim()) {
      setMessage('请输入激活码');
      return;
    }
    setStatus('activating');
    setMessage('');
    try {
      const result = await api.validateLicense(licenseKey);
      if (result.valid) {
        setStatus('success');
        setMessage(result.message);
        // 用回调通知父组件切换，避免 reload 导致 React 渲染不一致崩溃
        setTimeout(() => {
          if (onActivated) {
            onActivated();
          } else {
            window.location.reload();
          }
        }, 1200);
      } else {
        setStatus('error');
        setMessage(result.message);
      }
    } catch {
      setStatus('error');
      setMessage('验证失败，请重试');
    }
  }, [licenseKey, api]);

  // 开始试用
  const handleTrialStart = useCallback(async () => {
    setStartingTrial(true);
    setMessage('');
    try {
      const result = await api.startTrial();
      if (result.success) {
        setStatus('success');
        setMessage('试用已开始（24小时），请及时激活软件');
        setTimeout(() => {
          if (onStartTrial) {
            onStartTrial();
          } else if (onActivated) {
            onActivated();
          } else {
            window.location.reload();
          }
        }, 1200);
      } else {
        setMessage(result.message || '试用启动失败');
        setStartingTrial(false);
      }
    } catch {
      setMessage('试用启动失败，请重试');
      setStartingTrial(false);
    }
  }, [api, onStartTrial, onActivated]);

  // 保存端口配置
  const handleSavePort = useCallback(async () => {
    const numPort = parseInt(portInput, 10);
    if (isNaN(numPort) || numPort < 1024 || numPort > 65535) {
      setPortMessage('端口范围：1024-65535');
      return;
    }
    try {
      const result = await api.setAppPort(numPort);
      if (result.success) {
        setAppPort(numPort);
        setPortSaved(true);
        setPortMessage('端口已保存，重启应用后生效');
      } else {
        setPortMessage(result.message || '保存失败');
      }
    } catch {
      setPortMessage('保存失败');
    }
  }, [portInput, api]);



  // 加载中
  if (status === 'loading') {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        bgcolor: '#f5f7fa',
        p: 2,
        pt: 2,
        pb: 3,
        overflowY: 'auto',
      }}
    >
      <Paper
        elevation={4}
        sx={{
          maxWidth: 680,
          width: '100%',
          p: 3,
          borderRadius: 3,
        }}
      >
        {/* 标题 */}
        <Box sx={{ textAlign: 'center', mb: 2 }}>
          <LockOutlinedIcon sx={{ fontSize: 36, color: 'primary.main', mb: 0.5 }} />
          <Typography variant="h5" fontWeight={700}>
            DClaw 数据钳
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {stage === 'init' ? '软件未激活，请联系作者获取授权' : '请输入作者提供的激活码'}
          </Typography>
        </Box>

        {/* 状态提示 */}
        {status === 'success' && (
          <Alert severity="success" sx={{ mb: 1.5 }}>{message}</Alert>
        )}
        {(status === 'error' || status === 'idle') && message && (
          <Alert severity="error" sx={{ mb: 1.5 }}>{message}</Alert>
        )}

        {/* 试用过期提示 */}
        {licenseStatus?.status === 'trial_expired' && (
          <Alert
            severity="warning"
            icon={<TimerOffIcon />}
            sx={{ mb: 2 }}
            action={
              <Button
                size="small"
                color="inherit"
                variant="outlined"
                onClick={() => (window as any).electronAPI?.resetLicense()?.then(() => window.location.reload())}
                sx={{ fontSize: '0.7rem' }}
              >
                重置试用
              </Button>
            }
          >
            <Typography variant="body2" fontWeight={600}>
              试用已过期
            </Typography>
            <Typography variant="caption">
              请立即联系作者获取激活码，激活后可继续使用。
            </Typography>
          </Alert>
        )}

        {/* 左右分栏：二维码 | 激活+端口 */}
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* 左侧：微信二维码（固定宽度） */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              minWidth: 200,
              flexShrink: 0,
              textAlign: 'center',
              bgcolor: '#fafafa',
              flex: { xs: '1 1 100%', md: '0 0 auto' },
            }}
          >
            <Typography variant="caption" fontWeight={600} color="text.secondary" gutterBottom display="block">
              微信扫码联系作者
            </Typography>
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <img
                src="/wechat-qr.png"
                alt="作者微信二维码"
                style={{ width: 140, height: 140, display: 'block', borderRadius: 8 }}
              />
            </Box>
          </Paper>

          {/* 右侧：激活区域 */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              flex: 1,
              minWidth: 260,
              bgcolor: '#fafafa',
            }}
          >
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              软件激活
            </Typography>

          {stage === 'init' ? (
            /* 阶段1：获取本机指纹 / 试用 */
            <Box sx={{ textAlign: 'center', mt: 1 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                点击按钮获取本机唯一指纹，发给作者换取激活码
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, maxWidth: 280, mx: 'auto' }}>
                <Button
                  variant="contained"
                  startIcon={<FingerprintIcon />}
                  onClick={handleGetFingerprint}
                  sx={{ fontWeight: 600, borderRadius: 2 }}
                >
                  获取本机指纹
                </Button>
                {licenseStatus?.status === 'trial_available' && (
                  <Button
                    variant="outlined"
                    color="secondary"
                    onClick={handleTrialStart}
                    disabled={startingTrial}
                    sx={{ fontWeight: 600, borderRadius: 2 }}
                  >
                    {startingTrial ? (
                      <CircularProgress size={18} sx={{ mr: 1 }} />
                    ) : null}
                    暂不注册，试用24小时
                  </Button>
                )}
              </Box>
            </Box>
          ) : (
            /* 阶段2：显示指纹 + 输入激活码 */
            <Box>
              {/* 机器指纹展示 */}
              <Typography variant="caption" color="text.secondary" display="block" gutterBottom sx={{ mb: 0.5 }}>
                本机指纹（发送给作者）：
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8, mb: 1.2 }}>
                <Chip
                  icon={<FingerprintIcon />}
                  label={machineInfo?.fingerprint || '获取中...'}
                  color="primary"
                  variant="outlined"
                  sx={{
                    fontFamily: 'monospace',
                    fontSize: '0.78rem',
                    flex: 1,
                    '& .MuiChip-label': { overflow: 'hidden', textOverflow: 'ellipsis' },
                  }}
                />
                <Button
                  size="small"
                  startIcon={<ContentCopyIcon />}
                  onClick={handleCopyFingerprint}
                  variant="outlined"
                  sx={{ minWidth: 65, flexShrink: 0 }}
                >
                  {copied ? '已复制' : '复制'}
                </Button>
              </Box>

              {machineInfo?.macs && machineInfo.macs.length > 0 && (
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 0.3 }}>
                  网卡: {machineInfo.macs[0].mac} ({machineInfo.macs[0].name})
                </Typography>
              )}
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1.2 }}>
                主机名: {machineInfo?.hostname || '-'} | 系统: {machineInfo?.platform || '-'}
              </Typography>

              {/* 激活码输入 */}
              <TextField
                fullWidth
                size="small"
                placeholder="请输入作者提供的激活码"
                value={licenseKey}
                onChange={(e) => {
                  setLicenseKey(e.target.value);
                  setMessage('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleActivate()}
                sx={{ mb: 1 }}
                autoFocus
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <VpnKeyIcon fontSize="small" color="action" />
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                fullWidth
                variant="contained"
                onClick={handleActivate}
                disabled={status === 'activating' || !licenseKey.trim()}
                sx={{ fontWeight: 600, borderRadius: 2 }}
              >
                {status === 'activating' ? <CircularProgress size={20} sx={{ color: '#fff' }} /> : '验证并激活'}
              </Button>

              {/* 返回按钮 */}
              <Button
                fullWidth
                variant="text"
                size="small"
                onClick={() => { setStage('init'); setMessage(''); }}
                sx={{ mt: 0.5 }}
              >
                返回上一步
              </Button>
            </Box>
          )}
          </Paper>

          {/* 端口配置 */}
          <Paper
            variant="outlined"
            sx={{
              p: 2,
              flex: 1,
              minWidth: 260,
              bgcolor: '#fafafa',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <DnsIcon fontSize="small" color="action" />
              <Typography variant="subtitle2" fontWeight={600}>端口配置</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              服务端口被占用时可修改（需重启生效）
            </Typography>

            <Box sx={{ display: 'flex', gap: 0.8, mb: 0.5, alignItems: 'flex-start' }}>
              <TextField
                size="small"
                label="服务端口"
                value={portInput}
                onChange={(e) => {
                  setPortInput(e.target.value);
                  setPortSaved(false);
                  setPortMessage('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSavePort()}
                sx={{ flex: 1 }}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <DnsIcon fontSize="small" />
                    </InputAdornment>
                  ),
                }}
              />
              <Button
                variant="outlined"
                size="small"
                onClick={handleSavePort}
                disabled={String(appPort) === portInput && !portSaved}
                sx={{ flexShrink: 0, minWidth: 60, height: '36px' }}
              >
                {portSaved ? '已保存' : '保存'}
              </Button>
            </Box>

            {portMessage && (
              <Alert
                severity={portSaved ? 'info' : 'warning'}
                sx={{ mt: 0.5, '& .MuiAlert-message': { fontSize: '0.75rem' } }}
              >
                {portMessage}
                {portSaved && (
                  <Button
                    size="small"
                    startIcon={<RestartAltIcon />}
                    onClick={() => window.location.reload()}
                    sx={{ ml: 1, fontSize: '0.7rem' }}
                  >
                    重启
                  </Button>
                )}
              </Alert>
            )}

            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.2 }}>
              <Typography variant="caption" color="text.secondary">
                当前端口：<strong>{appPort}</strong>（HTTP &amp; API）
              </Typography>
            </Box>
          </Paper>
        </Box>
      </Paper>
    </Box>
  );
};

export default ActivationPage;
