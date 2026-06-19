import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Box, FormControl, InputLabel, MenuItem, Select, Button, Typography } from '@mui/material';
import { useResultStore } from '../../stores/resultStore';
import ResultTable from './ResultTable';
import { exportCsv } from '../../services/exporters';
import DownloadIcon from '@mui/icons-material/Download';
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

  // Sync with store-selected DB when it changes
  useEffect(() => {
    if (selectedDbId && results[selectedDbId]) {
      setSelectedSource(selectedDbId);
    }
  }, [selectedDbId, results]);

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

  const handleExport = useCallback(() => {
    if (!selectedResult) return;
    exportCsv(tableData.rows, tableData.columns, `db-unify-${selectedResult.sourceLabel}`);
  }, [selectedResult, tableData]);

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 1 }}>
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
              {selectedResult.totalRows} 行
            </Typography>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              onClick={handleExport}
              variant="outlined"
              sx={{ textTransform: 'none' }}
            >
              导出 CSV
            </Button>
          </>
        )}
      </Box>

      {/* Table */}
      {selectedResult ? (
        <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
          <ResultTable
            columns={tableData.columns}
            rows={tableData.rows}
            height="100%"
          />
        </Box>
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
          选择数据库查看结果
        </Box>
      )}
    </Box>
  );
};

export default SingleDbView;
