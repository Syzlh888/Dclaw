/**
 * 「新建表映射」单页全展示对话框（v1.6 数据同步重构版）
 *
 * 布局（自上而下，单页）：
 *   1. 顶部：源/目标 连接 + Schema（两列网格，与数据导出向导一致）
 *   2. 中间：源表多选（☑ + 全选 + 搜索） + 配对表（☑ / 源表 / 目标表 / 增量字段 / 字段映射）
 *   3. 底部：自定义 SQL 折叠 + 取消 / 创建
 *
 * 关键规则：
 *   - 目标表默认与源表同名；同名目标表已存在 ✓，不存在 ⚠️
 *   - 增量字段下拉（拉源表 columns 列表）
 *   - 字段映射按钮（弹 TableMappingEditor）
 *   - 保留 props 接口：{ open, selectedTask, existingPairs, onClose, onCreated, onError }
 *
 * 数据流：
 *   - 选源连接 → 拉源 schemas
 *   - 选源 schema → 拉源 tables（含 columns 详情）
 *   - 选目标连接 → 拉目标 schemas
 *   - 选目标 schema → 拉目标 tables（用于检测同名是否存在）
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  IconButton,
  Paper,
  Radio,
  RadioGroup,
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
import CloseIcon from '@mui/icons-material/Close';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSyncStore } from '../../stores/syncStore';
import { apiFetch } from '../../services/apiClient';
import TableMappingEditor from './TableMappingEditor';
import TreeConnectionSelect from '../common/TreeConnectionSelect';
import type {
  CreateSyncMappingPayload,
  SyncColumnMapping,
  SyncTableMapping,
} from '../../types/sync';

interface Props {
  open: boolean;
  /** 当前选中的 task，用于预填连接/schema/写入策略；为 null 时禁止提交 */
  selectedTask: {
    id: string;
    source_connection_id: string;
    target_connection_id: string;
    source_schema?: string | null;
    target_schema?: string | null;
  } | null;
  /** 已存在映射的 (source, target) 集合，用于避免重复 */
  existingPairs: Set<string>;
  onClose: () => void;
  /** 创建完成后通知父组件刷新；返回所有新建的 mapping */
  onCreated: (created: SyncTableMapping[]) => void;
  /** 创建失败时把消息抛到父组件 Snackbar */
  onError: (msg: string) => void;
}

interface TableInfo {
  name: string;
  type?: string;
  comment?: string;
  rows?: number;
  columns?: Array<{
    name: string;
    type: string;
    nullable?: boolean;
    default?: string | null;
    comment?: string;
  }>;
}

interface PairRow {
  /** 行 key，渲染时用 */
  key: string;
  source: string;
  /** 默认 = source；可手动改；同名目标表存在 → ✓，否则 ⚠️ */
  target: string;
  /** 增量同步字段名（从源表 columns 拉取） */
  incrementalColumn: string;
  /** 'timestamp' | 'numeric' | '' —— 根据 incrementalColumn 类型自动判断（timestamp / date / datetime → timestamp） */
  incrementalType: 'timestamp' | 'numeric' | '';
  /** 字段映射（步骤通过 TableMappingEditor 编辑后写入） */
  columnMappings: SyncColumnMapping[];
}

const darkPaperSx = {
  bgcolor: '#3C3F41',
  color: 'text.secondary',
  border: '1px solid',
  borderColor: 'divider',
};

const fieldSx = {
  '& .MuiOutlinedInput-root': {
    color: 'text.primary',
    bgcolor: 'background.paper',
    fontSize: 13,
  },
  '& .MuiInputLabel-root': { color: 'text.secondary' },
};

