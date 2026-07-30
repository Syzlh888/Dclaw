/**
 * 步骤 2：选择目标（文件 5 种格式 或 数据库）
 */
import React, { useState, useMemo } from 'react';
import {
  Box,
  Typography,
  RadioGroup,
  FormControlLabel,
  Radio,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Checkbox,
  FormControlLabel as CheckboxLabel,
  Button,
  Alert,
  Autocomplete,
  Paper,
} from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import StorageIcon from '@mui/icons-material/Storage';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import IconButton from '@mui/material/IconButton';
import { useExportStore } from '../../stores/exportStore';
import { useConnectionStore } from '../../stores/connectionStore';
import { useGroupStore } from '../../stores/groupStore';
import { useTreeStore } from '../../stores/treeStore';
import { apiFetch } from '../../services/apiClient';
import {
  getFileExtension,
  suggestFileName,
  type FileEncoding,
  type FileFormat,
  type TargetType,
} from '../../services/exportService';
import { FieldMappingDialog, type TableRef } from './FieldMappingDialog';
import type { FieldMapping } from '../../stores/exportStore';

const FORMATS: FileFormat[] = ['csv', 'tsv', 'sql', 'json', 'xlsx'];
const ENCODINGS: FileEncoding[] = ['utf-8', 'gbk', 'gb18030'];

