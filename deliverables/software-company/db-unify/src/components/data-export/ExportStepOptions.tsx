/**
 * 步骤 3：选项 + 预览
 */
import React, { useState } from 'react';
import {
  Box,
  Typography,
  TextField,
  Checkbox,
  FormControlLabel,
  Button,
  Alert,
  CircularProgress,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Paper,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useExportStore } from '../../stores/exportStore';
import { previewExport } from '../../services/exportService';

export const ExportStepOptions: React.FC = () => {
  const sourceType = useExportStore((s) => s.sourceType);
  const selectedTables = useExportStore((s) => s.selectedTables);
  const sql = useExportStore((s) => s.sql);
  const options = useExportStore((s) => s.options);
  const setOptions = useExportStore((s) => s.setOptions);
  const preview = useExportStore((s) => s.preview);
  const setPreview = useExportStore((s) => s.setPreview);

  const sourceReady =
    sourceType === 'sql' ? !!sql : selectedTables.length > 0;
  const firstTable = selectedTables[0];

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const doPreview = async () => {
    if (!sourceReady) return;
    setLoading(true);
    setErr(null);
    try {
      // 多表模式预览第一张；SQL 模式直接用 SQL
      const previewSource = sourceType === 'sql'
        ? { type: 'sql' as const, sql, connectionId: firstTable?.connectionId || '' }
        : {
            type: 'table' as const,
            connectionId: firstTable.connectionId,
            tableName: firstTable.tableName,
            schemaName: firstTable.schemaName,
          };
      const r = await previewExport(previewSource as any, 100);
      setPreview(r);
    } catch (e: any) {
      setErr(e?.message || '预览失败');
      setPreview(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ pt: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, color: '#BBBBBB' }}>
        选项与预览
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <TextField
          size="small"
          label="每批行数"
          type="number"
          value={options.batchSize}
          onChange={(e) =>
            setOptions({ batchSize: parseInt(e.target.value, 10) || 10000 })
          }
          sx={{ width: 140, bgcolor: '#3C3F41' }}
          InputLabelProps={{ sx: { color: '#BBBBBB' } }}
        />
        <TextField
          size="small"
          label="最大行数"
          type="number"
          value={options.maxRows}
          onChange={(e) =>
            setOptions({ maxRows: parseInt(e.target.value, 10) || 500000 })
          }
          sx={{ width: 140, bgcolor: '#3C3F41' }}
          InputLabelProps={{ sx: { color: '#BBBBBB' } }}
          helperText="超过将截断"
        />
        <Button
          variant="outlined"
          size="small"
          startIcon={
            loading ? <CircularProgress size={14} /> : <VisibilityIcon />
          }
          onClick={doPreview}
          disabled={!sourceReady || loading}
        >
          预览前 100 行
        </Button>
      </Box>

      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={options.includeHeader}
            onChange={(e) => setOptions({ includeHeader: e.target.checked })}
            sx={{ color: '#5A5A5A' }}
          />
        }
        label="包含列标题行"
        sx={{ color: '#BBBBBB', mb: 2 }}
      />

      {err && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {err}
        </Alert>
      )}

      {preview && preview.columns && preview.columns.length > 0 && (
        <Box>
          <Typography variant="caption" sx={{ color: '#BBBBBB', display: 'block', mb: 1 }}>
            预览（前 {preview.rows.length} 行 / 共 {preview.totalRows.toLocaleString()} 行
            {preview.truncated && '（已截断）'}）
          </Typography>
          <Paper sx={{ maxHeight: 280, overflow: 'auto', bgcolor: '#2B2B2B' }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {preview.columns.map((c) => (
                    <TableCell
                      key={c}
                      sx={{
                        bgcolor: '#3C3F41',
                        color: '#FFFFFF',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {preview.rows.map((row, i) => (
                  <TableRow key={i} hover>
                    {preview.columns.map((c) => (
                      <TableCell
                        key={c}
                        sx={{ color: '#BBBBBB', fontSize: 11, fontFamily: 'monospace' }}
                      >
                        {row[c] === null
                          ? 'NULL'
                          : String(row[c]).length > 80
                          ? String(row[c]).slice(0, 80) + '...'
                          : String(row[c])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Paper>
        </Box>
      )}

      {!sourceReady && (
        <Alert severity="info" sx={{ mt: 2 }}>
          请先在步骤 1 中完整选择数据源
        </Alert>
      )}
    </Box>
  );
};
