import { useCallback, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useExecutionStore } from '../stores/executionStore';
import { useTreeStore } from '../stores/treeStore';
import { useGroupStore } from '../stores/groupStore';
import { useResultStore } from '../stores/resultStore';
import { executeBatchSSE } from '../services/executionService';
import { isSelectStatement } from '../utils/sqlUtils';
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
  const readOnlyMode = useEditorStore((s) => s.readOnlyMode);
  const isExecuting = useEditorStore((s) => s.isExecuting);
  const setExecuting = useEditorStore((s) => s.setExecuting);
  const config = useExecutionStore((s) => s.config);
  const treeSelectedDbIds = useTreeStore((s) => s.selectedDbIds);
  const activeGroupId = useGroupStore((s) => s.activeGroupId);
  const getActiveDbIds = useGroupStore((s) => s.getActiveDbIds);
  const cancelRef = useRef<(() => void) | null>(null);

  const handleExecute = useCallback(async () => {
    // 判断使用分组还是树勾选
    const effectiveDbIds = activeGroupId ? getActiveDbIds() : treeSelectedDbIds;

    if (effectiveDbIds.length === 0) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: { message: activeGroupId
          ? '当前激活的分组不包含任何数据库，请检查分组配置'
          : '请先在左侧树中勾选要查询的数据库（连接实例）',
        severity: 'warning' as 'warning' },
      }));
      return;
    }

    if (readOnlyMode && !isSelectStatement(sql)) {
      window.dispatchEvent(new CustomEvent('dc:notify', {
        detail: { message: '只读模式下仅允许执行 SELECT 语句！', severity: 'warning' as 'warning' },
      }));
      return;
    }

    setExecuting(true);
    useResultStore.getState().reset();
    useExecutionStore.getState().reset();

    // 收集连接信息用于初始化任务状态
    const nodes = useTreeStore.getState().nodes;
    const hospitalNodes = Object.values(nodes).filter(
      (n) => n.type === 'hospital' && n.dbConnectionId && effectiveDbIds.includes(n.dbConnectionId)
    );

    const connectionInfos = hospitalNodes.map((h) => {
      // 查找业务模块名
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

    // 初始化执行任务
    useExecutionStore.getState().startExecution(sql, connectionInfos);

    // 启动 SSE 执行
    const cancelFn = executeBatchSSE(
      {
        sql,
        connectionIds: effectiveDbIds,
        config: {
          concurrency: config.concurrency,
          timeoutMs: config.timeoutMs,
          continueOnError: config.continueOnError,
          maxRetries: config.maxRetries,
          readOnlyMode,
        },
      },
      {
        onProgress: (event) => {
          // 更新执行状态
          const statusMap: Record<string, ExecutionStatus> = {
            running: ExecutionStatus.Running,
            success: ExecutionStatus.Success,
            failed: ExecutionStatus.Failed,
            timeout: ExecutionStatus.Timeout,
          };

          const taskStatus = statusMap[event.status] || ExecutionStatus.Failed;

          // 构建查询结果
          let result: QueryResult | undefined;
          if (event.status === 'success' && event.columns && event.rows) {
            result = {
              dbConnectionId: event.connectionId,
              sourceLabel: event.hospitalName,
              columns: event.columns,
              rows: event.rows.map((row: any) => ({
                sourceDbLabel: `${event.hospitalName}(${event.predbTypeName})`,
                values: Object.fromEntries(
                  (event.columns ?? []).map((col: string) => [
                    col,
                    { value: row[col], diffType: DiffType.Same },
                  ])
                ),
              })),
              totalRows: event.totalRows || event.rows.length,
              truncated: event.truncated,
            };
            useResultStore.getState().setResult(event.connectionId, result);
          }

          useExecutionStore.getState().updateTask(event.taskId, {
            status: taskStatus,
            duration: event.duration,
            errorMessage: event.errorMessage,
            result,
          });
        },
        onComplete: (event) => {
          const failed = event.summary.total - event.summary.success;
          useExecutionStore.getState().updateStats(event.summary.success, failed, event.summary.totalDuration);
          useExecutionStore.getState().batchComplete();
          useResultStore.getState().aggregate();
          setExecuting(false);
          // Browser notification
          if ('Notification' in window && Notification.permission === 'granted') {
            const successCount = event.summary.success;
            const totalCount = event.summary.total;
            new Notification('DClaw 数据钳 执行完成', {
              body: `${successCount}/${totalCount} 个数据库执行成功，总耗时 ${event.summary.totalDuration}ms`,
              icon: '/favicon.ico',
            });
          }
        },
        onError: (message) => {
          console.error('执行错误:', message);
          useExecutionStore.getState().batchComplete();
          setExecuting(false);
        },
      }
    );

    cancelRef.current = cancelFn;
  }, [sql, readOnlyMode, treeSelectedDbIds, activeGroupId, getActiveDbIds, config, setExecuting]);

  const handleStop = useCallback(() => {
    cancelRef.current?.();
    useExecutionStore.getState().batchComplete();
    setExecuting(false);
  }, [setExecuting]);

  return {
    handleExecute,
    handleStop,
    isExecuting,
    /** 当前生效的数据库ID列表（分组优先） */
    selectedDbIds: activeGroupId ? getActiveDbIds() : treeSelectedDbIds,
    sql,
    readOnlyMode,
    /** 是否正在使用分组模式 */
    isGroupMode: !!activeGroupId,
  };
}
