/**
 * 临时数据导出服务 API
 * - 预览: POST /api/export/preview
 * - 执行: POST /api/export/execute (SSE)
 * - 浏览目录（保存路径）: /api/backup/browse & /api/backup/drives
 *
 * 与 DBeaver 风格"临时导出"向导对齐：支持 5 种文件格式
 * (csv/tsv/sql/json/xlsx) 和数据库目标导入。
 */
import { apiFetch, getToken } from './apiClient';
import { browseDirectory, fetchDrives } from './backupService';

/** 数据源类型 */
export type SourceType = 'table' | 'sql';

/** 文件格式 */
export type FileFormat = 'csv' | 'tsv' | 'sql' | 'json' | 'xlsx';

/** 导出目标类型 */
export type TargetType = 'file' | 'database';

/** 文件编码 */
export type FileEncoding = 'utf-8' | 'gbk' | 'gb18030';

/** 数据库写入策略 */
export type DbWriteStrategy = 'append' | 'truncate' | 'drop_create';

/** 导出数据源 */
export interface ExportSource {
  type: SourceType;
  /** type=table 时必填 */
  tableName?: string;
  schemaName?: string;
  connectionId?: string;
  /** type=sql 时必填 */
  sql?: string;
}

/** 文件目标配置 */
export interface FileTarget {
  type: 'file';
  format: FileFormat;
  encoding: FileEncoding;
  /** 字段分隔符 (CSV/TSV 之外一般不用) */
  delimiter?: string;
  /** 文件保存路径（绝对路径），含文件名 */
  savePath: string;
  /** SQL 导出时是否带 DROP TABLE 语句 */
  sqlIncludeDrop?: boolean;
  /** XLSX/CSV 是否带表头 */
  includeHeader?: boolean;
  /** XLSX/JSON 等是否压缩 */
  compress?: boolean;
}

/** 数据库目标配置 */
export interface DatabaseTarget {
  type: 'database';
  /** 目标连接 ID */
  connectionId: string;
  /** 目标表名（不含 schema） */
  tableName: string;
  /** 多表导出时的目标表名数组 */
  tableNameArr?: string[];
  /** 目标 schema（可选） */
  schemaName?: string;
  /** 不存在时自动建表 */
  createIfMissing?: boolean;
  /** 写入策略 */
  writeStrategy: DbWriteStrategy;
}

/** 完整导出配置 */
export type ExportTarget = FileTarget | DatabaseTarget;

export interface ExportConfig {
  source: ExportSource;
  target: ExportTarget;
  /** 每次批量行数（流式分块） */
  batchSize?: number;
  /** 导出执行 ID（执行时由后端返回） */
  executionId?: string;
}

/** 预览响应 */
export interface ExportPreview {
  columns: string[];
  rows: Record<string, any>[];
  totalRows: number;
  truncated: boolean;
}

/** 进度事件（SSE message） */
export type ExportProgressEvent =
  | { event: 'start'; totalRows?: number; filePath?: string; tableName?: string }
  | { event: 'progress'; processedRows: number; totalRows?: number; rate?: number; elapsedMs?: number }
  | { event: 'done'; totalRows: number; filePath?: string; tableName?: string; durationMs: number }
  | { event: 'error'; message: string };

const BASE = '/api/export';

/** 取预览（前 N 行） */
export async function previewExport(
  source: ExportSource,
  limit = 100
): Promise<ExportPreview> {
  const res = await apiFetch(`${BASE}/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, limit }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '预览失败' }));
    throw new Error(err.error || '预览失败');
  }
  return res.json();
}

/** 解析 SSE 流 */
function parseSseChunk(chunk: string): { event: string; data: string }[] {
  // SSE 消息以 \n\n 分割，每个消息包含多行: event: <e>\ndata: <json>\n\n
  const messages: { event: string; data: string }[] = [];
  const blocks = chunk.split('\n\n');
  for (const block of blocks) {
    if (!block.trim()) continue;
    let eventName = 'message';
    let dataStr = '';
    const lines = block.split('\n');
    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataStr += line.slice(5).trim();
      }
    }
    if (dataStr) messages.push({ event: eventName, data: dataStr });
  }
  return messages;
}

/** 流式执行导出（SSE）。返回 AbortController 允许外部中止 */
export async function executeExportStream(
  config: ExportConfig,
  onEvent: (evt: ExportProgressEvent) => void,
  onError: (err: Error) => void,
  onComplete: () => void
): Promise<AbortController> {
  const controller = new AbortController();

  // 必须手动拼 header，因 EventSource 不支持自定义 Header 且 SSE 需要 JWT
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  (async () => {
    try {
      const response = await fetch(`${BASE}/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify(config),
        signal: controller.signal,
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '导出请求失败' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }
      if (!response.body) throw new Error('响应体为空');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // 解析已收齐的 SSE 消息（以 \n\n 结尾）
        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const msgs = parseSseChunk(raw + '\n\n');
          for (const m of msgs) {
            try {
              const parsed = JSON.parse(m.data);
              const evt = { event: m.event, ...parsed } as ExportProgressEvent;
              onEvent(evt);
              if (m.event === 'done' || m.event === 'error') {
                onComplete();
                return;
              }
            } catch {
              // 忽略无法解析的行
            }
          }
        }
      }

      // 流结束但未收到 done/error 时也认为完成
      onComplete();
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      onError(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  return controller;
}

/** 重新导出 browseDirectory/fetchDrives，方便上层用 */
export { browseDirectory, fetchDrives };

/** 根据目标格式返回建议的文件扩展名 */
export function getFileExtension(format: FileFormat): string {
  return format;
}

/** 根据源/目标生成默认保存文件名（含时间戳） */
export function suggestFileName(source: ExportSource, target: ExportTarget): string {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14);
  if (source.type === 'table' && source.tableName) {
    return `${source.tableName}_${ts}`;
  }
  return `export_${ts}`;
}