/**
 * 备份还原服务 API
 */
import { apiFetch } from './apiClient';

export interface BackupConfig {
  autoBackupEnabled: boolean;
  backupIntervalHours: number;
  backupPath: string;
  maxBackupCount: number;
}

export interface BackupFile {
  fileName: string;
  filePath: string;
  size: number;
  createdAt: string;
}

export interface BackupResult {
  success: boolean;
  fileName: string;
  filePath: string;
  size: number;
  timestamp: string;
}

export interface RestoreResult {
  success: boolean;
  restoredCount: number;
  rollbackFile: string;
  timestamp: string;
  message: string;
}

export interface BrowseResult {
  current: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}

export interface DriveItem {
  name: string;
  path: string;
}

export interface DrivesResult {
  type: 'drives' | 'root';
  items: DriveItem[];
}

const BASE = '/api/backup';

/** 获取备份配置 */
export async function fetchBackupConfig(): Promise<BackupConfig> {
  const res = await apiFetch(`${BASE}/config`);
  if (!res.ok) throw new Error('获取备份配置失败');
  return res.json();
}

/** 更新备份配置 */
export async function updateBackupConfig(config: Partial<BackupConfig>): Promise<BackupConfig> {
  const res = await apiFetch(`${BASE}/config`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!res.ok) throw new Error('更新备份配置失败');
  return res.json();
}

/** 立即执行备份（可选自定义保存路径） */
export async function backupNow(customPath?: string): Promise<BackupResult> {
  const body = customPath ? JSON.stringify({ customPath }) : undefined;
  const res = await apiFetch(`${BASE}/now`, { method: 'POST', body });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '备份失败' }));
    throw new Error(err.error || '备份失败');
  }
  return res.json();
}

/** 获取备份列表 */
export async function fetchBackupList(): Promise<BackupFile[]> {
  const res = await apiFetch(`${BASE}/list`);
  if (!res.ok) throw new Error('获取备份列表失败');
  return res.json();
}

/** 还原备份 */
export async function restoreBackup(filePath: string): Promise<RestoreResult> {
  const res = await apiFetch(`${BASE}/restore`, {
    method: 'POST',
    body: JSON.stringify({ filePath }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '还原失败' }));
    throw new Error(err.error || '还原失败');
  }
  return res.json();
}

/** 删除备份文件 */
export async function deleteBackup(fileName: string): Promise<void> {
  const res = await apiFetch(`${BASE}/${encodeURIComponent(fileName)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('删除失败');
}

/** 下载备份文件 URL */
export function getBackupDownloadUrl(fileName: string): string {
  return `${BASE}/download/${encodeURIComponent(fileName)}`;
}

/** 浏览服务器目录 */
export async function browseDirectory(dir?: string): Promise<BrowseResult> {
  const params = dir ? `?dir=${encodeURIComponent(dir)}` : '';
  const res = await apiFetch(`${BASE}/browse${params}`);
  if (!res.ok) throw new Error('浏览目录失败');
  return res.json();
}

/** 获取盘符列表（Windows）或根目录 */
export async function fetchDrives(): Promise<DrivesResult> {
  const res = await apiFetch(`${BASE}/drives`);
  if (!res.ok) throw new Error('获取盘符失败');
  return res.json();
}
