/**
 * 服务器资源管理 API
 * 含服务器 CRUD、子资源内联 CRUD、密码解密、批量导入、密码历史
 */
import { Router } from 'express';
import { nanoid } from 'nanoid';
import bcrypt from 'bcryptjs';
import { getAll, getById, insert, update, remove, query, removeWhere } from '../database.mjs';
import { encryptPassword, decryptPassword } from '../crypto.mjs';
import XLSX from 'xlsx';

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
  // 集群字段转换为 camelCase
  r.isCluster = r.is_cluster === 1;
  r.clusterIps = r.cluster_ips || '';
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
async function getSubResources(serverId) {
  const dbInstances = await query('servers_db_instances', d => d.server_id === serverId);
  const appInstances = await query('servers_app_instances', a => a.server_id === serverId);
  const apiInstances = await query('servers_api_instances', a => a.server_id === serverId);
  const midInstances = await query('servers_mid_instances', m => m.server_id === serverId);
  const ports = await query('servers_ports', p => p.server_id === serverId);
  return { dbInstances, appInstances, apiInstances, midInstances, ports };
}

/** 删除服务器的所有子资源 */
async function removeSubResources(serverId) {
  await removeWhere('servers_db_instances', d => d.server_id === serverId);
  await removeWhere('servers_app_instances', a => a.server_id === serverId);
  await removeWhere('servers_api_instances', a => a.server_id === serverId);
  await removeWhere('servers_mid_instances', m => m.server_id === serverId);
  await removeWhere('servers_ports', p => p.server_id === serverId);
}

/** 记录密码修改历史 */
async function recordPasswordHistory(serverId, fieldName, changedBy, encryptedPassword) {
  const id = nanoid(8);
  await insert('passwordHistory', {
    id, server_id: serverId, field_name: fieldName,
    password_encrypted: encryptedPassword || '',
    changed_at: new Date().toISOString(), changed_by: changedBy || 'unknown',
  });
}

// ========= 模板下载 =========

router.get('/template/download', (_req, res) => {
  res.redirect('/api/servers/template/download.xlsx');
});

// ========= 资产汇总 =========

