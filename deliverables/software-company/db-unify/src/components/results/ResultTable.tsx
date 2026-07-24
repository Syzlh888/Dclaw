import React from 'react';
import { Box, Input, Snackbar, useTheme, IconButton, Popover, TextField, Badge, Typography } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ContentPasteGoIcon from '@mui/icons-material/ContentPasteGo';
import IntegrationInstructionsIcon from '@mui/icons-material/IntegrationInstructions';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import LabelIcon from '@mui/icons-material/Label';
import BlockIcon from '@mui/icons-material/Block';
import ViewStreamIcon from '@mui/icons-material/ViewStream';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import FilterListIcon from '@mui/icons-material/FilterList';
import FilterAltOffIcon from '@mui/icons-material/FilterAltOff';
import { DiffType } from '../../types/result';
import type { ResultRow } from '../../types/result';
import { useThemeMode } from '../../contexts/ThemeModeContext';
import ContextMenu from '../common/ContextMenu';
import type { ContextMenuItemDef } from '../common/ContextMenu';

interface ResultTableProps {
  columns: string[];
  rows: ResultRow[];
  highlightDiff?: boolean;
  onRowClick?: (row: ResultRow) => void;
  height?: number | string;
  /** 是否允许编辑单元格 */
  editable?: boolean;
  /** 编辑后的变更：rowIndex → colName → 新值 */
  modifiedCells?: Record<number, Record<string, string>>;
  /** 编辑变更回调 */
  onCellsChanged?: (cells: Record<number, Record<string, string>>) => void;
  /** 滚动到底部时的回调（用于无限滚动加载更多） */
  onScrollBottom?: () => void;
  /** 是否正在加载更多行 */
  loadingMore?: boolean;
  /** 是否还有更多数据 */
  hasMore?: boolean;
}

const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTH = 150;
/** 行号列宽度 */
const ROW_NUM_WIDTH = 50;

/** 右键菜单目标信息 */
interface CtxTarget {
  anchor: { left: number; top: number };
  /** 右键类型：单元格 / 行 / 列 */
  type: 'cell' | 'row' | 'column';
  /** 行索引（对应 sortedRows，cell/row 类型有值） */
  rowIndex: number;
  /** 列名（cell/column 类型有值） */
  colName?: string;
}

/** 选择区域的单元格坐标 */
interface CellCoord {
  rowIndex: number;
  colIndex: number;
}

/** 获取单元格的原始值字符串 */
function getCellRaw(row: ResultRow, col: string): string {
  const cv = row.values[col];
  if (!cv) return '';
  if (cv.value === null || cv.value === undefined) return '';
  return String(cv.value);
}

/** 判断是否为 NULL */
function isCellNull(row: ResultRow, col: string): boolean {
  const cv = row.values[col];
  if (!cv) return true;
  return cv.value === null || cv.value === undefined;
}

/** 格式化列名为 SQL 标识符（简单转义） */
function quoteSqlName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** 格式化值为 SQL 字面量 */
function quoteSqlValue(val: string, isNull: boolean): string {
  if (isNull) return 'NULL';
  if (val !== '' && !isNaN(Number(val)) && isFinite(Number(val))) {
    return val;
  }
  return `'${val.replace(/'/g, "''")}'`;
}

/**
 * 判断两个 CellCoord 是否在矩形选择区域内
 * 返回 [minRow, maxRow, minCol, maxCol]
 */
function getSelectionBounds(
  a: CellCoord,
  b: CellCoord,
): { minRow: number; maxRow: number; minCol: number; maxCol: number } {
  const minRow = Math.min(a.rowIndex, b.rowIndex);
  const maxRow = Math.max(a.rowIndex, b.rowIndex);
  const minCol = Math.min(a.colIndex, b.colIndex);
  const maxCol = Math.max(a.colIndex, b.colIndex);
  return { minRow, maxRow, minCol, maxCol };
}

