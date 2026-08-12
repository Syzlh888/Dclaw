import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Box, Button, Chip, Typography,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, ToggleButton, ToggleButtonGroup, Stack,
} from '@mui/material';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import RefreshIcon from '@mui/icons-material/Refresh';
import { fetchConnections } from '../../services/connectionApiService';
import { apiFetch } from '../../services/apiClient';
import { useTreeStore } from '../../stores/treeStore';
import { TreeNodeType } from '../../types/tree';
import type { DbConnection } from '../../types/connection';
import { DbDriver } from '../../types/connection';

interface DbInspectionDialogProps {
  open: boolean;
  onClose: () => void;
}

/** 单个连接的巡检状态 */
type InspectStatus = 'pending' | 'checking' | 'online' | 'error';

interface InspectItem {
  id: string;
  name: string;
  driver: string;
  host: string;
  port: number;
  status: InspectStatus;
  error?: string;
}

type FilterMode = 'all' | 'online' | 'error';

/** 并发巡检上限，避免一次打满后端 */
const CONCURRENCY = 5;
/** 单个连接测试超时时间（毫秒） */
const TEST_TIMEOUT_MS = 15000;

/**
 * 数据库巡检弹窗
 * ------------------------------------------------------------------
 * - 打开时自动拉取所有连接 /api/connections
 * - 并发（≤5）逐个调用 POST /api/connections/:id/test
 * - 实时进度：已检查 X/Y 个连接
 * - 顶部统计：总 / 在线 / 异常
 * - 表格按"异常置顶"展示，支持全部/在线/异常筛选
 * - 支持「重新巡检」按钮；巡检中按钮禁用
 */
