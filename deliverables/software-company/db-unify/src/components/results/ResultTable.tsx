import React from 'react';
import { Box } from '@mui/material';
import { useVirtualizer } from '@tanstack/react-virtual';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { DiffType } from '../../types/result';
import type { ResultRow } from '../../types/result';
import { useThemeMode } from '../../contexts/ThemeModeContext';

interface ResultTableProps {
  columns: string[];
  rows: ResultRow[];
  highlightDiff?: boolean;
  onRowClick?: (row: ResultRow) => void;
  height?: number | string;
}

const MIN_COL_WIDTH = 60;
const DEFAULT_COL_WIDTH = 150;

const ResultTable: React.FC<ResultTableProps> = ({
  columns,
  rows,
  highlightDiff = false,
  onRowClick,
  height = 400,
}) => {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const { scale } = useThemeMode();
  // 表格字体大小随全局缩放变化
  const tableFontSize = `${0.8 * scale}rem`;
  const rowHeight = Math.round(36 * scale);

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
    count: sortedRows.length,
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

  return (
    <Box
      ref={parentRef}
      sx={{
        height: typeof height === 'number' ? height : '100%',
        overflow: 'auto',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          position: 'sticky',
          top: 0,
          zIndex: 1,
          bgcolor: '#F5F5F5',
          borderBottom: '2px solid',
          borderColor: 'divider',
        }}
      >
        {columns.map((col, idx) => (
          <Box
            key={col}
            onClick={() => handleSort(col)}
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
              '&:hover': { bgcolor: 'rgba(0,0,0,0.06)' },
              display: 'flex',
              alignItems: 'center',
            }}
          >
            {col}
            {sortCol === col && (
              sortDir === 'asc'
                ? <ArrowUpwardIcon sx={{ fontSize: 14, ml: 0.5, flexShrink: 0, color: 'primary.main' }} />
                : <ArrowDownwardIcon sx={{ fontSize: 14, ml: 0.5, flexShrink: 0, color: 'primary.main' }} />
            )}
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
                '&:hover': { backgroundColor: 'rgba(0,0,0,0.15)' },
              }}
            />
          </Box>
        ))}
      </Box>

      {/* Virtual rows */}
      <Box sx={{ position: 'relative', height: rowVirtualizer.getTotalSize() }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = sortedRows[virtualRow.index];
          return (
            <Box
              key={virtualRow.index}
              sx={{
                position: 'absolute',
                top: virtualRow.start,
                left: 0,
                width: '100%',
                display: 'flex',
                minHeight: rowHeight,
                alignItems: 'center',
                '&:hover': { bgcolor: 'action.hover' },
                cursor: onRowClick ? 'pointer' : 'default',
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
              onClick={() => onRowClick?.(row)}
            >
              {columns.map((col, idx) => {
                const cellValue = row.values[col];
                const cellStyle = cellValue ? getCellStyle(cellValue.diffType) : {};
                return (
                  <Box
                    key={col}
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
                      ...cellStyle,
                    }}
                  >
                    {cellValue
                      ? Array.isArray(cellValue.value)
                        ? cellValue.value.join(' / ')
                        : String(cellValue.value ?? '')
                      : ''}
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {sortedRows.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled' }}>
          暂无数据
        </Box>
      )}
    </Box>
  );
};

export default ResultTable;