export const ExportStepTarget: React.FC = () => {
  const sourceType = useExportStore((s) => s.sourceType);
  const selectedTables = useExportStore((s) => s.selectedTables);
  const sql = useExportStore((s) => s.sql);
  const target = useExportStore((s) => s.target);
  const setTarget = useExportStore((s) => s.setTarget);

  // 取第一个表作为数据库目标默认值
  const firstTable = selectedTables[0];

  const connectionsMap = useConnectionStore((s) => s.connections);
  const connections = Object.values(connectionsMap);
  // 读取左侧菜单的完整层级架构
  const treeNodes = useTreeStore((s) => s.nodes);
  const treeRootIds = useTreeStore((s) => s.rootNodeIds);

  // 取分组信息（用左侧菜单的 groupStore，不是 IP 段）
  const groups = useGroupStore((s) => s.groups);

  // 连接选项：复用左侧树的完整层级架构
  // 数据结构：[{ id: 'path::connId', name, connId, _treePath: ['platform', 'district', 'hospital'] }]
  // _treePath 用于树形展示
  type TreeConn = {
    id: string;
    name: string;
    host: string;
    port: number;
    database: string;
    schema: string;
    connId: string;
    _treePath: string[]; // 层级路径 ['平台', '预库类型', '县区', '医院']
    _groupKey: string;   // 用于树形分组（同层级同父节点的归一组）
  };
  const connectionOptions = useMemo<TreeConn[]>(() => {
    if (!treeNodes || Object.keys(treeNodes).length === 0) {
      // 树还没加载，兜底用 groupStore
      return connections
        .map((c) => {
          const belongsTo = groups.find(g => g.dbConnectionIds.includes(c.id));
          return {
            id: c.id,
            name: c.name || '',
            host: c.host || '',
            port: c.port || 0,
            database: c.database || '',
            schema: c.schema || '',
            connId: c.id,
            _treePath: [belongsTo ? belongsTo.name : '未分组'],
            _groupKey: belongsTo ? belongsTo.name : '未分组',
          };
        });
    }

    // 递归遍历树节点，收集所有 hospital 节点（叶子，对应 connectionId）
    const result: TreeConn[] = [];
    const walk = (nodeId: string, path: string[]) => {
      const node = treeNodes[nodeId];
      if (!node) return;
      const newPath = [...path, node.name];
      // 只收集叶子节点（医院层，对应具体 connection）
      if (node.dbConnectionId) {
        const conn = connectionsMap[node.dbConnectionId];
        if (conn) {
          result.push({
            id: `${nodeId}::${conn.id}`,
            name: conn.name,
            host: conn.host,
            port: conn.port,
            database: conn.database || '',
            schema: conn.schema || '',
            connId: conn.id,
            _treePath: newPath,  // 包含从根到当前叶子节点的完整路径
            _groupKey: nodeId,
          });
        }
        // 叶子节点不再递归
        return;
      }
      // 中间节点：递归子节点
      if (node.childrenIds) {
        node.childrenIds.forEach((cid: string) => walk(cid, newPath));
      }
    };
    treeRootIds.forEach(rid => walk(rid, []));
    return result;
  }, [connections, connectionsMap, groups, treeNodes, treeRootIds]);

  // 树形连接选择器状态
  const [connDropdownOpen, setConnDropdownOpen] = useState(false);
  const [connSearchText, setConnSearchText] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(connectionOptions.map(c => c._groupKey)));

  // 连接变更时加载 schemas
  const [targetSchemas, setTargetSchemas] = useState<string[]>([]);
  const [targetTables, setTargetTables] = useState<string[]>([]);
  const [schemasLoading, setSchemasLoading] = useState(false);
  const dbTarget = target?.type === 'database' ? target : null;
  const targetConn = dbTarget?.connectionId ? connectionsMap[dbTarget.connectionId] : null;
  const targetFixedSchema = targetConn?.schema || '';
  const hasFixedSchema = !!targetFixedSchema.trim();

  // 目标连接变更时拉取 schemas：连接已配置 schema 则锁定显示，否则调后端 API 让用户选。
  React.useEffect(() => {
    const connectionId = dbTarget?.connectionId;
    if (!connectionId) {
      setTargetSchemas([]);
      setTargetTables([]);
      return;
    }

    // 连接已配置固定 schema：锁定显示，不调 API
    if (hasFixedSchema) {
      setTargetSchemas([targetFixedSchema]);
      setTargetTables([]);
      setSchemasLoading(false);
      return;
    }

    let cancelled = false;
    setTargetSchemas([]);
    setTargetTables([]);
    setSchemasLoading(true);

    (async () => {
      try {
        const res = await apiFetch(`/api/connections/${connectionId}/schemas`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `加载 Schema 失败（HTTP ${res.status}）`);
        }
        if (!cancelled) setTargetSchemas(data.schemas || []);
      } catch (err) {
        if (!cancelled) console.error('[fetchSchemas] failed', err);
      } finally {
        if (!cancelled) setSchemasLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [dbTarget?.connectionId, hasFixedSchema, targetFixedSchema]);

  // 目标连接或 Schema 变更时加载现有表，供 Autocomplete 选择。
  React.useEffect(() => {
    const connectionId = dbTarget?.connectionId;
    const schemaName = dbTarget?.schemaName || targetFixedSchema || '';
    if (!connectionId) {
      setTargetTables([]);
      return;
    }

    let cancelled = false;
    setTargetTables([]);

    (async () => {
      try {
        const query = schemaName ? `?schema=${encodeURIComponent(schemaName)}` : '';
        const res = await apiFetch(`/api/connections/${connectionId}/tables${query}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `加载目标表失败（HTTP ${res.status}）`);
        }
        if (!cancelled) {
          setTargetTables((data.tables || []).map((table: any) => table.name));
        }
      } catch (err) {
        if (!cancelled) console.error('[fetchTargetTables] failed', err);
      }
    })();

    return () => { cancelled = true; };
  }, [dbTarget?.connectionId, dbTarget?.schemaName, targetFixedSchema]);

  // 字段映射对话框状态
  const [mappingDialog, setMappingDialog] = useState<{
    open: boolean;
    sourceTable: TableRef;
    targetTable: TableRef;
    key: string;
  } | null>(null);
  const setColumnMappings = useExportStore((s) => s.setColumnMappings);
  const getColumnMappings = useExportStore((s) => s.getColumnMappings);

  /** 打开字段映射对话框 */
  const openMappingDialog = (srcTable: any, idx: number) => {
    if (!dbTarget) return;
    const targetTableName =
      target?.type === 'database' ? (target.tableNameArr?.[idx] || target.tableName) : '';
    const sourceTableRef: TableRef = {
      connectionId: srcTable.connectionId,
      tableName: srcTable.tableName,
      schemaName: srcTable.schemaName,
    };
    const targetTableRef: TableRef = {
      connectionId: dbTarget.connectionId,
      tableName: targetTableName,
      schemaName: dbTarget.schemaName || targetFixedSchema,
    };
    setMappingDialog({
      open: true,
      sourceTable: sourceTableRef,
      targetTable: targetTableRef,
      key: `${srcTable.connectionId}::${srcTable.tableName}::${dbTarget.connectionId}::${targetTableName}`,
    });
  };

  // 默认 file target
  const ensureFileTarget = () => {
    if (target?.type === 'file') return target;
    const fmt = 'csv' as FileFormat;
    const baseName = suggestFileName(
      sourceType === 'sql'
        ? { type: 'sql', sql }
        : { type: 'table', tableName: firstTable?.tableName, schemaName: firstTable?.schemaName, connectionId: firstTable?.connectionId },
      { type: 'file', format: fmt, encoding: 'utf-8' } as any
    );
    return {
      type: 'file' as const,
      format: fmt,
      encoding: 'utf-8' as FileEncoding,
      filename: baseName + (selectedTables.length > 1 ? `_and_${selectedTables.length - 1}_more` : ''),
      includeHeader: true,
      sqlIncludeDrop: false,
      compress: false,
    };
  };

  // 默认 db target
  const ensureDbTarget = () => {
    if (target?.type === 'database') return target;
    const fallbackConnId =
      firstTable?.connectionId || connections[0]?.id || '';
    return {
      type: 'database' as const,
      connectionId: fallbackConnId,
      tableName: (firstTable?.tableName || 'export_target') + (selectedTables.length > 1 ? '_multi' : ''),
      schemaName: firstTable?.schemaName,
      createIfMissing: true,
      writeStrategy: 'append' as const,
    };
  };

  const switchTargetType = (type: TargetType) => {
    if (type === 'file') setTarget(ensureFileTarget());
    else setTarget(ensureDbTarget());
  };

  const updateFile = (patch: Partial<any>) => {
    const cur = ensureFileTarget();
    setTarget({ ...cur, ...patch });
  };

  const updateDb = (patch: Partial<any>) => {
    // 使用当前已有的 database target，而不是每次创建新的
    const cur = target?.type === 'database' ? target : ensureDbTarget();
    setTarget({ ...cur, ...patch });
  };

  return (
    <Box sx={{ pt: 1 }}>
      <Typography variant="subtitle2" sx={{ mb: 1, color: '#BBBBBB' }}>
        选择导出目标
      </Typography>

      <RadioGroup
        row
        value={target?.type || 'file'}
        onChange={(e) => switchTargetType(e.target.value as TargetType)}
        sx={{ mb: 2 }}
      >
        <FormControlLabel
          value="file"
          control={<Radio size="small" sx={{ color: '#5A5A5A' }} />}
          label="文件"
          sx={{ color: '#BBBBBB' }}
        />
        <FormControlLabel
          value="database"
          control={<Radio size="small" sx={{ color: '#5A5A5A' }} />}
          label="数据库"
          sx={{ color: '#BBBBBB' }}
        />
      </RadioGroup>

      {(target?.type === 'file' || !target) && (
        <Box>
          {/* 格式 */}
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel sx={{ color: '#BBBBBB' }}>格式</InputLabel>
            <Select
              label="格式"
              value={(target?.type === 'file' ? target.format : 'csv') as string}
              onChange={(e) => updateFile({ format: e.target.value as FileFormat })}
              sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
            >
              {FORMATS.map((f) => (
                <MenuItem key={f} value={f}>
                  {f.toUpperCase()}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* 编码 + 分隔符 */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel sx={{ color: '#BBBBBB' }}>编码</InputLabel>
              <Select
                label="编码"
                value={
                  (target?.type === 'file' ? target.encoding : 'utf-8') as string
                }
                onChange={(e) =>
                  updateFile({ encoding: e.target.value as FileEncoding })
                }
                sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
              >
                {ENCODINGS.map((e) => (
                  <MenuItem key={e} value={e}>
                    {e}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {target?.type === 'file' &&
              (target.format === 'csv' || target.format === 'tsv') && (
                <TextField
                  size="small"
                  label="字段分隔符"
                  value={target.delimiter || (target.format === 'tsv' ? '\t' : ',')}
                  onChange={(e) => updateFile({ delimiter: e.target.value })}
                  sx={{ width: 120, bgcolor: '#3C3F41' }}
                  InputLabelProps={{ sx: { color: '#BBBBBB' } }}
                />
              )}
          </Box>

          {/* 文件名：导出完成时浏览器自动下载 */}
          <TextField
            fullWidth
            size="small"
            label="文件名"
            value={(() => {
              if (target?.type === 'file' && target.filename) return target.filename;
              // 默认文件名
              const fmt = (target?.type === 'file' ? target.format : 'csv') as FileFormat;
              return suggestFileName(
                sourceType === 'sql'
                  ? { type: 'sql', sql }
                  : { type: 'table', tableName: firstTable?.tableName, schemaName: firstTable?.schemaName, connectionId: firstTable?.connectionId },
                { type: 'file', format: fmt, encoding: 'utf-8' } as any
              ) + (selectedTables.length > 1 ? `_and_${selectedTables.length - 1}_more` : '');
            })()}
            onChange={(e) => updateFile({ filename: e.target.value })}
            placeholder="可留空使用默认文件名"
            helperText={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, color: '#888' }}>
                <CloudDownloadIcon sx={{ fontSize: 13 }} />
                完成后文件将自动下载到浏览器默认下载目录
              </Box>
            }
            InputProps={{
              sx: { bgcolor: '#3C3F41', color: '#FFFFFF' },
            }}
            InputLabelProps={{ sx: { color: '#BBBBBB' } }}
            FormHelperTextProps={{ sx: { color: '#888', mt: 0.5 } }}
            sx={{ mb: 2 }}
          />

          {/* 选项 */}
          <Box>
            {(target?.type === 'file' &&
              (target.format === 'csv' ||
                target.format === 'tsv' ||
                target.format === 'xlsx' ||
                target.format === 'sql' ||
                target.format === 'json')) && (
              <CheckboxLabel
                control={
                  <Checkbox
                    size="small"
                    checked={(target.includeHeader ?? true) as boolean}
                    onChange={(e) =>
                      updateFile({ includeHeader: e.target.checked })
                    }
                    sx={{ color: '#5A5A5A' }}
                  />
                }
                label="包含列标题行"
                sx={{ color: '#BBBBBB' }}
              />
            )}
            {target?.type === 'file' && target.format === 'sql' && (
              <CheckboxLabel
                control={
                  <Checkbox
                    size="small"
                    checked={(target.sqlIncludeDrop ?? false) as boolean}
                    onChange={(e) =>
                      updateFile({ sqlIncludeDrop: e.target.checked })
                    }
                    sx={{ color: '#5A5A5A' }}
                  />
                }
                label="包含 DROP TABLE 语句"
                sx={{ color: '#BBBBBB' }}
              />
            )}
          </Box>
        </Box>
      )}

      {target?.type === 'database' && (
        <Box>
          {/* 目标连接 + Schema 一行 */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
            {/* 目标连接：搜索 + 分组 */}
            {/* 树形连接选择器：左侧菜单样式（按 IP 段分组 + 可折叠） */}
            <Box sx={{ flex: 1, position: 'relative' }}>
              <TextField
                size="small"
                fullWidth
                label="目标数据库连接"
                value={
                  (() => {
                    const c = connectionOptions.find((co) => co.connId === dbTarget?.connectionId);
                    return c ? `${c.name} (${c.host}:${c.port})` : '';
                  })()
                }
                placeholder="点击选择..."
                onClick={() => setConnDropdownOpen(!connDropdownOpen)}
                sx={{ bgcolor: '#3C3F41', cursor: 'pointer' }}
                InputLabelProps={{ sx: { color: '#BBBBBB' } }}
                InputProps={{
                  readOnly: true,
                  endAdornment: (
                    <ExpandMoreIcon
                      fontSize="small"
                      sx={{ color: '#888', cursor: 'pointer', transform: connDropdownOpen ? 'rotate(180deg)' : 'none' }}
                    />
                  ),
                }}
              />
              {connDropdownOpen && (
                <Paper
                  sx={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    right: 0,
                    mt: 0.5,
                    maxHeight: 320,
                    overflow: 'auto',
                    bgcolor: '#3C3F41',
                    zIndex: 1300,
                    border: '1px solid #5A5A5A',
                  }}
                >
                  {/* 搜索框：带搜索图标 + 清空按钮 */}
                  <Box sx={{ p: 1, borderBottom: '1px solid #3A3A3A', bgcolor: '#2F2F2F' }}>
                    <TextField
                      size="small"
                      fullWidth
                      placeholder="搜索连接名称或 IP..."
                      value={connSearchText}
                      onChange={(e) => setConnSearchText(e.target.value)}
                      autoFocus
                      InputProps={{
                        startAdornment: <SearchIcon fontSize="small" sx={{ color: '#888', mr: 0.5 }} />,
                        endAdornment: connSearchText ? (
                          <IconButton size="small" onClick={() => setConnSearchText('')} sx={{ p: 0.25 }}>
                            <CloseIcon sx={{ fontSize: 14, color: '#888' }} />
                          </IconButton>
                        ) : undefined,
                      }}
                      sx={{
                        bgcolor: '#252525',
                        '& .MuiOutlinedInput-root': {
                          fontSize: 13,
                          '& fieldset': { borderColor: '#3A3A3A' },
                          '&:hover fieldset': { borderColor: '#5A5A5A' },
                        },
                        '& input': { padding: '6px 4px', color: '#DDD' },
                        '& input::placeholder': { color: '#777', opacity: 1 },
                      }}
                    />
                  </Box>
                  {/* 完全复用左侧菜单的树形渲染（展开/折叠状态独立） */}
                  {(() => {
                    if (!treeNodes || Object.keys(treeNodes).length === 0) {
                      return (
                        <Typography sx={{ color: '#888', p: 2, fontSize: 12, textAlign: 'center' }}>
                          树数据加载中…
                        </Typography>
                      );
                    }
                    // 搜索过滤
                    const matchesSearch = (nodeId: string): boolean => {
                      if (!connSearchText) return true;
                      const s = connSearchText.toLowerCase();
                      const node = treeNodes[nodeId];
                      if (!node) return false;
                      if (node.dbConnectionId) {
                        const conn = connectionsMap[node.dbConnectionId];
                        if (conn && (conn.name.toLowerCase().includes(s) || (conn.host || '').includes(s))) return true;
                      }
                      if (node.name.toLowerCase().includes(s)) return true;
                      if (node.childrenIds) return node.childrenIds.some(matchesSearch);
                      return false;
                    };

                    // 递归渲染节点（与左侧菜单完全一致）
                    const renderTree = (nodeId: string, depth: number): React.ReactNode => {
                      if (!matchesSearch(nodeId)) return null;
                      const node = treeNodes[nodeId];
                      if (!node) return null;
                      const isExpanded = expandedGroups.has(nodeId);
                      const hasChildren = node.childrenIds && node.childrenIds.length > 0;

                      // 叶子：医院（具体 connection）
                      if (node.dbConnectionId) {
                        const conn = connectionsMap[node.dbConnectionId];
                        if (!conn) return null;
                        const selected = dbTarget?.connectionId === conn.id;
                        return (
                          <Box
                            key={nodeId}
                            onClick={() => {
                              // 切换目标连接时重置 tableName/tableNameArr 为源表名
                              const defaultArr = selectedTables.map((st) => st.tableName);
                              updateDb({
                                connectionId: conn.id,
                                schemaName: conn.schema || '',
                                tableName: defaultArr[0] || '',
                                tableNameArr: defaultArr,
                              });
                              setConnDropdownOpen(false);
                            }}
                            sx={{
                              pl: 1.5 + depth * 1.2,
                              pr: 2,
                              py: 0.6,
                              cursor: 'pointer',
                              bgcolor: selected ? '#1565C0' : 'transparent',
                              color: selected ? '#FFFFFF' : '#E0E0E0',
                              fontSize: 12.5,
                              borderLeft: selected ? '3px solid #64B5F6' : '3px solid transparent',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              transition: 'background-color 0.15s',
                              '&:hover': { bgcolor: selected ? '#1565C0' : '#454545' },
                            }}
                          >
                            <StorageIcon sx={{ fontSize: 12, color: selected ? '#FFFFFF' : '#66BB6A' }} />
                            <span style={{ flex: 1 }}>{conn.name}</span>
                            <span style={{ fontSize: 11, color: selected ? '#BBDEFB' : '#888' }}>
                              {conn.host}:{conn.port}
                            </span>
                          </Box>
                        );
                      }
                      // 中间节点：分组
                      return (
                        <Box key={nodeId}>
                          <Box
                            onClick={() => {
                              if (!hasChildren) return;
                              const ns = new Set(expandedGroups);
                              ns.has(nodeId) ? ns.delete(nodeId) : ns.add(nodeId);
                              setExpandedGroups(ns);
                            }}
                            sx={{
                              bgcolor: depth === 0 ? '#2A2A2A' : '#333333',
                              color: depth === 0 ? '#FFFFFF' : '#C8C8C8',
                              fontSize: depth === 0 ? 12.5 : 12,
                              fontWeight: depth === 0 ? 700 : 500,
                              lineHeight: '26px',
                              pl: 0.75 + depth * 1.2,
                              pr: 1,
                              cursor: hasChildren ? 'pointer' : 'default',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              borderTop: depth === 0 ? '1px solid #1F1F1F' : 'none',
                              borderBottom: isExpanded ? '1px solid #252525' : 'none',
                              transition: 'background-color 0.15s',
                              '&:hover': hasChildren ? { bgcolor: '#3A3A3A' } : {},
                            }}
                          >
                            {hasChildren ? (
                              <ChevronRightIcon
                                sx={{
                                  fontSize: 14,
                                  color: '#999',
                                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                  transition: 'transform 0.2s',
                                }}
                              />
                            ) : (
                              <FiberManualRecordIcon sx={{ fontSize: 5, color: '#555', ml: 0.4, mr: 0.4 }} />
                            )}
                            {node.name}
                          </Box>
                          {isExpanded && hasChildren && (
                            <Box>
                              {node.childrenIds.map((cid: string) => renderTree(cid, depth + 1))}
                            </Box>
                          )}
                        </Box>
                      );
                    };
                    return treeRootIds.map((rid: string) => renderTree(rid, 0));
                  })()}
                </Paper>
              )}
            </Box>

            {/* Schema：始终显示下拉，没加载完就显示加载提示 */}
            <FormControl size="small" sx={{ width: 160 }}>
              <InputLabel sx={{ color: '#BBBBBB' }}>Schema</InputLabel>
              <Select
                label="Schema"
                value={(dbTarget?.schemaName || targetFixedSchema || '') as string}
                onChange={(e) => updateDb({ schemaName: e.target.value })}
                sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
                disabled={schemasLoading}
              >
                {targetSchemas.length === 0 && (
                  <MenuItem value="" disabled>
                    {schemasLoading ? '加载中…' : '暂无可用 Schema'}
                  </MenuItem>
                )}
                {targetSchemas.map((s) => (
                  <MenuItem key={s} value={s}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          {/* 目标表名：列表形式 + Autocomplete（从数据库读表） */}
          <Typography variant="caption" sx={{ color: '#BBBBBB', display: 'block', mb: 0.5 }}>
            目标表名（{selectedTables.length} 张源表 · {targetTables.length} 张可选）
          </Typography>
          <Box sx={{ maxHeight: 200, overflow: 'auto', mb: 2 }}>
            {selectedTables.length === 0 ? (
              <Typography sx={{ color: '#888', fontSize: 12, textAlign: 'center', py: 2 }}>
                请先选择源表
              </Typography>
            ) : selectedTables.length === 1 ? (
              // 单表：直接显示一个 Autocomplete
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Autocomplete
                  freeSolo
                  size="small"
                  sx={{ flex: 1, minWidth: 120 }}
                  options={targetTables}
                  value={target.tableName as string || null}
                  onChange={(_, val) => updateDb({ tableName: val || '' })}
                  onInputChange={(_, val) => updateDb({ tableName: val || '' })}
                  ListboxProps={{
                    sx: {
                      fontSize: 12,
                      padding: 0,
                      '& li': { fontSize: 12, padding: '4px 8px', minHeight: 24 },
                    },
                  }}
                  slotProps={{
                    paper: { sx: { bgcolor: '#3C3F41', color: '#FFFFFF' } },
                  }}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      size="small"
                      placeholder={selectedTables[0]?.tableName}
                      sx={{
                        bgcolor: '#3C3F41',
                        '& .MuiOutlinedInput-input': { fontSize: 12, padding: '6px 8px' },
                      }}
                      error={!target.tableName}
                      helperText={!target.tableName ? '目标表名必填' : ''}
                    />
                  )}
                />
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AccountTreeIcon />}
                  onClick={() => openMappingDialog(selectedTables[0], 0)}
                  sx={{
                    fontSize: 11,
                    minWidth: 92,
                    px: 1.2,
                    py: 0.4,
                    flexShrink: 0,
                    color: '#42A5F5',
                    borderColor: '#42A5F5',
                    whiteSpace: 'nowrap',
                    '&:hover': {
                      borderColor: '#90CAF9',
                      bgcolor: 'rgba(66, 165, 245, 0.1)',
                    },
                  }}
                >
                  字段映射
                </Button>
              </Box>
            ) : (
              // 多表：列表形式（源表 → 目标表），无边框
              selectedTables.map((t, idx) => {
                const val = target.tableNameArr?.[idx] || t.tableName;
                return (
                  <Box key={idx} sx={{ display: 'flex', alignItems: 'center', mb: 0.5, gap: 1 }}>
                    <Typography sx={{ color: '#BBB', fontSize: 11, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'right', pr: 0.5 }}>
                      {t.tableName}
                    </Typography>
                    <ArrowForwardIcon sx={{ fontSize: 14, color: '#90CAF9' }} />
                    <Autocomplete
                      freeSolo
                      size="small"
                      sx={{ flex: 1, minWidth: 0 }}
                      options={targetTables}
                      value={val}
                      onChange={(_, newVal) => {
                        const arr = [...(target.tableNameArr || selectedTables.map((st) => st.tableName))];
                        arr[idx] = newVal || '';
                        updateDb({ tableNameArr: arr, tableName: arr[0] });
                      }}
                      onInputChange={(_, newVal) => {
                        const arr = [...(target.tableNameArr || selectedTables.map((st) => st.tableName))];
                        arr[idx] = newVal || '';
                        updateDb({ tableNameArr: arr, tableName: arr[0] });
                      }}
                      ListboxProps={{
                        sx: {
                          fontSize: 12,
                          padding: 0,
                          '& li': { fontSize: 12, padding: '4px 8px', minHeight: 24 },
                        },
                      }}
                      slotProps={{
                        paper: { sx: { bgcolor: '#3C3F41', color: '#FFFFFF' } },
                      }}
                      renderInput={(params) => (
                      <TextField
                        {...params}
                        size="small"
                        placeholder={t.tableName}
                        sx={{
                          bgcolor: '#3C3F41',
                          '& fieldset': { border: 'none' },
                          '& .MuiOutlinedInput-input': { fontSize: 12, padding: '6px 8px' },
                        }}
                      />
                    )}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<AccountTreeIcon />}
                    onClick={() => openMappingDialog(t, idx)}
                    sx={{
                      fontSize: 11,
                      minWidth: 92,
                      px: 1.2,
                      py: 0.4,
                      flexShrink: 0,
                      color: '#42A5F5',
                      borderColor: '#42A5F5',
                      whiteSpace: 'nowrap',
                      '&:hover': {
                        borderColor: '#90CAF9',
                        bgcolor: 'rgba(66, 165, 245, 0.1)',
                      },
                    }}
                  >
                    字段映射
                  </Button>
                </Box>
              );
            })
          )}
          </Box>

          <CheckboxLabel
            control={
              <Checkbox
                size="small"
                checked={(target.createIfMissing ?? true) as boolean}
                onChange={(e) => updateDb({ createIfMissing: e.target.checked })}
                sx={{ color: '#5A5A5A' }}
              />
            }
            label="不存在则自动建表"
            sx={{ color: '#BBBBBB', display: 'block', mb: 1 }}
          />

          <FormControl size="small" sx={{ mb: 2, minWidth: 200 }}>
            <InputLabel sx={{ color: '#BBBBBB' }}>写入策略</InputLabel>
            <Select
              label="写入策略"
              value={target.writeStrategy as string}
              onChange={(e) => updateDb({ writeStrategy: e.target.value })}
              sx={{ bgcolor: '#3C3F41', color: '#FFFFFF' }}
            >
              <MenuItem value="append">INSERT (追加)</MenuItem>
              <MenuItem value="truncate">TRUNCATE + INSERT</MenuItem>
              <MenuItem value="drop_create">DROP + CREATE</MenuItem>
            </Select>
          </FormControl>

          {connections.length === 0 && (
            <Alert severity="warning">暂无可用数据库连接</Alert>
          )}
        </Box>
      )}

      {/* 字段映射对话框（DBeaver 风格） */}
      {mappingDialog && (
        <FieldMappingDialog
          open={mappingDialog.open}
          sourceTable={mappingDialog.sourceTable}
          targetTable={mappingDialog.targetTable}
          initialMappings={getColumnMappings(mappingDialog.key)}
          onClose={() => setMappingDialog(null)}
          onSave={(mappings) => {
            setColumnMappings(mappingDialog.key, mappings);
            setMappingDialog(null);
          }}
        />
      )}
    </Box>
  );
};
