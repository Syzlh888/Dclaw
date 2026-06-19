import { CheckState, TreeNodeType } from '../types/tree';
import type { TreeNode } from '../types/tree';

/**
 * Broadcast a check state downward to all descendants.
 * Returns a new nodes map with updated check states.
 */
export function broadcastDown(
  nodeId: string,
  checkState: CheckState,
  nodes: Record<string, TreeNode>
): Record<string, TreeNode> {
  const updated = { ...nodes };
  const node = updated[nodeId];
  if (!node) return updated;

  updated[nodeId] = { ...node, checkState };

  for (const childId of node.childrenIds) {
    const childResult = broadcastDown(childId, checkState, updated);
    Object.assign(updated, childResult);
  }

  return updated;
}

/**
 * Bubble up check state from a node to its ancestors.
 * Recalculates each ancestor's check state based on its children.
 * Returns a new nodes map with updated check states.
 */
export function bubbleUp(
  nodeId: string,
  nodes: Record<string, TreeNode>
): Record<string, TreeNode> {
  const updated = { ...nodes };
  let currentId = nodeId;

  while (currentId) {
    const node = updated[currentId];
    if (!node || !node.parentId) break;

    const parent = updated[node.parentId];
    if (!parent) break;

    const newCheckState = computeParentCheckState(parent.childrenIds, updated);
    updated[node.parentId] = { ...parent, checkState: newCheckState };
    currentId = node.parentId;
  }

  return updated;
}

/**
 * Compute a parent's check state based on its children's states.
 */
function computeParentCheckState(
  childrenIds: string[],
  nodes: Record<string, TreeNode>
): CheckState {
  if (childrenIds.length === 0) return CheckState.Unchecked;

  const states = childrenIds.map((id) => nodes[id]?.checkState ?? CheckState.Unchecked);

  const allChecked = states.every((s) => s === CheckState.Checked);
  const allUnchecked = states.every((s) => s === CheckState.Unchecked);

  if (allChecked) return CheckState.Checked;
  if (allUnchecked) return CheckState.Unchecked;
  return CheckState.Indeterminate;
}

/**
 * Filter tree nodes by keyword.
 * Marks matching L4 nodes visible, and propagates visibility upward.
 * Returns a new nodes map.
 */
export function filterByKeyword(
  keyword: string,
  nodes: Record<string, TreeNode>
): Record<string, TreeNode> {
  const updated: Record<string, TreeNode> = {};

  // If no keyword, reset all nodes to visible
  if (!keyword.trim()) {
    for (const [id, node] of Object.entries(nodes)) {
      updated[id] = { ...node, visible: true, highlightText: undefined };
    }
    return updated;
  }

  const lowerKeyword = keyword.toLowerCase();

  // First pass: initialize all nodes as invisible
  for (const [id, node] of Object.entries(nodes)) {
    updated[id] = { ...node, visible: false, highlightText: undefined };
  }

  // Mark matching L4 (Hospital) nodes as visible
  for (const [id, node] of Object.entries(nodes)) {
    if (node.type === 'hospital' && node.name.toLowerCase().includes(lowerKeyword)) {
      updated[id] = { ...updated[id], visible: true, highlightText: keyword, expanded: true };
    }
    // Also match district names
    if (node.type === 'district' && node.name.toLowerCase().includes(lowerKeyword)) {
      updated[id] = { ...updated[id], visible: true, highlightText: keyword };
    }
    // Also match predb type names
    if (node.type === 'predb_type' && node.name.toLowerCase().includes(lowerKeyword)) {
      updated[id] = { ...updated[id], visible: true, highlightText: keyword };
    }
  }

  // If a district matches, make all its children visible
  for (const [id, node] of Object.entries(nodes)) {
    if (node.type === 'district' && updated[id].visible) {
      for (const childId of node.childrenIds) {
        updated[childId] = { ...updated[childId], visible: true };
      }
    }
  }

  // Propagate visibility upward: if any child visible, parent is visible + expanded
  const propagateUp = (nodeId: string): boolean => {
    const node = updated[nodeId];
    if (!node) return false;

    let anyChildVisible = false;
    for (const childId of node.childrenIds) {
      if (propagateUp(childId)) {
        anyChildVisible = true;
      }
    }

    if (anyChildVisible) {
      updated[nodeId] = { ...updated[nodeId], visible: true, expanded: true };
    }

    return updated[nodeId].visible;
  };

  // Find root nodes and propagate
  for (const [id, node] of Object.entries(nodes)) {
    if (node.parentId === null) {
      propagateUp(id);
    }
  }

  return updated;
}

