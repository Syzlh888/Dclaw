/**
 * 表映射字段编辑器（v1.5 数据同步）
 *
 * - 用于编辑单条 SyncTableMapping 的 column_mappings
 * - 打开时拉取源表/目标表的列（POST /api/connections/:id/metadata）
 * - 自动按同名字段配对；每行 源字段 → 目标字段（下拉）
 * - 用户可"+ 添加行"补字段；行内 × 删除
 * - 顶部「自动匹配同名」按钮可重新覆盖
 * - 底部「保存 / 取消」
 *
 * 数据流：
 *   父组件（MappingListPanel / DetailPanel / SyncPage）传入 mapping + connections
 *   onSave(columnMappings) 回调把映射回传给父组件，父组件负责 PATCH /api/sync-table-mappings/:id
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
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { fetchTableColumns, type ColumnInfo } from '../../services/syncService';
import type { SyncColumnMapping, SyncTableMapping } from '../../types/sync';

interface TableMappingEditorProps {
  open: boolean;
  /** 当前正在编辑的表映射 */
  mapping: SyncTableMapping | null;
  sourceConnectionId: string;
  sourceSchema?: string;
  targetConnectionId: string;
  targetSchema?: string;
  onClose: () => void;
  /** 把修改后的 columnMappings 回传，父组件负责持久化 */
  onSave: (columnMappings: SyncColumnMapping[]) => void;
}

/** 草稿行（编辑器内部状态），source 固定，target 下拉 */
interface DraftRow {
  /** 在源表 / 目标表里都查得到，加 key 用 */
  key: string;
  source: string;
  sourceType?: string;
  target: string;
  targetType?: string;
  /** 是否为手动新增行（允许 target 为空） */
  manual?: boolean;
}

/**
 * 自动匹配：源 = 目标时，把它们的 type 也带回来；否则 target 留空
 */
function autoMatch(sourceColumns: ColumnInfo[], targetColumns: ColumnInfo[]): DraftRow[] {
  const tByName = new Map(targetColumns.map((c) => [c.name.toLowerCase(), c]));
  return sourceColumns.map((sc) => {
    const tc = tByName.get(sc.name.toLowerCase());
    return {
      key: `auto-${sc.name}`,
      source: sc.name,
      sourceType: sc.type,
      target: tc?.name || '',
      targetType: tc?.type,
    };
  });
}

/**
 * 从 mapping.columnMappings 反向生成 DraftRow，
 * 保留用户已有 target 选择。
 * 源表已有字段按 sourceColumns 顺序；mapping 里有但源表里没有的字段 → 也保留为「手动行」
 */
function rehydrate(
  sourceColumns: ColumnInfo[],
  targetColumns: ColumnInfo[],
  prevMappings: SyncColumnMapping[]
): DraftRow[] {
  const tByName = new Map(targetColumns.map((c) => [c.name.toLowerCase(), c]));
  const rows: DraftRow[] = sourceColumns.map((sc) => {
    const found = prevMappings.find((m) => (m.source || '').toLowerCase() === sc.name.toLowerCase());
    const tName = found?.target || tByName.get(sc.name.toLowerCase())?.name || '';
    return {
      key: `auto-${sc.name}`,
      source: sc.name,
      sourceType: sc.type,
      target: tName,
      targetType: tByName.get(tName.toLowerCase())?.type,
      manual: false,
    };
  });
  // mapping 里出现的、但源表里已不存在的字段 → 保留为「手动行」
  prevMappings.forEach((m, idx) => {
    if (!m.source) return;
    const inSource = sourceColumns.find((sc) => sc.name.toLowerCase() === m.source.toLowerCase());
    if (inSource) return;
    const tc = m.target ? tByName.get(m.target.toLowerCase()) : undefined;
    rows.push({
      key: `manual-${m.source}-${idx}`,
      source: m.source,
      sourceType: m.type,
      target: m.target || '',
      targetType: tc?.type || m.type,
      manual: true,
    });
  });
  return rows;
}

/** Autocomplete 内部 TextField 的统一样式（暗色） */
const darkInputSx = {
  '& .MuiOutlinedInput-root': {
    color: '#DDD',
    bgcolor: '#2B2B2B',
    fontSize: 12,
    minHeight: 32,
    '& fieldset': { borderColor: '#555' },
    '&:hover fieldset': { borderColor: '#777' },
    '&.Mui-focused fieldset': { borderColor: '#42A5F5' },
  },
  '& .MuiInputBase-input': { padding: '5px 6px' },
} as const;

