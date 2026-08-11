import React, { useState, useCallback } from 'react';
import {
  Button, Box, Typography, Chip, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Alert,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import RefreshIcon from '@mui/icons-material/Refresh';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { bulkImportConnections, downloadImportTemplate } from '../../services/connectionApiService';
import type { BulkImportItem, BulkImportResult } from '../../services/connectionApiService';
import { useConnectionStore } from '../../stores/connectionStore';
import { useTreeStore } from '../../stores/treeStore';
import ImportDialogShell from '../common/ImportDialogShell';
import ImportDropzone from '../common/ImportDropzone';

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
}

const VALID_DRIVERS = ['mysql', 'postgresql', 'oracle', 'sqlserver', 'custom'];
// 允许用户填写自定义驱动名称的场景（如 "highgo", "瀚高" 等），这些会由服务端自动映射到 custom + 驱动ID
const CUSTOM_DRIVER_ALIASES = ['highgo', '瀚高', 'high godb', 'hgdb', 'kingbase', '金仓', 'gaussdb', '高斯', 'gauss',
  'opengauss', 'dameng', '达梦', 'shentong', '神通', 'tdsql', 'oceanbase', 'oceanbase mysql', 'gbase', 'dm8', 'dm7'];

/** 解析后的导入行 */
interface ParsedRow extends BulkImportItem {
  _row: number;        // 原始行号（含表头）
  _errors: string[];   // 字段验证错误
  _valid: boolean;
}

/** 字段映射：CSV/Excel 表头 → 字段名 */
const FIELD_MAP: Record<string, keyof BulkImportItem> = {
  '名称': 'name', '连接名称': 'name', '连接名': 'name', '实例名称': 'name',
  '驱动类型': 'driver', '驱动': 'driver', '数据库类型': 'driver', '类型': 'driver',
  '主机地址': 'host', '主机': 'host', '服务器地址': 'host', '服务器': 'host', 'IP地址': 'host', 'ip': 'host', 'host': 'host',
  '端口': 'port', '端口号': 'port', 'port': 'port',
  '用户名': 'username', '用户': 'username', '账号': 'username', 'username': 'username', 'user': 'username',
  '密码': 'password', 'password': 'password', 'pass': 'password',
  '数据库名': 'database', '数据库': 'database', '数据库名称': 'database', 'database': 'database', 'db': 'database',
  'schema': 'schema', 'Schema': 'schema', '模式': 'schema',
  '项目': 'platform', '项目名称': 'platform', '平台': 'platform',
  '业务模块': 'predb_type', '模块': 'predb_type',
  '区域节点': 'district', '区域': 'district', '节点': 'district',
  '连接实例名称': 'hospital_name', '实例名': 'hospital_name',
  '自定义驱动名称': 'customDriverName', '自定义驱动': 'customDriverName', '驱动名称': 'customDriverName',
};

const REQUIRED_FIELDS: (keyof BulkImportItem)[] = ['name', 'driver', 'host', 'port', 'username', 'password'];

const steps = ['上传文件', '预览校验', '确认导入'];

