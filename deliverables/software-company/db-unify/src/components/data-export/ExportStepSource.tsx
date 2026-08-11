/**
 * 步骤 1：选择源（多表 / SQL）
 *
 * 设计原则：
 * - 由右键表触发时，连接已隐式确定（store.source.connectionId 预填）
 * - "选择数据库连接"段直接隐藏，连接显示为不可改的 chip
 * - 默认显示该连接的 schema 列表（chip）+ 当前 schema 下的表（多选复选框）
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  Checkbox,
  Chip,
  Alert,
  TextField,
  CircularProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useExportStore } from '../../stores/exportStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { apiFetch } from '../../services/apiClient';

interface TableInfo {
  name: string;
  schema_name: string;
  obj_type?: string;
  rows?: number;
}

export const ExportStepSource: React.FC = () => {
  const sourceType = useExportStore((s) => s.sourceType);
  const selectedTables = useExportStore((s) => s.selectedTables);
  const sql = useExportStore((s) => s.sql);
  const source = useExportStore((s) => s.source);
  const setSource = useExportStore((s) => s.setSource);
  const setSourceType = useExportStore((s) => s.setSourceType);
  const setSql = useExportStore((s) => s.setSql);
  const removeSelectedTable = useExportStore((s) => s.removeSelectedTable);
  const addSelectedTable = useExportStore((s) => s.addSelectedTable);

  const connectionsMap = useConnectionStore((s) => s.connections);

  // 连接锁定：来自右键触发时的 store.connectionId
  const activeConnId = source.connectionId || '';
  const activeConn = activeConnId ? connectionsMap[activeConnId] : null;

  // === Schema / Table ===
  const [schemas, setSchemas] = useState<string[]>([]);
  const [activeSchema, setActiveSchema] = useState<string | null>(
    selectedTables[0]?.schemaName || null
  );
  // 如果连接有预设 schema，只用那一个，不提供选择
  const fixedSchema = activeConn?.schema;
  const schemaOptions = fixedSchema ? [fixedSchema] : schemas;
  const showSchemaSelector = !fixedSchema && schemas.length > 0;
  const [tables, setTables] = useState<TableInfo[]>([]);
  // 拖拽起点记录（用于区分点击 vs 拖拽）
  const dragStartRef = useRef<{ x: number; y: number; draggable: boolean } | null>(null);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [schemasLoading, setSchemasLoading] = useState(false);

  // 已选集合
  const selectedNames = useMemo(
    () => new Set(selectedTables.map((t) => `${t.schemaName}.${t.tableName}`)),
    [selectedTables]
  );

  // 加载 schema 列表（连接锁定后自动跑）
  useEffect(() => {
    if (!activeConnId) return;
    let cancelled = false;
    setSchemasLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${activeConnId}/schemas`, { method: 'POST' });
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json();
          const list = data.schemas || [];
          setSchemas(list);
          // 优先级：连接预设 schema > selectedTables[0].schemaName > schemas[0]
          const fixedSchemaValue = activeConn?.schema || '';
          const selectedSchema = selectedTables[0]?.schemaName || '';
          if (fixedSchemaValue && fixedSchemaValue.trim()) {
            setActiveSchema(fixedSchemaValue);
          } else if (selectedSchema && selectedSchema.trim()) {
            setActiveSchema(selectedSchema);
          } else if (list.length > 0) {
            setActiveSchema(list[0]);
          }
        }
      } catch (err) {
        console.error('加载 schema 失败:', err);
      } finally {
        if (!cancelled) setSchemasLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeConnId]);

  // 加载 schema 下的表
  const loadTables = async (schema: string) => {
    if (!activeConnId) return;
    setActiveSchema(schema);
    setTablesLoading(true);
    try {
      const res = await apiFetch(
        `/api/connections/${activeConnId}/tables?schema=${encodeURIComponent(schema)}`
      );
      if (res.ok) {
        const data = await res.json();
        setTables(data.tables || []);
      }
    } catch (err) {
      console.error('加载表失败:', err);
      setTables([]);
    } finally {
      setTablesLoading(false);
    }
  };

  // 当 activeSchema 变化时加载表
  useEffect(() => {
    if (activeSchema && activeConnId) loadTables(activeSchema);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchema]);

  // 把当前 schema 同步到 store（向后兼容）
  useEffect(() => {
    if (activeSchema && activeConnId) {
      setSource({
        ...source,
        connectionId: activeConnId,
        schemaName: activeSchema,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSchema, activeConnId]);

  // 勾选/取消表
  const toggleTable = (t: TableInfo) => {
    const key = `${t.schema_name}.${t.name}`;
    if (selectedNames.has(key)) {
      removeSelectedTable({ connectionId: activeConnId, tableName: t.name, schemaName: t.schema_name });
    } else {
      addSelectedTable({ connectionId: activeConnId, tableName: t.name, schemaName: t.schema_name });
    }
  };

  return (
    <Box sx={{ pt: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, color: '#BBBBBB' }}>
        选择数据源
      </Typography>

      {/* 顶部：源类型 radio */}
      <RadioGroup
        row
        value={sourceType}
        onChange={(e) => setSourceType(e.target.value as 'table' | 'sql')}
        sx={{ mb: 1.5 }}
      >
        <FormControlLabel
          value="table"
          control={<Radio size="small" sx={{ color: '#5A5A5A' }} />}
          label="选中表（多表）"
          sx={{ color: '#BBBBBB' }}
        />
        <FormControlLabel
          value="sql"
          control={<Radio size="small" sx={{ color: '#5A5A5A' }} />}
          label="自定义 SQL 查询"
          sx={{ color: '#BBBBBB' }}
        />
      </RadioGroup>

      {sourceType === 'table' ? (
        <>
          {/* 连接锁定 chip（不可改） */}
          {!activeConnId ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              未指定源连接。请从左侧数据库连接或表右键触发导出向导。
            </Alert>
          ) : (
            <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="caption" sx={{ color: '#BBBBBB' }}>
                当前数据库连接：
              </Typography>
              <Chip
                size="small"
                label={
                  activeConn
                    ? `${activeConn.name}  (${activeConn.host}:${activeConn.port}/${activeConn.database})`
                    : activeConnId
                }
                sx={{
                  bgcolor: '#3C5F41',
                  color: '#FFF',
                  fontWeight: 600,
                  fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                }}
              />
            </Box>
          )}

          {activeConnId && (
            <>
              {/* Schema 选择：只在没有预设 schema 且有多个 schema 时显示 */}
              {showSchemaSelector && (
                <>
                  <Typography variant="caption" sx={{ color: '#BBBBBB', display: 'block', mb: 0.5 }}>
                    选择 Schema（{schemasLoading ? '加载中…' : `${schemas.length} 个`}）：
                  </Typography>
                  <Box
                    sx={{
                      maxHeight: 56,
                      overflow: 'auto',
                      border: '1px solid #4B4B4B',
                      borderRadius: 1,
                      bgcolor: '#2B2B2B',
                      p: 0.75,
                      mb: 1.5,
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 0.5,
                    }}
                  >
                    {schemas.map((s) => (
                      <Chip
                        key={s}
                        label={s}
                        onClick={() => loadTables(s)}
                        size="small"
                        sx={{
                          cursor: 'pointer',
                          bgcolor: activeSchema === s ? '#FF9800' : '#3C3F41',
                          color: activeSchema === s ? '#000' : '#FFF',
                          border: '1px solid',
                          borderColor: activeSchema === s ? '#FF9800' : '#4B4B4B',
                          fontWeight: activeSchema === s ? 700 : 400,
                          '&:hover': { bgcolor: activeSchema === s ? '#FFA726' : '#4A4A4A' },
                        }}
                      />
                    ))}
                  </Box>
                </>
              )}

              {/* 表列表（多选）+ 全选 */}
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                <Checkbox
                  size="small"
                  checked={tables.length > 0 && selectedNames.size === tables.length}
                  indeterminate={selectedNames.size > 0 && selectedNames.size < tables.length}
                  onChange={(e) => {
                    if (e.target.checked) {
                      tables.forEach((t) => {
                        const key = `${activeSchema}.${t.name}`;
                        if (!selectedNames.has(key)) {
                          addSelectedTable({ connectionId: activeConnId, tableName: t.name, schemaName: activeSchema! });
                        }
                      });
                    } else {
                      tables.forEach((t) => {
                        removeSelectedTable({ connectionId: activeConnId, tableName: t.name, schemaName: activeSchema! });
                      });
                    }
                  }}
                  sx={{ color: '#888', '&.Mui-checked': { color: '#42A5F5' } }}
                />
                <Typography variant="caption" sx={{ color: '#BBBBBB', mr: 1 }}>
                  勾选要导出的表（{activeConn?.name || ''} · {activeSchema || ''} · 共 {tables.length} 张）：
                </Typography>
              </Box>
              <Box
                sx={{
                  height: 220,
                  overflow: 'auto',
                  border: '1px solid #4B4B4B',
                  borderRadius: 1,
                  bgcolor: '#2B2B2B',
                  p: 0.5,
                }}
              >
                {tablesLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                    <CircularProgress size={20} sx={{ color: '#BBBBBB' }} />
                  </Box>
                ) : tables.length === 0 ? (
                  <Typography sx={{ color: '#888', textAlign: 'center', fontSize: 'calc(0.75rem * var(--dc-scale, 1))', py: 2 }}>
                    {activeSchema ? `${activeSchema} 下没有任何表` : '请先选择 schema'}
                  </Typography>
                ) : (
                  tables.map((t) => {
                    const key = `${t.schema_name}.${t.name}`;
                    const checked = selectedNames.has(key);
                    return (
                      <Box
                        key={key}
                        onClick={() => toggleTable(t)}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          py: 0.4,
                          px: 0.5,
                          cursor: 'pointer',
                          borderRadius: 0.5,
                          mb: 0.1,
                          bgcolor: checked ? '#3C5F41' : 'transparent',
                          '&:hover': { bgcolor: checked ? '#4A7C59' : '#3C3F41' },
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={checked}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleTable(t);
                          }}
                          sx={{
                            p: 0.25,
                            mr: 0.5,
                            color: '#5A5A5A',
                            '&.Mui-checked': { color: '#4CAF50' },
                          }}
                        />
                        <Typography sx={{ fontSize: 'calc(0.8125rem * var(--dc-scale, 1))', color: '#FFF' }}>{t.name}</Typography>
                        {t.obj_type === 'VIEW' && (
                          <Typography sx={{ color: '#DAAA4E', fontSize: 'calc(0.625rem * var(--dc-scale, 1))', ml: 0.75 }}>
                            VIEW
                          </Typography>
                        )}
                        {typeof t.rows === 'number' && (
                          <Typography sx={{ color: '#888', fontSize: 'calc(0.6875rem * var(--dc-scale, 1))', ml: 'auto' }}>
                            ~{t.rows.toLocaleString()} 行
                          </Typography>
                        )}
                      </Box>
                    );
                  })
                )}
              </Box>

              {/* 已选 chips */}
              {selectedTables.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Typography variant="caption" sx={{ color: '#BBBBBB', display: 'block', mb: 0.5 }}>
                    已选 {selectedTables.length} 张表：
                  </Typography>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selectedTables.map((t, i) => (
                      <Chip
                        key={`${t.connectionId}.${t.schemaName}.${t.tableName}.${i}`}
                        size="small"
                        label={
                          <span>
                            {t.schemaName && <b style={{ color: '#FF9800' }}>{t.schemaName}.</b>}
                            <code style={{ color: '#FFF' }}>{t.tableName}</code>
                          </span>
                        }
                        onDelete={() => removeSelectedTable(t)}
                        deleteIcon={<CloseIcon sx={{ fontSize: 'calc(0.875rem * var(--dc-scale, 1))' }} />}
                        sx={{ bgcolor: '#3C3F41', border: '1px solid #4B4B4B' }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </>
          )}
        </>
      ) : (
        // 自定义 SQL
        <Box>
          <Typography variant="caption" sx={{ color: '#BBBBBB', display: 'block', mb: 0.5 }}>
            输入自定义 SQL（SELECT 语句）：
          </Typography>
          <TextField
            multiline
            rows={6}
            fullWidth
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            placeholder="SELECT * FROM public.users WHERE created_at > '2024-01-01'"
            sx={{
              '& .MuiInputBase-root': {
                bgcolor: '#1E1E1E',
                color: '#DDDDDD',
                fontFamily: 'monospace',
                fontSize: 'calc(0.8125rem * var(--dc-scale, 1))',
              },
            }}
          />
        </Box>
      )}
    </Box>
  );
};

export default ExportStepSource;