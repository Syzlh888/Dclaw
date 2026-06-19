import React, { useState, useCallback, useRef } from 'react';
import { Box, Checkbox, Typography, Tooltip, IconButton, Collapse } from '@mui/material';
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
import SchemaIcon from '@mui/icons-material/Schema';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { TreeNodeType, CheckState } from '../../types/tree';
import type { TreeNode } from '../../types/tree';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeStore } from '../../stores/treeStore';
import { ConnectionStatus } from '../../types/connection';
import { getCheckCount } from '../../utils/treeUtils';
import MetadataBrowser from './MetadataBrowser';

interface TreeNodeComponentProps {
  node: TreeNode;
  nodes: Record<string, TreeNode>;
  onToggleCheck: (nodeId: string) => void;
  onToggleExpand: (nodeId: string) => void;
  /** Callback when the ➕ add-connection button is clicked on a District node */
  onAddConnection?: (nodeId: string, nodeName: string) => void;
  /** Callback when add-child button is clicked */
  onAddChild?: (nodeId: string) => void;
  /** Callback when edit button is clicked */
  onEditNode?: (nodeId: string) => void;
  /** Callback when delete button is clicked */
  onDeleteNode?: (nodeId: string) => void;
  /** Callback when copy button is clicked (for Hospital nodes) */
  onCopyNode?: (nodeId: string) => void;
  /** Callback when a node is reordered (dragged & dropped) over this node */
  onReorder?: (dragId: string, dropId: string, position: 'before' | 'after') => void;
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
  const [dragOverPos, setDragOverPos] = useState<'before' | 'after' | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const dragEnterCountRef = useRef(0);
  const connections = useConnectionStore((s) => s.connections);
  const connection = node.dbConnectionId ? connections[node.dbConnectionId] : undefined;
  const isHospital = node.type === TreeNodeType.Hospital;

  const level = getLevel(node, nodes);
  const indentPx = level * 20;

  const getIcon = () => {
    switch (node.type) {
      case TreeNodeType.Platform:
        return <StorageIcon sx={{ fontSize: 18, color: 'primary.main' }} />;
      case TreeNodeType.PreDbType:
        return node.expanded ? (
          <FolderOpenIcon sx={{ fontSize: 18, color: '#FFA726' }} />
        ) : (
          <FolderIcon sx={{ fontSize: 18, color: '#FFA726' }} />
        );
      case TreeNodeType.District:
        return node.expanded ? (
          <FolderOpenIcon sx={{ fontSize: 18, color: '#66BB6A' }} />
        ) : (
          <FolderIcon sx={{ fontSize: 18, color: '#66BB6A' }} />
        );
      case TreeNodeType.Hospital:
        return <LocalHospitalIcon sx={{ fontSize: 18, color: '#EF5350' }} />;
      default:
        return <FolderIcon sx={{ fontSize: 18 }} />;
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
        ? `${node.name} (${connection.username})`
        : node.name;

    if (node.highlightText) {
      const idx = displayName.toLowerCase().indexOf(node.highlightText.toLowerCase());
      if (idx >= 0) {
        const before = displayName.substring(0, idx);
        const match = displayName.substring(idx, idx + node.highlightText.length);
        const after = displayName.substring(idx + node.highlightText.length);
        return (
          <Typography variant="body2" sx={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
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
      <Typography variant="body2" sx={{ fontSize: '0.7rem', whiteSpace: 'nowrap' }}>
        {displayName}
      </Typography>
    );
  };

  /** Determine which action buttons to show for this node level */
  const canAdd = node.type !== TreeNodeType.Hospital;
  const canEdit = true;
  const canDelete = true;
  const canCopy = node.type === TreeNodeType.Hospital;

  // ---- 拖拽排序 ----
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

  /** 根据鼠标 Y 坐标判断放置位置 */
  const updateDragPosition = useCallback((clientY: number) => {
    if (rowRef.current) {
      const rect = rowRef.current.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      setDragOverPos(clientY < midY ? 'before' : 'after');
    }
  }, []);

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
          py: 0.25,
          pl: `${indentPx}px`,
          pr: 1,
          '&:hover': { bgcolor: 'action.hover' },
          cursor: 'pointer',
          userSelect: 'none',
          transition: 'opacity 0.15s',
          position: 'relative',
          minWidth: 'max-content',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
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
                <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              ) : (
                <ExpandLessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
              )
            ) : node.expanded ? (
              <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
            ) : (
              <ExpandLessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
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
            <FiberManualRecordIcon sx={{ fontSize: 10, color: statusColor, ml: 0.5 }} />
          </Tooltip>
        )}

        {/* Metadata toggle button - Hospital nodes */}
        {isHospital && connection && (
          <Tooltip title={showMetadata ? '收起表结构' : '浏览表结构'}>
            <IconButton
              size="small"
              sx={{ p: 0.25, ml: 0.25 }}
              onClick={(e) => {
                e.stopPropagation();
                setShowMetadata(!showMetadata);
              }}
            >
              <SchemaIcon sx={{ fontSize: 14, color: showMetadata ? 'primary.main' : 'text.disabled' }} />
            </IconButton>
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
            <DragIndicatorIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
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
                sx={{ p: 0.25 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onAddChild(node.id);
                }}
              >
                <AddIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          {canEdit && onEditNode && (
            <Tooltip title="修改">
              <IconButton
                size="small"
                sx={{ p: 0.25 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onEditNode(node.id);
                }}
              >
                <EditIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          {canCopy && onCopyNode && (
            <Tooltip title="复制连接配置">
              <IconButton
                size="small"
                sx={{ p: 0.25 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onCopyNode(node.id);
                }}
              >
                <ContentCopyIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          )}
          {canDelete && onDeleteNode && (
            <Tooltip title="删除">
              <IconButton
                size="small"
                sx={{ p: 0.25 }}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteNode(node.id);
                }}
              >
                <DeleteIcon sx={{ fontSize: 14 }} />
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
          <MetadataBrowser connection={connection} />
        </Collapse>
      )}
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
