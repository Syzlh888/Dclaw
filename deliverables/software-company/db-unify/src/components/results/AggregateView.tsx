import React, { useState, useMemo, useCallback } from 'react';
import { Box, TextField, MenuItem, Select, FormControl, InputLabel, Typography, Button, Checkbox, ListItemText, OutlinedInput, Chip } from '@mui/material';
import { useResultStore } from '../../stores/resultStore';
import ResultTable from './ResultTable';
import { exportCsv, exportJson, exportExcel } from '../../services/exporters';
import DownloadIcon from '@mui/icons-material/Download';
import PushPinIcon from '@mui/icons-material/PushPin';

const ITEM_HEIGHT = 32;
const ITEM_PADDING_TOP = 4;
const MenuProps = {
  PaperProps: {
    style: {
      maxHeight: 260,
      width: 160,
    },
  },
  sx: {
    '& .MuiList-root': {
      paddingTop: '8px',
      paddingBottom: '8px',
      paddingLeft: '0px',
      paddingRight: '0px',
      fontSize: '9px',
      lineHeight: '14px',
      color: '#000000DE',
      textAlign: 'left',
      width: 160,
      height: 260,
    },
    '& .MuiMenuItem-root': {
      fontSize: '9px',
      lineHeight: '14px',
      color: '#000000DE',
      textAlign: 'left',
      py: 0.5,
      minHeight: 28,
      height: 28,
      width: 160,
      maxWidth: 160,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    },
    '& .MuiPaper-root': { width: 160 },
  },
};

const AggregateView: React.FC = () => {
  const aggregatedResult = useResultStore((s) => s.aggregatedResult);
  const results = useResultStore((s) => s.results);
  const pinnedResults = useResultStore((s) => s.pinnedResults);
  const unpinResult = useResultStore((s) => s.unpinResult);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [searchText, setSearchText] = useState('');

  // 防御性修复：如果 aggregatedResult 为空但 results 有数据，自动聚合
  React.useEffect(() => {
    if (!aggregatedResult && Object.keys(results).length > 0) {
      useResultStore.getState().aggregate();
    }
  }, [aggregatedResult, results]);

  const filteredRows = useMemo(() => {
    if (!aggregatedResult) return [];
    let rows = aggregatedResult.rows;

    if (sourceFilter.length > 0) {
      rows = rows.filter((r) => sourceFilter.includes(String(r.values['来源库']?.value)));
    }

    if (searchText.trim()) {
      const lower = searchText.toLowerCase();
      rows = rows.filter((r) =>
        Object.values(r.values).some((cell) =>
          String(cell.value ?? '').toLowerCase().includes(lower)
        )
      );
    }

    return rows;
  }, [aggregatedResult, sourceFilter, searchText]);

  const handleExportCsv = useCallback(() => {
    if (!aggregatedResult) return;
    exportCsv(filteredRows, aggregatedResult.columns, 'db-unify-aggregate');
  }, [aggregatedResult, filteredRows]);

  const handleExportJson = useCallback(() => {
    if (!aggregatedResult) return;
    exportJson(filteredRows, aggregatedResult.columns, 'db-unify-aggregate');
  }, [aggregatedResult, filteredRows]);

  const handleExportExcel = useCallback(() => {
    if (!aggregatedResult) return;
    const sheets = Object.entries(results).map(([id, r]) => ({
      name: r.sourceLabel || id,
      rows: r.rows,
      columns: r.columns,
    }));
    exportExcel(sheets, 'db-unify-results');
  }, [aggregatedResult, results, filteredRows]);

  if (!aggregatedResult) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled' }}>
        执行查询后在此查看聚合结果
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Pinned results */}
      {Object.keys(pinnedResults).length > 0 && (
        <Box sx={{ display: 'flex', gap: 0.5, px: 1, py: 0.5, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: '24px' }}>已钉选:</Typography>
          {Object.entries(pinnedResults).map(([id, result]) => (
            <Chip
              key={id}
              label={result.sourceLabel}
              size="small"
              onDelete={() => unpinResult(id)}
              deleteIcon={<PushPinIcon sx={{ fontSize: 12 }} />}
              variant="outlined"
              color="primary"
              sx={{ fontSize: '0.7rem' }}
            />
          ))}
        </Box>
      )}

      {/* Toolbar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, px: 1, flexShrink: 0 }}>
        <FormControl size="small" sx={{ minWidth: 130, maxWidth: 220, '& .MuiInputBase-root': { fontSize: '0.72rem', minHeight: 24 } }}>
          <InputLabel sx={{ fontSize: '0.72rem' }}>来源筛选</InputLabel>
          <Select
            multiple
            value={sourceFilter}
            label="来源筛选"
            onChange={(e) => {
              const value = e.target.value;
              setSourceFilter(typeof value === 'string' ? value.split(',') : value);
            }}
            input={<OutlinedInput label="来源筛选" />}
            renderValue={(selected) => {
              if (selected.length === 0) return '全部库';
              return selected.join(', ');
            }}
            MenuProps={MenuProps}
            sx={{ fontSize: '0.72rem' }}
          >
            {aggregatedResult.sources.map((s) => (
              <MenuItem key={s} value={s} sx={{ fontSize: '0.72rem', py: 0.5, minHeight: 28 }}>
                <Checkbox checked={sourceFilter.indexOf(s) > -1} size="small" />
                <ListItemText primary={s} primaryTypographyProps={{ fontSize: '0.72rem' }} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          size="small"
          placeholder="搜索结果..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          sx={{ flex: 1, maxWidth: 220, '& .MuiInputBase-root': { fontSize: '0.72rem', minHeight: 24 } }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
          共 {filteredRows.length} 行
        </Typography>
        <Button
          size="small"
          startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
          onClick={handleExportExcel}
          variant="contained"
          color="primary"
          sx={{ textTransform: 'none', fontSize: '0.8rem', py: 0.25 }}
        >
          导出 Excel
        </Button>
        <Button
          size="small"
          startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
          onClick={handleExportCsv}
          variant="outlined"
          sx={{ textTransform: 'none', fontSize: '0.8rem', py: 0.25 }}
        >
          导出 CSV
        </Button>
        <Button
          size="small"
          startIcon={<DownloadIcon sx={{ fontSize: 16 }} />}
          onClick={handleExportJson}
          variant="outlined"
          sx={{ textTransform: 'none', fontSize: '0.8rem', py: 0.25 }}
        >
          导出 JSON
        </Button>
      </Box>

      {/* Table */}
      <Box sx={{ flex: 1, overflow: 'hidden' }}>
        <ResultTable
          columns={aggregatedResult.columns}
          rows={filteredRows}
          height="100%"
        />
      </Box>
    </Box>
  );
};

export default AggregateView;
