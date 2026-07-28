/**
 * 驱动管理 API 服务
 */
import type { DriverPackage } from '../types/driver';
import { apiFetch } from './apiClient';

const API_BASE = '/api/drivers';

/** 获取所有驱动列表 */
export async function fetchDrivers(): Promise<DriverPackage[]> {
  const response = await apiFetch(API_BASE);
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
  if (data.description) formData.append('description', data.description);
  formData.append('driverFile', file);

  const response = await apiFetch(API_BASE, {
    method: 'POST',
    // 注意：不要设置 Content-Type，浏览器会自动设置含 boundary 的 multipart/form-data
    body: formData,
  });
  if (!response.ok) throw new Error('创建驱动失败');
  return response.json();
}

/** 更新驱动信息 */
export async function updateDriver(
  id: string,
  data: Partial<Pick<DriverPackage, 'name' | 'version' | 'driverClass' | 'description'>>
): Promise<DriverPackage> {
  const response = await apiFetch(`${API_BASE}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error('更新驱动失败');
  return response.json();
}

/** 删除驱动 */
export async function deleteDriver(id: string): Promise<void> {
  const response = await apiFetch(`${API_BASE}/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new Error('删除驱动失败');
}

/**
 * 下载驱动
 * @param driverId 驱动 ID
 */
export async function downloadDriverApi(driverId: string): Promise<{ success: boolean; fileSize: number; message: string }> {
  const response = await apiFetch(`${API_BASE}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ driverId }),
  });
  if (!response.ok) throw new Error('下载驱动失败');
  return response.json();
}

/** 卸载驱动 */
export async function uninstallDriver(id: string): Promise<{ success: boolean; message: string }> {
  const response = await apiFetch(`${API_BASE}/${id}/uninstall`, { method: 'POST' });
  if (!response.ok) throw new Error('卸载驱动失败');
  return response.json();
}

/**
 * 上传驱动 JAR 文件
 * @param driverId 驱动 ID
 * @param file JAR 文件
 */
export async function uploadDriverJar(
  driverId: string,
  file: File
): Promise<{ success: boolean; message: string; driverId: string }> {
  const formData = new FormData();
  formData.append('driverFile', file);

  const response = await apiFetch(`${API_BASE}/${driverId}/upload-jar`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) throw new Error('上传驱动文件失败');
  return response.json();
}

/**
 * 为内置驱动上传 JAR 文件（含 metadata）
 * @param driverId 驱动 ID
 * @param file JAR 文件
 * @param metadata 驱动元数据（name, version, driverClass）
 */
export async function uploadBuiltinJarApi(
  driverId: string,
  file: File,
  metadata: { name: string; version: string; driverClass: string }
): Promise<{ fileName: string; fileSize: number }> {
  const response = await apiFetch(`${API_BASE}/${driverId}/upload-jar`, {
    method: 'POST',
    body: (() => {
      const fd = new FormData();
      fd.append('driverFile', file);
      fd.append('name', metadata.name);
      fd.append('version', metadata.version);
      fd.append('driverClass', metadata.driverClass);
      return fd;
    })(),
  });
  if (!response.ok) throw new Error('上传内置驱动 JAR 失败');
  return response.json();
}
