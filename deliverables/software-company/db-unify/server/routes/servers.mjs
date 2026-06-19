/**
 * 服务器资源管理 API
 * 含服务器 CRUD、子资源内联 CRUD、密码解密、批量导入、密码历史
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { getAll, getById, insert, update, remove, query, removeWhere } from '../database.mjs';
import { encryptPassword, decryptPassword } from '../crypto.mjs';

const router = Router();

const PASSWORD_FIELDS = ['password', 'bastionPassword'];
const SUB_PASSWORD_FIELDS_MAP = { dbInstances: 'password', appInstances: 'password' };

/** 密码脱敏 */
function maskPassword(val) {
  if (!val) return '';
  if (val.includes(':')) return '******'; // 已加密
  return '******';
}

/** 服务器脱敏输出 */
function sanitizeServer(s) {
  const r = { ...s };
  if (r.password_encrypted !== undefined) { r.password = maskPassword(r.password_encrypted); delete r.password_encrypted; }
  else if (r.password) r.password = maskPassword(r.password);
  if (r.bastion_password_encrypted !== undefined) { r.bastion_password = maskPassword(r.bastion_password_encrypted); delete r.bastion_password_encrypted; }
  else if (r.bastion_password) r.bastion_password = maskPassword(r.bastion_password);
  // Parse ips from JSON string
  if (r.ips && typeof r.ips === 'string') {
    try { r.ips = JSON.parse(r.ips); } catch { r.ips = []; }
  }
  // Parse credentials from JSON string
  if (r.credentials && typeof r.credentials === 'string') {
    try { r.credentials = JSON.parse(r.credentials); } catch { r.credentials = []; }
  }
  // Parse access_list from JSON string
  if (r.access_list && typeof r.access_list === 'string') {
    try { r.access_list = JSON.parse(r.access_list); } catch { r.access_list = []; }
  }
  // Mask credential passwords
  if (Array.isArray(r.credentials)) {
    r.credentials = r.credentials.map((c) => ({
      username: c.username,
      notes: c.notes || '',
      password: c.password_encrypted || c.password ? '******' : '',
    }));
  }
  return r;
}

function sanitizeDbInst(d) {
  const r = { ...d };
  if (r.password_encrypted !== undefined) { r.password = maskPassword(r.password_encrypted); delete r.password_encrypted; }
  else if (r.password) r.password = maskPassword(r.password);
  // 处理多用户凭据
  if (r.credentials && typeof r.credentials === 'string') {
    try {
      const creds = JSON.parse(r.credentials);
      r.credentials = creds.map(c => ({ username: c.username, notes: c.notes || '', schema: c.schema || '', region: c.region || '', connectionName: c.connectionName || '', password: c.password_encrypted ? '******' : maskPassword(c.password) }));
    } catch { r.credentials = []; }
  }
  return r;
}

function sanitizeAppInst(a) {
  const r = { ...a };
  if (r.password_encrypted !== undefined) { r.password = maskPassword(r.password_encrypted); delete r.password_encrypted; }
  else if (r.password) r.password = maskPassword(r.password);
  // 处理多用户凭据
  if (r.credentials && typeof r.credentials === 'string') {
    try {
      const creds = JSON.parse(r.credentials);
      r.credentials = creds.map(c => ({ username: c.username, notes: c.notes || '', password: c.password_encrypted ? '******' : maskPassword(c.password) }));
    } catch { r.credentials = []; }
  }
  return r;
}

function sanitizeMidInst(m) {
  const r = { ...m };
  if (r.password_encrypted !== undefined) { r.password = maskPassword(r.password_encrypted); delete r.password_encrypted; }
  else if (r.password) r.password = maskPassword(r.password);
  r.serviceApp = r.service_app || '';
  if (r.credentials && typeof r.credentials === 'string') {
    try {
      const creds = JSON.parse(r.credentials);
      r.credentials = creds.map(c => ({ username: c.username, notes: c.notes || '', password: c.password_encrypted ? '******' : maskPassword(c.password) }));
    } catch { r.credentials = []; }
  }
  return r;
}

function sanitizeApiInst(a) {
  const r = { ...a };
  r.apiAddress = r.api_address || '';
  r.applicationName = r.application_name || '';
  r.encrypted = r.encrypted === 1 || r.encrypted === true;
  r.encryptionMethod = r.encryption_method || '';
  r.requestExample = r.request_example || '';
  r.responseExample = r.response_example || '';
  return r;
}

/** 获取服务器的子资源 */
function getSubResources(serverId) {
  const dbInstances = query('servers_db_instances', d => d.server_id === serverId);
  const appInstances = query('servers_app_instances', a => a.server_id === serverId);
  const apiInstances = query('servers_api_instances', a => a.server_id === serverId);
  const midInstances = query('servers_mid_instances', m => m.server_id === serverId);
  const ports = query('servers_ports', p => p.server_id === serverId);
  return { dbInstances, appInstances, apiInstances, midInstances, ports };
}

/** 删除服务器的所有子资源 */
function removeSubResources(serverId) {
  removeWhere('servers_db_instances', d => d.server_id === serverId);
  removeWhere('servers_app_instances', a => a.server_id === serverId);
  removeWhere('servers_api_instances', a => a.server_id === serverId);
  removeWhere('servers_mid_instances', m => m.server_id === serverId);
  removeWhere('servers_ports', p => p.server_id === serverId);
}

