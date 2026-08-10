import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import {
  Box, List, ListItemButton, ListItemText, Typography, Button, Chip, Collapse, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Menu, MenuItem, ListItemIcon,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import StorageIcon from '@mui/icons-material/Storage';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import CategoryIcon from '@mui/icons-material/Category';
import AppsIcon from '@mui/icons-material/Apps';
import { ConnectionIcon } from '../database-tree/DbIcons';
import ContextMenu from '../common/ContextMenu';
import type { ContextMenuItemDef } from '../common/ContextMenu';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { useServerStore } from '../../stores/serverStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useProjectStore } from '../../stores/projectStore';
import ServerSearchBar from './ServerSearchBar';
import type { ServerHost, DbInstance, AppInstance, ApiInstance, MiddlewareInstance } from '../../types/server';

interface Props {
  onAdd: (preset?: {projectId?: string; engineeringId?: string; applicationId?: string}) => void;
  onImport: () => void;
  onAddProject: () => void;
  width?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function sortByName<T extends { name: string; sortOrder?: number }>(arr: T[]): T[] {
  return [...arr].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'zh-CN'),
  );
}



// ─── Add Child Dialog (shared) ─────────────────────────────────────────────────

const AddChildDialog: React.FC<{
  open: boolean;
  title: string;
  label: string;
  initialName?: string;
  initialShortName?: string;
  onClose: () => void;
  onConfirm: (name: string, shortName?: string) => void;
}> = ({ open, title, label, initialName, initialShortName, onClose, onConfirm }) => {
  const [name, setName] = useState('');
  const [shortName, setShortName] = useState('');
  useEffect(() => { if (open) { setName(initialName || ''); setShortName(initialShortName || ''); } }, [open, initialName, initialShortName]);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: '0.85rem', pb: 0.5 }}>{title}</DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        <TextField
          autoFocus
          label={label}
          value={name}
          onChange={e => setName(e.target.value)}
          size="small"
          fullWidth
          sx={{ mb: 1.5, mt: 0.5 }}
        />
        <TextField
          label="简称（可选）"
          value={shortName}
          onChange={e => setShortName(e.target.value)}
          size="small"
          fullWidth
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">取消</Button>
        <Button
          onClick={() => { if (name.trim()) { onConfirm(name.trim(), shortName.trim() || undefined); onClose(); } }}
          size="small"
          variant="contained"
          disabled={!name.trim()}
        >
          确定
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ─── Sub-components ─────────────────────────────────────────────────────────────

