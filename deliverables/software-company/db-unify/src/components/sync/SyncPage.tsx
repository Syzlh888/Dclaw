import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Snackbar, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import ProjectTreePanel from './ProjectTreePanel';
import TaskListPanel from './TaskListPanel';
import MappingListPanel from './MappingListPanel';
import DetailPanel from './DetailPanel';
import TableMappingEditor from './TableMappingEditor';
import { useSyncStore } from '../../stores/syncStore';
import { syncService } from '../../services/syncService';

interface Props { open?: boolean; onClose?: () => void; standalone?: boolean }
type FormKind = 'project' | 'task' | 'mapping' | null;

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
  const openForm = (kind: Exclude<FormKind, null>) => { setValues({}); setForm(kind); };
  const submit = async () => {
    try {
      if (form === 'project') {
        if (!values.name?.trim()) throw new Error('请输入项目名称');
        const item = await store.createProject({ name: values.name, description: values.description }); await store.selectProject(item.id);
      } else if (form === 'task') {
        if (!store.selectedProjectId || !values.name || !values.sourceConnectionId || !values.targetConnectionId) throw new Error('请填写任务名称及源/目标连接 ID');
        const item = await store.createTask({ projectId: store.selectedProjectId, name: values.name, description: values.description, sourceConnectionId: values.sourceConnectionId, sourceSchema: values.sourceSchema, targetConnectionId: values.targetConnectionId, targetSchema: values.targetSchema }); await store.selectTask(item.id);
      } else if (form === 'mapping') {
        if (!store.selectedTaskId || !values.sourceTable || !values.targetTable) throw new Error('请填写源表和目标表');
        const item = await store.createMapping({ taskId: store.selectedTaskId, sourceTable: values.sourceTable, targetTable: values.targetTable }); store.selectMapping(item.id);
      }
      setForm(null);
    } catch (error) { useSyncStore.setState({ error: error instanceof Error ? error.message : '创建失败' }); }
  };
  const field = (key: string, label: string, required = false) => <TextField fullWidth required={required} size="small" label={label} value={values[key] || ''} onChange={(e) => setValues((old) => ({ ...old, [key]: e.target.value }))} sx={{ mb: 1.5, '& .MuiInputBase-root': { color: '#DDD' } }} />;
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
    <Box sx={{ height: 50, px: 2, display: 'flex', alignItems: 'center', borderBottom: '1px solid #505050', bgcolor: '#3C3F41' }}>
      <SyncAltIcon sx={{ color: '#42A5F5', mr: 1 }} />
      <Typography sx={{ color: '#EEE', fontWeight: 600, fontSize: 16 }}>数据同步中心</Typography>
      <Typography sx={{ ml: 1.5, color: '#777', fontSize: 11 }}>{selectedProject?.name}{selectedTask ? ` / ${selectedTask.name}` : ''}</Typography>
      <Box sx={{ flex: 1 }} />
      {standalone ? (
        <Button size="small" onClick={() => onClose?.()} sx={{ color: '#BBB' }}>← 返回</Button>
      ) : (
        <IconButton onClick={() => onClose?.()} sx={{ color: '#BBB' }}><CloseIcon /></IconButton>
      )}
    </Box>
  );

  const body = (
    <Box sx={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
      <ProjectTreePanel onCreateProject={() => openForm('project')} onCreateTask={() => openForm('task')} />
      <Box sx={{ flex: 1, minWidth: 0, bgcolor: '#2B2B2B' }}>
        {store.selectedTaskId ? (
          <MappingListPanel onCreateMapping={() => openForm('mapping')} onEditColumns={handleEditMapping} />
        ) : store.selectedProjectId ? (
          <TaskListPanel onCreateTask={() => openForm('task')} onToggleEnabled={handleToggleEnabled} />
        ) : (
          <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <Typography sx={{ color: '#777', fontSize: 13 }}>从左侧选择同步项目开始</Typography>
          </Box>
        )}
      </Box>
      <DetailPanel onEditColumns={handleEditMapping} onRunTask={handleRunTask} />
    </Box>
  );

  return (
    <>
      {standalone ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: '#2B2B2B', color: '#BBBBBB', overflow: 'hidden' }}>
          {header}
          {body}
        </Box>
      ) : (
        <Dialog open={open ?? false} onClose={() => onClose?.()} maxWidth={false} PaperProps={{ sx: { width: 'min(1200px, 94vw)', height: 'min(760px, 90vh)', maxHeight: '90vh', m: 1, bgcolor: '#2B2B2B', color: '#BBBBBB', border: '1px solid #555' } }}>
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
      <Dialog open={!!form} onClose={() => setForm(null)} PaperProps={{ sx: { width: 430, bgcolor: '#3C3F41', color: '#DDD' } }}>
        <DialogTitle>{form === 'project' ? '新建同步项目' : form === 'task' ? '新建同步任务' : '新建表映射'}</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          {form === 'project' && <>{field('name', '项目名称', true)}{field('description', '描述')}</>}
          {form === 'task' && <>{field('name', '任务名称', true)}{field('sourceConnectionId', '源连接 ID', true)}{field('sourceSchema', '源 Schema')}{field('targetConnectionId', '目标连接 ID', true)}{field('targetSchema', '目标 Schema')}{field('description', '描述')}</>}
          {form === 'mapping' && <>{field('sourceTable', '源表', true)}{field('targetTable', '目标表', true)}</>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setForm(null)} sx={{ color: '#BBB' }}>取消</Button>
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
