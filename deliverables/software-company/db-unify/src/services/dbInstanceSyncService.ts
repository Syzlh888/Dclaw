/**
 * 数据库实例同步服务
 * 实现服务器资源中数据库实例与编辑器连接管理、左侧菜单树的单向实时同步
 */
import { DbDriver, type DbConnection } from '../types/connection';
import type { ServerHost, DbInstance, ServerCredential } from '../types/server';
import { useConnectionStore } from '../stores/connectionStore';
import { useTreeStore } from '../stores/treeStore';
import { TreeNodeType } from '../types/tree';

/**
 * dbType 到 DbDriver 的映射
 */
function mapDbTypeToDriver(dbType: string): DbDriver {
  const type = dbType.toLowerCase();
  if (type.includes('mysql')) return DbDriver.MySQL;
  if (type.includes('postgres') || type.includes('瀚高')) return DbDriver.PostgreSQL;
  if (type.includes('oracle')) return DbDriver.Oracle;
  if (type.includes('sqlserver') || type.includes('sql server')) return DbDriver.SQLServer;
  return DbDriver.Custom;
}

/**
 * 生成连接名称
 * 优先使用 credential.connectionName，否则使用 `${dbName}_${username}`
 */
function generateConnectionName(dbInstance: DbInstance, credential: ServerCredential, index: number): string {
  if (credential.connectionName) return credential.connectionName;
  return `${dbInstance.dbName}_${credential.username}`;
}

/**
 * 查找与 DbInstance 关联的连接有 ID 列表
 * @param serverId 服务器 ID
 * @param dbInstanceId 数据库实例 ID
 * @returns 关联的连接 ID 数组
 */
export function findAssociatedConnectionIds(serverId: string, dbInstanceId: string): string[] {
  const connections = useConnectionStore.getState().connections;
  return Object.values(connections)
    .filter(c => c.serverId === serverId && c.dbInstanceId === dbInstanceId)
    .map(c => c.id);
}

/**
 * 查找树节点中关联了指定连接 ID 的 Hospital 节点 ID
 * @param dbConnectionId 连接 ID
 * @returns 树节点 ID（Hospital 类型）
 */
export function findTreeNodeByConnectionId(dbConnectionId: string): string | null {
  const nodes = useTreeStore.getState().nodes;
  const nodeEntry = Object.entries(nodes).find(
    ([, node]) => node.dbConnectionId === dbConnectionId && node.type === TreeNodeType.Hospital
  );
  return nodeEntry ? nodeEntry[0] : null;
}

/**
 * 将数据库实例同步到连接管理和树节点
 * 遍历每个凭据，为每个凭据创建/更新 DbConnection，再创建/更新对应的 Hospital 树节点
 *
 * @param serverHost 服务器主机信息
 * @param dbInstance 数据库实例
 * @param parentNodeId 父节点 ID（District 类型）
 * @param existingConnIds 已有关联的连接 ID 列表（编辑时传入）
 */
