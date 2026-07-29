import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, Button, Typography, Alert, Snackbar, TextField, Menu } from '@mui/material';
import { useResultStore } from '../../stores/resultStore';
import { useEditorStore } from '../../stores/editorStore';
import { useExportStore } from '../../stores/exportStore';
import ResultTable from './ResultTable';
import ImportExportIcon from '@mui/icons-material/ImportExport';
import { exportCsv, exportExcel, exportJson } from '../../services/exporters';
import { apiFetch } from '../../services/apiClient';
import DownloadIcon from '@mui/icons-material/Download';
import SaveIcon from '@mui/icons-material/Save';
import type { ResultRow } from '../../types/result';

const ITEM_HEIGHT = 32;
const ITEM_PADDING_TOP = 4;
const MENU_PROPS = {
  PaperProps: {
    style: {
      maxHeight: 324,
      width: 138,
    },
  },
  sx: {
    '& .MuiList-root': {
      paddingTop: '6px',
      paddingBottom: '6px',
      paddingLeft: '0px',
      paddingRight: '0px',
      fontSize: '9px',
      lineHeight: '12px',
      color: '#000000DE',
      width: 138,
      height: 324,
    },
    '& .MuiMenuItem-root': {
      fontSize: '10px',
      lineHeight: '12px',
      color: '#000000DE',
      pt: '4px',
      pb: '4px',
      minHeight: 28,
      height: 28,
      width: 138,
      maxWidth: 138,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    '& .MuiPaper-root': { width: 138 },
  },
};

const SingleDbView: React.FC = () => {
  const results = useResultStore((s) => s.results);
  const selectedDbId = useResultStore((s) => s.selectedDbId);
  const setSelectedDbId = useResultStore((s) => s.setSelectedDbId);
  const [selectedSource, setSelectedSource] = useState<string>(selectedDbId || '');
  const [modifiedCells, setModifiedCells] = useState<Record<number, Record<string, string>>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; severity: 'success' | 'error' } | null>(null);
  const [exportAnchorEl, setExportAnchorEl] = useState<null | HTMLElement>(null);
  const sql = useEditorStore((s) => s.sql);

  // ─── 分页相关状态 ───
  const pageSize = useEditorStore((s) => s.pageSize);
  const setPageSize = useEditorStore((s) => s.setPageSize);
  const loadingMore = useEditorStore((s) => s.loadingMore);
  const loadMoreFn = useEditorStore((s) => s.loadMoreFn);
  const resultMeta = useEditorStore((s) => s.resultMeta);
  const rowSelections = useEditorStore((s) => s.rowSelections);
  const setRowSelections = useEditorStore((s) => s.setRowSelections);

  // 当前选中源的选中行索引列表
  const selectedRows = selectedSource ? (rowSelections[selectedSource] ?? []) : [];
  const handleSelectedRowsChange = useCallback(
    (rows: number[]) => {
      if (selectedSource) {
        setRowSelections(selectedSource, rows);
      }
    },
    [selectedSource, setRowSelections],
  );

  // 解析 SQL 获取表名（简单解析：SELECT ... FROM tableName）
  const extractTableName = (query: string): string | null => {
    const match = query.match(/\bFROM\s+[`'"]?(\w+)[`'"]?\b/i);
    return match ? match[1] : null;
  };

  const allResults = useMemo(() => Object.values(results), [results]);
  const selectedResult = selectedSource ? results[selectedSource] : undefined;

  // Transform QueryResult for ResultTable
  const tableData = useMemo(() => {
    if (!selectedResult) return { columns: [] as string[], rows: [] as ResultRow[] };
    return {
      columns: selectedResult.columns,
      rows: selectedResult.rows,
    };
  }, [selectedResult]);

  const handleSave = useCallback(async () => {
    if (!selectedResult || !selectedSource || Object.keys(modifiedCells).length === 0) return;
    let tableName = extractTableName(sql);
    if (!tableName) {
      tableName = window.prompt('无法从 SQL 中识别表名，请输入要更新的表名：');
      if (!tableName) return;
    }
    setSaving(true);
    try {
      const updates: string[] = [];
      for (const [rowIdxStr, cols] of Object.entries(modifiedCells)) {
        const rowIdx = Number(rowIdxStr);
        const row = selectedResult.rows[rowIdx];
        if (!row) continue;
        const setClauses: string[] = [];
        const whereClauses: string[] = [];
        for (const [col, newVal] of Object.entries(cols)) {
          const origVal = row.values[col]?.value;
          setClauses.push(`\`${col}\` = ${newVal === '' ? 'NULL' : `'${newVal.replace(/'/g, "''")}'`}`);
          whereClauses.push(`\`${col}\` = ${origVal == null ? 'IS NULL' : `'${String(origVal).replace(/'/g, "''")}'`}`);
        }
        if (setClauses.length > 0) {
          updates.push(`UPDATE \`${tableName}\` SET ${setClauses.join(', ')} WHERE ${whereClauses.join(' AND ')}`);
        }
      }
      if (updates.length === 0) return;
      const res = await apiFetch(`/api/connections/${selectedSource}/execute`, {
        method: 'POST',
        body: JSON.stringify({ sql: updates.join(';\n') }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '执行失败' }));
        throw new Error(err.error || '更新失败');
      }
      setModifiedCells({});
      setSaveMsg({ text: `已更新 ${updates.length} 行`, severity: 'success' });
    } catch (err: any) {
      setSaveMsg({ text: err.message || '更新失败', severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [selectedResult, selectedSource, modifiedCells, sql]);

  // 切换数据库时清空修改缓存
  useEffect(() => {
    if (selectedDbId && results[selectedDbId]) {
      setSelectedSource(selectedDbId);
      setModifiedCells({});
    }
  }, [selectedDbId, results]);

  const handleExportClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setExportAnchorEl(e.currentTarget);
  }, []);

  const handleExportClose = useCallback(() => {
    setExportAnchorEl(null);
  }, []);

  const handleExportFormat = useCallback((format: 'csv' | 'xlsx' | 'json') => {
    if (!selectedResult) return;
    const timestamp = Date.now();
    const filename = `export_${timestamp}`;
    switch (format) {
      case 'csv':
        exportCsv(tableData.rows, tableData.columns, filename);
        break;
      case 'xlsx':
        exportExcel(
          [{ name: selectedResult.sourceLabel || 'Sheet1', rows: tableData.rows, columns: tableData.columns }],
          filename
        );
        break;
      case 'json':
        exportJson(tableData.rows, tableData.columns, filename);
        break;
    }
    setExportAnchorEl(null);
  }, [selectedResult, tableData]);

  // ─── 触底加载更多 ───
  const MAX_ACCUMULATED_ROWS = 50000; // 前端累积行数软上限，防止内存爆
  const handleScrollBottom = useCallback(() => {
    if (!selectedSource || loadingMore) return;
    const meta = resultMeta[selectedSource];
    if (!meta?.hasMore) return;
    // 软上限：累积超过 5 万行停止自动加载，提示用户加 WHERE
    if ((meta.totalLoaded ?? 0) >= MAX_ACCUMULATED_ROWS) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: {
          message: `已加载 ${(meta.totalLoaded ?? 0).toLocaleString()} 行，为避免内存占用过大，请精确 WHERE 条件或使用分页导出`,
          severity: 'warning' as 'warning',
        },
      }));
      return;
    }
    loadMoreFn?.(selectedSource);
  }, [selectedSource, loadingMore, resultMeta, loadMoreFn]);

  // 当前选中连接的分页元信息
  const currentMeta = selectedSource ? resultMeta[selectedSource] : undefined;
  const hasMore = currentMeta?.hasMore ?? false;
  const totalLoaded = currentMeta?.totalLoaded ?? 0;

  if (allResults.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled' }}>
        执行查询后选择库查看详情
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 1, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 140, maxWidth: 220, '& .MuiInputBase-root': { fontSize: '0.72rem', minHeight: 24 } }}>
          <InputLabel sx={{ fontSize: '0.72rem' }}>选择数据库</InputLabel>
          <Select
            value={selectedSource}
            label="选择数据库"
            onChange={(e) => {
              const val = e.target.value;
              setSelectedSource(val);
              setSelectedDbId(val);
            }}
            sx={{ fontSize: '0.72rem' }}
            MenuProps={MENU_PROPS}
          >
            {allResults.map((r) => (
              <MenuItem key={r.dbConnectionId} value={r.dbConnectionId} sx={{ fontSize: '0.72rem', py: 0.5 }}>
                {r.sourceLabel}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {selectedResult && (
          <>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {hasMore ? `${totalLoaded}+ 行` : `${selectedResult.totalRows} 行`}
            </Typography>
            {/* ─── 批次大小输入 ─── */}
            <TextField
              label="批次"
              type="number"
              size="small"
              value={pageSize}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) setPageSize(v);
              }}
              inputProps={{ min: 10, max: 10000, step: 10, style: { fontSize: '0.72rem', width: 52, textAlign: 'center' } }}
              sx={{
                '& .MuiInputBase-root': { fontSize: '0.72rem', minHeight: 24, width: 80 },
                '& .MuiInputLabel-root': { fontSize: '0.7rem' },
              }}
            />
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleExportClick}
              variant="outlined"
              sx={{ textTransform: 'none', fontSize: '0.72rem', minWidth: 70 }}
            >
              导出
            </Button>
            <Menu
              anchorEl={exportAnchorEl}
              open={Boolean(exportAnchorEl)}
              onClose={handleExportClose}
              slotProps={{
                paper: {
                  sx: {
                    minWidth: 120,
                    '& .MuiMenuItem-root': { fontSize: '0.8rem', py: 0.5 },
                  },
                },
              }}
            >
              <MenuItem onClick={() => handleExportFormat('csv')}>CSV</MenuItem>
              <MenuItem onClick={() => handleExportFormat('xlsx')}>XLSX</MenuItem>
              <MenuItem onClick={() => handleExportFormat('json')}>JSON</MenuItem>
            </Menu>
            {/* 导出向导：把当前 SQL 带入到向导（单库单查询） */}
            <Button
              size="small"
              startIcon={<ImportExportIcon />}
              onClick={() => {
                const openExportWizard = useExportStore.getState().openWizard;
                // 从 resultStore 拿当前 SQL 结果对应的数据库
                const selectedDbId = useResultStore.getState().selectedDbId || '';
                openExportWizard({
                  tables: selectedDbId
                    ? [{
                        connectionId: selectedDbId,
                        tableName: '__sql_query__',
                        schemaName: '',
                      }]
                    : [],
                  sql: sql,
                  type: 'sql',
                } as any);
              }}
              variant="outlined"
              sx={{ textTransform: 'none', fontSize: '0.72rem', minWidth: 100 }}
            >
              导出向导
            </Button>
            {Object.keys(modifiedCells).length > 0 && (
              <Button
                size="small"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                variant="contained"
                color="warning"
                disabled={saving}
                sx={{ textTransform: 'none' }}
              >
                保存修改 ({Object.keys(modifiedCells).length} 行)
              </Button>
            )}
          </>
        )}
      </Box>

      {/* Table */}
      {selectedResult ? (
        <Box sx={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <ResultTable
            columns={tableData.columns}
            rows={tableData.rows}
            height="100%"
            editable
            modifiedCells={modifiedCells}
            onCellsChanged={setModifiedCells}
            onScrollBottom={handleScrollBottom}
            loadingMore={loadingMore}
            hasMore={hasMore}
          />
        </Box>
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.secondary' }}>
          选择数据库查看结果
        </Box>
      )}

      {/* 保存结果提示 */}
      <Snackbar open={!!saveMsg} autoHideDuration={3000} onClose={() => setSaveMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity={saveMsg?.severity || 'success'} sx={{ width: '100%' }} onClose={() => setSaveMsg(null)}>
          {saveMsg?.text}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default SingleDbView;
