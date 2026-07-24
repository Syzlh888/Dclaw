import { create } from 'zustand';
import type { TreeNode } from '../types/tree';
import { CheckState, TreeNodeType } from '../types/tree';
import { broadcastDown, bubbleUp, filterByKeyword, getDescendantDbIds, removeNode, getChildType } from '../utils/treeUtils';
import { fetchTree, createNode, updateNode, deleteNode, reorderNodes, moveHospital } from '../services/treeService';

/** Recompute selectedDbIds from all root nodes */
function recomputeSelectedDbIds(
  rootNodeIds: string[],
  nodes: Record<string, TreeNode>
): string[] {
  const allDbIds = new Set<string>();
  for (const rid of rootNodeIds) {
    for (const dbId of getDescendantDbIds(rid, nodes)) {
      allDbIds.add(dbId);
    }
  }
  return Array.from(allDbIds).filter((dbId) => {
    return Object.values(nodes).some(
      (n) => n.dbConnectionId === dbId && n.checkState === CheckState.Checked
    );
  });
}

interface TreeState {
  nodes: Record<string, TreeNode>;
  rootNodeIds: string[];
  selectedDbIds: string[];
  searchKeyword: string;

  loadTree: () => Promise<void>;
  toggleCheck: (nodeId: string) => void;
  toggleExpand: (nodeId: string) => void;
  search: (keyword: string) => void;
  getSelectedDbIds: () => string[];
  setSelectedDbIds: (ids: string[]) => void;
  addNode: (parentId: string, name: string) => Promise<string | undefined>;
  addHospitalNode: (parentId: string, name: string, dbConnectionId: string) => Promise<void>;
  updateNode: (nodeId: string, newName: string) => Promise<void>;
  deleteNode: (nodeId: string) => Promise<void>;
  reorderChildren: (nodeId: string, newChildrenIds: string[]) => Promise<void>;
  moveHospitalToParent: (hospitalId: string, newParentId: string, newChildrenIds: string[]) => Promise<void>;
}

