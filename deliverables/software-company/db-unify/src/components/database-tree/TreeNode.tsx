import React, { useState, useCallback, useRef } from 'react';
import { Box, Checkbox, Typography, Tooltip, IconButton, Collapse, Snackbar, Menu, MenuItem, ListItemIcon, ListItemText } from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import StorageIcon from '@mui/icons-material/Storage';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import CableIcon from '@mui/icons-material/Cable';
import RefreshIcon from '@mui/icons-material/Refresh';
import WifiTetheringIcon from '@mui/icons-material/WifiTethering';
import BorderColorIcon from '@mui/icons-material/BorderColor';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import SyncIcon from '@mui/icons-material/Sync';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { TreeNodeType, CheckState } from '../../types/tree';
import type { TreeNode } from '../../types/tree';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeStore } from '../../stores/treeStore';
import { ConnectionStatus } from '../../types/connection';
import { getCheckCount } from '../../utils/treeUtils';
import { apiFetch } from '../../services/apiClient';
import { fetchMetadata } from '../../services/metadataService';
import ContextMenu from '../common/ContextMenu';
import type { ContextMenuItemDef } from '../common/ContextMenu';
import MetadataBrowser from './MetadataBrowser';
import { ConnectionIcon } from './DbIcons';

interface TreeNodeComponentProps {
  node: TreeNode;
  nodes: Record<string, TreeNode>;
  onToggleCheck: (nodeId: string) => void;
  onToggleExpand: (nodeId: string) => void;
  /** Callback when the ➕ add-connection button is clicked on a District node */
  onAddConnection?: (nodeId: string, nodeName: string) => void;
  /** Callback when add-child button is clicked. kind='folder' 新增子分组, kind='connection' 新增连接 */
  onAddChild?: (nodeId: string, kind: 'folder' | 'connection') => void;
  /** Callback when edit button is clicked */
  onEditNode?: (nodeId: string) => void;
  /** Callback when delete button is clicked */
  onDeleteNode?: (nodeId: string) => void;
  /** Callback when copy button is clicked (for Hospital nodes) */
  onCopyNode?: (nodeId: string) => void;
  /** Callback when a node is reordered (dragged & dropped) over this node */
  onReorder?: (dragId: string, dropId: string, position: 'before' | 'after' | 'inside') => void;
}

