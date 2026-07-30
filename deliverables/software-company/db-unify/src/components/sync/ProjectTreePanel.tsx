import React, { useEffect, useState, useCallback } from 'react';
import {
  Box, Button, CircularProgress, Dialog, DialogTitle, DialogContent,
  DialogActions, IconButton, InputAdornment, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderIcon from '@mui/icons-material/Folder';
import TableChartIcon from '@mui/icons-material/TableChart';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { useSyncStore } from '../../stores/syncStore';
import { syncService } from '../../services/syncService';
import type { SyncRunStatus } from '../../types/sync';

export const statusMark = (status: SyncRunStatus | undefined) => {
  if (status === 'running') return { text: '⏱', color: 'primary.main', label: '运行中' };
  if (status === 'success') return { text: '✓', color: 'success.main', label: '成功' };
  if (status === 'failed') return { text: '✗', color: 'error.main', label: '失败' };
  return { text: '○', color: 'text.disabled', label: '未运行' };
};

type EditTarget = { type: 'project'; id: string; name: string } | { type: 'task'; id: string; name: string } | null;
type DeleteTarget = { type: 'project' | 'task' | 'mapping'; id: string; name: string };

const ProjectTreePanel: React.FC<{ onCreateProject: () => void; onCreateTask: () => void }> = ({ onCreateProject, onCreateTask }) => {
  const {
    projects, tasks, mappings, loading, selectedProjectId, selectedTaskId, selectedMappingId,
    loadProjects, loadTasks, loadMappings, selectProject, selectTask, selectMapping,
    deleteProject, deleteTask, deleteMapping,
  } = useSyncStore();

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());
  const [searchText, setSearchText] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Edit dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [editName, setEditName] = useState('');
  const [editing, setEditing] = useState(false);

  // Delete confirm dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const toggleProject = async (id: string) => {
    const next = new Set(expandedProjects);
    if (next.has(id)) next.delete(id); else { next.add(id); await loadTasks(id); }
    setExpandedProjects(next);
  };
  const toggleTask = async (id: string) => {
    const next = new Set(expandedTasks);
    if (next.has(id)) next.delete(id); else { next.add(id); await loadMappings(id); }
    setExpandedTasks(next);
  };

  // ── Search / filter ──
  const searchLower = searchText.toLowerCase();
  const matchesSearch = useCallback(
    (...names: string[]) => !searchText || names.some((n) => n.toLowerCase().includes(searchLower)),
    [searchText],
  );

  const visibleProjects = searchText
    ? projects.filter((p) => {
        if (matchesSearch(p.name)) return true;
        const projectTasks = tasks.filter((t) => t.project_id === p.id);
        return projectTasks.some((t) => {
          if (matchesSearch(t.name)) return true;
          return mappings.some((m) => m.task_id === t.id && matchesSearch(m.source_table, m.target_table));
        });
      })
    : projects;

  const isProjectExpanded = (projectId: string) => expandedProjects.has(projectId) || !!searchText;
  const isTaskExpanded = (taskId: string) => expandedTasks.has(taskId) || !!searchText;

  // ── Edit actions ──
  const handleEditOpen = (e: React.MouseEvent, target: EditTarget) => {
    e.stopPropagation();
    if (!target) return;
    setEditTarget(target);
    setEditName(target.name);
    setEditDialogOpen(true);
  };

  const handleEditConfirm = async () => {
    if (!editTarget || !editName.trim()) return;
    setEditing(true);
    try {
      if (editTarget.type === 'project') {
        await syncService.updateProject(editTarget.id, { name: editName.trim() });
        await loadProjects();
      } else {
        await syncService.updateTask(editTarget.id, { name: editName.trim() });
        const task = tasks.find((t) => t.id === editTarget.id);
        if (task) await loadTasks(task.project_id);
      }
      setEditDialogOpen(false);
    } catch (err) {
      console.error('编辑失败:', err);
    } finally {
      setEditing(false);
    }
  };

  // ── Delete actions ──
  const handleDeleteOpen = (e: React.MouseEvent, target: DeleteTarget) => {
    e.stopPropagation();
    setDeleteTarget(target);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      if (deleteTarget.type === 'project') {
        await deleteProject(deleteTarget.id);
      } else if (deleteTarget.type === 'task') {
        await deleteTask(deleteTarget.id);
      } else {
        await deleteMapping(deleteTarget.id);
      }
      setDeleteDialogOpen(false);
    } catch (err) {
      console.error('删除失败:', err);
    } finally {
      setDeleting(false);
    }
  };

  // ── Styles ──
  const nodeSx = (selected: boolean, depth: number) => ({
    display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 30, pl: `${8 + depth * 18}px`, pr: 0.5,
    cursor: 'pointer',
    color: selected ? 'text.primary' : 'text.secondary',
    bgcolor: selected ? 'action.selected' : 'transparent',
    borderLeft: selected ? '3px solid' : '3px solid transparent',
    borderColor: 'primary.main',
    '&:hover': { bgcolor: selected ? 'action.selected' : 'action.hover' },
  });

  const actionBtnSx = {
    p: 0.3,
    color: 'text.secondary',
    '&:hover': { color: 'primary.main' },
  };

  return (
    <Box sx={{ width: 240, minWidth: 240, display: 'flex', flexDirection: 'column', bgcolor: 'background.default', borderRight: '1px solid', borderColor: 'divider' }}>
      {/* ── Search box ── */}
      <Box sx={{ px: 1, pt: 1, pb: 0.75 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="搜索同步项目..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          sx={{
            '& .MuiInputBase-root': { fontSize: '0.75rem', bgcolor: 'action.hover', borderRadius: 1 },
            '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
          }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
              </InputAdornment>
            ),
            endAdornment: searchText ? (
              <InputAdornment position="end">
                <IconButton size="small" onClick={() => setSearchText('')} sx={{ p: 0.2 }}>
                  <CloseIcon sx={{ fontSize: 12 }} />
                </IconButton>
              </InputAdornment>
            ) : undefined,
          }}
        />
      </Box>

      {/* ── Toolbar ── */}
      <Box sx={{ p: 1, display: 'flex', gap: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Button fullWidth size="small" startIcon={<AddIcon sx={{ fontSize: 14 }} />} onClick={onCreateProject} sx={{ textTransform: 'none', fontSize: '0.75rem', color: 'primary.main', border: '1px solid', borderColor: 'primary.main', whiteSpace: 'nowrap' }}>
          新建项目
        </Button>
        <Tooltip title={selectedProjectId ? '新建任务' : '请先选择项目'}>
          <span>
            <IconButton size="small" disabled={!selectedProjectId} onClick={onCreateTask} sx={{ color: 'primary.main', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
              <AddIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Box>

      {/* ── Header ── */}
      <Typography sx={{ px: 1.25, py: 0.75, fontSize: '0.7rem', color: 'text.secondary', letterSpacing: 1 }}>
        同步项目
      </Typography>

      {/* ── Tree ── */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {loading && <Box sx={{ p: 2, textAlign: 'center' }}><CircularProgress size={20} /></Box>}
        {!loading && visibleProjects.length === 0 && (
          <Typography sx={{ p: 2, fontSize: '0.75rem', color: 'text.secondary', textAlign: 'center' }}>
            {searchText ? '无匹配结果' : '暂无同步项目'}
          </Typography>
        )}
        {visibleProjects.map((project) => {
          const expanded = isProjectExpanded(project.id);
          const projectTasks = tasks.filter((task) => task.project_id === project.id);
          const isHovered = hoveredId === project.id;
          return (
            <React.Fragment key={project.id}>
              {/* ── Project node ── */}
              <Box
                sx={nodeSx(selectedProjectId === project.id && !selectedTaskId, 0)}
                onClick={() => selectProject(project.id)}
                onMouseEnter={() => setHoveredId(project.id)}
                onMouseLeave={() => setHoveredId(null)}
              >
                <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleProject(project.id); }} sx={{ p: 0, color: 'text.secondary' }}>
                  {expanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                </IconButton>
                <FolderIcon sx={{ fontSize: 16, color: project.color || 'primary.main' }} />
                <Typography noWrap sx={{ fontSize: '0.8rem', flex: 1, color: 'text.primary' }}>{project.name}</Typography>
                {!isHovered && <Typography sx={{ fontSize: '0.65rem', color: 'text.disabled', mr: 0.5 }}>{projectTasks.length}</Typography>}
                {isHovered && (
                  <Box sx={{ display: 'flex', gap: 0.2 }}>
                    <IconButton
                      size="small"
                      onClick={(e) => handleEditOpen(e, { type: 'project', id: project.id, name: project.name })}
                      sx={actionBtnSx}
                    >
                      <EditIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={(e) => handleDeleteOpen(e, { type: 'project', id: project.id, name: project.name })}
                      sx={actionBtnSx}
                    >
                      <DeleteIcon sx={{ fontSize: 13 }} />
                    </IconButton>
                  </Box>
                )}
              </Box>

              {/* ── Task nodes ── */}
              {expanded && projectTasks.map((task) => {
                const taskExpanded = isTaskExpanded(task.id);
                const mark = statusMark(task.last_run_status);
                const taskIsHovered = hoveredId === task.id;
                const taskMappings = mappings.filter((m) => m.task_id === task.id);
                return (
                  <React.Fragment key={task.id}>
                    <Box
                      sx={nodeSx(selectedTaskId === task.id && !selectedMappingId, 1)}
                      onClick={() => selectTask(task.id)}
                      onMouseEnter={() => setHoveredId(task.id)}
                      onMouseLeave={() => setHoveredId(null)}
                    >
                      <IconButton size="small" onClick={(e) => { e.stopPropagation(); toggleTask(task.id); }} sx={{ p: 0, color: 'text.secondary' }}>
                        {taskExpanded ? <ExpandMoreIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
                      </IconButton>
                      <Typography sx={{ fontSize: '0.8rem', color: mark.color }}>{mark.text}</Typography>
                      <Typography noWrap sx={{ fontSize: '0.75rem', flex: 1, color: 'text.primary' }}>{task.name}</Typography>
                      {taskIsHovered && (
                        <Box sx={{ display: 'flex', gap: 0.2 }}>
                          <IconButton
                            size="small"
                            onClick={(e) => handleEditOpen(e, { type: 'task', id: task.id, name: task.name })}
                            sx={actionBtnSx}
                          >
                            <EditIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                          <IconButton
                            size="small"
                            onClick={(e) => handleDeleteOpen(e, { type: 'task', id: task.id, name: task.name })}
                            sx={actionBtnSx}
                          >
                            <DeleteIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                        </Box>
                      )}
                    </Box>

                    {/* ── Mapping nodes ── */}
                    {taskExpanded && taskMappings.map((mapping) => {
                      const mappingIsHovered = hoveredId === mapping.id;
                      return (
                        <Box
                          key={mapping.id}
                          sx={nodeSx(selectedMappingId === mapping.id, 2)}
                          onClick={() => selectMapping(mapping.id)}
                          onMouseEnter={() => setHoveredId(mapping.id)}
                          onMouseLeave={() => setHoveredId(null)}
                        >
                          <Box sx={{ width: 24 }} />
                          <TableChartIcon sx={{ fontSize: 14, color: mapping.enabled === false ? 'text.disabled' : 'primary.light' }} />
                          <Typography noWrap sx={{ fontSize: '0.7rem', flex: 1, color: 'text.primary' }}>
                            {mapping.source_table} → {mapping.target_table}
                          </Typography>
                          {mappingIsHovered && (
                            <IconButton
                              size="small"
                              onClick={(e) => handleDeleteOpen(e, { type: 'mapping', id: mapping.id, name: `${mapping.source_table} → ${mapping.target_table}` })}
                              sx={actionBtnSx}
                            >
                              <DeleteIcon sx={{ fontSize: 13 }} />
                            </IconButton>
                          )}
                        </Box>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}
      </Box>

      {/* ── Bottom "添加项目" button ── */}
      <Box sx={{ px: 1, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Button
          variant="text"
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 14 }} />}
          onClick={onCreateProject}
          sx={{
            fontSize: '0.8rem',
            color: 'text.secondary',
            textTransform: 'none',
            width: '100%',
            justifyContent: 'flex-start',
            '&:hover': { bgcolor: 'action.hover', color: 'primary.main' },
          }}
        >
          添加项目
        </Button>
      </Box>

      {/* ── Edit Dialog ── */}
      <Dialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '0.95rem', pb: 1 }}>
          {editTarget?.type === 'project' ? '修改项目' : '修改任务'}
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            size="small"
            margin="dense"
            label={editTarget?.type === 'project' ? '项目名称' : '任务名称'}
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleEditConfirm(); }
            }}
            fullWidth
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setEditDialogOpen(false)} size="small" disabled={editing}>
            取消
          </Button>
          <Button onClick={handleEditConfirm} variant="contained" size="small" disabled={!editName.trim() || editing}>
            {editing ? '保存中...' : '保存'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Delete Confirmation Dialog ── */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '0.95rem', pb: 1 }}>确认删除</DialogTitle>
        <DialogContent>
          <Typography sx={{ fontSize: '0.85rem' }}>
            确定要删除「{deleteTarget?.name}」吗？此操作不可撤销。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleteDialogOpen(false)} size="small" disabled={deleting}>
            取消
          </Button>
          <Button onClick={handleDeleteConfirm} variant="contained" color="error" size="small" disabled={deleting}>
            {deleting ? '删除中...' : '删除'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ProjectTreePanel;
