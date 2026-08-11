/**
 * 步骤 2：选择目标（文件 5 种格式 或 数据库）
 */
import React, { useState } from 'react';
import {
  Box,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Checkbox,
  FormControlLabel as CheckboxLabel,
  Button,
  Alert,
  Autocomplete,
} from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { useExportStore } from '../../stores/exportStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { apiFetch } from '../../services/apiClient';
import {
  getFileExtension,
  suggestFileName,
  type FileEncoding,
  type FileFormat,
  type TargetType,
} from '../../services/exportService';
import { FieldMappingDialog, type TableRef } from './FieldMappingDialog';
import type { FieldMapping } from '../../stores/exportStore';
import { TreeConnectionSelect } from '../common/TreeConnectionSelect';

const FORMATS: FileFormat[] = ['csv', 'tsv', 'sql', 'json', 'xlsx'];
const ENCODINGS: FileEncoding[] = ['utf-8', 'gbk', 'gb18030'];

export const ExportStepTarget: React.FC = () => {
  const sourceType = useExportStore((s) => s.sourceType);
  const selectedTables = useExportStore((s) => s.selectedTables);
  const sql = useExportStore((s) => s.sql);
  const target = useExportStore((s) => s.target);
  const setTarget = useExportStore((s) => s.setTarget);

  // 取第一个表作为数据库目标默认值
  const firstTable = selectedTables[0];

  const connectionsMap = useConnectionStore((s) => s.connections);
  const connections = Object.values(connectionsMap);

  // 连接变更时加载 schemas
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [targetTables, setTargetTables] = useState<string[]>([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const dbTarget = target?.type === 'database' ? target : null;
  const targetConn = dbTarget?.connectionId ? connectionsMap[dbTarget.connectionId] : null;
  const targetFixedSchema = targetConn?.schema || '';
  const hasFixedSchema = !!targetFixedSchema.trim();

  // 目标连接变更时拉取 schemas：连接已配置 schema 则锁定显示，否则调后端 API 让用户选。
  React.useEffect(() => {
    const connectionId = dbTarget?.connectionId;
    if (!connectionId) {
      setTargetSchemas([]);
      setTargetTables([]);
      return;
    }

    // 连接已配置固定 schema：锁定显示，不调 API
    if (hasFixedSchema) {
      setTargetSchemas([targetFixedSchema]);
      setTargetTables([]);
      setSchemasLoading(false);
      return;
    }

    let cancelled = false;
    setTargetSchemas([]);
    setTargetTables([]);
    setSchemasLoading(true);

    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/schemas`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `加载 Schema 失败（HTTP ${res.status}）`);
        }
        if (!cancelled) setTargetSchemas(data.schemas || []);
      } catch (err) {
        if (!cancelled) console.error('[fetchSchemas] failed', err);
      } finally {
        if (!cancelled) setSchemasLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dbTarget?.connectionId, hasFixedSchema, targetFixedSchema]);

  // 目标连接或 Schema 变更时加载现有表，供 Autocomplete 选择。
  React.useEffect(() => {
    const connectionId = dbTarget?.connectionId;
    const schemaName = dbTarget?.schemaName || targetFixedSchema || '';
    if (!connectionId) {
      setTargetTables([]);
      return;
    }

    let cancelled = false;
    setTargetTables([]);

    (async () => {
      try {
        const query = schemaName ? `?schema=${encodeURIComponent(schemaName)}` : '';
        const res = await apiFetch(`/api/connections/${connectionId}/tables${query}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `加载目标表失败（HTTP ${res.status}）`);
        }
        if (!cancelled) {
          setTargetTables((data.tables || []).map((table: any) => table.name));
        }
      } catch (err) {
        if (!cancelled) console.error('[fetchTargetTables] failed', err);
      }
    })();

    return () => { cancelled = true; };
  }, [dbTarget?.connectionId, dbTarget?.schemaName, targetFixedSchema]);

  // 字段映射对话框状态
  const [mappingDialog, setMappingDialog] = useState<{
    open: boolean;
    sourceTable: TableRef;
    targetTable: TableRef;
    key: string;
  } | null>(null);
  const setColumnMappings = useExportStore((s) => s.setColumnMappings);
  const getColumnMappings = useExportStore((s) => s.getColumnMappings);

  /** 打开字段映射对话框 */
  const openMappingDialog = (srcTable: any, idx: number) => {
    if (!dbTarget) return;
    const targetTableName =
      target?.type === 'database' ? (target.tableNameArr?.[idx] || target.tableName) : '';
    const sourceTableRef: TableRef = {
      connectionId: srcTable.connectionId,
      tableName: srcTable.tableName,
      schemaName: srcTable.schemaName,
    };
    const targetTableRef: TableRef = {
      connectionId: dbTarget.connectionId,
      tableName: targetTableName,
      schemaName: dbTarget.schemaName || targetFixedSchema,
    };
    setMappingDialog({
      open: true,
      sourceTable: sourceTableRef,
      targetTable: targetTableRef,
      key: `${srcTable.connectionId}::${srcTable.tableName}::${dbTarget.connectionId}::${targetTableName}`,
    });
  };

  // 默认 file target
  const ensureFileTarget = () => {
    if (target?.type === 'file') return target;
    const fmt = 'csv' as FileFormat;
    const baseName = suggestFileName(
      sourceType === 'sql'
        ? { type: 'sql', sql }
        : { type: 'table', tableName: firstTable?.tableName, schemaName: firstTable?.schemaName, connectionId: firstTable?.connectionId },
      { type: 'file', format: fmt, encoding: 'utf-8' } as any
    );
    return {
      type: 'file' as const,
      format: fmt,
      encoding: 'utf-8' as FileEncoding,
      filename: baseName + (selectedTables.length > 1 ? `_and_${selectedTables.length - 1}_more` : ''),
      includeHeader: true,
      sqlIncludeDrop: false,
      compress: false,
    };
  };

  // 默认 db target
  const ensureDbTarget = () => {
    if (target?.type === 'database') return target;
    const fallbackConnId =
      firstTable?.connectionId || connections[0]?.id || '';
    return {
      type: 'database' as const,
      connectionId: fallbackConnId,
      tableName: (firstTable?.tableName || 'export_target') + (selectedTables.length > 1 ? '_multi' : ''),
      schemaName: firstTable?.schemaName,
      createIfMissing: true,
      writeStrategy: 'append' as const,
    };
  };

  const switchTargetType = (type: TargetType) => {
    if (type === 'file') setTarget(ensureFileTarget());
    else setTarget(ensureDbTarget());
  };

  const updateFile = (patch: Partial<any>) => {
    const cur = ensureFileTarget();
    setTarget({ ...cur, ...patch });
  };

  const updateDb = (patch: Partial<any>) => {
    // 使用当前已有的 database target，而不是每次创建新的
    const cur = target?.type === 'database' ? target : ensureDbTarget();
    setTarget({ ...cur, ...patch });
  };

  return (
    <Box sx={{ pt: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, color: '#BBBBBB' }}>
        选择导出目标
      </Typography>

      <RadioGroup
        row
        value={target?.type || 'file'}
        onChange={(e) => switchTargetType(e.target.value as TargetType)}
        sx={{ mb: 2 }}
      >
        <FormControlLabel
          value="file"
          control={<Radio size="small" sx={{ color: '#5A5A5A' }} />}
          label="文件"
          sx={{ color: '#BBBBBB' }}
        />
        <FormControlLabel
          value="database"
          control={<Radio size="small" sx={{ color: '#5A5A5A' }} />}
          label="数据库"
          sx={{ color: '#BBBBBB' }}
        />
      </RadioGroup>

      {(target?.type === 'file' || !target) && (
        <Box>
          {/* 格式 */}
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel sx={{ color: '#BBBBBB' }}>格式</InputLabel>
            <Select
              label="格式"
              value={(target?.type === 'file' ? target.format : 'csv') as string}
              onChange={(e) => updateFile({ format: e.target.value as FileFormat })}
              sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
            >
              {FORMATS.map((f) => (
                <MenuItem key={f} value={f}>
                  {f.toUpperCase()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 编码 + 分隔符 */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel sx={{ color: '#BBBBBB' }}>编码</InputLabel>
              <Select
                label="编码"
                value={
                  (target?.type === 'file' ? target.encoding : 'utf-8') as string
                }
                onChange={(e) =>
                  updateFile({ encoding: e.target.value as FileEncoding })
                }
                sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
              >
                {ENCODINGS.map((e) => (
                  <MenuItem key={e} value={e}>
                    {e}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {target?.type === 'file' &&
              (target.format === 'csv' || target.format === 'tsv') && (
                <TextField
                  size="small"
                  label="字段分隔符"
                  value={target.delimiter || (target.format === 'tsv' ? '\t' : ',')}
                  onChange={(e) => updateFile({ delimiter: e.target.value })}
                  sx={{ width: 120, bgcolor: '#3C3F41' }}
                  InputLabelProps={{ sx: { color: '#BBBBBB' } }}
                />
              )}
          </Box>

          {/* 文件名：导出完成时浏览器自动下载 */}
          <TextField
            fullWidth
            size="small"
            label="文件名"
            value={(() => {
              if (target?.type === 'file' && target.filename) return target.filename;
              // 默认文件名
              const fmt = (target?.type === 'file' ? target.format : 'csv') as FileFormat;
              return suggestFileName(
                sourceType === 'sql'
                  ? { type: 'sql', sql }
                  : { type: 'table', tableName: firstTable?.tableName, schemaName: firstTable?.schemaName, connectionId: firstTable?.connectionId },
                { type: 'file', format: fmt, encoding: 'utf-8' } as any
              ) + (selectedTables.length > 1 ? `_and_${selectedTables.length - 1}_more` : '');
            })()}
            onChange={(e) => updateFile({ filename: e.target.value })}
            placeholder="可留空使用默认文件名"
            helperText={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#888' }}>
                <CloudDownloadIcon sx={{ fontSize: 'calc(0.8125rem * var(--dc-scale, 1))' }} />
                完成后文件将自动下载到浏览器默认下载目录
              </Box>
            }
            InputProps={{
              sx: { bgcolor: '#3C3F41', color: '#FFFFFF' },
            }}
            InputLabelProps={{ sx: { color: '#BBBBBB' } }}
            FormHelperTextProps={{ sx: { color: '#888', mt: 0.5 } }}
            sx={{ mb: 2 }}
          />

          {/* 选项 */}
          <Box>
            {(target?.type === 'file' &&
              (target.format === 'csv' ||
                target.format === 'tsv' ||
                target.format === 'xlsx' ||
                target.format === 'sql' ||
                target.format === 'json')) && (
              <CheckboxLabel
                control={
                  <Checkbox
                    size="small"
                    checked={(target.includeHeader ?? true) as boolean}
                    onChange={(e) =>
                      updateFile({ includeHeader: e.target.checked })
                    }
                    sx={{ color: '#5A5A5A' }}
                  />
                }
                label="包含列标题行"
                sx={{ color: '#BBBBBB' }}
              />
            )}
            {target?.type === 'file' && target.format === 'sql' && (
              <CheckboxLabel
                control={
                  <Checkbox
                    size="small"
                    checked={(target.sqlIncludeDrop ?? false) as boolean}
                    onChange={(e) =>
                      updateFile({ sqlIncludeDrop: e.target.checked })
                    }
                    sx={{ color: '#5A5A5A' }}
                  />
                }
                label="包含 DROP TABLE 语句"
                sx={{ color: '#BBBBBB' }}
              />
            )}
          </Box>
        </Box>
      )}

      {target?.type === 'database' && (
        <Box>
          {/* 目标连接 + Schema 一行 */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            {/* 树形连接选择器：公共 TreeConnectionSelect */}
            <Box sx={{ flex: 1 }}>
              <TreeConnectionSelect
                value={dbTarget?.connectionId || ''}
                onChange={(connId) => {
                  // 切换目标连接时重置 tableName/tableNameArr 为源表名
                  const newConn = connectionsMap[connId];
                  const defaultArr = selectedTables.map((st) => st.tableName);
                  updateDb({
                    connectionId: connId,
                    schemaName: newConn?.schema || '',
                    tableName: defaultArr[0] || '',
                    tableNameArr: defaultArr,
                  });
                }}
                label="目标数据库连接"
              />
            </Box>

            {/* Schema：始终显示下拉，没加载完就显示加载提示 */}
            <FormControl size="small" sx={{ width: 160 }}>
              <InputLabel sx={{ color: '#BBBBBB' }}>Schema</InputLabel>
              <Select
                label="Schema"
                value={(dbTarget?.schemaName || targetFixedSchema || '') as string}
                onChange={(e) => updateDb({ schemaName: e.target.value })}
                sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
                disabled={schemasLoading}
              >
                {targetSchemas.length === 0 && (
                  <MenuItem value="" disabled>
                    {schemasLoading ? '加载中…' : '暂无可用 Schema'}
                  </MenuItem>
                )}
                {targetSchemas.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* 目标表名：列表形式 + Autocomplete（从数据库读表） */}
          <Typography variant="caption" sx={{ color: '#BBBBBB', display: 'block', mb: 0.5 }}>
            目标表名（{selectedTables.length} 张源表 · {targetTables.length} 张可选）
          </Typography>
          <Box sx={{ maxHeight: 200, overflow: 'auto', mb: 2 }}>
            {selectedTables.length === 0 ? (
              <Typography sx={{ color: '#888', fontSize: 'calc(0.75rem * var(--dc-scale, 1))', textAlign: 'center', py: 2 }}>
                请先选择源表
              </Typography>
            ) : selectedTables.length === 1 ? (
              // 单表：直接显示一个 Autocomplete
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Autocomplete
                  freeSolo
                  size="small"
                  sx={{ flex: 1, minWidth: 120 }}
                  options={targetTables}
                  value={target.tableName as string || null}
                  onChange={(_, val) => updateDb({ tableName: val || '' })}
                  onInputChange={(_, val) => updateDb({ tableName: val || '' })}
                  ListboxProps={{
                    sx: {
                      fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                      padding: 0,
                      '& li': { fontSize: 'calc(0.75rem * var(--dc-scale, 1))', padding: '4px 8px', minHeight: 24 },
                    },
                  }}
                  slotProps={{
                    paper: { sx: { bgcolor: '#3C3F41', color: '#FFFFFF' } },
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      placeholder={selectedTables[0]?.tableName}
                      sx={{
                        bgcolor: '#3C3F41',
                        '& .MuiOutlinedInput-input': { fontSize: 'calc(0.75rem * var(--dc-scale, 1))', padding: '6px 8px' },
                      }}
                      error={!target.tableName}
                      helperText={!target.tableName ? '目标表名必填' : ''}
                    />
                  )}
                />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AccountTreeIcon />}
                  onClick={() => openMappingDialog(selectedTables[0], 0)}
                  sx={{
                    fontSize: 'calc(0.6875rem * var(--dc-scale, 1))',
                    minWidth: 92,
                    px: 1.2,
                    py: 0.4,
                    flexShrink: 0,
                    color: '#42A5F5',
                    borderColor: '#42A5F5',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      borderColor: '#90CAF9',
                      bgcolor: 'rgba(66, 165, 245, 0.1)',
                    },
                  }}
                >
                  字段映射
                </Button>
              </Box>
            ) : (
              // 多表：列表形式（源表 → 目标表），无边框
              selectedTables.map((t, idx) => {
                const val = target.tableNameArr?.[idx] || t.tableName;
                return (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1 }}>
                    <Typography sx={{ color: '#BBB', fontSize: 'calc(0.6875rem * var(--dc-scale, 1))', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', pr: 0.5 }}>
                      {t.tableName}
                    </Typography>
                    <ArrowForwardIcon sx={{ fontSize: 'calc(0.875rem * var(--dc-scale, 1))', color: '#90CAF9' }} />
                    <Autocomplete
                      freeSolo
                      size="small"
                      sx={{ flex: 1, minWidth: 0 }}
                      options={targetTables}
                      value={val}
                      onChange={(_, newVal) => {
                        const arr = [...(target.tableNameArr || selectedTables.map((st) => st.tableName))];
                        arr[idx] = newVal || '';
                        updateDb({ tableNameArr: arr, tableName: arr[0] });
                      }}
                      onInputChange={(_, newVal) => {
                        const arr = [...(target.tableNameArr || selectedTables.map((st) => st.tableName))];
                        arr[idx] = newVal || '';
                        updateDb({ tableNameArr: arr, tableName: arr[0] });
                      }}
                      ListboxProps={{
                        sx: {
                          fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                          padding: 0,
                          '& li': { fontSize: 'calc(0.75rem * var(--dc-scale, 1))', padding: '4px 8px', minHeight: 24 },
                        },
                      }}
                      slotProps={{
                        paper: { sx: { bgcolor: '#3C3F41', color: '#FFFFFF' } },
                      }}
                      renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        placeholder={t.tableName}
                        sx={{
                          bgcolor: '#3C3F41',
                          '& fieldset': { border: 'none' },
                          '& .MuiOutlinedInput-input': { fontSize: 'calc(0.75rem * var(--dc-scale, 1))', padding: '6px 8px' },
                        }}
                      />
                    )}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AccountTreeIcon />}
                    onClick={() => openMappingDialog(t, idx)}
                    sx={{
                      fontSize: 'calc(0.6875rem * var(--dc-scale, 1))',
                      minWidth: 92,
                      px: 1.2,
                      py: 0.4,
                      flexShrink: 0,
                      color: '#42A5F5',
                      borderColor: '#42A5F5',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        borderColor: '#90CAF9',
                        bgcolor: 'rgba(66, 165, 245, 0.1)',
                      },
                    }}
                  >
                    字段映射
                  </Button>
                </Box>
              );
            })
          )}
          </Box>

          <CheckboxLabel
            control={
              <Checkbox
                size="small"
                checked={(target.createIfMissing ?? true) as boolean}
                onChange={(e) => updateDb({ createIfMissing: e.target.checked })}
                sx={{ color: '#5A5A5A' }}
              />
            }
            label="不存在则自动建表"
            sx={{ color: '#BBBBBB', display: 'block', mb: 1 }}
          />

          <FormControl size="small" sx={{ mb: 2, minWidth: 200 }}>
            <InputLabel sx={{ color: '#BBBBBB' }}>写入策略</InputLabel>
            <Select
              label="写入策略"
              value={target.writeStrategy as string}
              onChange={(e) => updateDb({ writeStrategy: e.target.value })}
              sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
            >
              <MenuItem value="append">INSERT (追加)</MenuItem>
              <MenuItem value="truncate">TRUNCATE + INSERT</MenuItem>
              <MenuItem value="drop_create">DROP + CREATE</MenuItem>
            </Select>
          </FormControl>

          {connections.length === 0 && (
            <Alert severity="warning">暂无可用数据库连接</Alert>
          )}
        </Box>
      )}

      {/* 字段映射对话框（DBeaver 风格） */}
      {mappingDialog && (
        <FieldMappingDialog
          open={mappingDialog.open}
          sourceTable={mappingDialog.sourceTable}
          targetTable={mappingDialog.targetTable}
          initialMappings={getColumnMappings(mappingDialog.key)}
          onClose={() => setMappingDialog(null)}
          onSave={(mappings) => {
            setColumnMappings(mappingDialog.key, mappings);
            setMappingDialog(null);
          }}
        />
      )}
    </Box>
  );
};
