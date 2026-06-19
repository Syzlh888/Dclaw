import { apiFetch } from './apiClient';

const BASE = '/api/servers';

/** 解析响应 JSON，非 2xx 则抛出错误 */
async function jsonOrThrow(res: Response) {
  const data = await res.json();
  if (!res.ok) {
    const err: any = new Error(data.error || `请求失败 (${res.status})`);
    err.response = { data, status: res.status };
    throw err;
  }
  return data;
}

export interface ServerInput {
  applicationId?: string; name: string; internalIp: string; externalIp?: string;
  publicIp?: string; crossNetworkIp?: string; os?: string;
  cpuCores?: number; memoryGB?: number; systemDiskGB?: number; dataDiskGB?: number;
  storageType?: string; bandwidthMbps?: number;
  serverLocation?: string; serverType?: string;
  username?: string; password?: string;
  bastionHost?: string; bastionPort?: number; bastionUsername?: string; bastionPassword?: string;
  vpnInfo?: string; macAddress?: string; deployedContent?: string;
  tags?: string[]; notes?: string;
}

export async function fetchServers() {
  const res = await apiFetch(BASE);
  const data = await res.json();
  return data.servers || [];
}

export async function fetchServerDetail(id: string) {
  const res = await apiFetch(`${BASE}/${id}`);
  return res.json();
}

export async function createServer(input: ServerInput) {
  const res = await apiFetch(BASE, {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return res.json();
}

export async function updateServer(id: string, partial: Partial<ServerInput>) {
  const res = await apiFetch(`${BASE}/${id}`, {
    method: 'PUT',
    body: JSON.stringify(partial),
  });
  return res.json();
}

export async function deleteServer(id: string) {
  const res = await apiFetch(`${BASE}/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function decryptServerPasswords(id: string, verifyPassword: string) {
  const res = await apiFetch(`${BASE}/${id}/decrypt`, {
    method: 'POST',
    body: JSON.stringify({ verifyPassword }),
  });
  return res.json();
}

export async function importServers(servers: any[]) {
  const res = await apiFetch(`${BASE}/import`, {
    method: 'POST',
    body: JSON.stringify({ servers }),
  });
  return res.json();
}

export async function fetchServerSummary() {
  const res = await apiFetch(`${BASE}/summary`);
  return res.json();
}

export async function fetchPasswordHistory(serverId: string, fieldName?: string) {
  const url = fieldName ? `${BASE}/${serverId}/password-history?fieldName=${encodeURIComponent(fieldName)}` : `${BASE}/${serverId}/password-history`;
  const res = await apiFetch(url);
  return res.json();
}

export async function decryptPasswordHistory(serverId: string, verifyPassword: string, fieldName?: string) {
  const res = await apiFetch(`${BASE}/${serverId}/password-history/decrypt`, {
    method: 'POST', body: JSON.stringify({ verifyPassword, fieldName }),
  });
  return res.json();
}

// DB instances
export async function addDbInstance(serverId: string, input: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/db-instances`, {
    method: 'POST', body: JSON.stringify(input),
  }));
}

export async function updateDbInstance(serverId: string, di: string, partial: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/db-instances/${di}`, {
    method: 'PUT', body: JSON.stringify(partial),
  }));
}

export async function deleteDbInstance(serverId: string, di: string) {
  const res = await apiFetch(`${BASE}/${serverId}/db-instances/${di}`, { method: 'DELETE' });
  return res.json();
}

// App instances
export async function addAppInstance(serverId: string, input: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/app-instances`, {
    method: 'POST', body: JSON.stringify(input),
  }));
}

export async function updateAppInstance(serverId: string, ai: string, partial: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/app-instances/${ai}`, {
    method: 'PUT', body: JSON.stringify(partial),
  }));
}

export async function deleteAppInstance(serverId: string, ai: string) {
  const res = await apiFetch(`${BASE}/${serverId}/app-instances/${ai}`, { method: 'DELETE' });
  return res.json();
}

// Ports
export async function addPort(serverId: string, input: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/ports`, {
    method: 'POST', body: JSON.stringify(input),
  }));
}

export async function updatePort(serverId: string, pi: string, partial: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/ports/${pi}`, {
    method: 'PUT', body: JSON.stringify(partial),
  }));
}

export async function deletePort(serverId: string, pi: string) {
  const res = await apiFetch(`${BASE}/${serverId}/ports/${pi}`, { method: 'DELETE' });
  return res.json();
}

// Middleware instances
export async function addMiddleware(serverId: string, input: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/mid-instances`, {
    method: 'POST', body: JSON.stringify(input),
  }));
}