/** 第4层：服务器叶子节点（支持拖动排序） */
const ServerLeaf: React.FC<{
  server: ServerHost;
  selected: boolean;
  onSelect: (id: string) => void;
  /** 拖动排序回调：将 dragId 移动到 targetId 的 before/after 位置 */
  onReorder: (dragId: string, targetId: string, position: 'before' | 'after') => void;
}> = ({ server, selected, onSelect, onReorder }) => {
  const ipText = (server.ips && server.ips.length > 0)
    ? server.ips.map(ip => `${ip.type} · ${ip.ip}${ip.port ? `:${ip.port}` : ''}`).join(' | ')
    : server.internalIp || '';
  const isHighlighted = selected;

  // 拖动排序状态
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);
  const dragServerId = useRef<string | null>(null);

  const handleDragStart = (e: React.DragEvent) => {
    dragServerId.current = server.id;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', server.id); } catch { /* noop */ }
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!dragServerId.current || dragServerId.current === server.id) {
      // 来自其他源的拖拽（比如外部）- 仍然允许，但跨应用会在 drop 时校验
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    setDropPosition(e.clientY < midY ? 'before' : 'after');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // 仅当离开整个元素时清空指示线（relatedTarget 不在当前元素内）
    const rt = e.relatedTarget as Node | null;
    if (rt && (e.currentTarget as Node).contains(rt)) return;
    setDropPosition(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dragId = dragServerId.current
      || (e.dataTransfer.getData('text/plain') as string)
      || null;
    const position = dropPosition || 'after';
    setDropPosition(null);
    if (!dragId || dragId === server.id) {
      dragServerId.current = null;
      return;
    }
    // 跨应用拖动由 onReorder 内部校验（目标服务器的 applicationId 作为归属）
    onReorder(dragId, server.id, position);
    dragServerId.current = null;
  };

  const handleDragEnd = () => {
    dragServerId.current = null;
    setDropPosition(null);
  };

  return (
    <Box
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragEnd={handleDragEnd}
      sx={{
        position: 'relative',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      {/* 插入指示线 */}
      {dropPosition === 'before' && (
        <Box sx={{
          position: 'absolute', top: 0, left: `${14 + 20 * 3}px`, right: 8,
          height: 2, bgcolor: 'primary.main', zIndex: 2,
        }} />
      )}
      {dropPosition === 'after' && (
        <Box sx={{
          position: 'absolute', bottom: 0, left: `${14 + 20 * 3}px`, right: 8,
          height: 2, bgcolor: 'primary.main', zIndex: 2,
        }} />
      )}
      <ListItemButton
        selected={isHighlighted}
        onClick={() => onSelect(server.id)}
        sx={{
          py: 0,
          minHeight: 22,
          pl: `${14 + 20 * 3}px`,
          cursor: 'grab',
          ...(isHighlighted
            ? { bgcolor: 'primary.dark', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }
            : { '&:hover': { bgcolor: 'action.hover' } }),
        }}
      >
        <StorageIcon sx={{ fontSize: 16, mr: 0.5, color: isHighlighted ? 'inherit' : 'text.secondary' }} />
        <ListItemText
          disableTypography
          primary={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, lineHeight: 1.2 }}>
              <Typography variant="caption" sx={{ fontSize: '1.15rem', fontWeight: 500, lineHeight: 1.2 }}>
                {server.name}
              </Typography>
              {ipText && (
                <Typography variant="caption" color={isHighlighted ? 'inherit' : 'text.disabled'} sx={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                  {ipText}
                </Typography>
              )}
            </Box>
          }
        />
      </ListItemButton>
    </Box>
  );
};

// ─── Server keyword match helper ────────────────────────────────────────────────

function serverMatches(
  s: ServerHost,
  kw: string,
  extras?: {
    dbInstances?: DbInstance[];
    appInstances?: AppInstance[];
    apiInstances?: ApiInstance[];
    midInstances?: MiddlewareInstance[];
    linkedConnectionNames?: string[];
  }
): boolean {
  const ipAddrs = [
    ...(s.ips || []).map(ip => `${ip.ip || ''} ${ip.mappedIp || ''} ${ip.type || ''}`),
    s.internalIp || '', s.externalIp || '', s.publicIp || '', s.crossNetworkIp || '',
  ].join(' ');
  const ownMatch = [
    s.name || '', ipAddrs, s.os || '', s.serverLocation || '', s.serverType || '',
    s.username || '', s.macAddress || '', s.vpnInfo || '', s.notes || '',
    s.deployedContent || '', (s.tags || []).join(' '),
    (s.credentials || []).map(c => c.username || '').join(' '),
    s.bastionHost || '', s.bastionUsername || '',
  ].join(' ').toLowerCase().includes(kw);
  if (ownMatch) return true;
  if (!extras) return false;
  // Check child resources + linked connections
  const childText = [
    ...(extras.dbInstances || []).flatMap(d => [d.dbName, d.dbType, d.schema, d.version, d.username, d.internalIp, d.externalIp, ...(d.credentials || []).map(c => c.connectionName || ''), ...(d.credentials || []).map(c => c.schema || '')]),
    ...(extras.appInstances || []).flatMap(a => [a.name, a.url, a.ip, a.username, a.contactPerson]),
    ...(extras.apiInstances || []).flatMap(a => [a.apiAddress, a.applicationName, a.ip]),
    ...(extras.midInstances || []).flatMap(m => [m.name, m.type, m.version, m.url, m.ip, m.username, m.serviceApp]),
    ...(extras.linkedConnectionNames || []),
  ].filter(Boolean).join(' ').toLowerCase();
  return childText.includes(kw);
}

/** 第3层：应用节点 */
const AppNode: React.FC<{
  app: { id: string; name: string; shortName?: string; engineeringId: string };
  expanded: boolean;
  onToggle: () => void;
  servers: ServerHost[];
  selectedId: string | null;
  onSelectServer: (id: string) => void;
  keyword: string;
  reorderServers: (items: { id: string; sortOrder: number }[]) => void;
  onAddServer: (applicationId: string) => void;
  onAddSiblingApp: (engineeringId: string) => void;
  onEditApplication: (app: { id: string; name: string; shortName?: string }) => void;
  onDeleteApplication: (appId: string) => void;
  onCtxMenu: (e: React.MouseEvent, items: ContextMenuItemDef[]) => void;
}> = ({ app, expanded, onToggle, servers, selectedId, onSelectServer, keyword, reorderServers, onAddServer, onAddSiblingApp, onEditApplication, onDeleteApplication, onCtxMenu }) => {
  // 行内“新增”按钮的下拉菜单锚点（合并"新增同级应用"和"新增服务器"）
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
  const children = servers.filter(s => s.applicationId === app.id);
  const kw = keyword?.toLowerCase();
  const dbInstMap = useServerStore(s => s.dbInstances);
  const appInstMap = useServerStore(s => s.appInstances);
  const apiInstMap = useServerStore(s => s.apiInstances);
  const midInstMap = useServerStore(s => s.midInstances);
  const connMap = useConnectionStore(s => s.connections);
  const filteredChildren = kw ? children.filter(s => serverMatches(s, kw, {
    dbInstances: dbInstMap[s.id] || [],
    appInstances: appInstMap[s.id] || [],
    apiInstances: apiInstMap[s.id] || [],
    midInstances: midInstMap[s.id] || [],
    linkedConnectionNames: Object.values(connMap).filter(c => c.serverId === s.id).map(c => c.name),
  })) : children;
  const hasChildren = filteredChildren.length > 0;
  const match = !!kw && app.name?.toLowerCase().includes(kw);
  // During search, hide app if no match at all
  if (kw && !match && !hasChildren) return null;

  /** 计算 reorder：dragId 移到 targetId 的 before/after；仅同应用内生效 */
  const handleReorder = (dragId: string, targetId: string, position: 'before' | 'after') => {
    const ordered = sortByName(children).map(s => s.id);
    const fromIdx = ordered.indexOf(dragId);
    if (fromIdx === -1) return; // 跨应用拖动：源不在当前应用下，忽略
    let toIdx = ordered.indexOf(targetId);
    if (toIdx === -1) return;
    // 先移除源
    ordered.splice(fromIdx, 1);
    // 移除后重新定位目标索引
    toIdx = ordered.indexOf(targetId);
    if (position === 'after') toIdx += 1;
    ordered.splice(toIdx, 0, dragId);
    const items = ordered.map((id, i) => ({ id, sortOrder: i }));
    reorderServers(items);
  };

  return (
    <>
      <ListItemButton
        onClick={hasChildren ? onToggle : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCtxMenu(e, [
            { label: '新增同级应用', icon: <AddIcon />, onClick: () => onAddSiblingApp(app.engineeringId) },
            { label: '修改', icon: <EditIcon />, onClick: () => onEditApplication(app) },
            { label: '删除', icon: <DeleteIcon />, onClick: () => onDeleteApplication(app.id), danger: true },
          ]);
        }}
        sx={{
          py: 0,
          minHeight: 22,
          pl: `${14 + 20 * 2}px`,
          ...(match ? { bgcolor: 'action.selected' } : {}),
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {hasChildren ? (
          expanded
            ? <ExpandMoreIcon sx={{ fontSize: 12, mr: 0.15 }} />
            : <ChevronRightIcon sx={{ fontSize: 12, mr: 0.15 }} />
        ) : (
          <Box sx={{ width: 18, mr: 0.15 }} />
        )}
        <AppsIcon sx={(theme) => ({ fontSize: 18, mr: 0.5, color: theme.palette.mode === 'light' ? '#0288d1' : '#4DB8E6' })} />
        <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500, flex: 1 }}>
          {app.name}
          {app.shortName ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              {' '}({app.shortName})
            </Typography>
          ) : null}
        </Typography>
        {hasChildren && (
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
            {filteredChildren.length}
          </Typography>
        )}
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setAddMenuAnchor(e.currentTarget); }} sx={{ p: 0.25, '&:hover': { color: 'primary.main' } }}><AddIcon sx={{ fontSize: 14 }} /></IconButton>
        {/* 下拉菜单：新增同级应用 / 新增服务器 */}
        <Menu
          anchorEl={addMenuAnchor}
          open={Boolean(addMenuAnchor)}
          onClose={() => setAddMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          MenuListProps={{ dense: true, sx: { py: 0.25 } }}
          slotProps={{ paper: { sx: { minWidth: 140, borderRadius: 1 } } }}
        >
          <MenuItem onClick={() => { setAddMenuAnchor(null); onAddSiblingApp(app.engineeringId); }} sx={{ minHeight: 26, py: 0.3, fontSize: '0.72rem' }}>
            <ListItemIcon sx={{ minWidth: 24 }}><AddIcon sx={{ fontSize: 15 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.72rem' }}>新增同级应用</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setAddMenuAnchor(null); onAddServer(app.id); }} sx={{ minHeight: 26, py: 0.3, fontSize: '0.72rem' }}>
            <ListItemIcon sx={{ minWidth: 24 }}><StorageIcon sx={{ fontSize: 15 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.72rem' }}>新增服务器</ListItemText>
          </MenuItem>
        </Menu>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEditApplication(app); }} sx={{ p: 0.25, '&:hover': { color: 'warning.main' } }}><EditIcon sx={{ fontSize: 14 }} /></IconButton>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDeleteApplication(app.id); }} sx={{ p: 0.25, '&:hover': { color: 'error.main' } }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton>
      </ListItemButton>
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {sortByName(filteredChildren).map(s => (
            <ServerLeaf
              key={s.id}
              server={s}
              selected={selectedId === s.id}
              onSelect={onSelectServer}
              onReorder={handleReorder}
            />
          ))}
        </Collapse>
      )}
    </>
  );
};