export const MappingWizardDialog: React.FC<Props> = ({
  open,
  selectedTask,
  existingPairs,
  onClose,
  onCreated,
  onError,
}) => {
  const store = useSyncStore();
  const connectionsMap = useConnectionStore((s) => s.connections);
  const connections = useMemo(() => Object.values(connectionsMap), [connectionsMap]);

  const [submitting, setSubmitting] = useState(false);

  // —— 连接 / Schema ——
  const [sourceConnId, setSourceConnId] = useState('');
  const [targetConnId, setTargetConnId] = useState('');
  const [sourceSchema, setSourceSchema] = useState('');
  const [targetSchema, setTargetSchema] = useState('');
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([]);
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [sourceSchemasLoading, setSourceSchemasLoading] = useState(false);
  const [targetSchemasLoading, setTargetSchemasLoading] = useState(false);

  // —— 表（含 columns） ——
  const [sourceTables, setSourceTables] = useState<TableInfo[]>([]);
  const [targetTables, setTargetTables] = useState<TableInfo[]>([]);
  const [sourceTablesLoading, setSourceTablesLoading] = useState(false);
  const [targetTablesLoading, setTargetTablesLoading] = useState(false);

  // —— 行选择 + 配对 ——
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [pairs, setPairs] = useState<PairRow[]>([]);
  const [searchText, setSearchText] = useState('');

  // —— 自定义 SQL 模式 ——
  const [sourceKind, setSourceKind] = useState<'table' | 'sql'>('table');
  const [customSql, setCustomSql] = useState('');
  const [sqlTargetTable, setSqlTargetTable] = useState('');
  const [sqlOpen, setSqlOpen] = useState(false);

  // —— 字段映射编辑器（针对当前编辑行） ——
  const [editingPairIndex, setEditingPairIndex] = useState<number | null>(null);

  // —— 打开时根据 selectedTask 预填 ——
  useEffect(() => {
    if (!open) return;
    setSubmitting(false);
    setSourceConnId(selectedTask?.source_connection_id || '');
    setTargetConnId(selectedTask?.target_connection_id || '');
    setSourceSchema(selectedTask?.source_schema || '');
    setTargetSchema(selectedTask?.target_schema || '');
    setSourceTables([]);
    setTargetTables([]);
    setSelectedRows(new Set());
    setPairs([]);
    setSearchText('');
    setSourceKind('table');
    setCustomSql('');
    setSqlTargetTable('');
    setSqlOpen(false);
    setEditingPairIndex(null);
  }, [open, selectedTask]);

  // —— 源 Schema 加载 ——
  useEffect(() => {
    const connectionId = sourceConnId;
    if (!connectionId) {
      setSourceSchemas([]);
      return;
    }
    const conn = connectionsMap[connectionId];
    const fixed = (conn?.schema || '').trim();
    if (fixed) {
      setSourceSchemas([fixed]);
      setSourceSchemasLoading(false);
      setSourceSchema(fixed);
      return;
    }
    let cancelled = false;
    setSourceSchemasLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/schemas`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载 Schema 失败 (HTTP ${res.status})`);
        if (!cancelled) {
          const list: string[] = data.schemas || [];
          setSourceSchemas(list);
          if (list.length === 1 && !sourceSchema) setSourceSchema(list[0]);
        }
      } catch (err) {
        if (!cancelled) console.error('[wizard sourceSchemas]', err);
      } finally {
        if (!cancelled) setSourceSchemasLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceConnId]);

  // —— 目标 Schema 加载 ——
  useEffect(() => {
    const connectionId = targetConnId;
    if (!connectionId) {
      setTargetSchemas([]);
      return;
    }
    const conn = connectionsMap[connectionId];
    const fixed = (conn?.schema || '').trim();
    if (fixed) {
      setTargetSchemas([fixed]);
      setTargetSchemasLoading(false);
      setTargetSchema(fixed);
      return;
    }
    let cancelled = false;
    setTargetSchemasLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/schemas`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载 Schema 失败 (HTTP ${res.status})`);
        if (!cancelled) {
          const list: string[] = data.schemas || [];
          setTargetSchemas(list);
          if (list.length === 1 && !targetSchema) setTargetSchema(list[0]);
        }
      } catch (err) {
        if (!cancelled) console.error('[wizard targetSchemas]', err);
      } finally {
        if (!cancelled) setTargetSchemasLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetConnId]);

  // —— 源 Tables 加载（含 columns 详情） ——
  useEffect(() => {
    if (!sourceConnId || !sourceSchema) {
      setSourceTables([]);
      return;
    }
    let cancelled = false;
    setSourceTablesLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/connections/${sourceConnId}/tables?schema=${encodeURIComponent(sourceSchema)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载源表失败 (HTTP ${res.status})`);
        if (!cancelled) {
          const tables: TableInfo[] = Array.isArray(data.tables) ? data.tables : [];
          setSourceTables(tables);
        }
      } catch (err) {
        if (!cancelled) console.error('[wizard sourceTables]', err);
      } finally {
        if (!cancelled) setSourceTablesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceConnId, sourceSchema]);

  // —— 目标 Tables 加载（用于检测同名是否存在） ——
  useEffect(() => {
    if (!targetConnId || !targetSchema) {
      setTargetTables([]);
      return;
    }
    let cancelled = false;
    setTargetTablesLoading(true);
    (async () => {
      try {
        const res = await apiFetch(
          `/api/connections/${targetConnId}/tables?schema=${encodeURIComponent(targetSchema)}`,
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载目标表失败 (HTTP ${res.status})`);
        if (!cancelled) {
          const tables: TableInfo[] = Array.isArray(data.tables) ? data.tables : [];
          setTargetTables(tables);
        }
      } catch (err) {
        if (!cancelled) console.error('[wizard targetTables]', err);
      } finally {
        if (!cancelled) setTargetTablesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [targetConnId, targetSchema]);

  // —— 目标表名集合（用于检测同名） ——
  const targetTableNames = useMemo(
    () => new Set(targetTables.map((t) => t.name)),
    [targetTables],
  );

  // —— 源表过滤（搜索） ——
  const filteredSourceTables = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    if (!q) return sourceTables;
    return sourceTables.filter((t) => t.name.toLowerCase().includes(q));
  }, [sourceTables, searchText]);

  // —— 行选择 / 全选 ——
  const handleToggleRow = useCallback((name: string) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedRows((prev) => {
      const allNames = filteredSourceTables.map((t) => t.name);
      const allSelected = allNames.length > 0 && allNames.every((n) => prev.has(n));
      if (allSelected) return new Set();
      return new Set(allNames);
    });
  }, [filteredSourceTables]);

  const handleClearAll = useCallback(() => {
    setSelectedRows(new Set());
  }, []);

  const allFilteredSelected = useMemo(() => {
    if (filteredSourceTables.length === 0) return false;
    return filteredSourceTables.every((t) => selectedRows.has(t.name));
  }, [filteredSourceTables, selectedRows]);

  const someFilteredSelected = useMemo(() => {
    if (filteredSourceTables.length === 0) return false;
    return (
      filteredSourceTables.some((t) => selectedRows.has(t.name)) && !allFilteredSelected
    );
  }, [filteredSourceTables, selectedRows, allFilteredSelected]);

  // —— 当选中行集合变化时，自动按同名同步生成 pairs ——
  useEffect(() => {
    if (sourceKind !== 'table') return;
    setPairs((prev) => {
      const next: PairRow[] = [];
      const seen = new Set<string>();
      // 先保留已存在的（用户可能改了 target / incremental）
      for (const p of prev) {
        if (selectedRows.has(p.source)) {
          next.push(p);
          seen.add(p.source);
        }
      }
      // 再补齐新增的（默认 target = source 同名）
      for (const name of selectedRows) {
        if (seen.has(name)) continue;
        next.push({
          key: `pair-${name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: name,
          target: name,
          incrementalColumn: '',
          incrementalType: '',
          columnMappings: [],
        });
      }
      // 保持选中顺序稳定：按 selectedRows 顺序
      next.sort((a, b) => {
        const ai = Array.from(selectedRows).indexOf(a.source);
        const bi = Array.from(selectedRows).indexOf(b.source);
        return ai - bi;
      });
      return next;
    });
  }, [selectedRows, sourceKind]);

  // —— Pair 操作 ——
  const updatePair = (idx: number, patch: Partial<PairRow>) => {
    setPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const handleIncrementalColumnChange = (
    idx: number,
    colName: string,
    columnType: string | undefined,
  ) => {
    // 简单启发式：timestamp / date / datetime → 'timestamp'，否则 → 'numeric'
    const t = (columnType || '').toLowerCase();
    const inferred: 'timestamp' | 'numeric' | '' =
      t.includes('timestamp') || t.includes('datetime') || t === 'date'
        ? 'timestamp'
        : t.includes('int') || t === 'numeric' || t === 'decimal' || t === 'bigint'
        ? 'numeric'
        : '';
    updatePair(idx, {
      incrementalColumn: colName,
      incrementalType: inferred,
    });
  };

  const removePair = (idx: number) => {
    setPairs((prev) => {
      const removed = prev[idx];
      if (removed?.source) {
        setSelectedRows((rows) => {
          const next = new Set(rows);
          next.delete(removed.source);
          return next;
        });
      }
      return prev.filter((_, i) => i !== idx);
    });
  };

  // —— Schema / 连接区段 ——
  const renderSchemaSelect = (which: 'source' | 'target') => {
    const schemas = which === 'source' ? sourceSchemas : targetSchemas;
    const loading = which === 'source' ? sourceSchemasLoading : targetSchemasLoading;
    const value = which === 'source' ? sourceSchema : targetSchema;
    const setValue = which === 'source' ? setSourceSchema : setTargetSchema;
    const conn = which === 'source'
      ? sourceConnId
        ? connectionsMap[sourceConnId]
        : null
      : targetConnId
      ? connectionsMap[targetConnId]
      : null;
    const fixed = (conn?.schema || '').trim();
    const locked = !!fixed;
    return (
      <Autocomplete
        freeSolo={!locked}
        size="small"
        fullWidth
        options={schemas}
        value={value}
        disabled={!conn || locked}
        onChange={(_, val) => setValue(val || '')}
        onInputChange={(_, val) => setValue(val || '')}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label={which === 'source' ? '源 Schema' : '目标 Schema'}
            placeholder={
              !conn
                ? '请先选择连接'
                : locked
                ? `已锁定: ${fixed}`
                : loading
                ? '加载中…'
                : '选择或输入'
            }
            helperText={
              locked
                ? `连接已配置固定 schema: ${fixed}`
                : loading
                ? '正在加载…'
                : schemas.length === 0
                ? '未找到可用 Schema'
                : `共 ${schemas.length} 个`
            }
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? (
                    <CircularProgress size={14} sx={{ color: 'text.secondary' }} />
                  ) : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            sx={{
              mb: 1.5,
              ...fieldSx,
              '& .MuiFormHelperText-root': { color: 'text.secondary', ml: 0, mt: 0.3 },
            }}
          />
        )}
      />
    );
  };

  // —— 校验 ——
  const step1Valid = !!sourceConnId && !!targetConnId && !!sourceSchema && !!targetSchema;
  const step2Valid =
    sourceKind === 'sql'
      ? !!customSql.trim()
      : pairs.length > 0 &&
        pairs.every((p) => !!p.source.trim() && !!p.target.trim());

  // —— 当前编辑的 pair —— 临时构造一个 mapping 给 TableMappingEditor ——
  const editorPair = editingPairIndex != null ? pairs[editingPairIndex] : null;
  const editorMapping: SyncTableMapping | null = editorPair
    ? ({
        id: '__draft__',
        task_id: selectedTask?.id || '',
        source_table: editorPair.source,
        target_table: editorPair.target,
        column_mappings: editorPair.columnMappings,
      } as SyncTableMapping)
    : null;

  const handleEditorSave = (cols: SyncColumnMapping[]) => {
    if (editingPairIndex == null) return;
    updatePair(editingPairIndex, { columnMappings: cols });
    setEditingPairIndex(null);
  };

  // —— 创建 ——
  const handleSubmit = async () => {
    if (!selectedTask) {
      onError('未选中同步任务');
      return;
    }
    if (!step1Valid) {
      onError('请先选择源/目标连接和 Schema');
      return;
    }
    if (sourceKind === 'sql') {
      const sql = customSql.trim();
      if (!sql) {
        onError('请输入自定义 SQL');
        return;
      }
      if (!/^(SELECT|WITH)\b/i.test(sql)) {
        onError('自定义 SQL 必须是 SELECT 或 WITH 查询');
        return;
      }
      const targetTbl = sqlTargetTable.trim();
      if (!targetTbl) {
        onError('请填写自定义 SQL 模式的目标表');
        return;
      }
      setSubmitting(true);
      try {
        const item = await store.createMapping({
          taskId: selectedTask.id,
          sourceTable: '__custom_sql__',
          targetTable: targetTbl,
          customSql: sql,
          sequence: 0,
        } as CreateSyncMappingPayload);
        onCreated([item]);
        onClose();
      } catch (err) {
        onError(err instanceof Error ? err.message : '创建自定义 SQL 映射失败');
      } finally {
        setSubmitting(false);
      }
      return;
    }
    if (!step2Valid) {
      onError('每行配对必须同时填写源表和目标表');
      return;
    }
    setSubmitting(true);
    try {
      const payloads: CreateSyncMappingPayload[] = pairs.map((p, i) => ({
        taskId: selectedTask.id,
        sourceTable: p.source.trim(),
        targetTable: p.target.trim(),
        columnMappings: p.columnMappings.length > 0 ? p.columnMappings : undefined,
        incrementalColumn: p.incrementalColumn || null,
        incrementalType: p.incrementalType || null,
        sequence: i,
      }));
      const created = await store.createMappings(payloads);
      onCreated(created);
      onClose();
    } catch (err) {
      onError(err instanceof Error ? err.message : '批量创建映射失败');
    } finally {
      setSubmitting(false);
    }
  };

  // —— 渲染 ——
  return (
    <>
      <Dialog
        open={open}
        onClose={submitting ? undefined : onClose}
        maxWidth={false}
        PaperProps={{
          sx: {
            width: 'min(1080px, 96vw)',
            height: 'min(820px, 94vh)',
            maxHeight: '94vh',
            m: 1,
            ...darkPaperSx,
          },
        }}
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            py: 1,
            px: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <AccountTreeIcon sx={{ color: 'primary.main' }} />
          <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: 15 }}>
            新建表映射
          </Typography>
          <Chip
            size="small"
            label={selectedTask ? `任务：${selectedTask.id.slice(0, 8)}` : '未选任务'}
            sx={{
              ml: 1,
              bgcolor: 'action.disabledBackground',
              color: 'text.primary',
              height: 22,
              fontSize: 11,
            }}
          />
          <Box sx={{ flex: 1 }} />
          <IconButton
            size="small"
            onClick={onClose}
            disabled={submitting}
            sx={{ color: 'text.secondary' }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{ p: 2, bgcolor: 'background.default', overflow: 'auto' }}
        >
          {!selectedTask ? (
            <Alert severity="warning" sx={{ mb: 2 }}>
              请先在左侧选择一个同步任务，再创建表映射。
            </Alert>
          ) : null}

          {/* ===== 顶部：源/目标 连接 + Schema 两列 ===== */}
          <Grid container spacing={2} sx={{ mb: 2 }}>
            <Grid item xs={6}>
              <Paper
                sx={{
                  p: 1.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Typography
                  sx={{
                    color: 'primary.main',
                    fontSize: 12,
                    fontWeight: 600,
                    mb: 1,
                  }}
                >
                  源
                </Typography>
                <TreeConnectionSelect
                  value={sourceConnId}
                  onChange={(id) => setSourceConnId(id)}
                  label="源连接"
                  required
                />
                {renderSchemaSelect('source')}
              </Paper>
            </Grid>
            <Grid item xs={6}>
              <Paper
                sx={{
                  p: 1.5,
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                }}
              >
                <Typography
                  sx={{
                    color: 'success.main',
                    fontSize: 12,
                    fontWeight: 600,
                    mb: 1,
                  }}
                >
                  目标
                </Typography>
                <TreeConnectionSelect
                  value={targetConnId}
                  onChange={(id) => setTargetConnId(id)}
                  label="目标连接"
                  required
                />
                {renderSchemaSelect('target')}
              </Paper>
            </Grid>
          </Grid>

          {/* ===== 中间：源表多选 + 配对表 ===== */}
          {sourceKind === 'table' && (
            <Box>
              {/* 工具条：标题 + 全选 / 清空 / 搜索 */}
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  mb: 1,
                }}
              >
                <Typography
                  sx={{ color: 'text.primary', fontSize: 13, fontWeight: 600 }}
                >
                  源表（多选）
                </Typography>
                <Chip
                  size="small"
                  label={`已选 ${selectedRows.size} / ${sourceTables.length}`}
                  sx={{
                    height: 20,
                    bgcolor: 'action.disabledBackground',
                    color: 'text.secondary',
                    fontSize: 11,
                  }}
                />
                <Box sx={{ flex: 1 }} />
                <Button
                  size="small"
                  onClick={handleToggleAll}
                  disabled={filteredSourceTables.length === 0}
                  sx={{ color: 'primary.main', textTransform: 'none', fontSize: 12 }}
                >
                  {allFilteredSelected ? '取消全选' : '全选'}
                </Button>
                <Button
                  size="small"
                  onClick={handleClearAll}
                  disabled={selectedRows.size === 0}
                  sx={{ color: 'text.secondary', textTransform: 'none', fontSize: 12 }}
                >
                  清空
                </Button>
                <TextField
                  size="small"
                  placeholder="搜索源表…"
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  InputProps={{
                    startAdornment: (
                      <SearchIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} />
                    ),
                  }}
                  sx={{
                    width: 200,
                    '& .MuiOutlinedInput-root': {
                      color: 'text.primary',
                      bgcolor: 'background.paper',
                      fontSize: 12,
                      height: 32,
                    },
                  }}
                />
              </Box>

              {/* 配对表 */}
              <TableContainer
                component={Paper}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  maxHeight: 460,
                }}
              >
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell
                        padding="checkbox"
                        sx={{
                          bgcolor: 'background.paper',
                          color: 'text.secondary',
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          width: 42,
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={allFilteredSelected}
                          indeterminate={someFilteredSelected}
                          onChange={handleToggleAll}
                          disabled={filteredSourceTables.length === 0}
                          sx={{ color: 'text.disabled', p: 0.5 }}
                        />
                      </TableCell>
                      <TableCell
                        sx={{
                          bgcolor: 'background.paper',
                          color: 'text.secondary',
                          fontSize: 12,
                          fontWeight: 600,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          width: '22%',
                        }}
                      >
                        源表
                      </TableCell>
                      <TableCell
                        sx={{
                          bgcolor: 'background.paper',
                          color: 'text.secondary',
                          fontSize: 12,
                          fontWeight: 600,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          width: '26%',
                        }}
                      >
                        目标表
                      </TableCell>
                      <TableCell
                        sx={{
                          bgcolor: 'background.paper',
                          color: 'text.secondary',
                          fontSize: 12,
                          fontWeight: 600,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                          width: '24%',
                        }}
                      >
                        增量字段
                      </TableCell>
                      <TableCell
                        sx={{
                          bgcolor: 'background.paper',
                          color: 'text.secondary',
                          fontSize: 12,
                          fontWeight: 600,
                          borderBottom: '1px solid',
                          borderColor: 'divider',
                        }}
                      >
                        字段映射
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filteredSourceTables.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} sx={{ border: 0 }}>
                          <Typography
                            sx={{
                              p: 4,
                              color: 'text.disabled',
                              textAlign: 'center',
                              fontSize: 12,
                            }}
                          >
                            {!sourceConnId || !sourceSchema
                              ? '请先选择源连接和 Schema'
                              : sourceTablesLoading
                              ? '正在加载源表…'
                              : searchText
                              ? '没有匹配的源表'
                              : '未找到可用源表'}
                          </Typography>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredSourceTables.map((t) => {
                        const isSelected = selectedRows.has(t.name);
                        const pairIdx = pairs.findIndex((p) => p.source === t.name);
                        const pair = pairIdx >= 0 ? pairs[pairIdx] : null;
                        const targetExists = targetTableNames.has(t.name);
                        const columnOptions = (t.columns || []).map((c) => ({
                          name: c.name,
                          type: c.type,
                        }));
                        return (
                          <TableRow
                            key={t.name}
                            hover
                            sx={{
                              '&:hover': { bgcolor: 'action.hover' },
                              bgcolor: isSelected ? 'action.selected' : 'transparent',
                            }}
                          >
                            <TableCell padding="checkbox" sx={{ border: 0 }}>
                              <Checkbox
                                size="small"
                                checked={isSelected}
                                onChange={() => handleToggleRow(t.name)}
                                sx={{ color: 'text.disabled', p: 0.5 }}
                              />
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.75 }}>
                              <Typography
                                sx={{
                                  color: 'text.primary',
                                  fontSize: 12,
                                  fontWeight: isSelected ? 600 : 400,
                                }}
                              >
                                {t.name}
                              </Typography>
                              {t.comment ? (
                                <Typography
                                  sx={{
                                    color: 'text.disabled',
                                    fontSize: 10,
                                    lineHeight: 1.2,
                                  }}
                                >
                                  {t.comment}
                                </Typography>
                              ) : null}
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.75 }}>
                              {pair ? (
                                <Box
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.75,
                                  }}
                                >
                                  {targetExists ? (
                                    <Tooltip title="目标 schema 中已存在该表，可直接写入">
                                      <CheckCircleIcon
                                        sx={{ fontSize: 14, color: 'success.main' }}
                                      />
                                    </Tooltip>
                                  ) : (
                                    <Tooltip title="目标 schema 中不存在该表，将自动创建">
                                      <WarningAmberIcon
                                        sx={{ fontSize: 14, color: 'warning.main' }}
                                      />
                                    </Tooltip>
                                  )}
                                  <Autocomplete
                                    freeSolo
                                    size="small"
                                    options={Array.from(targetTableNames)}
                                    value={pair.target}
                                    onChange={(_, val) =>
                                      updatePair(pairIdx, { target: val || '' })
                                    }
                                    onInputChange={(_, val) =>
                                      updatePair(pairIdx, { target: val || '' })
                                    }
                                    sx={{
                                      flex: 1,
                                      '& .MuiOutlinedInput-root': {
                                        color: 'text.primary',
                                        bgcolor: 'background.default',
                                        fontSize: 12,
                                      },
                                      '& input': { padding: '4px 6px' },
                                    }}
                                    renderInput={(params) => (
                                      <TextField
                                        {...params}
                                        size="small"
                                        placeholder="目标表名"
                                      />
                                    )}
                                    ListboxProps={{
                                      sx: {
                                        fontSize: 12,
                                        '& li': { fontSize: 12 },
                                      },
                                    }}
                                  />
                                </Box>
                              ) : (
                                <Typography sx={{ color: 'text.disabled', fontSize: 11 }}>
                                  —
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.75 }}>
                              {pair ? (
                                <Autocomplete
                                  size="small"
                                  options={columnOptions}
                                  getOptionLabel={(o) =>
                                    typeof o === 'string' ? o : o.name
                                  }
                                  isOptionEqualToValue={(o, v) =>
                                    (typeof o === 'string' ? o : o.name) ===
                                    (typeof v === 'string' ? v : v.name)
                                  }
                                  value={
                                    columnOptions.find(
                                      (c) => c.name === pair.incrementalColumn,
                                    ) || null
                                  }
                                  onChange={(_, val) => {
                                    if (!val) {
                                      handleIncrementalColumnChange(pairIdx, '', undefined);
                                      return;
                                    }
                                    const colName =
                                      typeof val === 'string' ? val : val.name;
                                    const colType =
                                      typeof val === 'string' ? undefined : val.type;
                                    handleIncrementalColumnChange(
                                      pairIdx,
                                      colName,
                                      colType,
                                    );
                                  }}
                                  renderInput={(params) => (
                                    <TextField
                                      {...params}
                                      size="small"
                                      placeholder="选择增量字段"
                                    />
                                  )}
                                  sx={{
                                    '& .MuiOutlinedInput-root': {
                                      color: 'text.primary',
                                      bgcolor: 'background.default',
                                      fontSize: 12,
                                    },
                                    '& input': { padding: '4px 6px' },
                                  }}
                                  ListboxProps={{
                                    sx: { fontSize: 12, '& li': { fontSize: 12 } },
                                  }}
                                />
                              ) : (
                                <Typography sx={{ color: 'text.disabled', fontSize: 11 }}>
                                  —
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ border: 0, py: 0.75 }}>
                              {pair ? (
                                <Box
                                  sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.75,
                                  }}
                                >
                                  <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={
                                      <AccountTreeIcon sx={{ fontSize: 12 }} />
                                    }
                                    onClick={() => setEditingPairIndex(pairIdx)}
                                    disabled={!pair.source || !pair.target}
                                    sx={{
                                      minWidth: 'auto',
                                      px: 0.75,
                                      fontSize: 10,
                                      textTransform: 'none',
                                      color:
                                        pair.columnMappings.length > 0
                                          ? 'success.main'
                                          : 'primary.main',
                                      borderColor:
                                        pair.columnMappings.length > 0
                                          ? 'success.main'
                                          : 'primary.main',
                                    }}
                                  >
                                    {pair.columnMappings.length > 0
                                      ? `${pair.columnMappings.length} 字段`
                                      : '编辑'}
                                  </Button>
                                  <Tooltip title="删除该行">
                                    <IconButton
                                      size="small"
                                      onClick={() => removePair(pairIdx)}
                                      sx={{ color: 'error.light', p: 0.5 }}
                                    >
                                      <CloseIcon sx={{ fontSize: 14 }} />
                                    </IconButton>
                                  </Tooltip>
                                </Box>
                              ) : (
                                <Typography sx={{ color: 'text.disabled', fontSize: 11 }}>
                                  —
                                </Typography>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              {pairs.some(
                (p) =>
                  !!p.source &&
                  !!p.target &&
                  existingPairs.has(`${p.source}::${p.target}`),
              ) ? (
                <Alert severity="warning" sx={{ mt: 1.5, fontSize: 12 }}>
                  部分配对在当前任务下已存在，将被跳过。
                </Alert>
              ) : null}
            </Box>
          )}

          {/* ===== 底部：自定义 SQL 折叠区 ===== */}
          <Box
            sx={{
              mt: 2,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: 'background.paper',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.5,
                py: 0.75,
                cursor: 'pointer',
                userSelect: 'none',
              }}
              onClick={() => setSqlOpen((v) => !v)}
            >
              <ExpandMoreIcon
                sx={{
                  fontSize: 18,
                  color: 'text.secondary',
                  transform: sqlOpen ? 'rotate(0deg)' : 'rotate(-90deg)',
                  transition: 'transform 0.15s',
                }}
              />
              <Typography
                sx={{ color: 'text.primary', fontSize: 13, fontWeight: 600 }}
              >
                自定义 SQL 查询（可选）
              </Typography>
              <Chip
                size="small"
                label={sourceKind === 'sql' ? '已开启' : '未启用'}
                sx={{
                  ml: 0.5,
                  height: 20,
                  fontSize: 10,
                  bgcolor:
                    sourceKind === 'sql' ? 'primary.dark' : 'action.disabledBackground',
                  color: sourceKind === 'sql' ? 'common.white' : 'text.secondary',
                }}
              />
              <Box sx={{ flex: 1 }} />
              <RadioGroup
                row
                value={sourceKind}
                onChange={(e) => {
                  setSourceKind(e.target.value as 'table' | 'sql');
                  if (e.target.value === 'sql') setSqlOpen(true);
                }}
                onClick={(e) => e.stopPropagation()}
                sx={{ color: 'text.secondary' }}
              >
                <FormControlLabel
                  value="table"
                  control={<Radio size="small" sx={{ color: 'text.disabled' }} />}
                  label="选中表"
                  sx={{ color: 'text.secondary', '& .MuiTypography-root': { fontSize: 11 } }}
                />
                <FormControlLabel
                  value="sql"
                  control={<Radio size="small" sx={{ color: 'text.disabled' }} />}
                  label="自定义 SQL"
                  sx={{ color: 'text.secondary', '& .MuiTypography-root': { fontSize: 11 } }}
                />
              </RadioGroup>
            </Box>
            <Collapse in={sqlOpen}>
              <Box sx={{ px: 1.5, pb: 1.5 }}>
                <Typography
                  variant="caption"
                  sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}
                >
                  输入自定义 SQL（SELECT 或 WITH 查询），并指定目标表：
                </Typography>
                <TextField
                  multiline
                  rows={4}
                  fullWidth
                  value={customSql}
                  onChange={(e) => setCustomSql(e.target.value)}
                  placeholder="SELECT * FROM public.users WHERE created_at > '2024-01-01'"
                  sx={{
                    mb: 1.5,
                    '& .MuiInputBase-root': {
                      bgcolor: 'background.default',
                      color: 'text.primary',
                      fontFamily: 'monospace',
                      fontSize: 12,
                    },
                  }}
                />
                <Autocomplete
                  freeSolo
                  size="small"
                  options={targetTables.map((t) => t.name)}
                  value={sqlTargetTable}
                  onChange={(_, val) => setSqlTargetTable(val || '')}
                  onInputChange={(_, val) => setSqlTargetTable(val || '')}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      label="目标表"
                      placeholder="选择或输入目标表名"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          color: 'text.primary',
                          bgcolor: 'background.default',
                          fontSize: 12,
                        },
                      }}
                    />
                  )}
                  ListboxProps={{ sx: { fontSize: 12, '& li': { fontSize: 12 } } }}
                />
              </Box>
            </Collapse>
          </Box>
        </DialogContent>

        <DialogActions
          sx={{
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
            px: 2,
            py: 1.25,
            justifyContent: 'space-between',
          }}
        >
          <Typography sx={{ color: 'text.secondary', fontSize: 11 }}>
            {sourceKind === 'sql'
              ? customSql.trim()
                ? '自定义 SQL 模式：1 条映射'
                : '请填写自定义 SQL'
              : `共 ${pairs.length} 对配对`}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Button
              onClick={onClose}
              disabled={submitting}
              sx={{ color: 'text.secondary', textTransform: 'none' }}
            >
              取消
            </Button>
            <Button
              onClick={handleSubmit}
              variant="contained"
              disabled={submitting || !selectedTask || !step2Valid}
              sx={{ textTransform: 'none' }}
            >
              {submitting ? (
                <CircularProgress size={14} sx={{ color: 'common.white', mr: 1 }} />
              ) : null}
              {sourceKind === 'sql'
                ? '创建 SQL 映射'
                : `创建 ${pairs.length > 0 ? `(${pairs.length})` : ''} 条映射`}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>

      <TableMappingEditor
        open={editingPairIndex != null}
        mapping={editorMapping}
        sourceConnectionId={sourceConnId}
        sourceSchema={sourceSchema || undefined}
        targetConnectionId={targetConnId}
        targetSchema={targetSchema || undefined}
        onClose={() => setEditingPairIndex(null)}
        onSave={handleEditorSave}
      />
    </>
  );
};

export default MappingWizardDialog;