const ResultTable: React.FC<ResultTableProps> = ({
  columns,
  rows,
  highlightDiff = false,
  onRowClick,
  height = 400,
  editable = false,
  modifiedCells,
  onCellsChanged,
  onScrollBottom,
  loadingMore = false,
  hasMore = false,
}) => {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const { scale } = useThemeMode();
  const theme = useTheme();
  const tableFontSize = `${0.8 * scale}rem`;
  const rowHeight = Math.round(36 * scale);
  const [editingCell, setEditingCell] = React.useState<{ rowIdx: number; col: string } | null>(null);
  const [editValue, setEditValue] = React.useState('');

  // 跟踪最新的 modifiedCells 以避免快速连续编辑时的 stale closure
  const modifiedCellsRef = React.useRef(modifiedCells);
  React.useEffect(() => { modifiedCellsRef.current = modifiedCells; }, [modifiedCells]);

  // ─── 右键菜单状态 ───
  const [ctxTarget, setCtxTarget] = React.useState<CtxTarget | null>(null);
  const [snackOpen, setSnackOpen] = React.useState(false);
  const [snackMsg, setSnackMsg] = React.useState('');

  // ─── 多选状态 ───
  const [selectionStart, setSelectionStart] = React.useState<CellCoord | null>(null);
  const [selectionEnd, setSelectionEnd] = React.useState<CellCoord | null>(null);
  const [isSelecting, setIsSelecting] = React.useState(false);
  // 跟踪鼠标是否按下，用于区分拖拽选择和单击
  const mouseDownRef = React.useRef<{ row: number; col: number; x: number; y: number } | null>(null);
  const hasDraggedRef = React.useRef(false);

  // ─── 行多选状态 ───
  const [selectedIndices, setSelectedIndices] = React.useState<Set<number>>(new Set());
  const lastClickedRef = React.useRef<number>(-1);
  // 鼠标拖拽选择行
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragStartIndex, setDragStartIndex] = React.useState(-1);

  /** 是否有有效的选中区域 */
  const hasSelection =
    selectionStart !== null &&
    selectionEnd !== null &&
    !(selectionStart.rowIndex === selectionEnd.rowIndex && selectionStart.colIndex === selectionEnd.colIndex);

  /** 获取选中区域的边界 */
  const selBounds = React.useMemo(() => {
    if (!selectionStart || !selectionEnd) return null;
    return getSelectionBounds(selectionStart, selectionEnd);
  }, [selectionStart, selectionEnd]);

  /** 检查某个单元格是否在选中区域内 */
  const isCellSelected = React.useCallback(
    (rowIndex: number, colIndex: number): boolean => {
      if (!selBounds) return false;
      return (
        rowIndex >= selBounds.minRow &&
        rowIndex <= selBounds.maxRow &&
        colIndex >= selBounds.minCol &&
        colIndex <= selBounds.maxCol
      );
    },
    [selBounds],
  );

  /** 清除选中区域 */
  const clearSelection = React.useCallback(() => {
    setSelectionStart(null);
    setSelectionEnd(null);
    setIsSelecting(false);
  }, []);

  // ─── 滚动触底检测（无限滚动） ───
  React.useEffect(() => {
    const el = parentRef.current;
    if (!el || !onScrollBottom) return;
    let ticking = false;
    const handleScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = el;
        // 距底部 20px 以内触发加载
        if (scrollHeight - scrollTop - clientHeight <= 20) {
          onScrollBottom();
        }
        ticking = false;
      });
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [onScrollBottom]);

  // ─── 全局 mouseup：结束拖拽选择 ───
  React.useEffect(() => {
    const handleMouseUp = () => {
      if (isSelecting) {
        setIsSelecting(false);
      }
      mouseDownRef.current = null;
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [isSelecting]);

  // ─── 全局 mouseup：结束行拖选 ───
  React.useEffect(() => {
    const handleUp = () => setIsDragging(false);
    document.addEventListener('mouseup', handleUp);
    return () => document.removeEventListener('mouseup', handleUp);
  }, []);

  const handleCellDoubleClick = (rowIdx: number, col: string, currentVal: string) => {
    if (!editable) return;
    setEditingCell({ rowIdx, col });
    setEditValue(currentVal);
  };

  const handleEditConfirm = () => {
    if (!editingCell || !onCellsChanged) { setEditingCell(null); return; }
    const { rowIdx, col } = editingCell;
    const latestCells = modifiedCellsRef.current || {};
    const current = latestCells[rowIdx]?.[col];
    if (editValue === (current ?? String(rows[rowIdx]?.values[col]?.value ?? ''))) {
      setEditingCell(null);
      return;
    }
    const next = { ...latestCells };
    if (!next[rowIdx]) next[rowIdx] = {};
    next[rowIdx] = { ...next[rowIdx], [col]: editValue };
    onCellsChanged(next);
    setEditingCell(null);
  };

  // 排序状态
  const [sortCol, setSortCol] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<'asc' | 'desc'>('asc');

  const handleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  // ─── 过滤状态 ───
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [filterAnchorEl, setFilterAnchorEl] = React.useState<HTMLElement | null>(null);
  const [filterCol, setFilterCol] = React.useState<string | null>(null);
  const [filterInput, setFilterInput] = React.useState('');

  /** 打开某列的过滤器 Popover */
  const openFilterPopover = (e: React.MouseEvent<HTMLElement>, col: string) => {
    e.stopPropagation();
    setFilterCol(col);
    setFilterInput(filters[col] ?? '');
    setFilterAnchorEl(e.currentTarget);
  };

  const closeFilterPopover = () => {
    setFilterAnchorEl(null);
    setFilterCol(null);
  };

  const applyFilter = () => {
    if (filterCol !== null) {
      setFilters(prev => ({ ...prev, [filterCol]: filterInput }));
    }
    closeFilterPopover();
  };

  const clearColumnFilter = (col: string) => {
    setFilters(prev => {
      const next = { ...prev };
      delete next[col];
      return next;
    });
  };

  const clearAllFilters = () => {
    setFilters({});
  };

  /** 当前是否有任意活跃的过滤条件 */
  const hasActiveFilters = Object.values(filters).some(v => v !== '');

  // 排序后的 rows
  const sortedRows = React.useMemo(() => {
    if (!sortCol) return rows;
    return [...rows].sort((a, b) => {
      const va = a.values[sortCol]?.value;
      const vb = b.values[sortCol]?.value;
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const na = Number(va), nb = Number(vb);
      if (!isNaN(na) && !isNaN(nb)) {
        return sortDir === 'asc' ? na - nb : nb - na;
      }
      const cmp = String(va).localeCompare(String(vb), 'zh-CN');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sortCol, sortDir]);

  // 过滤后的 rows（先排序后过滤）
  const filteredRows = React.useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v !== '');
    if (active.length === 0) return sortedRows;
    return sortedRows.filter(row =>
      active.every(([col, keyword]) => {
        const val = getCellRaw(row, col).toLowerCase();
        return val.includes(keyword.toLowerCase());
      }),
    );
  }, [sortedRows, filters]);

  // 用 ref 缓存 filteredRows，供键盘事件 handler 使用
  const filteredRowsRef = React.useRef(filteredRows);
  React.useEffect(() => { filteredRowsRef.current = filteredRows; }, [filteredRows]);

  // ─── 全局键盘事件：Ctrl+C 复制选中区域 ───
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'c' && hasSelection && selBounds) {
        e.preventDefault();
        const rows = filteredRowsRef.current;
        // 构建 TSV 文本
        const lines: string[] = [];
        for (let ri = selBounds.minRow; ri <= selBounds.maxRow; ri++) {
          const row = rows[ri];
          if (!row) continue;
          const line: string[] = [];
          for (let ci = selBounds.minCol; ci <= selBounds.maxCol; ci++) {
            if (ci >= columns.length) continue;
            const col = columns[ci];
            line.push(getCellRaw(row, col));
          }
          lines.push(line.join('\t'));
        }
        const text = lines.join('\n');
        navigator.clipboard.writeText(text).then(
          () => {
            setSnackMsg(`已复制 ${selBounds.maxRow - selBounds.minRow + 1} 行 × ${selBounds.maxCol - selBounds.minCol + 1} 列`);
            setSnackOpen(true);
          },
          () => {
            setSnackMsg('复制失败');
            setSnackOpen(true);
          },
        );
      }
      // Esc 清除选中
      if (e.key === 'Escape' && hasSelection) {
        clearSelection();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [hasSelection, selBounds, columns, clearSelection]);

  // 初始化列宽
  const initWidths = React.useMemo(() => {
    return columns.map((col) => {
      const headerWidth = col.length * 9 + 28;
      let maxContentLen = 0;
      const sampleSize = Math.min(30, sortedRows.length);
      for (let i = 0; i < sampleSize; i++) {
        const cell = sortedRows[i]?.values[col];
        const text = String(cell?.value ?? '');
        maxContentLen = Math.max(maxContentLen, text.length);
      }
      const contentWidth = maxContentLen * 7.5 + 28;
      return Math.min(400, Math.max(DEFAULT_COL_WIDTH, Math.max(headerWidth, contentWidth)));
    });
  }, [columns, sortedRows]);

  const [colWidths, setColWidths] = React.useState<number[]>([]);

  // 当 columns 变化时重新初始化列宽（保留已有列的宽度）
  React.useEffect(() => {
    setColWidths((prev) => {
      if (prev.length === columns.length) return prev;
      return initWidths;
    });
  }, [columns.length, initWidths]);

  // 计算所有列的总宽度（含行号列），用于横向滚动
  const totalWidth = React.useMemo(() => {
    const dataWidth = colWidths.length === 0
      ? columns.length * DEFAULT_COL_WIDTH
      : colWidths.reduce((sum, w) => sum + (w ?? DEFAULT_COL_WIDTH), 0);
    return ROW_NUM_WIDTH + dataWidth;
  }, [colWidths, columns.length]);

  // 拖拽调整列宽
  const dragRef = React.useRef<{
    index: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  const handleMouseDown = (e: React.MouseEvent, idx: number) => {
    e.preventDefault();
    dragRef.current = {
      index: idx,
      startX: e.clientX,
      startWidth: colWidths[idx] ?? DEFAULT_COL_WIDTH,
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  React.useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { index, startX, startWidth } = dragRef.current;
      const newWidth = Math.max(MIN_COL_WIDTH, startWidth + (e.clientX - startX));
      setColWidths((prev) => {
        const next = [...prev];
        next[index] = newWidth;
        return next;
      });
    };
    const handleUp = () => {
      dragRef.current = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const rowVirtualizer = useVirtualizer({
    count: filteredRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
  });

  const getCellStyle = (diffType: DiffType): React.CSSProperties => {
    if (!highlightDiff) return {};
    switch (diffType) {
      case DiffType.Different:
        return { backgroundColor: '#FFF3E0' };
      case DiffType.Missing:
        return { backgroundColor: '#FFEBEE' };
      default:
        return {};
    }
  };

  const containerHeight = typeof height === 'number' ? height : '100%';
  const virtualRowsHeight = rowVirtualizer.getTotalSize();

  // ─── 剪贴板工具函数 ───
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        setSnackMsg(`已复制: ${label}`);
        setSnackOpen(true);
      },
      () => {
        setSnackMsg('复制失败');
        setSnackOpen(true);
      },
    );
  };

  // ─── 复制选中区域（含表头） ───
  const copySelectionWithHeaders = () => {
    if (!selBounds) return;
    const lines: string[] = [];
    // 表头行
    const headerLine: string[] = [];
    for (let ci = selBounds.minCol; ci <= selBounds.maxCol; ci++) {
      if (ci < columns.length) {
        headerLine.push(columns[ci]);
      }
    }
    lines.push(headerLine.join('\t'));
    // 数据行
    for (let ri = selBounds.minRow; ri <= selBounds.maxRow; ri++) {
      const row = filteredRows[ri];
      if (!row) continue;
      const line: string[] = [];
      for (let ci = selBounds.minCol; ci <= selBounds.maxCol; ci++) {
        if (ci < columns.length) {
          line.push(getCellRaw(row, columns[ci]));
        }
      }
      lines.push(line.join('\t'));
    }
    copyToClipboard(
      lines.join('\n'),
      `${selBounds.maxRow - selBounds.minRow + 1} 行 × ${selBounds.maxCol - selBounds.minCol + 1} 列 (含表头)`,
    );
  };

  // ─── 只复制选中区域数据（不含表头） ───
  const copySelectionData = () => {
    if (!selBounds) return;
    const lines: string[] = [];
    for (let ri = selBounds.minRow; ri <= selBounds.maxRow; ri++) {
      const row = filteredRows[ri];
      if (!row) continue;
      const line: string[] = [];
      for (let ci = selBounds.minCol; ci <= selBounds.maxCol; ci++) {
        if (ci < columns.length) {
          line.push(getCellRaw(row, columns[ci]));
        }
      }
      lines.push(line.join('\t'));
    }
    copyToClipboard(
      lines.join('\n'),
      `${selBounds.maxRow - selBounds.minRow + 1} 行 × ${selBounds.maxCol - selBounds.minCol + 1} 列`,
    );
  };

  // ─── 单元格右键菜单项 ───
  const buildCellMenuItems = (): ContextMenuItemDef[] => {
    if (!ctxTarget || ctxTarget.type !== 'cell' || ctxTarget.colName === undefined) return [];
    const row = filteredRows[ctxTarget.rowIndex];
    if (!row) return [];
    const col = ctxTarget.colName;
    const rawVal = getCellRaw(row, col);
    const isNull = isCellNull(row, col);

    const items: ContextMenuItemDef[] = [];

    // 如果有选中区域，显示区域复制选项
    if (hasSelection && selBounds) {
      items.push({
        label: '复制 (含表头)',
        icon: <ContentCopyIcon sx={{ fontSize: 15 }} />,
        onClick: () => copySelectionWithHeaders(),
      });
      items.push({
        label: '复制',
        icon: <ContentPasteGoIcon sx={{ fontSize: 15 }} />,
        onClick: () => copySelectionData(),
        divider: true,
      });
    }

    // 单元格级复制
    items.push({
      label: '复制单元格值',
      icon: <ContentPasteGoIcon sx={{ fontSize: 15 }} />,
      onClick: () => copyToClipboard(rawVal, rawVal.substring(0, 40) + (rawVal.length > 40 ? '...' : '')),
      disabled: rawVal === '',
    });
    items.push({
      label: '复制为 NULL',
      icon: <BlockIcon sx={{ fontSize: 15 }} />,
      onClick: () => copyToClipboard(isNull ? '(NULL)' : 'NULL', 'NULL'),
    });
    items.push({
      label: '复制列名',
      icon: <LabelIcon sx={{ fontSize: 15 }} />,
      onClick: () => copyToClipboard(col, col),
    });
    return items;
  };

  // ─── 行右键菜单项 ───
  const buildRowMenuItems = (): ContextMenuItemDef[] => {
    if (!ctxTarget || ctxTarget.type !== 'row') return [];
    const row = filteredRows[ctxTarget.rowIndex];
    if (!row) return [];

    const items: ContextMenuItemDef[] = [];

    // 如果有选中区域，显示区域复制选项
    if (hasSelection && selBounds) {
      items.push({
        label: '复制 (含表头)',
        icon: <ContentCopyIcon sx={{ fontSize: 15 }} />,
        onClick: () => copySelectionWithHeaders(),
      });
      items.push({
        label: '复制',
        icon: <ContentPasteGoIcon sx={{ fontSize: 15 }} />,
        onClick: () => copySelectionData(),
        divider: true,
      });
    }

    items.push({
      label: '复制整行 (TSV)',
      icon: <ViewStreamIcon sx={{ fontSize: 15 }} />,
      onClick: () => {
        const tsv = columns.map((col) => getCellRaw(row, col)).join('\t');
        copyToClipboard(tsv, `第 ${ctxTarget.rowIndex + 1} 行 (TSV)`);
      },
    });
    items.push({
      label: '复制为 INSERT SQL',
      icon: <IntegrationInstructionsIcon sx={{ fontSize: 15 }} />,
      onClick: () => {
        const colNames = columns.map(quoteSqlName).join(', ');
        const colValues = columns
          .map((col) => quoteSqlValue(getCellRaw(row, col), isCellNull(row, col)))
          .join(', ');
        const sql = `INSERT INTO table_name (${colNames}) VALUES (${colValues});`;
        copyToClipboard(sql, `第 ${ctxTarget.rowIndex + 1} 行 (INSERT)`);
      },
    });
    items.push({
      label: '导出选中行 (CSV)',
      icon: <SaveAltIcon sx={{ fontSize: 15 }} />,
      onClick: () => {
        const header = columns.join(',');
        const csvRow = columns
          .map((col) => {
            const val = getCellRaw(row, col);
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
              return `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          })
          .join(',');
        const csv = `\uFEFF${header}\n${csvRow}`;
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `row_${ctxTarget.rowIndex + 1}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setSnackMsg(`已导出: row_${ctxTarget.rowIndex + 1}.csv`);
        setSnackOpen(true);
      },
    });
    return items;
  };

  // ─── 列右键菜单项 ───
  const buildColumnMenuItems = (): ContextMenuItemDef[] => {
    if (!ctxTarget || ctxTarget.type !== 'column' || ctxTarget.colName === undefined) return [];
    const col = ctxTarget.colName;

    const items: ContextMenuItemDef[] = [];

    items.push({
      label: '复制列',
      icon: <ContentPasteGoIcon sx={{ fontSize: 15 }} />,
      onClick: () => {
        const lines = filteredRows.map((row) => getCellRaw(row, col));
        const text = lines.join('\n');
        copyToClipboard(text, `列 ${col} (${lines.length} 行)`);
      },
    });
    items.push({
      label: '复制列 (含表头)',
      icon: <ContentCopyIcon sx={{ fontSize: 15 }} />,
      divider: true,
      onClick: () => {
        const lines = [col, ...filteredRows.map((row) => getCellRaw(row, col))];
        const text = lines.join('\n');
        copyToClipboard(text, `列 ${col} (含表头, ${lines.length - 1} 行)`);
      },
    });
    items.push({
      label: '复制列名',
      icon: <LabelIcon sx={{ fontSize: 15 }} />,
      onClick: () => copyToClipboard(col, col),
    });

    return items;
  };

  // ─── 单元格鼠标按下（开始选择） ───
  const handleCellMouseDown = (rowIndex: number, colIndex: number, e: React.MouseEvent) => {
    // 双击编辑优先
    if (e.detail === 2) return;

    mouseDownRef.current = { row: rowIndex, col: colIndex, x: e.clientX, y: e.clientY };
    hasDraggedRef.current = false;

    // Ctrl/Shift 扩展选择
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+点击：覆盖当前选择
      setSelectionStart({ rowIndex, colIndex });
      setSelectionEnd({ rowIndex, colIndex });
      setIsSelecting(true);
    } else if (e.shiftKey && selectionStart) {
      // Shift+点击：扩展选择
      setSelectionEnd({ rowIndex, colIndex });
      setIsSelecting(true);
    } else {
      // 普通点击：开始新选择
      setSelectionStart({ rowIndex, colIndex });
      setSelectionEnd({ rowIndex, colIndex });
      setIsSelecting(true);
    }
  };

  // ─── 全局 mousemove：拖拽扩展选择 ───
  React.useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isSelecting || !parentRef.current) return;
      if (dragRef.current) return; // 正在拖拽列宽，不处理选择

      const md = mouseDownRef.current;
      if (md) {
        // 判断是否拖拽了足够距离（避免点击误触）
        const dx = Math.abs(e.clientX - md.x);
        const dy = Math.abs(e.clientY - md.y);
        if (dx < 3 && dy < 3) return;
        hasDraggedRef.current = true;
      }

      // 阻止默认文字选择
      e.preventDefault();

      // 通过鼠标坐标查找对应的单元格
      const containerRect = parentRef.current.getBoundingClientRect();
      const scrollLeft = parentRef.current.scrollLeft;
      const scrollTop = parentRef.current.scrollTop;

      // 计算相对坐标
      const relX = e.clientX - containerRect.left + scrollLeft - ROW_NUM_WIDTH;
      const relY = e.clientY - containerRect.top + scrollTop;

      // 查找列索引
      let colIdx = -1;
      let accWidth = 0;
      for (let i = 0; i < columns.length; i++) {
        accWidth += colWidths[i] ?? DEFAULT_COL_WIDTH;
        if (relX < accWidth) {
          colIdx = i;
          break;
        }
      }
      if (colIdx === -1) colIdx = columns.length - 1;

      // 查找行索引
      const rowIdx = Math.floor(relY / rowHeight);
      const clampedRow = Math.max(0, Math.min(filteredRows.length - 1, rowIdx));

      if (clampedRow >= 0 && clampedRow < filteredRows.length) {
        setSelectionEnd({ rowIndex: clampedRow, colIndex: colIdx });
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    return () => document.removeEventListener('mousemove', handleMouseMove);
  }, [isSelecting, columns.length, colWidths, rowHeight, filteredRows.length]);

  // ─── 单元格单击（在 mouseUp 后触发，非拖拽时处理行点击） ───
  const handleCellClick = (rowIndex: number, colIndex: number) => {
    if (!hasDraggedRef.current && selectionStart && selectionEnd) {
      const isSame =
        selectionStart.rowIndex === selectionEnd.rowIndex &&
        selectionStart.colIndex === selectionEnd.colIndex;
      if (isSame && onRowClick && !editable) {
        // 如果只是单击了一个单元格且没有拖拽，触发行点击
        const row = filteredRows[rowIndex];
        if (row) onRowClick(row);
      }
    }
  };

  // ─── 右键菜单关闭 ───
  const handleCloseCtx = () => setCtxTarget(null);

  // 根据当前目标选择菜单项
  const ctxItems: ContextMenuItemDef[] =
    !ctxTarget ? [] : ctxTarget.type === 'cell' ? buildCellMenuItems() : ctxTarget.type === 'column' ? buildColumnMenuItems() : buildRowMenuItems();

  // 深色/浅色适配行号列颜色
  const rowNumBgColor = theme.palette.mode === 'dark'
    ? theme.palette.background.paper
    : theme.palette.background.default;
  const rowNumTextColor = theme.palette.text.disabled;
  const selectedBgColor = theme.palette.mode === 'dark'
    ? 'rgba(25, 118, 210, 0.12)'
    : 'rgba(25, 118, 210, 0.12)';
  /** 行选中背景色（青色半透明） */
  const rowSelectedBgColor = 'action.selected';

  return (
    <Box
      sx={{
        height: containerHeight,
        width: '100%',
        overflowX: 'auto',
        overflowY: 'hidden',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        userSelect: isSelecting ? 'none' : undefined,
      }}
    >
      {/* Inner scroll container (handles vertical scroll via virtualizer) */}
      <Box
        ref={parentRef}
        sx={{
          height: '100%',
          minWidth: totalWidth > 0 ? totalWidth : '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            position: 'sticky',
            top: 0,
            zIndex: 2,
            bgcolor: 'background.paper',
            borderBottom: '2px solid',
            borderColor: 'divider',
            width: totalWidth,
          }}
        >
          <Box
            sx={{
              width: ROW_NUM_WIDTH,
              minWidth: ROW_NUM_WIDTH,
              flex: '0 0 auto',
              position: 'sticky',
              left: 0,
              zIndex: 3,
              bgcolor: rowNumBgColor,
              px: 0.5,
              py: 0.75,
              fontSize: tableFontSize,
              fontWeight: 600,
              color: rowNumTextColor,
              borderRight: '1px solid',
              borderColor: 'divider',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              userSelect: 'none',
            }}
          >
            {selectedIndices.size > 0 ? (
              <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'primary.main' }}>
                {selectedIndices.size} 行
              </Typography>
            ) : hasActiveFilters ? (
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); clearAllFilters(); }}
                title="清除全部过滤"
                sx={{ color: 'primary.main', p: 0.25 }}
              >
                <FilterAltOffIcon sx={{ fontSize: 14 }} />
              </IconButton>
            ) : (
              <Typography variant="caption" sx={{ fontSize: '0.6rem', color: 'text.disabled' }}>#</Typography>
            )}
          </Box>

          {columns.map((col, idx) => (
            <Box
              key={col}
              onClick={() => handleSort(col)}
              onContextMenu={(e) => {
                e.preventDefault();
                setCtxTarget({
                  anchor: { left: e.clientX, top: e.clientY },
                  type: 'column',
                  rowIndex: 0,
                  colName: col,
                });
              }}
              sx={{
                width: colWidths[idx] ?? DEFAULT_COL_WIDTH,
                flex: '0 0 auto',
                px: 1.5,
                py: 0.75,
                fontSize: tableFontSize,
                fontWeight: 600,
                color: 'text.primary',
                borderRight: '1px solid',
                borderColor: 'divider',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                position: 'relative',
                cursor: 'pointer',
                userSelect: 'none',
                '&:hover': { bgcolor: 'action.hover' },
                display: 'flex',
                alignItems: 'center',
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</span>
              {sortCol === col && (
                sortDir === 'asc'
                  ? <ArrowUpwardIcon sx={{ fontSize: 14, ml: 0.25, flexShrink: 0, color: 'primary.main' }} />
                  : <ArrowDownwardIcon sx={{ fontSize: 14, ml: 0.25, flexShrink: 0, color: 'primary.main' }} />
              )}
              {/* 过滤器图标 */}
              <IconButton
                size="small"
                onClick={(e) => openFilterPopover(e, col)}
                sx={{
                  ml: 0.25,
                  p: 0.25,
                  flexShrink: 0,
                  color: filters[col] ? 'primary.main' : 'action.disabled',
                  '&:hover': { color: 'primary.main' },
                }}
              >
                <Badge
                  variant="dot"
                  color="primary"
                  invisible={!filters[col]}
                  overlap="circular"
                >
                  <FilterListIcon sx={{ fontSize: 14 }} />
                </Badge>
              </IconButton>
              {/* 拖拽手柄 */}
              <Box
                onMouseDown={(e) => handleMouseDown(e, idx)}
                sx={{
                  position: 'absolute',
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: 6,
                  cursor: 'col-resize',
                  zIndex: 2,
                  '&:hover': { backgroundColor: 'action.selected' },
                }}
              />
            </Box>
          ))}
        </Box>

        {/* ─── 列过滤器 Popover ─── */}
        <Popover
          open={Boolean(filterAnchorEl)}
          anchorEl={filterAnchorEl}
          onClose={closeFilterPopover}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
          slotProps={{
            paper: {
              sx: { p: 1.5, width: 220 },
            },
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <TextField
              size="small"
              autoFocus
              placeholder="过滤关键词..."
              value={filterInput}
              onChange={(e) => setFilterInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyFilter();
                if (e.key === 'Escape') closeFilterPopover();
              }}
              variant="outlined"
              sx={{ fontSize: '0.85rem' }}
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
              <IconButton
                size="small"
                onClick={() => {
                  if (filterCol) clearColumnFilter(filterCol);
                  closeFilterPopover();
                }}
                disabled={!filterCol || !filters[filterCol]}
                sx={{ fontSize: '0.8rem', color: 'text.secondary' }}
              >
                清除
              </IconButton>
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <IconButton
                  size="small"
                  onClick={closeFilterPopover}
                  sx={{ fontSize: '0.8rem', color: 'text.secondary' }}
                >
                  取消
                </IconButton>
                <IconButton
                  size="small"
                  onClick={applyFilter}
                  color="primary"
                  sx={{ fontSize: '0.8rem' }}
                >
                  确定
                </IconButton>
              </Box>
            </Box>
          </Box>
        </Popover>

        {/* Virtual rows */}
        <Box sx={{ position: 'relative', height: virtualRowsHeight, width: totalWidth }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = filteredRows[virtualRow.index];
            return (
              <Box
                key={virtualRow.index}
                sx={{
                  position: 'absolute',
                  top: virtualRow.start,
                  left: 0,
                  width: totalWidth,
                  display: 'flex',
                  minHeight: rowHeight,
                  alignItems: 'center',
                  '&:hover': { bgcolor: 'action.hover' },
                  cursor: onRowClick && !isSelecting ? 'pointer' : isSelecting ? 'cell' : 'default',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  bgcolor: selectedIndices.has(virtualRow.index) ? rowSelectedBgColor : undefined,
                }}
                onClick={(e) => {
                  // 行多选：Shift 范围选择 / Ctrl 多选 / 普通单选
                  if (e.shiftKey && lastClickedRef.current >= 0) {
                    const start = Math.min(lastClickedRef.current, virtualRow.index);
                    const end = Math.max(lastClickedRef.current, virtualRow.index);
                    const next = new Set<number>();
                    for (let i = start; i <= end; i++) next.add(i);
                    setSelectedIndices(next);
                  } else if (e.ctrlKey || e.metaKey) {
                    setSelectedIndices(prev => {
                      const next = new Set(prev);
                      if (next.has(virtualRow.index)) next.delete(virtualRow.index);
                      else next.add(virtualRow.index);
                      return next;
                    });
                  } else {
                    setSelectedIndices(new Set([virtualRow.index]));
                  }
                  lastClickedRef.current = virtualRow.index;
                  // 仍然触发行点击回调（仅普通点击）
                  if (onRowClick && !isSelecting && !hasDraggedRef.current && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
                    onRowClick(row);
                  }
                }}
                onMouseDown={(e) => {
                  if (e.button === 0) {
                    setIsDragging(true);
                    setDragStartIndex(virtualRow.index);
                    setSelectedIndices(new Set([virtualRow.index]));
                    lastClickedRef.current = virtualRow.index;
                  }
                }}
                onMouseEnter={(e) => {
                  if (isDragging && e.buttons === 1) {
                    const start = Math.min(dragStartIndex, virtualRow.index);
                    const end = Math.max(dragStartIndex, virtualRow.index);
                    const next = new Set<number>();
                    for (let i = start; i <= end; i++) next.add(i);
                    setSelectedIndices(next);
                  }
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  // 如果当前右键位置在选中区域内，保留选中；否则清除旧选中
                  setCtxTarget({
                    anchor: { left: e.clientX, top: e.clientY },
                    type: 'row',
                    rowIndex: virtualRow.index,
                  });
                }}
              >
                {/* 行号列 */}
                <Box
                  sx={{
                    width: ROW_NUM_WIDTH,
                    minWidth: ROW_NUM_WIDTH,
                    flex: '0 0 auto',
                    position: 'sticky',
                    left: 0,
                    zIndex: 1,
                    bgcolor: selectedIndices.has(virtualRow.index) ? rowSelectedBgColor : rowNumBgColor,
                    px: 0.5,
                    py: 0.5,
                    fontSize: tableFontSize,
                    color: rowNumTextColor,
                    borderRight: '1px solid',
                    borderColor: 'divider',
                    textAlign: 'center',
                    userSelect: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minHeight: rowHeight,
                  }}
                >
                  {virtualRow.index + 1}
                </Box>

                {columns.map((col, idx) => {
                  const cellValue = row.values[col];
                  const cellStyle = cellValue ? getCellStyle(cellValue.diffType) : {};
                  const selected = isCellSelected(virtualRow.index, idx);
                  return (
                    <Box
                      key={col}
                      onDoubleClick={() => handleCellDoubleClick(virtualRow.index, col, String(cellValue?.value ?? ''))}
                      onMouseDown={(e) => {
                        if (e.button === 0) {
                          handleCellMouseDown(virtualRow.index, idx, e);
                        }
                      }}
                      onClick={() => handleCellClick(virtualRow.index, idx)}
                      sx={{
                        width: colWidths[idx] ?? DEFAULT_COL_WIDTH,
                        flex: '0 0 auto',
                        px: 1.5,
                        py: 0.5,
                        fontSize: tableFontSize,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        borderRight: '1px solid',
                        borderColor: 'divider',
                        bgcolor: modifiedCells?.[virtualRow.index]?.[col]
                          ? 'rgba(255, 183, 77, 0.15)'
                          : selected
                            ? selectedBgColor
                            : 'transparent',
                        cursor: editable ? 'text' : isSelecting ? 'cell' : 'default',
                        ...cellStyle,
                        // 选中高亮覆盖 diff 样式，但保留编辑高亮
                        ...(selected && !modifiedCells?.[virtualRow.index]?.[col] ? {} : {}),
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation(); // 防止冒泡到行右键
                        setCtxTarget({
                          anchor: { left: e.clientX, top: e.clientY },
                          type: 'cell',
                          rowIndex: virtualRow.index,
                          colName: col,
                        });
                      }}
                    >
                      {editingCell?.rowIdx === virtualRow.index && editingCell?.col === col ? (
                        <Input
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={handleEditConfirm}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleEditConfirm(); if (e.key === 'Escape') setEditingCell(null); }}
                          autoFocus
                          disableUnderline
                          sx={{ fontSize: tableFontSize, width: '100%' }}
                        />
                      ) : (
                        cellValue
                          ? Array.isArray(cellValue.value)
                            ? cellValue.value.join(' / ')
                            : String(cellValue.value ?? '')
                          : ''
                      )}
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>

        {/* ─── 加载更多指示器 ─── */}
        {loadingMore && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              py: 1,
              width: totalWidth,
              color: 'text.secondary',
              fontSize: tableFontSize,
            }}
          >
            加载中...
          </Box>
        )}
        {/* ─── 已加载全部数据 ─── */}
        {!hasMore && rows.length > 0 && !loadingMore && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              py: 1,
              width: totalWidth,
              color: 'text.disabled',
              fontSize: tableFontSize,
            }}
          >
            已加载全部数据
          </Box>
        )}

        {filteredRows.length === 0 && (
          <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled' }}>
            暂无数据
          </Box>
        )}
      </Box>

      {/* ─── 右键菜单 ─── */}
      <ContextMenu
        anchorPosition={ctxTarget?.anchor ?? null}
        onClose={handleCloseCtx}
        items={ctxItems}
      />

      {/* ─── 反馈 Snackbar ─── */}
      <Snackbar
        open={snackOpen}
        autoHideDuration={2000}
        onClose={() => setSnackOpen(false)}
        message={snackMsg}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </Box>
  );
};

export default ResultTable;
