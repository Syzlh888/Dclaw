import React, { useState, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Collapse,
  Chip,
  Paper,
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ChevronRight as ChevronRightIcon,
  Folder as FolderIcon,
  Category as CategoryIcon,
  LocationOn as LocationIcon,
  CheckCircle as CheckedIcon,
} from '@mui/icons-material';
import { useTreeStore } from '../../stores/treeStore';
import { TreeNodeType } from '../../types/tree';

interface ParentNodeSelectorProps {
  open: boolean;
  onClose: () => void;
  onSelect: (parentNodeId: string) => void;
}

interface TreeNodeItemProps {
  nodeId: string;
  level: number;
  selectedId: string | null;
  onSelectNode: (nodeId: string) => void;
}

/** 递归渲染树节点，只展示到 District 层级 */
const TreeNodeItem: React.FC<TreeNodeItemProps> = ({ nodeId, level, selectedId, onSelectNode }) => {
  const nodes = useTreeStore((s) => s.nodes);
  const toggleExpand = useTreeStore((s) => s.toggleExpand);

  const node = nodes[nodeId];
  if (!node || !node.visible) return null;

  // 不展示 Hospital 节点
  if (node.type === TreeNodeType.Hospital) return null;

  const hasChildren = node.childrenIds && node.childrenIds.length > 0;
  const isSelected = selectedId === nodeId;
  const canSelect = node.type === TreeNodeType.District;

  // 图标选择
  const getIcon = () => {
    switch (node.type) {
      case TreeNodeType.Platform:
        return <FolderIcon fontSize="small" color="primary" />;
      case TreeNodeType.PreDbType:
        return <CategoryIcon fontSize="small" color="secondary" />;
      case TreeNodeType.District:
        return <LocationIcon fontSize="small" color="action" />;
      default:
        return null;
    }
  };

  const handleClick = () => {
    if (canSelect) {
      onSelectNode(nodeId);
    } else if (hasChildren) {
      toggleExpand(nodeId);
    }
  };

  const handleExpandClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleExpand(nodeId);
  };

  return (
    <>
      <ListItem
        sx={{
          pl: 2 + level * 2,
          cursor: canSelect ? 'pointer' : hasChildren ? 'pointer' : 'default',
          bgcolor: isSelected ? 'primary.light' : 'transparent',
          color: isSelected ? 'primary.contrastText' : 'inherit',
          borderRadius: 1,
          mb: 0.5,
          '&:hover': {
            bgcolor: isSelected ? 'primary.light' : 'action.hover',
          },
        }}
        onClick={handleClick}
      >
        {hasChildren && (
          <ListItemIcon
            sx={{ minWidth: 30, cursor: 'pointer' }}
            onClick={handleExpandClick}
          >
            {node.expanded ? (
              <ExpandMoreIcon fontSize="small" />
            ) : (
              <ChevronRightIcon fontSize="small" />
            )}
          </ListItemIcon>
        )}
        <ListItemIcon sx={{ minWidth: 36 }}>{getIcon()}</ListItemIcon>
        <ListItemText
          primary={
            <Typography variant="body2" sx={{ fontWeight: isSelected ? 600 : 400 }}>
              {node.name}
              {isSelected && (
                <CheckedIcon fontSize="small" sx={{ ml: 1, verticalAlign: 'middle', color: 'primary.main' }} />
              )}
            </Typography>
          }
        />
        {!canSelect && hasChildren && (
          <Chip label="展开" size="small" variant="outlined" sx={{ ml: 1, height: 20, fontSize: '0.7rem' }} />
        )}
      </ListItem>
      {hasChildren && (
        <Collapse in={node.expanded} timeout="auto" unmountOnExit>
          <List disablePadding>
            {node.childrenIds.map((childId) => (
              <TreeNodeItem
                key={childId}
                nodeId={childId}
                level={level + 1}
                selectedId={selectedId}
                onSelectNode={onSelectNode}
              />
            ))}
          </List>
        </Collapse>
      )}
    </>
  );
};

/**
 * 父节点选择对话框
 * 用于选择数据库实例同步到连接管理时的父节点位置
 */
const ParentNodeSelector: React.FC<ParentNodeSelectorProps> = ({ open, onClose, onSelect }) => {
  const nodes = useTreeStore((s) => s.nodes);
  const rootNodeIds = useTreeStore((s) => s.rootNodeIds);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // 获取选中节点的路径
  const getSelectedPath = useCallback(() => {
    if (!selectedId) return '';
    const path: string[] = [];
    let currentId: string | null = selectedId;
    while (currentId) {
      const node = nodes[currentId];
      if (node) {
        path.unshift(node.name);
        currentId = node.parentId;
      } else {
        break;
      }
    }
    return path.join(' > ');
  }, [selectedId, nodes]);

  const handleSelect = () => {
    if (selectedId) {
      onSelect(selectedId);
      handleClose();
    }
  };

  const handleClose = () => {
    setSelectedId(null);
    onClose();
  };

  const handleOpen = () => {
    // 对话框打开时自动展开到 District 层级
    const autoExpand = (nodeIds: string[]) => {
      nodeIds.forEach((id) => {
        const node = nodes[id];
        if (node && (node.type === TreeNodeType.Platform || node.type === TreeNodeType.PreDbType)) {
          if (!node.expanded) {
            useTreeStore.getState().toggleExpand(id);
          }
          if (node.childrenIds.length > 0) {
            autoExpand(node.childrenIds);
          }
        }
      });
    };
    autoExpand(rootNodeIds);
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      onRendered={handleOpen}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: { minHeight: 400 }
      }}
    >
      <DialogTitle>选择父节点</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          请选择一个区域节点（District）作为父节点，数据库实例将同步到该节点下。
        </Typography>
        <Paper
          variant="outlined"
          sx={{
            maxHeight: 300,
            overflow: 'auto',
            p: 1,
            bgcolor: 'grey.50',
          }}
        >
          <List disablePadding>
            {rootNodeIds.map((rootId) => (
              <TreeNodeItem
                key={rootId}
                nodeId={rootId}
                level={0}
                selectedId={selectedId}
                onSelectNode={setSelectedId}
              />
            ))}
          </List>
        </Paper>
        {selectedId && (
          <Box sx={{ mt: 2, p: 1, bgcolor: 'primary.50', borderRadius: 1 }}>
            <Typography variant="caption" color="text.secondary">
              已选节点：
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, color: 'primary.main' }}>
              {getSelectedPath()}
            </Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>取消</Button>
        <Button
          onClick={handleSelect}
          variant="contained"
          disabled={!selectedId}
        >
          确认
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default ParentNodeSelector;
