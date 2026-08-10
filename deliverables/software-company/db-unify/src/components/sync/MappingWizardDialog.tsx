/**
 * 「新建表映射」向导式对话框（v1.6 数据同步）
 *
 * 三步式：
 *   步骤 1：源/目标连接 + Schema（树形选择器 + Schema 下拉，参照数据导出向导）
 *   步骤 2：多选源表 + 多选目标表；按同名自动配对，UI 上每行可单独调整 target，
 *           缺目标时留空；可增/减行（来自源表列表 / 来自目标表列表）
 *   步骤 3：字段映射（可选）— 复用 TableMappingEditor，编辑当前 pair 的字段
 *   底部：上一步 / 创建（批量调 store.createMappings，逐条写入 sync_table_mapping）
 *
 * 数据流：
 *   - openForm('mapping') 在父组件打开本 Dialog
 *   - onCreated 回调在所有映射创建完成后触发，父组件 store.loadMappings
 *   - 创建失败的中间态不会自动回滚（保持显式），错误走顶层 Snackbar
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  Paper,
  Radio,
  RadioGroup,
  Step,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
  Checkbox,
  InputAdornment,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SearchIcon from '@mui/icons-material/Search';
import { useConnectionStore } from '../../stores/connectionStore';
import { useSyncStore } from '../../stores/syncStore';
import { apiFetch } from '../../services/apiClient';
import { useShallow } from 'zustand/react/shallow';
import TableMappingEditor from './TableMappingEditor';
import TreeConnectionSelect from '../common/TreeConnectionSelect';
import type { CreateSyncMappingPayload, SyncColumnMapping, SyncTableMapping } from '../../types/sync';

interface Props {
  open: boolean;
  /** 当前选中的 task，用于预填连接/schema/写入策略；为 null 时禁止提交 */
  selectedTask: { id: string; source_connection_id: string; target_connection_id: string; source_schema?: string | null; target_schema?: string | null } | null;
  /** 已存在映射的 (source, target) 集合，用于避免重复 */
  existingPairs: Set<string>;
  onClose: () => void;
  /** 创建完成后通知父组件刷新；返回所有新建的 mapping */
  onCreated: (created: SyncTableMapping[]) => void;
  /** 创建失败时把消息抛到父组件 Snackbar */
  onError: (msg: string) => void;
}

type TableOption = { name: string };

type PairRow = {
  /** 行 key，渲染时用 */
  key: string;
  source: string;
  target: string;
  /** 已配置的字段映射草稿（步骤 3 编辑后写入），提交时随 createMapping 一起发 */
  columnMappings: SyncColumnMapping[];
};

const STEPS = ['配对源/目标表', '字段映射（可选）'] as const;

const darkPaperSx = { bgcolor: '#3C3F41', color: 'text.secondary', border: '1px solid', borderColor: 'divider' };
const fieldSx = { '& .MuiOutlinedInput-root': { color: 'text.primary', bgcolor: 'background.paper', fontSize: 13 }, '& .MuiInputLabel-root': { color: 'text.secondary' } };

