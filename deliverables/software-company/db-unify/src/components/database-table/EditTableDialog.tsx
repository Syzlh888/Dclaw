/**
 * 编辑表对话框（添加/修改/删除列）
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
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
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
  Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import EditNoteIcon from '@mui/icons-material/EditNote';
import {
  addColumn,
  updateColumn,
  deleteColumn,
} from '../../services/tableMgmtService';
import type { ColumnDef } from '../../services/tableMgmtService';
import ConfirmDropDialog from './ConfirmDropDialog';

const COMMON_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DECIMAL', 'FLOAT', 'DOUBLE',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'JSON',
];

interface ColumnRow {
  name: string;
  type: string;
  length?: number;
  nullable: boolean;
  defaultValue: string;
  comment: string;
}

interface EditTableDialogProps {
  open: boolean;
  connectionId: string;
  tableName: string;
  schemaName?: string;
  /** 已有列信息（从元数据获取） */
  existingColumns?: { name: string; type: string; nullable: boolean; default?: string; comment?: string }[];
  onClose: () => void;
  onSuccess?: () => void;
}

const EditTableDialog: React.FC<EditTableDialogProps> = ({
  open, connectionId, tableName, schemaName, existingColumns, onClose, onSuccess,
}) => {
  // Column editing
  const [columns, setColumns] = useState<ColumnRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

  // Delete column confirmation
  const [deleteColOpen, setDeleteColOpen] = useState(false);
  const [deleteTargetIdx, setDeleteTargetIdx] = useState<number | null>(null);

  // Edit column dialog
  const [editColOpen, setEditColOpen] = useState(false);
  const [editColIdx, setEditColIdx] = useState<number | null>(null);
  const [editCol, setEditCol] = useState<ColumnRow>({
    name: '', type: 'VARCHAR', length: 255, nullable: true, defaultValue: '', comment: '',
  });

  useEffect(() => {
    if (open && existingColumns) {
      setColumns(existingColumns.map(c => ({
        name: c.name,
        type: c.type.toUpperCase().replace(/\(.*/, ''),
        length: extractLength(c.type),
        nullable: c.nullable !== false,
        defaultValue: c.default || '',
        comment: c.comment || '',
      })));
    } else if (open) {
      setColumns([]);
    }
  }, [open, existingColumns]);

  // Add a new column row
  const handleAddColumn = () => {
    const newCol: ColumnRow = {
      name: 'new_column',
      type: 'VARCHAR', length: 255, nullable: true, defaultValue: '', comment: '',
    };
    setColumns(prev => [...prev, newCol]);
  };

  // Open edit column dialog
  const handleOpenEdit = (idx: number) => {
    setEditColIdx(idx);
    setEditCol({ ...columns[idx] });
    setEditColOpen(true);
  };

  // Save edited column
  const handleSaveEdit = async () => {
    if (editColIdx === null) return;
    const col = columns[editColIdx];
    try {
      setSaving(true);
      await updateColumn(connectionId, tableName, col.name, {
        newName: editCol.name !== col.name ? editCol.name : undefined,
        type: editCol.type !== (col.type) ? `${editCol.type}${editCol.length && ['VARCHAR', 'CHAR'].includes(editCol.type) ? `(${editCol.length})` : ''}` : undefined,
        nullable: editCol.nullable !== col.nullable ? editCol.nullable : undefined,
        defaultValue: editCol.defaultValue !== col.defaultValue ? (editCol.defaultValue ?? undefined) : undefined,
      }, schemaName);
      setColumns(prev => prev.map((c, i) => i === editColIdx ? { ...editCol } : c));
      setSnackbar({ msg: `列 ${col.name} 修改成功`, severity: 'success' });
      setEditColOpen(false);
    } catch (err: any) {
      setSnackbar({ msg: err.message || '修改列失败', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Confirm delete column
  const handleDeleteClick = (idx: number) => {
    setDeleteTargetIdx(idx);
    setDeleteColOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetIdx === null) return;
    const col = columns[deleteTargetIdx];
    try {
      setSaving(true);
      await deleteColumn(connectionId, tableName, col.name, schemaName);
      setColumns(prev => prev.filter((_, i) => i !== deleteTargetIdx));
      setSnackbar({ msg: `列 ${col.name} 已删除`, severity: 'success' });
      setDeleteColOpen(false);
      setDeleteTargetIdx(null);
    } catch (err: any) {
      setSnackbar({ msg: err.message || '删除列失败', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  // Save all changes (new columns)
  const handleSaveAll = async () => {
    // Find newly added columns (those not in existingColumns)
    const existingNames = new Set(existingColumns?.map(c => c.name) || []);
    const newColumns = columns.filter(c => !existingNames.has(c.name));

    try {
      setSaving(true);
      for (const col of newColumns) {
        if (!col.name.trim()) continue;
        await addColumn(connectionId, tableName, {
          name: col.name,
          type: col.type,
          length: ['VARCHAR', 'CHAR'].includes(col.type) ? col.length : undefined,
          nullable: col.nullable,
          defaultValue: col.defaultValue || undefined,
          comment: col.comment || undefined,
        }, undefined, schemaName);
      }
      setSnackbar({ msg: '修改已保存', severity: 'success' });
      setTimeout(() => {
        onClose();
        onSuccess?.();
      }, 1000);
    } catch (err: any) {
      setSnackbar({ msg: err.message || '保存失败', severity: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const isNewColumn = (idx: number) => {
    const existingNames = new Set(existingColumns?.map(c => c.name) || []);
    return !existingNames.has(columns[idx].name);
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        maxWidth="lg"
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
          <EditNoteIcon sx={{ fontSize: 18 }} />
          编辑表：{tableName}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem' }}>
              列列表（点击行右侧编辑按钮修改已有列；添加新列使用下方按钮）
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon sx={{ fontSize: 12 }} />}
              onClick={handleAddColumn}
              sx={{ fontSize: '0.62rem', py: 0, minHeight: 20, textTransform: 'none' }}
            >
              添加新列
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
            <Table size="small" sx={{ minWidth: 600 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 50 }}>状态</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>列名</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>类型</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>NULL</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>默认值</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>注释</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 70 }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {columns.map((col, idx) => (
                  <TableRow key={idx}>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <Chip
                        label={isNewColumn(idx) ? '新增' : '已有'}
                        size="small"
                        color={isNewColumn(idx) ? 'success' : 'default'}
                        variant="outlined"
                        sx={{ fontSize: '0.5rem', height: 16, minWidth: 28 }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: 'text.primary', fontSize: '0.68rem', borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25 }}>
                      {col.name}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.62rem', borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25 }}>
                      {col.type}{col.length ? `(${col.length})` : ''}
                    </TableCell>
                    <TableCell sx={{ color: col.nullable ? 'text.secondary' : '#fbbf24', fontSize: '0.62rem', borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25 }}>
                      {col.nullable ? 'YES' : 'NOT NULL'}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.62rem', borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25 }}>
                      {col.defaultValue || '-'}
                    </TableCell>
                    <TableCell sx={{ color: 'text.secondary', fontSize: '0.62rem', borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25 }}>
                      {col.comment || '-'}
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <Tooltip title="编辑列">
                        <IconButton size="small" onClick={() => handleOpenEdit(idx)} sx={{ p: 0.25 }}>
                          <EditIcon sx={{ fontSize: 12, color: '#0ea5e9' }} />
                        </IconButton>
                      </Tooltip>
                      {isNewColumn(idx) && (
                        <Tooltip title="删除列">
                          <IconButton size="small" onClick={() => handleDeleteClick(idx)} sx={{ p: 0.25 }}>
                            <DeleteIcon sx={{ fontSize: 12, color: '#f87171' }} />
                          </IconButton>
                        </Tooltip>
                      )}
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
            onClick={handleSaveAll}
            variant="contained"
            size="small"
            disabled={saving}
            sx={{ bgcolor: '#0ea5e9', color: '#fff', fontSize: '0.7rem', textTransform: 'none', '&:hover': { bgcolor: '#0284c7' } }}
          >
            {saving ? '保存中...' : '保存修改'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit column dialog */}
      <Dialog
        open={editColOpen}
        onClose={() => setEditColOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 } }}
      >
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1 }}>
          编辑列
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box sx={{ display: 'flex', gap: 2, mb: 1.5 }}>
            <TextField
              size="small"
              label="列名"
              value={editCol.name}
              onChange={(e) => setEditCol(prev => ({ ...prev, name: e.target.value }))}
              sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
            />
            <FormControl size="small" sx={{ width: 120 }}>
              <InputLabel sx={{ fontSize: '0.7rem' }}>类型</InputLabel>
              <Select
                value={editCol.type}
                label="类型"
                onChange={(e) => setEditCol(prev => ({ ...prev, type: e.target.value }))}
                sx={{ fontSize: '0.75rem' }}
              >
                {COMMON_TYPES.map(t => (
                  <MenuItem key={t} value={t} sx={{ fontSize: '0.75rem' }}>{t}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mb: 1.5, alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ fontSize: '0.68rem', color: 'text.secondary' }}>NULL</Typography>
              <Switch
                size="small"
                checked={editCol.nullable}
                onChange={(e) => setEditCol(prev => ({ ...prev, nullable: e.target.checked }))}
              />
            </Box>
            <TextField
              size="small"
              label="默认值"
              value={editCol.defaultValue || ''}
              onChange={(e) => setEditCol(prev => ({ ...prev, defaultValue: e.target.value }))}
              sx={{ flex: 1, '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
            />
          </Box>
          <TextField
            size="small"
            label="注释"
            value={editCol.comment || ''}
            onChange={(e) => setEditCol(prev => ({ ...prev, comment: e.target.value }))}
            fullWidth
            sx={{ '& .MuiInputBase-root': { fontSize: '0.75rem' }, '& .MuiFormLabel-root': { fontSize: '0.7rem' } }}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditColOpen(false)} size="small" sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}>
            取消
          </Button>
          <Button
            onClick={handleSaveEdit}
            variant="contained"
            size="small"
            disabled={!editCol.name.trim() || saving}
            sx={{ bgcolor: '#0ea5e9', color: '#fff', fontSize: '0.7rem', textTransform: 'none', '&:hover': { bgcolor: '#0284c7' } }}
          >
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete column confirmation */}
      <ConfirmDropDialog
        open={deleteColOpen}
        title="确认删除列"
        message={deleteTargetIdx !== null ? `确定要删除列 "${columns[deleteTargetIdx]?.name}" 吗？此操作不可撤销，数据将永久丢失。` : ''}
        onCancel={() => { setDeleteColOpen(false); setDeleteTargetIdx(null); }}
        onConfirm={handleDeleteConfirm}
        loading={saving}
      />

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

function extractLength(typeStr: string): number | undefined {
  const match = typeStr.match(/\((\d+)\)/);
  return match ? parseInt(match[1]) : undefined;
}

export default EditTableDialog;
