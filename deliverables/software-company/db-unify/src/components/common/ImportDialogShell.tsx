import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Stepper, Step, StepLabel, Alert, LinearProgress,
} from '@mui/material';

/**
 * 批量导入弹窗的通用视觉外壳
 * ------------------------------------------------------------------
 * 统一：Dialog 尺寸、标题栏（图标 + 文字）、步骤条、错误 Alert、
 *       进度条、按钮栏位置和样式。
 * 子组件（拖拽上传区、预览表、结果表等）以 children 形式传入，
 * 各业务弹窗仍然保留自己的解析/校验/API 调用逻辑。
 */
export interface ImportDialogShellProps {
  open: boolean;
  onClose: () => void;
  /** 弹窗标题文本 */
  title: string;
  /** 标题左侧图标（可选） */
  icon?: React.ReactNode;
  /** 步骤名列表；不传则不显示 Stepper */
  steps?: string[];
  /** 当前激活的步骤索引 */
  activeStep?: number;
  /** 顶部错误信息 */
  error?: string;
  /** 关闭错误 Alert 的回调 */
  onErrorClose?: () => void;
  /** 是否显示 LinearProgress（导入中） */
  loading?: boolean;
  /** 底部按钮组 */
  actions: React.ReactNode;
  /** Dialog 最大宽度，默认 md */
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl';
  children: React.ReactNode;
}

const ImportDialogShell: React.FC<ImportDialogShellProps> = ({
  open, onClose, title, icon, steps, activeStep = 0,
  error, onErrorClose, loading, actions, maxWidth = 'md', children,
}) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth={maxWidth} fullWidth>
      {/* 标题栏 —— 图标 + 文字 */}
      <DialogTitle
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          fontSize: '0.95rem', fontWeight: 600, py: 1.25,
        }}
      >
        {icon && (
          <Box sx={{ display: 'flex', alignItems: 'center', color: 'primary.main' }}>
            {icon}
          </Box>
        )}
        {title}
      </DialogTitle>

      <DialogContent dividers sx={{ px: 2.5, py: 2 }}>
        {/* 步骤指示 */}
        {steps && steps.length > 0 && (
          <Stepper
            activeStep={activeStep}
            sx={{
              mb: 2.5,
              '& .MuiStepLabel-label': { fontSize: '0.8rem' },
            }}
          >
            {steps.map((label) => (
              <Step key={label}>
                <StepLabel>{label}</StepLabel>
              </Step>
            ))}
          </Stepper>
        )}

        {/* 顶部错误提示 */}
        {error && (
          <Alert
            severity="error"
            sx={{ mb: 2, fontSize: '0.8rem' }}
            onClose={onErrorClose}
          >
            {error}
          </Alert>
        )}

        {children}

        {/* 底部进度条 */}
        {loading && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>

      <DialogActions sx={{ px: 2.5, py: 1.25, gap: 0.75 }}>
        {actions}
      </DialogActions>
    </Dialog>
  );
};

export default ImportDialogShell;