const DbInspectionDialog: React.FC<DbInspectionDialogProps> = ({ open, onClose }) => {
  const [items, setItems] = useState<InspectItem[]>([]);
  const [done, setDone] = useState(0);
  const [inspecting, setInspecting] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const cancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  /** 把驱动枚举归一化为可读标签 */
  const driverLabel = useCallback((d: string) => {
    const map: Record<string, string> = {
      [DbDriver.MySQL]: 'MySQL',
      [DbDriver.PostgreSQL]: 'PostgreSQL',
      [DbDriver.Oracle]: 'Oracle',
      [DbDriver.SQLServer]: 'SQLServer',
      [DbDriver.MariaDB]: 'MariaDB',
      [DbDriver.SQLite]: 'SQLite',
      [DbDriver.HighGo]: 'HighGo',
      [DbDriver.Kingbase]: 'Kingbase',
      [DbDriver.Dameng]: 'Dameng',
      [DbDriver.DB2]: 'DB2',
      [DbDriver.H2]: 'H2',
      [DbDriver.Custom]: 'Custom',
    };
    return map[d] || d || '-';
  }, []);

  /** 测试单个连接；返回 { ok, error } */
  const testOne = useCallback(async (id: string): Promise<{ ok: boolean; error?: string }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
    try {
      const resp = await apiFetch(`/api/connections/${id}/test`, {
        method: 'POST',
        signal: controller.signal,
      });
      // 接口约定：成功返回 {success:true}；失败返回 500 + {success:false, error}
      // 也兼容 404 (连接不存在) 等情况
      if (resp.ok) {
        const data = await resp.json().catch(() => ({}));
        if (data && data.success === false) {
          return { ok: false, error: data.error || '连接失败' };
        }
        return { ok: true };
      }
      // 非 2xx：尝试解析错误信息
      let errMsg = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        if (data?.error) errMsg = data.error;
        else if (data?.message) errMsg = data.message;
      } catch { /* 忽略解析失败 */ }
      return { ok: false, error: errMsg };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { ok: false, error: `连接超时（>${TEST_TIMEOUT_MS / 1000}s）` };
      }
      return { ok: false, error: err?.message || '网络错误' };
    } finally {
      clearTimeout(timer);
    }
  }, []);

  /** 重新加载连接并启动巡检 */
  const start = useCallback(async () => {
    setError('');
    setInspecting(true);
    setDone(0);
    try {
      // 只巡检「左侧菜单树」上挂载的医院连接（与菜单一致），而不是全部连接
      const allList = (await fetchConnections()) as DbConnection[];
      if (!allList || allList.length === 0) {
        setItems([]);
        setInspecting(false);
        return;
      }
      // 从 treeStore 收集所有 Hospital 节点的 dbConnectionId
      const treeNodes = useTreeStore.getState().nodes;
      const treeConnIds = new Set<string>();
      for (const n of Object.values(treeNodes)) {
        if (n.type === TreeNodeType.Hospital && n.dbConnectionId) {
          treeConnIds.add(n.dbConnectionId);
        }
      }
      // 用树上的连接 ID 过滤全部连接；若树还没加载则退回全部
      const list = treeConnIds.size > 0
        ? allList.filter((c) => treeConnIds.has(c.id))
        : allList;
      const initial: InspectItem[] = list.map((c) => ({
        id: c.id,
        name: c.name,
        driver: String(c.driver),
        host: c.host,
        port: c.port,
        status: 'checking',
      }));
      setItems(initial);
      // 跳过 setInspecting(true) 重置，直接进入 runInspection
      cancelRef.current.cancelled = false;
      // 并发巡检
      const queue = initial.map((it) => it.id);
      const total = queue.length;
      let completed = 0;
      const worker = async () => {
        while (queue.length > 0) {
          if (cancelRef.current.cancelled) return;
          const id = queue.shift();
          if (!id) return;
          const result = await testOne(id);
          if (cancelRef.current.cancelled) return;
          setItems((prev) =>
            prev.map((it) =>
              it.id === id
                ? result.ok
                  ? { ...it, status: 'online', error: undefined }
                  : { ...it, status: 'error', error: result.error }
                : it
            )
          );
          completed += 1;
          setDone(completed);
        }
      };
      const workers: Promise<void>[] = [];
      const pool = Math.min(CONCURRENCY, queue.length);
      for (let i = 0; i < pool; i++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      void total;
    } catch (err: any) {
      setError(err?.message || '加载连接列表失败');
    } finally {
      setInspecting(false);
    }
  }, [testOne]);

  /** 弹窗打开时自动启动巡检 */
  useEffect(() => {
    if (!open) {
      // 关闭时清理
      cancelRef.current.cancelled = true;
      return;
    }
    cancelRef.current.cancelled = false;
    setItems([]);
    setDone(0);
    setError('');
    setFilter('all');
    void start();
    return () => {
      cancelRef.current.cancelled = true;
    };
  }, [open, start]);

  // 主动取消时调用
  const handleClose = useCallback(() => {
    cancelRef.current.cancelled = true;
    onClose();
  }, [onClose]);

  // 统计
  const total = items.length;
  const onlineCount = items.filter((it) => it.status === 'online').length;
  const errorCount = items.filter((it) => it.status === 'error').length;
  const checkingCount = items.filter((it) => it.status === 'checking').length;

  // 排序 + 筛选：异常置顶
  const viewList = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      // 异常优先
      if (a.status === 'error' && b.status !== 'error') return -1;
      if (b.status === 'error' && a.status !== 'error') return 1;
      // 其次按名称
      return a.name.localeCompare(b.name);
    });
    if (filter === 'online') return sorted.filter((it) => it.status === 'online');
    if (filter === 'error') return sorted.filter((it) => it.status === 'error');
    return sorted;
  }, [items, filter]);

  /** 状态单元格渲染 */
  const renderStatus = (it: InspectItem) => {
    if (it.status === 'checking') {
      return (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <HourglassEmptyIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))', color: 'text.secondary' }} />
          <Typography sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
            检测中
          </Typography>
        </Stack>
      );
    }
    if (it.status === 'online') {
      return (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <CheckCircleIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))', color: 'success.main' }} />
          <Typography sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', color: 'success.main' }}>
            在线
          </Typography>
        </Stack>
      );
    }
    if (it.status === 'error') {
      return (
        <Stack direction="row" alignItems="center" spacing={0.5}>
          <ErrorOutlineIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))', color: 'error.main' }} />
          <Typography sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', color: 'error.main' }}>
            异常
          </Typography>
        </Stack>
      );
    }
    return <Typography sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', color: 'text.secondary' }}>-</Typography>;
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      keepMounted={false}
    >
      <DialogTitle
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          fontSize: 'calc(0.92rem * var(--dc-scale, 1))', fontWeight: 600, py: 1,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', color: 'primary.main' }}>
          <HealthAndSafetyIcon sx={{ fontSize: 'calc(1.1rem * var(--dc-scale, 1))' }} />
        </Box>
        数据库巡检
      </DialogTitle>

      <DialogContent dividers sx={{ px: 2, py: 1.5 }}>
        {/* 统计 + 进度 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <Chip
            label={`总 ${total}`}
            size="small"
            variant="outlined"
            sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', height: 22 }}
          />
          <Chip
            icon={<CheckCircleIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />}
            label={`在线 ${onlineCount}`}
            size="small"
            color={onlineCount > 0 ? 'success' : 'default'}
            variant="outlined"
            sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', height: 22 }}
          />
          <Chip
            icon={<ErrorOutlineIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />}
            label={`异常 ${errorCount}`}
            size="small"
            color={errorCount > 0 ? 'error' : 'default'}
            variant="outlined"
            sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', height: 22 }}
          />
          <Box sx={{ flex: 1 }} />
          <Typography
            sx={{
              fontSize: 'calc(0.7rem * var(--dc-scale, 1))',
              color: inspecting ? 'text.secondary' : 'text.disabled',
            }}
          >
            {total > 0 ? `已检查 ${done}/${total}` : '正在加载连接...'}
          </Typography>
          <ToggleButtonGroup
            value={filter}
            exclusive
            size="small"
            onChange={(_, v) => v && setFilter(v as FilterMode)}
            sx={{
              '& .MuiToggleButton-root': {
                fontSize: 'calc(0.68rem * var(--dc-scale, 1))',
                py: 0.25, px: 1, textTransform: 'none',
              },
            }}
          >
            <ToggleButton value="all">全部</ToggleButton>
            <ToggleButton value="online">在线</ToggleButton>
            <ToggleButton value="error">异常</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {(inspecting || checkingCount > 0) && total > 0 && (
          <LinearProgress
            variant="determinate"
            value={total > 0 ? (done / total) * 100 : 0}
            sx={{ mb: 1.5, height: 4, borderRadius: 1 }}
          />
        )}

        {error && (
          <Typography
            sx={{
              fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
              color: 'error.main', mb: 1.5,
            }}
          >
            {error}
          </Typography>
        )}

        {/* 结果表 */}
        {total === 0 && !inspecting && !error ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
              当前没有可巡检的连接
            </Typography>
          </Box>
        ) : viewList.length === 0 && total > 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
              {filter === 'error' ? '没有异常连接' : '没有在线连接'}
            </Typography>
          </Box>
        ) : (
          <TableContainer sx={{ maxHeight: 420 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: 'calc(0.72rem * var(--dc-scale, 1))', fontWeight: 600, py: 0.75, bgcolor: 'background.paper' }}>
                    名称
                  </TableCell>
                  <TableCell sx={{ fontSize: 'calc(0.72rem * var(--dc-scale, 1))', fontWeight: 600, py: 0.75, bgcolor: 'background.paper' }}>
                    驱动
                  </TableCell>
                  <TableCell sx={{ fontSize: 'calc(0.72rem * var(--dc-scale, 1))', fontWeight: 600, py: 0.75, bgcolor: 'background.paper' }}>
                    主机:端口
                  </TableCell>
                  <TableCell sx={{ fontSize: 'calc(0.72rem * var(--dc-scale, 1))', fontWeight: 600, py: 0.75, bgcolor: 'background.paper' }}>
                    状态
                  </TableCell>
                  <TableCell sx={{ fontSize: 'calc(0.72rem * var(--dc-scale, 1))', fontWeight: 600, py: 0.75, bgcolor: 'background.paper' }}>
                    错误信息
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {viewList.map((it) => (
                  <TableRow
                    key={it.id}
                    sx={{
                      bgcolor: it.status === 'error' ? 'rgba(239, 83, 80, 0.06)' : 'transparent',
                      '&:hover': {
                        bgcolor: it.status === 'error' ? 'rgba(239, 83, 80, 0.10)' : 'action.hover',
                      },
                    }}
                  >
                    <TableCell
                      sx={{
                        fontSize: 'calc(0.72rem * var(--dc-scale, 1))',
                        py: 0.5,
                        color: it.status === 'error' ? 'error.main' : 'text.primary',
                        fontWeight: it.status === 'error' ? 600 : 400,
                      }}
                    >
                      {it.name || '-'}
                    </TableCell>
                    <TableCell sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', py: 0.5 }}>
                      <Chip
                        label={driverLabel(it.driver)}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: 'calc(0.62rem * var(--dc-scale, 1))', height: 18 }}
                      />
                    </TableCell>
                    <TableCell
                      sx={{
                        fontSize: 'calc(0.7rem * var(--dc-scale, 1))',
                        py: 0.5, fontFamily: 'monospace',
                        color: 'text.secondary',
                      }}
                    >
                      {it.host}:{it.port}
                    </TableCell>
                    <TableCell sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', py: 0.5 }}>
                      {renderStatus(it)}
                    </TableCell>
                    <TableCell
                      sx={{
                        fontSize: 'calc(0.7rem * var(--dc-scale, 1))',
                        py: 0.5,
                        color: it.status === 'error' ? 'error.main' : 'text.secondary',
                        maxWidth: 240,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={it.error}
                    >
                      {it.error || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1, gap: 0.5 }}>
        <Button
          variant="outlined"
          size="small"
          onClick={() => void start()}
          disabled={inspecting}
          startIcon={<RefreshIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />}
          sx={{ textTransform: 'none', fontSize: 'calc(0.72rem * var(--dc-scale, 1))' }}
        >
          重新巡检
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          onClick={handleClose}
          disabled={inspecting}
          sx={{ textTransform: 'none', fontSize: 'calc(0.72rem * var(--dc-scale, 1))' }}
        >
          {inspecting ? '巡检中...' : '关闭'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DbInspectionDialog;