/**
 * Get all descendant database connection IDs from a node.
 * Only L4 (Hospital) nodes have dbConnectionId.
 */
export function getDescendantDbIds(
  nodeId: string,
  nodes: Record<string, TreeNode>
): string[] {
  const node = nodes[nodeId];
  if (!node) return [];

  const ids: string[] = [];

  if (node.dbConnectionId) {
    ids.push(node.dbConnectionId);
  }

  for (const childId of node.childrenIds) {
    ids.push(...getDescendantDbIds(childId, nodes));
  }

  return ids;
}

/**
 * Get checked hospital node IDs (L4 nodes with Checked state).
 */
export function getCheckedHospitalIds(nodes: Record<string, TreeNode>): string[] {
  return Object.values(nodes)
    .filter((n) => n.type === 'hospital' && n.checkState === CheckState.Checked)
    .map((n) => n.id);
}

/**
 * Count total hospital (L4) nodes.
 */
export function countHospitals(nodes: Record<string, TreeNode>): number {
  return Object.values(nodes).filter((n) => n.type === 'hospital').length;
}

/**
 * Count checked hospital (L4) nodes.
 */
export function countCheckedHospitals(nodes: Record<string, TreeNode>): number {
  return Object.values(nodes).filter(
    (n) => n.type === 'hospital' && n.checkState === CheckState.Checked
  ).length;
}

/**
 * Count checked / total children for a given node (for display like "2/5").
 */
export function getCheckCount(
  nodeId: string,
  nodes: Record<string, TreeNode>
): { checked: number; total: number } {
  const node = nodes[nodeId];
  if (!node) return { checked: 0, total: 0 };

  const hospitals = collectHospitalIds(nodeId, nodes);
  const checked = hospitals.filter(
    (id) => nodes[id]?.checkState === CheckState.Checked
  ).length;
  return { checked, total: hospitals.length };
}

function collectHospitalIds(nodeId: string, nodes: Record<string, TreeNode>): string[] {
  const node = nodes[nodeId];
  if (!node) return [];

  if (node.type === 'hospital') return [nodeId];

  const ids: string[] = [];
  for (const childId of node.childrenIds) {
    ids.push(...collectHospitalIds(childId, nodes));
  }
  return ids;
}

/**
 * Remove a node and all its descendants from the tree.
 * Also removes the node from its parent's childrenIds.
 * Returns a new nodes map.
 */
export function removeNode(
  nodeId: string,
  nodes: Record<string, TreeNode>
): Record<string, TreeNode> {
  const node = nodes[nodeId];
  if (!node) return { ...nodes };

  const updated = { ...nodes };

  // Remove from parent's childrenIds
  if (node.parentId && updated[node.parentId]) {
    updated[node.parentId] = {
      ...updated[node.parentId],
      childrenIds: updated[node.parentId].childrenIds.filter((id) => id !== nodeId),
    };
  }

  // Recursively delete all descendants
  const collectIds = (id: string): string[] => {
    const n = updated[id];
    if (!n) return [];
    let ids: string[] = [id];
    for (const childId of n.childrenIds) {
      ids = ids.concat(collectIds(childId));
    }
    return ids;
  };

  const idsToRemove = collectIds(nodeId);
  for (const id of idsToRemove) {
    delete updated[id];
  }

  return updated;
}

/**
 * Given a parent node type, returns the type for its child nodes.
 */
export function getChildType(parentType: TreeNodeType): TreeNodeType | null {
  switch (parentType) {
    case TreeNodeType.Platform:
      return TreeNodeType.PreDbType;
    case TreeNodeType.PreDbType:
      return TreeNodeType.District;
    case TreeNodeType.District:
      return TreeNodeType.Hospital;
    default:
      return null;
  }
}
