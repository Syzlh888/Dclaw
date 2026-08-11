/**
 * 创建表对话框
 * 列编辑器：添加/删除/排序列，设置列属性
 */
import React, { useState } from 'react';
import {
  Box,
  Typography,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Tooltip,
  Snackbar,
  Alert,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import TableChartIcon from '@mui/icons-material/TableChart';
import { createTable } from '../../services/tableMgmtService';
import type { ColumnDef } from '../../services/tableMgmtService';

interface CreateTableDialogProps {
  open: boolean;
  connectionId: string;
  onClose: () => void;
  schemaName?: string;
  onSuccess?: () => void;
}

const COMMON_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DECIMAL', 'FLOAT', 'DOUBLE',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'JSON',
];

const CreateTableDialog: React.FC<CreateTableDialogProps> = ({
  open, connectionId, onClose, schemaName, onSuccess,
}) => {
  const [tableName, setTableName] = useState('');
  const [tableComment, setTableComment] = useState('');
  const [columns, setColumns] = useState<ColumnDef[]>([
    { name: 'id', type: 'BIGINT', nullable: false, primaryKey: true, autoIncrement: true, defaultValue: '', comment: '主键' },
    { name: 'created_at', type: 'DATETIME', nullable: true, primaryKey: false, defaultValue: 'CURRENT_TIMESTAMP', comment: '创建时间' },
  ]);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

  const handleAddColumn = () => {
    setColumns(prev => [...prev, { name: '', type: 'VARCHAR', length: 255, nullable: true, primaryKey: false, defaultValue: '', comment: '' }]);
  };

  const handleRemoveColumn = (idx: number) => {
    setColumns(prev => prev.filter((_, i) => i !== idx));
  };

  const handleMoveUp = (idx: number) => {
    if (idx === 0) return;
    setColumns(prev => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const handleMoveDown = (idx: number) => {
    if (idx >= columns.length - 1) return;
    setColumns(prev => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const handleColumnChange = (idx: number, field: keyof ColumnDef, value: any) => {
    setColumns(prev => prev.map((col, i) => i === idx ? { ...col, [field]: value } : col));
  };

  const handleSave = async () => {
    if (!tableName.trim()) {
      setSnackbar({ msg: '请输入表名', severity: 'error' });
      return;
    }
    const validCols = columns.filter(c => c.name.trim());
    if (validCols.length === 0) {
      setSnackbar({ msg: '至少需要一个有效列', severity: 'error' });
      return;
    }

    setSaving(true);
    try {
      await createTable(connectionId, {
        tableName: tableName.trim(),
        columns: validCols.map(c => ({
          ...c,
          length: c.type === 'VARCHAR' && !c.length ? 255 : c.length,
        })),
        schema: schemaName,
        comment: tableComment.trim() || undefined,
      });
      setSnackbar({ msg: `表 ${tableName} 创建成功`, severity: 'success' });
      // Reset and close
      setTimeout(() => {
        setTableName('');
        setTableComment('');
        setColumns([
          { name: 'id', type: 'BIGINT', nullable: false, primaryKey: true, autoIncrement: true, defaultValue: '', comment: '主键' },
          { name: 'created_at', type: 'DATETIME', nullable: true, primaryKey: false, defaultValue: 'CURRENT_TIMESTAMP', comment: '创建时间' },
        ]);
        onClose();
        onSuccess?.();
      }, 1000);
    } catch (err: any) {
      setSnackbar({ msg: err.message || '创建失败', severity: 'error' });
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
            maxHeight: '85vh',
          },
        }}
      >
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <TableChartIcon sx={{ fontSize: '1.125rem' }} />
          创建表
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          {/* Basic info */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <TextField
              size="small"
              label="表名"
              value={tableName}
              onChange={(e) => setTableName(e.target.value)}
              sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
            />
            <TextField
              size="small"
              label="注释（可选）"
              value={tableComment}
              onChange={(e) => setTableComment(e.target.value)}
              sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
            />
          </Box>

          {/* Column table */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem' }}>
              列定义
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon sx={{ fontSize: '0.75rem' }} />}
              onClick={handleAddColumn}
              sx={{ fontSize: '0.62rem', py: 0, minHeight: 20, textTransform: 'none' }}
            >
              添加列
            </Button>
          </Box>

          <TableContainer
            component={Paper}
            sx={{
              bgcolor: 'transparent',
              border: '1px solid', borderColor: 'divider',
              borderRadius: 0.5,
              maxHeight: 400,
              overflow: 'auto',
            }}
          >
            <Table size="small" sx={{ minWidth: 650 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 24 }}></TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>列名</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 110 }}>类型</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 60 }}>长度</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 85 }}>主键</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 70 }}>自增</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 90 }}>NULL</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 100 }}>默认值</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>注释</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 24 }}></TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {columns.map((col, idx) => (
                  <TableRow key={idx}>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <IconButton size="small" onClick={() => handleMoveUp(idx)} disabled={idx === 0} sx={{ p: 0, minWidth: 14, height: 12 }}>
                          <ArrowUpwardIcon sx={{ fontSize: '0.625rem' }} />
                        </IconButton>
                        <IconButton size="small" onClick={() => handleMoveDown(idx)} disabled={idx >= columns.length - 1} sx={{ p: 0, minWidth: 14, height: 12 }}>
                          <ArrowDownwardIcon sx={{ fontSize: '0.625rem' }} />
                        </IconButton>
                      </Box>
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <TextField
                        size="small"
                        value={col.name}
                        onChange={(e) => handleColumnChange(idx, 'name', e.target.value)}
                        placeholder="列名"
                        sx={{ '& .MuiInputBase-input': { fontSize: '0.68rem', py: 0.25 } }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <FormControl fullWidth size="small">
                        <Select
                          value={col.type}
                          onChange={(e) => handleColumnChange(idx, 'type', e.target.value)}
                          sx={{ fontSize: '0.68rem', '& .MuiSelect-select': { py: 0.25 } }}
                        >
                          {COMMON_TYPES.map(t => (
                            <MenuItem key={t} value={t} sx={{ fontSize: '0.68rem' }}>{t}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <TextField
                        size="small"
                        type="number"
                        value={col.length || ''}
                        onChange={(e) => handleColumnChange(idx, 'length', e.target.value ? parseInt(e.target.value) : undefined)}
                        disabled={!['VARCHAR', 'CHAR', 'DECIMAL'].includes(col.type)}
                        sx={{ width: 55, '& .MuiInputBase-input': { fontSize: '0.68rem', py: 0.25 } }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <Switch
                        size="small"
                        checked={!!col.primaryKey}
                        onChange={(e) => handleColumnChange(idx, 'primaryKey', e.target.checked)}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <Switch
                        size="small"
                        checked={!!col.autoIncrement}
                        onChange={(e) => handleColumnChange(idx, 'autoIncrement', e.target.checked)}
                        disabled={!col.primaryKey}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <Switch
                        size="small"
                        checked={col.nullable !== false}
                        onChange={(e) => handleColumnChange(idx, 'nullable', e.target.checked)}
                        disabled={!!col.primaryKey}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <TextField
                        size="small"
                        value={col.defaultValue || ''}
                        onChange={(e) => handleColumnChange(idx, 'defaultValue', e.target.value)}
                        placeholder="默认值"
                        sx={{ '& .MuiInputBase-input': { fontSize: '0.68rem', py: 0.25 } }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <TextField
                        size="small"
                        value={col.comment || ''}
                        onChange={(e) => handleColumnChange(idx, 'comment', e.target.value)}
                        placeholder="注释"
                        sx={{ '& .MuiInputBase-input': { fontSize: '0.68rem', py: 0.25 } }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <IconButton size="small" onClick={() => handleRemoveColumn(idx)} disabled={columns.length <= 1} sx={{ p: 0 }}>
                        <DeleteIcon sx={{ fontSize: '0.75rem', color: '#f87171' }} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} size="small" sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}>
            取消
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            size="small"
            disabled={!tableName.trim() || saving}
            sx={{ bgcolor: '#0ea5e9', color: '#fff', fontSize: '0.7rem', textTransform: 'none', '&:hover': { bgcolor: '#0284c7' } }}
          >
            {saving ? '创建中...' : '创建表'}
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

export default CreateTableDialog;
