/**
 * 字段映射对话框（DBeaver 风格）
 *
 * - 左列：源表所有字段（来自 fetchTableColumns）
 * - 中间列：→ 箭头
 * - 右列：目标表所有字段
 * - 每行：源字段（下拉，可改）→ 目标字段（下拉）
 * - 自动匹配：name + type 同时相同视为同名同型，自动配对
 * - 底部：取消 / 确定
 *
 * 数据流：
 * 1) 父组件传入 sourceTable / targetTable（带 connectionId/schemaName）
 * 2) 进入时拉源 + 目标表的字段
 * 3) 用户在右侧下拉选择目标字段（默认按 name 自动匹配）
 * 4) onSave 把映射回传父组件，父组件写入 exportStore
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { fetchTableColumns, type ColumnInfo } from '../../services/exportService';
import type { FieldMapping } from '../../stores/exportStore';

/** 表的最小标识 */
export interface TableRef {
  connectionId: string;
  tableName: string;
  schemaName?: string;
}

interface FieldMappingDialogProps {
  open: boolean;
  sourceTable: TableRef;
  targetTable: TableRef;
  /** 已保存的映射（再次打开时回显） */
  initialMappings?: FieldMapping[];
  onClose: () => void;
  /** 父组件把映射回写到 store */
  onSave: (mappings: FieldMapping[]) => void;
}

/** 表征「同一列」的签名（大小写不敏感），用于自动匹配 */
function signatureOf(c: { name: string; type?: string }): string {
  return `${(c.name || '').toLowerCase()}|${(c.type || '').toLowerCase()}`;
}