export async function syncDbInstance(
  serverHost: ServerHost,
  dbInstance: DbInstance,
  parentNodeId: string,
  existingConnIds?: string[]
): Promise<void> {
  const connectionStore = useConnectionStore.getState();
  const treeStore = useTreeStore.getState();

  const driver = mapDbTypeToDriver(dbInstance.dbType);
  // IP 回退链：实例自带 internalIp → 服务器 internalIp → 服务器外部IP → 服务器公网IP
  const host = dbInstance.internalIp || serverHost.internalIp || serverHost.externalIp || serverHost.publicIp || '';
  const port = Number(dbInstance.port) || 0;
  const database = dbInstance.dbName;

  // 校验关键参数
  if (!host || !port || !database) {
    console.error('[sync] 同步失败：连接参数不完整', {
      host, port, database,
      dbInstance: dbInstance.dbName,
      server: serverHost.name,
      dbInstanceInternalIp: dbInstance.internalIp,
      serverInternalIp: serverHost.internalIp,
      serverExternalIp: serverHost.externalIp,
      serverPublicIp: serverHost.publicIp,
    });
    return;
  }

  // 记录实际使用的连接参数
  console.log('[sync] 准备创建连接:', {
    dbInstance: dbInstance.dbName,
    host, port, database, driver,
    credentialsCount: dbInstance.credentials?.length || 0,
  });

  // 获取现有连接映射，便于更新
  const existingConnMap = new Map<string, DbConnection>();
  if (existingConnIds) {
    for (const connId of existingConnIds) {
      const conn = connectionStore.connections[connId];
      if (conn) {
        // 使用 credentialIndex 作为 key
        if (conn.credentialIndex !== undefined) {
          existingConnMap.set(`idx_${conn.credentialIndex}`, conn);
        }
      }
    }
  }

  const newConnIds: string[] = [];

  // 遍历每个凭据，创建/更新连接
  for (let i = 0; i < dbInstance.credentials.length; i++) {
    const cred = dbInstance.credentials[i];
    console.log(`[sync] 凭据[${i}]:`, { username: cred.username, hasPassword: !!cred.password, passwordLen: cred.password?.length, schema: cred.schema });
    if (!cred.username) {
      console.warn(`[sync] 跳过凭据[${i}]：没有用户名`);
      continue; // 跳过没有用户名的凭据
    }

    const connName = generateConnectionName(dbInstance, cred, i);
    const password = cred.password === '******' ? undefined : cred.password;
    console.log(`[sync] 凭据[${i}] 构建参数:`, { connName, username: cred.username, hasPassword: !!password, schema: cred.schema });

    const connData: Omit<DbConnection, 'id'> = {
      name: connName,
      driver,
      host,
      port,
      username: cred.username,
      password: password || '',
      database,
      schema: cred.schema,
      serverId: serverHost.id,
      dbInstanceId: dbInstance.id,
      credentialIndex: i,
    };
    console.log(`[sync] 发送 createConnection:`, JSON.stringify({ name: connData.name, driver: connData.driver, host: connData.host, port: connData.port, username: connData.username, password: connData.password ? '(已设置)' : '(空)', database: connData.database, schema: connData.schema }));

    let connId: string | undefined;

    // 检查是否已有关联的连接（按 credentialIndex 匹配）
    const existingConn = existingConnMap.get(`idx_${i}`);
    if (existingConn) {
      // 更新现有连接
      const updateData: Partial<DbConnection> = {
        name: connName,
        driver,
        host,
        port,
        username: cred.username,
        database,
        schema: cred.schema,
        serverId: serverHost.id,
        dbInstanceId: dbInstance.id,
        credentialIndex: i,
      };
      if (password) {
        updateData.password = password;
      }
      await connectionStore.updateConnection(existingConn.id, updateData);
      connId = existingConn.id;
    } else {
      // 创建新连接
      connId = await connectionStore.addConnection(connData);
    }

    if (!connId) {
      console.error('创建/更新连接失败');
      continue;
    }

    newConnIds.push(connId);

    // 检查是否已有关联的树节点
    const existingNodeId = findTreeNodeByConnectionId(connId);
    if (existingNodeId) {
      // 更新树节点名称
      await treeStore.updateNode(existingNodeId, connName);
    } else {
      // 创建新的 Hospital 树节点
      await treeStore.addHospitalNode(parentNodeId, connName, connId);
    }
  }

  // 如果编辑时传入了 existingConnIds，需要删除不再存在的关联连接
  if (existingConnIds) {
    const newConnIdSet = new Set(newConnIds);
    for (const oldConnId of existingConnIds) {
      if (!newConnIdSet.has(oldConnId)) {
        // 删除不再需要的连接及其关联的树节点
        await removeConnectionAndNode(oldConnId);
      }
    }
  }
}

/**
 * 删除数据库实例关联的连接和树节点
 * @param serverId 服务器 ID
 * @param dbInstanceId 数据库实例 ID
 */
export async function removeDbInstanceConnections(
  serverId: string,
  dbInstanceId: string
): Promise<void> {
  const connIds = findAssociatedConnectionIds(serverId, dbInstanceId);

  for (const connId of connIds) {
    await removeConnectionAndNode(connId);
  }
}

/**
 * 删除指定连接及其关联的树节点
 * @param connId 连接 ID
 */
async function removeConnectionAndNode(connId: string): Promise<void> {
  const treeStore = useTreeStore.getState();

  // 查找关联的树节点
  const nodeId = findTreeNodeByConnectionId(connId);

  // 删除树节点
  if (nodeId) {
    await treeStore.deleteNode(nodeId);
  }

  // 删除连接
  const connectionStore = useConnectionStore.getState();
  await connectionStore.deleteConnection(connId);
}

/**
 * 删除服务器时，清理其下所有数据库实例关联的连接和树节点
 * @param serverId 服务器 ID
 * @param dbInstances 该服务器下的数据库实例列表
 */
export async function removeServerAssociations(
  serverId: string,
  dbInstances: DbInstance[]
): Promise<void> {
  for (const dbInstance of dbInstances) {
    await removeDbInstanceConnections(serverId, dbInstance.id);
  }
}
