/**
 * 字段查看/编辑对话框（独立弹窗，支持修改、添加、删除字段）
 */
import React, { useState, useEffect, useCallback } from 'react';
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
  Checkbox,
  Tooltip,
  Snackbar,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ListAltIcon from '@mui/icons-material/ListAlt';
import {
  addColumn,
  updateColumn,
  deleteColumn,
} from '../../services/tableMgmtService';
import type { ColumnDef } from '../../services/tableMgmtService';

const COMMON_TYPES = [
  'INT', 'BIGINT', 'SMALLINT', 'TINYINT',
  'VARCHAR', 'CHAR', 'TEXT', 'MEDIUMTEXT', 'LONGTEXT',
  'DECIMAL', 'FLOAT', 'DOUBLE',
  'DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR',
  'BOOLEAN',
  'BLOB', 'MEDIUMBLOB', 'LONGBLOB',
  'JSON',
];

interface FieldRow {
  id: string;
  name: string;
  type: string;
  length?: number;
  primaryKey: boolean;
  nullable: boolean;
  defaultValue: string;
  comment: string;
}

export interface FieldViewerDialogProps {
  open: boolean;
  connectionId: string;
  tableName: string;
  schemaName?: string;
  columns: {
    name: string;
    type: string;
    length?: number;
    nullable?: boolean;
    primaryKey?: boolean;
    defaultValue?: string;
    comment?: string;
  }[];
  onClose: () => void;
  onSuccess?: () => void;
}

let rowIdCounter = 0;
const nextRowId = () => `field_${++rowIdCounter}`;

/** 从列定义字符串提取长度，如 'VARCHAR(255)' → 255 */
function extractLength(typeStr: string): number | undefined {
  const match = typeStr.match(/\((\d+)\)/);
  return match ? parseInt(match[1]) : undefined;
}

