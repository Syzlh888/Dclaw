import React, { useCallback, useState } from 'react';
import { Box, Typography, Button, Paper } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DownloadIcon from '@mui/icons-material/Download';

/**
 * 批量导入的拖拽上传区（虚线边框 + hover 高亮 + 大图标 + 提示 + 主/次按钮）
 * ------------------------------------------------------------------
 * DBeaver 风格：紧凑、专业，虚线区域即拖即传，中央图标 + 说明文字 + 双按钮。
 */
export interface ImportDropzoneProps {
  /** 文件扩展名列表，如 ['.csv', '.xlsx', '.xls'] */
  accept: string[];
  /** 主提示文字，如 "支持 .csv、.xlsx、.xls 格式的服务器资源模板" */
  hint: string;
  /** 「选择文件」按钮文字 */
  selectLabel?: string;
  /** 「下载模板」按钮文字，不传则不显示下载按钮 */
  downloadLabel?: string;
  /** 是否禁用下载按钮（下载中） */
  downloading?: boolean;
  /** 选中文件回调 */
  onFileSelected: (file: File) => void;
  /** 下载模板回调 */
  onDownloadTemplate?: () => void;
  /** 模板说明区（可选） —— 显示在下方浅色 Paper 里 */
  templateInfo?: React.ReactNode;
}

const ImportDropzone: React.FC<ImportDropzoneProps> = ({
  accept, hint, selectLabel = '选择文件', downloadLabel,
  downloading, onFileSelected, onDownloadTemplate, templateInfo,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onFileSelected(f);
    // 清空以便同名文件可再次触发 change
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [onFileSelected]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFileSelected(f);
  }, [onFileSelected]);

  return (
    <Box>
      {/* 虚线拖拽区 */}
      <Box
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        sx={{
          textAlign: 'center',
          py: 5, px: 3,
          border: '1.5px dashed',
          borderColor: dragOver ? 'primary.main' : 'divider',
          borderRadius: 1,
          bgcolor: dragOver ? 'action.hover' : 'transparent',
          cursor: 'pointer',
          transition: 'all 0.15s ease-in-out',
          '&:hover': {
            borderColor: 'primary.main',
            bgcolor: 'action.hover',
          },
        }}
      >
        <CloudUploadIcon
          sx={{
            fontSize: '2.75rem',
            color: dragOver ? 'primary.main' : 'action.disabled',
            mb: 1.5,
          }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5, fontSize: '0.85rem' }}>
          点击选择文件，或拖拽文件到此处
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 2, display: 'block', fontSize: '0.75rem' }}>
          {hint}
        </Typography>

        <Box
          sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="contained"
            size="small"
            startIcon={<CloudUploadIcon sx={{ fontSize: '1rem' }} />}
            onClick={() => fileInputRef.current?.click()}
            sx={{ textTransform: 'none', fontSize: '0.8rem', py: 0.5 }}
          >
            {selectLabel}
          </Button>
          {downloadLabel && onDownloadTemplate && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<DownloadIcon sx={{ fontSize: '1rem' }} />}
              onClick={onDownloadTemplate}
              disabled={downloading}
              sx={{ textTransform: 'none', fontSize: '0.8rem', py: 0.5 }}
            >
              {downloading ? '下载中...' : downloadLabel}
            </Button>
          )}
        </Box>
      </Box>

      <input
        ref={fileInputRef}
        type="file"
        accept={accept.join(',')}
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* 模板说明 */}
      {templateInfo && (
        <Paper
          variant="outlined"
          sx={{ mt: 2, p: 1.5, bgcolor: 'background.default' }}
        >
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontWeight: 600, display: 'block', mb: 0.5, fontSize: '0.75rem' }}
          >
            模板说明
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ fontSize: '0.75rem', lineHeight: 1.7 }}
          >
            {templateInfo}
          </Typography>
        </Paper>
      )}
    </Box>
  );
};

export default ImportDropzone;
