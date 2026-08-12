import React, { useEffect, useMemo, useState } from 'react';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, FormControlLabel, IconButton, InputLabel, MenuItem,
  Select, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import RefreshIcon from '@mui/icons-material/Refresh';
import { apiFetch } from '../../services/apiClient';
import {
  ApiEndpoint, ApiParam, createEndpoint, updateEndpoint,
  listConnectionTables, listConnectionColumns,
} from '../../services/apiService';

interface ConnectionOption {
  id: string;
  name: string;
  driver: string;
  host?: string;
  port?: number | string;
  database_name?: string;
  schema_name?: string;
}

interface Props {
  open: boolean;
  endpoint: ApiEndpoint | null;  // null = 新建
  onClose: () => void;
  onSaved: () => void;
}

const PARAM_TYPES: ApiParam['type'][] = ['string', 'number', 'boolean', 'date'];

const EndpointDialog: React.FC<Props> = ({ open, endpoint, onClose, onSaved }) => {
  const isEdit = !!endpoint;

  // ----- 表单状态 -----
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'sql' | 'table'>('sql');
  const [connectionId, setConnectionId] = useState('');
  const [schemaName, setSchemaName] = useState('');
  const [tableName, setTableName] = useState('');
  const [sqlText, setSqlText] = useState('');
  const [params, setParams] = useState<ApiParam[]>([]);
  const [pageSizeMax, setPageSizeMax] = useState<number>(100);
  const [maskFields, setMaskFields] = useState<string[]>([]);
  const [status, setStatus] = useState<'active' | 'disabled'>('active');

  // ----- 数据 -----
  const [connections, setConnections] = useState<ConnectionOption[]>([]);
  const [tables, setTables] = useState<string[]>([]);
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载连接列表
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const r = await apiFetch('/api/connections');
        const j = await r.json();
        const opts: ConnectionOption[] = (j.connections || []).map((c: any) => ({
          id: c.id,
          name: c.name,
          driver: c.driver,
          host: c.host,
          port: c.port,
          database_name: c.database_name,
          schema_name: c.schema_name,
        }));
        setConnections(opts);
      } catch (e) {
        setError(`加载连接失败：${e instanceof Error ? e.message : '未知错误'}`);
      }
    })();
  }, [open]);

  // 进入编辑态 / 新建态时初始化
  useEffect(() => {
    if (!open) return;
    if (endpoint) {
      setName(endpoint.name);
      setDescription(endpoint.description || '');
      setType(endpoint.type);
      setConnectionId(endpoint.connection_id);
      setSchemaName(endpoint.schema_name || '');
      setTableName(endpoint.table_name || '');
      setSqlText(endpoint.sql_text || '');
      setParams(endpoint.params || []);
      setPageSizeMax(endpoint.page_size_max || 100);
      setMaskFields(endpoint.mask_fields || []);
      setStatus(endpoint.status);
    } else {
      setName(''); setDescription(''); setType('sql'); setConnectionId('');
      setSchemaName(''); setTableName(''); setSqlText('');
      setParams([]); setPageSizeMax(100); setMaskFields([]); setStatus('active');
      setTables([]); setTableColumns([]);
    }
    setError(null);
  }, [open, endpoint]);

  // 切换连接 → 加载表
  useEffect(() => {
    if (!open || !connectionId) return;
    (async () => {
      try {
        const ts = await listConnectionTables(connectionId, schemaName || undefined);
        setTables(ts.map((t) => (t.schema ? `${t.schema}.${t.name}` : t.name)));
      } catch (e) {
        setTables([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, schemaName]);

  // 切换表 → 加载列（仅 table 模式）
  useEffect(() => {
    if (!open || !connectionId || !tableName || type !== 'table') {
      setTableColumns([]);
      return;
    }
    (async () => {
      try {
        const cols = await listConnectionColumns(connectionId, tableName, schemaName || undefined);
        setTableColumns(cols.map((c) => c.name));
      } catch {
        setTableColumns([]);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connectionId, tableName, schemaName, type]);

  // 推断 SQL 占位符 :name
  useEffect(() => {
    if (type !== 'sql' || !sqlText) {
      setParams([]);
      return;
    }
    // 简易 :param 检测：忽略注释 / 字符串
    const cleaned = sqlText
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/'(?:''|[^'])*'/g, "''");
    const names = new Set<string>();
    const re = /(?:^|[^A-Za-z0-9_]):([A-Za-z_][A-Za-z0-9_]*)/g;
    let m;
    while ((m = re.exec(cleaned)) !== null) names.add(m[1]);
    const detected = Array.from(names);
    // 与现有 params 合并（保留用户编辑过的 type/required/label）
    setParams((prev) => {
      const map = new Map(prev.map((p) => [p.name, p]));
      return detected.map((n) => map.get(n) || { name: n, type: 'string', required: false, label: n });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sqlText, type]);

  const handleAddParam = () => {
    setParams((p) => [...p, { name: '', type: 'string', required: false, label: '' }]);
  };

  const handleSave = async () => {
    setError(null);
    if (!name.trim()) { setError('请填写接口名称'); return; }
    if (!connectionId) { setError('请选择数据库连接'); return; }
    if (type === 'sql' && !sqlText.trim()) { setError('SQL 接口必须填写 SQL'); return; }
    if (type === 'table' && !tableName) { setError('表接口必须选择目标表'); return; }
    // 过滤空名参数
    const cleanParams = params.filter((p) => p.name.trim());
    setSaving(true);
    try {
      const payload: Partial<ApiEndpoint> = {
        name: name.trim(),
        description: description.trim(),
        type,
        connection_id: connectionId,
        schema_name: schemaName || undefined,
        table_name: type === 'table' ? (tableName || undefined) : undefined,
        sql_text: type === 'sql' ? (sqlText || undefined) : undefined,
        params: cleanParams,
        page_size_max: Math.max(1, Math.min(1000, pageSizeMax || 100)),
        mask_fields: maskFields,
        status,
      };
      if (isEdit && endpoint) {
        await updateEndpoint(endpoint.id, payload);
      } else {
        await createEndpoint(payload);
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const toggleMaskField = (field: string) => {
    setMaskFields((cur) => cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field]);
  };

  const selectedConn = useMemo(() => connections.find((c) => c.id === connectionId), [connections, connectionId]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth
      PaperProps={{ sx: { bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1.25 } }}>
      <DialogTitle sx={{ fontSize: 'calc(0.95rem * var(--dc-scale, 1))', fontWeight: 600, pb: 1 }}>
        {isEdit ? '编辑接口' : '新建接口'}
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        {error && (
          <Box sx={{ mb: 1.5, p: 1, borderRadius: 1, bgcolor: 'rgba(248,113,113,0.12)', color: 'error.main',
            fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>{error}</Box>
        )}

        <Stack spacing={1.25}>
          {/* 名称 + 描述 */}
          <Stack direction="row" spacing={1}>
            <TextField size="small" fullWidth label="接口名称" value={name}
              onChange={(e) => setName(e.target.value)} />
            <FormControlLabel
              control={<Switch size="small" checked={status === 'active'} onChange={(_, v) => setStatus(v ? 'active' : 'disabled')} />}
              label={<Typography sx={{ fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }}>启用</Typography>}
              sx={{ minWidth: 110 }}
            />
          </Stack>
          <TextField size="small" fullWidth multiline minRows={2} maxRows={4}
            label="接口说明" value={description} onChange={(e) => setDescription(e.target.value)} />

          {/* 类型 + 连接 */}
          <Stack direction="row" spacing={1}>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>类型</InputLabel>
              <Select label="类型" value={type} onChange={(e) => setType(e.target.value as 'sql' | 'table')}>
                <MenuItem value="sql">预定义 SQL</MenuItem>
                <MenuItem value="table">表自动生成</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 220, flex: 1 }}>
              <InputLabel>数据库连接</InputLabel>
              <Select label="数据库连接" value={connectionId}
                onChange={(e) => setConnectionId(e.target.value as string)}>
                {connections.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.name} <Box component="span" sx={{ color: 'text.secondary', ml: 0.5 }}>
                      ({c.driver}{c.host ? ` · ${c.host}` : ''})
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField size="small" label="Schema（可选）" value={schemaName} onChange={(e) => setSchemaName(e.target.value)}
              sx={{ minWidth: 160 }} />
            <TextField size="small" type="number" label="单页最大条数" value={pageSizeMax}
              onChange={(e) => setPageSizeMax(Number(e.target.value) || 100)}
              inputProps={{ min: 1, max: 1000 }}
              sx={{ width: 130 }} />
          </Stack>

          {/* 表模式 */}
          {type === 'table' && (
            <Stack direction="row" spacing={1} alignItems="center">
              <FormControl size="small" sx={{ minWidth: 240, flex: 1 }}>
                <InputLabel>目标表</InputLabel>
                <Select label="目标表" value={tableName}
                  onChange={(e) => setTableName(e.target.value as string)}>
                  {tables.length === 0 && <MenuItem value="" disabled>（请先选连接）</MenuItem>}
                  {tables.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                </Select>
              </FormControl>
              <Tooltip title="刷新表清单">
                <IconButton size="small" onClick={async () => {
                  if (!connectionId) return;
                  try { setTables((await listConnectionTables(connectionId, schemaName || undefined)).map((t) => (t.schema ? `${t.schema}.${t.name}` : t.name))); } catch {}
                }}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          )}

          {/* SQL 模式 */}
          {type === 'sql' && (
            <Box>
              <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>
                编写 SELECT / WITH 查询，使用 <code>:name</code> 声明参数（自动提取）
              </Typography>
              <TextField size="small" fullWidth multiline minRows={6} maxRows={18}
                value={sqlText} onChange={(e) => setSqlText(e.target.value)}
                placeholder="SELECT * FROM &quot;public&quot;.&quot;users&quot; WHERE id = :user_id LIMIT 100"
                sx={{
                  '& textarea': {
                    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 'calc(0.78rem * var(--dc-scale, 1))',
                  },
                }} />
            </Box>
          )}

          {/* 参数列表（仅 SQL 模式） */}
          {type === 'sql' && params.length > 0 && (
            <Box>
              <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>
                检测到 {params.length} 个命名参数
              </Typography>
              <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
                {params.map((p, idx) => (
                  <Stack key={idx} direction="row" spacing={1} sx={{ mb: 0.75 }} alignItems="center">
                    <TextField size="small" label="参数名" value={p.name}
                      onChange={(e) => setParams((cur) => cur.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                      sx={{ width: 140 }} />
                    <TextField size="small" select label="类型" value={p.type}
                      onChange={(e) => setParams((cur) => cur.map((x, i) => i === idx ? { ...x, type: e.target.value as ApiParam['type'] } : x))}
                      sx={{ width: 110 }}>
                      {PARAM_TYPES.map((t) => <MenuItem key={t} value={t}>{t}</MenuItem>)}
                    </TextField>
                    <TextField size="small" label="标签" value={p.label || ''}
                      onChange={(e) => setParams((cur) => cur.map((x, i) => i === idx ? { ...x, label: e.target.value } : x))}
                      sx={{ flex: 1 }} />
                    <FormControlLabel
                      control={<Switch size="small" checked={p.required}
                        onChange={(_, v) => setParams((cur) => cur.map((x, i) => i === idx ? { ...x, required: v } : x))} />}
                      label={<Typography sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>必填</Typography>} />
                    <IconButton size="small" onClick={() => setParams((cur) => cur.filter((_, i) => i !== idx))}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
                <Button size="small" startIcon={<AddIcon />} onClick={handleAddParam}
                  sx={{ textTransform: 'none', fontSize: 'calc(0.72rem * var(--dc-scale, 1))' }}>
                  添加参数
                </Button>
              </Box>
            </Box>
          )}

          {/* 脱敏字段多选（基于列） */}
          {tableColumns.length > 0 && (
            <Box>
              <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>
                脱敏字段（命中列返回时打码；按列名规则：身份证 / 手机号 / 邮箱 / 姓名）
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {tableColumns.map((c) => {
                  const on = maskFields.includes(c);
                  return (
                    <Chip key={c} size="small" label={c} onClick={() => toggleMaskField(c)}
                      color={on ? 'primary' : 'default'} variant={on ? 'filled' : 'outlined'}
                      sx={{ fontSize: 'calc(0.68rem * var(--dc-scale, 1))', height: 22 }} />
                  );
                })}
              </Box>
            </Box>
          )}

          {/* 表模式 SQL 自动生成预览 */}
          {type === 'table' && tableName && (
            <Box>
              <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', mb: 0.5 }}>
                自动生成的查询（只读）
              </Typography>
              <Box sx={{
                p: 1, borderRadius: 1, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: 'calc(0.74rem * var(--dc-scale, 1))',
                color: 'text.primary',
              }}>
                SELECT * FROM {(schemaName ? `"${schemaName}".` : '') + `"${tableName}"`}
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 1.75 }}>
        <Button size="small" onClick={onClose} sx={{ color: 'text.secondary', textTransform: 'none' }}>取消</Button>
        <Button size="small" variant="contained" color="primary" onClick={handleSave} disabled={saving}
          sx={{ textTransform: 'none' }}>
          {saving ? '保存中…' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default EndpointDialog;