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
