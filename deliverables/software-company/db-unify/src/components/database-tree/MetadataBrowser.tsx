import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Box, Typography, CircularProgress, Collapse, List, ListItemButton,
  ListItemText, IconButton, Tooltip, Chip, Snackbar, Alert,
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import RefreshIcon from '@mui/icons-material/Refresh';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import AddBoxIcon from '@mui/icons-material/AddBox';
import EditNoteIcon from '@mui/icons-material/EditNote';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import CalculateIcon from '@mui/icons-material/Calculate';
import DriveFileRenameOutlineIcon from '@mui/icons-material/DriveFileRenameOutline';
import ListAltIcon from '@mui/icons-material/ListAlt';
import CodeIcon from '@mui/icons-material/Code';
import TableChartIcon from '@mui/icons-material/TableChart';
import VisibilityIcon from '@mui/icons-material/Visibility';
import SecurityIcon from '@mui/icons-material/Security';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { SchemaIcon, TableIcon, ViewIcon, FunctionIcon, ProcedureIcon } from './DbIcons';
import {
  fetchMetadata,
  fetchConnectionSchemas,
  generateSelectSql,
  generateSelectStarSql,
  generateInsertSql,
  generateUpdateSql,
  generateDeleteSql,
  generateCountSql,
  fetchTableDdl,
} from '../../services/metadataService';
import type { TableMeta } from '../../services/metadataService';
import { useEditorStore } from '../../stores/editorStore';
import type { DbConnection } from '../../types/connection';
import ContextMenu from '../common/ContextMenu';
import type { ContextMenuItemDef } from '../common/ContextMenu';
import RoleManager from '../database-role/RoleManager';
import CreateTableDialog from '../database-table/CreateTableDialog';
import CreateViewDialog from '../database-table/CreateViewDialog';
import EditTableDialog from '../database-table/EditTableDialog';
import ConfirmDropDialog from '../database-table/ConfirmDropDialog';
import FieldViewerDialog from '../database-table/FieldViewerDialog';
import ImportExportIcon from '@mui/icons-material/ImportExport';
import ExportWizard from '../data-export/ExportWizard';
import { useExportStore } from '../../stores/exportStore';
import { deleteTable, deleteView, fetchViewDdl } from '../../services/tableMgmtService';
import { fetchFunctions, fetchProcedures, fetchFunctionDetail, fetchFunctionDdl, deleteFunction, type FunctionInfo, type ProcedureInfo } from '../../services/functionMgmtService';
import { apiFetch } from '../../services/apiClient';

interface MetadataBrowserProps {
  connection: DbConnection;
  /** 数据库连接节点的缩进（px）。表/视图会在此基础上再缩进一级 */
  baseIndentPx?: number;
}

interface SchemaState {
  loading: boolean;
  error: string;
  data: TableMeta[] | null;
  expanded: boolean;
  tablesOpen: boolean;
  viewsOpen: boolean;
  functionsOpen: boolean;
  proceduresOpen: boolean;
  functionsLoading: boolean;
  proceduresLoading: boolean;
  functions: FunctionInfo[];
  procedures: ProcedureInfo[];
}

const emptySchemaState = (): SchemaState => ({
  loading: false,
  error: '',
  data: null,
  expanded: false,
  tablesOpen: false,
  viewsOpen: false,
  functionsOpen: false,
  proceduresOpen: false,
  functionsLoading: false,
  proceduresLoading: false,
  functions: [],
  procedures: [],
});