/** 第2层：工程节点 */
const EngNode: React.FC<{
  eng: { id: string; name: string; shortName?: string; projectId: string };
  expanded: boolean;
  onToggle: () => void;
  applications: { id: string; name: string; shortName?: string; engineeringId: string }[];
  expandedApps: Set<string>;
  onToggleApp: (id: string) => void;
  servers: ServerHost[];
  selectedId: string | null;
  onSelectServer: (id: string) => void;
  keyword: string;
  reorderServers: (items: { id: string; sortOrder: number }[]) => void;
  onAddApplication: (engineeringId: string, name?: string, shortName?: string) => void;
  onAddServer: (applicationId: string) => void;
  onAddServerDirect: (context: string) => void;
  onEditEngineering: (eng: { id: string; name: string; shortName?: string }) => void;
  onDeleteEngineering: (engId: string) => void;
  onEditApplication: (app: { id: string; name: string; shortName?: string }) => void;
  onDeleteApplication: (appId: string) => void;
  onCtxMenu: (e: React.MouseEvent, items: ContextMenuItemDef[]) => void;
}> = ({ eng, expanded, onToggle, applications, expandedApps, onToggleApp, servers, selectedId, onSelectServer, keyword, reorderServers, onAddApplication, onAddServer, onAddServerDirect, onEditEngineering, onDeleteEngineering, onEditApplication, onDeleteApplication, onCtxMenu }) => {
  // 行内“新增”按钮的下拉菜单锚点（合并"新增应用"和"新增服务器"）
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
  const kw = keyword?.toLowerCase();
  const children = applications.filter(a => a.engineeringId === eng.id);
  const dbInstMap = useServerStore(s => s.dbInstances);
  const appInstMap = useServerStore(s => s.appInstances);
  const apiInstMap = useServerStore(s => s.apiInstances);
  const midInstMap = useServerStore(s => s.midInstances);
  const connMap = useConnectionStore(s => s.connections);
  // During search: which app IDs have matching servers under this eng?
  const matchAppIds = new Set(
    kw ? servers.filter(s => s.engineeringId === eng.id && serverMatches(s, kw, {
      dbInstances: dbInstMap[s.id] || [],
      appInstances: appInstMap[s.id] || [],
      apiInstances: apiInstMap[s.id] || [],
      midInstances: midInstMap[s.id] || [],
      linkedConnectionNames: Object.values(connMap).filter(c => c.serverId === s.id).map(c => c.name),
    })).map(s => s.applicationId) : []
  );
  const filteredChildren = kw
    ? children.filter(a => matchAppIds.has(a.id) || a.name?.toLowerCase().includes(kw))
    : children;
  const hasChildren = filteredChildren.length > 0;
  const match = !!kw && eng.name?.toLowerCase().includes(kw);
  // During search, hide eng if no match at all
  if (kw && !match && !hasChildren) return null;

  return (
    <>
      <ListItemButton
        onClick={hasChildren ? onToggle : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCtxMenu(e, [
            { label: '新增应用', icon: <AddIcon />, onClick: () => onAddApplication(eng.id) },
            { label: '修改', icon: <EditIcon />, onClick: () => onEditEngineering(eng) },
            { label: '删除', icon: <DeleteIcon />, onClick: () => onDeleteEngineering(eng.id), danger: true },
          ]);
        }}
        sx={{
          py: 0,
          minHeight: 22,
          pl: `${14 + 20 * 1}px`,
          ...(match ? { bgcolor: 'action.selected' } : {}),
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {hasChildren ? (
          expanded
            ? <ExpandMoreIcon sx={{ fontSize: 12, mr: 0.15 }} />
            : <ChevronRightIcon sx={{ fontSize: 12, mr: 0.15 }} />
        ) : (
          <Box sx={{ width: 18, mr: 0.15 }} />
        )}
        <CategoryIcon sx={(theme) => ({ fontSize: 18, mr: 0.5, color: theme.palette.mode === 'light' ? '#2e7d32' : '#6BBF5A' })} />
        <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500, flex: 1 }}>
          {eng.name}
          {eng.shortName ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              {' '}({eng.shortName})
            </Typography>
          ) : null}
        </Typography>
        {hasChildren && (
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
            {filteredChildren.length}
          </Typography>
        )}
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setAddMenuAnchor(e.currentTarget); }} sx={{ p: 0.25, '&:hover': { color: 'primary.main' } }}><AddIcon sx={{ fontSize: 14 }} /></IconButton>
        {/* 下拉菜单：新增应用 / 新增服务器 */}
        <Menu
          anchorEl={addMenuAnchor}
          open={Boolean(addMenuAnchor)}
          onClose={() => setAddMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          MenuListProps={{ dense: true, sx: { py: 0.25 } }}
          slotProps={{ paper: { sx: { minWidth: 140, borderRadius: 1 } } }}
        >
          <MenuItem onClick={() => { setAddMenuAnchor(null); onAddApplication(eng.id); }} sx={{ minHeight: 26, py: 0.3, fontSize: '0.72rem' }}>
            <ListItemIcon sx={{ minWidth: 24 }}><AddIcon sx={{ fontSize: 15 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.72rem' }}>新增应用</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setAddMenuAnchor(null); onAddServerDirect(eng.id); }} sx={{ minHeight: 26, py: 0.3, fontSize: '0.72rem' }}>
            <ListItemIcon sx={{ minWidth: 24 }}><StorageIcon sx={{ fontSize: 15 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.72rem' }}>新增服务器</ListItemText>
          </MenuItem>
        </Menu>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEditEngineering(eng); }} sx={{ p: 0.25, '&:hover': { color: 'warning.main' } }}><EditIcon sx={{ fontSize: 14 }} /></IconButton>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDeleteEngineering(eng.id); }} sx={{ p: 0.25, '&:hover': { color: 'error.main' } }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton>
      </ListItemButton>
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {sortByName(filteredChildren).map(app => (
            <AppNode
              key={app.id}
              app={app}
              expanded={expandedApps.has(app.id)}
              onToggle={() => onToggleApp(app.id)}
              servers={servers}
              selectedId={selectedId}
              onSelectServer={onSelectServer}
              keyword={keyword}
              reorderServers={reorderServers}
              onAddServer={onAddServer}
              onAddSiblingApp={(engId) => onAddApplication(engId)}
              onEditApplication={onEditApplication}
              onDeleteApplication={onDeleteApplication}
              onCtxMenu={onCtxMenu}
            />
          ))}
        </Collapse>
      )}
    </>
  );
};