const TreeNodeComponent: React.FC<TreeNodeComponentProps> = ({
  node,
  nodes,
  onToggleCheck,
  onToggleExpand,
  onAddConnection,
  onAddChild,
  onEditNode,
  onDeleteNode,
  onCopyNode,
  onReorder,
}) => {
  const [hovered, setHovered] = useState(false);
  const [showMetadata, setShowMetadata] = useState(false);
  const [dragOverPos, setDragOverPos] = useState<'before' | 'after' | 'inside' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const dragEnterCountRef = useRef(0);
  const connections = useConnectionStore((s) => s.connections);
  const connection = node.dbConnectionId ? connections[node.dbConnectionId] : undefined;
  const isHospital = node.type === TreeNodeType.Hospital;

  // ─── 右键菜单状态 ───
  const [ctxAnchor, setCtxAnchor] = useState<{ left: number; top: number } | null>(null);
  const [snackOpen, setSnackOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');

  // ─── "新增" 下拉菜单锚点（非 Hospital 节点） ───
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);

  const level = getLevel(node, nodes);
  const indentPx = level * 12;

  const getIcon = () => {
    switch (node.type) {
      case TreeNodeType.Platform:
        return <StorageIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', color: '#4DB8E6' }} />; // DBeaver 数据蓝
      case TreeNodeType.PreDbType:
        return node.expanded ? (
          <FolderOpenIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', color: '#DAAA4E' }} /> // DBeaver 金色
        ) : (
          <FolderIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', color: '#DAAA4E' }} /> // DBeaver 金色
        );
      case TreeNodeType.District:
        return node.expanded ? (
          <FolderOpenIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', color: '#6BBF5A' }} /> // DBeaver 柔和绿
        ) : (
          <FolderIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))', color: '#6BBF5A' }} /> // DBeaver 柔和绿
        );
      case TreeNodeType.Hospital:
        // 数据库连接图标：DBeaver 风格三层堆叠柱体（蓝色）
        return <ConnectionIcon size={14} />;
      default:
        return <FolderIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} />;
    }
  };

  const checkCount =
    node.type !== TreeNodeType.Hospital ? getCheckCount(node.id, nodes) : null;

  const getStatusColor = () => {
    if (!connection) return undefined;
    switch (connection.status) {
      case ConnectionStatus.Online:
        return '#4CAF50';
      case ConnectionStatus.Offline:
        return '#9E9E9E';
      case ConnectionStatus.Error:
        return '#F44336';
      default:
        return undefined;
    }
  };
  const statusColor = getStatusColor();

  const renderName = () => {
    // 实例节点（第3/4层）在名称后追加用户名
    const displayName =
      isHospital && connection
        ? `${node.name} (${connection.schema || connection.username})`
        : node.name;

    if (node.highlightText) {
      const idx = displayName.toLowerCase().indexOf(node.highlightText.toLowerCase());
      if (idx >= 0) {
        const before = displayName.substring(0, idx);
        const match = displayName.substring(idx, idx + node.highlightText.length);
        const after = displayName.substring(idx + node.highlightText.length);
        return (
          <Typography variant="body2" sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))', whiteSpace: 'nowrap' }}>
            {before}
            <Box component="span" sx={{ bgcolor: 'warning.light', borderRadius: 0.5, px: 0.25 }}>
              {match}
            </Box>
            {after}
          </Typography>
        );
      }
    }
    return (
      <Typography variant="body2" sx={{ fontSize: 'calc(0.66rem * var(--dc-scale, 1))', whiteSpace: 'nowrap' }}>
        {displayName}
      </Typography>
    );
  };

  /** Determine which action buttons to show for this node level */
  const canAdd = node.type !== TreeNodeType.Hospital;
  const canEdit = true;
  const canDelete = true;
  const canCopy = node.type === TreeNodeType.Hospital;

  // ─── 右键菜单处理 ───
  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // 只对连接节点（Hospital）显示右键菜单
      if (!isHospital) return;
      setCtxAnchor({ left: e.clientX, top: e.clientY });
    },
    [isHospital],
  );

  const handleCloseContextMenu = useCallback(() => {
    setCtxAnchor(null);
  }, []);

  /** 测试连接 */
  const handleTestConnection = useCallback(async () => {
    if (!connection) return;
    try {
      const resp = await apiFetch(`/api/connections/${connection.id}/test`, {
        method: 'POST',
      });
      if (resp.ok) {
        useConnectionStore.getState().updateConnection(connection.id, {
          status: ConnectionStatus.Online,
        } as any);
        setSnackMsg(`连接 "${connection.name}" 测试成功`);
      } else {
        useConnectionStore.getState().updateConnection(connection.id, {
          status: ConnectionStatus.Error,
        } as any);
        setSnackMsg(`连接 "${connection.name}" 测试失败`);
      }
    } catch {
      useConnectionStore.getState().updateConnection(connection.id, {
        status: ConnectionStatus.Offline,
      } as any);
      setSnackMsg(`连接 "${connection.name}" 测试失败（网络错误）`);
    }
    setSnackOpen(true);
  }, [connection]);

  /** 复制连接信息到剪贴板 */
  const handleCopyConnectionInfo = useCallback(() => {
    if (!connection) return;
    const text = `${connection.host}:${connection.port}/${connection.database}`;
    navigator.clipboard.writeText(text).then(
      () => {
        setSnackMsg(`已复制: ${text}`);
        setSnackOpen(true);
      },
      () => {
        setSnackMsg('复制失败');
        setSnackOpen(true);
      },
    );
  }, [connection]);

  /** 刷新元数据（重新加载后刷新 MetadataBrowser） */
  const handleRefreshMetadata = useCallback(async () => {
    if (!connection) return;
    try {
      await fetchMetadata(connection.id, connection.schema);
      setSnackMsg(`元数据已刷新`);
      setSnackOpen(true);
      // 触发元数据重新显示（强制更新）
      setShowMetadata(false);
      setTimeout(() => setShowMetadata(true), 0);
    } catch (err: any) {
      setSnackMsg(`刷新元数据失败: ${err.message}`);
      setSnackOpen(true);
    }
  }, [connection]);

  // ─── 构建 Hospital 右键菜单项 ───
  const hospitalCtxItems: ContextMenuItemDef[] = [
    {
      label: '测试连接',
      icon: <WifiTetheringIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />,
      onClick: handleTestConnection,
    },
    {
      label: '编辑连接',
      icon: <BorderColorIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />,
      onClick: () => onEditNode?.(node.id),
    },
    {
      label: '复制连接（创建副本）',
      icon: <ContentPasteIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />,
      onClick: () => onCopyNode?.(node.id),
    },
    {
      label: '复制连接信息到剪贴板',
      icon: <ContentPasteIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />,
      onClick: handleCopyConnectionInfo,
    },
    {
      label: '刷新元数据',
      icon: <SyncIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />,
      onClick: handleRefreshMetadata,
    },
    {
      label: '删除连接',
      icon: <DeleteOutlineIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />,
      onClick: () => onDeleteNode?.(node.id),
      danger: true,
      divider: true,
    },
  ];

  // ─── 拖拽排序 ───
  const handleDragStart = useCallback((e: React.DragEvent) => {
    e.dataTransfer.setData('text/plain', node.id);
    e.dataTransfer.effectAllowed = 'move';
    setIsDragging(true);
    requestAnimationFrame(() => {
      if (rowRef.current) {
        rowRef.current.style.opacity = '0.4';
      }
    });
  }, [node.id]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragOverPos(null);
    dragEnterCountRef.current = 0;
    if (rowRef.current) {
      rowRef.current.style.opacity = '1';
    }
  }, []);

  /** 根据鼠标 Y 坐标判断放置位置：上 1/4 → before, 下 1/4 → after, 中间 1/2 → inside(仅非 Hospital) */
  const updateDragPosition = useCallback((clientY: number) => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      const relY = clientY - rect.top;
      const h = rect.height;
      if (!isHospital && relY > h * 0.25 && relY < h * 0.75) {
        // 中间区域 → 放入该节点内部（作为其新的子节点）
        setDragOverPos('inside');
      } else if (relY < h / 2) {
        setDragOverPos('before');
      } else {
        setDragOverPos('after');
      }
    }
  }, [isHospital]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragEnterCountRef.current += 1;
    updateDragPosition(e.clientY);
  }, [updateDragPosition]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    updateDragPosition(e.clientY);
  }, [updateDragPosition]);

  const handleDragLeave = useCallback(() => {
    dragEnterCountRef.current -= 1;
    if (dragEnterCountRef.current <= 0) {
      dragEnterCountRef.current = 0;
      setDragOverPos(null);
    }
  }, []);

  // 用 ref 保存最新的 dragOverPos，避免 drop 时闭包拿到旧值
  const dragOverPosRef = useRef(dragOverPos);
  dragOverPosRef.current = dragOverPos;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const dragId = e.dataTransfer.getData('text/plain');
    const position = dragOverPosRef.current;
    setDragOverPos(null);
    dragEnterCountRef.current = 0;
    setIsDragging(false);
    if (rowRef.current) {
      rowRef.current.style.opacity = '1';
    }
    if (dragId && dragId !== node.id && position && onReorder) {
      onReorder(dragId, node.id, position);
    }
  }, [node.id, onReorder]);

  return (
    <>
      {/* 拖拽放置指示线 - 上方 */}
      {dragOverPos === 'before' && (
        <Box sx={{ height: 2, bgcolor: 'primary.main', mx: 1, borderRadius: 1 }} />
      )}
      <Box
        ref={rowRef}
        draggable={!!onReorder}
        onDragStart={onReorder ? handleDragStart : undefined}
        onDragEnd={onReorder ? handleDragEnd : undefined}
        onDragEnter={onReorder ? handleDragEnter : undefined}
        onDragOver={onReorder ? handleDragOver : undefined}
        onDragLeave={onReorder ? handleDragLeave : undefined}
        onDrop={onReorder ? handleDrop : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          py: 0.1,
          minHeight: 20,
          pl: `${indentPx}px`,
          pr: 0.75,
          '&:hover': { bgcolor: 'action.hover' },
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'opacity 0.15s, background-color 0.1s',
          position: 'relative',
          minWidth: 'max-content',
          // 拖拽到中间时高亮整行（表示"放入该节点内"）
          ...(dragOverPos === 'inside' && {
            bgcolor: 'primary.main',
            color: 'common.white',
            outline: '1px dashed #06b6d4',
            outlineOffset: '-1px',
          }),
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onContextMenu={handleContextMenu}
      >
        {node.childrenIds.length > 0 || isHospital ? (
          <Box
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mr: 0.25 }}
            onClick={(e) => {
              e.stopPropagation();
              if (isHospital) {
                setShowMetadata(!showMetadata);
              } else {
                onToggleExpand(node.id);
              }
            }}
          >
            {isHospital ? (
              showMetadata ? (
                <ExpandMoreIcon sx={{ fontSize: 'calc(0.9rem * var(--dc-scale, 1))', color: 'text.secondary' }} />
              ) : (
                <ExpandLessIcon sx={{ fontSize: 'calc(0.9rem * var(--dc-scale, 1))', color: 'text.secondary' }} />
              )
            ) : node.expanded ? (
              <ExpandMoreIcon sx={{ fontSize: 'calc(0.9rem * var(--dc-scale, 1))', color: 'text.secondary' }} />
            ) : (
              <ExpandLessIcon sx={{ fontSize: 'calc(0.9rem * var(--dc-scale, 1))', color: 'text.secondary' }} />
            )}
          </Box>
        ) : (
          <Box sx={{ width: 18, mr: 0.25 }} />
        )}

        <Checkbox
          size="small"
          checked={node.checkState === CheckState.Checked}
          indeterminate={node.checkState === CheckState.Indeterminate}
          onChange={() => onToggleCheck(node.id)}
          sx={{ py: 0.25, px: 0.5 }}
        />

        <Box sx={{ mr: 0.5, display: 'flex', alignItems: 'center' }}>{getIcon()}</Box>

        <Box
          sx={{ flex: 1, minWidth: 0 }}
          onClick={() => {
            if (node.childrenIds.length > 0) onToggleExpand(node.id);
          }}
        >
          {renderName()}
        </Box>

        {checkCount && checkCount.total > 0 && (
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 0.5, flexShrink: 0 }}>
            ({checkCount.checked}/{checkCount.total})
          </Typography>
        )}

        {statusColor && (
          <Tooltip
            title={
              connection!.status === ConnectionStatus.Online
                ? '在线'
                : connection!.status === ConnectionStatus.Offline
                ? '离线'
                : '异常'
            }
          >
            <FiberManualRecordIcon sx={{ fontSize: 'calc(0.55rem * var(--dc-scale, 1))', color: statusColor, ml: 0.5 }} />
          </Tooltip>
        )}

        {/* Drag handle - visible on hover for reordering */}
        {onReorder && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              opacity: hovered ? 1 : 0,
              transition: 'opacity 0.15s',
              mr: 0.25,
              cursor: 'grab',
              '&:active': { cursor: 'grabbing' },
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <DragIndicatorIcon sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))', color: 'text.disabled' }} />
          </Box>
        )}

        {/* Action buttons - visible on hover */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.25,
            ml: 0.5,
            opacity: hovered ? 1 : 0,
            transition: 'opacity 0.15s',
          }}
        >
          {canAdd && onAddChild && (
            <Tooltip title="新增">
              <IconButton
                size="small"
                sx={{ p: 0.2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  setAddMenuAnchor(e.currentTarget);
                }}
              >
                <AddIcon sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </Tooltip>
          )}
          {canEdit && onEditNode && (
            <Tooltip title="修改">
              <IconButton
                size="small"
                sx={{ p: 0.2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditNode(node.id);
                }}
              >
                <EditIcon sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </Tooltip>
          )}
          {canCopy && onCopyNode && (
            <Tooltip title="复制连接配置">
              <IconButton
                size="small"
                sx={{ p: 0.2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyNode(node.id);
                }}
              >
                <ContentCopyIcon sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </Tooltip>
          )}
          {canDelete && onDeleteNode && (
            <Tooltip title="删除">
              <IconButton
                size="small"
                sx={{ p: 0.2 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteNode(node.id);
                }}
              >
                <DeleteIcon sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
      </Box>
      {/* 拖拽放置指示线 - 下方 */}
      {dragOverPos === 'after' && (
        <Box sx={{ height: 2, bgcolor: 'primary.main', mx: 1, borderRadius: 1 }} />
      )}

      {/* Metadata browser - below hospital nodes */}
      {isHospital && connection && showMetadata && (
        <Collapse in={showMetadata} timeout="auto">
          <MetadataBrowser connection={connection} baseIndentPx={indentPx + 20} />
        </Collapse>
      )}

      {/* ─── "新增" 下拉菜单（非 Hospital 节点） ─── */}
      <Menu
        anchorEl={addMenuAnchor}
        open={Boolean(addMenuAnchor)}
        onClose={() => setAddMenuAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        MenuListProps={{ dense: true, sx: { py: 0.25 } }}
        slotProps={{ paper: { sx: { minWidth: 140, borderRadius: 1 } } }}
      >
        <MenuItem
          onClick={() => {
            setAddMenuAnchor(null);
            onAddChild?.(node.id, 'folder');
          }}
          sx={{ minHeight: 24, py: 0.25, fontSize: 'calc(0.68rem * var(--dc-scale, 1))' }}
        >
          <ListItemIcon sx={{ minWidth: 22 }}>
            <FolderIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))', color: '#DAAA4E' }} />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 'calc(0.68rem * var(--dc-scale, 1))' }}>新增分组</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAddMenuAnchor(null);
            onAddChild?.(node.id, 'connection');
          }}
          sx={{ minHeight: 24, py: 0.25, fontSize: 'calc(0.68rem * var(--dc-scale, 1))' }}
        >
          <ListItemIcon sx={{ minWidth: 22 }}>
            <ConnectionIcon size={12} />
          </ListItemIcon>
          <ListItemText primaryTypographyProps={{ fontSize: 'calc(0.68rem * var(--dc-scale, 1))' }}>新增连接</ListItemText>
        </MenuItem>
      </Menu>

      {/* ─── 右键菜单 ─── */}
      <ContextMenu
        anchorPosition={ctxAnchor}
        onClose={handleCloseContextMenu}
        items={hospitalCtxItems}
      />

      {/* ─── 操作反馈 Snackbar ─── */}
      <Snackbar
        open={snackOpen}
        autoHideDuration={2500}
        onClose={() => setSnackOpen(false)}
        message={snackMsg}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
};

function getLevel(node: TreeNode, nodes: Record<string, TreeNode>): number {
  let level = 0;
  let current = node;
  while (current.parentId) {
    level++;
    const parent = nodes[current.parentId];
    if (!parent) break;
    current = parent;
  }
  return level;
}

export default TreeNodeComponent;