/** 记录密码修改历史 */
function recordPasswordHistory(serverId, fieldName, changedBy, encryptedPassword) {
  const id = nanoid(8);
  insert('passwordHistory', {
    id, server_id: serverId, field_name: fieldName,
    password_encrypted: encryptedPassword || '',
    changed_at: new Date().toISOString(), changed_by: changedBy || 'unknown',
  });
}

// ========= 模板下载 =========

router.get('/template/download', (_req, res) => {
  // 使用 xlsx 生成模板（此处返回提示，实际使用时需集成 xlsx 生成逻辑）
  const templateUrl = '/api/servers/template/download';
  res.json({
    message: '模板下载功能需在 server 启动后通过 /api/servers/template/download.xlsx 访问',
    note: '请在前端调用此接口时添加 .xlsx 后缀，或自行使用 xlsx 包生成模板',
  });
});

// ========= 资产汇总 =========

router.get('/summary', (_req, res) => {
  const servers = getAll('servers');
  const dbInstances = getAll('servers_db_instances');
  const appInstances = getAll('servers_app_instances');

  const osDist = {};
  const serverTypeDist = {};
  const resourceGroups = {};

  for (const s of servers) {
    const os = s.os || '未知';
    osDist[os] = (osDist[os] || 0) + 1;

    const st = s.server_type || '未知';
    serverTypeDist[st] = (serverTypeDist[st] || 0) + 1;

    const key = `${s.cpu_cores || 0}C-${s.memory_gb || 0}G`;
    if (!resourceGroups[key]) resourceGroups[key] = { label: key, cpuCores: s.cpu_cores || 0, memoryGB: s.memory_gb || 0, count: 0 };
    resourceGroups[key].count++;
  }

  res.json({
    totalServers: servers.length,
    totalDbInstances: dbInstances.length,
    totalAppInstances: appInstances.length,
    osDistribution: Object.entries(osDist).map(([name, count]) => ({ name, count })),
    serverTypeDistribution: Object.entries(serverTypeDist).map(([name, count]) => ({ name, count })),
    resourceDistribution: Object.values(resourceGroups),
  });
});

// ========= 模板下载 (xlsx) =========

router.get('/template/download.xlsx', (_req, res) => {
  try {
    // 动态加载 xlsx 包
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();

    const headers = ['服务器名称', '内网IP', '外网IP', '公网IP', '跨网访问IP', '操作系统', 'CPU核数', '内存(GB)', '系统盘(GB)', '数据盘(GB)', '存储类型', '带宽(Mbps)', '服务器位置', '服务器类型', '用户名', '密码', '堡垒机地址', '堡垒机端口', '堡垒机用户名', '堡垒机密码', 'VPN信息', 'MAC地址', '部署内容', '标签', '备注', '所属项目', '所属工程', '所属应用'];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = headers.map(() => ({ wch: 15 }));
    XLSX.utils.book_append_sheet(wb, ws, '服务器资源');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="服务器资源导入模板.xlsx"');
    res.send(buf);
  } catch {
    res.status(500).json({ error: '模板生成失败' });
  }
});

// ========= 服务器 CRUD =========

router.get('/', (_req, res) => {
  const servers = getAll('servers').map(sanitizeServer);
  res.json({ servers });
});

router.get('/:id', (req, res) => {
  const s = getById('servers', req.params.id);
  if (!s) return res.status(404).json({ error: '服务器不存在' });
  const sub = getSubResources(req.params.id);
  res.json({
    server: sanitizeServer(s),
    dbInstances: sub.dbInstances.map(sanitizeDbInst),
    appInstances: sub.appInstances.map(sanitizeAppInst),
    apiInstances: sub.apiInstances.map(sanitizeApiInst),
    midInstances: sub.midInstances.map(sanitizeMidInst),
    ports: sub.ports,
  });
});

router.post('/', (req, res) => {
  const now = new Date().toISOString();
  const id = nanoid(8);
  const {
    projectId, engineeringId, applicationId, name, ips, credentials,
    internalIp, externalIp, publicIp, crossNetworkIp,
    os, cpuCores, memoryGB, systemDiskGB, dataDiskGB, storageType,
    bandwidthMbps, serverLocation, serverType,
    username, password, bastionHost, bastionPort, bastionUsername, bastionPassword,
    vpnInfo, macAddress, deployedContent, tags, notes,
    accessList,
  } = req.body;

  if (!ips || !Array.isArray(ips) || ips.length === 0) return res.status(400).json({ error: '至少需要一条IP地址信息' });

  const server = {
    id,
    project_id: projectId || null,
    engineering_id: engineeringId || null,
    application_id: applicationId || null,
    name: (name || '').trim(),
    ips: JSON.stringify(ips),
    credentials: JSON.stringify(Array.isArray(credentials) ? credentials.map((c) => ({
      username: c.username,
      password_encrypted: c.password ? encryptPassword(c.password) : '',
    })) : []),
    internal_ip: (internalIp || '').trim(),
    external_ip: (externalIp || '').trim(),
    public_ip: (publicIp || '').trim(),
    cross_network_ip: (crossNetworkIp || '').trim(),
    os: os || '',
    cpu_cores: cpuCores != null ? Number(cpuCores) : null,
    memory_gb: memoryGB != null ? Number(memoryGB) : null,
    system_disk_gb: systemDiskGB != null ? Number(systemDiskGB) : null,
    data_disk_gb: dataDiskGB != null ? Number(dataDiskGB) : null,
    storage_type: storageType || '',
    bandwidth_mbps: bandwidthMbps != null ? Number(bandwidthMbps) : null,
    server_location: serverLocation || '',
    server_type: serverType || '',
    username: (username || '').trim(),
    password_encrypted: password ? encryptPassword(password) : '',
    bastion_host: (bastionHost || '').trim(),
    bastion_port: bastionPort != null ? Number(bastionPort) : null,
    bastion_username: (bastionUsername || '').trim(),
    bastion_password_encrypted: bastionPassword ? encryptPassword(bastionPassword) : '',
    vpn_info: vpnInfo || '',
    mac_address: macAddress || '',
    deployed_content: deployedContent || '',
    tags: Array.isArray(tags) ? tags : [],
    notes: notes || '',
    access_list: JSON.stringify(Array.isArray(accessList) ? accessList : []),
    linked_connection_ids: [],
    created_at: now,
    updated_at: now,
  };

  insert('servers', server);
  res.status(201).json(sanitizeServer(server));
});

