/**
 * 临时数据导出 Zustand Store
 * 管理向导配置、执行进度、状态
 *
 * v1.3.0: 支持多表（selectedTables 数组）+ 自定义 SQL
 * 兼容旧的单表 source 字段（向后兼容旧调用方）
 */
import { create } from 'zustand';
import type {
  ExportProgressEvent,
  ExportSource,
  ExportTarget,
} from '../services/exportService';

export type WizardStep = 0 | 1 | 2;
export type WizardMode = 'source' | 'previewing' | 'idle' | 'executing' | 'done' | 'error';

/** 多表选择项 */
export interface SelectedTable {
  connectionId: string;
  tableName: string;
  schemaName?: string;
}

/** 单个字段映射（源列 → 目标列） */
export interface FieldMapping {
  sourceColumn: string;
  targetColumn: string;
  sourceType?: string;
  targetType?: string;
}

interface ExportState {
  // 向导流程
  open: boolean;
  step: WizardStep;
  mode: WizardMode;

  // 数据源（兼容旧版单 source + 新版 selectedTables）
  source: ExportSource;                          // 单表（兼容旧 UI）
  selectedTables: SelectedTable[];               // 新版多表
  sourceType: 'table' | 'sql';
  sql: string;

  // 预览
  preview: {
    columns: string[];
    rows: Record<string, any>[];
    totalRows: number;
    truncated: boolean;
  } | null;

  // 目标
  target: ExportTarget | null;

  // 字段映射（按 [源表名::目标表名] 为键保存）
  // 每条映射：{ sourceColumn, targetColumn, sourceType?, targetType? }
  columnMappings: Record<string, FieldMapping[]>;

  // 选项
  options: {
    batchSize: number;
    includeHeader: boolean;
    maxRows: number;
  };

  // 执行
  currentExecutionId: string | null;
  progress: {
    stage: string;
    processedRows: number;
    totalRows: number;
    speed: number;
    elapsedMs: number;
    eta: number;
    pct: number;
  };
  result: {
    success: boolean;
    durationMs: number;
    totalRows: number;
    filePath?: string;
    tableName?: string;
    message?: string;
  } | null;

  errorMessage: string | null;

  // Actions
  openWizard: (initial?: Partial<ExportSource> | { tables?: SelectedTable[]; sql?: string; type?: 'table' | 'sql'; connectionId?: string }) => void;
  closeWizard: () => void;
  setStep: (s: WizardStep) => void;
  next: () => void;
  prev: () => void;
  setSource: (src: Partial<ExportSource>) => void;
  setSourceType: (t: 'table' | 'sql') => void;
  setSql: (sql: string) => void;
  setSelectedTables: (t: SelectedTable[]) => void;
  addSelectedTable: (t: SelectedTable) => void;
  removeSelectedTable: (t: SelectedTable) => void;
  setPreview: (p: ExportState['preview']) => void;
  setTarget: (t: ExportTarget) => void;
  /** 更新（或初始化）一对 sourceTable::targetTable 的字段映射 */
  setColumnMappings: (key: string, mappings: FieldMapping[]) => void;
  /** 取指定 sourceTable::targetTable 的字段映射（无则空数组） */
  getColumnMappings: (key: string) => FieldMapping[];
  /** 清空所有字段映射 */
  clearColumnMappings: () => void;
  setOptions: (o: Partial<ExportState['options']>) => void;
  handleProgress: (e: ExportProgressEvent) => void;
  startExecution: (executionId: string) => void;
  finishExecution: (success: boolean, result: ExportState['result']) => void;
  setError: (msg: string) => void;
  reset: () => void;
}

const initialSource: ExportSource = {
  type: 'table',
};

const initialOptions = {
  batchSize: 10000,
  includeHeader: true,
  maxRows: 0, // 0 表示不限制
};

const initialProgress = {
  stage: 'idle',
  processedRows: 0,
  totalRows: 0,
  speed: 0,
  elapsedMs: 0,
  eta: 0,
  pct: 0,
};

