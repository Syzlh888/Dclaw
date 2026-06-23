import React, { useState, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Alert, LinearProgress, Chip, Divider, Tabs, Tab,
} from '@mui/material';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import * as XLSX from 'xlsx';
import { importServers, getTemplateDownloadUrl } from '../../services/serverService';
import { useServerStore } from '../../stores/serverStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/** 需要从字符串转为数字的字段 */
const NUMERIC_FIELDS = new Set([
  'cpuCores', 'memoryGB', 'systemDiskGB', 'dataDiskGB', 'bandwidthMbps', 'bastionPort', 'port',
]);

const STRIP_BOOL_FIELDS = new Set(['encrypted']);

/** 服务器资源 Sheet 列映射 */
const SRV_COLUMN_MAP: Record<string, string> = {
  '服务器名称': 'name',         '服务器类型': 'serverType',
  '操作系统':   'os',           'MAC地址':   'macAddress',
  '内网IP':     'internalIp',    '外网IP':     'externalIp',
  '公网IP':     'publicIp',      '跨网访问IP': 'crossNetworkIp',
  '带宽(Mbps)': 'bandwidthMbps',
  'CPU核数':    'cpuCores',      '内存(GB)':   'memoryGB',
  '系统盘(GB)': 'systemDiskGB',  '数据盘(GB)': 'dataDiskGB',
  '存储类型':   'storageType',
  '用户名':     'username',      '密码':       'password',
  '堡垒机地址':   'bastionHost',    '堡垒机端口':   'bastionPort',
  '堡垒机用户名': 'bastionUsername', '堡垒机密码':   'bastionPassword',
  'VPN信息':      'vpnInfo',
  '所属项目': 'projectId', '所属工程': 'engineeringId', '所属应用': 'applicationId',
  '部署内容':   'deployedContent', '服务器位置': 'serverLocation',
  '标签':       'tags',           '备注':       'notes',
};

/** 数据库实例 Sheet 列映射 */
const DB_COLUMN_MAP: Record<string, string> = {
  '服务器名称': 'serverName',
  '数据库类型': 'dbType', '版本': 'version', '数据库名': 'dbName',
  '端口': 'port', '用户名': 'username', '密码': 'password',
  '内网IP': 'internalIp', '外网IP': 'externalIp',
  '是否集群': 'isCluster', '集群其他IP': 'clusterIps',
  '备注': 'notes',
};

/** 应用实例 Sheet 列映射 */
const APP_COLUMN_MAP: Record<string, string> = {
  '服务器名称': 'serverName',
  '应用名称': 'appName', '端口': 'port', 'URL': 'url',
  '联系人': 'contactPerson', '联系电话': 'contactPhone',
  '用户名': 'username', '密码': 'password',
  '备注': 'notes',
};

/** API实例 Sheet 列映射 */
const API_COLUMN_MAP: Record<string, string> = {
  '服务器名称': 'serverName',
  'API地址': 'apiAddress', '端口': 'port', '所属应用': 'applicationName',
  '是否加密': 'encrypted', '加密方式': 'encryptionMethod',
  '请求示例': 'requestExample', '响应示例': 'responseExample',
  '备注': 'notes',
};

/** 中间件实例 Sheet 列映射 */
const MID_COLUMN_MAP: Record<string, string> = {
  '服务器名称': 'serverName',
  '名称': 'midName', '端口': 'port', '类型': 'type',
  '版本': 'version', 'URL': 'url', '服务应用': 'serviceApp',
  '用户名': 'username', '密码': 'password',
  '备注': 'notes',
};

interface SheetData {
  sheetName: string;
  headers: string[];
  rows: any[];
  columnMap: Record<string, string>;
  requiredCols: Set<string>;
}

