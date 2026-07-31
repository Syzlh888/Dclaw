import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Snackbar, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import ProjectTreePanel from './ProjectTreePanel';
import TaskListPanel from './TaskListPanel';
import MappingListPanel from './MappingListPanel';
import DetailPanel from './DetailPanel';
import TableMappingEditor from './TableMappingEditor';
import MappingWizardDialog from './MappingWizardDialog';
import TreeConnectionSelect from '../common/TreeConnectionSelect';
import { useSyncStore } from '../../stores/syncStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { syncService } from '../../services/syncService';
import { apiFetch } from '../../services/apiClient';
import type { SyncTableMapping } from '../../types/sync';

interface Props { open?: boolean; onClose?: () => void; standalone?: boolean }
type FormKind = 'project' | 'task' | 'mapping' | null;
type MappingSourceKind = 'table' | 'sql';

const SyncPage: React.FC<Props> = ({ open, onClose, standalone }) => {
  if (standalone) {
    return <SyncContent standalone />;
  }
  return <SyncContent open={open} onClose={onClose} />;
};

const SyncContent: React.FC<{ open?: boolean; onClose?: () => void; standalone?: boolean }> = ({ open, onClose, standalone }) => {
  const store = useSyncStore();
  const [form, setForm] = useState<FormKind>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const selectedProject = store.projects.find((x) => x.id === store.selectedProjectId);
  const selectedTask = store.tasks.find((x) => x.id === store.selectedTaskId);
  const connectionsMap = useConnectionStore((s) => s.connections);
  // 源/目标连接的可用 schemas 列表与加载状态
  const [sourceSchemas, setSourceSchemas] = useState<string[]>([]);
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [sourceSchemasLoading, setSourceSchemasLoading] = useState(false);
  const [targetSchemasLoading, setTargetSchemasLoading] = useState(false);
  // 源/目标 schema 下的表列表（用于「新建表映射」下拉选择）
  const [sourceTables, setSourceTables] = useState<{ name: string }[]>([]);
  const [targetTables, setTargetTables] = useState<{ name: string }[]>([]);
  const [sourceTablesLoading, setSourceTablesLoading] = useState(false);
  const [targetTablesLoading, setTargetTablesLoading] = useState(false);
  // 「新建表映射」源类型：'table' = 选表；'sql' = 自定义 SQL
  const [mappingSourceKind, setMappingSourceKind] = useState<'table' | 'sql'>('table');
  // 向导对话框开关 + 已存在配对集合（防止重复创建）
  const [wizardOpen, setWizardOpen] = useState(false);
  const existingPairs = useMemo(() => {
    const set = new Set<string>();
    if (!store.selectedTaskId) return set;
    store.mappings
      .filter((m) => m.task_id === store.selectedTaskId)
      .forEach((m) => set.add(`${m.source_table}::${m.target_table}`));
    return set;
  }, [store.selectedTaskId, store.mappings]);
  const openMappingWizard = useCallback(() => {
    if (!store.selectedTaskId) {
      useSyncStore.setState({ error: '请先在左侧选择任务' });
      return;
    }
    setWizardOpen(true);
  }, [store.selectedTaskId]);
  const handleWizardCreated = useCallback((created: SyncTableMapping[]) => {
    // 选第一条作为当前选中（沿用旧行为）
    if (created.length > 0) store.selectMapping(created[0].id);
    useSyncStore.setState({ error: null });
  }, [store]);

  const openForm = (kind: Exclude<FormKind, null>) => {
    setValues({});
    setSourceSchemas([]);
    setTargetSchemas([]);
    setSourceTables([]);
    setTargetTables([]);
    // 「新建表映射」由向导对话框处理（onCreateMapping 已打开 wizardOpen），这里不再预填。
    if (kind === 'task' && !store.selectedProjectId) {
      useSyncStore.setState({ error: '请先在左侧选择项目' });
    }
    if (kind === 'mapping') {
      // 不在 setForm 流程里；直接交由 MappingListPanel 的 onCreateMapping 触发 wizardOpen
      return;
    }
    setForm(kind);
  };
  const submit = async () => {
    try {
      if (form === 'project') {
        if (!values.name?.trim()) throw new Error('请输入项目名称');
        const item = await store.createProject({ name: values.name, description: values.description }); await store.selectProject(item.id);
      } else if (form === 'task') {
        if (!store.selectedProjectId || !values.name || !values.sourceConnectionId || !values.targetConnectionId) throw new Error('请填写任务名称及源/目标连接 ID');
        const item = await store.createTask({ projectId: store.selectedProjectId, name: values.name, description: values.description, sourceConnectionId: values.sourceConnectionId, sourceSchema: values.sourceSchema, targetConnectionId: values.targetConnectionId, targetSchema: values.targetSchema }); await store.selectTask(item.id);
      }
      // form === 'mapping' 已由 MappingWizardDialog 接管
      setForm(null);
    } catch (error) { useSyncStore.setState({ error: error instanceof Error ? error.message : '创建失败' }); }
  };
  const field = (key: string, label: string, required = false) => <TextField fullWidth required={required} size="small" label={label} value={values[key] || ''} onChange={(e) => setValues((old) => ({ ...old, [key]: e.target.value }))} sx={{ mb: 1.5, '& .MuiInputBase-root': { color: 'text.primary' } }} />;

  // 当源/目标连接变更时，载入该连接可用的 schemas 列表
  // 若连接的 schema 字段已配置（非空），直接锁定显示；否则调后端 API 获取。
  React.useEffect(() => {
    const connectionId = values.sourceConnectionId;
    if (!connectionId) {
      setSourceSchemas([]);
      return;
    }
    const conn = connectionsMap[connectionId];
    const fixed = (conn?.schema || '').trim();
    if (fixed) {
      setSourceSchemas([fixed]);
      setSourceSchemasLoading(false);
      // 自动填充 sourceSchema
      setValues((old) => (old.sourceSchema === fixed ? old : { ...old, sourceSchema: fixed }));
      return;
    }
    let cancelled = false;
    setSourceSchemas([]);
    setSourceSchemasLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/schemas`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载 Schema 失败（HTTP ${res.status}）`);
        if (!cancelled) {
          const list: string[] = data.schemas || [];
          setSourceSchemas(list);
          // 如果只有一个 schema，自动选中
          if (list.length === 1) {
            setValues((old) => (old.sourceSchema === list[0] ? old : { ...old, sourceSchema: list[0] }));
          }
        }
      } catch (err) {
        if (!cancelled) console.error('[sourceSchemas] failed', err);
      } finally {
        if (!cancelled) setSourceSchemasLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.sourceConnectionId]);

  React.useEffect(() => {
    const connectionId = values.targetConnectionId;
    if (!connectionId) {
      setTargetSchemas([]);
      return;
    }
    const conn = connectionsMap[connectionId];
    const fixed = (conn?.schema || '').trim();
    if (fixed) {
      setTargetSchemas([fixed]);
      setTargetSchemasLoading(false);
      setValues((old) => (old.targetSchema === fixed ? old : { ...old, targetSchema: fixed }));
      return;
    }
    let cancelled = false;
    setTargetSchemas([]);
    setTargetSchemasLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/schemas`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载 Schema 失败（HTTP ${res.status}）`);
        if (!cancelled) {
          const list: string[] = data.schemas || [];
          setTargetSchemas(list);
          if (list.length === 1) {
            setValues((old) => (old.targetSchema === list[0] ? old : { ...old, targetSchema: list[0] }));
          }
        }
      } catch (err) {
        if (!cancelled) console.error('[targetSchemas] failed', err);
      } finally {
        if (!cancelled) setTargetSchemasLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.targetConnectionId]);

  // 源连接 + 源 schema 选定后，拉取该 schema 下的表列表
  React.useEffect(() => {
    const connectionId = values.sourceConnectionId;
    const schema = values.sourceSchema;
    // 切换连接/Schema 时清空旧表名 + 表列表
    setValues((old) => (old.sourceTable ? { ...old, sourceTable: '' } : old));
    setSourceTables([]);
    if (!connectionId || !schema) {
      setSourceTablesLoading(false);
      return;
    }
    let cancelled = false;
    setSourceTablesLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/tables?schema=${encodeURIComponent(schema)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载源表失败（HTTP ${res.status}）`);
        if (!cancelled) setSourceTables(Array.isArray(data.tables) ? data.tables : []);
      } catch (err) {
        if (!cancelled) console.error('[sourceTables] failed', err);
      } finally {
        if (!cancelled) setSourceTablesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [values.sourceConnectionId, values.sourceSchema]);

  // 目标连接 + 目标 schema 选定后，拉取该 schema 下的表列表
  React.useEffect(() => {
    const connectionId = values.targetConnectionId;
    const schema = values.targetSchema;
    setValues((old) => (old.targetTable ? { ...old, targetTable: '' } : old));
    setTargetTables([]);
    if (!connectionId || !schema) {
      setTargetTablesLoading(false);
      return;
    }
    let cancelled = false;
    setTargetTablesLoading(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/tables?schema=${encodeURIComponent(schema)}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `加载目标表失败（HTTP ${res.status}）`);
        if (!cancelled) setTargetTables(Array.isArray(data.tables) ? data.tables : []);
      } catch (err) {
        if (!cancelled) console.error('[targetTables] failed', err);
      } finally {
        if (!cancelled) setTargetTablesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [values.targetConnectionId, values.targetSchema]);

  // Schema 选择器：单选 Autocomplete，从当前连接的 schemas 列表中选取
  const schemaSelect = (schemaKey: 'sourceSchema' | 'targetSchema', label: string, connId: string | undefined, schemas: string[], loading: boolean) => {
    const conn = connId ? connectionsMap[connId] : null;
    const fixed = (conn?.schema || '').trim();
    const locked = !!fixed; // 连接已配置固定 schema，禁止修改
    return (
      <Autocomplete
        freeSolo={!locked}
        size="small"
        fullWidth
        options={schemas}
        value={values[schemaKey] || ''}
        disabled={!connId}
        onChange={(_, val) => setValues((old) => ({ ...old, [schemaKey]: val || '' }))}
        onInputChange={(_, val) => setValues((old) => ({ ...old, [schemaKey]: val || '' }))}
        ListboxProps={{
          sx: { fontSize: 13, padding: 0, '& li': { fontSize: 13, padding: '4px 10px', minHeight: 24 } },
        }}
        slotProps={{ paper: { sx: { bgcolor: 'background.paper', color: 'common.white' } } }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label={label}
            placeholder={!connId ? '请先选择连接' : loading ? '加载中…' : locked ? `已锁定：${fixed}` : '选择或输入 Schema'}
            helperText={
              !connId ? '' : locked ? `连接已配置固定 schema: ${fixed}` : loading ? '正在加载可用 Schema…' : (schemas.length === 0 ? '未找到可用 Schema' : `共 ${schemas.length} 个可选`)
            }
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress size={14} sx={{ color: 'text.secondary' }} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            sx={{
              mb: 1.5,
              bgcolor: locked ? 'background.paper' : 'background.paper',
              '& .MuiInputBase-root': { color: 'text.primary', fontSize: 13 },
              '& .MuiFormHelperText-root': { color: 'text.secondary', ml: 0, mt: 0.3 },
            }}
            InputLabelProps={{ sx: { color: 'text.secondary' } }}
          />
        )}
      />
    );
  };

  // 表选择器：单选 Autocomplete，从当前连接 + schema 下的 tables 列表中选取
  // 未选连接或 schema 时禁用；切换连接/Schema 时由外层 useEffect 清空值并重新加载
  const tableSelect = (tableKey: 'sourceTable' | 'targetTable', label: string, connId: string | undefined, schema: string | undefined, tables: { name: string }[], loading: boolean) => {
    const selected = tables.find((t) => t.name === values[tableKey]) || null;
    return (
      <Autocomplete
        size="small"
        fullWidth
        options={tables}
        getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
        value={selected}
        disabled={!connId || !schema}
        loading={loading}
        onChange={(_, val) => setValues((old) => ({ ...old, [tableKey]: val?.name || '' }))}
        onInputChange={(_, val) => {
          // 自由输入：仅当输入值不在已加载列表时允许直接写
          if (tables.some((t) => t.name === val)) return;
          setValues((old) => ({ ...old, [tableKey]: val || '' }));
        }}
        isOptionEqualToValue={(option, value) => option.name === value.name}
        noOptionsText={loading ? '加载中…' : !connId || !schema ? '请先选择连接和 Schema' : '未找到可用表'}
        ListboxProps={{ sx: { fontSize: 13, padding: 0, '& li': { fontSize: 13, padding: '4px 10px', minHeight: 24 } } }}
        slotProps={{ paper: { sx: { bgcolor: 'background.paper', color: 'common.white' } } }}
        renderInput={(params) => (
          <TextField
            {...params}
            required
            label={label}
            placeholder={!connId || !schema ? '请先选择连接和 Schema' : loading ? '加载中…' : `共 ${tables.length} 张表`}
            InputProps={{
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress size={14} sx={{ color: 'text.secondary' }} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            sx={{ mb: 1.5, bgcolor: 'background.paper', '& .MuiInputBase-root': { color: 'text.primary', fontSize: 13 } }}
            InputLabelProps={{ sx: { color: 'text.secondary' } }}
          />
        )}
      />
    );
  };

  // 树形连接选择器：选中后清空对应 schema（effect 会重新加载/自动填充）
  const handleSourceConnChange = useCallback((id: string) => {
    setValues((old) => ({ ...old, sourceConnectionId: id, sourceSchema: '' }));
  }, []);
  const handleTargetConnChange = useCallback((id: string) => {
    setValues((old) => ({ ...old, targetConnectionId: id, targetSchema: '' }));
  }, []);

  const editingMapping = useMemo(() => (editingMappingId ? store.mappings.find((m) => m.id === editingMappingId) ?? null : null), [editingMappingId, store.mappings]);
  const editingParentTask = useMemo(() => (editingMapping ? store.tasks.find((t) => t.id === editingMapping.task_id) : null), [editingMapping, store.tasks]);
  const handleEditMapping = useCallback((mappingId: string) => { setEditingMappingId(mappingId); }, []);
  const handleEditorClose = useCallback(() => { setEditingMappingId(null); }, []);
  const handleEditorSave = useCallback(async (columnMappings: { source: string; target: string; type?: string }[]) => {
    if (!editingMappingId) return;
    try { await store.updateMapping(editingMappingId, { columnMappings }); setEditingMappingId(null); }
    catch (error) { useSyncStore.setState({ error: error instanceof Error ? error.message : '保存字段映射失败' }); }
  }, [editingMappingId, store]);
  const handleRunTask = useCallback((taskId: string) => { void store.runTaskNow(taskId); }, [store]);
  const handleToggleEnabled = useCallback(async (taskId: string, enabled: boolean) => {
    try { await syncService.updateTask(taskId, { enabled }); if (store.selectedProjectId) await store.loadTasks(store.selectedProjectId); }
    catch (error) { useSyncStore.setState({ error: error instanceof Error ? error.message : '切换自动调度失败' }); }
  }, [store]);

  const header = (
    <Box sx={{ height: 50, px: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <SyncAltIcon sx={{ color: 'primary.main', mr: 1 }} />
      <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: 16 }}>数据同步中心</Typography>
      <Typography sx={{ ml: 1.5, color: 'text.disabled', fontSize: 11 }}>{selectedProject?.name}{selectedTask ? ` / ${selectedTask.name}` : ''}</Typography>
      <Box sx={{ flex: 1 }} />
      {standalone ? (
        <Button size="small" onClick={() => onClose?.()} sx={{ color: 'text.secondary' }}>← 返回</Button>
      ) : (
        <IconButton onClick={() => onClose?.()} sx={{ color: 'text.secondary' }}><CloseIcon /></IconButton>
      )}
    </Box>
  );

  const body = (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <ProjectTreePanel onCreateProject={() => openForm('project')} onCreateTask={() => openForm('task')} />
      <Box sx={{ flex: 1, minWidth: 0, bgcolor: 'background.default' }}>
        {store.selectedTaskId ? (
          <MappingListPanel onCreateMapping={openMappingWizard} onEditColumns={handleEditMapping} />
        ) : store.selectedProjectId ? (
          <TaskListPanel onCreateTask={() => openForm('task')} onToggleEnabled={handleToggleEnabled} />
        ) : (
          <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <Typography sx={{ color: 'text.disabled', fontSize: 13 }}>从左侧选择同步项目开始</Typography>
          </Box>
        )}
      </Box>
      <DetailPanel onEditColumns={handleEditMapping} onRunTask={handleRunTask} />
    </Box>
  );

  return (
    <>
      {standalone ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default', color: 'text.secondary', overflow: 'hidden' }}>
          {header}
          {body}
        </Box>
      ) : (
        <Dialog open={open ?? false} onClose={() => onClose?.()} maxWidth={false} PaperProps={{ sx: { width: 'min(1200px, 94vw)', height: 'min(760px, 90vh)', maxHeight: '90vh', m: 1, bgcolor: 'background.default', color: 'text.secondary', border: '1px solid', borderColor: 'divider' } }}>
          {header}
          {body}
        </Dialog>
      )}

      <TableMappingEditor
        open={!!editingMapping}
        mapping={editingMapping}
        sourceConnectionId={editingParentTask?.source_connection_id || ''}
        sourceSchema={editingParentTask?.source_schema || undefined}
        targetConnectionId={editingParentTask?.target_connection_id || ''}
        targetSchema={editingParentTask?.target_schema || undefined}
        onClose={handleEditorClose}
        onSave={handleEditorSave}
      />
      <MappingWizardDialog
        open={wizardOpen}
        selectedTask={selectedTask ? {
          id: selectedTask.id,
          source_connection_id: selectedTask.source_connection_id,
          target_connection_id: selectedTask.target_connection_id,
          source_schema: selectedTask.source_schema,
          target_schema: selectedTask.target_schema,
        } : null}
        existingPairs={existingPairs}
        onClose={() => setWizardOpen(false)}
        onCreated={handleWizardCreated}
        onError={(msg) => useSyncStore.setState({ error: msg })}
      />
      <Dialog open={!!form} onClose={() => setForm(null)} PaperProps={{ sx: { width: 430, bgcolor: '#3C3F41', color: 'text.primary' } }}>
        <DialogTitle>{form === 'project' ? '新建同步项目' : '新建同步任务'}</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          {form === 'project' && <>{field('name', '项目名称', true)}{field('description', '描述')}</>}
          {form === 'task' && <>{field('name', '任务名称', true)}{<TreeConnectionSelect value={values.sourceConnectionId || ''} onChange={handleSourceConnChange} label="源连接" required />}{schemaSelect('sourceSchema', '源 Schema', values.sourceConnectionId, sourceSchemas, sourceSchemasLoading)}{<TreeConnectionSelect value={values.targetConnectionId || ''} onChange={handleTargetConnChange} label="目标连接" required />}{schemaSelect('targetSchema', '目标 Schema', values.targetConnectionId, targetSchemas, targetSchemasLoading)}{field('description', '描述')}</>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)} sx={{ color: 'text.secondary' }}>取消</Button>
          <Button onClick={submit} variant="contained">创建</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!store.error} autoHideDuration={4000} onClose={store.clearError} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity="error" variant="filled" onClose={store.clearError}>{store.error}</Alert>
      </Snackbar>
    </>
  );
};

export default SyncPage;