router.put('/:id', (req, res) => {
  const existing = getById('servers', req.params.id);
  if (!existing) return res.status(404).json({ error: '服务器不存在' });

  const body = req.body;
  const partial = { updated_at: new Date().toISOString() };
  const fieldMap = {
    projectId: 'project_id', engineeringId: 'engineering_id', applicationId: 'application_id',
    name: 'name', ips: 'ips', credentials: 'credentials',
    internalIp: 'internal_ip', externalIp: 'external_ip', publicIp: 'public_ip', crossNetworkIp: 'cross_network_ip',
    os: 'os', cpuCores: 'cpu_cores', memoryGB: 'memory_gb',
    systemDiskGB: 'system_disk_gb', dataDiskGB: 'data_disk_gb', storageType: 'storage_type',
    bandwidthMbps: 'bandwidth_mbps', serverLocation: 'server_location', serverType: 'server_type',
    username: 'username', bastionHost: 'bastion_host', bastionPort: 'bastion_port',
    bastionUsername: 'bastion_username', vpnInfo: 'vpn_info', macAddress: 'mac_address',
    deployedContent: 'deployed_content', tags: 'tags', notes: 'notes',
    accessList: 'access_list',
  };

  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) {
      if ((camel === 'ips' || camel === 'credentials' || camel === 'accessList') && Array.isArray(body[camel])) {
        if (camel === 'credentials') {
          // 加密凭据中的密码，记录变更历史
          const oldCredsStr = existing.credentials || '[]';
          let oldCreds = [];
          try { oldCreds = JSON.parse(oldCredsStr); } catch { oldCreds = []; }
          const newCreds = body[camel].map((c, idx) => {
            const oldPwdHash = oldCreds[idx]?.password_encrypted || '';
            if (c.password && c.password !== '******' && c.password !== oldPwdHash) {
              const enc = encryptPassword(c.password);
              recordPasswordHistory(req.params.id, `credential-${idx}-${c.username || 'unknown'}`, req.user?.username, enc);
              return { username: c.username, password_encrypted: enc };
            }
            // 保留旧加密密码或存储新明文
            if (oldCreds[idx]?.password_encrypted && (!c.password || c.password === '******')) {
              return { username: c.username, password_encrypted: oldCreds[idx].password_encrypted };
            }
            return { username: c.username, password_encrypted: c.password && c.password !== '******' ? encryptPassword(c.password) : (oldCreds[idx]?.password_encrypted || '') };
          });
          partial[snake] = JSON.stringify(newCreds);
        } else {
          partial[snake] = JSON.stringify(body[camel]);
        }
      } else {
        partial[snake] = camel.endsWith('s') ? body[camel] : (typeof body[camel] === 'string' ? body[camel].trim() : body[camel]);
      }
    }
  }

  if (body.password !== undefined && body.password !== '******' && body.password !== '') {
    const enc = encryptPassword(body.password);
    partial.password_encrypted = enc;
    recordPasswordHistory(req.params.id, 'password', req.user?.username, enc);
  }
  if (body.bastionPassword !== undefined && body.bastionPassword !== '******' && body.bastionPassword !== '') {
    const enc = encryptPassword(body.bastionPassword);
    partial.bastion_password_encrypted = enc;
    recordPasswordHistory(req.params.id, 'bastionPassword', req.user?.username, enc);
  }

  const updated = update('servers', req.params.id, partial);
  res.json(sanitizeServer(updated));
});

router.delete('/:id', (req, res) => {
  const existing = getById('servers', req.params.id);
  if (!existing) return res.status(404).json({ error: '服务器不存在' });
  removeSubResources(req.params.id);
  removeWhere('passwordHistory', h => h.server_id === req.params.id);
  remove('servers', req.params.id);
  res.json({ success: true });
});

// ========= 密码解密（需二次验证） =========

router.post('/:id/decrypt', async (req, res) => {
  const { verifyPassword } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入验证密码' });

  const isDev = process.env.NODE_ENV !== 'production';

  // 开发模式下跳过密码验证（与 authMiddleware 行为一致）
  if (!isDev) {
    const username = req.user?.username || 'admin';
    let user;

    try {
      const authMod = await import('./auth.mjs');
      const users = authMod.getUsers ? authMod.getUsers() : null;
      user = users ? users.get(username) : null;
    } catch { user = null; }

    if (!user) return res.status(400).json({ error: '用户不存在' });

    const match = await bcrypt.compare(verifyPassword, user.passwordHash);
    if (!match) return res.status(401).json({ error: '验证密码错误' });
  }

  const s = getById('servers', req.params.id);
  if (!s) return res.status(404).json({ error: '服务器不存在' });

  // 解析所有凭据
  let credentials = [];
  if (s.credentials && typeof s.credentials === 'string') {
    try { credentials = JSON.parse(s.credentials); } catch { credentials = []; }
  }

  const resultCredentials = credentials.map(cred => ({
    username: cred.username || '',
    password: cred.password_encrypted ? decryptPassword(cred.password_encrypted) : (cred.password || ''),
  }));

  // 兼容旧数据：还没迁移到 credentials 数组的顶层字段
  if (resultCredentials.length === 0) {
    const username = s.username || '';
    const password = s.password_encrypted ? decryptPassword(s.password_encrypted) : '';
    if (username || password) {
      resultCredentials.push({ username, password });
    }
  }

  const result = { credentials: resultCredentials };

  if (s.bastion_password_encrypted) result.bastionPassword = decryptPassword(s.bastion_password_encrypted);
  if (s.bastion_username) result.bastionUsername = s.bastion_username;

  res.json(result);
});

