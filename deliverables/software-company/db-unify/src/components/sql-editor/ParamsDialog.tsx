import React, { useState, useEffect } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Typography,
} from '@mui/material';

interface ParamsDialogProps {
  open: boolean;
  params: string[];
  onConfirm: (values: Record<string, string>) => void;
  onCancel: () => void;
}

const ParamsDialog: React.FC<ParamsDialogProps> = ({ open, params, onConfirm, onCancel }) => {
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const init: Record<string, string> = {};
    params.forEach((p) => { init[p] = ''; });
    setValues(init);
  }, [params]);

  const handleConfirm = () => {
    onConfirm(values);
  };

  return (
    <Dialog open={open} onClose={onCancel} maxWidth="sm" fullWidth>
      <DialogTitle>输入查询参数</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          检测到 SQL 中包含参数占位符（:参数名），请为以下参数提供值：
        </Typography>
        {params.map((p) => (
          <TextField
            key={p}
            label={p}
            value={values[p] || ''}
            onChange={(e) => setValues((prev) => ({ ...prev, [p]: e.target.value }))}
            size="small"
            fullWidth
            sx={{ mb: 1.5 }}
          />
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>取消</Button>
        <Button onClick={handleConfirm} variant="contained">确认执行</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ParamsDialog;
