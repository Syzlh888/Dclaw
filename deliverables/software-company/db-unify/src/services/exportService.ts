/**
 * 临时数据导出服务 API
 * - 预览: POST /api/export/preview
 * - 启动: POST /api/export/execute (立即返回 JSON {executionId, downloadUrl, statusUrl})
 * - 进度: GET  /api/export/progress/:id (SSE)
 * - 下载: GET  /api/export/download/:id (浏览器下载)
 *
 * 文件导出为「浏览器下载」模式：后端不写业务目录到容器，临时文件落到 os.tmpdir()，
 * 完成后前端拿 downloadUrl 触发浏览器原生下载。
 */
import { apiFetch, getToken } from './apiClient';

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
  /**
   * 浏览器下载时的文件名（不含路径）。后端用 executionId 重命名落到临时目录，
   * 前端拿到 downloadUrl 时直接 <a href download>。
   */
  filename?: string;
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
  | { event: 'ready'; executionId: string }
  | { event: 'start'; totalRows?: number; filePath?: string; tableName?: string; executionId?: string }
  | { event: 'progress'; processedRows: number; totalRows?: number; rate?: number; elapsedMs?: number }
  | { event: 'done'; totalRows: number; filePath?: string; tableName?: string; durationMs: number; downloadUrl?: string; executionId?: string }
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

/**
 * 启动导出（POST /api/export/execute）。后端立即返回 JSON：
 *   { executionId, mode, statusUrl, downloadUrl, filename }
 */
export interface StartExportResponse {
  executionId: string;
  mode: 'file' | 'database';
  statusUrl: string;
  downloadUrl: string | null;
  filename: string | null;
}

export async function startExport(config: ExportConfig): Promise<StartExportResponse> {
  const res = await apiFetch(`${BASE}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '导出启动失败' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 触发浏览器原生下载：fetch 文件 + 带 Authorization 头 + Blob URL 触发下载 */
export async function triggerBrowserDownload(url: string, filename?: string) {
  if (!url) return;
  try {
    const token = getToken();
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error('[triggerBrowserDownload] HTTP', res.status, errText);
      throw new Error(`下载失败：HTTP ${res.status}`);
    }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    if (filename) a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { a.remove(); } catch { /* ignore */ }
      URL.revokeObjectURL(blobUrl);
    }, 1000);
  } catch (err) {
    console.error('[triggerBrowserDownload] failed', err);
    throw err;
  }
}

/**
 * 订阅 SSE 进度通道，返回 AbortController 可外部中止。
 * 后端 GET /api/export/progress/:id 在 done/error 后会自动关闭（~6s 缓冲）。
 */
export function subscribeProgress(
  executionId: string,
  onEvent: (evt: ExportProgressEvent) => void,
  onError: (err: Error) => void,
  onComplete: () => void
): AbortController {
  const controller = new AbortController();
  const token = getToken();
  const headers: Record<string, string> = { Accept: 'text/event-stream' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  (async () => {
    try {
      const response = await fetch(`${BASE}/progress/${encodeURIComponent(executionId)}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '订阅进度失败' }));
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

        let idx: number;
        // eslint-disable-next-line no-cond-assign
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          // 跳过心跳注释行 ":heartbeat"
          if (raw.startsWith(':')) continue;
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
              /* ignore malformed */
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

/**
 * 流式执行导出（双端点兼容旧调用方）：
 *   1) POST /api/export/execute  启动后台任务，拿 executionId + downloadUrl
 *   2) GET  /api/export/progress/:id  SSE 推送进度
 *   3) onComplete 时自动触发浏览器下载（若目标为 file）
 *
 * 返回 AbortController 允许外部中止进度订阅（中止后后端任务不会立刻停止，
 * 但前端不再接收进度事件）。
 */
export async function executeExportStream(
  config: ExportConfig,
  onEvent: (evt: ExportProgressEvent) => void,
  onError: (err: Error) => void,
  onComplete: () => void
): Promise<AbortController> {
  const controller = new AbortController();
  try {
    const startRes = await startExport(config);
    // 立即把 start 事件推给上层，让进度条进入「执行中」状态
    onEvent({
      event: 'start',
      executionId: startRes.executionId,
      filePath: startRes.filename || undefined,
    } as ExportProgressEvent);

    const subController = subscribeProgress(
      startRes.executionId,
      (evt) => {
        onEvent(evt);
        if (evt.event === 'done' && startRes.downloadUrl) {
          // 自动触发浏览器下载（带文件名提示）
          triggerBrowserDownload(startRes.downloadUrl!, startRes.filename || undefined);
        }
      },
      onError,
      onComplete
    );

    // 串联两个 controller：调用方 abort 我们的 controller 时一并中止订阅
    controller.signal.addEventListener('abort', () => {
      try { subController.abort(); } catch { /* ignore */ }
    });
  } catch (err: any) {
    onError(err instanceof Error ? err : new Error(String(err)));
    onComplete();
  }
  return controller;
}

/**
 * 主动取消某个导出任务（调用 /api/export/cancel/:id）。
 * 注：executeExportStream 的 AbortController 只停止前端订阅，
 * 要真正取消后端任务请调此函数。
 */
export async function cancelExport(executionId: string): Promise<boolean> {
  try {
    const res = await apiFetch(`${BASE}/cancel/${encodeURIComponent(executionId)}`, {
      method: 'POST',
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 列元数据（用于字段映射对话框） */
export interface ColumnInfo {
  name: string;
  type: string;
  nullable?: boolean;
  comment?: string;
}

/**
 * 读取指定表的所有列（用于「字段映射」对话框）。
 *
 * 复用后端 `POST /api/connections/:id/metadata`，它返回所有表的元数据（含列），
 * 客户端按 tableName 过滤。schema 可选。
 *
 * 返回的列形如 `[{ name: 'id', type: 'integer', ... }]`。
 */
export async function fetchTableColumns(
  connectionId: string,
  tableName: string,
  schemaName?: string
): Promise<ColumnInfo[]> {
  if (!connectionId || !tableName) return [];
  try {
    const res = await apiFetch(`/api/connections/${connectionId}/metadata`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(schemaName ? { schema: schemaName } : {}),
    });
    if (!res.ok) {
      console.warn(`[fetchTableColumns] HTTP ${res.status} for ${connectionId}/${tableName}`);
      return [];
    }
    const data = await res.json().catch(() => ({}));
    const tables: any[] = data.tables || [];
    const match = tables.find((t) => (t?.name || '').toLowerCase() === tableName.toLowerCase());
    const cols: any[] = match?.columns || [];
    return cols.map((c) => ({
      name: c.name,
      type: c.type || '',
      nullable: c.nullable,
      comment: c.comment,
    }));
  } catch (err) {
    console.warn('[fetchTableColumns] failed', err);
    return [];
  }
}

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