/**
 * SQL 执行服务（基于 SSE 实时进度推送）
 */
import type { ExecutionTask } from '../types/execution';
import type { QueryResult } from '../types/result';
import { ExecutionStatus } from '../types/execution';

export interface ExecuteOptions {
  sql: string;
  connectionIds: string[];
  config: {
    concurrency: number;
    timeoutMs: number;
    continueOnError: boolean;
    maxRetries: number;
    readOnlyMode: boolean;
  };
}

export interface ExecutionProgressEvent {
  taskId: string;
  connectionId: string;
  hospitalName: string;
  predbTypeName: string;
  status: 'running' | 'success' | 'failed' | 'timeout';
  duration?: number;
  errorMessage?: string;
  rowCount?: number;
  columns?: string[];
  rows?: any[];
  totalRows?: number;
  truncated?: boolean;
  timestamp: number;
}

export interface ExecutionCompleteEvent {
  executionId: string;
  summary: {
    total: number;
    success: number;
    failed: number;
    timeout: number;
    totalDuration: number;
  };
  timestamp: number;
}

export type ExecutionEventCallback = {
  onProgress?: (event: ExecutionProgressEvent) => void;
  onComplete?: (event: ExecutionCompleteEvent) => void;
  onError?: (message: string) => void;
};

/**
 * 通过 SSE 执行批量 SQL
 * 返回 abort 函数用于取消执行
 */
export function executeBatchSSE(
  options: ExecuteOptions,
  callbacks: ExecutionEventCallback
): () => void {
  const controller = new AbortController();
  const { signal } = controller;

  // 启动异步 SSE 连接
  (async () => {
    try {
      // SSE 需绕过 Vite 代理（代理会缓冲 SSE 流导致阻塞）
      // 生产环境通过 nginx 等反向代理处理，此处回退到同源相对路径
      const apiBase = import.meta.env.DEV
        ? (import.meta.env.VITE_API_HOST || 'http://localhost:3001')
        : '';
      const response = await fetch(`${apiBase}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(options),
        signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '执行请求失败' }));
        callbacks.onError?.(err.error || '执行请求失败');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError?.('无法读取响应流');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let currentData = '';
      let completed = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // 解析 SSE 事件（处理跨 chunk 的 data 行）
        const lines = buffer.split('\n');
        // 保留最后一个可能不完整的行
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trimEnd(); // 去掉末尾 \r
          if (trimmed.startsWith('event: ')) {
            currentEvent = trimmed.slice(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            currentData += trimmed.slice(6);
          } else if (trimmed === '') {
            // 空行表示事件结束
            if (currentData) {
              try {
                const data = JSON.parse(currentData);
                switch (currentEvent) {
                  case 'progress':
                    callbacks.onProgress?.(data);
                    break;
                  case 'complete':
                    completed = true;
                    callbacks.onComplete?.(data);
                    break;
                  case 'error':
                    callbacks.onError?.(data.message || data);
                    break;
                }
              } catch {
                // 忽略解析错误
              }
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }

      // 处理 buffer 中剩余的数据（流结束但没有尾随空行）
      if (buffer.trimEnd()) {
        const trimmed = buffer.trimEnd();
        if (trimmed.startsWith('data: ')) {
          currentData += trimmed.slice(6);
        }
        if (currentData) {
          try {
            const data = JSON.parse(currentData);
            switch (currentEvent) {
              case 'progress':
                callbacks.onProgress?.(data);
                break;
              case 'complete':
                completed = true;
                callbacks.onComplete?.(data);
                break;
              case 'error':
                callbacks.onError?.(data.message || data);
                break;
            }
          } catch {
            // 忽略
          }
        }
      }

      // 兜底：如果流结束但没有收到 complete，强制结束
      if (!completed) {
        callbacks.onError?.('连接意外关闭，未收到执行完成信号');
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      callbacks.onError?.(err.message || '执行出错');
    }
  })();

  return () => controller.abort();
}
