/**
 * 树节点类型
 * 层级规范：项目(Platform) → 业务模块(PreDbType) → 区域节点(District) → 连接实例(Hospital)
 */
export enum TreeNodeType {
  /** 第1层：项目 */
  Platform = 'platform',
  /** 第2层：业务模块 */
  PreDbType = 'predb_type',
  /** 第3层：区域节点 */
  District = 'district',
  /** 第4层：连接实例 */
  Hospital = 'hospital',
}

export enum CheckState {
  Unchecked = 'unchecked',
  Checked = 'checked',
  Indeterminate = 'indeterminate',
}

export interface TreeNode {
  id: string;
  name: string;
  type: TreeNodeType;
  checkState: CheckState;
  expanded: boolean;
  parentId: string | null;
  childrenIds: string[];
  dbConnectionId?: string;
  visible: boolean;
  highlightText?: string;
  sortOrder?: number;
}