/** 解析单个 Sheet */
function parseSheet(ws: XLSX.WorkSheet, sheetName: string): SheetData | null {
  const rawData: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  if (rawData.length < 2) return null;

  // 跳过注释行（以 # 开头的行）
  let headerRowIdx = 0;
  for (let i = 0; i < rawData.length; i++) {
    const firstCell = String(rawData[i]?.[0] || '').trim();
    if (firstCell && !firstCell.startsWith('#')) {
      headerRowIdx = i;
      break;
    }
  }

  const headers = (rawData[headerRowIdx] as string[] || []).map(h => String(h).trim()).filter(Boolean);
  if (headers.length === 0) return null;

  let columnMap: Record<string, string>;
  let requiredCols: Set<string>;

  if (sheetName.includes('数据库')) {
    columnMap = DB_COLUMN_MAP;
    requiredCols = new Set(['服务器名称', '数据库类型', '数据库名', '端口']);
  } else if (sheetName.includes('应用实例') || sheetName.includes('应用')) {
    columnMap = APP_COLUMN_MAP;
    requiredCols = new Set(['服务器名称', '应用名称', 'URL']);
  } else if (sheetName.includes('API')) {
    columnMap = API_COLUMN_MAP;
    requiredCols = new Set(['服务器名称', 'API地址', '所属应用']);
  } else if (sheetName.includes('中间件')) {
    columnMap = MID_COLUMN_MAP;
    requiredCols = new Set(['服务器名称', '名称', '类型']);
  } else {
    columnMap = SRV_COLUMN_MAP;
    requiredCols = new Set(['服务器名称', '内网IP']);
  }

  const rows = rawData.slice(headerRowIdx + 1)
    .map((row: any[], idx) => {
      const obj: any = {};
      headers.forEach((h, i) => {
        const key = columnMap[h] || h;
        obj[key] = normalizeField(key, row[i] !== undefined ? row[i] : '');
      });
      obj._row = headerRowIdx + idx + 2;
      return obj;
    })
    .filter(r => {
      // 过滤空行
      const vals = Object.values(r).filter(v => v !== '' && v !== null && v !== undefined && v !== '_row');
      return vals.length > 0;
    });

  return { sheetName, headers, rows, columnMap, requiredCols };
}

/** 标准化字段值 */
function normalizeField(key: string, raw: any): any {
  if (raw === undefined || raw === null || raw === '') return raw;
  if (NUMERIC_FIELDS.has(key)) {
    const n = Number(raw);
    return isNaN(n) ? null : n;
  }
  if (key === 'tags') {
    return typeof raw === 'string'
      ? raw.split(',').map(t => t.trim()).filter(Boolean)
      : Array.isArray(raw) ? raw : [];
  }
  if (STRIP_BOOL_FIELDS.has(key)) {
    const s = String(raw).trim();
    return s === '是' || s === 'true' || s === '1';
  }
  return typeof raw === 'string' ? raw.trim() : raw;
}