export const useExportStore = create<ExportState>((set, get) => ({
  open: false,
  step: 0,
  mode: 'idle',
  source: { ...initialSource },
  sourceType: 'table',
  sql: '',
  selectedTables: [],
  preview: null,
  target: null,
  // 字段映射缓存：key = `${sourceTable}::${targetTable}`
  columnMappings: {},
  options: { ...initialOptions },
  currentExecutionId: null,
  progress: { ...initialProgress },
  result: null,
  errorMessage: null,

  openWizard: (initial) => {
    const init = initial || {};
    console.log('[openWizard] called with init:', init);
    console.log('[openWizard] init.tables:', (init as any).tables);
    console.log('[openWizard] init.tables length:', (init as any).tables?.length);
    const setObj: any = {
      open: true,
      step: 0,
      mode: 'source',
      source: { ...initialSource, ...(init.connectionId ? { connectionId: init.connectionId } : {}) },
      // 总是用 init.tables 替换（如果传了），避免旧的 selectedTables 残留
      selectedTables: 'tables' in init ? (init.tables || []) : [],
      preview: null,
      // 默认 target 为 file（让 targetReady 立即满足，避免提示「请先完成目标选择」）
      target: { type: 'file', format: 'csv', encoding: 'utf-8', filename: '', includeHeader: true, sqlIncludeDrop: false, compress: false },
      result: null,
      errorMessage: null,
      progress: { ...initialProgress },
      currentExecutionId: null,
    };
    // 如果 initial 指定了 sql/type，同步
    if ('sql' in init) setObj.sql = init.sql || '';
    if ('type' in init) setObj.sourceType = init.type || 'table';
    set(setObj);
    console.log('[openWizard] after set, store has selectedTables length:', get().selectedTables.length);
  },

  closeWizard: () => set({ open: false }),

  setStep: (s) => set({ step: s }),

  next: () => {
    const cur = get().step;
    if (cur < 2) set({ step: (cur + 1) as WizardStep });
  },

  prev: () => {
    const cur = get().step;
    if (cur > 0) set({ step: (cur - 1) as WizardStep });
  },

  setSource: (src) => set({ source: { ...get().source, ...src } }),
  setSourceType: (t) => set({ sourceType: t }),
  setSql: (sql) => set({ sql }),
  setSelectedTables: (t) => set({ selectedTables: t }),
  addSelectedTable: (t) => {
    const list = get().selectedTables;
    const exists = list.some(s => s.connectionId === t.connectionId && s.tableName === t.tableName && s.schemaName === t.schemaName);
    if (!exists) set({ selectedTables: [...list, t] });
  },
  removeSelectedTable: (t) =>
    set({
      selectedTables: get().selectedTables.filter(
        (s) => !(s.connectionId === t.connectionId && s.tableName === t.tableName && s.schemaName === t.schemaName)
      ),
    }),
  setPreview: (p) => set({ preview: p }),

  setTarget: (t) => set({ target: t }),

  /** 写入字段映射（覆盖式） */
  setColumnMappings: (key, mappings) =>
    set({ columnMappings: { ...get().columnMappings, [key]: mappings } }),

  /** 读取字段映射（无则空数组） */
  getColumnMappings: (key) => get().columnMappings[key] || [],

  /** 清空全部字段映射（一般在 reset/wizard 关闭时调用） */
  clearColumnMappings: () => set({ columnMappings: {} }),

  setOptions: (o) => set({ options: { ...get().options, ...o } }),

  handleProgress: (e) => {
    if (e.event === 'start') {
      set({
        mode: 'executing',
        progress: {
          stage: 'starting',
          processedRows: 0,
          totalRows: e.totalRows || 0,
          speed: 0,
          elapsedMs: 0,
          eta: 0,
          pct: 0,
        },
      });
    } else if (e.event === 'progress') {
      const cur = get().progress;
      const speed = e.rate ?? cur.speed;
      const elapsed = e.elapsedMs ?? cur.elapsedMs;
      const remaining = e.totalRows ? Math.max(0, e.totalRows - e.processedRows) : 0;
      const eta = speed > 0 ? Math.round((remaining / speed) * 1000) : 0;
      const pct = e.totalRows
        ? Math.min(100, Math.round((e.processedRows / e.totalRows) * 100))
        : 0;
      set({
        progress: {
          stage: 'running',
          processedRows: e.processedRows,
          totalRows: e.totalRows ?? cur.totalRows,
          speed,
          elapsedMs: elapsed,
          eta,
          pct,
        },
      });
    }
  },

  startExecution: (executionId) =>
    set({
      currentExecutionId: executionId,
      mode: 'executing',
      errorMessage: null,
      result: null,
    }),

  finishExecution: (success, result) =>
    set({
      mode: success ? 'done' : 'error',
      result,
    }),

  setError: (msg) => set({ errorMessage: msg, mode: 'error' }),

  reset: () =>
    set({
      open: false,
      step: 0,
      mode: 'idle',
      source: { ...initialSource },
      selectedTables: [],
      preview: null,
      target: null,
      result: null,
      errorMessage: null,
      progress: { ...initialProgress },
      currentExecutionId: null,
      // 不清空 columnMappings：用户可能再次打开同一对 source/target 复用
    }),
}));

/**
 * 把当前 store 状态组装成 ExportConfig
 * 优先取 selectedTables[0]（多表模式下一次只导一张）
 */
export function buildExportConfig(state: ExportState): {
  source: ExportSource;
  target: any;
  batchSize?: number;
  selectedTables?: Array<{ connectionId: string; tableName: string; schemaName?: string }>;
} {
  // 多表模式：把所有 selectedTables 都传过去（后端按 tableNameArr 逐表处理）
  if (state.selectedTables.length > 0) {
    const t = state.selectedTables[0];
    // 确保 db target 有 tableName（单表用 tableName，多表用 tableNameArr[0] 兜底）
    const target: any = { ...state.target! };
    if (target.type === 'database' && !target.tableName) {
      target.tableName = (target.tableNameArr && target.tableNameArr[0]) || t.tableName;
    }
    return {
      source: {
        type: 'table',
        connectionId: t.connectionId,
        tableName: t.tableName,
        schemaName: t.schemaName,
      },
      target,
      batchSize: state.options.batchSize,
      // 所有源表
      selectedTables: state.selectedTables,
    };
  }
  // 单表模式（兼容旧）
  return {
    source: state.source,
    target: state.target!,
    batchSize: state.options.batchSize,
  };
}