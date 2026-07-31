/**
 * 树形连接选择器（公共组件）
 *
 * 从 useTreeStore（左侧菜单树）+ useConnectionStore 读取数据，
 * 渲染「平台 → 县区 → 医院（连接）」的层级树，用户点选叶子后回调 onChange(connId)。
 *
 * 旧实现分散在 SyncPage / MappingWizardDialog / ExportStepTarget 三处（约 200 行重复），
 * 现统一收敛到该组件。
 */
import React, { useState, useCallback } from 'react';
import {
  Box,
  IconButton,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StorageIcon from '@mui/icons-material/Storage';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { useTreeStore } from '../../stores/treeStore';
import { useConnectionStore } from '../../stores/connectionStore';

export interface TreeConnectionSelectProps {
  /** 当前选中的 connectionId */
  value: string;
  /** 选中节点（叶子/医院层）时回调 */
  onChange: (id: string) => void;
  /** TextField label */
  label: string;
  /** 是否必填（仅影响 * 标记） */
  required?: boolean;
  /** 禁用控件 */
  disabled?: boolean;
  /** 是否在每个叶子项下显示所属 group key（调试/导出用，默认 false） */
  showGroup?: boolean;
}

export const TreeConnectionSelect: React.FC<TreeConnectionSelectProps> = ({
  value,
  onChange,
  label,
  required = false,
  disabled = false,
  showGroup = false,
}) => {
  const treeNodes = useTreeStore((s) => s.nodes);
  const treeRootIds = useTreeStore((s) => s.rootNodeIds);
  const connectionsMap = useConnectionStore((s) => s.connections);

  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () => new Set()
  );

  const currentConn = value ? connectionsMap[value] : null;
  const displayValue = currentConn
    ? `${currentConn.name} (${currentConn.host}:${currentConn.port})`
    : '';

  /** 搜索过滤：名字/IP 命中，或子节点命中 */
  const matchesSearch = useCallback(
    (nodeId: string): boolean => {
      if (!searchText) return true;
      const s = searchText.toLowerCase();
      const node = treeNodes[nodeId];
      if (!node) return false;
      if (node.dbConnectionId) {
        const conn = connectionsMap[node.dbConnectionId];
        if (
          conn &&
          (conn.name.toLowerCase().includes(s) ||
            (conn.host || '').toLowerCase().includes(s))
        ) {
          return true;
        }
      }
      if (node.name.toLowerCase().includes(s)) return true;
      if (node.childrenIds) {
        return node.childrenIds.some(matchesSearch);
      }
      return false;
    },
    [searchText, treeNodes, connectionsMap]
  );

  const toggleExpand = useCallback((nodeId: string) => {
    setExpandedGroups((prev) => {
      const ns = new Set(prev);
      if (ns.has(nodeId)) ns.delete(nodeId);
      else ns.add(nodeId);
      return ns;
    });
  }, []);

  const handleSelect = useCallback(
    (connId: string) => {
      onChange(connId);
      setOpen(false);
      setSearchText('');
    },
    [onChange]
  );

  const renderTree = (nodeId: string, depth: number): React.ReactNode => {
    if (!matchesSearch(nodeId)) return null;
    const node = treeNodes[nodeId];
    if (!node) return null;
    const isExpanded = expandedGroups.has(nodeId);
    const hasChildren = node.childrenIds && node.childrenIds.length > 0;

    // 叶子：医院（具体 connection）
    if (node.dbConnectionId) {
      const conn = connectionsMap[node.dbConnectionId];
      if (!conn) return null;
      const selected = value === conn.id;
      return (
        <Box
          key={nodeId}
          onClick={() => handleSelect(conn.id)}
          sx={{
            pl: 1.5 + depth * 1.2,
            pr: 2,
            py: 0.6,
            cursor: 'pointer',
            bgcolor: selected ? 'primary.dark' : 'transparent',
            color: selected ? 'common.white' : 'text.secondary',
            fontSize: 12.5,
            borderLeft: selected ? '3px solid' : '3px solid transparent',
            borderColor: selected ? 'primary.light' : 'transparent',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            transition: 'background-color 0.15s',
            '&:hover': { bgcolor: selected ? 'primary.dark' : 'action.hover' },
          }}
        >
          <StorageIcon
            sx={{ fontSize: 12, color: selected ? 'common.white' : 'success.main' }}
          />
          <span style={{ flex: 1 }}>{conn.name}</span>
          {showGroup && (
            <span style={{ fontSize: 10, color: selected ? '#BBDEFB' : '#777' }}>
              [{nodeId.split('::').pop()}]
            </span>
          )}
          <span
            style={{
              fontSize: 11,
              color: selected ? 'primary.light' : 'text.secondary',
            }}
          >
            {conn.host}:{conn.port}
          </span>
        </Box>
      );
    }

    // 中间节点：分组（可展开/折叠）
    return (
      <Box key={nodeId}>
        <Box
          onClick={() => hasChildren && toggleExpand(nodeId)}
          sx={{
            bgcolor: 'background.paper',
            color: depth === 0 ? 'common.white' : 'text.secondary',
            fontSize: depth === 0 ? 12.5 : 12,
            fontWeight: depth === 0 ? 700 : 500,
            lineHeight: '26px',
            pl: 0.75 + depth * 1.2,
            pr: 1,
            cursor: hasChildren ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            borderTop: depth === 0 ? '1px solid' : 'none',
            borderBottom: isExpanded ? '1px solid' : 'none',
            borderColor: 'divider',
            transition: 'background-color 0.15s',
            '&:hover': hasChildren ? { bgcolor: 'action.hover' } : {},
          }}
        >
          {hasChildren ? (
            <ChevronRightIcon
              sx={{
                fontSize: 14,
                color: 'text.secondary',
                transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                transition: 'transform 0.2s',
              }}
            />
          ) : (
            <FiberManualRecordIcon
              sx={{ fontSize: 5, color: 'text.disabled', ml: 0.4, mr: 0.4 }}
            />
          )}
          {node.name}
        </Box>
        {isExpanded && hasChildren && (
          <Box>{node.childrenIds.map((cid: string) => renderTree(cid, depth + 1))}</Box>
        )}
      </Box>
    );
  };

  const treeLoading = !treeNodes || Object.keys(treeNodes).length === 0;

  return (
    <Box sx={{ mb: 1.5, position: 'relative' }}>
      <TextField
        fullWidth
        size="small"
        required={required}
        disabled={disabled}
        label={label}
        value={displayValue}
        placeholder="点击选择..."
        onClick={() => {
          if (disabled) return;
          if (open) {
            setOpen(false);
          } else {
            setOpen(true);
            setSearchText('');
          }
        }}
        InputProps={{
          readOnly: true,
          endAdornment: (
            <ExpandMoreIcon
              fontSize="small"
              sx={{
                color: 'text.secondary',
                cursor: disabled ? 'default' : 'pointer',
                transform: open ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          ),
        }}
        sx={{
          bgcolor: 'background.paper',
          cursor: disabled ? 'default' : 'pointer',
          '& .MuiInputBase-root': { color: 'text.primary' },
        }}
        InputLabelProps={{ sx: { color: 'text.secondary' } }}
      />
      {open && (
        <Paper
          sx={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            mt: 0.5,
            maxHeight: 320,
            overflow: 'auto',
            bgcolor: 'background.paper',
            zIndex: 1300,
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          {/* 搜索框 */}
          <Box
            sx={{
              p: 1,
              borderBottom: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
            }}
          >
            <TextField
              size="small"
              fullWidth
              placeholder="搜索连接名称或 IP..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              autoFocus
              InputProps={{
                startAdornment: (
                  <SearchIcon fontSize="small" sx={{ color: 'text.secondary', mr: 0.5 }} />
                ),
                endAdornment: searchText ? (
                  <IconButton
                    size="small"
                    onClick={() => setSearchText('')}
                    sx={{ p: 0.25 }}
                  >
                    <CloseIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  </IconButton>
                ) : undefined,
              }}
              sx={{
                bgcolor: 'background.default',
                '& .MuiOutlinedInput-root': {
                  fontSize: 13,
                  '& fieldset': { borderColor: 'divider' },
                },
                '& input': { padding: '6px 4px', color: 'text.primary' },
                '& input::placeholder': { color: 'text.disabled', opacity: 1 },
              }}
            />
          </Box>
          {/* 树形节点 */}
          {treeLoading ? (
            <Typography
              sx={{ color: 'text.secondary', p: 2, fontSize: 12, textAlign: 'center' }}
            >
              树数据加载中…
            </Typography>
          ) : (
            treeRootIds.map((rid: string) => renderTree(rid, 0))
          )}
        </Paper>
      )}
    </Box>
  );
};

export default TreeConnectionSelect;
