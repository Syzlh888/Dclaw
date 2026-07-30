import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Autocomplete, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, Paper, Snackbar, TextField, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';
import ProjectTreePanel from './ProjectTreePanel';
import TaskListPanel from './TaskListPanel';
import MappingListPanel from './MappingListPanel';
import DetailPanel from './DetailPanel';
import TableMappingEditor from './TableMappingEditor';
import { useSyncStore } from '../../stores/syncStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeStore } from '../../stores/treeStore';
import { syncService } from '../../services/syncService';
import { apiFetch } from '../../services/apiClient';

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
  const connectionsMap = useConnectionStore((s) => s.connections);
  const connections = React.useMemo(() => Object.values(connectionsMap), [connectionsMap]);
  // 树形连接选择器
  const treeNodes = useTreeStore((s) => s.nodes);
  const treeRootIds = useTreeStore((s) => s.rootNodeIds);
  const [connDropdownOpen, setConnDropdownOpen] = useState<'source' | 'target' | null>(null);
  const [connSearchText, setConnSearchText] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
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

  const openForm = (kind: Exclude<FormKind, null>) => {
    setValues({});
    setSourceSchemas([]);
    setTargetSchemas([]);
    setSourceTables([]);
    setTargetTables([]);
    // 「新建表映射」时自动从当前选中的 task 预填连接/schema
    if (kind === 'mapping' && selectedTask) {
      setValues({
        sourceConnectionId: selectedTask.source_connection_id,
        sourceSchema: selectedTask.source_schema || '',
        targetConnectionId: selectedTask.target_connection_id,
        targetSchema: selectedTask.target_schema || '',
      });
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
      } else if (form === 'mapping') {
        if (!store.selectedTaskId || !values.sourceTable || !values.targetTable) throw new Error('请填写源表和目标表');
        const item = await store.createMapping({ taskId: store.selectedTaskId, sourceTable: values.sourceTable, targetTable: values.targetTable }); store.selectMapping(item.id);
      }
      setForm(null);
    } catch (error) { useSyncStore.setState({ error: error instanceof Error ? error.message : '创建失败' }); }
  };
  const field = (key: string, label: string, required = false) => <TextField fullWidth required={required} size="small" label={label} value={values[key] || ''} onChange={(e) => setValues((old) => ({ ...old, [key]: e.target.value }))} sx={{ mb: 1.5, '& .MuiInputBase-root': { color: '#DDD' } }} />;

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
        slotProps={{ paper: { sx: { bgcolor: '#3C3F41', color: '#FFFFFF' } } }}
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
                  {loading ? <CircularProgress size={14} sx={{ color: '#888' }} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            }}
            sx={{
              mb: 1.5,
              bgcolor: locked ? '#2A2A2A' : '#3C3F41',
              '& .MuiInputBase-root': { color: '#DDD', fontSize: 13 },
              '& .MuiFormHelperText-root': { color: '#888', ml: 0, mt: 0.3 },
            }}
            InputLabelProps={{ sx: { color: '#BBBBBB' } }}
          />
        )}
      />
    );
  };

  // 表选择器：单选 Autocomplete，从当前连接 + schema 下的 tables 列表中选取
  // 未选连接或 schema 时禁用；切换连接/Schema 时由外层 useEffect 清空值并重新加载
  const tableSelect = (tableKey: 'sourceTable' | 'targetTable', label: string, connId: string | undefined, schema: string | undefined, tables: { name: string }[], loading: boolean) => (
    <Autocomplete
      size="small"
      fullWidth
      options={tables}
      getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
      value={values[tableKey] || ''}
      disabled={!connId || !schema}
      loading={loading}
      onChange={(_, val) => setValues((old) => ({ ...old, [tableKey]: typeof val === 'string' ? val : (val as { name: string } | null)?.name || '' }))}
      onInputChange={(_, val) => {
        // 自由输入：仅当输入值不在已加载列表时允许直接写
        if (tables.some((t) => t.name === val)) return;
        setValues((old) => ({ ...old, [tableKey]: val || '' }));
      }}
      isOptionEqualToValue={(option, value) => option.name === value}
      noOptionsText={loading ? '加载中…' : !connId || !schema ? '请先选择连接和 Schema' : '未找到可用表'}
      ListboxProps={{ sx: { fontSize: 13, padding: 0, '& li': { fontSize: 13, padding: '4px 10px', minHeight: 24 } } }}
      slotProps={{ paper: { sx: { bgcolor: '#3C3F41', color: '#FFFFFF' } } }}
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
                {loading ? <CircularProgress size={14} sx={{ color: '#888' }} /> : null}
                {params.InputProps.endAdornment}
              </>
            ),
          }}
          sx={{ mb: 1.5, bgcolor: '#3C3F41', '& .MuiInputBase-root': { color: '#DDD', fontSize: 13 } }}
          InputLabelProps={{ sx: { color: '#BBBBBB' } }}
        />
      )}
    />
  );

  // 树形连接选择器组件（与数据导出向导一致）
  const connectionTreeSelect = (connKey: string, label: string, required: boolean) => {
    const isOpen = connDropdownOpen === connKey;
    const currentConnValue = values[connKey];
    const currentConn = currentConnValue ? connections.find((c) => c.id === currentConnValue) : null;

    // 搜索过滤
    const matchesSearch = (nodeId: string): boolean => {
      if (!connSearchText) return true;
      const s = connSearchText.toLowerCase();
      const node = treeNodes[nodeId];
      if (!node) return false;
      if (node.dbConnectionId) {
        const conn = connectionsMap[node.dbConnectionId];
        if (conn && (conn.name.toLowerCase().includes(s) || (conn.host || '').includes(s))) return true;
      }
      if (node.name.toLowerCase().includes(s)) return true;
      if (node.childrenIds) return node.childrenIds.some(matchesSearch);
      return false;
    };

    // 递归渲染树节点
    const renderTree = (nodeId: string, depth: number): React.ReactNode => {
      if (!matchesSearch(nodeId)) return null;
      const node = treeNodes[nodeId];
      if (!node) return null;
      const isExpanded = expandedGroups.has(nodeId);
      const hasChildren = node.childrenIds && node.childrenIds.length > 0;

      if (node.dbConnectionId) {
        const conn = connectionsMap[node.dbConnectionId];
        if (!conn) return null;
        const selected = currentConnValue === conn.id;
        return (
          <Box
            key={nodeId}
            onClick={() => {
              // 切换连接时清空对应 schema（effect 会重新加载/自动填充）
              if (connKey === 'sourceConnectionId') {
                setValues((old) => ({ ...old, sourceConnectionId: conn.id, sourceSchema: '' }));
              } else {
                setValues((old) => ({ ...old, targetConnectionId: conn.id, targetSchema: '' }));
              }
              setConnDropdownOpen(null);
              setConnSearchText('');
            }}
            sx={{
              pl: 1.5 + depth * 1.2,
              pr: 2,
              py: 0.6,
              cursor: 'pointer',
              bgcolor: selected ? '#1565C0' : 'transparent',
              color: selected ? '#FFFFFF' : '#E0E0E0',
              fontSize: 12.5,
              borderLeft: selected ? '3px solid #64B5F6' : '3px solid transparent',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              transition: 'background-color 0.15s',
              '&:hover': { bgcolor: selected ? '#1565C0' : '#454545' },
            }}
          >
            <StorageIcon sx={{ fontSize: 12, color: selected ? '#FFFFFF' : '#66BB6A' }} />
            <span style={{ flex: 1 }}>{conn.name}</span>
            <span style={{ fontSize: 11, color: selected ? '#BBDEFB' : '#888' }}>
              {conn.host}:{conn.port}
            </span>
          </Box>
        );
      }

      return (
        <Box key={nodeId}>
          <Box
            onClick={() => {
              if (!hasChildren) return;
              const ns = new Set(expandedGroups);
              ns.has(nodeId) ? ns.delete(nodeId) : ns.add(nodeId);
              setExpandedGroups(ns);
            }}
            sx={{
              bgcolor: depth === 0 ? '#2A2A2A' : '#333333',
              color: depth === 0 ? '#FFFFFF' : '#C8C8C8',
              fontSize: depth === 0 ? 12.5 : 12,
              fontWeight: depth === 0 ? 700 : 500,
              lineHeight: '26px',
              pl: 0.75 + depth * 1.2,
              pr: 1,
              cursor: hasChildren ? 'pointer' : 'default',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              borderTop: depth === 0 ? '1px solid #1F1F1F' : 'none',
              borderBottom: isExpanded ? '1px solid #252525' : 'none',
              transition: 'background-color 0.15s',
              '&:hover': hasChildren ? { bgcolor: '#3A3A3A' } : {},
            }}
          >
            {hasChildren ? (
              <ChevronRightIcon
                sx={{
                  fontSize: 14,
                  color: '#999',
                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s',
                }}
              />
            ) : (
              <FiberManualRecordIcon sx={{ fontSize: 5, color: '#555', ml: 0.4, mr: 0.4 }} />
            )}
            {node.name}
          </Box>
          {isExpanded && hasChildren && (
            <Box>
              {node.childrenIds.map((cid: string) => renderTree(cid, depth + 1))}
            </Box>
          )}
        </Box>
      );
    };

    return (
      <Box sx={{ mb: 1.5, position: 'relative' }}>
        <TextField
          fullWidth
          size="small"
          required={required}
          label={label}
          value={currentConn ? `${currentConn.name} (${currentConn.host}:${currentConn.port})` : ''}
          placeholder="点击选择..."
          onClick={() => {
            if (isOpen) {
              setConnDropdownOpen(null);
            } else {
              setConnDropdownOpen(connKey as 'source' | 'target');
              setConnSearchText('');
            }
          }}
          InputProps={{
            readOnly: true,
            endAdornment: (
              <ExpandMoreIcon
                fontSize="small"
                sx={{
                  color: '#888',
                  cursor: 'pointer',
                  transform: isOpen ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            ),
          }}
          sx={{
            bgcolor: '#3C3F41',
            cursor: 'pointer',
            '& .MuiInputBase-root': { color: '#DDD' },
          }}
          InputLabelProps={{ sx: { color: '#BBBBBB' } }}
        />
        {isOpen && (
          <Paper
            sx={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              mt: 0.5,
              maxHeight: 320,
              overflow: 'auto',
              bgcolor: '#3C3F41',
              zIndex: 1300,
              border: '1px solid #5A5A5A',
            }}
          >
            {/* 搜索框 */}
            <Box sx={{ p: 1, borderBottom: '1px solid #3A3A3A', bgcolor: '#2F2F2F' }}>
              <TextField
                size="small"
                fullWidth
                placeholder="搜索连接名称或 IP..."
                value={connSearchText}
                onChange={(e) => setConnSearchText(e.target.value)}
                autoFocus
                InputProps={{
                  startAdornment: <SearchIcon fontSize="small" sx={{ color: '#888', mr: 0.5 }} />,
                  endAdornment: connSearchText ? (
                    <IconButton size="small" onClick={() => setConnSearchText('')} sx={{ p: 0.25 }}>
                      <CloseIcon sx={{ fontSize: 14, color: '#888' }} />
                    </IconButton>
                  ) : undefined,
                }}
                sx={{
                  bgcolor: '#252525',
                  '& .MuiOutlinedInput-root': {
                    fontSize: 13,
                    '& fieldset': { borderColor: '#3A3A3A' },
                    '&:hover fieldset': { borderColor: '#5A5A5A' },
                  },
                  '& input': { padding: '6px 4px', color: '#DDD' },
                  '& input::placeholder': { color: '#777', opacity: 1 },
                }}
              />
            </Box>
            {/* 树形节点 */}
            {(() => {
              if (!treeNodes || Object.keys(treeNodes).length === 0) {
                return (
                  <Typography sx={{ color: '#888', p: 2, fontSize: 12, textAlign: 'center' }}>
                    树数据加载中…
                  </Typography>
                );
              }
              return treeRootIds.map((rid: string) => renderTree(rid, 0));
            })()}
          </Paper>
        )}
      </Box>
    );
  };

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
          {form === 'task' && <>{field('name', '任务名称', true)}{connectionTreeSelect('sourceConnectionId', '源连接', true)}{schemaSelect('sourceSchema', '源 Schema', values.sourceConnectionId, sourceSchemas, sourceSchemasLoading)}{connectionTreeSelect('targetConnectionId', '目标连接', true)}{schemaSelect('targetSchema', '目标 Schema', values.targetConnectionId, targetSchemas, targetSchemasLoading)}{field('description', '描述')}</>}
          {form === 'mapping' && <>{tableSelect('sourceTable', '源表', values.sourceConnectionId, values.sourceSchema, sourceTables, sourceTablesLoading)}{tableSelect('targetTable', '目标表', values.targetConnectionId, values.targetSchema, targetTables, targetTablesLoading)}</>}
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
