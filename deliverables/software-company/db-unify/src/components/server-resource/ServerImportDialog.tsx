import React, { useState, useCallback } from 'react';
import {
  Button, Typography, Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Alert, Chip, Tabs, Tab, Paper, IconButton, Tooltip,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import * as XLSX from 'xlsx';
import { importServers, getTemplateDownloadUrl } from '../../services/serverService';
import { apiFetch } from '../../services/apiClient';
import { useServerStore } from '../../stores/serverStore';
import ImportDialogShell from '../common/ImportDialogShell';
import ImportDropzone from '../common/ImportDropzone';

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
  'IP地址':     'ipAddress',    'IP类型':     'ipType',
  '映射端口':   'mappedPort',   '映射IP':     'mappedIp',
  '带宽(Mbps)': 'bandwidthMbps',
  'CPU核数':    'cpuCores',      '内存(GB)':   'memoryGB',
  '系统盘(GB)': 'systemDiskGB',  '数据盘(GB)': 'dataDiskGB',
  '存储类型':   'storageType',
  '凭据用户名1': 'credUsername1', '凭据密码1':   'credPassword1',
  '凭据用户名2': 'credUsername2', '凭据密码2':   'credPassword2',
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
  '数据库类型': 'dbType', '版本': 'version', '数据库名': 'dbName', 'Schema': 'schema',
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

const steps = ['上传文件', '预览校验', '确认导入'];

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
  const [activeStep, setActiveStep] = useState(0);
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [errMsg, setErrMsg] = useState('');
  const loadServers = useServerStore(s => s.loadServers);
  const [downloading, setDownloading] = useState(false);

  const handleDownloadTemplate = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await apiFetch(getTemplateDownloadUrl());
      if (!res.ok) throw new Error('下载模板失败');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '服务器资源导入模板.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrMsg(err.message || '模板下载失败');
    } finally {
      setDownloading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setActiveStep(0);
    setFileName('');
    setSheets([]);
    setActiveSheetIdx(0);
    setResult(null);
    setErrMsg('');
  }, []);

  // ---- 步骤 1：上传并解析文件 ----
  const handleFileSelected = useCallback((file: File) => {
    setFileName(file.name);
    setErrMsg('');
    setResult(null);
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
        setActiveSheetIdx(0);
        setActiveStep(1);
      } catch (err: any) {
        setErrMsg('文件解析失败: ' + (err.message || '未知错误'));
      }
    };
    reader.readAsBinaryString(file);
  }, []);

  /** 构建导入负载 */
  const buildPayload = useCallback(() => {
    const payload: any = { servers: [] };
    for (const sheet of sheets) {
      const items = sheet.rows.map(r => {
        const { _row, ipAddress, ipType, mappedPort, mappedIp,
          credUsername1, credPassword1, credUsername2, credPassword2,
          ...fields } = r;
        const item: any = { ...fields, row: _row };

        // 拆解 IP 信息 → ips 数组
        if (ipAddress || ipType || mappedPort || mappedIp) {
          item.ips = [{
            ip: ipAddress || '',
            type: ipType || '局域',
            port: mappedPort != null && mappedPort !== '' ? Number(mappedPort) : undefined,
            mappedIp: mappedIp || '',
          }];
        }

        // 拆解凭据 → credentials 数组
        const creds: any[] = [];
        if (credUsername1) creds.push({ username: credUsername1, password: credPassword1 || '' });
        if (credUsername2) creds.push({ username: credUsername2, password: credPassword2 || '' });
        if (creds.length > 0) item.credentials = creds;

        // 不再以服务器资源原有的 username/password 方式存储，统一用 credentials
        return item;
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

  // ---- 步骤 2/3：确认导入 ----
  const handleImport = async () => {
    if (sheets.length === 0) return;
    setImporting(true);
    setErrMsg('');
    try {
      const payload = buildPayload();
      const res = await importServers(payload);
      setResult(res);
      setActiveStep(2);
      if (res.success > 0) await loadServers();
    } catch (err: any) {
      setResult({ error: err.message });
      setActiveStep(2);
    }
    setImporting(false);
  };

  const totalRows = sheets.reduce((sum, s) => sum + s.rows.length, 0);
  const activeSheet = sheets[activeSheetIdx];

  const handleClose = () => {
    reset();
    onClose();
  };

  /** 渲染预览表格 */
  const renderPreviewTable = (sheet: SheetData) => {
    const previewRows = sheet.rows.slice(0, 10);
    const isServerSheet = !sheet.sheetName.includes('数据库') && !sheet.sheetName.includes('应用')
      && !sheet.sheetName.includes('API') && !sheet.sheetName.includes('中间件');
    const effectiveRequired = isServerSheet ? sheet.requiredCols : new Set<string>();

    return (
      <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.75, width: 40 }}>#</TableCell>
              {sheet.headers.map((h) => (
                <TableCell key={h} sx={{ fontWeight: 600, fontSize: '0.75rem', py: 0.75 }}>
                  {h}
                  {effectiveRequired.has(h) && <span style={{ color: '#f44336', marginLeft: 2 }}>*</span>}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {previewRows.map((r, i) => (
              <TableRow key={i} sx={{ '&:hover': { bgcolor: 'action.hover' } }}>
                <TableCell sx={{ fontSize: '0.75rem', py: 0.5, color: 'text.secondary' }}>{r._row}</TableCell>
                {sheet.headers.map((h, j) => {
                  const key = sheet.columnMap[h] || h;
                  const val = key === 'tags' && Array.isArray(r[key]) ? r[key].join(', ') : String(r[key] ?? '');
                  return (
                    <TableCell
                      key={j}
                      sx={{
                        fontSize: '0.75rem', py: 0.5,
                        maxWidth: 140, overflow: 'hidden',
                        textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                      title={String(r[key] ?? '')}
                    >
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

  // 底部按钮栏（按步骤切换）
  const renderActions = () => {
    if (activeStep === 0) {
      return (
        <Button onClick={handleClose} size="small" sx={{ textTransform: 'none' }}>取消</Button>
      );
    }
    if (activeStep === 1) {
      return (
        <>
          <Button onClick={() => setActiveStep(0)} size="small" sx={{ textTransform: 'none' }}>
            上一步
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handleImport}
            disabled={sheets.length === 0 || importing}
            sx={{ textTransform: 'none' }}
          >
            {importing ? '导入中...' : `确认导入 ${totalRows} 条`}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button
          onClick={reset}
          size="small"
          startIcon={<RefreshIcon sx={{ fontSize: '1rem' }} />}
          sx={{ textTransform: 'none' }}
        >
          重新导入
        </Button>
        <Button variant="contained" size="small" onClick={handleClose} sx={{ textTransform: 'none' }}>
          完成
        </Button>
      </>
    );
  };

  return (
    <ImportDialogShell
      open={open}
      onClose={handleClose}
      title="批量导入服务器资源"
      icon={<CloudUploadIcon sx={{ fontSize: '1.25rem' }} />}
      steps={steps}
      activeStep={activeStep}
      error={errMsg}
      onErrorClose={() => setErrMsg('')}
      loading={importing}
      maxWidth="lg"
      actions={renderActions()}
    >
      {/* 步骤 0：上传文件 */}
      {activeStep === 0 && (
        <ImportDropzone
          accept={['.xlsx', '.xls']}
          hint="支持 .xlsx、.xls 格式的服务器资源导入模板（多 Sheet）"
          downloadLabel="下载模板"
          downloading={downloading}
          onFileSelected={handleFileSelected}
          onDownloadTemplate={handleDownloadTemplate}
          templateInfo={
            <>
              • 模板包含 5 个 Sheet：服务器资源、数据库实例、应用实例、API 实例、中间件实例<br />
              • 各 Sheet 通过「服务器名称」字段自动关联<br />
              • 服务器资源必填列：服务器名称、内网IP<br />
              • 数据库实例必填列：服务器名称、数据库类型、数据库名、端口<br />
              • 应用实例必填列：服务器名称、应用名称、URL<br />
              • API 实例必填列：服务器名称、API 地址、所属应用<br />
              • 中间件实例必填列：服务器名称、名称、类型<br />
              • 点击「下载模板」获取带示例的 xlsx 文件
            </>
          }
        />
      )}

      {/* 步骤 1：预览校验 */}
      {activeStep === 1 && sheets.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
              文件：{fileName} · 共 {sheets.length} 个 Sheet · {totalRows} 条数据
            </Typography>
            <Chip
              icon={<CheckCircleIcon sx={{ fontSize: '0.875rem' }} />}
              label={`${totalRows} 条待导入`}
              size="small"
              color={totalRows > 0 ? 'success' : 'default'}
              variant="outlined"
              sx={{ fontSize: '0.7rem', height: 22 }}
            />
            <Box sx={{ flex: 1 }} />
            <Tooltip title="重新选择文件">
              <IconButton size="small" onClick={reset}>
                <RefreshIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
          </Box>

          {/* 多 Sheet Tab 切换 */}
          <Tabs
            value={activeSheetIdx}
            onChange={(_, v) => setActiveSheetIdx(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              mb: 1.5, minHeight: 32,
              borderBottom: 1, borderColor: 'divider',
              '& .MuiTab-root': {
                minHeight: 32, py: 0.5, fontSize: '0.75rem', textTransform: 'none',
              },
            }}
          >
            {sheets.map((s, i) => (
              <Tab key={i} label={`${s.sheetName} (${s.rows.length})`} />
            ))}
          </Tabs>

          {activeSheet && (
            <>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mb: 0.75, display: 'block', fontSize: '0.72rem' }}
              >
                预览前 10 条 · {activeSheet.headers.length} 列 · 共 {activeSheet.rows.length} 条数据
              </Typography>
              {renderPreviewTable(activeSheet)}
            </>
          )}
        </>
      )}

      {/* 步骤 2：导入结果 */}
      {activeStep === 2 && result && (
        <Box>
          {result.error ? (
            <Alert severity="error" sx={{ fontSize: '0.8rem' }}>
              导入失败：{result.error}
            </Alert>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                <Chip
                  icon={<CheckCircleIcon sx={{ fontSize: '0.875rem' }} />}
                  label={`成功 ${result.success} 条`}
                  size="small"
                  color={result.success > 0 ? 'success' : 'default'}
                  variant="filled"
                  sx={{ fontSize: '0.75rem' }}
                />
                <Chip
                  icon={<ErrorIcon sx={{ fontSize: '0.875rem' }} />}
                  label={`失败 ${result.failed} 条`}
                  size="small"
                  color={result.failed > 0 ? 'error' : 'default'}
                  variant="filled"
                  sx={{ fontSize: '0.75rem' }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                  共 {result.total} 条
                </Typography>
              </Box>

              {result.failed > 0 && (
                <Alert severity="warning" sx={{ fontSize: '0.8rem' }}>
                  部分数据导入失败，请检查后重新导入
                </Alert>
              )}
              {result.failed === 0 && result.success > 0 && (
                <Alert severity="success" sx={{ fontSize: '0.8rem' }}>
                  全部数据已成功导入
                </Alert>
              )}
            </>
          )}
        </Box>
      )}
    </ImportDialogShell>
  );
};

export default ServerImportDialog;