export const FieldMappingDialog: React.FC<FieldMappingDialogProps> = ({
  open,
  sourceTable,
  targetTable,
  initialMappings,
  onClose,
  onSave,
}) => {
  const [sourceColumns, setSourceColumns] = useState<ColumnInfo[]>([]);
  const [targetColumns, setTargetColumns] = useState<ColumnInfo[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  // 标记是否曾经设置过 initialMappings（避免覆盖用户手动编辑）
  const [hydrated, setHydrated] = useState(false);

  // 进入 / 关闭时重置状态
  useEffect(() => {
    if (!open) {
      setHydrated(false);
      return;
    }
    setHydrated(true);
  }, [open]);

  // 拉源表字段
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSourceLoading(true);
    fetchTableColumns(sourceTable.connectionId, sourceTable.tableName, sourceTable.schemaName)
      .then((cols) => {
        if (!cancelled) setSourceColumns(cols);
      })
      .catch(() => {
        if (!cancelled) setSourceColumns([]);
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceTable.connectionId, sourceTable.tableName, sourceTable.schemaName]);

  // 拉目标表字段
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setTargetLoading(false);
    setTargetColumns([]);
    // 如果目标表没起名（用户尚未输入），跳过
    if (!targetTable.tableName) return;
    setTargetLoading(true);
    fetchTableColumns(targetTable.connectionId, targetTable.tableName, targetTable.schemaName)
      .then((cols) => {
        if (!cancelled) setTargetColumns(cols);
      })
      .catch(() => {
        if (!cancelled) setTargetColumns([]);
      })
      .finally(() => {
        if (!cancelled) setTargetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, targetTable.connectionId, targetTable.tableName, targetTable.schemaName]);

  // 自动匹配：当两个表都加载完，按 name + type 相同配对
  useEffect(() => {
    if (!open) return;
    // 如果已有 initialMappings 覆盖（比如再次打开已配对的）→ 保留用户选择
    if (hydrated && initialMappings && initialMappings.length > 0) {
      // 仍以 sourceColumns 为基准刷新顺序，保留用户选择的目标列
      const next = sourceColumns.map((sc) => {
        const found = initialMappings.find(
          (m) => (m.sourceColumn || '').toLowerCase() === sc.name.toLowerCase()
        );
        if (found) {
          return {
            sourceColumn: sc.name,
            targetColumn: found.targetColumn || '',
            sourceType: sc.type,
            targetType:
              targetColumns.find((tc) => tc.name === found.targetColumn)?.type || found.targetType,
          };
        }
        // 没找到 → 自动匹配
        const tc = targetColumns.find((t) => signatureOf(t) === signatureOf(sc));
        return {
          sourceColumn: sc.name,
          targetColumn: tc?.name || '',
          sourceType: sc.type,
          targetType: tc?.type,
        };
      });
      setMappings(next);
      return;
    }
    // 首次打开 / 无 initialMappings → 重新自动匹配
    if (!sourceColumns.length) return;
    const auto: FieldMapping[] = sourceColumns.map((sc) => {
      const tc = targetColumns.find((t) => signatureOf(t) === signatureOf(sc));
      return {
        sourceColumn: sc.name,
        targetColumn: tc?.name || '',
        sourceType: sc.type,
        targetType: tc?.type,
      };
    });
    setMappings(auto);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceColumns, targetColumns, open]);

  // 右侧下拉选项 = 目标列名 + 当前 mappings 中其他行已选（允许重复？一般不允许，但提供更宽容的列表）
  const targetNameOptions = useMemo(
    () => targetColumns.map((c) => c.name),
    [targetColumns]
  );

  const updateMapping = (idx: number, patch: Partial<FieldMapping>) => {
    setMappings((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  };

  // 自动重新匹配按钮：清空现有 → 按 name+type 再来一遍
  const reAutoMatch = () => {
    const next = sourceColumns.map((sc) => {
      const tc = targetColumns.find((t) => signatureOf(t) === signatureOf(sc));
      return {
        sourceColumn: sc.name,
        targetColumn: tc?.name || '',
        sourceType: sc.type,
        targetType: tc?.type,
      };
    });
    setMappings(next);
  };

  const matchedCount = useMemo(
    () => mappings.filter((m) => m.targetColumn).length,
    [mappings]
  );

  const isLoading = sourceLoading || targetLoading;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          bgcolor: '#2B2B2B',
          color: '#E0E0E0',
          minHeight: 480,
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pr: 6, pb: 1 }}>
        <AccountTreeIcon sx={{ color: '#64B5F6' }} />
        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600, fontSize: '0.95rem' }}>
          字段映射：
          <Box component="span" sx={{ color: '#90CAF9', fontFamily: 'monospace' }}>
            {sourceTable.tableName || '(未命名)'}
          </Box>
          <ArrowForwardIcon sx={{ fontSize: 16, mx: 0.5, color: '#888', verticalAlign: 'middle' }} />
          <Box component="span" sx={{ color: '#A5D6A7', fontFamily: 'monospace' }}>
            {targetTable.tableName || '(未命名)'}
          </Box>
        </Typography>
        <IconButton
          onClick={onClose}
          size="small"
          sx={{ position: 'absolute', right: 8, top: 8, color: '#888' }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <Divider sx={{ borderColor: '#3A3A3A' }} />

      <DialogContent sx={{ p: 0, bgcolor: '#252525', pt: '12px !important' }}>
        {/* 顶部统计 + 工具栏 */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            borderBottom: '1px solid #3A3A3A',
            bgcolor: '#2F2F2F',
          }}
        >
          <Chip
            size="small"
            label={`源 ${sourceColumns.length} 列`}
            sx={{ bgcolor: '#1565C0', color: '#fff', fontSize: '0.7rem', height: 22 }}
          />
          <Chip
            size="small"
            label={`目标 ${targetColumns.length} 列`}
            sx={{ bgcolor: '#2E7D32', color: '#fff', fontSize: '0.7rem', height: 22 }}
          />
          <Chip
            size="small"
            label={`已配对 ${matchedCount} / ${mappings.length}`}
            sx={{
              bgcolor: matchedCount === mappings.length && mappings.length > 0 ? '#2E7D32' : '#5A5A5A',
              color: '#fff',
              fontSize: '0.7rem',
              height: 22,
            }}
          />
          <Box sx={{ flex: 1 }} />
          <Tooltip title="按 name + type 重新自动匹配">
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AutoFixHighIcon />}
                onClick={reAutoMatch}
                disabled={!sourceColumns.length || !targetColumns.length}
                sx={{
                  fontSize: '0.7rem',
                  color: '#90CAF9',
                  borderColor: '#5A5A5A',
                  '&:hover': { borderColor: '#90CAF9', bgcolor: '#1E3A5F' },
                }}
              >
                自动匹配
              </Button>
            </span>
          </Tooltip>
        </Box>

        {/* 主表 */}
        <TableContainer
          component={Paper}
          sx={{
            maxHeight: 480,
            bgcolor: '#252525',
            boxShadow: 'none',
          }}
        >
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ bgcolor: '#2F2F2F', color: '#BBB', fontSize: '0.75rem', fontWeight: 600, width: '30%' }}>
                  源字段
                </TableCell>
                <TableCell sx={{ bgcolor: '#2F2F2F', color: '#BBB', fontSize: '0.75rem', fontWeight: 600, width: '15%' }}>
                  源类型
                </TableCell>
                <TableCell sx={{ bgcolor: '#2F2F2F', color: '#BBB', fontSize: '0.75rem', fontWeight: 600, width: '6%', textAlign: 'center' }}>
                  →
                </TableCell>
                <TableCell sx={{ bgcolor: '#2F2F2F', color: '#BBB', fontSize: '0.75rem', fontWeight: 600, width: '30%' }}>
                  目标字段
                </TableCell>
                <TableCell sx={{ bgcolor: '#2F2F2F', color: '#BBB', fontSize: '0.75rem', fontWeight: 600, width: '15%' }}>
                  目标类型
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading && mappings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ borderColor: '#3A3A3A', textAlign: 'center', py: 4 }}>
                    <CircularProgress size={20} sx={{ color: '#90CAF9', mr: 1 }} />
                    <Typography component="span" sx={{ color: '#888', fontSize: '0.75rem' }}>
                      正在加载字段…
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : mappings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} sx={{ borderColor: '#3A3A3A', textAlign: 'center', py: 4 }}>
                    <Typography sx={{ color: '#888', fontSize: '0.75rem' }}>
                      {!sourceTable.connectionId
                        ? '请先选择源连接'
                        : !sourceTable.tableName
                        ? '请先指定源表'
                        : '源表没有可读字段'}
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                mappings.map((m, idx) => {
                  const matched = !!m.targetColumn;
                  const tcType = targetColumns.find((tc) => tc.name === m.targetColumn)?.type || m.targetType;
                  return (
                    <TableRow
                      key={`${m.sourceColumn}-${idx}`}
                      sx={{
                        '&:hover': { bgcolor: '#2F2F2F' },
                        bgcolor: matched ? 'transparent' : 'rgba(255, 167, 38, 0.04)',
                      }}
                    >
                      <TableCell
                        sx={{
                          borderColor: '#3A3A3A',
                          color: '#E0E0E0',
                          fontSize: '0.75rem',
                          fontFamily: 'monospace',
                          py: 0.15,
                        }}
                      >
                        <Tooltip title="源字段不可改">
                          <span>{m.sourceColumn}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell
                        sx={{
                          borderColor: '#3A3A3A',
                          color: '#888',
                          fontSize: '0.7rem',
                          fontFamily: 'monospace',
                          py: 0.15,
                        }}
                      >
                        {m.sourceType || '-'}
                      </TableCell>
                      <TableCell
                        sx={{
                          borderColor: '#3A3A3A',
                          color: '#666',
                          textAlign: 'center',
                          fontSize: '0.85rem',
                          py: 0.15,
                        }}
                      >
                        →
                      </TableCell>
                      <TableCell sx={{ borderColor: '#3A3A3A', py: 0.15 }}>
                        <Autocomplete
                          size="small"
                          options={targetNameOptions}
                          value={m.targetColumn || null}
                          onChange={(_, val) => {
                            const tc = targetColumns.find((t) => t.name === val);
                            updateMapping(idx, {
                              targetColumn: val || '',
                              targetType: tc?.type,
                            });
                          }}
                          slotProps={{
                            paper: {
                              sx: { bgcolor: '#3C3F41', color: '#FFFFFF', fontSize: '0.75rem' },
                            },
                          }}
                          ListboxProps={{
                            sx: {
                              fontSize: '0.75rem',
                              padding: 0,
                              '& li': { fontSize: '0.75rem', padding: '4px 8px', minHeight: 24 },
                            },
                          }}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              size="small"
                              placeholder={matched ? '' : '选择目标字段…'}
                              sx={{
                                bgcolor: matched ? '#1E3A5F' : '#3C3F41',
                                '& .MuiOutlinedInput-root': {
                                  fontSize: '0.75rem',
                                  fontFamily: 'monospace',
                                  '& fieldset': {
                                    borderColor: matched ? '#1565C0' : '#3A3A3A',
                                  },
                                },
                                '& .MuiOutlinedInput-input': { padding: '4px 8px' },
                              }}
                            />
                          )}
                        />
                      </TableCell>
                      <TableCell
                        sx={{
                          borderColor: '#3A3A3A',
                          color: '#888',
                          fontSize: '0.7rem',
                          fontFamily: 'monospace',
                          py: 0.15,
                        }}
                      >
                        {tcType || '-'}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* 目标表为空时的提示（目标表可能尚未建） */}
        {!targetLoading && targetColumns.length === 0 && targetTable.tableName && (
          <Box sx={{ px: 2, py: 1.5, bgcolor: '#3A2E1E', borderTop: '1px solid #5A4A2E', mb: 1.5 }}>
            <Typography sx={{ color: '#FFB74D', fontSize: '0.75rem' }}>
              ⚠ 目标表「{targetTable.tableName}」暂不存在或读不到字段。导出时会按「不存在则自动建表」自动建表（沿用源字段）。
            </Typography>
          </Box>
        )}
      </DialogContent>

      <Divider sx={{ borderColor: '#3A3A3A' }} />

      <DialogActions sx={{ bgcolor: '#2B2B2B', px: 2, py: 1.5 }}>
        <Typography sx={{ color: '#888', fontSize: '0.7rem', mr: 'auto' }}>
          提示：相同 name + type 自动配对；可在右侧下拉手动调整。
        </Typography>
        <Button onClick={onClose} sx={{ color: '#BBB' }}>
          取消
        </Button>
        <Button
          onClick={() => onSave(mappings)}
          variant="contained"
          sx={{
            bgcolor: '#1565C0',
            '&:hover': { bgcolor: '#1976D2' },
          }}
        >
          确定
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FieldMappingDialog;