/** 剥离长度的纯类型名，如 'VARCHAR(255)' → 'VARCHAR' */
function stripLength(typeStr: string): string {
  return typeStr.toUpperCase().replace(/\(.*/, '');
}

const FieldViewerDialog: React.FC<FieldViewerDialogProps> = ({
  open, connectionId, tableName, schemaName, columns: initialColumns, onClose, onSuccess,
}) => {
  const [rows, setRows] = useState<FieldRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ msg: string; severity: 'success' | 'error' } | null>(null);

  // 建立原始列名集合（用于判断新增/已有）
  const [originalNames, setOriginalNames] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) {
      const names = new Set(initialColumns.map(c => c.name));
      setOriginalNames(names);
      setRows(initialColumns.map(c => ({
        id: nextRowId(),
        name: c.name,
        type: stripLength(c.type),
        length: c.length ?? extractLength(c.type),
        primaryKey: c.primaryKey ?? false,
        nullable: c.nullable ?? true,
        defaultValue: c.defaultValue ?? '',
        comment: c.comment ?? '',
      })));
    }
  }, [open, initialColumns]);

  // 更新单行字段
  const updateRow = useCallback((id: string, patch: Partial<FieldRow>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }, []);

  // 添加新行
  const handleAddRow = useCallback(() => {
    setRows(prev => [...prev, {
      id: nextRowId(),
      name: 'new_column',
      type: 'VARCHAR',
      length: 255,
      primaryKey: false,
      nullable: true,
      defaultValue: '',
      comment: '',
    }]);
  }, []);

  // 删除行
  const handleDeleteRow = useCallback(async (id: string) => {
    const row = rows.find(r => r.id === id);
    if (!row) return;

    // 如果是已有列，调用后端 API 删除
    if (originalNames.has(row.name)) {
      setSaving(true);
      try {
        await deleteColumn(connectionId, tableName, row.name, schemaName);
        setSnackbar({ msg: `列 ${row.name} 已删除`, severity: 'success' });
      } catch (err: any) {
        setSnackbar({ msg: err.message || '删除列失败', severity: 'error' });
        setSaving(false);
        return;
      }
      setSaving(false);
    }
    setRows(prev => prev.filter(r => r.id !== id));
  }, [rows, originalNames, connectionId, tableName, schemaName]);

  // 保存所有修改
  const handleSaveAll = useCallback(async () => {
    const originalRows = initialColumns.map(c => ({
      name: c.name,
      type: stripLength(c.type),
      length: c.length ?? extractLength(c.type),
      primaryKey: c.primaryKey ?? false,
      nullable: c.nullable ?? true,
      defaultValue: c.defaultValue ?? '',
      comment: c.comment ?? '',
    }));

    setSaving(true);
    try {
      for (const row of rows) {
        const orig = originalRows.find(r => r.name === row.name);
        if (!orig) {
          // 新增列
          if (!row.name.trim()) continue;
          await addColumn(connectionId, tableName, {
            name: row.name,
            type: row.type,
            length: ['VARCHAR', 'CHAR'].includes(row.type) ? row.length : undefined,
            nullable: row.nullable,
            primaryKey: row.primaryKey,
            defaultValue: row.defaultValue || undefined,
            comment: row.comment || undefined,
          }, undefined, schemaName);
        } else {
          // 已有列，检查是否有修改
          const changed: {
            newName?: string;
            type?: string;
            nullable?: boolean;
            defaultValue?: string;
            comment?: string;
          } = {};
          if (row.name !== orig.name) changed.newName = row.name;
          const newTypeStr = row.type + (row.length && ['VARCHAR', 'CHAR'].includes(row.type) ? `(${row.length})` : '');
          const origTypeStr = orig.type + (orig.length && ['VARCHAR', 'CHAR'].includes(orig.type) ? `(${orig.length})` : '');
          if (newTypeStr !== origTypeStr) changed.type = newTypeStr;
          if (row.nullable !== orig.nullable) changed.nullable = row.nullable;
          if (row.defaultValue !== orig.defaultValue) changed.defaultValue = row.defaultValue || undefined;
          if (row.comment !== orig.comment) changed.comment = row.comment || undefined;

          if (Object.keys(changed).length > 0) {
            await updateColumn(connectionId, tableName, row.name, changed, schemaName);
          }
        }
      }
      setSnackbar({ msg: '字段修改已保存', severity: 'success' });
      setTimeout(() => {
        onClose();
        onSuccess?.();
      }, 800);
    } catch (err: any) {
      setSnackbar({ msg: err.message || '保存失败', severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [rows, initialColumns, connectionId, tableName, schemaName, onClose, onSuccess]);

  const isExistingRow = (row: FieldRow) => originalNames.has(row.name);

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
        <DialogTitle sx={{
          color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1,
          display: 'flex', alignItems: 'center', gap: 1,
        }}>
          <ListAltIcon sx={{ fontSize: 18 }} />
          字段管理 — {schemaName ? `${schemaName}.` : ''}{tableName}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, fontSize: '0.7rem' }}>
              {rows.length} 个字段（点击单元格直接编辑）
            </Typography>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon sx={{ fontSize: 12 }} />}
              onClick={handleAddRow}
              sx={{ fontSize: '0.62rem', py: 0, minHeight: 20, textTransform: 'none' }}
            >
              添加字段
            </Button>
          </Box>

          <TableContainer
            component={Paper}
            sx={{
              bgcolor: 'transparent',
              border: '1px solid', borderColor: 'divider',
              borderRadius: 0.5,
              maxHeight: '55vh',
              overflow: 'auto',
            }}
          >
            <Table size="small" sx={{ minWidth: 900 }}>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 40 }}>#</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 50 }}>状态</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>列名</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 120 }}>类型</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 60 }}>长度</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 50 }}>主键</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 55 }}>可空</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 100 }}>默认值</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5 }}>注释</TableCell>
                  <TableCell sx={{ color: 'text.secondary', fontSize: '0.6rem', fontWeight: 600, borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.5, width: 50 }}>操作</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row, idx) => (
                  <TableRow key={row.id}>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5, color: 'text.disabled', fontSize: '0.62rem' }}>
                      {idx + 1}
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5 }}>
                      <Typography
                        variant="caption"
                        sx={{
                          fontSize: '0.5rem', fontWeight: 600,
                          color: isExistingRow(row) ? 'text.secondary' : '#22c55e',
                        }}
                      >
                        {isExistingRow(row) ? '已有' : '新增'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <TextField
                        size="small"
                        value={row.name}
                        onChange={(e) => updateRow(row.id, { name: e.target.value })}
                        variant="standard"
                        sx={{
                          '& .MuiInputBase-root': { fontSize: '0.68rem', color: 'text.primary' },
                          '& .MuiInput-underline:before': { borderBottom: '1px solid', borderBottomColor: 'divider' },
                          '& .MuiInput-underline:hover:before': { borderBottom: '1px solid', borderBottomColor: 'action.focus' },
                          '& .MuiInput-underline:after': { borderBottom: '1px solid #0ea5e9' },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <FormControl size="small" fullWidth>
                        <Select
                          value={COMMON_TYPES.includes(row.type) ? row.type : ''}
                          onChange={(e) => updateRow(row.id, { type: e.target.value })}
                          displayEmpty
                          renderValue={(v) => {
                            if (v) return v;
                            if (row.type && !COMMON_TYPES.includes(row.type)) return row.type;
                            return '';
                          }}
                          sx={{
                            fontSize: '0.68rem', color: 'text.primary',
                            '& .MuiOutlinedInput-notchedOutline': { border: '1px solid', borderColor: 'divider' },
                            '&:hover .MuiOutlinedInput-notchedOutline': { border: '1px solid', borderColor: 'action.focus' },
                            '&.Mui-focused .MuiOutlinedInput-notchedOutline': { border: '1px solid #0ea5e9' },
                          }}
                        >
                          {COMMON_TYPES.map(t => (
                            <MenuItem key={t} value={t} sx={{ fontSize: '0.68rem' }}>{t}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <TextField
                        size="small"
                        value={row.length ?? ''}
                        onChange={(e) => updateRow(row.id, { length: e.target.value ? parseInt(e.target.value) || 0 : undefined })}
                        variant="standard"
                        type="number"
                        sx={{
                          width: 50,
                          '& .MuiInputBase-root': { fontSize: '0.68rem', color: 'text.primary' },
                          '& .MuiInput-underline:before': { borderBottom: '1px solid', borderBottomColor: 'divider' },
                          '& .MuiInput-underline:hover:before': { borderBottom: '1px solid', borderBottomColor: 'action.focus' },
                          '& .MuiInput-underline:after': { borderBottom: '1px solid #0ea5e9' },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5, textAlign: 'center' }}>
                      <Checkbox
                        size="small"
                        checked={row.primaryKey}
                        onChange={(e) => updateRow(row.id, { primaryKey: e.target.checked })}
                        sx={{
                          color: 'action.disabled',
                          '&.Mui-checked': { color: '#f59e0b' },
                          padding: 0.25,
                          '& .MuiSvgIcon-root': { fontSize: 14 },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.5, textAlign: 'center' }}>
                      <Checkbox
                        size="small"
                        checked={row.nullable}
                        onChange={(e) => updateRow(row.id, { nullable: e.target.checked })}
                        sx={{
                          color: 'action.disabled',
                          '&.Mui-checked': { color: '#0ea5e9' },
                          padding: 0.25,
                          '& .MuiSvgIcon-root': { fontSize: 14 },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <TextField
                        size="small"
                        value={row.defaultValue}
                        onChange={(e) => updateRow(row.id, { defaultValue: e.target.value })}
                        variant="standard"
                        sx={{
                          '& .MuiInputBase-root': { fontSize: '0.68rem', color: 'text.secondary' },
                          '& .MuiInput-underline:before': { borderBottom: '1px solid', borderBottomColor: 'divider' },
                          '& .MuiInput-underline:hover:before': { borderBottom: '1px solid', borderBottomColor: 'action.focus' },
                          '& .MuiInput-underline:after': { borderBottom: '1px solid #0ea5e9' },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <TextField
                        size="small"
                        value={row.comment}
                        onChange={(e) => updateRow(row.id, { comment: e.target.value })}
                        variant="standard"
                        sx={{
                          '& .MuiInputBase-root': { fontSize: '0.68rem', color: 'text.secondary' },
                          '& .MuiInput-underline:before': { borderBottom: '1px solid', borderBottomColor: 'divider' },
                          '& .MuiInput-underline:hover:before': { borderBottom: '1px solid', borderBottomColor: 'action.focus' },
                          '& .MuiInput-underline:after': { borderBottom: '1px solid #0ea5e9' },
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ borderBottom: '1px solid', borderBottomColor: 'divider', py: 0.25, px: 0.25 }}>
                      <Tooltip title="删除此字段">
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteRow(row.id)}
                          sx={{ p: 0.25 }}
                        >
                          <DeleteIcon sx={{ fontSize: 13, color: '#f87171' }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={onClose}
            size="small"
            sx={{ color: 'text.secondary', fontSize: '0.7rem', textTransform: 'none' }}
          >
            取消
          </Button>
          <Button
            onClick={handleSaveAll}
            variant="contained"
            size="small"
            disabled={saving}
            sx={{
              bgcolor: '#0ea5e9', color: '#fff', fontSize: '0.7rem',
              textTransform: 'none', '&:hover': { bgcolor: '#0284c7' },
            }}
          >
            {saving ? '保存中...' : '保存修改'}
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

export default FieldViewerDialog;
