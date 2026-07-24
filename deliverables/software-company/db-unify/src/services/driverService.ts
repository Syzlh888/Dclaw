/**
 * 驱动管理 API 服务
 */
import type { DriverPackage } from '../types/driver';

const API_BASE = '/api/drivers';

/** 获取所有驱动列表 */
export async function fetchDrivers(): Promise<DriverPackage[]> {
  const response = await fetch(API_BASE);
  if (!response.ok) throw new Error('获取驱动列表失败');
  return response.json();
}

/**
 * 创建自定义驱动（支持文件上传）
 * @param data 驱动元数据
 * @param file 驱动 JAR 文件
 */
export async function createDriver(
  data: Omit<DriverPackage, 'id' | 'uploadTime'>,
  file: File
): Promise<DriverPackage> {
  const formData = new FormData();
  formData.append('name', data.name);
  formData.append('version', data.version);
  formData.append('driverClass', data.driverClass);
  formData.append('dbType', data.dbType || data.name);
  if (data.description) formData.append('description', data.description);
  formData.append('driverFile', file);

  const response = await fetch(API_BASE, {
    method: 'POST',
    // 注意：不要设置 Content-Type，浏览器会自动设置含 boundary 的 multipart/form-data
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '创建驱动失败' }));
    throw new Error(err.error || '创建驱动失败');
  }
  return response.json();
}

/** 更新自定义驱动 */
export async function updateDriverApi(
  id: string,
  data: Partial<Pick<DriverPackage, 'name' | 'version' | 'driverClass' | 'description'>>
): Promise<DriverPackage> {
  const response = await fetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '更新驱动失败' }));
    throw new Error(err.error || '更新驱动失败');
  }
  return response.json();
}

/** 删除自定义驱动 */
export async function deleteDriverApi(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '删除驱动失败' }));
    throw new Error(err.error || '删除驱动失败');
  }
}

/**
 * 在线下载内置驱动
 * @param driverId 驱动 ID
 */
export async function downloadDriverApi(driverId: string): Promise<{ success: boolean; fileSize: number; message: string }> {
  const response = await fetch(`${API_BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '驱动下载失败' }));
    throw new Error(err.error || '驱动下载失败');
  }
  return response.json();
}

/**
 * 卸载驱动（移除已下载的 JAR 文件）
 * @param id 驱动 ID
 */
export async function uninstallDriverApi(id: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${API_BASE}/${id}/uninstall`, {
    method: 'POST',
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '驱动卸载失败' }));
    throw new Error(err.error || '驱动卸载失败');
  }
  return response.json();
}

/**
 * 为内置驱动手动上传 JAR 文件
 * @param driverId 内置驱动 ID
 * @param file JAR 文件
 * @param metadata 驱动元数据
 */
export async function uploadBuiltinJarApi(
  driverId: string,
  file: File,
  metadata: { name: string; version: string; driverClass: string }
): Promise<{ fileName: string; fileSize: number; message: string }> {
  const formData = new FormData();
  formData.append('driverId', driverId);
  formData.append('name', metadata.name);
  formData.append('version', metadata.version);
  formData.append('driverClass', metadata.driverClass);
  formData.append('driverFile', file);

  const response = await fetch(`${API_BASE}/${driverId}/upload-jar`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: '上传驱动文件失败' }));
    throw new Error(err.error || '上传驱动文件失败');
  }
  return response.json();
}