/** 第1层：项目节点 */
const ProjectNode: React.FC<{
  project: { id: string; name: string; shortName?: string };
  expanded: boolean;
  onToggle: () => void;
  engineerings: { id: string; name: string; shortName?: string; projectId: string }[];
  expandedEngineerings: Set<string>;
  onToggleEngineering: (id: string) => void;
  applications: { id: string; name: string; shortName?: string; engineeringId: string }[];
  expandedApps: Set<string>;
  onToggleApp: (id: string) => void;
  servers: ServerHost[];
  selectedId: string | null;
  onSelectServer: (id: string) => void;
  keyword: string;
  reorderServers: (items: { id: string; sortOrder: number }[]) => void;
  onAddEngineering: (projectId: string, name?: string, shortName?: string) => void;
  onAddApplication: (engineeringId: string, name?: string, shortName?: string) => void;
  onAddServer: (applicationId: string) => void;
  onAddServerDirect: (context: string) => void;
  onEditProject: (proj: { id: string; name: string; shortName?: string }) => void;
  onDeleteProject: (projId: string) => void;
  onEditEngineering: (eng: { id: string; name: string; shortName?: string }) => void;
  onDeleteEngineering: (engId: string) => void;
  onEditApplication: (app: { id: string; name: string; shortName?: string }) => void;
  onDeleteApplication: (appId: string) => void;
  onCtxMenu: (e: React.MouseEvent, items: ContextMenuItemDef[]) => void;
}> = ({ project, expanded, onToggle, engineerings, expandedEngineerings, onToggleEngineering, applications, expandedApps, onToggleApp, servers, selectedId, onSelectServer, keyword, reorderServers, onAddEngineering, onAddApplication, onAddServer, onAddServerDirect, onEditProject, onDeleteProject, onEditEngineering, onDeleteEngineering, onEditApplication, onDeleteApplication, onCtxMenu }) => {
  // 行内“新增”按钮的下拉菜单锚点（合并"新增工程"和"新增服务器"）
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
  const children = engineerings.filter(e => e.projectId === project.id);
  const hasChildren = children.length > 0;
  const match =
    !!keyword && project.name?.toLowerCase().includes(keyword.toLowerCase());

  return (
    <>
      <ListItemButton
        onClick={hasChildren ? onToggle : undefined}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onCtxMenu(e, [
            { label: '新增工程', icon: <AddIcon />, onClick: () => onAddEngineering(project.id) },
            { label: '修改', icon: <EditIcon />, onClick: () => onEditProject(project) },
            { label: '删除', icon: <DeleteIcon />, onClick: () => onDeleteProject(project.id), danger: true },
          ]);
        }}
        sx={{
          py: 0,
          minHeight: 22,
          pl: `${14 + 20 * 0}px`,
          ...(match ? { bgcolor: 'action.selected' } : {}),
          '&:hover': { bgcolor: 'action.hover' },
        }}
      >
        {hasChildren ? (
          expanded
            ? <ExpandMoreIcon sx={{ fontSize: 12, mr: 0.15 }} />
            : <ChevronRightIcon sx={{ fontSize: 12, mr: 0.15 }} />
        ) : (
          <Box sx={{ width: 18, mr: 0.15 }} />
        )}
        <FolderIcon sx={(theme) => ({ fontSize: 18, mr: 0.5, color: theme.palette.mode === 'light' ? '#ed6c02' : '#DAAA4E' })} />
        <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 600, flex: 1 }}>
          {project.name}
          {project.shortName ? (
            <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
              {' '}({project.shortName})
            </Typography>
          ) : null}
        </Typography>
        {hasChildren && (
          <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
            {children.length}
          </Typography>
        )}
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); setAddMenuAnchor(e.currentTarget); }} sx={{ p: 0.25, '&:hover': { color: 'primary.main' } }}><AddIcon sx={{ fontSize: 14 }} /></IconButton>
        {/* 下拉菜单：新增工程 / 新增服务器 */}
        <Menu
          anchorEl={addMenuAnchor}
          open={Boolean(addMenuAnchor)}
          onClose={() => setAddMenuAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          MenuListProps={{ dense: true, sx: { py: 0.25 } }}
          slotProps={{ paper: { sx: { minWidth: 140, borderRadius: 1 } } }}
        >
          <MenuItem onClick={() => { setAddMenuAnchor(null); onAddEngineering(project.id); }} sx={{ minHeight: 26, py: 0.3, fontSize: '0.72rem' }}>
            <ListItemIcon sx={{ minWidth: 24 }}><AddIcon sx={{ fontSize: 15 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.72rem' }}>新增工程</ListItemText>
          </MenuItem>
          <MenuItem onClick={() => { setAddMenuAnchor(null); onAddServerDirect(project.id); }} sx={{ minHeight: 26, py: 0.3, fontSize: '0.72rem' }}>
            <ListItemIcon sx={{ minWidth: 24 }}><StorageIcon sx={{ fontSize: 15 }} /></ListItemIcon>
            <ListItemText primaryTypographyProps={{ fontSize: '0.72rem' }}>新增服务器</ListItemText>
          </MenuItem>
        </Menu>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onEditProject(project); }} sx={{ p: 0.25, '&:hover': { color: 'warning.main' } }}><EditIcon sx={{ fontSize: 14 }} /></IconButton>
        <IconButton size="small" onClick={(e) => { e.stopPropagation(); onDeleteProject(project.id); }} sx={{ p: 0.25, '&:hover': { color: 'error.main' } }}><DeleteIcon sx={{ fontSize: 14 }} /></IconButton>
      </ListItemButton>
      {hasChildren && (
        <Collapse in={expanded} timeout="auto" unmountOnExit>
          {sortByName(children).map(eng => (
            <EngNode
              key={eng.id}
              eng={eng}
              expanded={expandedEngineerings.has(eng.id)}
              onToggle={() => onToggleEngineering(eng.id)}
              applications={applications}
              expandedApps={expandedApps}
              onToggleApp={onToggleApp}
              servers={servers}
              selectedId={selectedId}
              onSelectServer={onSelectServer}
              keyword={keyword}
              reorderServers={reorderServers}
              onAddApplication={onAddApplication}
              onAddServer={onAddServer}
              onAddServerDirect={onAddServerDirect}
              onEditEngineering={onEditEngineering}
              onDeleteEngineering={onDeleteEngineering}
              onEditApplication={onEditApplication}
              onDeleteApplication={onDeleteApplication}
              onCtxMenu={onCtxMenu}
            />
          ))}
        </Collapse>
      )}
    </>
  );
};