// ========= 凭据密码解密 =========

router.post('/:id/decrypt-credential', async (req, res) => {
  const { verifyPassword, credentialIndex } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入验证密码' });
  if (credentialIndex === undefined || credentialIndex === null) return res.status(400).json({ error: '请指定凭据索引' });

  // 使用二次验证密码（而非登录密码）
  const configs = getAll('systemConfig');
  const config = configs.length > 0 ? configs[0] : {};
  if (!config.secondary_password_hash) {
    return res.status(400).json({ error: '尚未设置二次验证密码，请先在系统设置中设置' });
  }

  const match = await bcrypt.compare(verifyPassword, config.secondary_password_hash);
  if (!match) return res.status(401).json({ error: '二次验证密码错误' });

  const s = getById('servers', req.params.id);
  if (!s) return res.status(404).json({ error: '服务器不存在' });

  let credentials = [];
  if (s.credentials && typeof s.credentials === 'string') {
    try { credentials = JSON.parse(s.credentials); } catch { credentials = []; }
  }
  if (!credentials[credentialIndex]) return res.status(404).json({ error: '凭据不存在' });

  const cred = credentials[credentialIndex];
  const result = { username: cred.username, password: '' };
  if (cred.password_encrypted) {
    result.password = decryptPassword(cred.password_encrypted);
  } else if (cred.password) {
    // 明文密码（兼容旧数据）
    result.password = cred.password;
  }

  res.json(result);
});

// ========= 密码历史 =========

router.get('/:id/password-history', (req, res) => {
  const { fieldName } = req.query;
  let items = query('passwordHistory', h => h.server_id === req.params.id);
  if (fieldName) items = items.filter(h => h.field_name === fieldName);
  items.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  res.json({ history: items });
});

// 解密密码历史（需二次验证）
router.post('/:id/password-history/decrypt', async (req, res) => {
  const { verifyPassword, fieldName } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入二次验证密码' });

  const configs = getAll('systemConfig');
  const config = configs.length > 0 ? configs[0] : {};
  if (!config.secondary_password_hash) {
    return res.status(400).json({ error: '尚未设置二次验证密码' });
  }

  const match = await bcrypt.compare(verifyPassword, config.secondary_password_hash);
  if (!match) return res.status(401).json({ error: '二次验证密码错误' });

  let items = query('passwordHistory', h => h.server_id === req.params.id);
  if (fieldName) items = items.filter(h => h.field_name === fieldName);
  items.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));

  const decrypted = items.map(item => ({
    ...item,
    password: item.password_encrypted ? decryptPassword(item.password_encrypted) : null,
    password_encrypted: undefined,
  }));

  res.json({ history: decrypted });
});

/**
 * 检查端口在同一服务器下是否已被其他资源占用
 * @param {string} serverId
 * @param {*} port
 * @param {string} excludeTable - 编辑时排除自身所在的表
 * @param {string} excludeId - 编辑时排除自身的记录ID
 * @returns {{ conflict: boolean, resourceType?: string, resourceName?: string }}
 */
function checkPortUnique(serverId, port, excludeTable, excludeId) {
  if (port == null || port === '') return { conflict: false };
  const portNum = Number(port);
  const tables = [
    { collection: 'servers_ports', type: '端口', nameKey: 'service_name' },
    { collection: 'servers_db_instances', type: '数据库实例', nameKey: 'db_name' },
    { collection: 'servers_app_instances', type: '应用实例', nameKey: 'name' },
    { collection: 'servers_api_instances', type: 'API实例', nameKey: 'api_address' },
    { collection: 'servers_mid_instances', type: '中间件实例', nameKey: 'name' },
  ];
  for (const t of tables) {
    const records = query(t.collection, r =>
      r.server_id === serverId && r.port === portNum &&
      !(excludeTable === t.collection && r.id === excludeId)
    );
    if (records.length > 0) {
      return { conflict: true, resourceType: t.type, resourceName: records[0][t.nameKey] || '' };
    }
  }
  return { conflict: false };
}

// ========= 数据库实例子资源 CRUD =========