export const MappingWizardDialog: React.FC<Props> = ({
  open,
  selectedTask,
  existingPairs,
  onClose,
  onCreated,
  onError,
}) => {
  // 使用 useShallow 避免 SSE 进度事件触发整个向导重渲
  const store = useSyncStore(
    useShallow((s) => ({
      createMapping: s.createMapping,
      createMappings: s.createMappings,
    })),
  );
  const connectionsMap = useConnectionStore((s) => s.connections);
  const connections = useMemo(() => Object.values(connectionsMap), [connectionsMap]);
  
  const [activeStep, setActiveStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  // 步骤 1：连接 / Schema
  const [sourceConnId, setSourceConnId] = useState('');
  const [targetConnId, setTargetConnId] = useState('');
  const [sourceSchema, setSourceSchema] = useState('');
  const [targetSchema, setTargetSchema] = useState('');
  const sourceConnName = connectionsMap[sourceConnId]?.name;
  const targetConnName = connectionsMap[targetConnId]?.name;
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([]);
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [sourceSchemasLoading, setSourceSchemasLoading] = useState(false);
  const [targetSchemasLoading, setTargetSchemasLoading] = useState(false);

  // 树形连接下拉状态

  // 步骤 2：表
  const [sourceTables, setSourceTables] = useState<TableOption[]>([]);
  const [targetTables, setTargetTables] = useState<TableOption[]>([]);
  const [sourceTablesLoading, setSourceTablesLoading] = useState(false);
  const [targetTablesLoading, setTargetTablesLoading] = useState(false);
  // 「新建表映射」源类型：'table' = 多选配对；'sql' = 自定义 SQL
  const [sourceKind, setSourceKind] = useState<'table' | 'sql'>('table');
  const [customSql, setCustomSql] = useState('');
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [pairs, setPairs] = useState<PairRow[]>([]);

  // 步骤 3：字段映射（仅针对当前编辑行）
  const [editingPairIndex, setEditingPairIndex] = useState<number | null>(null);

  // 打开时根据 selectedTask 预填
  useEffect(() => {
    if (!open) return;
    setActiveStep(0);
    setSubmitting(false);
    setSourceConnId(selectedTask?.source_connection_id || '');
    setTargetConnId(selectedTask?.target_connection_id || '');
    setSourceSchema(selectedTask?.source_schema || '');
    setTargetSchema(selectedTask?.target_schema || '');
    setSourceTables([]);
    setTargetTables([]);
    setSelectedSources([]);
    setSelectedTargets([]);
    setPairs([]);
    setEditingPairIndex(null);
  }, [open, selectedTask]);

  // —— Schemas 加载（与单表单版一致） ——
  useEffect(() => {
    const connectionId = sourceConnId;
    if (!connectionId) { setSourceSchemas([]); return; }
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
      } catch (err) { if (!cancelled) console.error('[wizard sourceSchemas]', err); }
      finally { if (!cancelled) setSourceSchemasLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [sourceConnId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const connectionId = targetConnId;
    if (!connectionId) { setTargetSchemas([]); return; }
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
      } catch (err) { if (!cancelled) console.error('[wizard targetSchemas]', err); }
      finally { if (!cancelled) setTargetSchemasLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [targetConnId]); // eslint-disable-line react-hooks/exhaustive-deps

  // —— Tables 加载（按 connection + schema） ——
  useEffect(() => {
    if (!sourceConnId || !sourceSchema) { setSourceTables([]); return; }
    let cancelled = false;
    setSourceTablesLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${sourceConnId}/tables?schema=${encodeURIComponent(sourceSchema)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载源表失败 (HTTP ${res.status})`);
        if (!cancelled) setSourceTables(Array.isArray(data.tables) ? data.tables : []);
      } catch (err) { if (!cancelled) console.error('[wizard sourceTables]', err); }
      finally { if (!cancelled) setSourceTablesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [sourceConnId, sourceSchema]);

  useEffect(() => {
    if (!targetConnId || !targetSchema) { setTargetTables([]); return; }
    let cancelled = false;
    setTargetTablesLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${targetConnId}/tables?schema=${encodeURIComponent(targetSchema)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载目标表失败 (HTTP ${res.status})`);
        if (!cancelled) setTargetTables(Array.isArray(data.tables) ? data.tables : []);
      } catch (err) { if (!cancelled) console.error('[wizard targetTables]', err); }
      finally { if (!cancelled) setTargetTablesLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [targetConnId, targetSchema]);

  // —— 表名集合（大小写不敏感） ——
  const sourceSet = useMemo(() => new Set(sourceTables.map((t) => t.name)), [sourceTables]);
  const targetSet = useMemo(() => new Set(targetTables.map((t) => t.name)), [targetTables]);

  // —— 自动按同名配对 ——
  // 规则：按 source 顺序遍历；source[i] 在 targetSet 里出现 → 配对（同名优先）；
  // target[i] 中相同顺序若也在 source 里 → 也用同名，否则用 source[i] + 顺序配对
  // 已存在的 (source,target) 跳过（防重复）。
  const autoPair = useCallback(() => {
    const newPairs: PairRow[] = [];
    const usedTargets = new Set<string>();
    const len = Math.max(selectedSources.length, selectedTargets.length);
    for (let i = 0; i < len; i += 1) {
      const sName = selectedSources[i] || '';
      let tName = selectedTargets[i] || '';
      if (sName && !tName && targetSet.has(sName)) {
        tName = sName; // 同名优先
      }
      if (!sName && !tName) continue;
      if (tName) usedTargets.add(tName);
      const dupKey = `${sName}::${tName}`;
      if (sName && tName && existingPairs.has(dupKey)) continue;
      if (tName && usedTargets.has(tName) && tName !== selectedTargets[i]) {
        // 已被之前行用过（自动配对产生冲突） → 留空
        tName = '';
      }
      newPairs.push({
        key: `pair-${i}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        source: sName,
        target: tName,
        columnMappings: [],
      });
    }
    setPairs(newPairs);
  }, [selectedSources, selectedTargets, targetSet, existingPairs]);

  // 当源/目标任一边变化、但用户没在手动编辑 pairs 时，自动跑一次
  useEffect(() => {
    if (activeStep !== 0) return;
    if (selectedSources.length === 0 && selectedTargets.length === 0) {
      setPairs([]);
      return;
    }
    autoPair();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSources, selectedTargets, activeStep]);

  const schemaSelect = (which: 'source' | 'target') => {
    const schemas = which === 'source' ? sourceSchemas : targetSchemas;
    const loading = which === 'source' ? sourceSchemasLoading : targetSchemasLoading;
    const value = which === 'source' ? sourceSchema : targetSchema;
    const setValue = which === 'source' ? setSourceSchema : setTargetSchema;
    const conn = which === 'source' ? (sourceConnId ? connectionsMap[sourceConnId] : null) : (targetConnId ? connectionsMap[targetConnId] : null);
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
            placeholder={!conn ? '请先选择连接' : locked ? `已锁定: ${fixed}` : loading ? '加载中…' : '选择或输入'}
            helperText={locked ? `连接已配置固定 schema: ${fixed}` : loading ? '正在加载…' : (schemas.length === 0 ? '未找到可用 Schema' : `共 ${schemas.length} 个`)}
            InputProps={{
              ...params.InputProps,
              endAdornment: (<>{loading ? <CircularProgress size={14} sx={{ color: 'text.secondary' }} /> : null}{params.InputProps.endAdornment}</>),
            }}
            sx={{ mb: 1.5, bgcolor: locked ? 'background.paper' : 'background.paper', ...fieldSx, '& .MuiFormHelperText-root': { color: 'text.secondary', ml: 0, mt: 0.3 } }}
          />
        )}
      />
    );
  };

  // —— 多选表 Autocomplete（值是字符串数组，不是对象数组） ——
  // 表多选（带 checkbox + 全选 + 搜索 + 列表）
  const [tableSearch, setTableSearch] = useState<{ source: string; target: string }>({ source: '', target: '' });
  const tableMultiSelect = (which: 'source' | 'target') => {
    const tables = which === 'source' ? sourceTables : targetTables;
    const loading = which === 'source' ? sourceTablesLoading : targetTablesLoading;
    const value = which === 'source' ? selectedSources : selectedTargets;
    const setValue = which === 'source' ? setSelectedSources : setSelectedTargets;
    const connOk = which === 'source' ? (!!sourceConnId && !!sourceSchema) : (!!targetConnId && !!targetSchema);
    const search = which === 'source' ? tableSearch.source : tableSearch.target;
    const setSearch = (v: string) => setTableSearch((s) => ({ ...s, [which]: v }));
    const allNames = tables.map((t) => t.name);
    const filtered = allNames.filter((n) => n.toLowerCase().includes(search.toLowerCase()));
    const allSelected = filtered.length > 0 && filtered.every((n) => value.includes(n));
    const toggleAll = () => {
      if (allSelected) {
        setValue(value.filter((n) => !filtered.includes(n)));
      } else {
        const merged = Array.from(new Set([...value, ...filtered]));
        setValue(merged);
      }
    };
    const toggleOne = (n: string) => {
      if (value.includes(n)) setValue(value.filter((v) => v !== n));
      else setValue([...value, n]);
    };
    return (
      <Box sx={{ mb: 1.5 }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 12, mb: 0.5 }}>{which === 'source' ? '源表（可多选）' : '目标表（可多选）'}</Typography>
        {!connOk ? (
          <Typography sx={{ color: 'text.disabled', fontSize: 12, py: 1 }}>请先选择连接和 Schema</Typography>
        ) : (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <TextField
                size="small"
                fullWidth
                placeholder="搜索表名..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                InputProps={{
                  startAdornment: (<InputAdornment position="start"><SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} /></InputAdornment>),
                }}
                sx={{ '& .MuiOutlinedInput-root': { color: 'text.primary', bgcolor: 'background.paper', fontSize: 12 } }}
              />
              <Button
                size="small"
                variant="text"
                onClick={toggleAll}
                disabled={filtered.length === 0}
                sx={{ color: 'primary.main', textTransform: 'none', minWidth: 80, fontSize: 12, whiteSpace: 'nowrap' }}
              >
                {allSelected ? '取消全选' : '全选'}
              </Button>
            </Box>
            <Box sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', borderRadius: 1, maxHeight: 220, overflow: 'auto' }}>
              {loading ? (
                <Box sx={{ p: 2, textAlign: 'center' }}><CircularProgress size={18} /></Box>
              ) : filtered.length === 0 ? (
                <Typography sx={{ p: 1.5, color: 'text.disabled', fontSize: 12, textAlign: 'center' }}>未找到匹配表</Typography>
              ) : (
                filtered.map((name) => {
                  const checked = value.includes(name);
                  return (
                    <Box
                      key={name}
                      onClick={() => toggleOne(name)}
                      sx={{
                        display: 'flex', alignItems: 'center', gap: 1, px: 1, py: 0.5,
                        cursor: 'pointer',
                        bgcolor: checked ? 'action.selected' : 'transparent',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Checkbox checked={checked} size="small" sx={{ p: 0, color: 'text.disabled', '&.Mui-checked': { color: 'primary.main' } }} />
                      <Typography sx={{ color: 'text.primary', fontSize: 12 }}>{name}</Typography>
                    </Box>
                  );
                })
              )}
            </Box>
            <Typography sx={{ color: 'text.disabled', fontSize: 11, mt: 0.5 }}>已选 {value.length} / {allNames.length}</Typography>
          </>
        )}
      </Box>
    );
  };

  // —— 配对行编辑 ——
  const updatePair = (idx: number, patch: Partial<PairRow>) => {
    setPairs((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };
  const removePair = (idx: number) => {
    setPairs((prev) => prev.filter((_, i) => i !== idx));
  };
  const addPairFromSource = (name: string) => {
    setPairs((prev) => [...prev, { key: `add-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, source: name, target: targetSet.has(name) ? name : '', columnMappings: [] }]);
  };
  const addPairFromTarget = (name: string) => {
    setPairs((prev) => [...prev, { key: `add-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, source: sourceSet.has(name) ? name : '', target: name, columnMappings: [] }]);
  };
  const addEmptyPair = () => {
    setPairs((prev) => [...prev, { key: `add-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, source: '', target: '', columnMappings: [] }]);
  };

  // —— 步骤导航 / 校验 ——
  const step1Valid = !!sourceConnId && !!targetConnId && !!sourceSchema && !!targetSchema;
  const step2Valid = pairs.length > 0 && pairs.every((p) => !!p.source && !!p.target);
  const step3Valid = true; // 字段映射是可选的

  const handleNext = () => {
    if (activeStep === 0 && !step1Valid) {
      onError('请先选择源/目标连接和 Schema');
      return;
    }
    if (activeStep === 0 && !step2Valid) {
      onError('请为每行配对填写源表和目标表');
      return;
    }
    setActiveStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const handleBack = () => setActiveStep((s) => Math.max(s - 1, 0));

  const handleSubmit = async () => {
    if (!selectedTask) {
      onError('未选中同步任务');
      return;
    }
    if (sourceKind === 'sql') {
      const sql = customSql.trim();
      if (!sql) { onError('请输入自定义 SQL'); return; }
      if (!/^(SELECT|WITH)\b/i.test(sql)) { onError('自定义 SQL 必须是 SELECT 或 WITH 查询'); return; }
      // 自定义 SQL 模式：第一个 targetTable 是目标，其他忽略
      const validPairs = pairs.filter((p) => p.target.trim());
      if (validPairs.length === 0) { onError('请至少选择一个目标表'); return; }
      setSubmitting(true);
      try {
        const item = await store.createMapping({
          taskId: selectedTask.id,
          sourceTable: '__custom_sql__',
          targetTable: validPairs[0].target.trim(),
          customSql: sql,
          sequence: 0,
        } as any);
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

  // —— 行：源/目标 下拉 ——
  const sourceOptionsAvailable = sourceTables.map((t) => t.name);
  const targetOptionsAvailable = targetTables.map((t) => t.name);

  // 步骤 3 中当前编辑的 pair → 临时构造一个 mapping 给 TableMappingEditor
  const editorPair = editingPairIndex != null ? pairs[editingPairIndex] : null;
  const editorMapping: SyncTableMapping | null = editorPair ? ({
    id: '__draft__',
    task_id: selectedTask?.id || '',
    source_table: editorPair.source,
    target_table: editorPair.target,
    column_mappings: editorPair.columnMappings,
  } as SyncTableMapping) : null;

  const handleEditorSave = (cols: SyncColumnMapping[]) => {
    if (editingPairIndex == null) return;
    updatePair(editingPairIndex, { columnMappings: cols });
    setEditingPairIndex(null);
  };

  // —— 渲染 ——
  return (
    <>
      <Dialog open={open} onClose={submitting ? undefined : onClose} maxWidth={false} PaperProps={{ sx: { width: 'min(960px, 96vw)', height: 'min(720px, 92vh)', maxHeight: '92vh', m: 1, ...darkPaperSx } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, px: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <AccountTreeIcon sx={{ color: 'primary.main' }} />
          <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: 15 }}>新建表映射（向导）</Typography>
          <Chip size="small" label={selectedTask ? `任务：${selectedTask.id.slice(0, 8)}` : '未选任务'} sx={{ ml: 1, bgcolor: 'action.disabledBackground', color: 'text.primary', height: 22, fontSize: 11 }} />
          <Box sx={{ flex: 1 }} />
          <IconButton size="small" onClick={onClose} disabled={submitting} sx={{ color: 'text.secondary' }}><CloseIcon fontSize="small" /></IconButton>
        </DialogTitle>

        <Box sx={{ px: 3, pt: 2, borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
          <Stepper activeStep={activeStep} alternativeLabel sx={{ '& .MuiStepLabel-label': { color: 'text.secondary', fontSize: 12 }, '& .MuiStepLabel-label.Mui-active': { color: 'primary.main' }, '& .MuiStepIcon-root': { color: 'text.disabled' }, '& .MuiStepIcon-root.Mui-active': { color: 'primary.main' }, '& .MuiStepIcon-root.Mui-completed': { color: 'success.main' } }}>
            {STEPS.map((label) => (<Step key={label}><StepLabel>{label}</StepLabel></Step>))}
          </Stepper>
        </Box>

        <DialogContent dividers sx={{ p: 2, bgcolor: 'background.default', overflow: 'auto' }}>
          {!selectedTask ? (
            <Alert severity="warning" sx={{ mb: 2 }}>请先在左侧选择一个同步任务，再创建表映射。</Alert>
          ) : null}

          {/* 连接/schema 完全继承自当前任务，UI 不再展示 */}

          {activeStep === 0 && (
            <Box>
              <RadioGroup row value={sourceKind} onChange={(e) => setSourceKind(e.target.value as 'table' | 'sql')} sx={{ mb: 1.5, color: 'text.secondary' }}>
                <FormControlLabel value="table" control={<Radio size="small" sx={{ color: 'text.disabled' }} />} label="选中表（多对配对）" sx={{ color: 'text.secondary' }} />
                <FormControlLabel value="sql" control={<Radio size="small" sx={{ color: 'text.disabled' }} />} label="自定义 SQL 查询" sx={{ color: 'text.secondary' }} />
              </RadioGroup>
              {sourceKind === 'sql' ? (
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>输入自定义 SQL（SELECT 或 WITH 查询）：</Typography>
                  <TextField multiline rows={6} fullWidth value={customSql} onChange={(e) => setCustomSql(e.target.value)} placeholder="SELECT * FROM public.users WHERE created_at > '2024-01-01'" sx={{ mb: 2, '& .MuiInputBase-root': { bgcolor: 'background.default', color: 'text.primary', fontFamily: 'monospace', fontSize: 13 } }} />
                  {tableMultiSelect('target')}
                </Box>
              ) : (
                <Box>
                  <Alert severity="info" sx={{ mb: 2, fontSize: 12 }} variant="outlined">
                    多选源表和多选目标表。按同名自动配对（同名优先）；每行可手动调整。空源表 / 空目标表行将不会创建。
                  </Alert>
                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, mb: 2 }}>
                    {tableMultiSelect('source')}
                    {tableMultiSelect('target')}
                  </Box>
                </Box>
              )}
              <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                <Typography sx={{ color: 'text.primary', fontSize: 13, fontWeight: 600 }}>配对列表</Typography>
                <Chip size="small" label={`${pairs.length} 对`} sx={{ ml: 1, height: 20, bgcolor: 'action.disabledBackground', color: 'text.secondary', fontSize: 11 }} />
                <Box sx={{ flex: 1 }} />
                <Button size="small" startIcon={<AutoFixHighIcon sx={{ fontSize: 14 }} />} onClick={autoPair} sx={{ color: 'primary.main', textTransform: 'none' }}>重新自动配对</Button>
                <Button size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={addEmptyPair} sx={{ ml: 1, color: 'primary.main', textTransform: 'none' }}>新增一行</Button>
              </Box>
              <Paper sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: '40px 1fr 24px 1fr 90px 36px', px: 1.25, py: 0.75, bgcolor: 'background.paper', color: 'text.secondary', fontSize: 11, borderBottom: '1px solid', borderColor: 'divider' }}>
                  <span>#</span><span>源表</span><span /><span>目标表</span><span>字段</span><span />
                </Box>
                {pairs.length === 0 && (
                  <Typography sx={{ p: 3, color: 'text.disabled', textAlign: 'center', fontSize: 12 }}>暂无配对，请在上方多选源表和目标表</Typography>
                )}
                {pairs.map((p, idx) => {
                  const dupKey = `${p.source}::${p.target}`;
                  const isDup = !!p.source && !!p.target && existingPairs.has(dupKey);
                  const sourcesAvail = sourceOptionsAvailable.length > 0 ? sourceOptionsAvailable : (p.source ? [p.source] : []);
                  const targetsAvail = targetOptionsAvailable.length > 0 ? targetOptionsAvailable : (p.target ? [p.target] : []);
                  return (
                    <Box key={p.key} sx={{ display: 'grid', gridTemplateColumns: '40px 1fr 24px 1fr 90px 36px', gap: 1, alignItems: 'center', px: 1.25, py: 0.75, borderBottom: idx < pairs.length - 1 ? '1px solid' : 0, borderColor: 'divider', bgcolor: isDup ? 'rgba(239, 83, 80, 0.08)' : 'transparent' }}>
                      <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>{idx + 1}</Typography>
                      <Autocomplete
                        freeSolo
                        size="small"
                        options={sourcesAvail}
                        value={p.source}
                        onChange={(_, val) => updatePair(idx, { source: val || '' })}
                        onInputChange={(_, val) => updatePair(idx, { source: val || '' })}
                        renderInput={(params) => <TextField {...params} size="small" placeholder="源表" sx={{ '& .MuiOutlinedInput-root': { color: 'text.primary', bgcolor: 'background.paper', fontSize: 12 }, '& input': { padding: '5px 6px' } }} />}
                        ListboxProps={{ sx: { fontSize: 12, '& li': { fontSize: 12 } } }}
                        slotProps={{ paper: { sx: { bgcolor: 'background.paper', color: 'common.white' } } }}
                      />
                      <ArrowForwardIcon sx={{ color: 'text.secondary', fontSize: 16 }} />
                      <Autocomplete
                        freeSolo
                        size="small"
                        options={targetsAvail}
                        value={p.target}
                        onChange={(_, val) => updatePair(idx, { target: val || '' })}
                        onInputChange={(_, val) => updatePair(idx, { target: val || '' })}
                        renderInput={(params) => <TextField {...params} size="small" placeholder="目标表" sx={{ '& .MuiOutlinedInput-root': { color: 'text.primary', bgcolor: 'background.paper', fontSize: 12 }, '& input': { padding: '5px 6px' } }} />}
                        ListboxProps={{ sx: { fontSize: 12, '& li': { fontSize: 12 } } }}
                        slotProps={{ paper: { sx: { bgcolor: 'background.paper', color: 'common.white' } } }}
                      />
                      <Tooltip title={p.columnMappings.length > 0 ? `已配 ${p.columnMappings.length} 个字段（点此编辑）` : '字段映射（可选）'}>
                        <span>
                          <Button
                            size="small"
                            startIcon={<AccountTreeIcon sx={{ fontSize: 12 }} />}
                            onClick={() => setEditingPairIndex(idx)}
                            disabled={!p.source || !p.target}
                            sx={{ minWidth: 'auto', px: 0.75, fontSize: 10, color: p.columnMappings.length > 0 ? 'success.main' : 'primary.main', borderColor: p.columnMappings.length > 0 ? 'success.main' : 'primary.main' }}
                            variant="outlined"
                          >
                            {p.columnMappings.length > 0 ? `${p.columnMappings.length}` : '配置'}
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="删除该行">
                        <span>
                          <IconButton size="small" onClick={() => removePair(idx)} sx={{ color: 'error.light' }}><DeleteOutlineIcon sx={{ fontSize: 16 }} /></IconButton>
                        </span>
                      </Tooltip>
                    </Box>
                  );
                })}
                {pairs.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.25, py: 1, bgcolor: 'background.paper' }}>
                    <Typography sx={{ color: 'text.secondary', fontSize: 11 }}>从已有表快速添加：</Typography>
                    {sourceTables.filter((t) => !pairs.some((p) => p.source === t.name)).slice(0, 6).map((t) => (
                      <Chip key={`s-${t.name}`} label={t.name} size="small" onClick={() => addPairFromSource(t.name)} sx={{ bgcolor: 'background.paper', color: 'primary.light', border: '1px dashed', borderColor: 'primary.main', height: 22, fontSize: 11, cursor: 'pointer' }} />
                    ))}
                    {targetTables.filter((t) => !pairs.some((p) => p.target === t.name)).slice(0, 6).map((t) => (
                      <Chip key={`t-${t.name}`} label={t.name} size="small" onClick={() => addPairFromTarget(t.name)} sx={{ bgcolor: 'background.paper', color: 'success.light', border: '1px dashed', borderColor: 'success.main', height: 22, fontSize: 11, cursor: 'pointer' }} />
                    ))}
                  </Box>
                )}
              </Paper>
              {pairs.some((p) => `${p.source}::${p.target}` && !!p.source && !!p.target && existingPairs.has(`${p.source}::${p.target}`)) && (
                <Alert severity="warning" sx={{ mt: 1.5, fontSize: 12 }}>部分配对在当前任务下已存在，将被跳过。</Alert>
              )}
            </Box>
          )}

          {activeStep === 2 && (
            <Box>
              <Alert severity="info" sx={{ mb: 2, fontSize: 12 }} variant="outlined">
                字段映射为可选。如不同名/不同类型，可在每行点「配置」进入字段映射编辑器；不配置则按同名字段自动同步。
              </Alert>
              <Paper sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                {pairs.map((p, idx) => (
                  <Box key={p.key} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.25, borderBottom: idx < pairs.length - 1 ? '1px solid' : 0, borderColor: 'divider' }}>
                    <Typography sx={{ color: 'text.secondary', fontSize: 12, width: 28 }}>{idx + 1}</Typography>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ color: 'text.primary', fontSize: 13 }}>{p.source} <ArrowForwardIcon sx={{ fontSize: 12, mx: 0.5, color: 'text.secondary' }} /> {p.target}</Typography>
                      <Typography sx={{ color: 'text.secondary', fontSize: 11 }}>{p.columnMappings.length > 0 ? `已配置 ${p.columnMappings.length} 个字段` : '未配置（按同名字段默认同步）'}</Typography>
                    </Box>
                    <Button size="small" startIcon={<AccountTreeIcon sx={{ fontSize: 14 }} />} onClick={() => setEditingPairIndex(idx)} sx={{ color: 'primary.main', borderColor: 'primary.main', textTransform: 'none', fontSize: 11 }} variant="outlined">
                      {p.columnMappings.length > 0 ? '编辑字段' : '配置字段'}
                    </Button>
                  </Box>
                ))}
                {pairs.length === 0 && <Typography sx={{ p: 3, color: 'text.disabled', textAlign: 'center', fontSize: 12 }}>暂无配对</Typography>}
              </Paper>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', px: 2, py: 1.25, justifyContent: 'space-between' }}>
          <Box>
            {activeStep > 0 && (
              <Button onClick={handleBack} startIcon={<ArrowBackIcon sx={{ fontSize: 14 }} />} disabled={submitting} sx={{ color: 'text.secondary', textTransform: 'none' }}>上一步</Button>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ color: 'text.secondary', fontSize: 11 }}>{activeStep === 1 ? `共 ${pairs.length} 对` : activeStep === 2 ? `${pairs.length} 个配对` : ''}</Typography>
            <Button onClick={onClose} disabled={submitting} sx={{ color: 'text.secondary' }}>取消</Button>
            {activeStep < STEPS.length - 1 ? (
              <Button onClick={handleNext} variant="contained" disabled={!selectedTask || (activeStep === 0 && !step1Valid) || (activeStep === 1 && pairs.length === 0)} sx={{ textTransform: 'none' }}>下一步</Button>
            ) : (
              <Button onClick={handleSubmit} variant="contained" disabled={submitting || !selectedTask || !step2Valid} sx={{ textTransform: 'none' }}>
                {submitting ? <CircularProgress size={14} sx={{ color: 'common.white', mr: 1 }} /> : null}
                创建 {pairs.length > 0 ? `(${pairs.length})` : ''}
              </Button>
            )}
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