export const useTreeStore = create<TreeState>((set, get) => ({
  nodes: {},
  rootNodeIds: [] as string[],
  selectedDbIds: [],
  searchKeyword: '',

  loadTree: async () => {
    try {
      const data = await fetchTree();
      // 确保所有节点都有前端需要的默认字段
      const nodes: Record<string, TreeNode> = {};
      for (const [id, raw] of Object.entries(data.nodes || {}) as Array<[string, Partial<TreeNode>]>) {
        const nodeType = raw.type || TreeNodeType.Platform;
        // 默认展开到第一级：仅 Platform(项目) 展开，PreDbType/区域/医院默认收起
        const defaultExpanded = nodeType === TreeNodeType.Platform;
        nodes[id] = {
          id: raw.id || id,
          name: raw.name || '',
          type: nodeType,
          checkState: raw.checkState || CheckState.Unchecked,
          expanded: defaultExpanded,
          parentId: raw.parentId || null,
          childrenIds: raw.childrenIds || [],
          dbConnectionId: raw.dbConnectionId,
          visible: raw.visible ?? true,
          sortOrder: raw.sortOrder ?? 0,
        };
      }
      set({ nodes, rootNodeIds: data.rootNodeIds || [], selectedDbIds: [], searchKeyword: '' });
    } catch (err) {
      console.error('加载树数据失败:', err);
    }
  },

  toggleCheck: (nodeId: string) => {
    const { nodes } = get();
    const node = nodes[nodeId];
    if (!node) return;

    // Determine new check state
    const newCheckState =
      node.checkState === CheckState.Checked ? CheckState.Unchecked : CheckState.Checked;

    // Broadcast down
    let updated = broadcastDown(nodeId, newCheckState, nodes);

    // Bubble up
    updated = bubbleUp(nodeId, updated);

    // Recompute selectedDbIds
    const rootNodeIds = get().rootNodeIds;
    const selectedDbIds = recomputeSelectedDbIds(rootNodeIds, updated);

    set({ nodes: updated, selectedDbIds });
  },

  toggleExpand: (nodeId: string) => {
    const { nodes } = get();
    const node = nodes[nodeId];
    if (!node) return;

    set({
      nodes: {
        ...nodes,
        [nodeId]: { ...node, expanded: !node.expanded },
      },
    });
  },

  search: (keyword: string) => {
    const { nodes } = get();
    const updated = filterByKeyword(keyword, nodes);
    set({ nodes: updated, searchKeyword: keyword });
  },

  getSelectedDbIds: () => {
    return get().selectedDbIds;
  },

  setSelectedDbIds: (ids: string[]) => {
    const { nodes, rootNodeIds } = get();

    // Collect all Hospital nodes with dbConnectionId
    const allHospitals = Object.values(nodes).filter(
      (n) => n.type === TreeNodeType.Hospital && n.dbConnectionId
    );

    const idSet = new Set(ids);

    // First pass: reset all Hospital nodes to Unchecked
    let updated = { ...nodes };
    for (const h of allHospitals) {
      if (updated[h.id]) {
        updated[h.id] = { ...updated[h.id], checkState: CheckState.Unchecked };
      }
    }

    // Second pass: set matching hospitals to Checked and bubble up
    for (const h of allHospitals) {
      if (h.dbConnectionId && idSet.has(h.dbConnectionId)) {
        updated = broadcastDown(h.id, CheckState.Checked, updated);
        updated = bubbleUp(h.id, updated);
      }
    }

    set({ nodes: updated, selectedDbIds: ids });
  },

  addNode: async (parentId: string, name: string) => {
    const { nodes, rootNodeIds } = get();
    // Special case: creating a root Platform (parentId is empty)
    const isPlatform = !parentId;
    
    if (isPlatform) {
      try {
        const created = await createNode({ type: 'platform', parentId: '', name });
        const newPlatform: TreeNode = {
          id: created.id,
          name,
          type: TreeNodeType.Platform,
          checkState: CheckState.Unchecked,
          expanded: true,
          parentId: null,
          childrenIds: [],
          visible: true,
        };
        const updated = { ...nodes, [created.id]: newPlatform };
        const newRootIds = [...rootNodeIds, created.id];
        const selectedDbIds = recomputeSelectedDbIds(newRootIds, updated);
        set({ nodes: updated, rootNodeIds: newRootIds, selectedDbIds });
        return created.id;
      } catch (err) {
        console.error('创建项目失败:', err);
        return undefined;
      }
    }

    const parent = nodes[parentId];
    if (!parent) return;

    const childType = getChildType(parent.type);
    if (!childType) return;

    try {
      const apiType = childType === TreeNodeType.PreDbType ? 'predb_type'
        : childType === TreeNodeType.District ? 'district'
        : childType === TreeNodeType.Hospital ? 'hospital'
        : null;
      if (!apiType) return;

      const created = await createNode({ type: apiType, parentId, name });
      
      // 用后端返回的 ID 更新本地节点
      const dbId = created.id;
      const newChild: TreeNode = {
        id: dbId,
        name,
        type: childType,
        checkState: CheckState.Unchecked,
        expanded: false,
        parentId,
        childrenIds: [],
        dbConnectionId: childType === TreeNodeType.Hospital ? (created.connection_id || dbId) : undefined,
        visible: true,
      };

      const updated: Record<string, TreeNode> = {
        ...nodes,
        [dbId]: newChild,
        [parentId]: {
          ...parent,
          childrenIds: [...parent.childrenIds, dbId],
          expanded: true,
        },
      };

      const bubbled = bubbleUp(dbId, updated);
      const selectedDbIds = recomputeSelectedDbIds(rootNodeIds, bubbled);
      set({ nodes: bubbled, selectedDbIds });
      return dbId;
    } catch (err) {
      console.error('添加节点失败:', err);
      return undefined;
    }
  },

  addHospitalNode: async (parentId: string, name: string, dbConnectionId: string) => {
    const { nodes, rootNodeIds } = get();
    const parent = nodes[parentId];
    if (!parent) return;

    // 根据父节点类型映射到后端字段
    let parentType: 'platform' | 'predb_type' | 'district' = 'district';
    if (parent.type === TreeNodeType.Platform) parentType = 'platform';
    else if (parent.type === TreeNodeType.PreDbType) parentType = 'predb_type';
    else if (parent.type === TreeNodeType.District) parentType = 'district';

    try {
      const created = await createNode({
        type: 'hospital',
        parentId,
        parentType,
        name,
        connectionId: dbConnectionId,
      });

      const id = created.id;
      const newChild: TreeNode = {
        id,
        name,
        type: TreeNodeType.Hospital,
        checkState: CheckState.Unchecked,
        expanded: false,
        parentId,
        childrenIds: [],
        dbConnectionId,
        visible: true,
      };

      const updated: Record<string, TreeNode> = {
        ...nodes,
        [id]: newChild,
        [parentId]: {
          ...parent,
          childrenIds: [...parent.childrenIds, id],
          expanded: true,
        },
      };

      const bubbled = bubbleUp(id, updated);
      const selectedDbIds = recomputeSelectedDbIds(rootNodeIds, bubbled);
      set({ nodes: bubbled, selectedDbIds });
    } catch (err) {
      console.error('添加连接实例失败:', err);
    }
  },

  updateNode: async (nodeId: string, newName: string) => {
    const { nodes } = get();
    const node = nodes[nodeId];
    if (!node) return;

    try {
      const apiType = node.type === TreeNodeType.Platform ? 'platform'
        : node.type === TreeNodeType.PreDbType ? 'predb_type'
        : node.type === TreeNodeType.District ? 'district'
        : node.type === TreeNodeType.Hospital ? 'hospital'
        : null;
      if (apiType) {
        await updateNode({ type: apiType, id: nodeId, name: newName });
      }

      set({
        nodes: {
          ...nodes,
          [nodeId]: { ...node, name: newName },
        },
      });
    } catch (err) {
      console.error('更新节点失败:', err);
    }
  },

  deleteNode: async (nodeId: string) => {
    const { nodes, rootNodeIds } = get();
    const node = nodes[nodeId];
    if (!node) return;

    try {
      const apiType = node.type === TreeNodeType.Platform ? 'platform'
        : node.type === TreeNodeType.PreDbType ? 'predb_type'
        : node.type === TreeNodeType.District ? 'district'
        : node.type === TreeNodeType.Hospital ? 'hospital'
        : null;
      if (apiType) {
        await deleteNode({ type: apiType, id: nodeId });
      }

      let updated = removeNode(nodeId, nodes);

      if (node.parentId && updated[node.parentId]) {
        updated = bubbleUp(node.parentId, updated);
      }

      // Recompute rootNodeIds from remaining nodes with parentId === null
      const newRootIds = Object.values(updated)
        .filter(n => n.parentId === null)
        .map(n => n.id);
      const selectedDbIds = recomputeSelectedDbIds(newRootIds, updated);
      set({ nodes: updated, rootNodeIds: newRootIds, selectedDbIds });
    } catch (err) {
      console.error('删除节点失败:', err);
    }
  },

  reorderChildren: async (parentId: string, newChildrenIds: string[]) => {
    const { nodes, rootNodeIds } = get();
    // 判断 parent 类型：如果是 root 级排序，parentId 为空字符串
    let apiType: 'platform' | 'predb_type' | 'district' | 'hospital' | null = null;

    if (!parentId) {
      // root 级排序 → platforms
      apiType = 'platform';
    } else {
      const parent = nodes[parentId];
      if (!parent) return;
      apiType = parent.type === TreeNodeType.Platform ? 'predb_type'
        : parent.type === TreeNodeType.PreDbType ? 'district'
        : parent.type === TreeNodeType.District ? 'hospital'
        : null;
    }

    // 乐观更新：立即更新本地状态
    const updated = { ...nodes };
    if (!parentId) {
      set({ rootNodeIds: newChildrenIds });
    } else {
      updated[parentId] = { ...updated[parentId], childrenIds: newChildrenIds };
      set({ nodes: updated });
    }

    // 异步持久化
    if (apiType) {
      try {
        await reorderNodes({ type: apiType, ids: newChildrenIds });
      } catch (err) {
        console.error('排序持久化失败:', err);
        // 回滚: 重新加载树
        await get().loadTree();
      }
    }
  },

  /**
   * 移动 Hospital（连接实例）到新的父节点（platform / predb_type / district 之一），
   * 并同时更新新父节点下 hospital 兄弟的顺序。
   * newParentId: 新的父节点 id
   * newChildrenIds: 新父节点下 hospital 类型子节点的完整顺序（含被移动的 hospital），
   *                 用于同时更新 sort_order。
   */
  moveHospitalToParent: async (hospitalId, newParentId, newChildrenIds) => {
    const { nodes, rootNodeIds } = get();
    const hospital = nodes[hospitalId];
    const newParent = nodes[newParentId];
    if (!hospital || hospital.type !== TreeNodeType.Hospital || !newParent) return;

    // 判定 parent_type
    let parentType: 'platform' | 'predb_type' | 'district';
    switch (newParent.type) {
      case TreeNodeType.Platform:
        parentType = 'platform';
        break;
      case TreeNodeType.PreDbType:
        parentType = 'predb_type';
        break;
      case TreeNodeType.District:
        parentType = 'district';
        break;
      default:
        console.warn('无效的目标父节点类型', newParent.type);
        return;
    }

    const oldParentId = hospital.parentId;

    // 乐观更新：本地状态先改
    const updated = { ...nodes };
    // 1) 更新 hospital 自身的 parentId
    updated[hospitalId] = { ...updated[hospitalId], parentId: newParentId };
    // 2) 从旧父节点的 childrenIds 移除
    if (oldParentId && updated[oldParentId]) {
      updated[oldParentId] = {
        ...updated[oldParentId],
        childrenIds: updated[oldParentId].childrenIds.filter(id => id !== hospitalId),
      };
    }
    // 3) 更新新父节点的 childrenIds：保留非 hospital 子节点 + 传入的新顺序
    const nonHospitalChildren = (updated[newParentId].childrenIds || [])
      .filter(id => id !== hospitalId && updated[id]?.type !== TreeNodeType.Hospital);
    updated[newParentId] = {
      ...updated[newParentId],
      childrenIds: [...nonHospitalChildren, ...newChildrenIds],
    };
    set({ nodes: updated });

    // 异步持久化
    try {
      await moveHospital({
        hospitalId,
        parentType,
        parentId: newParentId,
        siblingIds: newChildrenIds,
      });
    } catch (err) {
      console.error('移动 Hospital 失败:', err);
      // 回滚：重载树
      await get().loadTree();
    }
  },

}));
