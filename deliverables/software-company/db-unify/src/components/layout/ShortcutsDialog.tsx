import React from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Table, TableBody, TableRow, TableCell, Typography, Box,
} from '@mui/material';

const shortcuts = [
  { keys: 'Ctrl + Enter', desc: '执行 SQL' },
  { keys: 'Ctrl + S', desc: '保存当前 SQL 为脚本' },
  { keys: 'Ctrl + O', desc: '打开脚本列表' },
  { keys: 'Shift + Alt + F', desc: '格式化 SQL' },
  { keys: 'Ctrl + 滚轮', desc: '缩放编辑器字体' },
  { keys: 'F1 / Shift + ?', desc: '显示快捷键帮助' },
];

interface ShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

const ShortcutsDialog: React.FC<ShortcutsDialogProps> = ({ open, onClose }) => {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>快捷键</DialogTitle>
      <DialogContent dividers>
        <Table size="small">
          <TableBody>
            {shortcuts.map((s) => (
              <TableRow key={s.keys}>
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Box
                    component="kbd"
                    sx={{
                      display: 'inline-block',
                      px: 1,
                      py: 0.25,
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: 'text.primary',
                      bgcolor: 'grey.100',
                      borderRadius: 0.5,
                      border: '1px solid',
                      borderColor: 'grey.300',
                      fontFamily: 'monospace',
                    }}
                  >
                    {s.keys}
                  </Box>
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="body2">{s.desc}</Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

export default ShortcutsDialog;
