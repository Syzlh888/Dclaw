import React, { useState, useRef } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, Typography, Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Alert, LinearProgress, Chip,
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

const COLUMN_MAP: Record<string, string> = {
  '服务器名称': 'name', '内网IP': 'internalIp', '外网IP': 'externalIp',
  '公网IP': 'publicIp', '跨网访问IP': 'crossNetworkIp', '操作系统': 'os',
  'CPU核数': 'cpuCores', '内存(GB)': 'memoryGB', '系统盘(GB)': 'systemDiskGB',
  '数据盘(GB)': 'dataDiskGB', '存储类型': 'storageType', '带宽(Mbps)': 'bandwidthMbps',
  '服务器位置': 'serverLocation', '服务器类型': 'serverType',
  '用户名': 'username', '密码': 'password',
  '堡垒机地址': 'bastionHost', '堡垒机端口': 'bastionPort',
  '堡垒机用户名': 'bastionUsername', '堡垒机密码': 'bastionPassword',
  'VPN信息': 'vpnInfo', 'MAC地址': 'macAddress', '部署内容': 'deployedContent',
  '标签': 'tags', '备注': 'notes',
  '所属项目': 'projectName', '所属工程': 'engineeringName', '所属应用': 'applicationName',
};

const ServerImportDialog: React.FC<Props> = ({ open, onClose }) => {
  const [preview, setPreview] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const loadServers = useServerStore(s => s.loadServers);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const wb = XLSX.read(ev.target?.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (data.length < 2) return setPreview([]);
      const headers = data[0] as string[];
      setColumns(headers);
      const rows = data.slice(1).map((row: any[]) => {
        const obj: any = {};
        headers.forEach((h, i) => {
          const key = COLUMN_MAP[h] || h;
          obj[key] = row[i] !== undefined ? row[i] : '';
        });
        return obj;
      }).filter(r => r.name || r.internalIp);
      setPreview(rows.slice(0, 20));
      setResult(null);
    };
    reader.readAsBinaryString(file);
  };

  const handleImport = async () => {
    if (preview.length === 0) return;
    setImporting(true);
    try {
      const allData = preview.map((r, i) => ({ ...r, row: i + 2 }));
      const res = await importServers(allData);
      setResult(res);
      if (res.success > 0) await loadServers();
    } catch (err: any) {
      setResult({ error: err.message });
    }
    setImporting(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontWeight: 600, fontSize: '1rem' }}>导入服务器资源</DialogTitle>
      <DialogContent>
        <Box sx={{ mb: 2 }}>
          <Alert severity="info" sx={{ mb: 1.5 }}>
            请先下载模板，按模板格式填写数据后导入。每行一条服务器记录。
          </Alert>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" size="small" startIcon={<CloudDownloadIcon />}
              href={getTemplateDownloadUrl()} target="_blank">下载导入模板</Button>
            <Button variant="contained" size="small" startIcon={<FileUploadIcon />}
              onClick={() => fileRef.current?.click()} component="span">选择文件</Button>
          </Box>
          <input type="file" ref={fileRef} hidden accept=".xlsx,.xls" onChange={handleFile} />
        </Box>

        {importing && <LinearProgress sx={{ mb: 1 }} />}

        {result && (
          <Alert severity={result.error ? 'error' : 'success'} sx={{ mb: 1 }}>
            {result.error
              ? `导入失败: ${result.error}`
              : `导入完成: 成功 ${result.success} 条, 失败 ${result.failed} 条 (共 ${result.total} 条)`}
          </Alert>
        )}

        {preview.length > 0 && (
          <Box>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              预览 (前 {Math.min(preview.length, 20)} 条)
              {columns.length > 0 && <Chip label={`${columns.length} 列`} size="small" sx={{ ml: 1 }} />}
            </Typography>
            <TableContainer sx={{ maxHeight: 300 }}>
              <Table size="small" stickyHeader>
                <TableHead><TableRow>
                  {columns.map(c => <TableCell key={c} sx={{ fontWeight: 600, fontSize: '0.7rem', bgcolor: '#f5f5f5' }}>{c}</TableCell>)}
                </TableRow></TableHead>
                <TableBody>
                  {preview.slice(0, 10).map((r, i) => (
                    <TableRow key={i}>
                      {columns.map((c, j) => <TableCell key={j} sx={{ fontSize: '0.75rem' }}>{String(r[COLUMN_MAP[c] || c] || '')}</TableCell>)}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} size="small">关闭</Button>
        {preview.length > 0 && !result && (
          <Button variant="contained" size="small" onClick={handleImport} disabled={importing}>
            确认导入 ({preview.length} 条)
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ServerImportDialog;
