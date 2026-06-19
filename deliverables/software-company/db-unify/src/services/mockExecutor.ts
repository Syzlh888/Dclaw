import { ExecutionStatus } from '../types/execution';
import type { ExecutionTask } from '../types/execution';
import { useExecutionStore } from '../stores/executionStore';
import { useResultStore } from '../stores/resultStore';
import { useEditorStore } from '../stores/editorStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useTreeStore } from '../stores/treeStore';
import { generateMockQueryResult } from '../services/mockData';
import { TreeNodeType } from '../types/tree';

let abortController: AbortController | null = null;

/**
 * Find ancestor of a specific type in the tree
 */
function findAncestorByType(
  nodes: Record<string, import('../types/tree').TreeNode>,
  node: import('../types/tree').TreeNode,
  type: import('../types/tree').TreeNodeType
): import('../types/tree').TreeNode | null {
  let current = node;
  while (current.parentId) {
    const parent = nodes[current.parentId];
    if (!parent) break;
    if (parent.type === type) return parent;
    current = parent;
  }
  return null;
}

/**
 * Execute a batch of SQL queries across multiple databases (mock).
 * Uses a concurrency pool to simulate parallel execution.
 */
export async function executeBatch(
  sql: string,
  dbConnectionIds: string[],
  config: { concurrency: number; timeoutMs: number; continueOnError: boolean; maxRetries: number }
): Promise<void> {
  abortController = new AbortController();
  const signal = abortController.signal;

  const nodes = useTreeStore.getState().nodes;
  const connections = useConnectionStore.getState().connections;

  // Build connection info from tree
  const hospitalNodes = Object.values(nodes).filter(
    (n) =>
      n.type === TreeNodeType.Hospital &&
      n.dbConnectionId &&
      dbConnectionIds.includes(n.dbConnectionId)
  );

  const connectionInfos = hospitalNodes.map((h) => {
    const preDbNode = findAncestorByType(nodes, h, TreeNodeType.PreDbType);
    return {
      id: h.dbConnectionId!,
      hospitalName: h.name,
      preDbTypeName: preDbNode?.name ?? '',
    };
  });

  // Start execution
  useExecutionStore.getState().startExecution(sql, connectionInfos);

  const tasks = useExecutionStore.getState().tasks;
  const updateTask = useExecutionStore.getState().updateTask;

  // Concurrency pool
  let currentIdx = 0;

  const processTask = async (task: ExecutionTask): Promise<void> => {
    if (signal.aborted) return;

    // Mark as running
    updateTask(task.id, { status: ExecutionStatus.Running, startTime: Date.now() });

    const delay = 500 + Math.random() * 2500;
    await new Promise((resolve) => setTimeout(resolve, delay));

    if (signal.aborted) return;

    // Random outcome: 80% success, 10% failed, 10% timeout
    const rand = Math.random();
    const endTime = Date.now();
    const duration = endTime - task.startTime;

    if (rand < 0.8) {
      // Success
      const result = generateMockQueryResult(
        task.dbConnectionId,
        task.hospitalName,
        task.preDbTypeName
      );

      updateTask(task.id, {
        status: ExecutionStatus.Success,
        endTime,
        duration,
        result,
      });

      useResultStore.getState().setResult(task.dbConnectionId, result);
    } else if (rand < 0.9) {
      // Failed
      const errors = [
        '连接超时：无法连接到数据库服务器',
        '认证失败：用户名或密码错误',
        '数据库不存在',
        'SQL 语法错误：You have an error in your SQL syntax',
      ];
      updateTask(task.id, {
        status: ExecutionStatus.Failed,
        endTime,
        duration,
        errorMessage: errors[Math.floor(Math.random() * errors.length)],
      });
    } else {
      // Timeout
      updateTask(task.id, {
        status: ExecutionStatus.Timeout,
        endTime,
        duration: config.timeoutMs,
        errorMessage: `执行超时（${config.timeoutMs / 1000}s）`,
      });
    }
  };

  const worker = async (): Promise<void> => {
    while (currentIdx < tasks.length && !signal.aborted) {
      const idx = currentIdx++;
      if (idx >= tasks.length) break;
      await processTask(tasks[idx]);
    }
  };

  // Create worker pool
  const workers: Promise<void>[] = [];
  const poolSize = Math.min(config.concurrency, tasks.length);
  for (let i = 0; i < poolSize; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);

  // Batch complete
  useExecutionStore.getState().batchComplete();

  // Auto-aggregate results
  useResultStore.getState().aggregate();
}

/**
 * Cancel the current batch execution.
 */
export function cancelExecution(): void {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  useExecutionStore.getState().batchComplete();
  useEditorStore.getState().setExecuting(false);
}
