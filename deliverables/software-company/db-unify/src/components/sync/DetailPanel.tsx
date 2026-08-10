import React, { useEffect, useState } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, MenuItem, Select, Switch, TextField, Tooltip, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ScheduleIcon from '@mui/icons-material/Schedule';
import HistoryIcon from '@mui/icons-material/History';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useSyncStore } from '../../stores/syncStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { statusMark } from './ProjectTreePanel';
import type { SyncRunHistoryEntry } from '../../types/sync';

interface Props {
  /** 打开字段映射编辑器（仅在选中 mapping 时相关） */
  onEditColumns?: (mappingId: string) => void;
  /** 立即运行任务（透传到 DetailPanel 的运行按钮） */
  onRunTask?: (taskId: string) => void;
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => <Box sx={{ mb: 1.25 }}><Typography sx={{ color: 'text.disabled', fontSize: 10.5, mb: 0.25 }}>{label}</Typography><Typography component="div" sx={{ color: 'text.secondary', fontSize: 12, wordBreak: 'break-word' }}>{value || '-'}</Typography></Box>;
const fmt = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '-';
const fmtTime = (value?: string | null) => {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('zh-CN', { hour12: false });
};
const computeNextRun = (task: any) => {
  if (task.enabled === false) return null;
  const interval = (task.poll_interval_seconds || 60) * 1000;
  const base = task.last_run_at ? new Date(task.last_run_at).getTime() : Date.now();
  return new Date(base + interval).toLocaleString('zh-CN');
};

/** 历史单条的状态标记 */
const historyStatusMark = (status?: string | null) => {
  if (status === 'success') return { Icon: CheckCircleOutlineIcon, color: 'success.main', label: '成功' };
  if (status === 'failed' || status === 'error') return { Icon: ErrorOutlineIcon, color: 'error.main', label: '失败' };
  if (status === 'running') return { Icon: ScheduleIcon, color: 'primary.main', label: '运行中' };
  return { Icon: ScheduleIcon, color: 'text.disabled', label: '未知' };
};

/** 把任务历史按 mappingId 分组，得到「按 mapping 的最近一次执行」摘要 */
const summarizeByMapping = (history: SyncRunHistoryEntry[]) => {
  const map = new Map<string, SyncRunHistoryEntry>();
  for (const h of history) {
    if (!h.mappingId) continue;
    const prev = map.get(h.mappingId);
    const prevTime = prev ? new Date(prev.startedAt).getTime() : 0;
    const curTime = new Date(h.startedAt).getTime();
    if (!prev || curTime > prevTime) map.set(h.mappingId, h);
  }
  return map;
};

/** 任务级同步历史列表（最新在上，单条显示状态 / 时间 / 行数 / 耗时 / 错误） */
const HistoryList: React.FC<{ taskId: string }> = ({ taskId }) => {
  const runHistory = useSyncStore((s) => s.runHistory[taskId]) || [];
  const mappings = useSyncStore((s) => s.mappings.filter((m) => m.task_id === taskId));
  const loadHistory = useSyncStore((s) => s.loadHistory);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setLoading(true);
    loadHistory(taskId, 100).finally(() => setLoading(false));
  }, [taskId, loadHistory]);
  const handleRefresh = () => {
    setLoading(true);
    loadHistory(taskId, 100).finally(() => setLoading(false));
  };
  const mappingNameById = new Map(mappings.map((m) => [m.id, `${m.source_table} → ${m.target_table}`]));
  const summary = summarizeByMapping(runHistory);

  return <Box sx={{ mt: 1 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
      <HistoryIcon sx={{ fontSize: 13, color: 'primary.main' }} />
      <Typography sx={{ color: 'primary.main', fontSize: 11, letterSpacing: 0.5, fontWeight: 600 }}>同步历史</Typography>
      <Box sx={{ flex: 1 }} />
      <Tooltip title="刷新历史">
        <IconButton size="small" onClick={handleRefresh} sx={{ p: 0.25, color: 'text.secondary' }} disabled={loading}>
          <RefreshIcon sx={{ fontSize: 13 }} />
        </IconButton>
      </Tooltip>
    </Box>

    {/* 映射级别摘要 */}
    {mappings.length > 0 && <Box sx={{ mb: 1 }}>
      {mappings.map((m) => {
        const last = summary.get(m.id);
        const status = last ? historyStatusMark(last.status) : historyStatusMark(null);
        const StatusIcon = status.Icon;
        return <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.15, color: 'text.secondary' }}>
          <StatusIcon sx={{ fontSize: 12, color: status.color }} />
          <Typography sx={{ fontSize: 10.5, color: status.color, minWidth: 26 }}>{status.label}</Typography>
          <Typography sx={{ fontSize: 10.5, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={mappingNameById.get(m.id) || m.id}>
            {mappingNameById.get(m.id) || m.id}
          </Typography>
          <Typography sx={{ fontSize: 10, color: 'text.disabled', whiteSpace: 'nowrap' }}>
            {last ? fmtTime(last.startedAt) : '尚未执行'}
          </Typography>
        </Box>;
      })}
    </Box>}

    {loading && <Typography sx={{ color: 'text.disabled', fontSize: 10.5, py: 0.5 }}>加载中…</Typography>}
    {!loading && runHistory.length === 0 && <Typography sx={{ color: 'text.disabled', fontSize: 10.5, py: 0.5 }}>暂无历史记录</Typography>}
    {!loading && runHistory.slice(0, 30).map((h) => {
      const status = historyStatusMark(h.status);
      const StatusIcon = status.Icon;
      const tableLabel = h.mappingId ? (mappingNameById.get(h.mappingId) || h.mappingId) : '(任务级)';
      return <Tooltip key={h.id} title={h.errorMessage || ''} placement="left" disableHoverListener={!h.errorMessage}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, py: 0.15, borderTop: '1px solid', borderColor: 'divider', color: 'text.secondary' }}>
          <StatusIcon sx={{ fontSize: 11, color: status.color }} />
          <Typography sx={{ fontSize: 10, color: status.color, minWidth: 26 }}>{status.label}</Typography>
          <Typography sx={{ fontSize: 10, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={tableLabel}>
            {tableLabel}
          </Typography>
          <Typography sx={{ fontSize: 9.5, color: 'text.disabled', whiteSpace: 'nowrap' }}>
            {h.rowsSynced} 行 · {h.durationMs}ms
          </Typography>
          <Typography sx={{ fontSize: 9.5, color: 'text.disabled', whiteSpace: 'nowrap', minWidth: 70, textAlign: 'right' }}>
            {fmtTime(h.startedAt)}
          </Typography>
        </Box>
      </Tooltip>;
    })}
    {!loading && runHistory.length > 30 && <Typography sx={{ color: 'text.disabled', fontSize: 10, py: 0.5, textAlign: 'center' }}>仅显示最近 30 条，共 {runHistory.length} 条</Typography>}
  </Box>;
};

const DetailPanel: React.FC<Props> = ({ onEditColumns, onRunTask }) => {
  const { selection, projects, tasks, mappings, stats, deleteProject, deleteTask, deleteMapping, runningTaskId, updateTask } = useSyncStore();
  const connectionsMap = useConnectionStore((s) => s.connections);
  const project = selection?.type === 'project' ? projects.find((x) => x.id === selection.id) : undefined;
  const task = selection?.type === 'task' ? tasks.find((x) => x.id === selection.id) : undefined;
  const mapping = selection?.type === 'mapping' ? mappings.find((x) => x.id === selection.id) : undefined;

  // 调度编辑 Dialog 状态
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [editEnabled, setEditEnabled] = useState(true);
  const [editInterval, setEditInterval] = useState(60);
  const [savingSchedule, setSavingSchedule] = useState(false);

  const handleOpenSchedule = () => {
    if (!task) return;
    setEditEnabled(task.enabled !== false);
    setEditInterval(task.poll_interval_seconds || 60);
    setScheduleOpen(true);
  };
  const handleSaveSchedule = async () => {
    if (!task) return;
    setSavingSchedule(true);
    try {
      await updateTask(task.id, { enabled: editEnabled, pollIntervalSeconds: Math.max(5, editInterval) } as any);
      setScheduleOpen(false);
    } catch (err) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: { message: err instanceof Error ? err.message : '保存失败', severity: 'error' as 'error' },
      }));
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleDelete = async () => {
    const name = project?.name || task?.name || (mapping ? `${mapping.source_table} → ${mapping.target_table}` : '');
    if (!name || !window.confirm(`确认删除"${name}"？此操作不可撤销。`)) return;
    try {
      if (project) await deleteProject(project.id);
      else if (task) await deleteTask(task.id);
      else if (mapping) await deleteMapping(mapping.id);
    } catch (err) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: { message: err instanceof Error ? err.message : '删除失败', severity: 'error' as 'error' },
      }));
    }
  };
  const actionSx = { minWidth: 78, flexShrink: 0, borderColor: 'divider', color: 'text.secondary', fontSize: 11, '&:hover': { borderColor: 'primary.main', color: 'primary.main' } };

  const taskMark = task ? statusMark(task.last_run_status) : null;

  return <Box sx={{ width: 300, minWidth: 300, bgcolor: 'background.paper', borderLeft: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column' }}>
    <Typography sx={{ p: 1.5, color: 'text.primary', fontWeight: 600, fontSize: 13, borderBottom: '1px solid', borderColor: 'divider' }}>详情</Typography>
    <Box sx={{ p: 1.5, flex: 1, overflow: 'auto' }}>
      {!selection && <Typography sx={{ mt: 6, textAlign: 'center', color: 'text.disabled', fontSize: 12 }}>选择项目、任务或映射查看详情</Typography>}
      {project && <><Typography sx={{ color: 'text.primary', fontSize: 16, fontWeight: 600, mb: 2 }}>{project.name}</Typography><Row label="类型" value={<Chip size="small" label="同步项目" sx={{ height: 20, color: 'primary.main' }} />} /><Row label="描述" value={project.description || project.extra?.description} /><Row label="任务数" value={`${stats[project.id]?.taskCount ?? tasks.filter((x) => x.project_id === project.id).length}`} /><Row label="表映射数" value={`${stats[project.id]?.mappingCount ?? '-'}`} /><Row label="最后运行" value={fmt(stats[project.id]?.lastRunAt)} /><Row label="创建时间" value={fmt(project.created_at)} /></>}
      {task && taskMark && (
        <>
          <Typography sx={{ color: 'text.primary', fontSize: 16, fontWeight: 600, mb: 2 }}>{task.name}</Typography>
          <Row label="状态" value={<span style={{ color: taskMark.color }}>{taskMark.text} {taskMark.label}</span>} />
          <Row label="描述" value={task.description || task.extra?.description} />
          <Divider sx={{ borderColor: 'divider', my: 1.5 }} />
          <Row label="源连接 / Schema" value={`${connectionsMap[task.source_connection_id]?.name || task.source_connection_id} / ${task.source_schema || '默认'}`} />
          <Row label="目标连接 / Schema" value={`${connectionsMap[task.target_connection_id]?.name || task.target_connection_id} / ${task.target_schema || '默认'}`} />
          <Row label="写入策略" value={task.write_strategy} />
          <Row label="并发度" value={`${task.max_concurrent ?? 3} 路`} />
          <Row label="失败重试" value={`${task.retry_count ?? 2} 次（指数退避）`} />
          <Divider sx={{ borderColor: 'divider', my: 1.5 }} />
          <Typography sx={{ color: 'primary.main', fontSize: 11, mb: 1, letterSpacing: 0.5, fontWeight: 600 }}>调度</Typography>
          <Row label="自动调度" value={
            <Chip size="small" label={task.enabled === false ? '已停用' : '已启用'} sx={{ height: 20, bgcolor: task.enabled === false ? 'action.disabledBackground' : 'success.dark', color: 'common.white', fontSize: 10 }} />
          } />
          <Row label="轮询间隔" value={`${task.poll_interval_seconds || 60} 秒`} />
          <Row label="上次运行" value={fmt(task.last_run_at)} />
          <Row label="下次运行" value={computeNextRun(task) || '未启用'} />
          <Row label="上次同步行数" value={`${task.last_run_rows || 0}`} />
          <Divider sx={{ borderColor: 'divider', my: 1.5 }} />
          <HistoryList taskId={task.id} />
        </>
      )}
      {mapping && <><Typography sx={{ color: 'text.primary', fontSize: 15, fontWeight: 600, mb: 2 }}>{mapping.source_table} → {mapping.target_table}</Typography><Row label="状态" value={mapping.enabled === false ? '已停用' : '已启用'} /><Row label="最近同步" value={
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {mapping.last_run_status === 'success' && <CheckCircleOutlineIcon sx={{ fontSize: 13, color: 'success.main' }} />}
          {mapping.last_run_status === 'failed' && <ErrorOutlineIcon sx={{ fontSize: 13, color: 'error.main' }} />}
          <Typography sx={{ fontSize: 11.5, color: mapping.last_run_status === 'success' ? 'success.main' : mapping.last_run_status === 'failed' ? 'error.main' : 'text.secondary' }}>
            {mapping.last_run_status === 'success' ? '成功' : mapping.last_run_status === 'failed' ? '失败' : mapping.last_run_status ? mapping.last_run_status : '尚未同步'}
          </Typography>
        </Box>
      } /><Row label="最近同步时间" value={fmt(mapping.last_run_at)} /><Row label="最近同步行数" value={`${mapping.last_run_rows || 0}`} /><Row label="源表" value={mapping.source_table} /><Row label="目标表" value={mapping.target_table} /><Row label="字段映射" value={`${mapping.column_mappings?.length || 0} 个`} /><Row label="WHERE 条件" value={mapping.where_clause} /><Row label="ORDER BY" value={mapping.orderby} /><Row label="创建时间" value={fmt(mapping.created_at)} /></>}
    </Box>
    {selection && <Box sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'divider', display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      {task && (
        <Button size="small" variant="outlined" startIcon={<ScheduleIcon sx={{ fontSize: 14 }} />} onClick={handleOpenSchedule}
          sx={{ minWidth: 78, flexShrink: 0, borderColor: 'primary.main', color: 'primary.main', fontSize: 11, '&:hover': { borderColor: 'primary.light', bgcolor: 'rgba(66,165,245,0.08)' } }}>
          调度
        </Button>
      )}
      <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} sx={actionSx}>编辑</Button>
      {mapping && onEditColumns && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AccountTreeIcon sx={{ fontSize: 14 }} />}
          onClick={() => onEditColumns(mapping.id)}
          sx={{ minWidth: 88, flexShrink: 0, borderColor: 'primary.main', color: 'primary.main', fontSize: 11, '&:hover': { borderColor: 'primary.light', bgcolor: 'rgba(66,165,245,0.08)' } }}
        >
          字段映射
        </Button>
      )}
      {task && <Button
        size="small"
        variant="contained"
        startIcon={<PlayArrowIcon />}
        disabled={!!runningTaskId}
        onClick={() => onRunTask?.(task.id)}
        sx={{ ...actionSx, bgcolor: runningTaskId === task.id ? 'action.disabledBackground' : 'primary.main', color: 'common.white', '&:hover': { bgcolor: runningTaskId === task.id ? 'action.disabledBackground' : 'primary.dark' } }}
      >
        {runningTaskId === task.id ? '运行中...' : '立即运行'}
      </Button>}
      <Button size="small" variant="outlined" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} sx={{ ...actionSx, color: 'error.light', '&:hover': { borderColor: 'error.main', color: 'error.main' } }}>删除</Button>
    </Box>}

    {/* 调度编辑 Dialog */}
    <Dialog open={scheduleOpen} onClose={() => setScheduleOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: '#3C3F41', color: 'text.primary' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
        <ScheduleIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        调度配置
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 11, mb: 2 }}>任务: {task?.name}</Typography>
        <FormControlLabel
          control={<Switch checked={editEnabled} onChange={(e) => setEditEnabled(e.target.checked)} sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: 'primary.main' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'primary.main' } }} />}
          label="启用自动调度"
          sx={{ color: 'text.primary', mb: 2, display: 'block' }}
        />
        <TextField
          fullWidth
          size="small"
          label="轮询间隔（秒）"
          type="number"
          inputProps={{ min: 5, max: 86400 }}
          value={editInterval}
          onChange={(e) => setEditInterval(parseInt(e.target.value) || 60)}
          helperText="最小 5 秒"
          sx={{ '& .MuiInputBase-root': { color: 'text.primary' }, mb: 1 }}
        />
        <Select
          fullWidth
          size="small"
          value={editInterval}
          onChange={(e) => setEditInterval(Number(e.target.value))}
          sx={{ display: 'none' }}
        >
          {[60, 300, 600, 1800, 3600].map((v) => <MenuItem key={v} value={v}>{v}秒</MenuItem>)}
        </Select>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={() => setScheduleOpen(false)} size="small" disabled={savingSchedule} sx={{ color: 'text.secondary' }}>取消</Button>
        <Button onClick={handleSaveSchedule} variant="contained" size="small" disabled={savingSchedule}>
          {savingSchedule ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  </Box>;
};
export default DetailPanel;