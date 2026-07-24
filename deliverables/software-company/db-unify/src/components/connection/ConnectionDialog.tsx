import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  Box,
  Chip,
  Typography,
  Snackbar,
  Alert,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  Paper,
  InputAdornment,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import LanIcon from '@mui/icons-material/Lan';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import SearchIcon from '@mui/icons-material/Search';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DriveFileMoveIcon from '@mui/icons-material/DriveFileMove';
import SaveAltIcon from '@mui/icons-material/SaveAlt';
import LinkIcon from '@mui/icons-material/Link';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeStore } from '../../stores/treeStore';
import {
  duplicateConnection as apiDuplicateConnection,
  testConnection as apiTestConnection,
} from '../../services/connectionApiService';
import { ConnectionStatus } from '../../types/connection';
import { TreeNodeType } from '../../types/tree';
import type { DbConnection } from '../../types/connection';
import ConnectionForm from './ConnectionForm';
import type { TreePathInfo } from './ConnectionForm';
import BulkImportDialog from './BulkImportDialog';
import DriverManager from '../driver/DriverManager';
import ContextMenu from '../common/ContextMenu';
import type { ContextMenuItemDef } from '../common/ContextMenu';

interface ConnectionDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 表格列定义 */
type SortKey = 'name' | 'driver' | 'host' | 'port' | 'database' | 'username' | 'status' | 'created_at';
type SortOrder = 'asc' | 'desc';

interface ColumnDef {
  key: SortKey;
  label: string;
  /** 列宽（可选） */
  width?: number | string;
  /** 是否右对齐（数字列） */
  align?: 'left' | 'right' | 'center';
}

const COLUMNS: ColumnDef[] = [
  { key: 'name', label: '名称', width: 200 },
  { key: 'driver', label: '驱动', width: 110 },
  { key: 'host', label: '主机', width: 160 },
  { key: 'port', label: '端口', width: 70, align: 'right' },
  { key: 'database', label: '数据库', width: 140 },
  { key: 'username', label: '用户名', width: 120 },
  { key: 'status', label: '状态', width: 80 },
  { key: 'created_at', label: '创建时间', width: 150 },
];

