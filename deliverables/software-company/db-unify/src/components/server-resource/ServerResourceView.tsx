import React, { useEffect, useState, useCallback } from 'react';
import { Box } from '@mui/material';
import ServerListPanel from './ServerListPanel';
import ServerDetailPanel from './ServerDetailPanel';
import ServerFormDialog from './ServerFormDialog';
import ServerImportDialog from './ServerImportDialog';
import ResizableHandle from '../layout/ResizableHandle';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';

function getPersisted(key: string, fallback: number): number {
  try {
    const v = localStorage.getItem(key);
    return v ? parseInt(v, 10) || fallback : fallback;
  } catch { return fallback; }
}

const ServerResourceView: React.FC = () => {
  const loadServers = useServerStore(s => s.loadServers);
  const selectedId = useServerStore(s => s.selectedId);
  const deleteServer = useServerStore(s => s.deleteServer);
  const createServer = useServerStore(s => s.createServer);
  const updateServer = useServerStore(s => s.updateServer);
  const serverMap = useServerStore(s => s.serverMap);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const loadEngineerings = useProjectStore(s => s.loadEngineerings);
  const loadApplications = useProjectStore(s => s.loadApplications);

  const [formOpen, setFormOpen] = useState(false);
  const [editServer, setEditServer] = useState<any>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [preset, setPreset] = useState<{projectId?: string; engineeringId?: string; applicationId?: string}>({});

  const [listWidth, setListWidth] = useState(() => getPersisted('dc_server_list_width', 320));
  const handleListResize = useCallback((delta: number) => {
    setListWidth((prev) => {
      const next = Math.max(200, Math.min(600, prev + delta));
      try { localStorage.setItem('dc_server_list_width', String(next)); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    loadServers();
    loadProjects();
    loadEngineerings();
    loadApplications();
  }, [loadServers, loadProjects, loadEngineerings, loadApplications]);

  const handleAdd = (p?: {projectId?: string; engineeringId?: string; applicationId?: string}) => {
    setEditServer(null);
    setPreset(p || {});
    setFormOpen(true);
  };
  const handleEdit = () => {
    const s = selectedId ? serverMap[selectedId] : null;
    if (s) { setEditServer(s); setFormOpen(true); }
  };
  const handleDelete = () => {
    if (!selectedId) return;
    if (confirm('确定要删除此服务器及其所有子资源吗？')) deleteServer(selectedId);
  };
  const handleSave = async (data: any) => {
    if (editServer) await updateServer(editServer.id, data);
    else await createServer(data);
    setFormOpen(false);
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 主内容区：左侧列表 + 可拖拽分割条 + 右侧详情 */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <ServerListPanel width={listWidth} onAdd={handleAdd} onImport={() => setImportOpen(true)} onAddProject={() => { setEditServer(null); setPreset({}); setFormOpen(true); }} />
        <ResizableHandle direction="vertical" onResize={handleListResize} />
        <ServerDetailPanel onEdit={handleEdit} onDelete={handleDelete} />
      </Box>

      <ServerFormDialog
        open={formOpen}
        server={editServer}
        presetProjectId={preset.projectId}
        presetEngineeringId={preset.engineeringId}
        presetApplicationId={preset.applicationId}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
      />
      <ServerImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </Box>
  );
};

export default ServerResourceView;