// ─── Main component ─────────────────────────────────────────────────────────────

const ServerListPanel: React.FC<Props> = ({ onAdd, onImport, onAddProject, width = 320 }) => {
  const searchFilter = useServerStore(s => s.searchFilter);
  const setSearchFilter = useServerStore(s => s.setSearchFilter);
  const selectedId = useServerStore(s => s.selectedId);
  const selectServer = useServerStore(s => s.selectServer);
  const servers = useServerStore(s => s.servers);
  const loadServers = useServerStore(s => s.loadServers);

  const projects = useProjectStore(s => s.projects);
  const engineerings = useProjectStore(s => s.engineerings);
  const applications = useProjectStore(s => s.applications);
  const addProject = useProjectStore(s => s.addProject);
  const addEngineering = useProjectStore(s => s.addEngineering);
  const addApplication = useProjectStore(s => s.addApplication);
  const editProject = useProjectStore(s => s.editProject);
  const editEngineering = useProjectStore(s => s.editEngineering);
  const editApplication = useProjectStore(s => s.editApplication);
  const removeProject = useProjectStore(s => s.removeProject);
  const removeEngineering = useProjectStore(s => s.removeEngineering);
  const removeApplication = useProjectStore(s => s.removeApplication);
  const loadProjects = useProjectStore(s => s.loadProjects);
  const loadEngineerings = useProjectStore(s => s.loadEngineerings);
  const loadApplications = useProjectStore(s => s.loadApplications);
  const reorderServers = useServerStore(s => s.reorderServers);

  // Add/Edit child dialog state
  const [childDialog, setChildDialog] = useState<{
    open: boolean;
    title: string;
    label: string;
    initialName?: string;
    initialShortName?: string;
    onConfirm: (name: string, shortName?: string) => void;
  }>({ open: false, title: '', label: '', onConfirm: () => {} });

  // Add server dialog - triggers external onAdd with context
  const [addServerAppId, setAddServerAppId] = useState<string | null>(null);

  const handleAddEngineering = (projectId: string, _name?: string, _shortName?: string) => {
    setChildDialog({
      open: true,
      title: '新增工程',
      label: '工程名称',
      onConfirm: async (name, shortName) => {
        await addEngineering(projectId, name, shortName);
        await loadEngineerings();
        setExpandedProjects(prev => { const next = new Set(prev); next.add(projectId); return next; });
      },
    });
  };

  const handleEditEngineering = (eng: { id: string; name: string; shortName?: string }) => {
    setChildDialog({
      open: true,
      title: '修改工程',
      label: '工程名称',
      initialName: eng.name,
      initialShortName: eng.shortName,
      onConfirm: async (name, shortName) => {
        await editEngineering(eng.id, { name, shortName });
        await loadEngineerings();
      },
    });
  };

  const handleDeleteEngineering = async (engId: string) => {
    if (!confirm('确定删除此工程及其下所有应用和服务器？')) return;
    await removeEngineering(engId);
    await loadEngineerings();
    await loadApplications();
    await loadServers();
  };

  const handleAddApplication = (engineeringId: string, _name?: string, _shortName?: string) => {
    setChildDialog({
      open: true,
      title: '新增应用',
      label: '应用名称',
      onConfirm: async (name, shortName) => {
        await addApplication(engineeringId, name, shortName);
        await loadApplications();
        setExpandedEngineerings(prev => { const next = new Set(prev); next.add(engineeringId); return next; });
      },
    });
  };

  const handleEditApplication = (app: { id: string; name: string; shortName?: string }) => {
    setChildDialog({
      open: true,
      title: '修改应用',
      label: '应用名称',
      initialName: app.name,
      initialShortName: app.shortName,
      onConfirm: async (name, shortName) => {
        await editApplication(app.id, { name, shortName });
        await loadApplications();
      },
    });
  };

  const handleDeleteApplication = async (appId: string) => {
    if (!confirm('确定删除此应用及其下所有服务器？')) return;
    await removeApplication(appId);
    await loadApplications();
    await loadServers();
  };

  const handleEditProject = (proj: { id: string; name: string; shortName?: string }) => {
    setChildDialog({
      open: true,
      title: '修改项目',
      label: '项目名称',
      initialName: proj.name,
      initialShortName: proj.shortName,
      onConfirm: async (name, shortName) => {
        await editProject(proj.id, { name, shortName });
        await loadProjects();
      },
    });
  };

  const handleDeleteProject = async (projId: string) => {
    if (!confirm('确定删除此项目及其下所有工程、应用和服务器？')) return;
    await removeProject(projId);
    await loadProjects();
    await loadEngineerings();
    await loadApplications();
    await loadServers();
  };

  const handleAddServer = (applicationId: string) => {
    // Find the engineeringId and projectId for this application
    const app = applications.find(a => a.id === applicationId);
    const eng = app ? engineerings.find(e => e.id === app.engineeringId) : undefined;
    onAdd({
      projectId: eng?.projectId || '',
      engineeringId: app?.engineeringId || '',
      applicationId,
    });
  };

  const handleAddServerDirect = (context: string) => {
    // context could be projectId (from project level) or engineeringId (from eng level)
    // Try to find as projectId first
    const proj = projects.find(p => p.id === context);
    if (proj) {
      onAdd({ projectId: context });
      return;
    }
    const eng = engineerings.find(e => e.id === context);
    if (eng) {
      onAdd({ projectId: eng.projectId, engineeringId: context });
      return;
    }
    onAdd();
  };

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedEngineerings, setExpandedEngineerings] = useState<Set<string>>(new Set());
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());

  // Right-click context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    anchor: { top: number; left: number };
    items: ContextMenuItemDef[];
  } | null>(null);
  const handleCtxMenu = useCallback((e: React.MouseEvent, items: ContextMenuItemDef[]) => {
    setCtxMenu({ anchor: { top: e.clientY, left: e.clientX }, items });
  }, []);

  const keyword = searchFilter.keyword || '';

  // Search: auto-expand matching paths when keyword changes
  useEffect(() => {
    if (!keyword) {
      return;
    }

    const kw = keyword.toLowerCase();
    const projSet = new Set<string>();
    const engSet = new Set<string>();
    const appSet = new Set<string>();

    // Match servers by ALL relevant fields
    for (const s of servers) {
      const ipAddrs = [
        ...(s.ips || []).map(ip => `${ip.ip || ''} ${ip.mappedIp || ''} ${ip.type || ''}`),
        s.internalIp || '',
        s.externalIp || '',
        s.publicIp || '',
        s.crossNetworkIp || '',
      ].join(' ');
      const haystack = [
        s.name || '',
        ipAddrs,
        s.os || '',
        s.serverLocation || '',
        s.serverType || '',
        s.username || '',
        s.macAddress || '',
        s.vpnInfo || '',
        s.notes || '',
        s.deployedContent || '',
        (s.tags || []).join(' '),
        (s.credentials || []).map(c => c.username || '').join(' '),
        s.bastionHost || '',
        s.bastionUsername || '',
      ].join(' ').toLowerCase();
      if (haystack.includes(kw)) {
        if (s.applicationId) appSet.add(s.applicationId);
        if (s.engineeringId) engSet.add(s.engineeringId);
        if (s.projectId) projSet.add(s.projectId);
      }
    }

    // Match apps by name
    for (const a of applications) {
      if (a.name?.toLowerCase().includes(kw)) {
        appSet.add(a.id);
      }
    }

    // Propagate: app -> eng -> project
    for (const a of applications) {
      if (appSet.has(a.id)) {
        engSet.add(a.engineeringId);
      }
    }

    // Match engineerings by name
    for (const e of engineerings) {
      if (e.name?.toLowerCase().includes(kw)) {
        engSet.add(e.id);
      }
    }

    for (const e of engineerings) {
      if (engSet.has(e.id)) {
        projSet.add(e.projectId);
      }
    }

    // Match projects by name
    for (const p of projects) {
      if (p.name?.toLowerCase().includes(kw)) {
        projSet.add(p.id);
      }
    }

    setExpandedProjects(projSet);
    setExpandedEngineerings(engSet);
    setExpandedApps(appSet);
  }, [keyword, servers, projects, engineerings, applications]);

  const toggleExpanded = useCallback(
    (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
      setter(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  // Check if anything matches (for empty-state messages)
  const hasAnyContent =
    projects.length > 0 ||
    engineerings.length > 0 ||
    applications.length > 0 ||
    servers.length > 0;

  const hasMatch = useMemo(() => {
    if (!keyword) return true;
    const kw = keyword.toLowerCase();
    const dbInstMap = useServerStore.getState().dbInstances;
    const appInstMap = useServerStore.getState().appInstances;
    const apiInstMap = useServerStore.getState().apiInstances;
    const midInstMap = useServerStore.getState().midInstances;
    const connMap = useConnectionStore.getState().connections;
    const serverMatch = servers.some(s => serverMatches(s, kw, {
      dbInstances: dbInstMap[s.id] || [],
      appInstances: appInstMap[s.id] || [],
      apiInstances: apiInstMap[s.id] || [],
      midInstances: midInstMap[s.id] || [],
      linkedConnectionNames: Object.values(connMap).filter(c => c.serverId === s.id).map(c => c.name),
    }));
    return (
      serverMatch ||
      projects.some(p => p.name?.toLowerCase().includes(kw)) ||
      engineerings.some(e => e.name?.toLowerCase().includes(kw)) ||
      applications.some(a => a.name?.toLowerCase().includes(kw))
    );
  }, [keyword, servers, projects, engineerings, applications]);

  const sortedProjects = useMemo(() => sortByName(projects), [projects]);

  // Filter: when keyword is present, only show matching branches
  const filteredProjects = useMemo(() => {
    if (!keyword) return sortedProjects;
    const kw = keyword.toLowerCase();
    const matchProjectIds = new Set<string>();
    const matchEngIds = new Set<string>();
    const matchAppIds = new Set<string>();
    const _dbInstMap = useServerStore.getState().dbInstances;
    const _appInstMap = useServerStore.getState().appInstances;
    const _apiInstMap = useServerStore.getState().apiInstances;
    const _midInstMap = useServerStore.getState().midInstances;
    const _connMap = useConnectionStore.getState().connections;
    // Server matches -> propagate up
    for (const s of servers) {
      if (serverMatches(s, kw, {
        dbInstances: _dbInstMap[s.id] || [],
        appInstances: _appInstMap[s.id] || [],
        apiInstances: _apiInstMap[s.id] || [],
        midInstances: _midInstMap[s.id] || [],
        linkedConnectionNames: Object.values(_connMap).filter(c => c.serverId === s.id).map(c => c.name),
      })) {
        if (s.applicationId) matchAppIds.add(s.applicationId);
        if (s.engineeringId) matchEngIds.add(s.engineeringId);
        if (s.projectId) matchProjectIds.add(s.projectId);
      }
    }
    // App matches by name
    for (const a of applications) {
      if (a.name?.toLowerCase().includes(kw)) {
        matchAppIds.add(a.id);
        matchEngIds.add(a.engineeringId);
      }
    }
    // Eng matches by name
    for (const e of engineerings) {
      if (e.name?.toLowerCase().includes(kw)) {
        matchEngIds.add(e.id);
        matchProjectIds.add(e.projectId);
      }
    }
    // App -> eng -> project propagation
    for (const a of applications) {
      if (matchAppIds.has(a.id)) matchEngIds.add(a.engineeringId);
    }
    for (const e of engineerings) {
      if (matchEngIds.has(e.id)) matchProjectIds.add(e.projectId);
    }
    // Project matches by name
    for (const p of projects) {
      if (p.name?.toLowerCase().includes(kw)) matchProjectIds.add(p.id);
    }
    return sortedProjects.filter(p => matchProjectIds.has(p.id));
  }, [keyword, sortedProjects, servers, projects, engineerings, applications]);

  return (
    <Box
      sx={{
        width,
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.default',
      }}
    >
      <ServerSearchBar filter={searchFilter} onChange={setSearchFilter} onImport={onImport} />

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {!hasAnyContent ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              暂无服务器记录
            </Typography>
          </Box>
        ) : !hasMatch ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              无匹配结果
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {filteredProjects.map(project => (
            <ProjectNode
              key={project.id}
              project={project}
              expanded={expandedProjects.has(project.id)}
              onToggle={() => toggleExpanded(setExpandedProjects, project.id)}
              engineerings={engineerings}
              expandedEngineerings={expandedEngineerings}
              onToggleEngineering={id => toggleExpanded(setExpandedEngineerings, id)}
              applications={applications}
              expandedApps={expandedApps}
              onToggleApp={id => toggleExpanded(setExpandedApps, id)}
              servers={servers}
              selectedId={selectedId}
              onSelectServer={selectServer}
              keyword={keyword}
              reorderServers={reorderServers}
              onAddEngineering={handleAddEngineering}
              onAddApplication={handleAddApplication}
              onAddServer={handleAddServer}
              onAddServerDirect={handleAddServerDirect}
              onEditProject={handleEditProject}
              onDeleteProject={handleDeleteProject}
              onEditEngineering={handleEditEngineering}
              onDeleteEngineering={handleDeleteEngineering}
              onEditApplication={handleEditApplication}
              onDeleteApplication={handleDeleteApplication}
              onCtxMenu={handleCtxMenu}
            />
          ))}
          </List>
        )}

        {/* 添加项目按钮 - 始终可见（放在树列表底部，参考数据库树） */}
        <Box sx={{ px: 1, pt: 0.5, pb: 0.5 }}>
          <Button
            variant="text"
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            onClick={() => {
              // 新增一级项目节点（不是新增服务器）
              setChildDialog({
                open: true,
                title: '新增项目',
                label: '项目名称',
                onConfirm: async (name, shortName) => {
                  await addProject(name, shortName);
                },
              });
            }}
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
      </Box>

      <AddChildDialog
        open={childDialog.open}
        title={childDialog.title}
        label={childDialog.label}
        initialName={childDialog.initialName}
        initialShortName={childDialog.initialShortName}
        onClose={() => setChildDialog(prev => ({ ...prev, open: false }))}
        onConfirm={childDialog.onConfirm}
      />
      <ContextMenu
        anchorPosition={ctxMenu ? ctxMenu.anchor : null}
        onClose={() => setCtxMenu(null)}
        items={ctxMenu?.items || []}
      />
    </Box>
  );
};

export default ServerListPanel;