const ServerImportDialog: React.FC<Props> = ({ open, onClose }) => {
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errMsg, setErrMsg] = useState('');
  const loadServers = useServerStore(s => s.loadServers);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setSheets([]);
    setActiveSheetIdx(0);
    setResult(null);
    setErrMsg('');
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    reset();
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'binary' });
        const parsedSheets: SheetData[] = [];
        const allSheetNames = wb.SheetNames.filter(n => n !== '填写说明');
        for (const sn of allSheetNames) {
          const ws = wb.Sheets[sn];
          if (!ws) continue;
          const data = parseSheet(ws, sn);
          if (data) parsedSheets.push(data);
        }
        if (parsedSheets.length === 0) {
          setErrMsg('未能解析到有效数据，请检查文件格式');
          return;
        }
        setSheets(parsedSheets);
      } catch (err: any) {
        setErrMsg('文件解析失败: ' + (err.message || '未知错误'));
      }
    };
    reader.readAsBinaryString(file);
  };

  /** 构建导入负载 */
  const buildPayload = useCallback(() => {
    const payload: any = { servers: [] };
    for (const sheet of sheets) {
      const items = sheet.rows.map(r => {
        const { _row, ...fields } = r;
        return { ...fields, row: _row };
      });
      if (sheet.sheetName.includes('数据库')) {
        payload.dbInstances = items;
      } else if (sheet.sheetName.includes('应用实例') || sheet.sheetName.includes('应用')) {
        payload.appInstances = items;
      } else if (sheet.sheetName.includes('API')) {
        payload.apiInstances = items;
      } else if (sheet.sheetName.includes('中间件')) {
        payload.midInstances = items;
      } else {
        payload.servers = items;
      }
    }
    return payload;
  }, [sheets]);

  const handleImport = async () => {
    if (sheets.length === 0) return;
    setImporting(true);
    try {
      const payload = buildPayload();
      const res = await importServers(payload);
      setResult(res);
      if (res.success > 0) await loadServers();
    } catch (err: any) {
      setResult({ error: err.message });
    }
    setImporting(false);
  };

  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
  const activeSheet = sheets[activeSheetIdx];

  /** 渲染预览表格 */
  const renderPreviewTable = (sheet: SheetData) => {
    const previewRows = sheet.rows.slice(0, 10);
    const isServerSheet = !sheet.sheetName.includes('数据库') && !sheet.sheetName.includes('应用')
      && !sheet.sheetName.includes('API') && !sheet.sheetName.includes('中间件');
    const effectiveRequired = isServerSheet ? sheet.requiredCols : new Set<string>();

    return (
      <TableContainer sx={{ maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.7rem', bgcolor: '#f5f5f5', width: 40 }}>#</TableCell>
              {sheet.headers.map(h => (
                <TableCell key={h} sx={{ fontWeight: 600, fontSize: '0.7rem', bgcolor: '#f5f5f5' }}>
                  {h}
                  {effectiveRequired.has(h) && <span style={{ color: 'red', marginLeft: 2 }}>*</span>}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {previewRows.map((r, i) => (
              <TableRow key={i} sx={{ '&:nth-of-type(even)': { bgcolor: '#fafafa' } }}>
                <TableCell sx={{ fontSize: '0.7rem', color: 'text.secondary' }}>{r._row}</TableCell>
                {sheet.headers.map((h, j) => {
                  const key = sheet.columnMap[h] || h;
                  const val = key === 'tags' && Array.isArray(r[key]) ? r[key].join(', ') : String(r[key] ?? '');
                  return (
                    <TableCell key={j} sx={{ fontSize: '0.72rem', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={String(r[key] ?? '')}>
                      {val}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>导入服务器资源</DialogTitle>
      <DialogContent>
        {/* 操作指引 */}
        <Alert severity="info" sx={{ mb: 2 }}>
          请先「下载模板」，模板包含5个Sheet（服务器资源、数据库实例、应用实例、API实例、中间件实例），按格式填写数据后导入。各Sheet通过"服务器名称"自动关联。
        </Alert>

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="outlined" size="small" startIcon={<CloudDownloadIcon />}
            href={getTemplateDownloadUrl()} target="_blank">
            下载导入模板
          </Button>
          <Button variant="contained" size="small" startIcon={<FileUploadIcon />}
            onClick={() => fileRef.current?.click()} component="span">
            选择文件
          </Button>
          <Chip label="支持 .xlsx / .xls" size="small" variant="outlined" sx={{ alignSelf: 'center' }} />
        </Box>
        <input type="file" ref={fileRef} hidden accept=".xlsx,.xls" onChange={handleFile} />

        {importing && <LinearProgress sx={{ mb: 1 }} />}

        {/* 错误提示 */}
        {errMsg && <Alert severity="error" sx={{ mb: 1 }}>{errMsg}</Alert>}

        {/* 结果提示 */}
        {result && (
          <Alert severity={result.error ? 'error' : 'success'} sx={{ mb: 1 }}>
            {result.error
              ? `导入失败: ${result.error}`
              : `导入完成: 成功 ${result.success} 条, 失败 ${result.failed} 条 (共 ${result.total} 条)`}
          </Alert>
        )}

        {/* 多Sheet Tab 预览 */}
        {sheets.length > 0 && (
          <Box>
            <Divider sx={{ mb: 1.5 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              数据预览（共 {sheets.length} 个Sheet，{totalRows} 条数据）
            </Typography>
            <Tabs
              value={activeSheetIdx}
              onChange={(_, v) => setActiveSheetIdx(v)}
              variant="scrollable"
              scrollButtons="auto"
              sx={{ mb: 1, minHeight: 36 }}
            >
              {sheets.map((s, i) => (
                <Tab
                  key={i}
                  label={`${s.sheetName} (${s.rows.length}条)`}
                  sx={{ minHeight: 36, py: 0.5, fontSize: '0.8rem', textTransform: 'none' }}
                />
              ))}
            </Tabs>
            {activeSheet && (
              <>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
                  显示前 10 条 · {activeSheet.headers.length} 列 · 共 {activeSheet.rows.length} 条数据
                </Typography>
                {renderPreviewTable(activeSheet)}
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={() => { reset(); onClose(); }} size="small">关闭</Button>
        {sheets.length > 0 && !result && (
          <Button variant="contained" size="small" onClick={handleImport} disabled={importing}>
            确认导入全部 ({totalRows} 条)
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ServerImportDialog;
