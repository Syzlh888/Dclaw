import React from 'react';
import { Box, Button, Chip, Divider, Typography } from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { useSyncStore } from '../../stores/syncStore';
import { statusMark } from './ProjectTreePanel';

interface Props {
  /** 打开字段映射编辑器（仅在选中 mapping 时相关） */
  onEditColumns?: (mappingId: string) => void;
  /** 立即运行任务（透传到 DetailPanel 的运行按钮） */
  onRunTask?: (taskId: string) => void;
}

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => <Box sx={{ mb: 1.25 }}><Typography sx={{ color: '#777', fontSize: 10.5, mb: 0.25 }}>{label}</Typography><Typography component="div" sx={{ color: '#CCC', fontSize: 12, wordBreak: 'break-word' }}>{value || '-'}</Typography></Box>;
const fmt = (value?: string | null) => value ? new Date(value).toLocaleString('zh-CN') : '-';

const DetailPanel: React.FC<Props> = ({ onEditColumns, onRunTask }) => {
  const { selection, projects, tasks, mappings, stats, deleteProject, deleteTask, deleteMapping, runningTaskId } = useSyncStore();
  const project = selection?.type === 'project' ? projects.find((x) => x.id === selection.id) : undefined;
  const task = selection?.type === 'task' ? tasks.find((x) => x.id === selection.id) : undefined;
  const mapping = selection?.type === 'mapping' ? mappings.find((x) => x.id === selection.id) : undefined;
  const handleDelete = async () => {
    const name = project?.name || task?.name || (mapping ? `${mapping.source_table} → ${mapping.target_table}` : '');
    if (!name || !window.confirm(`确认删除“${name}”？此操作不可撤销。`)) return;
    if (project) await deleteProject(project.id); else if (task) await deleteTask(task.id); else if (mapping) await deleteMapping(mapping.id);
  };
  const actionSx = { minWidth: 78, flexShrink: 0, borderColor: '#606060', color: '#BBB', fontSize: 11, '&:hover': { borderColor: '#42A5F5', color: '#42A5F5' } };
  return <Box sx={{ width: 300, minWidth: 300, bgcolor: '#333638', borderLeft: '1px solid #505050', display: 'flex', flexDirection: 'column' }}>
    <Typography sx={{ p: 1.5, color: '#EEE', fontWeight: 600, fontSize: 13, borderBottom: '1px solid #505050' }}>详情</Typography>
    <Box sx={{ p: 1.5, flex: 1, overflow: 'auto' }}>
      {!selection && <Typography sx={{ mt: 6, textAlign: 'center', color: '#777', fontSize: 12 }}>选择项目、任务或映射查看详情</Typography>}
      {project && <><Typography sx={{ color: '#EEE', fontSize: 16, fontWeight: 600, mb: 2 }}>{project.name}</Typography><Row label="类型" value={<Chip size="small" label="同步项目" sx={{ height: 20, color: '#42A5F5' }} />} /><Row label="描述" value={project.description || project.extra?.description} /><Row label="任务数" value={`${stats[project.id]?.taskCount ?? tasks.filter((x) => x.project_id === project.id).length}`} /><Row label="表映射数" value={`${stats[project.id]?.mappingCount ?? '-'}`} /><Row label="最后运行" value={fmt(stats[project.id]?.lastRunAt)} /><Row label="创建时间" value={fmt(project.created_at)} /></>}
      {task && (() => { const mark = statusMark(task.last_run_status); return <><Typography sx={{ color: '#EEE', fontSize: 16, fontWeight: 600, mb: 2 }}>{task.name}</Typography><Row label="状态" value={<span style={{ color: mark.color }}>{mark.text} {mark.label}</span>} /><Row label="描述" value={task.description || task.extra?.description} /><Divider sx={{ borderColor: '#505050', my: 1.5 }} /><Row label="源连接 / Schema" value={`${task.source_connection_id} / ${task.source_schema || '默认'}`} /><Row label="目标连接 / Schema" value={`${task.target_connection_id} / ${task.target_schema || '默认'}`} /><Row label="写入策略" value={task.write_strategy} /><Row label="轮询间隔" value={`${task.poll_interval_seconds || 60} 秒`} /><Row label="最后运行时间" value={fmt(task.last_run_at)} /><Row label="最后同步行数" value={`${task.last_run_rows || 0}`} /></>; })()}
      {mapping && <><Typography sx={{ color: '#EEE', fontSize: 15, fontWeight: 600, mb: 2 }}>{mapping.source_table} → {mapping.target_table}</Typography><Row label="状态" value={mapping.enabled === false ? '已停用' : '已启用'} /><Row label="源表" value={mapping.source_table} /><Row label="目标表" value={mapping.target_table} /><Row label="字段映射" value={`${mapping.column_mappings?.length || 0} 个`} /><Row label="WHERE 条件" value={mapping.where_clause} /><Row label="ORDER BY" value={mapping.orderby} /><Row label="创建时间" value={fmt(mapping.created_at)} /></>}
    </Box>
    {selection && <Box sx={{ p: 1.25, borderTop: '1px solid #505050', display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
      <Button size="small" variant="outlined" startIcon={<EditOutlinedIcon />} sx={actionSx}>编辑</Button>
      {mapping && onEditColumns && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<AccountTreeIcon sx={{ fontSize: 14 }} />}
          onClick={() => onEditColumns(mapping.id)}
          sx={{ minWidth: 88, flexShrink: 0, borderColor: '#42A5F5', color: '#42A5F5', fontSize: 11, '&:hover': { borderColor: '#90CAF9', bgcolor: 'rgba(66,165,245,0.08)' } }}
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
        sx={{ ...actionSx, bgcolor: runningTaskId === task.id ? '#555' : '#42A5F5', color: '#FFF', '&:hover': { bgcolor: runningTaskId === task.id ? '#555' : '#1E88E5' } }}
      >
        {runningTaskId === task.id ? '运行中...' : '立即运行'}
      </Button>}
      <Button size="small" variant="outlined" startIcon={<DeleteOutlineIcon />} onClick={handleDelete} sx={{ ...actionSx, color: '#EF9A9A', '&:hover': { borderColor: '#EF5350', color: '#EF5350' } }}>删除</Button>
    </Box>}
  </Box>;
};
export default DetailPanel;
