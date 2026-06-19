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
