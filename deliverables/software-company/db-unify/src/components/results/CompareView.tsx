import React, { useState, useMemo, useCallback } from 'react';
import { Box, Autocomplete, TextField, Chip, Typography, Button, Checkbox, ListItemText } from '@mui/material';
import { useResultStore } from '../../stores/resultStore';
import ResultTable from './ResultTable';
import { DiffType } from '../../types/result';
import type { AggregatedResult, ResultRow, CellValue } from '../../types/result';
import DownloadIcon from '@mui/icons-material/Download';
import { exportCsv } from '../../services/exporters';

interface SourceOption {
  id: string;       // dbConnectionId
  label: string;    // sourceLabel
}

const CompareView: React.FC = () => {
  const results = useResultStore((s) => s.results);
  const compare = useResultStore((s) => s.compare);

  // Build source options from results (keyed by dbConnectionId)
  const sourceOptions: SourceOption[] = useMemo(
    () => Object.values(results).map((r) => ({ id: r.dbConnectionId, label: r.sourceLabel })),
    [results]
  );

  const [selectedOptions, setSelectedOptions] = useState<SourceOption[]>([]);
  const [compareResult, setCompareResult] = useState<AggregatedResult | null>(null);

  const handleCompare = useCallback(() => {
    if (selectedOptions.length < 2) return;
    const ids = selectedOptions.map((s) => s.id);
    const result = compare(ids);
    setCompareResult(result);
  }, [selectedOptions, compare]);

  // Transform compare result for display
  const displayData = useMemo(() => {
    if (!compareResult) return { columns: [] as string[], rows: [] as ResultRow[] };

    // Build columns: Field | Source1 | Source2 | ...
    const columns = ['字段', ...selectedOptions.map((s) => s.label)];

    // Use original columns from compare result
    const rows: ResultRow[] = compareResult.columns.map((col) => {
      const values: Record<string, CellValue> = {
        '字段': { value: col, diffType: DiffType.Same },
      };

      selectedOptions.forEach((option, srcIdx) => {
        const sourceResult = results[option.id];
        if (sourceResult && sourceResult.rows.length > 0) {
          // Get all values from this column across rows for this source
          const vals = sourceResult.rows.map((r) => r.values[col]?.value ?? '-');
          const displayVal = vals.length <= 1 ? vals[0] ?? '-' : vals.join(', ');

          // Check if different from other sources
          let diffType = DiffType.Same;
          const firstSourceResult = results[selectedOptions[0].id];
          if (firstSourceResult && firstSourceResult.rows.length > 0 && srcIdx > 0) {
            const firstVal = firstSourceResult.rows.map((r) => r.values[col]?.value ?? '-').join(', ');
            if (displayVal !== firstVal) {
              diffType = DiffType.Different;
            }
          }

          values[option.label] = { value: displayVal, diffType };
        } else {
          values[option.label] = { value: '-', diffType: DiffType.Missing };
        }
      });

      return { sourceDbLabel: col, values };
    });

    return { columns, rows };
  }, [compareResult, selectedOptions, results]);

  const handleExport = useCallback(() => {
    if (displayData.rows.length === 0) return;
    exportCsv(displayData.rows, displayData.columns, 'db-unify-compare');
  }, [displayData]);

  if (sourceOptions.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center', color: 'text.disabled' }}>
        执行查询后选择库进行对比
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Source selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 1, px: 1, flexWrap: 'wrap' }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mr: 0.5, fontSize: '0.8rem' }}>
          对比库:
        </Typography>
        <Autocomplete
          multiple
          disableCloseOnSelect
          size="small"
          options={sourceOptions}
          value={selectedOptions}
          onChange={(_, newValue) => {
            setSelectedOptions(newValue.slice(0, 5));
          }}
          getOptionLabel={(option) => option.label}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          sx={{ minWidth: 140, flex: '1 1 auto', '& .MuiInputBase-root': { flexWrap: 'nowrap' } }}
          componentsProps={{
            popper: {
              modifiers: [
                {
                  name: 'preventOverflow',
                  enabled: true,
                },
                {
                  name: 'offset',
                  options: { offset: [0, 0] },
                },
              ],
              style: { width: 160 },
              placement: 'bottom-start',
            },
          }}
          ListboxProps={{
            style: {
              width: 160,
              paddingTop: 8,
              paddingBottom: 8,
              paddingLeft: 0,
              paddingRight: 0,
              maxHeight: 260,
            },
          }}
          renderInput={(params) => (
            <TextField {...params} placeholder="选择 2-5 个库进行对比" sx={{ '& .MuiInputBase-root': { fontSize: '0.72rem', minHeight: 24 } }} />
          )}
          renderTags={(value, getTagProps) =>
            value.map((option, idx) => {
              const tagProps = getTagProps({ index: idx });
              return <Chip label={option.label} size="small" sx={{ fontSize: '0.68rem' }} {...tagProps} />;
            })
          }
          renderOption={(props, option, { selected }) => {
            const { key, ...otherProps } = props as React.HTMLAttributes<HTMLLIElement> & { key: string };
            return (
              <li key={key} {...otherProps} style={{ fontSize: '9px', lineHeight: '14px', color: '#000000DE', padding: '4px 8px', minHeight: 28, height: 28, width: 160, maxWidth: 160, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <Checkbox checked={selected} size="small" sx={{ p: '2px' }} />
                <ListItemText primary={option.label} primaryTypographyProps={{ fontSize: '9px', lineHeight: '14px' }} />
              </li>
            );
          }}
        />
        <Button
          size="small"
          variant="contained"
          onClick={handleCompare}
          disabled={selectedOptions.length < 2}
          sx={{ textTransform: 'none' }}
        >
          对比
        </Button>
        {compareResult && (
          <Button
            size="small"
            startIcon={<DownloadIcon />}
            onClick={handleExport}
            variant="outlined"
            sx={{ textTransform: 'none' }}
          >
            导出
          </Button>
        )}
      </Box>

      {/* Legend */}
      <Box sx={{ display: 'flex', gap: 2, px: 1, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#FFF3E0', borderRadius: 0.5, border: '1px solid #FFB74D' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>值不同</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 12, height: 12, bgcolor: '#FFEBEE', borderRadius: 0.5, border: '1px solid #EF9A9A' }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>数据缺失</Typography>
        </Box>
      </Box>

      {/* Compare table */}
      {compareResult && displayData.rows.length > 0 ? (
        <Box sx={{ flex: 1, overflow: 'hidden' }}>
          <ResultTable
            columns={displayData.columns}
            rows={displayData.rows}
            highlightDiff
            height="100%"
          />
        </Box>
      ) : (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'text.disabled' }}>
          选择库并点击"对比"查看结果
        </Box>
      )}
    </Box>
  );
};

export default CompareView;