router.post('/:id/db-instances', (req, res) => {
  try {
    const server = getById('servers', req.params.id);
    if (!server) return res.status(404).json({ error: '服务器不存在' });
    const { dbType, version, dbName, schema, username, password, credentials, internalIp, externalIp, port, notes } = req.body;
    if (!dbType || !dbName || !port) {
      return res.status(400).json({ error: '数据库类型/库名/端口不能为空' });
    }
    const portCheck = checkPortUnique(req.params.id, port);
    if (portCheck.conflict) {
      return res.status(409).json({ error: `端口 ${port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
    }
    const hasCreds = Array.isArray(credentials) && credentials.length > 0 && credentials.some(c => c.username?.trim());
    const hasSingle = username?.trim() && password;
    if (!hasCreds && !hasSingle) {
      return res.status(400).json({ error: '请至少填写一组用户名和密码' });
    }
    const now = new Date().toISOString();
    // 构建 credentials JSON（含 schema）
    let credsJson = '';
    if (hasCreds) {
      const validCreds = credentials
        .filter(c => c.username?.trim())
        .map(c => ({ username: c.username.trim(), notes: c.notes || '', schema: c.schema || '', region: c.region || '', connectionName: c.connectionName || '', password_encrypted: c.password ? encryptPassword(c.password) : '' }));
      credsJson = JSON.stringify(validCreds);
      // 记录每个凭据的密码历史
      validCreds.filter(c => c.password_encrypted).forEach(c => {
        try {
          recordPasswordHistory(req.params.id, `dbInstance-${dbName}-cred-${c.username}`, req.user?.username, c.password_encrypted);
        } catch (histErr) {
          console.error('[db-instance] 记录密码历史失败:', histErr.message);
        }
      });
    } else {
      const singlePwdEncrypted = encryptPassword(password);
      credsJson = JSON.stringify([{ username: username.trim(), notes: notes || '', schema: schema || '', region: '', connectionName: '', password_encrypted: singlePwdEncrypted }]);
      try {
        recordPasswordHistory(req.params.id, `dbInstance-${dbName}`, req.user?.username, singlePwdEncrypted);
      } catch (histErr) {
        console.error('[db-instance] 记录密码历史失败:', histErr.message);
      }
    }
    const firstSchema = hasCreds ? (credentials.find(c => c.username?.trim())?.schema || '') : (schema || '');
    const inst = {
      id: nanoid(8), server_id: req.params.id,
      db_type: dbType, version: version || '', db_name: dbName,
      schema_name: firstSchema, username: hasCreds ? credentials[0]?.username || '' : username,
      password_encrypted: '',
      credentials: credsJson,
      internal_ip: internalIp || '', external_ip: externalIp || '',
      port: Number(port), notes: notes || '',
      created_at: now, updated_at: now,
    };
    insert('servers_db_instances', inst);
    res.status(201).json(sanitizeDbInst(inst));
  } catch (err) {
    console.error('[db-instance] 创建数据库实例失败:', err);
    res.status(500).json({ error: '创建数据库实例失败: ' + (err.message || '未知错误') });
  }
});

router.put('/:id/db-instances/:di', (req, res) => {
  const inst = getById('servers_db_instances', req.params.di);
  if (!inst) return res.status(404).json({ error: '数据库实例不存在' });
  const body = req.body;
  // 端口重复检查（仅在端口变更时）
  if (body.port !== undefined && Number(body.port) !== inst.port) {
    const portCheck = checkPortUnique(req.params.id, body.port, 'servers_db_instances', req.params.di);
    if (portCheck.conflict) {
      return res.status(409).json({ error: `端口 ${body.port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
    }
  }
  const partial = { updated_at: new Date().toISOString() };
  const fieldMap = { dbType: 'db_type', version: 'version', dbName: 'db_name', schema: 'schema_name', username: 'username', internalIp: 'internal_ip', externalIp: 'external_ip', port: 'port', notes: 'notes' };
  for (const [camel, snake] of Object.entries(fieldMap)) {
    if (body[camel] !== undefined) partial[snake] = typeof body[camel] === 'string' ? body[camel].trim() : body[camel];
  }
  // 处理多用户凭据
  if (body.credentials !== undefined && Array.isArray(body.credentials)) {
    const creds = body.credentials.filter(c => c.username?.trim());
    // 解析旧凭据用于保留未修改的密码
    let oldCredsArr = [];
    if (inst.credentials) {
      try { oldCredsArr = JSON.parse(inst.credentials); } catch { oldCredsArr = []; }
    }
    partial.credentials = JSON.stringify(creds.map(c => {
      const oldFound = oldCredsArr.find(oc => oc.username === c.username);
      const oldPwdEncrypted = oldFound?.password_encrypted || '';
      const newPwdEncrypted = c.password && c.password !== '******' ? encryptPassword(c.password) : oldPwdEncrypted;
      return {
        username: c.username.trim(),
        notes: c.notes || '',
        schema: c.schema || '',
        region: c.region || '',
        connectionName: c.connectionName || '',
        password_encrypted: newPwdEncrypted,
      };
    }));
    // 记录每个凭据的密码历史
    creds.forEach(c => {
      if (c.password && c.password !== '******') {
        recordPasswordHistory(req.params.id, `dbInstance-${inst.db_name}-cred-${c.username.trim()}`, req.user?.username, encryptPassword(c.password));
      }
    });
  } else if (body.password !== undefined && body.password !== '******') {
    partial.password_encrypted = encryptPassword(body.password);
    recordPasswordHistory(req.params.id, `dbInstance-${inst.db_name}`, req.user?.username, partial.password_encrypted);
  }
  const updated = update('servers_db_instances', req.params.di, partial);
  res.json(sanitizeDbInst(updated));
});

router.delete('/:id/db-instances/:di', (req, res) => {
  const inst = getById('servers_db_instances', req.params.di);
  if (!inst) return res.status(404).json({ error: '数据库实例不存在' });
  remove('servers_db_instances', req.params.di);
  res.json({ success: true });
});

// ========= 应用实例子资源 CRUD =========

router.post('/:id/app-instances', (req, res) => {
  const server = getById('servers', req.params.id);
  if (!server) return res.status(404).json({ error: '服务器不存在' });
  const { name, port, contactPerson, contactPhone, url, username, password, credentials, notes } = req.body;
  if (!name || !url) return res.status(400).json({ error: '应用名称和URL不能为空' });
  if (port != null && port !== '') {
    const portCheck = checkPortUnique(req.params.id, port);
    if (portCheck.conflict) {
      return res.status(409).json({ error: `端口 ${port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
    }
  }
  const now = new Date().toISOString();
  // 构建 credentials JSON
  const hasCreds = Array.isArray(credentials) && credentials.length > 0 && credentials.some(c => c.username?.trim());
  const hasSingle = username?.trim() && password;
  let credsJson = '';
  let primaryUser = username || '';
  if (hasCreds) {
    credsJson = JSON.stringify(credentials
      .filter(c => c.username?.trim())
      .map(c => ({ username: c.username.trim(), notes: c.notes || '', password_encrypted: c.password ? encryptPassword(c.password) : '' })));
    primaryUser = credentials[0]?.username || '';
  } else if (hasSingle) {
    credsJson = JSON.stringify([{ username: username.trim(), notes: notes || '', password_encrypted: encryptPassword(password) }]);
    primaryUser = username.trim();
  }
  const inst = {
    id: nanoid(8), server_id: req.params.id,
    name, port: port != null ? Number(port) : null,
    contact_person: contactPerson || '',
    contact_phone: contactPhone || '',
    url, username: primaryUser,
    password_encrypted: '',
    credentials: credsJson,
    notes: notes || '',
    created_at: now, updated_at: now,
  };
  insert('servers_app_instances', inst);
  res.status(201).json(sanitizeAppInst(inst));
});

router.put('/:id/app-instances/:ai', (req, res) => {
  const inst = getById('servers_app_instances', req.params.ai);
  if (!inst) return res.status(404).json({ error: '应用实例不存在' });
  const body = req.body;
  // 端口重复检查（仅在端口变更且非空时）
  if (body.port !== undefined && body.port != null && Number(body.port) !== inst.port) {
    const portCheck = checkPortUnique(req.params.id, body.port, 'servers_app_instances', req.params.ai);
    if (portCheck.conflict) {
      return res.status(409).json({ error: `端口 ${body.port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
    }
  }
  const partial = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) partial.name = body.name;
  if (body.port !== undefined) partial.port = body.port != null ? Number(body.port) : null;
  if (body.contactPerson !== undefined) partial.contact_person = body.contactPerson;
  if (body.contactPhone !== undefined) partial.contact_phone = body.contactPhone;
  if (body.url !== undefined) partial.url = body.url;
  if (body.username !== undefined) partial.username = body.username;
  if (body.notes !== undefined) partial.notes = body.notes;
  // 处理多用户凭据
  if (body.credentials !== undefined && Array.isArray(body.credentials)) {
    const creds = body.credentials.filter(c => c.username?.trim());
    partial.credentials = JSON.stringify(creds.map(c => ({
      username: c.username.trim(),
      notes: c.notes || '',
      password_encrypted: c.password && c.password !== '******' ? encryptPassword(c.password) : (inst.credentials ? (() => { try { const oldCreds = JSON.parse(inst.credentials); const found = oldCreds.find(oc => oc.username === c.username); return found?.password_encrypted || ''; } catch { return ''; } })() : ''),
    })));
    recordPasswordHistory(req.params.id, `appInstance-${inst.name}`, req.user?.username);
  } else if (body.password !== undefined && body.password !== '******') {
    partial.password_encrypted = encryptPassword(body.password);
    recordPasswordHistory(req.params.id, `appInstance-${inst.name}`, req.user?.username);
  }
  const updated = update('servers_app_instances', req.params.ai, partial);
  res.json(sanitizeAppInst(updated));
});

router.delete('/:id/app-instances/:ai', (req, res) => {
  const inst = getById('servers_app_instances', req.params.ai);
  if (!inst) return res.status(404).json({ error: '应用实例不存在' });
  remove('servers_app_instances', req.params.ai);
  res.json({ success: true });
});

// ========= 中间件实例子资源 CRUD =========

router.post('/:id/mid-instances', (req, res) => {
  const server = getById('servers', req.params.id);
  if (!server) return res.status(404).json({ error: '服务器不存在' });
  const { name, port, type, version, url, username, password, credentials, notes, serviceApp } = req.body;
  if (!name || !type) return res.status(400).json({ error: '名称和类型不能为空' });
  if (port != null && port !== '') {
    const portCheck = checkPortUnique(req.params.id, port);
    if (portCheck.conflict) {
      return res.status(409).json({ error: `端口 ${port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
    }
  }
  const now = new Date().toISOString();
  const hasCreds = Array.isArray(credentials) && credentials.length > 0 && credentials.some(c => c.username?.trim());
  const hasSingle = username?.trim() && password;
  let credsJson = '';
  let primaryUser = username || '';
  if (hasCreds) {
    credsJson = JSON.stringify(credentials
      .filter(c => c.username?.trim())
      .map(c => ({ username: c.username.trim(), notes: c.notes || '', password_encrypted: c.password ? encryptPassword(c.password) : '' })));
    primaryUser = credentials[0]?.username || '';
  } else if (hasSingle) {
    credsJson = JSON.stringify([{ username: username.trim(), notes: notes || '', password_encrypted: encryptPassword(password) }]);
    primaryUser = username.trim();
  }
  const inst = {
    id: nanoid(8), server_id: req.params.id,
    name, port: port != null ? Number(port) : null,
    type: type || '', version: version || '',
    url: url || '', service_app: serviceApp || '', username: primaryUser,
    password_encrypted: '',
    credentials: credsJson,
    notes: notes || '',
    created_at: now, updated_at: now,
  };
  insert('servers_mid_instances', inst);
  res.status(201).json(sanitizeMidInst(inst));
});

router.put('/:id/mid-instances/:mi', (req, res) => {
  const inst = getById('servers_mid_instances', req.params.mi);
  if (!inst) return res.status(404).json({ error: '中间件实例不存在' });
  const body = req.body;
  // 端口重复检查（仅在端口变更且非空时）
  if (body.port !== undefined && body.port != null && Number(body.port) !== inst.port) {
    const portCheck = checkPortUnique(req.params.id, body.port, 'servers_mid_instances', req.params.mi);
    if (portCheck.conflict) {
      return res.status(409).json({ error: `端口 ${body.port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
    }
  }
  const partial = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) partial.name = body.name;
  if (body.port !== undefined) partial.port = body.port != null ? Number(body.port) : null;
  if (body.type !== undefined) partial.type = body.type;
  if (body.version !== undefined) partial.version = body.version;
  if (body.url !== undefined) partial.url = body.url;
  if (body.serviceApp !== undefined) partial.service_app = body.serviceApp;
  if (body.username !== undefined) partial.username = body.username;
  if (body.notes !== undefined) partial.notes = body.notes;
  if (body.credentials !== undefined) {
    partial.credentials = JSON.stringify(body.credentials.filter(c => c.username?.trim()).map(c => ({
      username: c.username.trim(),
      notes: c.notes || '',
      password_encrypted: c.password && c.password !== '******' ? encryptPassword(c.password) : (inst.credentials ? (() => { try { const oldCreds = JSON.parse(inst.credentials); const found = oldCreds.find(oc => oc.username === c.username); return found?.password_encrypted || ''; } catch { return ''; } })() : ''),
    })));
    recordPasswordHistory(req.params.id, `midInstance-${inst.name}`, req.user?.username);
  } else if (body.password !== undefined && body.password !== '******') {
    partial.password_encrypted = encryptPassword(body.password);
    recordPasswordHistory(req.params.id, `midInstance-${inst.name}`, req.user?.username);
  }
  const updated = update('servers_mid_instances', req.params.mi, partial);
  res.json(sanitizeMidInst(updated));
});

router.delete('/:id/mid-instances/:mi', (req, res) => {
  const inst = getById('servers_mid_instances', req.params.mi);
  if (!inst) return res.status(404).json({ error: '中间件实例不存在' });
  remove('servers_mid_instances', req.params.mi);
  res.json({ success: true });
});

// ========= API 实例子资源 CRUD =========

router.post('/:id/api-instances', (req, res) => {
  try {
    const server = getById('servers', req.params.id);
    if (!server) return res.status(404).json({ error: '服务器不存在' });
    const { apiAddress, port, applicationName, encrypted, encryptionMethod, requestExample, responseExample, notes } = req.body;
    if (!apiAddress || !applicationName) {
      return res.status(400).json({ error: 'API地址和所属应用不能为空' });
    }
    // 端口冲突检查
    if (port != null && port !== '') {
      const portCheck = checkPortUnique(req.params.id, port);
      if (portCheck.conflict) {
        return res.status(409).json({ error: `端口 ${port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
      }
    }
    const now = new Date().toISOString();
    const inst = {
      id: nanoid(8), server_id: req.params.id,
      api_address: apiAddress,
      port: port != null ? Number(port) : null,
      application_name: applicationName,
      encrypted: encrypted ? 1 : 0,
      encryption_method: encryptionMethod || '',
      request_example: requestExample || '',
      response_example: responseExample || '',
      notes: notes || '',
      created_at: now, updated_at: now,
    };
    insert('servers_api_instances', inst);
    res.status(201).json(sanitizeApiInst(inst));
  } catch (err) {
    console.error('[api-instance] 创建API实例失败:', err);
    res.status(500).json({ error: '创建API实例失败: ' + (err.message || '未知错误') });
  }
});

router.put('/:id/api-instances/:ai', (req, res) => {
  try {
    const inst = getById('servers_api_instances', req.params.ai);
    if (!inst) return res.status(404).json({ error: 'API实例不存在' });
    const body = req.body;
    // 端口重复检查（仅在端口变更且非空时）
    if (body.port !== undefined && body.port != null && Number(body.port) !== inst.port) {
      const portCheck = checkPortUnique(req.params.id, body.port, 'servers_api_instances', req.params.ai);
      if (portCheck.conflict) {
        return res.status(409).json({ error: `端口 ${body.port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
      }
    }
    const partial = { updated_at: new Date().toISOString() };
    if (body.apiAddress !== undefined) partial.api_address = body.apiAddress;
    if (body.port !== undefined) partial.port = body.port != null ? Number(body.port) : null;
    if (body.applicationName !== undefined) partial.application_name = body.applicationName;
    if (body.encrypted !== undefined) partial.encrypted = body.encrypted ? 1 : 0;
    if (body.encryptionMethod !== undefined) partial.encryption_method = body.encryptionMethod;
    if (body.requestExample !== undefined) partial.request_example = body.requestExample;
    if (body.responseExample !== undefined) partial.response_example = body.responseExample;
    if (body.notes !== undefined) partial.notes = body.notes;
    const updated = update('servers_api_instances', req.params.ai, partial);
    res.json(sanitizeApiInst(updated));
  } catch (err) {
    console.error('[api-instance] 更新API实例失败:', err);
    res.status(500).json({ error: '更新API实例失败: ' + (err.message || '未知错误') });
  }
});

router.delete('/:id/api-instances/:ai', (req, res) => {
  const inst = getById('servers_api_instances', req.params.ai);
  if (!inst) return res.status(404).json({ error: 'API实例不存在' });
  remove('servers_api_instances', req.params.ai);
  res.json({ success: true });
});

// ========= 端口信息子资源 CRUD =========

router.post('/:id/ports', (req, res) => {
  const server = getById('servers', req.params.id);
  if (!server) return res.status(404).json({ error: '服务器不存在' });
  const { port, protocol, serviceName, notes, type } = req.body;
  if (!port || !serviceName) return res.status(400).json({ error: '端口号和服务名称不能为空' });
  const portCheck = checkPortUnique(req.params.id, port);
  if (portCheck.conflict) {
    return res.status(409).json({ error: `端口 ${port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
  }
  const now = new Date().toISOString();
  const p = {
    id: nanoid(8), server_id: req.params.id,
    port: Number(port), protocol: protocol || 'TCP',
    type: type || '', service_name: serviceName, notes: notes || '',
    created_at: now, updated_at: now,
  };
  insert('servers_ports', p);
  res.status(201).json(p);
});

router.put('/:id/ports/:pi', (req, res) => {
  const existing = getById('servers_ports', req.params.pi);
  if (!existing) return res.status(404).json({ error: '端口记录不存在' });
  const body = req.body;
  // 端口重复检查（仅在端口变更时）
  if (body.port !== undefined && Number(body.port) !== existing.port) {
    const portCheck = checkPortUnique(req.params.id, body.port, 'servers_ports', req.params.pi);
    if (portCheck.conflict) {
      return res.status(409).json({ error: `端口 ${body.port} 已被${portCheck.resourceType}「${portCheck.resourceName}」占用` });
    }
  }
  const partial = { updated_at: new Date().toISOString() };
  if (body.port !== undefined) partial.port = Number(body.port);
  if (body.protocol !== undefined) partial.protocol = body.protocol;
  if (body.type !== undefined) partial.type = body.type;
  if (body.serviceName !== undefined) partial.service_name = body.serviceName;
  if (body.notes !== undefined) partial.notes = body.notes;
  const updated = update('servers_ports', req.params.pi, partial);
  res.json(updated);
});

router.delete('/:id/ports/:pi', (req, res) => {
  const existing = getById('servers_ports', req.params.pi);
  if (!existing) return res.status(404).json({ error: '端口记录不存在' });
  remove('servers_ports', req.params.pi);
  res.json({ success: true });
});

// ========= 批量导入 =========

router.post('/import', (req, res) => {
  const { servers } = req.body;
  if (!Array.isArray(servers) || servers.length === 0) {
    return res.status(400).json({ error: '请提供有效的服务器列表' });
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;
  const now = new Date().toISOString();

  for (const item of servers) {
    const row = (item.row !== undefined ? item.row : results.length + 1);
    try {
      const { name, internalIp, externalIp, publicIp, crossNetworkIp, os, cpuCores, memoryGB,
        systemDiskGB, dataDiskGB, storageType, bandwidthMbps, serverLocation, serverType,
        username, password, bastionHost, bastionPort, bastionUsername, bastionPassword,
        vpnInfo, macAddress, deployedContent, tags, notes, projectId, engineeringId, applicationId } = item;

      if (!name || !internalIp) {
        results.push({ row, name: name || '(空)', status: 'failed', error: '服务器名称和内网IP不能为空' });
        failCount++;
        continue;
      }

      const id = nanoid(8);
      const server = {
        id,
        application_id: applicationId || null,
        name: name.trim(),
        internal_ip: (internalIp || '').trim(),
        external_ip: (externalIp || '').trim(),
        public_ip: (publicIp || '').trim(),
        cross_network_ip: (crossNetworkIp || '').trim(),
        os: os || '',
        cpu_cores: cpuCores != null ? Number(cpuCores) : null,
        memory_gb: memoryGB != null ? Number(memoryGB) : null,
        system_disk_gb: systemDiskGB != null ? Number(systemDiskGB) : null,
        data_disk_gb: dataDiskGB != null ? Number(dataDiskGB) : null,
        storage_type: storageType || '',
        bandwidth_mbps: bandwidthMbps != null ? Number(bandwidthMbps) : null,
        server_location: serverLocation || '',
        server_type: serverType || '',
        username: (username || '').trim(),
        password_encrypted: password ? encryptPassword(String(password)) : '',
        bastion_host: (bastionHost || '').trim(),
        bastion_port: bastionPort != null ? Number(bastionPort) : null,
        bastion_username: (bastionUsername || '').trim(),
        bastion_password_encrypted: bastionPassword ? encryptPassword(String(bastionPassword)) : '',
        vpn_info: vpnInfo || '',
        mac_address: macAddress || '',
        deployed_content: deployedContent || '',
        tags: Array.isArray(tags) ? tags : [],
        notes: notes || '',
        linked_connection_ids: [],
        created_at: now,
        updated_at: now,
      };

      insert('servers', server);
      results.push({ row, name, status: 'created', id });
      successCount++;
    } catch (err) {
      results.push({ row, name: item.name || '(空)', status: 'failed', error: err.message });
      failCount++;
    }
  }

  res.json({ total: servers.length, success: successCount, failed: failCount, results });
});

export default router;