const ConnectionDialog: React.FC<ConnectionDialogProps> = ({ open, onClose }) => {
  const connections = useConnectionStore((s) => s.connections);
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const addConnection = useConnectionStore((s) => s.addConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const addHospitalNode = useTreeStore((s) => s.addHospitalNode);
  const loadTree = useTreeStore((s) => s.loadTree);
  const moveHospitalToParent = useTreeStore((s) => s.moveHospitalToParent);
  const treeNodes = useTreeStore((s) => s.nodes);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [driverDialogOpen, setDriverDialogOpen] = useState(false);
  const [snackMsg, setSnackMsg] = useState('');
  const [snackSeverity, setSnackSeverity] = useState<'success' | 'error' | 'info'>('success');

  /** 批量选择 */
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** 最近单击的行（用于 shift 多选） */
  const lastClickedRef = useRef<string | null>(null);

  /** 筛选/搜索/排序状态 */
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ConnectionStatus>('all');
  const [driverFilter, setDriverFilter] = useState<string>('all');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');

  /** 右键菜单状态 */
  const [ctxMenu, setCtxMenu] = useState<{ pos: { left: number; top: number }; rowId: string } | null>(null);

  // 每次打开对话框时同步最新连接列表 + 拉取树数据（用于"移动到树节点"子菜单）
  useEffect(() => {
    if (open) {
      loadConnections();
      loadTree();
      setSelectedIds(new Set());
      setCtxMenu(null);
    }
  }, [open, loadConnections, loadTree]);

  /** 弹出临时提示 */
  const notify = (msg: string, severity: 'success' | 'error' | 'info' = 'success') => {
    setSnackSeverity(severity);
    setSnackMsg(msg);
  };

  /** 所有连接的可用驱动列表（用于驱动筛选下拉框） */
  const driverOptions = useMemo(() => {
    const set = new Set<string>();
    Object.values(connections).forEach((c) => set.add(c.driver));
    return Array.from(set).sort();
  }, [connections]);

  /** 应用搜索 + 状态 + 驱动筛选 */
  const filtered = useMemo(() => {
    const kw = searchText.trim().toLowerCase();
    return Object.values(connections).filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (driverFilter !== 'all' && c.driver !== driverFilter) return false;
      if (!kw) return true;
      return (
        c.name.toLowerCase().includes(kw) ||
        c.host.toLowerCase().includes(kw) ||
        (c.database || '').toLowerCase().includes(kw) ||
        (c.username || '').toLowerCase().includes(kw)
      );
    });
  }, [connections, searchText, statusFilter, driverFilter]);

  /** 应用排序 */
  const rows = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let av: any;
      let bv: any;
      switch (sortKey) {
        case 'port':
          av = a.port;
          bv = b.port;
          break;
        case 'created_at':
          av = (a as any).created_at || '';
          bv = (b as any).created_at || '';
          break;
        default:
          av = ((a as any)[sortKey] ?? '').toString().toLowerCase();
          bv = ((b as any)[sortKey] ?? '').toString().toLowerCase();
      }
      if (av < bv) return sortOrder === 'asc' ? -1 : 1;
      if (av > bv) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [filtered, sortKey, sortOrder]);

  const handleRequestSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder(key === 'created_at' ? 'desc' : 'asc');
    }
  };

  const handleAdd = () => {
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (id: string) => {
    setEditingId(id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    await deleteConnection(id);
    await loadTree();
    notify('已删除连接');
  };

  /** 复制连接：调用后端 duplicate 端点 */
  const handleDuplicate = async (id: string) => {
    try {
      const created = await apiDuplicateConnection(id);
      await loadConnections();
      notify(`已创建副本："${created.name}"`);
    } catch (err: any) {
      notify(`复制失败：${err?.message || '未知错误'}`, 'error');
    }
  };

  /** 测试单个连接 */
  const handleTest = async (id: string) => {
    const conn = connections[id];
    if (!conn) return;
    notify(`正在测试 "${conn.name}"...`, 'info');
    try {
      const res = await apiTestConnection(id);
      await loadConnections();
      if (res?.success === false) {
        notify(`"${conn.name}" 测试失败：${res.error || '未知'}`, 'error');
      } else {
        notify(`"${conn.name}" 连接正常`);
      }
    } catch (err: any) {
      notify(`测试失败：${err?.message || '未知错误'}`, 'error');
    }
  };

  /** 批量测试 */
  const handleBatchTest = async () => {
    if (selectedIds.size === 0) return;
    notify(`正在测试 ${selectedIds.size} 个连接...`, 'info');
    let ok = 0;
    let fail = 0;
    for (const id of selectedIds) {
      try {
        const res = await apiTestConnection(id);
        if (res?.success === false) fail++;
        else ok++;
      } catch {
        fail++;
      }
    }
    await loadConnections();
    notify(`批量测试完成：成功 ${ok}，失败 ${fail}`, fail > 0 ? 'error' : 'success');
  };

  /** 复制连接字符串到剪贴板 */
  const handleCopyConnStr = async (id: string) => {
    const c = connections[id];
    if (!c) return;
    // 生成常见 URI 格式（不含密码，避免泄露）
    let uri = '';
    switch (c.driver) {
      case 'postgresql':
      case 'highgo':
        uri = `postgresql://${c.username}@${c.host}:${c.port}/${c.database || ''}`;
        break;
      case 'mysql':
      case 'mariadb':
        uri = `mysql://${c.username}@${c.host}:${c.port}/${c.database || ''}`;
        break;
      case 'sqlserver':
        uri = `sqlserver://${c.username}@${c.host}:${c.port};database=${c.database || ''}`;
        break;
      case 'oracle':
        uri = `oracle://${c.username}@${c.host}:${c.port}/${c.database || ''}`;
        break;
      default:
        uri = `${c.driver}://${c.username}@${c.host}:${c.port}/${c.database || ''}`;
    }
    try {
      await navigator.clipboard.writeText(uri);
      notify('连接字符串已复制到剪贴板');
    } catch {
      notify('复制到剪贴板失败', 'error');
    }
  };

  /** 导出选中项为 JSON */
  const handleExportJson = (ids: string[]) => {
    const list = ids.map((id) => connections[id]).filter(Boolean);
    if (list.length === 0) return;
    // 剔除敏感字段
    const sanitized = list.map((c) => ({
      name: c.name,
      driver: c.driver,
      host: c.host,
      port: c.port,
      username: c.username,
      database: c.database,
      schema: c.schema,
      customDriverId: c.customDriverId,
    }));
    const blob = new Blob([JSON.stringify(sanitized, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `connections-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    notify(`已导出 ${list.length} 个连接`);
  };

  /** 移动连接到指定树节点（District 层） */
  const handleMoveToNode = async (connId: string, districtId: string) => {
    const conn = connections[connId];
    if (!conn) return;
    // 查找已有的 Hospital 节点（其 dbConnectionId 指向该连接）
    const existingHospital = Object.values(treeNodes).find(
      (n) => n.type === TreeNodeType.Hospital && n.dbConnectionId === connId,
    );
    try {
      if (existingHospital) {
        // 移动现有 hospital 到新 District 下（追加到末尾）
        const targetDistrict = treeNodes[districtId];
        if (!targetDistrict) return;
        const newChildrenIds = [...targetDistrict.childrenIds, existingHospital.id];
        await moveHospitalToParent(existingHospital.id, districtId, newChildrenIds);
      } else {
        // 未在树中的连接：在目标节点下创建 Hospital 节点
        await addHospitalNode(districtId, conn.name, connId);
      }
      await loadTree();
      notify(`已移动 "${conn.name}" 到目标节点`);
    } catch (err: any) {
      notify(`移动失败：${err?.message || '未知错误'}`, 'error');
    }
  };

  /** 单击行：处理选择（含 Ctrl/Shift 多选） */
  const handleRowClick = (e: React.MouseEvent, id: string) => {
    if (e.shiftKey && lastClickedRef.current) {
      // Shift 多选：从上次点击到当前的连续区间
      const idx1 = rows.findIndex((r) => r.id === lastClickedRef.current);
      const idx2 = rows.findIndex((r) => r.id === id);
      if (idx1 >= 0 && idx2 >= 0) {
        const [a, b] = idx1 < idx2 ? [idx1, idx2] : [idx2, idx1];
        const next = new Set(selectedIds);
        for (let i = a; i <= b; i++) next.add(rows[i].id);
        setSelectedIds(next);
        return;
      }
    }
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd 切换
      const next = new Set(selectedIds);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      setSelectedIds(next);
    } else {
      // 普通单击：仅选中当前行
      setSelectedIds(new Set([id]));
    }
    lastClickedRef.current = id;
  };

  /** 复选框切换 */
  const handleToggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    lastClickedRef.current = id;
  };

  /** 全选/取消全选 */
  const handleToggleAll = () => {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((c) => c.id)));
    }
  };

  /** 双击 = 编辑 */
  const handleRowDoubleClick = (id: string) => {
    handleEdit(id);
  };

  /** 批量删除选中项 */
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedIds.size} 个连接？`)) return;
    for (const id of selectedIds) {
      await deleteConnection(id);
    }
    await loadTree();
    const n = selectedIds.size;
    setSelectedIds(new Set());
    notify(`已删除 ${n} 个连接`);
  };

  const handleSave = (data: Omit<DbConnection, 'id'>) => {
    if (editingId) {
      updateConnection(editingId, data);
    } else {
      addConnection(data);
    }
    setShowForm(false);
    setEditingId(null);
  };

  /** 保存连接并在树中创建 Hospital 节点 */
  const handleSaveWithTree = async (data: Omit<DbConnection, 'id'>, treePath: TreePathInfo) => {
    try {
      const connectionId = await addConnection(data);
      if (!connectionId) throw new Error('创建连接失败');
      if (treePath.districtId) {
        await addHospitalNode(treePath.districtId, treePath.hospitalName, connectionId);
        loadTree();
      }
      notify('连接已创建并关联到树节点');
    } catch (err: any) {
      notify(`保存失败: ${err.message || '未知错误'}`, 'error');
    }
    setShowForm(false);
    setEditingId(null);
  };

  const getStatusColor = (status: ConnectionStatus) => {
    switch (status) {
      case ConnectionStatus.Online:
        return 'success';
      case ConnectionStatus.Offline:
        return 'default';
      case ConnectionStatus.Error:
        return 'error';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: ConnectionStatus) => {
    switch (status) {
      case ConnectionStatus.Online:
        return '在线';
      case ConnectionStatus.Offline:
        return '离线';
      case ConnectionStatus.Error:
        return '异常';
      default:
        return '未知';
    }
  };

  /** 格式化创建时间为紧凑显示 */
  const formatDate = (iso?: string) => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return iso;
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch {
      return iso;
    }
  };

  /** 构建"移动到树节点"子菜单：显示 平台 > 业务模块 > 区域 的路径列表 */
  const moveToNodeSubItems = useMemo<ContextMenuItemDef[]>(() => {
    // 收集所有 District 节点，展示带父级路径的名称
    const districts: Array<{ id: string; path: string }> = [];
    Object.values(treeNodes).forEach((n) => {
      if (n.type !== TreeNodeType.District) return;
      const names: string[] = [n.name];
      let cur = n.parentId ? treeNodes[n.parentId] : null;
      while (cur) {
        names.unshift(cur.name);
        cur = cur.parentId ? treeNodes[cur.parentId] : null;
      }
      districts.push({ id: n.id, path: names.join(' / ') });
    });
    districts.sort((a, b) => a.path.localeCompare(b.path));
    return districts;
  }, [treeNodes]);

  /** 打开右键菜单 */
  const handleContextMenu = (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    // 若右键的行未被选中，则视作单选该行
    if (!selectedIds.has(id)) {
      setSelectedIds(new Set([id]));
      lastClickedRef.current = id;
    }
    setCtxMenu({ pos: { left: e.clientX, top: e.clientY }, rowId: id });
  };

  /** 构建右键菜单项 */
  const buildContextMenuItems = (): ContextMenuItemDef[] => {
    if (!ctxMenu) return [];
    const targetId = ctxMenu.rowId;
    const multi = selectedIds.size > 1 && selectedIds.has(targetId);
    const selectedArr = Array.from(selectedIds);

    const items: ContextMenuItemDef[] = [
      {
        label: '编辑',
        icon: <EditIcon />,
        onClick: () => handleEdit(targetId),
        disabled: multi,
      },
      {
        label: '复制（创建副本）',
        icon: <ContentCopyIcon />,
        onClick: () => handleDuplicate(targetId),
        disabled: multi,
      },
      {
        label: '测试连接',
        icon: <PlayArrowIcon />,
        onClick: () => handleTest(targetId),
        disabled: multi,
      },
      {
        label: '复制连接字符串',
        icon: <LinkIcon />,
        onClick: () => handleCopyConnStr(targetId),
        disabled: multi,
      },
      {
        label: '移动到树节点',
        icon: <DriveFileMoveIcon />,
        disabled: multi || moveToNodeSubItems.length === 0,
        children:
          moveToNodeSubItems.length > 0
            ? moveToNodeSubItems.map((it) => ({
                label: it.path,
                onClick: () => handleMoveToNode(targetId, it.id),
              }))
            : [{ label: '(无可用节点)', disabled: true }],
      },
      {
        label: '导出为 JSON',
        icon: <SaveAltIcon />,
        onClick: () => handleExportJson(multi ? selectedArr : [targetId]),
        divider: true,
      },
      {
        label: '删除',
        icon: <DeleteIcon />,
        danger: true,
        onClick: () => handleDelete(targetId),
        disabled: multi,
      },
    ];

    // 批量操作项：仅在多选时显示
    if (multi) {
      items.push({
        label: `批量测试选中 (${selectedIds.size})`,
        icon: <PlayArrowIcon />,
        onClick: handleBatchTest,
        divider: true,
      });
      items.push({
        label: `批量删除选中 (${selectedIds.size})`,
        icon: <DeleteSweepIcon />,
        danger: true,
        onClick: handleBatchDelete,
      });
    }

    return items;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth={false}
      fullWidth
      PaperProps={{
        sx: {
          maxWidth: 1200,
          maxHeight: '85vh',
          height: '85vh',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          py: 1,
          px: 2,
          fontSize: '0.95rem',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LanIcon color="primary" fontSize="small" />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            数据库连接管理
          </Typography>
          <Chip
            label={`${rows.length} / ${Object.keys(connections).length}`}
            size="small"
            variant="outlined"
            sx={{ fontSize: '0.7rem', height: 20 }}
          />
        </Box>
      </DialogTitle>

      {/* 工具栏 */}
      {!showForm && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            borderBottom: '1px solid',
            borderColor: 'divider',
            flexWrap: 'wrap',
          }}
        >
          {/* 搜索框 */}
          <TextField
            size="small"
            placeholder="搜索名称/主机/数据库/用户名"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon sx={{ fontSize: 16 }} />
                </InputAdornment>
              ),
              sx: { fontSize: '0.8rem', height: 30 },
            }}
            sx={{ width: 240 }}
          />

          {/* 状态筛选 */}
          <FormControl size="small" sx={{ minWidth: 100 }}>
            <InputLabel sx={{ fontSize: '0.75rem' }}>状态</InputLabel>
            <Select
              label="状态"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              sx={{ fontSize: '0.8rem', height: 30 }}
            >
              <MenuItem value="all" sx={{ fontSize: '0.8rem' }}>全部</MenuItem>
              <MenuItem value={ConnectionStatus.Online} sx={{ fontSize: '0.8rem' }}>在线</MenuItem>
              <MenuItem value={ConnectionStatus.Offline} sx={{ fontSize: '0.8rem' }}>离线</MenuItem>
              <MenuItem value={ConnectionStatus.Error} sx={{ fontSize: '0.8rem' }}>异常</MenuItem>
            </Select>
          </FormControl>

          {/* 驱动筛选 */}
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel sx={{ fontSize: '0.75rem' }}>驱动</InputLabel>
            <Select
              label="驱动"
              value={driverFilter}
              onChange={(e) => setDriverFilter(e.target.value)}
              sx={{ fontSize: '0.8rem', height: 30 }}
            >
              <MenuItem value="all" sx={{ fontSize: '0.8rem' }}>全部</MenuItem>
              {driverOptions.map((d) => (
                <MenuItem key={d} value={d} sx={{ fontSize: '0.8rem' }}>
                  {d.toUpperCase()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box sx={{ flex: 1 }} />

          {/* 右侧操作按钮 */}
          <Button
            size="small"
            startIcon={<SettingsInputComponentIcon />}
            onClick={() => setDriverDialogOpen(true)}
            variant="outlined"
            color="inherit"
            sx={{ textTransform: 'none', fontSize: '0.75rem', height: 30 }}
          >
            驱动管理
          </Button>
          <Button
            size="small"
            startIcon={<UploadFileIcon />}
            onClick={() => setBulkImportOpen(true)}
            variant="outlined"
            sx={{ textTransform: 'none', fontSize: '0.75rem', height: 30 }}
          >
            批量导入
          </Button>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={handleAdd}
            variant="contained"
            sx={{ textTransform: 'none', fontSize: '0.75rem', height: 30 }}
          >
            添加连接
          </Button>
        </Box>
      )}

      <DialogContent dividers sx={{ p: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {showForm ? (
          <Box sx={{ p: 2, maxWidth: 460, mx: 'auto', width: '100%' }}>
            <ConnectionForm
              key={editingId || 'new'}
              connection={editingId ? connections[editingId] : undefined}
              onSave={handleSave}
              onSaveWithTree={handleSaveWithTree}
              showTreePath={false}
              onCancel={() => {
                setShowForm(false);
                setEditingId(null);
              }}
            />
          </Box>
        ) : (
          <TableContainer component={Paper} elevation={0} sx={{ flex: 1, overflow: 'auto' }}>
            <Table stickyHeader size="small" sx={{ tableLayout: 'fixed' }}>
              <TableHead>
                <TableRow
                  sx={{
                    '& .MuiTableCell-head': {
                      bgcolor: 'action.hover',
                      fontWeight: 600,
                      fontSize: '0.75rem',
                      py: 0.75,
                      lineHeight: 1.2,
                      whiteSpace: 'nowrap',
                    },
                  }}
                >
                  <TableCell padding="checkbox" sx={{ width: 40 }}>
                    <Checkbox
                      size="small"
                      checked={rows.length > 0 && selectedIds.size === rows.length}
                      indeterminate={selectedIds.size > 0 && selectedIds.size < rows.length}
                      onChange={handleToggleAll}
                    />
                  </TableCell>
                  {COLUMNS.map((col) => (
                    <TableCell
                      key={col.key}
                      sx={{ width: col.width }}
                      align={col.align || 'left'}
                      sortDirection={sortKey === col.key ? sortOrder : false}
                    >
                      <TableSortLabel
                        active={sortKey === col.key}
                        direction={sortKey === col.key ? sortOrder : 'asc'}
                        onClick={() => handleRequestSort(col.key)}
                        sx={{ fontSize: '0.75rem' }}
                      >
                        {col.label}
                      </TableSortLabel>
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((conn) => {
                  const isSelected = selectedIds.has(conn.id);
                  return (
                    <TableRow
                      key={conn.id}
                      hover
                      selected={isSelected}
                      onClick={(e) => handleRowClick(e, conn.id)}
                      onDoubleClick={() => handleRowDoubleClick(conn.id)}
                      onContextMenu={(e) => handleContextMenu(e, conn.id)}
                      sx={{
                        cursor: 'pointer',
                        '& .MuiTableCell-body': {
                          fontSize: '0.78rem',
                          py: 0.5,
                          lineHeight: 1.3,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        },
                      }}
                    >
                      <TableCell padding="checkbox" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          size="small"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(conn.id)}
                        />
                      </TableCell>
                      <TableCell title={conn.name}>{conn.name}</TableCell>
                      <TableCell>
                        <Chip
                          label={conn.driver.toUpperCase()}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: '0.68rem', height: 18 }}
                        />
                      </TableCell>
                      <TableCell title={conn.host}>{conn.host}</TableCell>
                      <TableCell align="right">{conn.port}</TableCell>
                      <TableCell title={conn.database}>{conn.database}</TableCell>
                      <TableCell title={conn.username}>{conn.username}</TableCell>
                      <TableCell>
                        <Chip
                          label={getStatusLabel(conn.status)}
                          size="small"
                          color={getStatusColor(conn.status) as any}
                          sx={{ fontSize: '0.68rem', height: 18 }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: 'text.secondary' }}>
                        {formatDate((conn as any).created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={COLUMNS.length + 1} align="center" sx={{ py: 4, color: 'text.disabled' }}>
                      {Object.keys(connections).length === 0 ? '暂无连接' : '未匹配到任何连接'}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1, justifyContent: 'space-between' }}>
        <Typography variant="caption" color="text.secondary">
          {selectedIds.size > 0 ? `已选中 ${selectedIds.size} 项 · 右键查看操作` : '提示：右键行显示操作菜单，双击行编辑'}
        </Typography>
        <Button onClick={onClose} sx={{ textTransform: 'none' }} size="small">
          关闭
        </Button>
      </DialogActions>

      {/* 右键菜单 */}
      <ContextMenu
        anchorPosition={ctxMenu?.pos ?? null}
        onClose={() => setCtxMenu(null)}
        items={ctxMenu ? buildContextMenuItems() : []}
      />

      {/* 批量导入对话框 */}
      <BulkImportDialog open={bulkImportOpen} onClose={() => setBulkImportOpen(false)} />

      {/* 驱动管理对话框 */}
      <DriverManager open={driverDialogOpen} onClose={() => setDriverDialogOpen(false)} />

      {/* 操作反馈 */}
      <Snackbar
        open={!!snackMsg}
        autoHideDuration={3000}
        onClose={() => setSnackMsg('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackSeverity} sx={{ width: '100%' }} onClose={() => setSnackMsg('')}>
          {snackMsg}
        </Alert>
      </Snackbar>
    </Dialog>
  );
};

export default ConnectionDialog;