const BulkImportDialog: React.FC<BulkImportDialogProps> = ({ open, onClose }) => {
  const loadConnections = useConnectionStore((s) => s.loadConnections);

  const [activeStep, setActiveStep] = useState(0);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkImportResult | null>(null);
  const [error, setError] = useState('');

  // ---- 步骤 1：上传并解析文件 ----
  const handleFileSelected = useCallback(async (file: File) => {
    setFileName(file.name);
    setError('');
    setImportResult(null);

    try {
      const ext = file.name.split('.').pop()?.toLowerCase();
      let rawRows: Record<string, string>[] = [];

      if (ext === 'csv') {
        // 用 papaparse 解析 CSV
        // 先尝试 UTF-8 解码；如果中文乱码则回退到 GBK（Win 中文 Excel 默认编码）
        const buffer = await file.arrayBuffer();
        let text = new TextDecoder('utf-8').decode(buffer);

        // 检测是否为乱码：如果包含常见替换字符或中文编码错误特征，则改用 GBK
        const hasChineseLike = (s: string) => /[\u4e00-\u9fff]/.test(s);
        const hasGarbledUtf8 = (s: string) => /\uFFFD/.test(s) || /Ã|â|ï¿½/.test(s);
        if (!hasChineseLike(text) || hasGarbledUtf8(text)) {
          try {
            const gbkText = new TextDecoder('gbk').decode(buffer);
            if (hasChineseLike(gbkText) && !hasGarbledUtf8(gbkText)) {
              text = gbkText;
            }
          } catch (_) {
            // GBK 解码失败，保持 UTF-8
          }
        }

        // 去除 UTF-8 BOM
        text = text.replace(/^\uFEFF/, '').replace(/^\uFFFE/, '');
        const parsed = Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h: string) => {
            // 归一化表头：去 BOM + 去首尾空格 + 全角括号转半角
            return h.replace(/^\uFEFF/, '').trim().replace(/（/g, '(').replace(/）/g, ')');
          },
        });
        rawRows = parsed.data as Record<string, string>[];
      } else if (ext === 'xlsx' || ext === 'xls') {
        // 用 xlsx 解析 Excel
        const data = await file.arrayBuffer();
        const wb = XLSX.read(data, { type: 'array' });
        const wsName = wb.SheetNames[0];
        const ws = wb.Sheets[wsName];
        rawRows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as Record<string, string>[];
        // 对 Excel 的表头也做归一化处理
        if (rawRows.length > 0) {
          const normalized: Record<string, string>[] = [];
          for (const row of rawRows) {
            const newRow: Record<string, string> = {};
            for (const key of Object.keys(row)) {
              const normalizedKey = key.replace(/^\uFEFF/, '').trim().replace(/（/g, '(').replace(/）/g, ')');
              newRow[normalizedKey] = row[key];
            }
            normalized.push(newRow);
          }
          rawRows = normalized;
        }
      } else {
        setError('仅支持 .csv、.xlsx、.xls 格式的文件');
        return;
      }

      if (rawRows.length === 0) {
        setError('文件中没有找到数据行');
        return;
      }

      // 映射字段名并校验
      const actualHeaders = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
      const matchedHeaders = actualHeaders.filter((h) => h in FIELD_MAP);
      if (actualHeaders.length > 0 && matchedHeaders.length === 0) {
        setError(
          `表头无法识别！文件中的表头为：${actualHeaders.join('、')}。` +
          `请确认文件编码为 UTF-8，或使用「下载模板」生成的 CSV 文件。`
        );
        return;
      }
      if (actualHeaders.length > 0 && matchedHeaders.length < 3) {
        console.warn(
          `[批量导入] 仅匹配到 ${matchedHeaders.length} 个表头，可能大部分字段无法识别。` +
          `文件中表头: ${actualHeaders.join(', ')}`
        );
      }

      // 映射字段名并校验
      const rows: ParsedRow[] = rawRows.map((r, i) => {
        const item: any = { _row: i + 2 }; // +2 因为第 1 行是表头
        const errors: string[] = [];

        for (const [header, field] of Object.entries(FIELD_MAP)) {
          if (r[header] !== undefined && r[header] !== '') {
            item[field] = String(r[header]).trim();
          }
        }

        // 校验必填字段
        for (const field of REQUIRED_FIELDS) {
          if (!item[field]) {
            const labelMap: Record<string, string> = {
              name: '名称', driver: '驱动类型', host: '主机地址',
              port: '端口', username: '用户名', password: '密码',
            };
            errors.push(`缺少「${labelMap[field]}」`);
          }
        }

        // 校验驱动类型：标准类型 + 已知自定义驱动别名均通过
        if (item.driver) {
          const driverLower = item.driver.toLowerCase();
          const isStandard = VALID_DRIVERS.includes(driverLower);
          const isKnownAlias = CUSTOM_DRIVER_ALIASES.some((a) => driverLower.includes(a) || a.includes(driverLower));
          if (!isStandard && !isKnownAlias) {
            errors.push(`驱动类型 "${item.driver}" 无效，支持: ${VALID_DRIVERS.join(', ')} 及自定义驱动名称（如 highgo、kingbase 等）`);
          }
        }

        // 校验端口
        if (item.port) {
          const p = Number(item.port);
          if (isNaN(p) || p < 1 || p > 65535) {
            errors.push(`端口 "${item.port}" 无效（需为 1-65535）`);
          }
          item.port = p;
        }

        item._errors = errors;
        item._valid = errors.length === 0;
        return item;
      });

      setParsedRows(rows);
      setActiveStep(1);
    } catch (err: any) {
      setError(err.message || '文件解析失败');
    }
  }, []);

  // ---- 步骤 2/3：确认导入 ----
  const handleImport = useCallback(async () => {
    const validRows = parsedRows.filter((r) => r._valid);
    if (validRows.length === 0) {
      setError('没有通过校验的数据行，无法导入');
      return;
    }

    setImporting(true);
    setError('');

    try {
      // 转换为纯数据（包含层级字段）
      const items: BulkImportItem[] = validRows.map((r) => ({
        name: r.name,
        driver: r.driver.toLowerCase(),
        host: r.host,
        port: Number(r.port),
        username: r.username,
        password: r.password,
        database: r.database || '',
        schema: r.schema || '',
        customDriverName: r.customDriverName || '',
        platform: r.platform || '',
        predb_type: r.predb_type || '',
        district: r.district || '',
        hospital_name: r.hospital_name || '',
      }));

      const result = await bulkImportConnections(items);
      setImportResult(result);
      setActiveStep(2);
      await loadConnections(); // 刷新连接列表
      // 刷新树结构以显示新创建的层级和节点
      await useTreeStore.getState().loadTree();
    } catch (err: any) {
      setError(err.message || '导入失败');
    } finally {
      setImporting(false);
    }
  }, [parsedRows, loadConnections]);

  // ---- 下载模板 ----
  const handleDownloadTemplate = useCallback(async () => {
    try {
      await downloadImportTemplate();
    } catch (err: any) {
      setError(err.message || '模板下载失败');
    }
  }, []);

  // ---- 重置 ----
  const handleReset = () => {
    setActiveStep(0);
    setParsedRows([]);
    setFileName('');
    setImportResult(null);
    setError('');
  };

  const validCount = parsedRows.filter((r) => r._valid).length;
  const invalidCount = parsedRows.filter((r) => !r._valid).length;

  // 底部按钮栏（按步骤切换）
  const renderActions = () => {
    if (activeStep === 0) {
      return (
        <Button onClick={onClose} size="small" sx={{ textTransform: 'none' }}>取消</Button>
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
            disabled={validCount === 0 || importing}
            sx={{ textTransform: 'none' }}
          >
            {importing ? '导入中...' : `确认导入 ${validCount} 条`}
          </Button>
        </>
      );
    }
    return (
      <>
        <Button onClick={handleReset} size="small" startIcon={<RefreshIcon sx={{ fontSize: '1rem' }} />} sx={{ textTransform: 'none' }}>
          重新导入
        </Button>
        <Button variant="contained" size="small" onClick={onClose} sx={{ textTransform: 'none' }}>
          完成
        </Button>
      </>
    );
  };

  return (
    <ImportDialogShell
      open={open}
      onClose={onClose}
      title="批量导入数据库连接"
      icon={<CloudUploadIcon sx={{ fontSize: '1.25rem' }} />}
      steps={steps}
      activeStep={activeStep}
      error={error}
      onErrorClose={() => setError('')}
      loading={importing}
      maxWidth="lg"
      actions={renderActions()}
    >
      {/* 步骤 0：上传文件 */}
      {activeStep === 0 && (
        <ImportDropzone
          accept={['.csv', '.xlsx', '.xls']}
          hint="支持 .csv、.xlsx、.xls 格式的数据库连接配置文件"
          downloadLabel="下载模板"
          onFileSelected={handleFileSelected}
          onDownloadTemplate={handleDownloadTemplate}
          templateInfo={
            <>
              • 必填列：连接名称、驱动类型、主机地址、端口、用户名、密码<br />
              • 可选列：数据库名、Schema、自定义驱动名称、项目、业务模块、区域节点、连接实例名称<br />
              • 层级说明：填写项目→业务模块→区域节点后，若层级不存在将自动创建，并自动关联到左侧树<br />
              • 驱动类型：mysql、postgresql、oracle、sqlserver、custom<br />
              • 自定义驱动：当驱动类型为 custom 时，可填写「自定义驱动名称」列指定已安装的驱动（如 瀚高、金仓 等）<br />
              • 端口：1-65535 之间的数字<br />
              • 点击「下载模板」获取带示例的 CSV 文件
            </>
          }
        />
      )}

      {/* 步骤 1：预览校验 */}
      {activeStep === 1 && parsedRows.length > 0 && (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
              文件：{fileName} · 共 {parsedRows.length} 行
            </Typography>
            <Chip
              icon={<CheckCircleIcon sx={{ fontSize: '0.875rem' }} />}
              label={`${validCount} 行通过`}
              size="small"
              color={validCount > 0 ? 'success' : 'default'}
              variant="outlined"
              sx={{ fontSize: '0.7rem', height: 22 }}
            />
            {invalidCount > 0 && (
              <Chip
                icon={<ErrorIcon sx={{ fontSize: '0.875rem' }} />}
                label={`${invalidCount} 行失败`}
                size="small"
                color="error"
                variant="outlined"
                sx={{ fontSize: '0.7rem', height: 22 }}
              />
            )}
            <Box sx={{ flex: 1 }} />
            <Tooltip title="重新选择文件">
              <IconButton size="small" onClick={handleReset}>
                <RefreshIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="删除无效行">
              <IconButton
                size="small"
                onClick={() => setParsedRows(parsedRows.filter((r) => r._valid))}
                disabled={invalidCount === 0}
              >
                <DeleteIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </Tooltip>
          </Box>

          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 340 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>#</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>名称</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>驱动</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>主机:端口</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>数据库</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>层级路径</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>状态</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {parsedRows.map((row, i) => (
                  <TableRow
                    key={i}
                    sx={{
                      bgcolor: row._valid ? 'transparent' : 'error.light',
                      '&:hover': { bgcolor: row._valid ? 'action.hover' : 'error.light' },
                    }}
                  >
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>{row._row}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>{row.name || '-'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>
                      {row.driver ? (
                        <Chip label={row.driver} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                      ) : '-'}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5, fontFamily: 'monospace' }}>
                      {row.host ? `${row.host}:${row.port || '-'}` : '-'}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>{row.database || '-'}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5, color: 'text.secondary' }}>
                      {row.platform || row.predb_type || row.district
                        ? [row.platform, row.predb_type, row.district].filter(Boolean).join(' > ')
                        : '-'}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>
                      {row._valid ? (
                        <CheckCircleIcon sx={{ fontSize: '1rem', color: 'success.main' }} />
                      ) : (
                        <Tooltip title={row._errors.join('；')}>
                          <ErrorIcon sx={{ fontSize: '1rem', color: 'error.main' }} />
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {/* 步骤 2：导入结果 */}
      {activeStep === 2 && importResult && (
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Chip
              icon={<CheckCircleIcon sx={{ fontSize: '0.875rem' }} />}
              label={`成功 ${importResult.success} 条`}
              size="small"
              color={importResult.success > 0 ? 'success' : 'default'}
              variant="filled"
              sx={{ fontSize: '0.75rem' }}
            />
            <Chip
              icon={<ErrorIcon sx={{ fontSize: '0.875rem' }} />}
              label={`失败 ${importResult.failed} 条`}
              size="small"
              color={importResult.failed > 0 ? 'error' : 'default'}
              variant="filled"
              sx={{ fontSize: '0.75rem' }}
            />
          </Box>

          {importResult.failed > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5, fontSize: '0.8rem' }}>
              部分连接导入失败，请检查以下记录并修正后重新导入
            </Alert>
          )}

          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>行号</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>名称</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>结果</TableCell>
                  <TableCell sx={{ fontSize: '0.75rem', fontWeight: 600, py: 0.75 }}>详情</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {importResult.results.map((r, i) => (
                  <TableRow key={i}>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>{r.row}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>{r.name}</TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5 }}>
                      {r.status === 'created' ? (
                        <Chip label="已创建" size="small" color="success" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                      ) : (
                        <Chip label="失败" size="small" color="error" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                      )}
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem', py: 0.5, color: r.status === 'failed' ? 'error.main' : 'text.secondary' }}>
                      {r.error || '-'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>
      )}
    </ImportDialogShell>
  );
};

export default BulkImportDialog;