export async function updateMiddleware(serverId: string, mi: string, partial: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/mid-instances/${mi}`, {
    method: 'PUT', body: JSON.stringify(partial),
  }));
}

export async function deleteMiddleware(serverId: string, mi: string) {
  const res = await apiFetch(`${BASE}/${serverId}/mid-instances/${mi}`, { method: 'DELETE' });
  return res.json();
}

// API instances
export async function addApiInstance(serverId: string, input: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/api-instances`, {
    method: 'POST', body: JSON.stringify(input),
  }));
}

export async function updateApiInstance(serverId: string, ai: string, partial: any) {
  return jsonOrThrow(await apiFetch(`${BASE}/${serverId}/api-instances/${ai}`, {
    method: 'PUT', body: JSON.stringify(partial),
  }));
}

export async function deleteApiInstance(serverId: string, ai: string) {
  const res = await apiFetch(`${BASE}/${serverId}/api-instances/${ai}`, { method: 'DELETE' });
  return res.json();
}

// Download template
export function getTemplateDownloadUrl() {
  return `${BASE}/template/download.xlsx`;
}

// Verify password
export async function verifyLoginPassword(password: string) {
  const res = await apiFetch('/api/auth/verify-password', {
    method: 'POST', body: JSON.stringify({ password }),
  });
  return res.json();
}

// System config
export async function getSystemConfig() {
  const res = await apiFetch('/api/system/config');
  return res.json();
}

export async function setSecondaryPassword(password: string, oldPassword?: string) {
  const res = await apiFetch('/api/system/config/secondary-password', {
    method: 'PUT', body: JSON.stringify({ password, oldPassword }),
  });
  return res.json();
}

export async function verifySecondaryPassword(password: string) {
  const res = await apiFetch('/api/system/verify-secondary-password', {
    method: 'POST', body: JSON.stringify({ password }),
  });
  return res.json();
}

// Dictionaries
export async function fetchProjects() {
  const res = await apiFetch('/api/projects');
  const data = await res.json();
  return data.projects || [];
}

export async function createProject(name: string, shortName?: string) {
  const res = await apiFetch('/api/projects', { method: 'POST', body: JSON.stringify({ name, shortName }) });
  return res.json();
}

export async function updateProject(id: string, partial: any) {
  const res = await apiFetch(`/api/projects/${id}`, { method: 'PUT', body: JSON.stringify(partial) });
  return res.json();
}

export async function deleteProject(id: string) {
  const res = await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchEngineerings(projectId?: string) {
  const url = projectId ? `/api/engineerings?projectId=${projectId}` : '/api/engineerings';
  const res = await apiFetch(url);
  const data = await res.json();
  return data.engineerings || [];
}

export async function createEngineering(projectId: string, name: string, shortName?: string) {
  const res = await apiFetch('/api/engineerings', { method: 'POST', body: JSON.stringify({ projectId, name, shortName }) });
  return res.json();
}

export async function updateEngineering(id: string, partial: any) {
  const res = await apiFetch(`/api/engineerings/${id}`, { method: 'PUT', body: JSON.stringify(partial) });
  return res.json();
}

export async function deleteEngineering(id: string) {
  const res = await apiFetch(`/api/engineerings/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function fetchApplications(engineeringId?: string) {
  const url = engineeringId ? `/api/applications?engineeringId=${engineeringId}` : '/api/applications';
  const res = await apiFetch(url);
  const data = await res.json();
  return data.applications || [];
}

export async function createApplication(engineeringId: string, name: string, shortName?: string) {
  const res = await apiFetch('/api/applications', { method: 'POST', body: JSON.stringify({ engineeringId, name, shortName }) });
  return res.json();
}

export async function updateApplication(id: string, partial: any) {
  const res = await apiFetch(`/api/applications/${id}`, { method: 'PUT', body: JSON.stringify(partial) });
  return res.json();
}

export async function deleteApplication(id: string) {
  const res = await apiFetch(`/api/applications/${id}`, { method: 'DELETE' });
  return res.json();
}

// OS dict
export async function fetchOsDict() {
  const res = await apiFetch('/api/system/os-dict');
  return res.json();
}

export async function saveOsDict(osList: { name: string; shortName: string }[]) {
  const res = await apiFetch('/api/system/os-dict', {
    method: 'PUT', body: JSON.stringify({ osList }),
  });
  return res.json();
}

// Server location dict
export async function fetchServerLocationDict() {
  const res = await apiFetch('/api/system/server-location-dict');
  return res.json();
}

export async function saveServerLocationDict(list: { name: string; shortName: string }[]) {
  const res = await apiFetch('/api/system/server-location-dict', {
    method: 'PUT', body: JSON.stringify({ list }),
  });
  return res.json();
}

// Decrypt credential password
export async function decryptCredentialPassword(serverId: string, credentialIndex: number, verifyPassword: string) {
  const res = await apiFetch(`${BASE}/${serverId}/decrypt-credential`, {
    method: 'POST',
    body: JSON.stringify({ verifyPassword, credentialIndex }),
  });
  return res.json();
}