router.get('/summary', async (_req, res) => {
  const servers = await getAll('servers');
  const dbInstances = await getAll('servers_db_instances');
  const appInstances = await getAll('servers_app_instances');

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

// ========= 辅助：构建 Sheet =========

function buildSheet(headers, exampleRow, comments) {
  const ws = XLSX.utils.aoa_to_sheet([headers, exampleRow]);
  ws['!cols'] = headers.map(() => ({ wch: 18 }));
  if (comments) {
    // 在行首添加注释标识（以 # 开头的行为注释，导入时自动跳过）
    const commentRows = comments.map(c => ['# ' + c]);
    const data = [...commentRows, headers, exampleRow];
    const ws2 = XLSX.utils.aoa_to_sheet(data);
    ws2['!cols'] = headers.map(() => ({ wch: 18 }));
    return ws2;
  }
  return ws;
}

// ========= 模板下载 (xlsx) =========

router.get('/template/download.xlsx', (_req, res) => {
  try {
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: 服务器资源 ──
    const srvHeaders = [
      '服务器名称', '服务器类型', '操作系统', 'MAC地址',
      'IP地址', 'IP类型', '映射端口', '映射IP', '带宽(Mbps)',
      'CPU核数', '内存(GB)', '系统盘(GB)', '数据盘(GB)', '存储类型',
      '凭据用户名1', '凭据密码1', '凭据用户名2', '凭据密码2',
      '堡垒机地址', '堡垒机端口', '堡垒机用户名', '堡垒机密码', 'VPN信息',
      '所属项目', '所属工程', '所属应用',
      '部署内容', '服务器位置', '标签', '备注',
    ];
    const srvExample = [
      '示例服务器01', '应用服务器', 'CentOS 7.9', '00:1A:2B:3C:4D:5E',
      '192.168.1.100', '局域', 3306, '10.0.0.10', 100,
      8, 32, 100, 500, 'SSD',
      'admin', 'Password1!', 'root', '',
      '192.168.1.254', 22, 'ops', '', '',
      '示例项目', '示例工程', '示例应用',
      'Nginx,Java应用', '北京-朝阳-A机房', '生产环境,核心业务', '示例备注',
    ];
    XLSX.utils.book_append_sheet(wb, buildSheet(srvHeaders, srvExample), '服务器资源');

    // ── Sheet 2: 数据库实例 ──
    const dbHeaders = [
      '服务器名称', '数据库类型', '版本', '数据库名', 'Schema', '端口', '用户名', '密码', '内网IP', '外网IP', '是否集群', '集群其他IP', '备注',
    ];
    const dbExample = [
      '示例服务器01', 'MySQL', '8.0.33', 'his_db', 'public', 3306, 'root', '', '192.168.1.100', '', '是', '10.0.0.2, 10.0.0.3', '核心业务库',
    ];
    const dbComments = [
      '服务器名称：关联"服务器资源"Sheet中的服务器名称，必填',
      '数据库类型：如 MySQL / PostgreSQL / Oracle / SQLServer / Redis / MongoDB',
      '数据库名：数据库实例名称，必填',
      'Schema：数据库模式名，选填',
      '端口：数据库端口号，必填',
      '密码：导入后自动加密存储',
      '是否集群：填写"是"或"否"，默认为否',
      '集群其他IP：如果是否集群为是，填写集群其他节点IP，多个用英文逗号分隔',
    ];
    XLSX.utils.book_append_sheet(wb, buildSheet(dbHeaders, dbExample, dbComments), '数据库实例');

    // ── Sheet 3: 应用实例 ──
    const appHeaders = [
      '服务器名称', '应用名称', '端口', 'URL', '联系人', '联系电话', '用户名', '密码', '备注',
    ];
    const appExample = [
      '示例服务器01', 'HIS门诊系统', 8080, 'http://192.168.1.100:8080/his', '张三', '13800138000', 'admin', '', '门诊业务系统',
    ];
    const appComments = [
      '服务器名称：关联"服务器资源"Sheet中的服务器名称，必填',
      '应用名称：必填',
      'URL：应用访问地址，必填',
      '密码：导入后自动加密存储',
    ];
    XLSX.utils.book_append_sheet(wb, buildSheet(appHeaders, appExample, appComments), '应用实例');

    // ── Sheet 4: API实例 ──
    const apiHeaders = [
      '服务器名称', 'API地址', '端口', '所属应用', '是否加密', '加密方式', '请求示例', '响应示例', '备注',
    ];
    const apiExample = [
      '示例服务器01', '/api/v1/patients', 8080, 'HIS门诊系统', '是', 'AES256', '', '', '患者信息查询接口',
    ];
    const apiComments = [
      '服务器名称：关联"服务器资源"Sheet中的服务器名称，必填',
      'API地址：接口路径，必填',
      '所属应用：应用名称，必填',
      '是否加密：填写"是"或"否"',
    ];
    XLSX.utils.book_append_sheet(wb, buildSheet(apiHeaders, apiExample, apiComments), 'API实例');

    // ── Sheet 5: 中间件实例 ──
    const midHeaders = [
      '服务器名称', '名称', '端口', '类型', '版本', 'URL', '服务应用', '用户名', '密码', '备注',
    ];
    const midExample = [
      '示例服务器01', 'Nginx-01', 80, 'Nginx', '1.24.0', 'http://192.168.1.100:80', 'HIS门诊系统', 'admin', '', '反向代理',
    ];
    const midComments = [
      '服务器名称：关联"服务器资源"Sheet中的服务器名称，必填',
      '名称和类型：必填',
      '密码：导入后自动加密存储',
    ];
    XLSX.utils.book_append_sheet(wb, buildSheet(midHeaders, midExample, midComments), '中间件实例');

    // ── 填写说明 Sheet ──
    const notesData = [
      ['Sheet名称', '字段名', '是否必填', '填写说明'],
      ['服务器资源', '服务器名称', '是', '服务器唯一标识（其他Sheet通过此名称关联）'],
      ['服务器资源', 'IP地址', '是', '服务器IP地址'],
      ['服务器资源', 'IP类型', '否', '局域 / 政务外 / 政务内 / 互联网'],
      ['服务器资源', '映射端口', '否', '端口映射，纯数字'],
      ['服务器资源', '映射IP', '否', 'NAT映射后的IP地址'],
      ['服务器资源', '服务器类型', '否', '如：应用服务器、数据库服务器、中间件服务器等'],
      ['服务器资源', '操作系统', '否', '如：CentOS 7.9、Windows Server 2019、Ubuntu 22.04'],
      ['服务器资源', 'MAC地址', '否', '物理地址，格式 XX:XX:XX:XX:XX:XX'],
      ['服务器资源', '外网IP', '否', '政务外网 IP'],
      ['服务器资源', '公网IP', '否', '互联网公网 IP'],
      ['服务器资源', '跨网访问IP', '否', '跨网段访问 IP'],
      ['服务器资源', '带宽(Mbps)', '否', '纯数字'],
      ['服务器资源', 'CPU核数', '否', '纯数字，如 8'],
      ['服务器资源', '内存(GB)', '否', '纯数字，如 32'],
      ['服务器资源', '系统盘(GB)', '否', '纯数字，如 100'],
      ['服务器资源', '数据盘(GB)', '否', '纯数字，如 500'],
      ['服务器资源', '存储类型', '否', '如 SSD / HDD / NVMe'],
      ['服务器资源', '凭据用户名1', '否', '第一组登录凭据用户名'],
      ['服务器资源', '凭据密码1', '否', '导入后自动加密存储'],
      ['服务器资源', '凭据用户名2', '否', '第二组登录凭据用户名'],
      ['服务器资源', '凭据密码2', '否', '导入后自动加密存储'],
      ['服务器资源', '堡垒机地址', '否', '堡垒机 IP 或域名'],
      ['服务器资源', '堡垒机端口', '否', '纯数字，如 22'],
      ['服务器资源', '堡垒机用户名', '否', '堡垒机登录用户名'],
      ['服务器资源', '堡垒机密码', '否', '导入后自动加密存储'],
      ['服务器资源', 'VPN信息', '否', 'VPN连接信息'],
      ['服务器资源', '所属项目', '否', '项目名称'],
      ['服务器资源', '所属工程', '否', '工程名称'],
      ['服务器资源', '所属应用', '否', '应用名称'],
      ['服务器资源', '部署内容', '否', '服务器上部署的服务/应用'],
      ['服务器资源', '服务器位置', '否', '物理位置，如：北京-朝阳-A机房'],
      ['服务器资源', '标签', '否', '多个标签用英文逗号分隔'],
      ['服务器资源', '备注', '否', '补充说明'],
      ['', '', '', ''],
      ['数据库实例', '服务器名称', '是', '关联到服务器资源Sheet中的服务器名称'],
      ['数据库实例', '数据库类型', '是', 'MySQL / PostgreSQL / Oracle / SQLServer / Redis / MongoDB 等'],
      ['数据库实例', '数据库名', '是', '数据库实例名'],
      ['数据库实例', 'Schema', '否', '数据库模式名（如 public / dbo），选填'],
      ['数据库实例', '端口', '是', '数据库端口号'],
      ['数据库实例', '是否集群', '否', '填写"是"或"否"，默认为否'],
      ['数据库实例', '集群其他IP', '否', '集群其他节点IP，多个用英文逗号分隔'],
      ['', '', '', ''],
      ['应用实例', '服务器名称', '是', '关联到服务器资源Sheet中的服务器名称'],
      ['应用实例', '应用名称', '是', '应用系统名称'],
      ['应用实例', 'URL', '是', '应用访问地址'],
      ['', '', '', ''],
      ['API实例', '服务器名称', '是', '关联到服务器资源Sheet中的服务器名称'],
      ['API实例', 'API地址', '是', '接口路径'],
      ['API实例', '所属应用', '是', '应用名称'],
      ['API实例', '是否加密', '否', '填写"是"或"否"'],
      ['', '', '', ''],
      ['中间件实例', '服务器名称', '是', '关联到服务器资源Sheet中的服务器名称'],
      ['中间件实例', '名称', '是', '中间件实例名称'],
      ['中间件实例', '类型', '是', '如 Nginx / Tomcat / Redis / RabbitMQ / Kafka 等'],
    ];
    const wsNotes = XLSX.utils.aoa_to_sheet(notesData);
    wsNotes['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(wb, wsNotes, '填写说明');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': "attachment; filename=\"server-template.xlsx\"; filename*=UTF-8''%E6%9C%8D%E5%8A%A1%E5%99%A8%E8%B5%84%E6%BA%90%E5%AF%BC%E5%85%A5%E6%A8%A1%E6%9D%BF.xlsx",
      'Content-Length': buf.length,
    });
    res.send(buf);
  } catch (e) {
    console.error('模板生成失败:', e);
    res.status(500).json({ error: '模板生成失败' });
  }
});

// ========= 获取所有数据库实例（含所属服务器名称） =========

router.get('/db-instances/all', async (_req, res) => {
  const servers = await getAll('servers');
  const allDbInstances = await getAll('servers_db_instances');
  const serverMap = {};
  for (const s of servers) serverMap[s.id] = s.name;

  const result = allDbInstances.map(d => {
    const serverName = serverMap[d.server_id] || '';
    let credentials = [];
    if (d.credentials && typeof d.credentials === 'string') {
      try { credentials = JSON.parse(d.credentials); } catch { credentials = []; }
    }
    return {
      id: d.id,
      serverId: d.server_id,
      serverName,
      dbType: d.db_type || '',
      version: d.version || '',
      dbName: d.db_name || '',
      schema: d.schema_name || '',
      username: d.username || '',
      credentials: Array.isArray(credentials) ? credentials.map(c => ({
        username: c.username || '',
        notes: c.notes || '',
        schema: c.schema || '',
        region: c.region || '',
        connectionName: c.connectionName || '',
      })) : [],
      internalIp: d.internal_ip || '',
      externalIp: d.external_ip || '',
      port: d.port || 0,
      isCluster: d.is_cluster === 1,
      clusterIps: d.cluster_ips || '',
      notes: d.notes || '',
    };
  });

  res.json({ dbInstances: result });
});

// ========= 解密数据库实例凭据（连接引用时使用） =========

router.post('/db-instances/decrypt-credential', async (req, res) => {
  try {
    const { instanceId, credentialIndex } = req.body;
    if (!instanceId || credentialIndex === undefined || credentialIndex === null) {
      return res.status(400).json({ error: '缺少 instanceId 或 credentialIndex' });
    }

    const inst = await getById('servers_db_instances', instanceId);
    if (!inst) return res.status(404).json({ error: '数据库实例不存在' });

    let credentials = [];
    if (inst.credentials && typeof inst.credentials === 'string') {
      try { credentials = JSON.parse(inst.credentials); } catch { credentials = []; }
    }
    if (!Array.isArray(credentials) || credentials.length === 0) {
      // 兼容旧数据：用顶层 username 字段
      credentials = [{ username: inst.username || '', password_encrypted: inst.password_encrypted || '', schema: inst.schema_name || '' }];
    }

    const cred = credentials[credentialIndex];
    if (!cred) return res.status(404).json({ error: '凭据不存在' });

    const result = {
      username: cred.username || '',
      password: '',
      schema: cred.schema || '',
      connectionName: cred.connectionName || '',
    };
    if (cred.password_encrypted) {
      result.password = decryptPassword(cred.password_encrypted);
    } else if (cred.password) {
      result.password = cred.password; // 明文（旧数据兼容）
    }

    res.json(result);
  } catch (err) {
    console.error('[db-instances] 解密凭据失败:', err);
    res.status(500).json({ error: '解密凭据失败: ' + (err.message || '未知错误') });
  }
});

// ========= 服务器排序 =========

/** 批量更新服务器排序 */
router.put('/reorder', async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: 'items 必须是数组' });
  }
  for (const item of items) {
    if (!item || !item.id || item.sortOrder === undefined || item.sortOrder === null) continue;
    const existing = await getById('servers', item.id);
    if (!existing) continue;
    await update('servers', item.id, { sort_order: Number(item.sortOrder) });
  }
  res.json({ success: true });
});

