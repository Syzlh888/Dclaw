/**
 * 创建/编辑视图对话框
 * SQL 编辑器用于输入视图查询语句
 */
import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Snackbar,
  Alert,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { createView, updateView } from '../../services/tableMgmtService';

interface CreateViewDialogProps {
  open: boolean;
  connectionId: string;
  onClose: () => void;
  schemaName?: string;
  /** 编辑模式：传入已有视图信息 */
  editView?: { viewName: string; asSql?: string; comment?: string } | null;
  onSuccess?: () => void;
}

const CreateViewDialog: React.FC<CreateViewDialogProps> = ({
  open, connectionId, onClose, schemaName, editView, onSuccess,
}) => {
  const [viewName, setViewName] = useState('');
  const [viewComment, setViewComment] = useState('');
  const [asSql, setAsSql] = useState('');
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

  const isEdit = !!editView;

  useEffect(() => {
    if (open) {
      if (editView) {
        setViewName(editView.viewName);
        setViewComment(editView.comment || '');
        setAsSql(editView.asSql || '');
      } else {
        setViewName('');
        setViewComment('');
        setAsSql('SELECT\n  *\nFROM\n  table_name\nWHERE\n  1=1');
      }
    }
  }, [open, editView]);

  const handleSave = async () => {
    if (!viewName.trim()) {
      setSnackbar({ msg: '请输入视图名', severity: 'error' });
      return;
    }
    if (!asSql.trim()) {
      setSnackbar({ msg: '请输入视图 SQL', severity: 'error' });
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateView(connectionId, viewName.trim(), {
          asSql: asSql.trim(),
          comment: viewComment.trim() || undefined,
        }, schemaName);
        setSnackbar({ msg: `视图 ${viewName} 修改成功`, severity: 'success' });
      } else {
        await createView(connectionId, {
          viewName: viewName.trim(),
          asSql: asSql.trim(),
          schema: schemaName,
          comment: viewComment.trim() || undefined,
        });
        setSnackbar({ msg: `视图 ${viewName} 创建成功`, severity: 'success' });
      }
      setTimeout(() => {
        onClose();
        onSuccess?.();
      }, 1000);
    } catch (err: any) {
      setSnackbar({ msg: err.message || (isEdit ? '修改失败' : '创建失败'), severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="md"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid', borderColor: 'divider',
            borderRadius: 1,
          },
        }}
      >
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <VisibilityIcon sx={{ fontSize: '1.125rem' }} />
          {isEdit ? '编辑视图' : '创建视图'}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              size="small"
              label="视图名"
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              disabled={isEdit}
              sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
            />
            <TextField
              size="small"
              label="注释（可选）"
              value={viewComment}
              onChange={(e) => setViewComment(e.target.value)}
              sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
            />
          </Box>

          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem', mb: 0.5, display: 'block' }}>
            查询 SQL
          </Typography>
          <TextField
            multiline
            rows={12}
            value={asSql}
            onChange={(e) => setAsSql(e.target.value)}
            placeholder="SELECT ... FROM ... WHERE ..."
            fullWidth
            sx={{
              '& .MuiInputBase-root': {
                fontSize: '0.72rem',
                fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
                bgcolor: 'background.default',
                color: 'text.primary',
              },
              '& .MuiOutlinedInput-notchedOutline': { borderColor: 'divider' },
            }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} size="small" sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}>
            取消
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            size="small"
            disabled={!viewName.trim() || !asSql.trim() || saving}
            sx={{ bgcolor: '#0ea5e9', color: '#fff', fontSize: '0.7rem', textTransform: 'none', '&:hover': { bgcolor: '#0284c7' } }}
          >
            {saving ? '保存中...' : (isEdit ? '保存修改' : '创建视图')}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={!!snackbar}
        autoHideDuration={3000}
        onClose={() => setSnackbar(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snackbar ? (
          <Alert severity={snackbar.severity} sx={{ width: '100%', fontSize: '0.75rem' }}>
            {snackbar.msg}
          </Alert>
        ) : undefined}
      </Snackbar>
    </>
  );
};

export default CreateViewDialog;
