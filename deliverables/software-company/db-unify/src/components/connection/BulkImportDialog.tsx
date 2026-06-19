import React, { useState, useRef, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Box, Typography, Chip, IconButton, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Alert, LinearProgress, Stepper, Step, StepLabel,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';
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

interface BulkImportDialogProps {
  open: boolean;
  onClose: () => void;
}

const VALID_DRIVERS = ['mysql', 'postgresql', 'oracle', 'sqlserver', 'custom'];

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- 步骤 1：上传并解析文件 ----
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
          const oldKeys = Object.keys(rawRows[0]);
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

        // 校验驱动类型
        if (item.driver && !VALID_DRIVERS.includes(item.driver.toLowerCase())) {
          errors.push(`驱动类型 "${item.driver}" 无效，支持: ${VALID_DRIVERS.join(', ')}`);
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
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const validCount = parsedRows.filter((r) => r._valid).length;
  const invalidCount = parsedRows.filter((r) => !r._valid).length;

  return (
    <Dialog open={open} onClose={onClose} maxWidth={false} fullWidth PaperProps={{ sx: { maxWidth: 540 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CloudUploadIcon color="primary" />
          批量导入数据库连接
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        {/* 步骤指示 */}
        <Stepper activeStep={activeStep} sx={{ mb: 3 }}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>

        {/* 错误提示 */}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        {/* 步骤 0：上传文件 */}
        {activeStep === 0 && (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <CloudUploadIcon sx={{ fontSize: 48, color: 'action.disabled', mb: 2 }} />
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              支持 .csv、.xlsx、.xls 格式的数据库连接配置文件
            </Typography>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
              <Button
                variant="contained"
                startIcon={<CloudUploadIcon />}
                onClick={() => fileInputRef.current?.click()}
                sx={{ textTransform: 'none' }}
              >
                选择文件
              </Button>
              <Button
                variant="outlined"
                startIcon={<DownloadIcon />}
                onClick={handleDownloadTemplate}
                sx={{ textTransform: 'none' }}
              >
                下载模板
              </Button>
            </Box>

            <Paper variant="outlined" sx={{ mt: 3, p: 1.5, textAlign: 'left', bgcolor: 'grey.50' }}>
              <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                模板说明
              </Typography>
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
                • 必填列：连接名称、驱动类型、主机地址、端口、用户名、密码<br />
                • 可选列：数据库名、Schema、项目、业务模块、区域节点、连接实例名称<br />
                • 层级说明：填写项目→业务模块→区域节点后，若层级不存在将自动创建，并自动关联到左侧树<br />
                • 驱动类型：mysql、postgresql、oracle、sqlserver<br />
                • 端口：1-65535 之间的数字<br />
                • 点击「下载模板」获取带示例的 CSV 文件
              </Typography>
            </Paper>
          </Box>
        )}

        {/* 步骤 1：预览校验 */}
        {activeStep === 1 && parsedRows.length > 0 && (
          <>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Typography variant="body2" color="text.secondary">
                文件：{fileName} | 共 {parsedRows.length} 行
              </Typography>
              <Chip
                icon={<CheckCircleIcon />}
                label={`${validCount} 行通过`}
                size="small"
                color={validCount > 0 ? 'success' : 'default'}
                variant="outlined"
                sx={{ fontSize: '0.7rem' }}
              />
              {invalidCount > 0 && (
                <Chip
                  icon={<ErrorIcon />}
                  label={`${invalidCount} 行失败`}
                  size="small"
                  color="error"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              )}
              <Box sx={{ flex: 1 }} />
              <Tooltip title="重新选择文件">
                <IconButton size="small" onClick={handleReset}>
                  <RefreshIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="删除无效行">
                <IconButton
                  size="small"
                  onClick={() => setParsedRows(parsedRows.filter((r) => r._valid))}
                  disabled={invalidCount === 0}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>

            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
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
                        bgcolor: row._valid ? 'transparent' : 'error.50',
                        '&:hover': { bgcolor: row._valid ? 'action.hover' : 'error.100' },
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
                          <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
                        ) : (
                          <Tooltip title={row._errors.join('；')}>
                            <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
              <Chip
                icon={<CheckCircleIcon />}
                label={`成功 ${importResult.success} 条`}
                color={importResult.success > 0 ? 'success' : 'default'}
                variant="filled"
              />
              <Chip
                icon={<ErrorIcon />}
                label={`失败 ${importResult.failed} 条`}
                color={importResult.failed > 0 ? 'error' : 'default'}
                variant="filled"
              />
            </Box>

            {importResult.failed > 0 && (
              <Alert severity="warning" sx={{ mb: 2, fontSize: '0.8rem' }}>
                部分连接导入失败，请检查以下记录并修正后重新导入
              </Alert>
            )}

            <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
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
                          <Chip label="已创建" size="small" color="success" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                        ) : (
                          <Chip label="失败" size="small" color="error" variant="outlined" sx={{ fontSize: '0.65rem' }} />
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

        {/* 导入中进度 */}
        {importing && <LinearProgress sx={{ mt: 2 }} />}
      </DialogContent>

      <DialogActions>
        {activeStep === 0 && (
          <Button onClick={onClose} sx={{ textTransform: 'none' }}>取消</Button>
        )}
        {activeStep === 1 && (
          <>
            <Button onClick={() => setActiveStep(0)} sx={{ textTransform: 'none' }}>
              返回
            </Button>
            <Button
              variant="contained"
              onClick={handleImport}
              disabled={validCount === 0 || importing}
              sx={{ textTransform: 'none' }}
            >
              {importing ? '导入中...' : `导入 ${validCount} 条`}
            </Button>
          </>
        )}
        {activeStep === 2 && (
          <>
            <Button onClick={handleReset} sx={{ textTransform: 'none' }} startIcon={<RefreshIcon />}>
              重新导入
            </Button>
            <Button variant="contained" onClick={onClose} sx={{ textTransform: 'none' }}>
              完成
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default BulkImportDialog;