/** 修改单个服务器 sortOrder */
router.put('/:id/sort-order', async (req, res) => {
  const { id } = req.params;
  const { sortOrder } = req.body;
  if (sortOrder === undefined || sortOrder === null) {
    return res.status(400).json({ error: '缺少 sortOrder 参数' });
  }
  const existing = await getById('servers', id);
  if (!existing) return res.status(404).json({ error: '服务器不存在' });
  const updated = await update('servers', id, { sort_order: Number(sortOrder) });
  res.json(sanitizeServer(updated));
});

// ========= 服务器 CRUD =========

router.get('/', async (_req, res) => {
  const servers = (await getAll('servers')).map(sanitizeServer);
  res.json({ servers });
});

router.get('/:id', async (req, res) => {
  const s = await getById('servers', req.params.id);
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

router.post('/', async (req, res) => {
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
    sort_order: (await getAll('servers')).length,
    created_at: now,
    updated_at: now,
  };

  await insert('servers', server);
  res.status(201).json(sanitizeServer(server));
});

router.put('/:id', async (req, res) => {
  const existing = await getById('servers', req.params.id);
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

  const updated = await update('servers', req.params.id, partial);
  res.json(sanitizeServer(updated));
});

router.delete('/:id', async (req, res) => {
  const existing = await getById('servers', req.params.id);
  if (!existing) return res.status(404).json({ error: '服务器不存在' });
  removeSubResources(req.params.id);
  await removeWhere('passwordHistory', h => h.server_id === req.params.id);
  await remove('servers', req.params.id);
  res.json({ success: true });
});

// ========= 密码解密（需二次验证） =========

router.post('/:id/decrypt', async (req, res) => {
  const { verifyPassword } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入验证密码' });

  // 优先使用二次验证密码
  const configs = await getAll('systemConfig');
  const config = configs.length > 0 ? configs[0] : {};
  if (config.secondary_password_hash) {
    const match = await bcrypt.compare(verifyPassword, config.secondary_password_hash);
    if (!match) return res.status(401).json({ error: '二次验证密码错误' });
  } else {
    // 回退到登录密码验证
    const isDev = process.env.NODE_ENV !== 'production';
    if (!isDev) {
      const username = req.user?.username || 'admin';
      let user;
      try {
        const authMod = await import('./auth.mjs');
        const users = authMod.getUsers ? authMod.getUsers() : null;
        user = users ? users.get(username) : null;
      } catch { user = null; }
      if (!user) return res.status(400).json({ error: '用户不存在' });
      const pwMatch = await bcrypt.compare(verifyPassword, user.passwordHash);
      if (!pwMatch) return res.status(401).json({ error: '验证密码错误' });
    }
  }

  const s = await getById('servers', req.params.id);
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
  const { verifyPassword, credentialIndex, instanceType, instanceId } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入验证密码' });
  if (credentialIndex === undefined || credentialIndex === null) return res.status(400).json({ error: '请指定凭据索引' });

  // 使用二次验证密码（而非登录密码）
  const configs = await getAll('systemConfig');
  const config = configs.length > 0 ? configs[0] : {};
  if (!config.secondary_password_hash) {
    return res.status(400).json({ error: '尚未设置二次验证密码，请先在系统设置中设置' });
  }

  const match = await bcrypt.compare(verifyPassword, config.secondary_password_hash);
  if (!match) return res.status(401).json({ error: '二次验证密码错误' });

  let credentials = [];

  // 如果指定了 instanceType 和 instanceId，查实例的凭据
  const instTableMap = { dbInstance: 'servers_db_instances', appInstance: 'servers_app_instances', midInstance: 'servers_mid_instances' };
  if (instanceType && instanceId && instTableMap[instanceType]) {
    const instRecord = await getById(instTableMap[instanceType], instanceId);
    if (instRecord) {
      if (instRecord.credentials && typeof instRecord.credentials === 'string') {
        try { credentials = JSON.parse(instRecord.credentials); } catch { credentials = []; }
      }
    }
  } else {
    // 默认查服务器凭据
    const s = await getById('servers', req.params.id);
    if (s && s.credentials && typeof s.credentials === 'string') {
      try { credentials = JSON.parse(s.credentials); } catch { credentials = []; }
    }
    // 兼容旧数据：credentials 数组为空时回退到顶层 username/password
    if (s && credentials.length === 0 && (s.username || s.password_encrypted)) {
      credentials = [{ username: s.username || '', password_encrypted: s.password_encrypted || '' }];
    }
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

router.get('/:id/password-history', async (req, res) => {
  const { fieldName } = req.query;
  let items = await query('passwordHistory', h => h.server_id === req.params.id);
  if (fieldName) items = items.filter(h => h.field_name === fieldName);
  items.sort((a, b) => new Date(b.changed_at) - new Date(a.changed_at));
  res.json({ history: items });
});

// 解密密码历史（需二次验证）
router.post('/:id/password-history/decrypt', async (req, res) => {
  const { verifyPassword, fieldName } = req.body;
  if (!verifyPassword) return res.status(400).json({ error: '请输入二次验证密码' });

  const configs = await getAll('systemConfig');
  const config = configs.length > 0 ? configs[0] : {};
  if (!config.secondary_password_hash) {
    return res.status(400).json({ error: '尚未设置二次验证密码' });
  }

  const match = await bcrypt.compare(verifyPassword, config.secondary_password_hash);
  if (!match) return res.status(401).json({ error: '二次验证密码错误' });

  let items = await query('passwordHistory', h => h.server_id === req.params.id);
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
async function checkPortUnique(serverId, port, excludeTable, excludeId) {
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
    const records = await query(t.collection, r =>
      r.server_id === serverId && r.port === portNum &&
      !(excludeTable === t.collection && r.id === excludeId)
    );
    if (records.length > 0) {
      // 特殊放行：servers_ports 中若发现的记录是"当前编辑资源自己"自动生成的端口条目（同type+同旧port），则不算冲突
      // 这里通过资源类型+旧端口号匹配。checkPortUnique 的调用方在换端口场景才会触发，此时 oldPort 与新 port 不同，因此匹配到的一定是别人的记录 → 保持冲突。
      // 但为了兼容并发/异常场景，如果调用方明确传入 excludeTable=对应实例表，我们此处仍返回冲突（真实用户已换端口）。
      return { conflict: true, resourceType: t.type, resourceName: records[0][t.nameKey] || '' };
    }
  }
  return { conflict: false };
}

/**
 * 同步资源实例对应的端口记录（新增/更新/删除）
 * 按 (server_id + oldPort) 定位既有 servers_ports 记录：
 *   - oldPort 为空 & newPort 非空 → 新建端口记录
 *   - oldPort 非空 & newPort 非空 → 更新端口记录（端口号/协议/服务名/备注/类型）
 *   - oldPort 非空 & newPort 为空 → 删除端口记录
 *   - 两者都空 → 空操作
 * @param {string} serverId
 * @param {string} instanceType - '数据库' | '应用' | '中间件' | 'API'
 * @param {number|string|null|undefined} oldPort
 * @param {number|string|null|undefined} newPort
 * @param {string} serviceName
 * @param {string} protocol
 * @param {string} notes
 */
async function syncPortRecord(serverId, instanceType, oldPort, newPort, serviceName, protocol, notes) {
  const now = new Date().toISOString();
  const hasOld = oldPort != null && oldPort !== '' && Number(oldPort) > 0;
  const hasNew = newPort != null && newPort !== '' && Number(newPort) > 0;

  // 查找已有端口记录（按 server_id + port + type 三元组匹配，尽量精确）
  let existing = null;
  if (hasOld) {
    const found = await query('servers_ports', p =>
      p.server_id === serverId && p.port === Number(oldPort) && (p.type || '') === instanceType
    );
    if (found.length > 0) {
      existing = found[0];
    } else {
      // 兜底：type 匹配失败时，仅按 (server_id + port) 匹配（老数据可能没写 type）
      const fallback = await query('servers_ports', p =>
        p.server_id === serverId && p.port === Number(oldPort)
      );
      if (fallback.length > 0) existing = fallback[0];
    }
  }

  // 情况 1：无新端口 → 删除
  if (!hasNew) {
    if (existing) await remove('servers_ports', existing.id);
    return;
  }

  // 情况 2：有新端口 & 已有旧端口记录 → 更新
  if (existing) {
    await update('servers_ports', existing.id, {
      port: Number(newPort),
      protocol: protocol || existing.protocol || 'TCP',
      type: instanceType,
      service_name: serviceName || existing.service_name || '',
      notes: notes || '',
      updated_at: now,
    });
    return;
  }

  // 情况 3：有新端口 & 无旧端口记录 → 新建
  await insert('servers_ports', {
    id: nanoid(8),
    server_id: serverId,
    port: Number(newPort),
    protocol: protocol || 'TCP',
    type: instanceType,
    service_name: serviceName || '',
    notes: notes || '',
    created_at: now,
    updated_at: now,
  });
}

// ========= 数据库实例子资源 CRUD =========

router.post('/:id/db-instances', async (req, res) => {
  try {
    const server = await getById('servers', req.params.id);
    if (!server) return res.status(404).json({ error: '服务器不存在' });
    const { dbType, version, dbName, schema, username, password, credentials, internalIp, externalIp, port, notes, isCluster, clusterIps } = req.body;
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
      is_cluster: isCluster === true || isCluster === 1 ? 1 : 0,
      cluster_ips: clusterIps || '',
      created_at: now, updated_at: now,
    };
    await insert('servers_db_instances', inst);
    // 自动同步端口记录（新增）
    syncPortRecord(req.params.id, '数据库', null, port, `${dbType}-${dbName}`, 'TCP', notes || '');
    res.status(201).json(sanitizeDbInst(inst));
  } catch (err) {
    console.error('[db-instance] 创建数据库实例失败:', err);
    res.status(500).json({ error: '创建数据库实例失败: ' + (err.message || '未知错误') });
  }
});

router.put('/:id/db-instances/:di', async (req, res) => {
  const inst = await getById('servers_db_instances', req.params.di);
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
  // 集群字段
  if (body.isCluster !== undefined) partial.is_cluster = body.isCluster ? 1 : 0;
  if (body.clusterIps !== undefined) partial.cluster_ips = String(body.clusterIps || '').trim();
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
  const updated = await update('servers_db_instances', req.params.di, partial);
  // 同步端口记录（编辑）
  const newPort = partial.port !== undefined ? partial.port : inst.port;
  const newDbType = partial.db_type !== undefined ? partial.db_type : inst.db_type;
  const newDbName = partial.db_name !== undefined ? partial.db_name : inst.db_name;
  const newNotes = partial.notes !== undefined ? partial.notes : (inst.notes || '');
  syncPortRecord(req.params.id, '数据库', inst.port, newPort, `${newDbType || '数据库'}-${newDbName || 'unknown'}`, 'TCP', newNotes);
  res.json(sanitizeDbInst(updated));
});

router.delete('/:id/db-instances/:di', async (req, res) => {
  const inst = await getById('servers_db_instances', req.params.di);
  if (!inst) return res.status(404).json({ error: '数据库实例不存在' });
  await remove('servers_db_instances', req.params.di);
  // 同步删除端口记录
  syncPortRecord(req.params.id, '数据库', inst.port, null, '', 'TCP', '');
  res.json({ success: true });
});

// ========= 应用实例子资源 CRUD =========

router.post('/:id/app-instances', async (req, res) => {
  const server = await getById('servers', req.params.id);
  if (!server) return res.status(404).json({ error: '服务器不存在' });
  const { name, port, contactPerson, contactPhone, url, username, password, credentials, notes, ip } = req.body;
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
    name, ip: ip || '', port: port != null ? Number(port) : null,
    contact_person: contactPerson || '',
    contact_phone: contactPhone || '',
    url, username: primaryUser,
    password_encrypted: '',
    credentials: credsJson,
    notes: notes || '',
    created_at: now, updated_at: now,
  };
  await insert('servers_app_instances', inst);
  // 自动同步端口记录（新增）
  syncPortRecord(req.params.id, '应用', null, port, name, 'HTTP', notes || '');
  res.status(201).json(sanitizeAppInst(inst));
});

router.put('/:id/app-instances/:ai', async (req, res) => {
  const inst = await getById('servers_app_instances', req.params.ai);
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
  if (body.ip !== undefined) partial.ip = body.ip;
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
  const updated = await update('servers_app_instances', req.params.ai, partial);
  // 同步端口记录（编辑）
  const newAppPort = partial.port !== undefined ? partial.port : inst.port;
  const newAppName = partial.name !== undefined ? partial.name : inst.name;
  const newAppNotes = partial.notes !== undefined ? partial.notes : (inst.notes || '');
  syncPortRecord(req.params.id, '应用', inst.port, newAppPort, newAppName || 'unknown', 'HTTP', newAppNotes);
  res.json(sanitizeAppInst(updated));
});

router.delete('/:id/app-instances/:ai', async (req, res) => {
  const inst = await getById('servers_app_instances', req.params.ai);
  if (!inst) return res.status(404).json({ error: '应用实例不存在' });
  await remove('servers_app_instances', req.params.ai);
  // 同步删除端口记录
  syncPortRecord(req.params.id, '应用', inst.port, null, '', 'HTTP', '');
  res.json({ success: true });
});

// ========= 中间件实例子资源 CRUD =========

router.post('/:id/mid-instances', async (req, res) => {
  const server = await getById('servers', req.params.id);
  if (!server) return res.status(404).json({ error: '服务器不存在' });
  const { name, port, type, version, url, username, password, credentials, notes, serviceApp, ip } = req.body;
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
    name, ip: ip || '', port: port != null ? Number(port) : null,
    type: type || '', version: version || '',
    url: url || '', service_app: serviceApp || '', username: primaryUser,
    password_encrypted: '',
    credentials: credsJson,
    notes: notes || '',
    created_at: now, updated_at: now,
  };
  await insert('servers_mid_instances', inst);
  // 自动同步端口记录（新增）
  syncPortRecord(req.params.id, '中间件', null, port, name, 'TCP', notes || '');
  res.status(201).json(sanitizeMidInst(inst));
});

router.put('/:id/mid-instances/:mi', async (req, res) => {
  const inst = await getById('servers_mid_instances', req.params.mi);
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
  if (body.ip !== undefined) partial.ip = body.ip;
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
  const updated = await update('servers_mid_instances', req.params.mi, partial);
  // 同步端口记录（编辑）
  const newMidPort = partial.port !== undefined ? partial.port : inst.port;
  const newMidName = partial.name !== undefined ? partial.name : inst.name;
  const newMidNotes = partial.notes !== undefined ? partial.notes : (inst.notes || '');
  syncPortRecord(req.params.id, '中间件', inst.port, newMidPort, newMidName || 'unknown', 'TCP', newMidNotes);
  res.json(sanitizeMidInst(updated));
});

router.delete('/:id/mid-instances/:mi', async (req, res) => {
  const inst = await getById('servers_mid_instances', req.params.mi);
  if (!inst) return res.status(404).json({ error: '中间件实例不存在' });
  await remove('servers_mid_instances', req.params.mi);
  // 同步删除端口记录
  syncPortRecord(req.params.id, '中间件', inst.port, null, '', 'TCP', '');
  res.json({ success: true });
});

// ========= API 实例子资源 CRUD =========

router.post('/:id/api-instances', async (req, res) => {
  try {
    const server = await getById('servers', req.params.id);
    if (!server) return res.status(404).json({ error: '服务器不存在' });
    const { apiAddress, port, applicationName, encrypted, encryptionMethod, requestExample, responseExample, notes, ip } = req.body;
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
      ip: ip || '',
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
    await insert('servers_api_instances', inst);
    // 自动同步端口记录（新增）
    syncPortRecord(req.params.id, 'API', null, port, applicationName, 'HTTP', notes || '');
    res.status(201).json(sanitizeApiInst(inst));
  } catch (err) {
    console.error('[api-instance] 创建API实例失败:', err);
    res.status(500).json({ error: '创建API实例失败: ' + (err.message || '未知错误') });
  }
});

router.put('/:id/api-instances/:ai', async (req, res) => {
  try {
    const inst = await getById('servers_api_instances', req.params.ai);
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
    if (body.ip !== undefined) partial.ip = body.ip;
    const updated = await update('servers_api_instances', req.params.ai, partial);
    // 同步端口记录（编辑）
    const newApiPort = partial.port !== undefined ? partial.port : inst.port;
    const newApiApp = partial.application_name !== undefined ? partial.application_name : inst.application_name;
    const newApiNotes = partial.notes !== undefined ? partial.notes : (inst.notes || '');
    syncPortRecord(req.params.id, 'API', inst.port, newApiPort, newApiApp || 'unknown', 'HTTP', newApiNotes);
    res.json(sanitizeApiInst(updated));
  } catch (err) {
    console.error('[api-instance] 更新API实例失败:', err);
    res.status(500).json({ error: '更新API实例失败: ' + (err.message || '未知错误') });
  }
});

router.delete('/:id/api-instances/:ai', async (req, res) => {
  const inst = await getById('servers_api_instances', req.params.ai);
  if (!inst) return res.status(404).json({ error: 'API实例不存在' });
  await remove('servers_api_instances', req.params.ai);
  // 同步删除端口记录
  syncPortRecord(req.params.id, 'API', inst.port, null, '', 'HTTP', '');
  res.json({ success: true });
});

// ========= 端口信息子资源 CRUD =========

router.post('/:id/ports', async (req, res) => {
  const server = await getById('servers', req.params.id);
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
  await insert('servers_ports', p);
  res.status(201).json(p);
});

router.put('/:id/ports/:pi', async (req, res) => {
  const existing = await getById('servers_ports', req.params.pi);
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
  const updated = await update('servers_ports', req.params.pi, partial);
  res.json(updated);
});

router.delete('/:id/ports/:pi', async (req, res) => {
  const existing = await getById('servers_ports', req.params.pi);
  if (!existing) return res.status(404).json({ error: '端口记录不存在' });
  await remove('servers_ports', req.params.pi);
  res.json({ success: true });
});

// ========= 批量导入 =========

/** 标准化 tags 字段 */
function normalizeTags(raw) {
  if (Array.isArray(raw)) return raw.map(t => String(t).trim()).filter(Boolean);
  if (typeof raw === 'string' && raw.trim()) return raw.split(',').map(t => t.trim()).filter(Boolean);
  return [];
}

/** 导入子资源辅助函数 */
async function importSubResource(collection, items, serverNameMap, buildRecord, typeLabel) {
  const results = [];
  for (const item of items) {
    const row = item.row || (results.length + 1);
    const serverName = (item.serverName || '').trim();
    const serverId = serverNameMap[serverName];
    if (!serverId) {
      results.push({ row, type: typeLabel, status: 'failed', error: `未找到服务器「${serverName}」，请先在"服务器资源"Sheet中填写该服务器` });
      continue;
    }
    try {
      const record = buildRecord(serverId, item);
      if (!record) {
        results.push({ row, type: typeLabel, status: 'failed', error: '必填字段缺失' });
        continue;
      }
      await insert(collection, record);
      results.push({ row, type: typeLabel, name: record.name || record.db_name || record.api_address || '', status: 'created', id: record.id });
    } catch (err) {
      results.push({ row, type: typeLabel, status: 'failed', error: err.message });
    }
  }
  return results;
}

router.post('/import', async (req, res) => {
  const { servers, dbInstances, appInstances, apiInstances, midInstances } = req.body;
  if (!Array.isArray(servers) || servers.length === 0) {
    return res.status(400).json({ error: '请提供有效的服务器列表' });
  }

  const results = [];
  let successCount = 0;
  let failCount = 0;
  const now = new Date().toISOString();

  // 第一步：导入服务器
  const serverNameToId = {};
  for (const item of servers) {
    const row = (item.row !== undefined ? item.row : results.length + 1);
    try {
      const { name, ips, credentials, os, cpuCores, memoryGB,
        systemDiskGB, dataDiskGB, storageType, bandwidthMbps, serverLocation, serverType,
        bastionHost, bastionPort, bastionUsername, bastionPassword,
        vpnInfo, macAddress, deployedContent, tags, notes, projectId, engineeringId, applicationId } = item;
      // 兼容旧模板：没有 ips 时尝试 ipAddress/ipType/mappedPort/mappedIp
      const ipEntries = Array.isArray(ips) && ips.length > 0 ? ips
        : (item.ipAddress ? [{ ip: item.ipAddress, type: item.ipType || '局域', port: item.mappedPort, mappedIp: item.mappedIp }] : []);
      // 兼容旧模板：没有 credentials 时尝试 username/password
      const creds = Array.isArray(credentials) && credentials.length > 0 ? credentials
        : (item.username ? [{ username: item.username, password: item.password || '' }] : []);

      if (!name || ipEntries.length === 0) {
        results.push({ row, name: name || '(空)', type: '服务器', status: 'failed', error: '服务器名称和IP地址不能为空' });
        failCount++;
        continue;
      }

      const id = nanoid(8);
      const server = {
        id,
        project_id: projectId || null,
        engineering_id: engineeringId || null,
        application_id: applicationId || null,
        name: (name || '').trim(),
        ips: JSON.stringify(ipEntries.map(e => ({ ip: e.ip, type: e.type || '局域', port: e.port || undefined, mappedIp: e.mappedIp || '' }))),
        internal_ip: ipEntries[0]?.ip || '',
        external_ip: '',
        public_ip: '',
        cross_network_ip: '',
        os: os || '',
        cpu_cores: cpuCores != null ? Number(cpuCores) : null,
        memory_gb: memoryGB != null ? Number(memoryGB) : null,
        system_disk_gb: systemDiskGB != null ? Number(systemDiskGB) : null,
        data_disk_gb: dataDiskGB != null ? Number(dataDiskGB) : null,
        storage_type: storageType || '',
        bandwidth_mbps: bandwidthMbps != null ? Number(bandwidthMbps) : null,
        server_location: serverLocation || '',
        server_type: serverType || '',
        username: creds[0]?.username || '',
        password_encrypted: creds[0]?.password ? encryptPassword(String(creds[0].password)) : '',
        credentials: JSON.stringify(creds.map(c => ({
          username: c.username,
          password_encrypted: c.password ? encryptPassword(String(c.password)) : '',
        }))),
        bastion_host: (bastionHost || '').trim(),
        bastion_port: bastionPort != null ? Number(bastionPort) : null,
        bastion_username: (bastionUsername || '').trim(),
        bastion_password_encrypted: bastionPassword ? encryptPassword(String(bastionPassword)) : '',
        vpn_info: vpnInfo || '',
        mac_address: macAddress || '',
        deployed_content: deployedContent || '',
        tags: normalizeTags(tags),
        notes: notes || '',
        linked_connection_ids: [],
        created_at: now,
        updated_at: now,
      };

      await insert('servers', server);
      serverNameToId[server.name] = id;
      results.push({ row, name: server.name, type: '服务器', status: 'created', id });
      successCount++;
    } catch (err) {
      results.push({ row, name: item.name || '(空)', type: '服务器', status: 'failed', error: err.message });
      failCount++;
    }
  }

  // 第二步：导入数据库实例
  if (Array.isArray(dbInstances) && dbInstances.length > 0) {
    const dbResults = importSubResource('servers_db_instances', dbInstances, serverNameToId, (serverId, item) => {
      const { dbType, dbName, port } = item;
      if (!dbType || !dbName || port == null) return null;
      const ndb = {
        id: nanoid(8), server_id: serverId,
        db_type: dbType, version: item.version || '', db_name: dbName,
        port: Number(port),
        internal_ip: item.internalIp || '', external_ip: item.externalIp || '',
        schema_name: item.schema || '',
        username: (item.username || '').trim(),
        password_encrypted: item.password ? encryptPassword(String(item.password)) : '',
        credentials: item.username
          ? JSON.stringify([{
              username: (item.username || '').trim(),
              password_encrypted: item.password ? encryptPassword(String(item.password)) : '',
              schema: item.schema || '',
              notes: '',
              region: '',
              connectionName: '',
            }])
          : '',
        is_cluster: item.isCluster === true || item.isCluster === 1 || item.isCluster === '是' ? 1 : 0,
        cluster_ips: (item.clusterIps || '').trim(),
        notes: item.notes || '',
        created_at: now, updated_at: now,
      };
      return ndb;
    }, '数据库实例');
    const dbOk = dbResults.filter(r => r.status === 'created').length;
    const dbFail = dbResults.filter(r => r.status === 'failed').length;
    successCount += dbOk; failCount += dbFail;
    results.push(...dbResults);
  }

  // 第三步：导入应用实例
  if (Array.isArray(appInstances) && appInstances.length > 0) {
    const appResults = importSubResource('servers_app_instances', appInstances, serverNameToId, (serverId, item) => {
      const { appName, url } = item;
      if (!appName || !url) return null;
      const na = {
        id: nanoid(8), server_id: serverId,
        name: appName, port: item.port != null ? Number(item.port) : null,
        contact_person: item.contactPerson || '', contact_phone: item.contactPhone || '',
        url, username: (item.username || '').trim(),
        password_encrypted: item.password ? encryptPassword(String(item.password)) : '',
        credentials: item.username && item.password ? JSON.stringify([{ username: (item.username || '').trim(), password_encrypted: encryptPassword(String(item.password)) }]) : '',
        notes: item.notes || '',
        created_at: now, updated_at: now,
      };
      return na;
    }, '应用实例');
    const appOk = appResults.filter(r => r.status === 'created').length;
    const appFail = appResults.filter(r => r.status === 'failed').length;
    successCount += appOk; failCount += appFail;
    results.push(...appResults);
  }

  // 第四步：导入 API 实例
  if (Array.isArray(apiInstances) && apiInstances.length > 0) {
    const apiResults = importSubResource('servers_api_instances', apiInstances, serverNameToId, (serverId, item) => {
      const { apiAddress, applicationName } = item;
      if (!apiAddress || !applicationName) return null;
      const isEnc = item.encrypted;
      const encVal = typeof isEnc === 'boolean' ? isEnc : (isEnc === '是' || isEnc === 'true' || isEnc === '1' || isEnc === true);
      return {
        id: nanoid(8), server_id: serverId,
        api_address: apiAddress,
        port: item.port != null ? Number(item.port) : null,
        application_name: applicationName,
        encrypted: encVal ? 1 : 0,
        encryption_method: item.encryptionMethod || '',
        request_example: item.requestExample || '',
        response_example: item.responseExample || '',
        notes: item.notes || '',
        created_at: now, updated_at: now,
      };
    }, 'API实例');
    const apiOk = apiResults.filter(r => r.status === 'created').length;
    const apiFail = apiResults.filter(r => r.status === 'failed').length;
    successCount += apiOk; failCount += apiFail;
    results.push(...apiResults);
  }

  // 第五步：导入中间件实例
  if (Array.isArray(midInstances) && midInstances.length > 0) {
    const midResults = importSubResource('servers_mid_instances', midInstances, serverNameToId, (serverId, item) => {
      const { midName, type } = item;
      if (!midName || !type) return null;
      return {
        id: nanoid(8), server_id: serverId,
        name: midName, port: item.port != null ? Number(item.port) : null,
        type, version: item.version || '', url: item.url || '',
        service_app: item.serviceApp || '', username: (item.username || '').trim(),
        password_encrypted: item.password ? encryptPassword(String(item.password)) : '',
        credentials: item.username && item.password ? JSON.stringify([{ username: (item.username || '').trim(), password_encrypted: encryptPassword(String(item.password)) }]) : '',
        notes: item.notes || '',
        created_at: now, updated_at: now,
      };
    }, '中间件实例');
    const midOk = midResults.filter(r => r.status === 'created').length;
    const midFail = midResults.filter(r => r.status === 'failed').length;
    successCount += midOk; failCount += midFail;
    results.push(...midResults);
  }

  const totalItems = servers.length + (dbInstances?.length || 0) + (appInstances?.length || 0) + (apiInstances?.length || 0) + (midInstances?.length || 0);
  res.json({ total: totalItems, success: successCount, failed: failCount, results });
});

export default router;
