export enum DiffType {
  Same = 'same',
  Different = 'different',
  Missing = 'missing',
}

export interface QueryResult {
  dbConnectionId: string;
  sourceLabel: string;
  columns: string[];
  rows: ResultRow[];
  totalRows: number;
  truncated?: boolean;
  /** 是否还有更多数据（分页模式） */
  hasMore?: boolean;
  /** 已加载的总行数（分页模式） */
  totalLoaded?: number;
}

export interface ResultRow {
  sourceDbLabel: string;
  values: Record<string, CellValue>;
}

export interface CellValue {
  value: any;
  diffType: DiffType;
}

export interface AggregatedResult {
  columns: string[];
  rows: ResultRow[];
  sources: string[];
}