const TableMappingEditor: React.FC<TableMappingEditorProps> = ({
  open,
  mapping,
  sourceConnectionId,
  sourceSchema,
  targetConnectionId,
  targetSchema,
  onClose,
  onSave,
}) => {
  const [sourceColumns, setSourceColumns] = useState<ColumnInfo[]>([]);
  const [targetColumns, setTargetColumns] = useState<ColumnInfo[]>([]);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [targetLoading, setTargetLoading] = useState(false);
  const [rows, setRows] = useState<DraftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 标记「是否已基于已保存 mapping 做 hydration」——防止每次 sourceColumns 变化都覆盖用户的编辑
  const [hydrated, setHydrated] = useState(false);

  // 每次重新打开时重置
  useEffect(() => {
    if (open) {
      setRows([]);
      setSourceColumns([]);
      setTargetColumns([]);
      setHydrated(false);
      setError(null);
    }
  }, [open]);

  // 拉源表字段
  useEffect(() => {
    if (!open || !sourceConnectionId || !mapping) return;
    let cancelled = false;
    setSourceLoading(true);
    fetchTableColumns(sourceConnectionId, mapping.source_table, sourceSchema)
      .then((cols) => {
        if (!cancelled) setSourceColumns(cols);
      })
      .catch(() => {
        if (!cancelled) {
          setSourceColumns([]);
          setError('拉取源表字段失败（请检查连接配置）');
        }
      })
      .finally(() => {
        if (!cancelled) setSourceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, sourceConnectionId, mapping?.source_table, sourceSchema]);

  // 拉目标表字段
  useEffect(() => {
    if (!open || !targetConnectionId || !mapping) return;
    let cancelled = false;
    setTargetLoading(true);
    fetchTableColumns(targetConnectionId, mapping.target_table, targetSchema)
      .then((cols) => {
        if (!cancelled) setTargetColumns(cols);
      })
      .catch(() => {
        if (!cancelled) {
          setTargetColumns([]);
          setError('拉取目标表字段失败（请检查连接配置）');
        }
      })
      .finally(() => {
        if (!cancelled) setTargetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, targetConnectionId, mapping?.target_table, targetSchema]);

  // 自动匹配：两边都加载完成后，根据是否有「已保存 mapping」决定 hydrate vs fresh auto-match
  useEffect(() => {
    if (!open) return;
    if (sourceLoading || targetLoading) return;
    if (hydrated) return;
    // 两边都没列（常见于连接拉失败）：不再生成空行，让用户手动添加
    if (sourceColumns.length === 0 && targetColumns.length === 0) {
      const saved = mapping?.column_mappings || [];
      if (saved.length > 0) {
        const next = saved.map((m, i) => ({
          key: `saved-${m.source || i}-${i}`,
          source: m.source,
          sourceType: m.type,
          target: m.target || '',
          targetType: m.type,
          manual: true,
        }));
        setRows(next);
        setHydrated(true);
      } else {
        setRows([]);
        setHydrated(true);
      }
      return;
    }
    // 已有 saved mapping → rehydrate（保留用户 target 选择）
    const saved = mapping?.column_mappings || [];
    if (saved.length > 0) {
      setRows(rehydrate(sourceColumns, targetColumns, saved));
    } else {
      // 没有保存 → 全自动同名匹配
      setRows(autoMatch(sourceColumns, targetColumns));
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceColumns, targetColumns, sourceLoading, targetLoading, open]);

  /** 目标列名列表（下拉选项） */
  const targetNameOptions = useMemo(() => targetColumns.map((c) => c.name), [targetColumns]);

  /** 已被其他行选用的 target 名，用于过滤 + 提示 */
  const usedTargets = useMemo(() => {
    const used = new Set<string>();
    rows.forEach((r) => {
      if (r.target) used.add(r.target.toLowerCase());
    });
    return used;
  }, [rows]);

  const updateRow = (key: string, patch: Partial<DraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const removeRow = (key: string) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const addManualRow = () => {
    setRows((prev) => [
      ...prev,
      {
        key: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        source: '',
        target: '',
        manual: true,
      },
    ]);
  };

  const reAutoMatch = () => {
    const saved = mapping?.column_mappings || [];
    if (saved.length > 0 && rows.length > 0) {
      // 已有 saved mapping 且当前 rows 已 hydrate → 保留当前 target；按 source 再匹配
      const newRows = rows.map((r) => {
        if (!r.source) return r;
        const tc = targetColumns.find((c) => c.name.toLowerCase() === r.source.toLowerCase());
        if (!tc) return r;
        return { ...r, target: tc.name, targetType: tc.type };
      });
      setRows(newRows);
    } else {
      setRows(autoMatch(sourceColumns, targetColumns));
    }
    setHydrated(true);
  };

  const handleSave = () => {
    const filtered = rows
      .filter((r) => r.source && r.target)
      .map((r) => ({
        source: r.source,
        target: r.target,
        type: r.sourceType || r.targetType,
      }));
    onSave(filtered);
  };

  if (!mapping) return null;

  const title = `编辑字段映射: ${mapping.source_table} → ${mapping.target_table}`;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      PaperProps={{
        sx: {
          width: 'min(880px, 94vw)',
          maxHeight: '90vh',
          m: 1,
          bgcolor: '#2B2B2B',
          color: '#BBBBBB',
          border: '1px solid #555',
        },
      }}
    >
      <DialogTitle sx={{ p: 0, m: 0, borderBottom: '1px solid #505050', bgcolor: '#3C3F41' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.25 }}>
          <AccountTreeIcon sx={{ color: '#42A5F5', mr: 1.25 }} />
          <Typography sx={{ color: '#EEE', fontWeight: 600, fontSize: 15 }}>{title}</Typography>
          <Chip
            size="small"
            label={`${rows.length} 行`}
            sx={{ ml: 1.5, height: 22, color: '#BBB', bgcolor: '#4A4A4A' }}
          />
          <Box sx={{ flex: 1 }} />
          <IconButton onClick={onClose} sx={{ color: '#BBB' }} size="small">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ p: 0, bgcolor: '#2B2B2B' }}>
        {error && (
          <Box sx={{ px: 2, py: 1, bgcolor: '#5A3030', color: '#FFCDD2', fontSize: 12 }}>{error}</Box>
        )}
        {(sourceLoading || targetLoading) && (
          <Box sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, color: '#999', fontSize: 12 }}>
            <CircularProgress size={12} sx={{ color: '#42A5F5' }} />
            加载表字段…
          </Box>
        )}

        <Box sx={{ p: 2 }}>
          <Typography sx={{ color: '#AAA', fontSize: 11, mb: 1 }}>
            源: {sourceConnectionId}
            {sourceSchema ? ` / ${sourceSchema}` : ''} · 目标: {targetConnectionId}
            {targetSchema ? ` / ${targetSchema}` : ''}
          </Typography>

          <TableContainer
            component={Paper}
            sx={{ bgcolor: '#3C3F41', border: '1px solid #505050', maxHeight: 460 }}
          >
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ bgcolor: '#3C3F41', color: '#888', fontSize: 11, borderBottom: '1px solid #505050', width: '34%' }}>
                    源字段
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#3C3F41', color: '#888', fontSize: 11, borderBottom: '1px solid #505050', width: '14%' }}>
                    源类型
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#3C3F41', color: '#888', fontSize: 11, borderBottom: '1px solid #505050', width: 36 }} align="center">
                    <ArrowForwardIcon sx={{ fontSize: 14, color: '#666' }} />
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#3C3F41', color: '#888', fontSize: 11, borderBottom: '1px solid #505050', width: '34%' }}>
                    目标字段
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#3C3F41', color: '#888', fontSize: 11, borderBottom: '1px solid #505050', width: '14%' }}>
                    目标类型
                  </TableCell>
                  <TableCell sx={{ bgcolor: '#3C3F41', borderBottom: '1px solid #505050', width: 36 }} />
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} sx={{ borderBottom: 'none', py: 4, textAlign: 'center', color: '#777', fontSize: 12 }}>
                      {sourceLoading || targetLoading
                        ? '加载中…'
                        : '未配置字段映射（点击「添加行」或「自动匹配同名」）'}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => {
                  const tc = row.target ? targetColumns.find((c) => c.name === row.target) : undefined;
                  // 排除已被其他行选用的 target（自己保留）
                  const remainingOptions = targetNameOptions.filter(
                    (n) => n === row.target || !usedTargets.has(n.toLowerCase())
                  );
                  return (
                    <TableRow
                      key={row.key}
                      sx={{
                        '&:hover': { bgcolor: '#454749' },
                        bgcolor: row.manual ? '#3D3A36' : 'transparent',
                      }}
                    >
                      <TableCell sx={{ borderBottom: '1px solid #494949', py: 0.5 }}>
                        {row.manual ? (
                          <Autocomplete
                            size="small"
                            freeSolo
                            options={sourceColumns.map((c) => c.name)}
                            value={row.source || null}
                            onChange={(_, v) => {
                              const sc = sourceColumns.find((c) => c.name === v);
                              updateRow(row.key, { source: v || '', sourceType: sc?.type });
                            }}
                            sx={darkInputSx}
                            renderInput={(params) => (
                              <TextField {...params} variant="outlined" placeholder="源字段名" />
                            )}
                            componentsProps={{ paper: { sx: { bgcolor: '#3C3F41', color: '#DDD' } } }}
                          />
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', minHeight: 32, pl: 1, color: '#DDD', fontSize: 12 }}>
                            {row.source}
                          </Box>
                        )}
                      </TableCell>
                      <TableCell sx={{ borderBottom: '1px solid #494949', py: 0.5, color: '#888', fontSize: 11.5 }}>
                        {row.sourceType || '-'}
                      </TableCell>
                      <TableCell sx={{ borderBottom: '1px solid #494949', py: 0.5, color: '#666', textAlign: 'center' }}>
                        →
                      </TableCell>
                      <TableCell sx={{ borderBottom: '1px solid #494949', py: 0.5 }}>
                        <Autocomplete
                          size="small"
                          options={remainingOptions}
                          value={row.target || null}
                          onChange={(_, v) => {
                            const tc2 = targetColumns.find((c) => c.name === v);
                            updateRow(row.key, { target: v || '', targetType: tc2?.type });
                          }}
                          renderInput={(params) => (
                            <TextField {...params} variant="outlined" placeholder="选择目标字段" />
                          )}
                          sx={darkInputSx}
                          disabled={targetColumns.length === 0}
                          componentsProps={{ paper: { sx: { bgcolor: '#3C3F41', color: '#DDD' } } }}
                        />
                      </TableCell>
                      <TableCell sx={{ borderBottom: '1px solid #494949', py: 0.5, color: '#888', fontSize: 11.5 }}>
                        {tc?.type || row.targetType || '-'}
                      </TableCell>
                      <TableCell sx={{ borderBottom: '1px solid #494949', py: 0.5, pr: 1 }}>
                        <Tooltip title="删除此行">
                          <IconButton size="small" onClick={() => removeRow(row.key)} sx={{ color: '#888', '&:hover': { color: '#EF5350' } }}>
                            <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>

          <Box sx={{ mt: 2, display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Button
              size="small"
              startIcon={<AutoFixHighIcon />}
              onClick={reAutoMatch}
              disabled={sourceColumns.length === 0}
              sx={{ color: '#BBB', '&:hover': { color: '#42A5F5', borderColor: '#42A5F5' }, border: '1px solid #606060' }}
              variant="outlined"
            >
              自动匹配同名
            </Button>
            <Button
              size="small"
              startIcon={<AddIcon />}
              onClick={addManualRow}
              sx={{ color: '#42A5F5', border: '1px solid #42A5F5' }}
              variant="outlined"
            >
              添加行
            </Button>
            <Box sx={{ flex: 1 }} />
            <Typography sx={{ color: '#888', fontSize: 11 }}>
              共 {rows.length} 行，已配对 {rows.filter((r) => r.source && r.target).length} 行
            </Typography>
          </Box>

          <Divider sx={{ my: 2, borderColor: '#494949' }} />
          <Typography sx={{ color: '#777', fontSize: 11 }}>
            提示：源列来自源表结构；目标列下拉来自目标表结构。「自动匹配同名」按 name 相同配对；同名后会自动带类型。
            无法匹配的行可点击「添加行」手动创建。「保存」会把当前配对写回表映射。
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.25, borderTop: '1px solid #505050', bgcolor: '#3C3F41' }}>
        <Button onClick={onClose} sx={{ color: '#BBB' }}>
          取消
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          startIcon={<AccountTreeIcon sx={{ fontSize: 16 }} />}
        >
          保存
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default TableMappingEditor;
