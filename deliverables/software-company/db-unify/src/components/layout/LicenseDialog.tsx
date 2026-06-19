/**
 * 授权详情弹窗
 * 点击右下角状态栏的激活信息时弹出
 * 显示详细授权信息 + 重新激活入口
 */
import React, { useEffect, useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Divider,
  Chip,
  Alert,
  TextField,
  CircularProgress,
  InputAdornment,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import TimerIcon from '@mui/icons-material/Timer';
import LockIcon from '@mui/icons-material/Lock';
import TimerOffIcon from '@mui/icons-material/TimerOff';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import type { LicenseStatus } from '../../App';

interface MachineInfo {
  macs: { name: string; mac: string }[];
  hostname: string;
  platform: string;
  fingerprint: string;
}

interface LicenseDialogProps {
  open: boolean;
  onClose: () => void;
  licenseStatus: LicenseStatus | null;
  onShowActivation: () => void;
}

const LicenseDialog: React.FC<LicenseDialogProps> = ({
  open,
  onClose,
  licenseStatus,
  onShowActivation,
}) => {
  const [machineInfo, setMachineInfo] = useState<MachineInfo | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);
  const [msg, setMsg] = useState<{ text: string; severity: 'success' | 'error' | 'info' } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showActivateForm, setShowActivateForm] = useState(false);

  const api = (window as any).electronAPI;

  // 加载机器信息
  useEffect(() => {
    if (open && api?.getMachineInfo) {
      api.getMachineInfo().then((info: MachineInfo) => setMachineInfo(info)).catch(() => {});
    }
  }, [open]);

  // 复制指纹
  const handleCopyFingerprint = () => {
    if (machineInfo) {
      navigator.clipboard.writeText(machineInfo.fingerprint);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 重新激活
  const handleReactivate = useCallback(async () => {
    if (!licenseKey.trim()) {
      setMsg({ text: '请输入激活码', severity: 'error' });
      return;
    }
    setActivating(true);
    setMsg(null);
    try {
      const result = await api.validateLicense(licenseKey);
      if (result.valid) {
        setMsg({ text: '激活成功！应用将刷新', severity: 'success' });
        setTimeout(() => {
          onClose();
          onShowActivation();
          // 短暂延迟后重新进入主界面
          setTimeout(() => window.location.reload(), 300);
        }, 1000);
      } else {
        setMsg({ text: result.message, severity: 'error' });
      }
    } catch {
      setMsg({ text: '验证失败，请重试', severity: 'error' });
    } finally {
      setActivating(false);
    }
  }, [licenseKey, api, onClose, onShowActivation]);

  if (!licenseStatus) return null;

  const isActivated = licenseStatus.status === 'activated';
  const isTrial = licenseStatus.status === 'trial';
  const isExpired = licenseStatus.status === 'trial_expired';

  // 状态图标和颜色
  const statusConfig = isActivated
    ? { icon: <VerifiedIcon />, color: '#388E3C', label: '已激活' }
    : isTrial
    ? { icon: <TimerIcon />, color: '#1976D2', label: '试用中' }
    : { icon: <LockIcon />, color: '#D32F2F', label: '未激活' };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          icon={statusConfig.icon}
          label={statusConfig.label}
          size="small"
          sx={{ color: statusConfig.color, borderColor: statusConfig.color, fontWeight: 600 }}
          variant="outlined"
        />
        <Typography variant="h6" sx={{ flex: 1 }}>授权信息</Typography>
      </DialogTitle>

      <DialogContent dividers>
        {/* 状态详情 */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>
            {licenseStatus.statusText}
          </Typography>

          {isActivated && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                激活时间：{licenseStatus.activatedAt
                  ? new Date(licenseStatus.activatedAt).toLocaleString('zh-CN')
                  : '未知'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                有效期限：{licenseStatus.isPermanent
                  ? '永久有效'
                  : `至 ${licenseStatus.expiryDate ? new Date(licenseStatus.expiryDate).toLocaleDateString('zh-CN') : '未知'}`}
              </Typography>
              {licenseStatus.daysLeft !== null && !licenseStatus.isPermanent && (
                <Chip
                  label={`剩余 ${licenseStatus.daysLeft} 天`}
                  size="small"
                  color={licenseStatus.daysLeft <= 7 ? 'warning' : 'success'}
                  variant="outlined"
                  sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                />
              )}
            </Box>
          )}

          {isTrial && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, mt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                试用开始：{licenseStatus.trialStart
                  ? new Date(licenseStatus.trialStart).toLocaleString('zh-CN')
                  : '未知'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                试用结束：{licenseStatus.trialEnd
                  ? new Date(licenseStatus.trialEnd).toLocaleString('zh-CN')
                  : '未知'}
              </Typography>
              {licenseStatus.hoursLeft !== undefined && (
                <Chip
                  label={licenseStatus.hoursLeft > 0
                    ? `剩余 ${licenseStatus.hoursLeft} 小时`
                    : `剩余 ${licenseStatus.minsLeft} 分钟`}
                  size="small"
                  color={licenseStatus.hoursLeft! < 4 ? 'error' : licenseStatus.hoursLeft! < 12 ? 'warning' : 'primary'}
                  variant="outlined"
                  sx={{ alignSelf: 'flex-start', mt: 0.5 }}
                />
              )}
            </Box>
          )}
        </Box>

        <Divider sx={{ my: 1.5 }} />

        {/* 机器指纹 */}
        <Box>
          <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            本机指纹
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Chip
              icon={<FingerprintIcon />}
              label={machineInfo?.fingerprint || '加载中...'}
              size="small"
              variant="outlined"
              sx={{ fontFamily: 'monospace', flex: 1 }}
            />
            <Button size="small" onClick={handleCopyFingerprint} variant="outlined" sx={{ minWidth: 60 }}>
              {copied ? '已复制' : '复制'}
            </Button>
          </Box>
          {machineInfo?.macs && machineInfo.macs.length > 0 && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.3 }}>
              网卡: {machineInfo.macs[0].mac} ({machineInfo.macs[0].name})
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary" display="block">
            主机名: {machineInfo?.hostname || '-'} | 系统: {machineInfo?.platform || '-'}
          </Typography>
        </Box>

        {/* 重新激活表单 */}
        {!isActivated && (
          <>
            <Divider sx={{ my: 1.5 }} />
            {!showActivateForm ? (
              <Button
                fullWidth
                variant="outlined"
                color="primary"
                startIcon={<VpnKeyIcon />}
                onClick={() => setShowActivateForm(true)}
                sx={{ borderRadius: 2 }}
              >
                输入激活码激活
              </Button>
            ) : (
              <Box>
                {msg && (
                  <Alert severity={msg.severity} sx={{ mb: 1, '& .MuiAlert-message': { fontSize: '0.8rem' } }}>
                    {msg.text}
                  </Alert>
                )}
                <TextField
                  fullWidth
                  size="small"
                  placeholder="请输入激活码"
                  value={licenseKey}
                  onChange={(e) => { setLicenseKey(e.target.value); setMsg(null); }}
                  onKeyDown={(e) => e.key === 'Enter' && handleReactivate()}
                  autoFocus
                  sx={{ mb: 1 }}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <VpnKeyIcon fontSize="small" color="action" />
                      </InputAdornment>
                    ),
                  }}
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    onClick={handleReactivate}
                    disabled={activating || !licenseKey.trim()}
                    sx={{ fontWeight: 600, borderRadius: 2 }}
                  >
                    {activating ? <CircularProgress size={18} /> : '验证并激活'}
                  </Button>
                  <Button
                    variant="text"
                    size="small"
                    onClick={() => { setShowActivateForm(false); setMsg(null); }}
                  >
                    取消
                  </Button>
                </Box>
              </Box>
            )}
          </>
        )}

        {isExpired && (
          <Alert severity="warning" sx={{ mt: 1.5 }} icon={<TimerOffIcon />}>
            <Typography variant="caption">试用已过期，请立即激活以继续使用。</Typography>
          </Alert>
        )}

        {/* 作者联系方式 */}
        <Divider sx={{ my: 1.5 }} />
        <Box sx={{ textAlign: 'center', py: 0.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.8 }}>
            扫码联系作者获取激活码
          </Typography>
          <Box
            component="img"
            src="/wechat-qr.png"
            alt="微信二维码"
            sx={{
              width: 140,
              height: 140,
              objectFit: 'contain',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              mx: 'auto',
            }}
          />
        </Box>
      </DialogContent>

      <DialogActions>
        {isActivated && (
          <Button
            color="warning"
            size="small"
            onClick={() => {
              api?.resetLicense?.().then(() => {
                onClose();
                onShowActivation();
              });
            }}
          >
            重置激活
          </Button>
        )}
        <Button onClick={onClose} size="small">关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

export default LicenseDialog;