const MetadataBrowser: React.FC<MetadataBrowserProps> = ({ connection, baseIndentPx = 14 }) => {
  const hasSchema = !!connection.schema;

  // Schema 列表（当连接未配置 schema 时使用）
  const [schemas, setSchemas] = useState<string[] | null>(null);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const [schemasError, setSchemasError] = useState('');

  // 每个 schema 独立状态（当 hasSchema 时用 '__default__' 作 key）
  const DEFAULT_KEY = '__default__';
  const [schemaStates, setSchemaStates] = useState<Record<string, SchemaState>>({});

  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [snackbar, setSnackbar] = useState(false);
  const [snackbarMsg, setSnackbarMsg] = useState('已生成 SELECT 语句');

  // 拖选
  const isDragging = useRef(false);
  const dragStartKey = useRef<string | null>(null);
  const didDrag = useRef(false); // 标记是否真的发生了拖拽移动
  const lastClickKey = useRef<string | null>(null); // 上次点击的表，用于 Shift 区间选择

  // 鼠标释放清除拖拽状态
  useEffect(() => {
    const handleUp = () => { isDragging.current = false; dragStartKey.current = null; };
    document.addEventListener('mouseup', handleUp);
    return () => document.removeEventListener('mouseup', handleUp);
  }, []);

  // 右键菜单状态
  const [ctxMenu, setCtxMenu] = useState<{
    anchor: { top: number; left: number };
    table: TableMeta;
    schemaName?: string;
  } | null>(null);

  type DdlType = 'create' | 'selectStar' | 'select' | 'insert' | 'update' | 'delete' | 'drop' | 'truncate';

  const DDL_TYPE_CONFIG: { key: DdlType; label: string }[] = [
    { key: 'create', label: 'CREATE' },
    { key: 'selectStar', label: 'SELECT *' },
    { key: 'select', label: 'SELECT 列' },
    { key: 'insert', label: 'INSERT' },
    { key: 'update', label: 'UPDATE' },
    { key: 'delete', label: 'DELETE' },
    { key: 'drop', label: 'DROP' },
    { key: 'truncate', label: 'TRUNCATE' },
  ];

  // 缓存当前查看 DDL 的表信息（列、schema），用于切换 DDL 类型时无需重新请求后端
  const currentTableMeta = useRef<{ table: TableMeta; schemaName?: string } | null>(null);

  // DDL 选项：显示注释、使用完整限定名、显示权限
  const [ddlShowComments, setDdlShowComments] = useState(true);
  const [ddlShowFqn, setDdlShowFqn] = useState(true);
  const [ddlShowGrants, setDdlShowGrants] = useState(false);
  const ddlOptRef = useRef({ comments: true, fqn: true, grants: false });
  useEffect(() => { ddlOptRef.current = { comments: ddlShowComments, fqn: ddlShowFqn, grants: ddlShowGrants }; }, [ddlShowComments, ddlShowFqn, ddlShowGrants]);
  // 选项开关变化时触发 DDL 重新生成
  const [ddlOptTrigger, setDdlOptTrigger] = useState(0);

  // DDL 对话框状态
  const [ddlDialog, setDdlDialog] = useState<{
    open: boolean;
    tableName: string;
    ddl: string;
    loading: boolean;
    error: string;
    ddlType: DdlType;
  }>({ open: false, tableName: '', ddl: '', loading: false, error: '', ddlType: 'create' });

  // --- 新增功能状态 ---

  // Schema 级右键菜单
  const [schemaCtxMenu, setSchemaCtxMenu] = useState<{
    anchor: { top: number; left: number };
    schemaName?: string;
  } | null>(null);

  // 创建表对话框
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [createTableSchema, setCreateTableSchema] = useState<string | undefined>();

  // 创建/编辑视图对话框
  const [viewDialog, setViewDialog] = useState<{
    open: boolean;
    editView?: { viewName: string; asSql?: string; comment?: string } | null;
    schemaName?: string;
  }>({ open: false });

  // 编辑表对话框
  const [editTableDialog, setEditTableDialog] = useState<{
    open: boolean;
    tableName: string;
    columns: { name: string; type: string; nullable: boolean; default?: string; comment?: string }[];
    schemaName?: string;
  }>({ open: false, tableName: '', columns: [] });

  // 角色管理对话框
  const [roleManagerOpen, setRoleManagerOpen] = useState(false);
  const [roleManagerSchema, setRoleManagerSchema] = useState<string | undefined>();

  // 删除表/视图确认
  const [dropConfirm, setDropConfirm] = useState<{
    open: boolean;
    type: 'TABLE' | 'VIEW';
    name: string;
    schemaName?: string;
  } | null>(null);

  // 字段查看对话框
  const [fieldViewer, setFieldViewer] = useState<{
    open: boolean;
    tableName: string;
    schemaName?: string;
    columns: { name: string; type: string; length?: number; nullable?: boolean; primaryKey?: boolean; defaultValue?: string; comment?: string }[];
  }>({ open: false, tableName: '', columns: [] });

  const openContextMenu = (e: React.MouseEvent, table: TableMeta, schemaName?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ anchor: { top: e.clientY, left: e.clientX }, table, schemaName });
  };
  const closeContextMenu = () => setCtxMenu(null);

  const openSchemaContextMenu = (e: React.MouseEvent, schemaName?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setSchemaCtxMenu({ anchor: { top: e.clientY, left: e.clientX }, schemaName });
  };
  const closeSchemaContextMenu = () => setSchemaCtxMenu(null);

  const setSql = useEditorStore(s => s.setSql);

  const getSt = (key: string): SchemaState => schemaStates[key] || emptySchemaState();
  const patchSt = (key: string, patch: Partial<SchemaState>) => {
    setSchemaStates(prev => ({ ...prev, [key]: { ...emptySchemaState(), ...prev[key], ...patch } }));
  };

  // ----- Schema 列表加载 -----
  const loadSchemas = useCallback(async () => {
    if (schemas || schemasLoading) return;
    setSchemasLoading(true);
    setSchemasError('');
    try {
      const data = await fetchConnectionSchemas(connection.id);
      setSchemas(data);
    } catch (err: any) {
      setSchemasError(err.message || '加载 Schema 失败');
    } finally {
      setSchemasLoading(false);
    }
  }, [connection.id, schemas, schemasLoading]);

  // hasSchema 分支：初次即触发加载
  useEffect(() => {
    if (hasSchema && !schemaStates[DEFAULT_KEY]) {
      patchSt(DEFAULT_KEY, { expanded: true });
    } else if (!hasSchema && !schemas && !schemasLoading) {
      loadSchemas();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSchema]);

  // ----- 元数据加载 -----
  const loadMeta = useCallback(async (schemaKey: string, schemaName?: string) => {
    const st = getSt(schemaKey);
    if (st.data || st.loading) return;
    patchSt(schemaKey, { loading: true, error: '' });
    try {
      const data = await fetchMetadata(connection.id, schemaName);
      patchSt(schemaKey, { loading: false, data });
    } catch (err: any) {
      patchSt(schemaKey, { loading: false, error: err.message || '加载元数据失败' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connection.id, schemaStates]);

  // ----- 交互 -----
  const toggleSchema = (schemaName: string) => {
    const st = getSt(schemaName);
    patchSt(schemaName, { expanded: !st.expanded });
  };

  const toggleTablesGroup = (schemaKey: string, schemaName?: string) => {
    const st = getSt(schemaKey);
    const willOpen = !st.tablesOpen;
    patchSt(schemaKey, { tablesOpen: willOpen });
    if (willOpen && !st.data && !st.loading) {
      loadMeta(schemaKey, schemaName);
    }
  };

  const toggleViewsGroup = (schemaKey: string, schemaName?: string) => {
    const st = getSt(schemaKey);
    const willOpen = !st.viewsOpen;
    patchSt(schemaKey, { viewsOpen: willOpen });
    if (willOpen && !st.data && !st.loading) {
      loadMeta(schemaKey, schemaName);
    }
  };

  const toggleFunctionsGroup = async (schemaKey: string, schemaName?: string) => {
    const st = getSt(schemaKey);
    const willOpen = !st.functionsOpen;
    patchSt(schemaKey, { functionsOpen: willOpen, functionsLoading: true });
    if (willOpen && st.functions.length === 0) {
    try {
        const data = await fetchFunctions(connection.id, schemaName || schemaKey);
        patchSt(schemaKey, { functions: data, functionsLoading: false });
      } catch (err: any) {
        patchSt(schemaKey, { functionsLoading: false, error: err.message || '加载函数失败' });
      }
    } else {
      patchSt(schemaKey, { functionsOpen: willOpen });
    }
  };

  const toggleProceduresGroup = async (schemaKey: string, schemaName?: string) => {
    const st = getSt(schemaKey);
    const willOpen = !st.proceduresOpen;
    patchSt(schemaKey, { proceduresOpen: willOpen, proceduresLoading: true });
    if (willOpen && st.procedures.length === 0) {
    try {
        const data = await fetchProcedures(connection.id, schemaName || schemaKey);
        patchSt(schemaKey, { procedures: data, proceduresLoading: false });
      } catch (err: any) {
        patchSt(schemaKey, { proceduresLoading: false, error: err.message || '加载存储过程失败' });
      }
    } else {
      patchSt(schemaKey, { proceduresOpen: willOpen });
    }
  };

  const refreshMeta = (schemaKey: string, schemaName?: string) => {
    patchSt(schemaKey, { data: null, error: '' });
    loadMeta(schemaKey, schemaName);
  };

  const addTab = useEditorStore(s => s.addTab);

  /** 生成 SQL：新建标签页，避免覆盖用户当前正在编辑的内容 */
  const injectSql = (sql: string, msg: string) => {
    addTab();          // 先建新 tab（addTab 会切到新 tab 并清空 sql）
    setSql(sql);       // 再写入 SQL（作用在新 tab 上）
    setSnackbarMsg(msg);
    setSnackbar(true);
  };

  /** 构建表/视图右键菜单项（紧凑，图标 13px 左对齐） */
  const buildTableMenuItems = (table: TableMeta, schemaName?: string): ContextMenuItemDef[] => {
    const isView = table.type === 'VIEW';

    // 表名限定：有 schema 就用 "schema.table"，避免 search_path 找不到表
    const qualifiedTable = schemaName ? `${schemaName}.${table.name}` : table.name;

    // 右键菜单所有 SQL 生成默认带双引号（适配 PG/瀚高 等需要引号标识符的数据库）
    const genSelect = () => injectSql(generateSelectSql(qualifiedTable, table.columns, '"'), '已生成 SELECT 语句');
    const genSelectStar = () => injectSql(generateSelectStarSql(qualifiedTable, '"'), '已生成 SELECT * 语句');
    const genCount = () => injectSql(generateCountSql(qualifiedTable, '"'), '已生成 COUNT 语句');
    const genInsert = () => injectSql(generateInsertSql(qualifiedTable, table.columns, '"'), '已生成 INSERT 语句');
    const genUpdate = () => injectSql(generateUpdateSql(qualifiedTable, table.columns, '"'), '已生成 UPDATE 语句');
    const genDelete = () => injectSql(generateDeleteSql(qualifiedTable, '"'), '已生成 DELETE 语句');

    // 「生成 SQL」子菜单：紧凑排列，读类和写类之间加一条分隔
    const genSqlChildren: ContextMenuItemDef[] = [
      { label: 'SELECT (完整列)', icon: <PlayArrowIcon />,          onClick: genSelect },
      { label: 'SELECT *',        icon: <FormatListNumberedIcon />, onClick: genSelectStar },
      { label: 'COUNT(*)',        icon: <CalculateIcon />,          onClick: genCount },
      ...(isView ? [] : [
        { label: 'INSERT', icon: <AddBoxIcon />,      onClick: genInsert, divider: true },
        { label: 'UPDATE', icon: <EditNoteIcon />,    onClick: genUpdate },
        { label: 'DELETE', icon: <DeleteSweepIcon />, onClick: genDelete, danger: true },
      ]),
    ];

    return [
      {
        label: '导出数据',
        icon: <ImportExportIcon />,
        onClick: () => {
          const selectedTableList = Array.from(selectedTables).flatMap((tableKey) => {
            const separatorIndex = tableKey.indexOf('::');
            if (separatorIndex < 0) return [];

            const schemaKey = tableKey.slice(0, separatorIndex);
            const tableName = tableKey.slice(separatorIndex + 2);
            const selectedTable = schemaStates[schemaKey]?.data?.find(
              (candidate) => candidate.name === tableName
            );
            if (!selectedTable) return [];

            return [{
              connectionId: connection.id,
              tableName: selectedTable.name,
              schemaName: schemaKey === DEFAULT_KEY ? undefined : schemaKey,
            }];
          });

          // 选中时用的是 schemaKey（DEFAULT_KEY 或真实 schema），右键时 schemaName 不一定是 DEFAULT_KEY
          // 改为通过表名比对比对（因为同一表无论 schemaKey 是什么，实际名一样）
          const tableNameInSelected = Array.from(selectedTables).some((tableKey) => {
            const separatorIndex = tableKey.indexOf("::");
            return separatorIndex >= 0 && tableKey.slice(separatorIndex + 2) === table.name;
          });
          const inSelectedSet = tableNameInSelected;
          let tables: Array<{ connectionId: string; tableName: string; schemaName?: string }>;
          if (inSelectedSet && selectedTableList.length > 0) {
            tables = selectedTableList;
          } else {
            tables = [{ connectionId: connection.id, tableName: table.name, schemaName }];
          }

          useExportStore.getState().openWizard({
            connectionId: connection.id,
            tables,
          });
        },
      },
      {
        label: '生成 SQL',
        icon: <PlayArrowIcon />,
        children: genSqlChildren,
      },
      {
        label: selectedTables.size > 1 ? `复制 ${selectedTables.size} 个表名` : '复制表名',
        icon: <DriveFileRenameOutlineIcon />,
        onClick: () => {
          if (selectedTables.size > 1) {
            // 多选：从 selectedTables (Set<"schema::table">) 收集所有表名，限定 schema
            const names = Array.from(selectedTables).flatMap((key) => {
              const idx = String(key).indexOf('::');
              if (idx < 0) return [];
              const s = String(key).slice(0, idx);
              const t = String(key).slice(idx + 2);
              return [{ name: s ? `${s}.${t}` : t }];
            });
            handleCopyTableName(names, '');
          } else {
            handleCopyTableName([{ name: qualifiedTable }], '');
          }
        },
        divider: true,
      },
      {
        label: '复制所有字段',
        icon: <ListAltIcon />,
        onClick: () => handleCopyColumnsList(table, '"'),
      },
      {
        label: '查看字段',
        icon: <ListAltIcon />,
        onClick: () => {
          setFieldViewer({
            open: true,
            tableName: table.name,
            schemaName: schemaName,
            columns: table.columns.map(c => ({
              name: c.name,
              type: c.type,
              length: c.length,
              nullable: c.nullable,
              primaryKey: c.primaryKey,
              defaultValue: c.default,
              comment: c.comment,
            })),
          });
        },
      },
      {
        label: '查看 DDL',
        icon: <CodeIcon />,
        onClick: () => handleViewDdl(table, schemaName),
      },
      {
        label: isView ? '编辑视图' : '编辑表',
        icon: isView ? <VisibilityIcon /> : <EditNoteIcon />,
        onClick: async () => {
          if (isView) {
            try {
              const ddl = await fetchViewDdl(connection.id, table.name, schemaName);
              setViewDialog({ open: true, editView: { viewName: table.name, comment: table.comment, asSql: ddl }, schemaName });
            } catch {
              // 失败时仍打开，SQL 为空
              setViewDialog({ open: true, editView: { viewName: table.name, comment: table.comment }, schemaName });
            }
          } else {
            setEditTableDialog({
              open: true,
              tableName: table.name,
              columns: table.columns.map(c => ({
                name: c.name,
                type: c.type,
                nullable: c.nullable,
                default: c.default,
                comment: c.comment,
              })),
              schemaName,
            });
          }
        },
        divider: true,
      },
      {
        label: isView ? '删除视图' : '删除表',
        icon: <DeleteIcon />,
        danger: true,
        onClick: () => {
          setDropConfirm({ open: true, type: isView ? 'VIEW' : 'TABLE', name: table.name, schemaName });
        },
      },
    ];
  };

  /** 构建 Schema 级右键菜单项 */
  const buildSchemaMenuItems = (schemaName?: string): ContextMenuItemDef[] => {
    return [
      {
        label: '创建表',
        icon: <TableChartIcon />,
        onClick: () => {
          setCreateTableSchema(schemaName);
          setCreateTableOpen(true);
        },
      },
      {
        label: '创建视图',
        icon: <VisibilityIcon />,
        onClick: () => {
          setViewDialog({ open: true, editView: null, schemaName });
        },
      },
      {
        label: '角色管理',
        icon: <SecurityIcon />,
        onClick: () => {
          setRoleManagerSchema(schemaName);
          setRoleManagerOpen(true);
        },
        divider: true,
      },
    ];
  };

  const handleCopyTableName = async (tables: any[], quote = '') => {
    // 多选时拼接所有表名（用逗号分隔）；单击时单个表
    const names = tables.map((t) => `${quote}${t.name}${quote}`);
    const text = names.join(', ');
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setSnackbarMsg(tables.length > 1 ? `已复制 ${tables.length} 个表名` : `已复制：${text}`);
      setSnackbar(true);
    } catch {
      setSnackbarMsg('复制失败');
      setSnackbar(true);
    }
  };

  const handleCopyColumnsList = async (table: TableMeta, quote: '' | '"' = '') => {
    const cols = table.columns.map(c => `${quote}${c.name}${quote}`).join(', ');
    try {
      await navigator.clipboard.writeText(cols);
      setSnackbarMsg(quote ? '已复制字段列表（带双引号）' : '已复制字段列表');
      setSnackbar(true);
    } catch {
      setSnackbarMsg('复制失败');
      setSnackbar(true);
    }
  };

  /** 生成单表/多表 DDL（支持注释/限定名/权限选项） */
  async function handleGenerateDdl(type: DdlType) {
    const opts = ddlOptRef.current;

    // 非 create 类型只支持单表
    if (type !== 'create' && selectedTables.size > 1) {
      setSnackbarMsg('批量模式下仅支持 CREATE 类型');
      setSnackbar(true);
      return;
    }

    // 批量模式：遍历所有选中表
    if (selectedTables.size > 1 && type === 'create') {
      const title = `生成 DDL（${selectedTables.size} 个表）`;
      setDdlDialog({ open: true, tableName: title, ddl: '', loading: true, error: '', ddlType: 'create' });
    try {
        const tableNames: string[] = [];
        const results: string[] = [];
        for (const tableKey of selectedTables) {
          const [sKey, tName] = tableKey.split('::');
          const st = schemaStates[sKey];
          const tbl = st?.data?.find(t => t.name === tName);
          if (!tbl) continue;
          const tblSchema = sKey !== DEFAULT_KEY ? sKey : (connection.schema || undefined);
          const useFqn = opts.fqn && !!tblSchema;
          const qualified = useFqn ? `"${tblSchema}"."${tbl.name}"` : `"${tbl.name}"`;
          const backendTable = tblSchema ? `${tblSchema}.${tbl.name}` : tbl.name;
          let sql = await fetchTableDdl(connection.id, backendTable);
          // 移除 schema 前缀
          if (!opts.fqn && tblSchema) sql = sql.replace(new RegExp(`"${tblSchema}"\\.`, 'g'), '');
          // 注释
          if (opts.comments) {
            const parts: string[] = [];
            if (tbl.comment) parts.push(`\n-- Table comment\nCOMMENT ON TABLE ${qualified} IS '${tbl.comment.replace(/'/g, "''")}';`);
            const colComments = tbl.columns.filter(c => c.comment).map(c =>
              `COMMENT ON COLUMN ${qualified}."${c.name}" IS '${c.comment!.replace(/'/g, "''")}';`
            );
            if (colComments.length > 0) parts.push(`\n-- Column comments\n${colComments.join('\n')}`);
            if (parts.length > 0) sql += parts.join('');
          }
          // 权限
          if (opts.grants && tblSchema) {
            try {
              const g = await apiFetch(`/api/connection/${connection.id}/ddl/grants`, {
                method: 'POST',
                body: JSON.stringify({ schema: tblSchema, table: tbl.name }),
              });
              if (g.ok) {
                const gd = await g.json();
                if (gd.owner) sql += `\n\n-- Permissions\n\nALTER TABLE ${qualified} OWNER TO ${gd.owner};`;
                if (gd.grants?.length) sql += '\n' + gd.grants.join('\n');
              }
            } catch {}
          }
          tableNames.push(tbl.name);
          results.push(`-- ===== ${tbl.name} =====\n${sql}`);
        }
        setDdlDialog(prev => ({ ...prev, ddl: results.join('\n\n'), loading: false }));
      } catch (err: any) {
        setDdlDialog(prev => ({ ...prev, loading: false, error: err.message || '获取 DDL 失败' }));
      }
      return;
    }

    // 单表模式
    const meta = currentTableMeta.current;
    if (!meta) return;
    const { table, schemaName } = meta;
    const useFqn = opts.fqn && !!schemaName;
    const qualifiedTable = useFqn ? `"${schemaName}"."${table.name}"` : `"${table.name}"`;

    setDdlDialog(prev => ({
      ...prev,
      open: true,
      tableName: meta ? (meta.schemaName ? `${meta.schemaName}.${meta.table.name}` : meta.table.name) : prev.tableName,
      ddlType: type, ddl: '', loading: true, error: '',
    }));

    try {
      let sql = '';
      switch (type) {
        case 'create':
          // 传给后端的表名不能带引号（后端会自己拼接 SQL）
          const backendTable = schemaName ? `${schemaName}.${table.name}` : table.name;
          sql = await fetchTableDdl(connection.id, backendTable);
          // 如果关闭了限定名，从 DDL 中移除 schema 前缀
          if (!opts.fqn && schemaName) {
            sql = sql.replace(new RegExp(`"${schemaName}"\\.`, 'g'), '');
          }
          if (opts.comments) {
            const commentParts: string[] = [];
            if (table.comment) {
              commentParts.push(`\n-- Table comment\nCOMMENT ON TABLE ${qualifiedTable} IS '${table.comment.replace(/'/g, "''")}';`);
            }
            const colComments = table.columns.filter(c => c.comment).map(c =>
              `COMMENT ON COLUMN ${qualifiedTable}."${c.name}" IS '${c.comment!.replace(/'/g, "''")}';`
            );
            if (colComments.length > 0) {
              commentParts.push(`\n-- Column comments\n${colComments.join('\n')}`);
            }
            if (commentParts.length > 0) sql += commentParts.join('');
          }
          if (opts.grants) {
            try {
              const grantResp = await apiFetch(`/api/connection/${connection.id}/ddl/grants`, {
                method: 'POST',
                body: JSON.stringify({ schema: schemaName || 'public', table: table.name }),
              });
              if (grantResp.ok) {
                const grantData = await grantResp.json();
                if (grantData.owner) sql += `\n\n-- Permissions\n\nALTER TABLE ${qualifiedTable} OWNER TO ${grantData.owner};`;
                if (grantData.grants && grantData.grants.length > 0) sql += '\n' + grantData.grants.join('\n');
              }
            } catch {}
          }
          break;
        case 'selectStar': sql = `SELECT * FROM ${qualifiedTable} LIMIT 100;`; break;
        case 'select': {
          const cols = table.columns.map(c => `"${c.name}"`).join(', ');
          sql = `SELECT ${cols} FROM ${qualifiedTable} LIMIT 100;`;
          break;
        }
        case 'insert': {
          const cols = table.columns.map(c => `"${c.name}"`).join(', ');
          const vals = table.columns.map(() => '?').join(', ');
          sql = `INSERT INTO ${qualifiedTable} (${cols}) VALUES (${vals});`;
          break;
        }
        case 'update': {
          const setCols = table.columns.map(c => `"${c.name}" = ?`).join(', ');
          sql = `UPDATE ${qualifiedTable} SET ${setCols} WHERE ;`;
          break;
        }
        case 'delete': sql = `DELETE FROM ${qualifiedTable} WHERE ;`; break;
        case 'drop': sql = `DROP TABLE IF EXISTS ${qualifiedTable};`; break;
        case 'truncate': sql = `TRUNCATE TABLE ${qualifiedTable};`; break;
      }
      setDdlDialog(prev => ({ ...prev, ddl: sql, loading: false }));
    } catch (err: any) {
      setDdlDialog(prev => ({ ...prev, loading: false, error: err.message || `生成 ${type} SQL 失败` }));
    }
  }

  // 选项开关变化时自动刷新当前类型的 DDL
  useEffect(() => {
    if (ddlDialog.open && currentTableMeta.current) {
      handleGenerateDdl(ddlDialog.ddlType);
    }
  }, [ddlOptTrigger]);

  const handleCopyDdl = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(ddlDialog.ddl);
      setSnackbarMsg('DDL 已复制到剪贴板');
      setSnackbar(true);
    } catch {
      setSnackbarMsg('复制失败');
      setSnackbar(true);
    }
  }, [ddlDialog.ddl]);

  /** 查看建表 DDL（支持批量：选中多个表时生成全部 DDL） */
  const handleViewDdl = useCallback(async (table: TableMeta, schemaName?: string) => {
    // 缓存当前表的元信息，供切换 DDL 类型时使用
    currentTableMeta.current = { table, schemaName };

    // 如果有多个选中表，生成所有选中表的批量 DDL
    const targetKeys = selectedTables.size > 0 ? selectedTables : new Set([`${schemaName || '__default__'}::${table.name}`]);
    if (targetKeys.size > 1) {
      // 批量模式：交给 handleGenerateDdl（它会应用注释/限定名/权限等选项）
      await handleGenerateDdl('create');
    } else {
      // 单表模式：交给 handleGenerateDdl（它会应用注释/限定名/权限等选项）
      await handleGenerateDdl('create');
    }
  }, [connection.id, selectedTables, schemaStates, handleGenerateDdl]);

  /** 批量 SQL 生成 */
  const handleBatchSql = useCallback((type: 'select' | 'selectStar' | 'insert' | 'update' | 'delete' | 'count') => {
    const sqls: string[] = [];
    for (const tableKey of selectedTables) {
      const [schemaKey, tableName] = tableKey.split('::');
      const st = schemaStates[schemaKey];
      const table = st?.data?.find(t => t.name === tableName);
      if (table) {
        const qualified = schemaKey !== DEFAULT_KEY ? `${schemaKey}.${tableName}` : tableName;
        switch (type) {
          case 'select': sqls.push(generateSelectSql(qualified, table.columns, '"') + ';'); break;
          case 'selectStar': sqls.push(generateSelectStarSql(qualified, '"') + ';'); break;
          case 'insert': sqls.push(generateInsertSql(qualified, table.columns, '"') + ';'); break;
          case 'update': sqls.push(generateUpdateSql(qualified, table.columns, '"') + ';'); break;
          case 'delete': sqls.push(generateDeleteSql(qualified, '"') + ';'); break;
          case 'count': sqls.push(generateCountSql(qualified, '"') + ';'); break;
        }
      }
    }
    if (sqls.length > 0) {
      const label = type === 'selectStar' ? 'SELECT *' : type === 'select' ? 'SELECT 列' : type.toUpperCase();
      injectSql(sqls.join('\n'), `已为 ${selectedTables.size} 个表生成 ${label} 语句`);
    }
  }, [selectedTables, schemaStates]);

  // ----- 渲染：单个表/视图节点（支持拖选） -----
  const renderTableItem = (schemaKey: string, table: TableMeta, indentPx: number, schemaName?: string) => {
    const tableKey = `${schemaKey}::${table.name}`;
    const isView = table.type === 'VIEW';
    return (
      <Box key={tableKey}>
        <ListItemButton
          draggable
          onDragStart={(e) => {
            // 设置拖拽数据：表名（带 schema 前缀）
            const fullName = schemaName ? `"${schemaName}"."${table.name}"` : `"${table.name}"`;
            e.dataTransfer.setData('text/plain', fullName);
            e.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={(e) => {
            // 如果刚拖拽过，跳过 onClick（防止拖拽后重置选中）
            if (didDrag.current) {
              didDrag.current = false;
              return;
            }
            // 多选逻辑：
            // - Ctrl + 点击：单个点选/取消
            // - Shift + 点击：区间选择（从 lastClickKey 到 tableKey 之间的所有表）
            // - 普通点击：单选
            if (e.ctrlKey) {
              setSelectedTables(prev => {
                const next = new Set(prev);
                if (next.has(tableKey)) {
                  next.delete(tableKey);
                } else {
                  next.add(tableKey);
                }
                return next;
              });
              lastClickKey.current = tableKey;
            } else if (e.shiftKey && lastClickKey.current) {
              // 区间选择：扁平化所有可见表，找到区间
              const flatList = [] as string[];
              Object.entries(schemaStates).forEach(([schemaKey, st]: [string, any]) => {
                if (st && st.data) {
                  st.data.forEach((t: any) => {
                    flatList.push(`${schemaKey}::${t.name}`);
                  });
                }
              });
              const startIdx = flatList.indexOf(lastClickKey.current);
              const endIdx = flatList.indexOf(tableKey);
              if (startIdx >= 0 && endIdx >= 0) {
                const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
                const range = flatList.slice(from, to + 1);
                setSelectedTables(prev => {
                  const next = new Set(prev);
                  range.forEach(k => next.add(k));
                  return next;
                });
              }
            } else {
              setSelectedTables(new Set([tableKey]));
              lastClickKey.current = tableKey;
            }
          }}
          onMouseDown={(e) => {
            if (e.button === 0) {
              // 拖拽准备：只标记状态，不修改选择
              isDragging.current = true;
              didDrag.current = false;
              dragStartKey.current = tableKey;
            }
          }}
          onMouseEnter={() => {
            // 不再通过鼠标进入追加选择，避免与拖动表名冲突
          }}
          onDoubleClick={() => {
            setFieldViewer({
              open: true,
              tableName: table.name,
              schemaName: schemaName,
              columns: table.columns.map(c => ({
                name: c.name,
                type: c.type,
                length: c.length,
                nullable: c.nullable,
                primaryKey: c.primaryKey,
                defaultValue: c.default,
                comment: c.comment,
              })),
            });
          }}
          onContextMenu={(e) => openContextMenu(e, table, schemaName)}
          sx={{
            py: 0,
            minHeight: 14,
            pl: `${indentPx}px`,
            ...(selectedTables.has(tableKey)
              ? { bgcolor: 'primary.dark', color: 'white', '&:hover': { bgcolor: 'primary.dark' } }
              : { '&:hover': { bgcolor: 'action.hover' } }),
          }}
        >
          {isView
            ? <ViewIcon size={11} style={{ marginRight: 2 }} />
            : <TableIcon size={11} style={{ marginRight: 2 }} />}
          <ListItemText
            disableTypography
            primary={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, lineHeight: 1.2 }}>
                <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 500, lineHeight: 1.2 }}>{table.name}</Typography>
                {table.rows > 0 && <Chip label={`${table.rows.toLocaleString()} 行`} size="small" sx={{ fontSize: '0.5rem', height: 13 }} />}
              </Box>
            }
          />
        </ListItemButton>
      </Box>
    );
  };

  // ----- 渲染：表/视图分组节点 -----
  const renderTablesViewsGroup = (schemaKey: string, schemaName: string | undefined, baseIndent: number) => {
    const st = getSt(schemaKey);
    const tables = st.data?.filter(t => t.type !== 'VIEW') || [];
    const views = st.data?.filter(t => t.type === 'VIEW') || [];
    return (
      <>
        {/* 表 分组 */}
        <ListItemButton
          onClick={() => toggleTablesGroup(schemaKey, schemaName)}
          onContextMenu={(e) => openSchemaContextMenu(e, schemaName)}
          sx={{ py: 0, minHeight: 14, pl: `${baseIndent}px`, '&:hover': { bgcolor: 'action.hover' } }}
        >
          {st.tablesOpen
            ? <ExpandMoreIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />
            : <ChevronRightIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />}
          <TableIcon size={11} style={{ marginRight: 2 }} />
          <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 600, flex: 1 }}>
            表{st.data ? ` (${tables.length})` : ''}
          </Typography>
          {st.data && (
            <Tooltip title="刷新">
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); refreshMeta(schemaKey, schemaName); }} sx={{ p: 0.25 }}>
                <RefreshIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Tooltip>
          )}
        </ListItemButton>
        <Collapse in={st.tablesOpen} timeout="auto" unmountOnExit>
          {st.loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, pl: `${baseIndent + 20}px` }}>
              <CircularProgress size={10} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>加载中...</Typography>
            </Box>
          )}
          {st.error && (
            <Box sx={{ py: 0.5, pl: `${baseIndent + 20}px` }}>
              <Typography variant="caption" color="error" sx={{ fontSize: '0.75rem' }}>{st.error}</Typography>
            </Box>
          )}
          {st.data && tables.length === 0 && (
            <Box sx={{ py: 0.5, pl: `${baseIndent + 20}px` }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>无表</Typography>
            </Box>
          )}
          {st.data && tables.map(t => renderTableItem(schemaKey, t, baseIndent + 20, schemaName))}
        </Collapse>

        {/* 视图 分组 */}
        <ListItemButton
          onClick={() => toggleViewsGroup(schemaKey, schemaName)}
          onContextMenu={(e) => openSchemaContextMenu(e, schemaName)}
          sx={{ py: 0, minHeight: 14, pl: `${baseIndent}px`, '&:hover': { bgcolor: 'action.hover' } }}
        >
          {st.viewsOpen
            ? <ExpandMoreIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />
            : <ChevronRightIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />}
          <ViewIcon size={11} style={{ marginRight: 2 }} />
          <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 600, flex: 1 }}>
            视图{st.data ? ` (${views.length})` : ''}
          </Typography>
        </ListItemButton>
        <Collapse in={st.viewsOpen} timeout="auto" unmountOnExit>
          {st.loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, pl: `${baseIndent + 20}px` }}>
              <CircularProgress size={10} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>加载中...</Typography>
            </Box>
          )}
          {st.error && (
            <Box sx={{ py: 0.5, pl: `${baseIndent + 20}px` }}>
              <Typography variant="caption" color="error" sx={{ fontSize: '0.75rem' }}>{st.error}</Typography>
            </Box>
          )}
          {st.data && views.length === 0 && (
            <Box sx={{ py: 0.5, pl: `${baseIndent + 20}px` }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>无视图</Typography>
            </Box>
          )}
          {st.data && views.map(t => renderTableItem(schemaKey, t, baseIndent + 20, schemaName))}
        </Collapse>

        {/* 函数 分组 */}
        <ListItemButton
          onClick={() => toggleFunctionsGroup(schemaKey, schemaName)}
          sx={{ py: 0, minHeight: 14, pl: `${baseIndent}px`, '&:hover': { bgcolor: 'action.hover' } }}
        >
          {st.functionsOpen
            ? <ExpandMoreIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />
            : <ChevronRightIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />}
          <FunctionIcon size={11} style={{ marginRight: 2 }} />
          <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 600, flex: 1 }}>
            函数{st.functions.length > 0 ? ` (${st.functions.length})` : ''}
          </Typography>
        </ListItemButton>
        <Collapse in={st.functionsOpen} timeout="auto" unmountOnExit>
          {st.functionsLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, pl: `${baseIndent + 20}px` }}>
              <CircularProgress size={10} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>加载中...</Typography>
            </Box>
          )}
          {st.functions.length === 0 && !st.functionsLoading && (
            <Box sx={{ py: 0.5, pl: `${baseIndent + 20}px` }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>无函数</Typography>
            </Box>
          )}
          {st.functions.map(fn => (
            <ListItemButton
              key={fn.name}
              sx={{ py: 0, minHeight: 12, pl: `${baseIndent + 20}px` }}
            >
              <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>{fn.name}</Typography>
            </ListItemButton>
          ))}
        </Collapse>

        {/* 存储过程 分组 */}
        <ListItemButton
          onClick={() => toggleProceduresGroup(schemaKey, schemaName)}
          sx={{ py: 0, minHeight: 14, pl: `${baseIndent}px`, '&:hover': { bgcolor: 'action.hover' } }}
        >
          {st.proceduresOpen
            ? <ExpandMoreIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />
            : <ChevronRightIcon sx={{ fontSize: 12, color: 'text.secondary', mr: 0.15 }} />}
          <ProcedureIcon size={11} style={{ marginRight: 2 }} />
          <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 600, flex: 1 }}>
            存储过程{st.procedures.length > 0 ? ` (${st.procedures.length})` : ''}
          </Typography>
        </ListItemButton>
        <Collapse in={st.proceduresOpen} timeout="auto" unmountOnExit>
          {st.proceduresLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, pl: `${baseIndent + 20}px` }}>
              <CircularProgress size={10} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>加载中...</Typography>
            </Box>
          )}
          {st.procedures.length === 0 && !st.proceduresLoading && (
            <Box sx={{ py: 0.5, pl: `${baseIndent + 20}px` }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>无存储过程</Typography>
            </Box>
          )}
          {st.procedures.map(pr => (
            <ListItemButton
              key={pr.name}
              sx={{ py: 0, minHeight: 12, pl: `${baseIndent + 20}px` }}
            >
              <Typography variant="caption" sx={{ fontSize: '0.75rem' }}>{pr.name}</Typography>
            </ListItemButton>
          ))}
        </Collapse>
      </>
    );
  };

  // 基础缩进：使用外层传入的 baseIndentPx（数据库连接节点下一级的位置）
  const rootIndent = baseIndentPx;
  const schemaChildIndent = rootIndent + 14; // schema 展开后的表/视图

  return (
    <Box sx={{ pt: 0.25 }}>
      {/* 情况 A：连接已配置 schema —— 直接展示 表/视图 两个分组 */}
      {hasSchema && (
        <List dense disablePadding>
          {renderTablesViewsGroup(DEFAULT_KEY, connection.schema || undefined, rootIndent)}
        </List>
      )}

      {/* 情况 B：连接未配置 schema —— 展示 schema 列表 */}
      {!hasSchema && (
        <>
          {schemasLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, pl: `${rootIndent}px` }}>
              <CircularProgress size={10} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>加载 Schema...</Typography>
            </Box>
          )}
          {schemasError && (
            <Box sx={{ py: 0.5, pl: `${rootIndent}px` }}>
              <Typography variant="caption" color="error" sx={{ fontSize: '0.75rem' }}>{schemasError}</Typography>
              <IconButton size="small" onClick={() => { setSchemas(null); loadSchemas(); }} sx={{ p: 0, ml: 0.5 }}>
                <RefreshIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Box>
          )}
          {schemas && schemas.length === 0 && (
            <Box sx={{ py: 0.5, pl: `${rootIndent}px` }}>
              <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>无可用 Schema</Typography>
            </Box>
          )}
          {schemas && schemas.length > 0 && (
            <Box>
              {/* Schema 列表刷新按钮移到顶部 */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: `${rootIndent}px`, py: 0.25 }}>
                <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 600, color: 'text.secondary', lineHeight: 1.5 }}>
                  Schemas
                </Typography>
                <Tooltip title="刷新 Schema 列表">
                  <IconButton size="small" onClick={() => { setSchemas(null); setSchemaStates({}); loadSchemas(); }} sx={{ p: 0.25 }}>
                    <RefreshIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                </Tooltip>
              </Box>
              {schemas.map(schemaName => {
                const st = getSt(schemaName);
                return (
                  <Box key={schemaName}>
                    {/* Schema 行 - 纯 Box 无 MUI 组件开销 */}
                    <Box
                      onClick={() => toggleSchema(schemaName)}
                      onContextMenu={(e) => openSchemaContextMenu(e, schemaName)}
                      sx={{
                        display: 'flex', alignItems: 'center', cursor: 'pointer',
                        py: 0, m: 0, minHeight: 14,
                        pl: `${rootIndent}px`,
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      {st.expanded
                          ? <ExpandMoreIcon sx={{ fontSize: 11, color: 'text.secondary', mr: 0.35 }} />
                          : <ChevronRightIcon sx={{ fontSize: 11, color: 'text.secondary', mr: 0.35 }} />}
                        <SchemaIcon size={11} style={{ marginRight: 4 }} />
                        <Typography variant="caption" sx={{ fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.5, m: 0 }}>
                          {schemaName}
                        </Typography>
                    </Box>
                    <Collapse in={st.expanded} timeout="auto" unmountOnExit>
                      {renderTablesViewsGroup(schemaName, schemaName, schemaChildIndent)}
                    </Collapse>
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}

      <Snackbar open={snackbar} autoHideDuration={2000} onClose={() => setSnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" sx={{ width: '100%', fontSize: '0.8rem' }}>{snackbarMsg}</Alert>
      </Snackbar>

      {/* DDL 查看对话框 */}
      <Dialog
        open={ddlDialog.open}
        onClose={() => setDdlDialog(prev => ({ ...prev, open: false }))}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
          },
        }}
      >
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.85rem', fontWeight: 600, pb: 1 }}>
          {ddlDialog.tableName}
          {ddlDialog.ddlType !== 'create' && (
            <Box component="span" sx={{ color: '#0ea5e9', ml: 0.5 }}>
              - {DDL_TYPE_CONFIG.find(t => t.key === ddlDialog.ddlType)?.label || ddlDialog.ddlType.toUpperCase()}
            </Box>
          )}
        </DialogTitle>
        <DialogContent sx={{ pt: '8px !important' }}>
          {/* DDL 类型切换工具栏 */}
          {currentTableMeta.current && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
              {DDL_TYPE_CONFIG.map(type => (
                <Chip
                  key={type.key}
                  label={type.label}
                  size="small"
                  color={ddlDialog.ddlType === type.key ? 'primary' : 'default'}
                  variant={ddlDialog.ddlType === type.key ? 'filled' : 'outlined'}
                  onClick={() => handleGenerateDdl(type.key)}
                  sx={{
                    fontSize: '0.65rem',
                    cursor: 'pointer',
                    height: 22,
                    '& .MuiChip-label': { px: 0.75 },
                  }}
                />
              ))}
            </Box>
          )}
          {/* DDL 选项开关 */}
          {currentTableMeta.current && (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
              <Chip
                label="注释"
                size="small"
                color={ddlShowComments ? 'primary' : 'default'}
                variant={ddlShowComments ? 'filled' : 'outlined'}
                onClick={() => { setDdlShowComments(!ddlShowComments); setDdlOptTrigger(t => t + 1); }}
                sx={{ fontSize: '0.6rem', cursor: 'pointer', height: 20 }}
              />
              <Chip
                label="限定名"
                size="small"
                color={ddlShowFqn ? 'primary' : 'default'}
                variant={ddlShowFqn ? 'filled' : 'outlined'}
                onClick={() => { setDdlShowFqn(!ddlShowFqn); setDdlOptTrigger(t => t + 1); }}
                sx={{ fontSize: '0.6rem', cursor: 'pointer', height: 20 }}
              />
              <Chip
                label="权限"
                size="small"
                color={ddlShowGrants ? 'primary' : 'default'}
                variant={ddlShowGrants ? 'filled' : 'outlined'}
                onClick={() => { setDdlShowGrants(!ddlShowGrants); setDdlOptTrigger(t => t + 1); }}
                sx={{ fontSize: '0.6rem', cursor: 'pointer', height: 20 }}
              />
            </Box>
          )}
          {ddlDialog.loading && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
              <CircularProgress size={14} />
              <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>生成中...</Typography>
            </Box>
          )}
          {ddlDialog.error && (
            <Typography variant="caption" color="error" sx={{ fontSize: '0.7rem' }}>{ddlDialog.error}</Typography>
          )}
          {ddlDialog.ddl && (
            <Box
              component="pre"
              sx={{
                bgcolor: 'background.default',
                color: 'text.primary',
                p: 2,
                borderRadius: 1,
                fontSize: '0.72rem',
                lineHeight: 1.5,
                overflow: 'auto',
                maxHeight: '60vh',
                fontFamily: '"Cascadia Code", "Fira Code", "Consolas", monospace',
                border: '1px solid',
                borderColor: 'divider',
                m: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {ddlDialog.ddl}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button
            onClick={() => setDdlDialog(prev => ({ ...prev, open: false }))}
            size="small"
            sx={{
              color: 'text.secondary',
              fontSize: '0.7rem',
              textTransform: 'none',
            }}
          >
            关闭
          </Button>
          {ddlDialog.ddl && (
            <Button
              onClick={handleCopyDdl}
              variant="contained"
              size="small"
              sx={{
                bgcolor: '#0ea5e9',
                color: '#fff',
                fontSize: '0.7rem',
                textTransform: 'none',
                '&:hover': { bgcolor: '#0284c7' },
              }}
            >
              复制 SQL
            </Button>
          )}
        </DialogActions>
      </Dialog>

      {/* 右键菜单：表/视图操作（通用 ContextMenu 组件，紧凑深色主题） */}
      <ContextMenu
        anchorPosition={ctxMenu ? { top: ctxMenu.anchor.top, left: ctxMenu.anchor.left } : null}
        onClose={closeContextMenu}
        items={ctxMenu ? buildTableMenuItems(ctxMenu.table, ctxMenu.schemaName) : []}
      />

      {/* 右键菜单：Schema 级操作（创建表/视图/角色管理） */}
      <ContextMenu
        anchorPosition={schemaCtxMenu ? { top: schemaCtxMenu.anchor.top, left: schemaCtxMenu.anchor.left } : null}
        onClose={closeSchemaContextMenu}
        items={schemaCtxMenu ? buildSchemaMenuItems(schemaCtxMenu.schemaName) : []}
      />

      {/* 角色管理对话框 */}
      <ExportWizard />
      <RoleManager
        open={roleManagerOpen}
        connectionId={connection.id}
        onClose={() => setRoleManagerOpen(false)}
        schemaName={roleManagerSchema}
      />

      {/* 创建表对话框 */}
      <CreateTableDialog
        open={createTableOpen}
        connectionId={connection.id}
        onClose={() => setCreateTableOpen(false)}
        schemaName={createTableSchema}
        onSuccess={() => {
          // 刷新元数据
          if (hasSchema) {
            refreshMeta(DEFAULT_KEY);
          } else if (createTableSchema) {
            refreshMeta(createTableSchema, createTableSchema);
          }
        }}
      />

      {/* 创建/编辑视图对话框 */}
      <CreateViewDialog
        open={viewDialog.open}
        connectionId={connection.id}
        onClose={() => setViewDialog({ open: false })}
        schemaName={viewDialog.schemaName}
        editView={viewDialog.editView}
        onSuccess={() => {
          if (hasSchema) {
            refreshMeta(DEFAULT_KEY);
          } else if (viewDialog.schemaName) {
            refreshMeta(viewDialog.schemaName!, viewDialog.schemaName);
          }
        }}
      />

      {/* 编辑表对话框 */}
      <EditTableDialog
        open={editTableDialog.open}
        connectionId={connection.id}
        tableName={editTableDialog.tableName}
        schemaName={editTableDialog.schemaName}
        existingColumns={editTableDialog.columns}
        onClose={() => setEditTableDialog(prev => ({ ...prev, open: false }))}
        onSuccess={() => {
          if (hasSchema) {
            refreshMeta(DEFAULT_KEY);
          } else if (editTableDialog.schemaName) {
            refreshMeta(editTableDialog.schemaName!, editTableDialog.schemaName);
          }
          setEditTableDialog(prev => ({ ...prev, open: false }));
        }}
      />

      {/* 删除表/视图确认对话框 */}
      <ConfirmDropDialog
        open={!!dropConfirm && dropConfirm.open}
        title={dropConfirm?.type === 'VIEW' ? '确认删除视图' : '确认删除表'}
        message={
          dropConfirm
            ? `确定要删除 ${dropConfirm.type === 'VIEW' ? '视图' : '表'} "${dropConfirm.name}" 吗？\n此操作不可撤销，表/视图和数据将永久丢失。`
            : ''
        }
        confirmLabel={dropConfirm?.type === 'VIEW' ? '删除视图' : '删除表'}
        onCancel={() => setDropConfirm(null)}
        onConfirm={async () => {
          if (!dropConfirm) return;
          try {
            if (dropConfirm.type === 'VIEW') {
              await deleteView(connection.id, dropConfirm.name, dropConfirm.schemaName);
            } else {
              await deleteTable(connection.id, dropConfirm.name, dropConfirm.schemaName);
            }
            setSnackbarMsg(`${dropConfirm.type === 'VIEW' ? '视图' : '表'} ${dropConfirm.name} 已删除`);
            setSnackbar(true);
            setDropConfirm(null);
            // 刷新元数据
            if (hasSchema) {
              refreshMeta(DEFAULT_KEY);
            } else if (dropConfirm.schemaName) {
              refreshMeta(dropConfirm.schemaName, dropConfirm.schemaName);
            }
          } catch (err: any) {
            setSnackbarMsg(err.message || '删除失败');
            setSnackbar(true);
            setDropConfirm(null);
          }
        }}
      />

      {/* 字段查看对话框 */}
      <FieldViewerDialog
        open={fieldViewer.open}
        connectionId={connection.id}
        tableName={fieldViewer.tableName}
        schemaName={fieldViewer.schemaName}
        columns={fieldViewer.columns}
        onClose={() => setFieldViewer(prev => ({ ...prev, open: false }))}
        onSuccess={() => {
          setFieldViewer(prev => ({ ...prev, open: false }));
          if (hasSchema) {
            refreshMeta(DEFAULT_KEY);
          } else if (fieldViewer.schemaName) {
            refreshMeta(fieldViewer.schemaName, fieldViewer.schemaName);
          }
        }}
      />
    </Box>
  );
};

export default MetadataBrowser;
