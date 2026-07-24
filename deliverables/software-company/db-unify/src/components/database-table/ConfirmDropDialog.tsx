/**
 * 确认删除对话框
 * 用于表/视图/列删除前的二次确认
 */
import React from 'react';
import {
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';

interface ConfirmDropDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
  loading?: boolean;
  danger?: boolean;
}

const ConfirmDropDialog: React.FC<ConfirmDropDialogProps> = ({
  open,
  title,
  message,
  confirmLabel = '确认删除',
  onCancel,
  onConfirm,
  loading = false,
  danger = true,
}) => {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: 'background.paper',
          border: '1px solid', borderColor: 'divider',
          borderRadius: 1,
        },
      }}
    >
      <DialogTitle
        sx={{
          color: danger ? '#f87171' : 'text.primary',
          fontSize: '0.85rem',
          fontWeight: 600,
          pb: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <WarningAmberIcon sx={{ fontSize: 18 }} />
        {title}
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem', whiteSpace: 'pre-wrap' }}>
          {message}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button
          onClick={onCancel}
          size="small"
          disabled={loading}
          sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}
        >
          取消
        </Button>
        <Button
          onClick={onConfirm}
          variant="contained"
          size="small"
          color={danger ? 'error' : 'primary'}
          disabled={loading}
          sx={{ fontSize: '0.7rem', textTransform: 'none' }}
        >
          {loading ? '处理中...' : confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ConfirmDropDialog;
