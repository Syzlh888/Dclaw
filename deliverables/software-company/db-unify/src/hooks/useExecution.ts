import { useCallback, useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useExecutionStore } from '../stores/executionStore';
import { useTreeStore } from '../stores/treeStore';
import { useGroupStore } from '../stores/groupStore';
import { useResultStore } from '../stores/resultStore';
import { executeBatchSSE } from '../services/executionService';
import { isSelectStatement, canAppendLimit } from '../utils/sqlUtils';
import { ExecutionStatus } from '../types/execution';
import { DiffType } from '../types/result';
import type { QueryResult } from '../types/result';

/**
 * Hook that encapsulates the execution flow.
 * Uses SSE-based real database execution via backend API.
 * Supports both tree-based selection and group-based execution.
 */
export function useExecution() {
  const sql = useEditorStore((s) => s.sql);
  const selectedSql = useEditorStore((s) => s.selectedSql);
  const readOnlyMode = useEditorStore((s) => s.readOnlyMode);
  const isExecuting = useEditorStore((s) => s.isExecuting);
  const setExecuting = useEditorStore((s) => s.setExecuting);
  const markTabExecuted = useEditorStore((s) => s.markTabExecuted);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const pageSize = useEditorStore((s) => s.pageSize);
  const loadingMore = useEditorStore((s) => s.loadingMore);
  const setLoadingMore = useEditorStore((s) => s.setLoadingMore);
  const updateResultMeta = useEditorStore((s) => s.updateResultMeta);
  const config = useExecutionStore((s) => s.config);
  const tabDbIds = useEditorStore((s) => s.tabDbIds);
  const activeGroupId = useGroupStore((s) => s.activeGroupId);
  const getActiveDbIds = useGroupStore((s) => s.getActiveDbIds);
  const cancelRef = useRef<(() => void) | null>(null);

  const getEffectiveDbIds = useCallback(() => {
    if (activeGroupId) return getActiveDbIds();
    // 使用当前标签页独立绑定的数据库列表
    const currentTabDbIds = tabDbIds[activeTabId] || [];
    return currentTabDbIds;
  }, [activeGroupId, getActiveDbIds, tabDbIds, activeTabId]);

  const collectConnectionInfos = useCallback(() => {
    const effectiveDbIds = getEffectiveDbIds();
    const nodes = useTreeStore.getState().nodes;
    return Object.values(nodes)
      .filter((n) => n.type === 'hospital' && n.dbConnectionId && effectiveDbIds.includes(n.dbConnectionId))
      .map((h) => {
        let current = h;
        let predbName = '';
        while (current.parentId) {
          const parent = nodes[current.parentId];
          if (!parent) break;
          if (parent.type === 'predb_type') {
            predbName = parent.name;
            break;
          }
          current = parent;
        }
        return {
          id: h.dbConnectionId!,
          hospitalName: h.name,
          preDbTypeName: predbName,
        };
      });
  }, [getEffectiveDbIds]);

  /**
   * 核心执行函数（首次执行或加载更多）
   * @param isLoadMore 是否为加载更多（追加模式）
   * @param loadMoreOffset 加载更多时的偏移量
   */
  const doExecute = useCallback(async (isLoadMore: boolean, loadMoreOffset: number) => {
    const activeSql = selectedSql || sql;
    const effectiveDbIds = getEffectiveDbIds();

    if (effectiveDbIds.length === 0) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: { message: activeGroupId
          ? '当前激活的分组不包含任何数据库，请检查分组配置'
          : '请先在左侧树中勾选要查询的数据库（连接实例）',
        severity: 'warning' as 'warning' },
      }));
      return;
    }

    if (readOnlyMode && !isSelectStatement(activeSql)) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: { message: '只读模式下仅允许执行 SELECT 语句！', severity: 'warning' as 'warning' },
      }));
      return;
    }

    if (!isLoadMore) {
      setExecuting(true);
      markTabExecuted(activeTabId);
      useEditorStore.getState().saveSnapshotToTab(activeTabId);
      useResultStore.getState().reset();
      useExecutionStore.getState().reset();
      useEditorStore.getState().resetPagination();
    } else {
      setLoadingMore(true);
    }

    const connectionInfos = collectConnectionInfos();

    // 初始化执行任务
    if (!isLoadMore) {
      useExecutionStore.getState().startExecution(activeSql, connectionInfos);
    }

    // 是否可以使用分页（SELECT/WITH 且不含 LIMIT）
    const usePage = canAppendLimit(activeSql);

    const cancelFn = executeBatchSSE(
      {
        sql: activeSql,
        connectionIds: effectiveDbIds,
        config: {
          concurrency: config.concurrency,
          timeoutMs: config.timeoutMs,
          continueOnError: config.continueOnError,
          maxRetries: config.maxRetries,
          readOnlyMode,
        },
        // 分页参数：仅当 SQL 可追加 LIMIT 时启用
        pageSize: usePage ? pageSize : undefined,
        offset: usePage ? (isLoadMore ? loadMoreOffset : 0) : undefined,
      },
      {
        onProgress: (event) => {
          const statusMap: Record<string, ExecutionStatus> = {
            running: ExecutionStatus.Running,
            success: ExecutionStatus.Success,
            failed: ExecutionStatus.Failed,
            timeout: ExecutionStatus.Timeout,
          };
          const taskStatus = statusMap[event.status] || ExecutionStatus.Failed;

          let result: QueryResult | undefined;
          if (event.status === 'success' && event.columns && event.rows) {
            const mappedRows = event.rows.map((row: any) => ({
              sourceDbLabel: `${event.hospitalName}(${event.predbTypeName})`,
              values: Object.fromEntries(
                (event.columns ?? []).map((col: string) => [
                  col,
                  { value: row[col], diffType: DiffType.Same },
                ])
              ),
            }));

            if (isLoadMore) {
              // 追加模式
              useResultStore.getState().appendRows(event.connectionId, event.columns, mappedRows, {
                hasMore: event.hasMore,
                totalLoaded: event.totalLoaded,
              });
              // 更新编辑器的分页元信息
              updateResultMeta(event.connectionId, {
                hasMore: event.hasMore ?? false,
                totalLoaded: event.totalLoaded ?? 0,
              });
            } else {
              result = {
                dbConnectionId: event.connectionId,
                sourceLabel: event.hospitalName,
                columns: event.columns,
                rows: mappedRows,
                totalRows: event.totalRows || event.rows.length,
                truncated: event.truncated,
                hasMore: event.hasMore,
                totalLoaded: event.totalLoaded,
              };
              useResultStore.getState().setResult(event.connectionId, result);
              // 记录分页元信息
              if (usePage) {
                updateResultMeta(event.connectionId, {
                  hasMore: event.hasMore ?? false,
                  totalLoaded: event.totalLoaded ?? 0,
                });
              }
            }
          }

          useExecutionStore.getState().updateTask(event.taskId, {
            status: taskStatus,
            duration: event.duration,
            errorMessage: event.errorMessage,
            result,
          });
        },
        onComplete: (event) => {
          if (!isLoadMore) {
            const failed = event.summary.total - event.summary.success;
            useExecutionStore.getState().updateStats(event.summary.success, failed, event.summary.totalDuration);
            useExecutionStore.getState().batchComplete();
            useResultStore.getState().aggregate();
            const results = useResultStore.getState().results;
            const resultKeys = Object.keys(results);
            if (resultKeys.length === 1) {
              useResultStore.getState().setSelectedDbId(resultKeys[0]);
            }
            useEditorStore.getState().saveSnapshotToTab(activeTabId);
            setExecuting(false);
            // 仅在页面被切到后台时才发桌面通知，避免应用前台时也弹出系统通知
            if (typeof document !== 'undefined' && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
              const successCount = event.summary.success;
              const totalCount = event.summary.total;
              new Notification('DClaw 数据钳 执行完成', {
                body: `${successCount}/${totalCount} 个数据库执行成功，总耗时 ${event.summary.totalDuration}ms`,
                icon: '/favicon.ico',
              });
            }
          } else {
            setLoadingMore(false);
          }
        },
        onError: (message) => {
          console.error('执行错误:', message);
          if (!isLoadMore) {
            useExecutionStore.getState().batchComplete();
            useEditorStore.getState().saveSnapshotToTab(activeTabId);
            setExecuting(false);
          } else {
            setLoadingMore(false);
          }
        },
      }
    );

    cancelRef.current = cancelFn;
  }, [sql, selectedSql, readOnlyMode, config, pageSize, setExecuting, markTabExecuted, activeTabId, loadingMore, setLoadingMore, updateResultMeta, getEffectiveDbIds, collectConnectionInfos, activeGroupId]);

  const handleExecute = useCallback(async () => {
    await doExecute(false, 0);
  }, [doExecute]);

  /**
   * 加载更多行（用于无限滚动）
   * 需要传入当前已加载的总行数作为 offset
   */
  const loadMore = useCallback(async (connId: string) => {
    if (loadingMore) return;
    const meta = useEditorStore.getState().resultMeta[connId];
    if (!meta?.hasMore) return;
    await doExecute(true, meta.totalLoaded);
  }, [doExecute, loadingMore]);

  // 将 loadMore 注册到 editorStore 供 SingleDbView 调用
  useEffect(() => {
    useEditorStore.getState().setLoadMoreFn(loadMore);
    return () => { useEditorStore.getState().setLoadMoreFn(null); };
  }, [loadMore]);

  const handleStop = useCallback(() => {
    cancelRef.current?.();
    useExecutionStore.getState().batchComplete();
    setExecuting(false);
    setLoadingMore(false);
  }, [setExecuting, setLoadingMore]);

  return {
    handleExecute,
    handleStop,
    loadMore,
    isExecuting,
    loadingMore,
    /** 当前生效的数据库ID列表（分组优先，普通模式使用当前标签页绑定） */
    selectedDbIds: activeGroupId ? getActiveDbIds() : (tabDbIds[activeTabId] || []),
    sql,
    selectedSql,
    readOnlyMode,
    /** 是否正在使用分组模式 */
    isGroupMode: !!activeGroupId,
  };
}
