import { nanoid } from 'nanoid';
import type { TreeNode } from '../types/tree';
import { TreeNodeType, CheckState } from '../types/tree';
import type { DbConnection } from '../types/connection';
import { DbDriver, ConnectionStatus } from '../types/connection';
import type { QueryResult, ResultRow, CellValue } from '../types/result';
import { DiffType } from '../types/result';

/** Generate mock tree data and connections */
export function generateMockTree(): { nodes: Record<string, TreeNode>; rootNodeIds: string[] } {
  const nodes: Record<string, TreeNode> = {};

  const makeNode = (
    name: string,
    type: TreeNodeType,
    parentId: string | null,
    dbConnectionId?: string
  ): TreeNode => {
    const id = nanoid(8);
    const node: TreeNode = {
      id,
      name,
      type,
      checkState: CheckState.Unchecked,
      expanded: type === TreeNodeType.Platform || type === TreeNodeType.PreDbType,
      parentId,
      childrenIds: [],
      dbConnectionId,
      visible: true,
    };
    nodes[id] = node;
    if (parentId && nodes[parentId]) {
      nodes[parentId].childrenIds.push(id);
    }
    return node;
  };

  // L1: Project
  const platform = makeNode('示例项目', TreeNodeType.Platform, null);

  // L2: Business Modules
  const emr = makeNode('数据交换模块', TreeNodeType.PreDbType, platform.id);
  const health = makeNode('数据归档模块', TreeNodeType.PreDbType, platform.id);

  // Helper to add district + hospitals
  const addDistrictHospitals = (
    parentId: string,
    districtName: string,
    hospitalNames: string[]
  ) => {
    const district = makeNode(districtName, TreeNodeType.District, parentId);
    hospitalNames.forEach((hName) => {
      makeNode(hName, TreeNodeType.Hospital, district.id, nanoid(8));
    });
  };

  // EMR districts
  addDistrictHospitals(emr.id, '中心区域', ['生产主库', '只读副本']);
  addDistrictHospitals(emr.id, '东部区域', [
    '区域数据库-1',
    '区域数据库-2',
    '区域数据库-3',
  ]);

  // Health districts
  addDistrictHospitals(health.id, '中心区域', ['生产主库', '只读副本']);
  addDistrictHospitals(health.id, '东部区域', [
    '区域数据库-1',
    '区域数据库-2',
    '区域数据库-3',
  ]);

  return { nodes, rootNodeIds: [platform.id] };
}

/** Generate mock DbConnection list from tree nodes */
export function generateMockConnections(nodes: Record<string, TreeNode>): DbConnection[] {
  const hospitals = Object.values(nodes).filter((n) => n.type === TreeNodeType.Hospital);
  const drivers = [DbDriver.MySQL, DbDriver.PostgreSQL];

  return hospitals.map((h, idx) => {
    const parentPreDb = findAncestorByType(nodes, h, TreeNodeType.PreDbType);
    const preDbName = parentPreDb?.name ?? '';
    const driver = drivers[idx % 2];
    const port = driver === DbDriver.MySQL ? 3306 : 5432;

    return {
      id: h.dbConnectionId ?? nanoid(8),
      name: `${h.name}(${preDbName})`,
      driver,
      host: `192.168.${1 + Math.floor(idx / 4)}.${10 + idx}`,
      port,
      username: 'db_reader',
      password: '******',
      database: `pre_${driver === DbDriver.MySQL ? 'emr' : 'health'}_${h.id}`,
      status: idx % 7 === 0 ? ConnectionStatus.Offline : ConnectionStatus.Online,
    };
  });
}

/** Generate mock query result for a hospital */
export function generateMockQueryResult(
  dbConnectionId: string,
  hospitalName: string,
  preDbTypeName: string
): QueryResult {
  const columns = ['hospital_name', 'patient_count', 'bed_count', 'date'];
  const rowCount = 3 + Math.floor(Math.random() * 10);
  const rows: ResultRow[] = [];

  for (let i = 0; i < rowCount; i++) {
    const values: Record<string, CellValue> = {};
    values['hospital_name'] = {
      value: hospitalName,
      diffType: DiffType.Same,
    };
    values['patient_count'] = {
      value: 50 + Math.floor(Math.random() * 300),
      diffType: DiffType.Same,
    };
    values['bed_count'] = {
      value: 100 + Math.floor(Math.random() * 500),
      diffType: DiffType.Same,
    };
    const day = 1 + Math.floor(Math.random() * 28);
    values['date'] = {
      value: `2025-07-${String(day).padStart(2, '0')}`,
      diffType: DiffType.Same,
    };
    rows.push({
      sourceDbLabel: `${hospitalName}(${preDbTypeName})`,
      values,
    });
  }

  return {
    dbConnectionId,
    sourceLabel: hospitalName,
    columns,
    rows,
    totalRows: rowCount,
  };
}

function findAncestorByType(
  nodes: Record<string, TreeNode>,
  node: TreeNode,
  type: TreeNodeType
): TreeNode | null {
  let current = node;
  while (current.parentId) {
    const parent = nodes[current.parentId];
    if (!parent) break;
    if (parent.type === type) return parent;
    current = parent;
  }
  return null;
}
