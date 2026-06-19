import React, { useState, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Alert,
  Stack,
  CircularProgress,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import { useDriverStore } from '../../stores/driverStore';
import type { DriverPackage } from '../../types/driver';

interface DriverUploadProps {
  open: boolean;
  onClose: () => void;
  editDriver?: DriverPackage | null;
  onSuccess?: () => void;
}

const DriverUpload: React.FC<DriverUploadProps> = ({ open, onClose, editDriver, onSuccess }) => {
  const addDriver = useDriverStore((s) => s.addDriver);
  const updateDriver = useDriverStore((s) => s.updateDriver);

  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [driverClass, setDriverClass] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEdit = !!editDriver;

  // 当 editDriver 变化时填充/重置表单
  useEffect(() => {
    if (editDriver) {
      setName(editDriver.name);
      setVersion(editDriver.version);
      setDriverClass(editDriver.driverClass);
      setDescription(editDriver.description || '');
      setSelectedFile(null);
      setError(null);
    } else {
      handleReset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editDriver?.id]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const validExtensions = ['.jar', '.zip', '.tar.gz'];
      const fileName = file.name.toLowerCase();
      const isValid = validExtensions.some((ext) => fileName.endsWith(ext));
      if (!isValid) {
        setError('仅支持 .jar / .zip / .tar.gz 文件');
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) {
      const validExtensions = ['.jar', '.zip', '.tar.gz'];
      const fileName = file.name.toLowerCase();
      const isValid = validExtensions.some((ext) => fileName.endsWith(ext));
      if (!isValid) {
        setError('仅支持 .jar / .zip / .tar.gz 文件');
        return;
      }
      setSelectedFile(file);
      setError(null);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleUpload = async () => {
    if (!name.trim() || !version.trim() || !driverClass.trim()) {
      setError('请填写所有必填项');
      return;
    }

    if (isEdit) {
      setUploading(true);
      const ok = await updateDriver(editDriver.id, {
        name: name.trim(),
        version: version.trim(),
        driverClass: driverClass.trim(),
        description: description.trim() || undefined,
      });
      setUploading(false);
      if (ok) {
        handleReset();
        onSuccess?.();
        onClose();
      } else {
        setError('保存失败，请检查后端服务是否正常');
      }
      return;
    }

    if (!selectedFile) {
      setError('请选择驱动文件');
      return;
    }

    setUploading(true);
    const driverData: Omit<DriverPackage, 'id' | 'uploadTime'> = {
      name: name.trim(),
      version: version.trim(),
      driverClass: driverClass.trim(),
      fileName: selectedFile.name,
      fileSize: selectedFile.size,
      dbType: name.trim(),
      description: description.trim() || undefined,
      isBuiltIn: false,
    };

    const resultId = await addDriver(driverData, selectedFile);
    setUploading(false);

    if (resultId) {
      handleReset();
      onSuccess?.();
      onClose();
    } else {
      setError('上传失败，请检查后端服务是否正常');
    }
  };

  const handleReset = () => {
    setName('');
    setVersion('');
    setDriverClass('');
    setDescription('');
    setSelectedFile(null);
    setError(null);
  };

  const handleClose = () => {
    handleReset();
    onClose();
  };

  const isValid = isEdit
    ? name.trim() && version.trim() && driverClass.trim()
    : name.trim() && version.trim() && driverClass.trim() && selectedFile;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth={false} fullWidth PaperProps={{ sx: { maxWidth: 360 } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CloudUploadIcon color="primary" />
        {isEdit ? '编辑驱动' : '上传自定义驱动'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          <TextField
            label="数据库类型"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
            required
            placeholder="如：Oracle、瀚高、MySQL"
          />
          <TextField
            label="版本号"
            value={version}
            onChange={(e) => setVersion(e.target.value)}
            size="small"
            fullWidth
            required
            placeholder="如：19.21.0"
          />
          <TextField
            label="驱动类名"
            value={driverClass}
            onChange={(e) => setDriverClass(e.target.value)}
            size="small"
            fullWidth
            required
            placeholder="如：oracle.jdbc.OracleDriver"
          />
          <TextField
            label="描述"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={2}
            placeholder="可选描述信息"
          />

          {/* 文件上传区域（仅新建时显示） */}
          {!isEdit ? (
            <Box
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onClick={() => fileInputRef.current?.click()}
              sx={{
                border: '2px dashed',
                borderColor: selectedFile ? 'success.main' : 'divider',
                borderRadius: 1,
                p: 2,
                textAlign: 'center',
                cursor: 'pointer',
                bgcolor: selectedFile ? 'success.50' : 'action.hover',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: 'action.selected',
                },
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".jar,.zip,.tar.gz,.tar"
                hidden
                onChange={handleFileSelect}
              />
              {selectedFile ? (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                  <InsertDriveFileIcon color="success" />
                  <Typography variant="body2">
                    {selectedFile.name} ({formatFileSize(selectedFile.size)})
                  </Typography>
                </Box>
              ) : (
                <Box>
                  <CloudUploadIcon sx={{ fontSize: 32, color: 'text.secondary', mb: 0.5 }} />
                  <Typography variant="body2" color="text.secondary">
                    拖拽文件到此处，或点击选择文件
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    支持 .jar / .zip / .tar.gz 格式
                  </Typography>
                </Box>
              )}
            </Box>
          ) : editDriver ? (
            <Box
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                p: 2,
                bgcolor: 'action.hover',
                display: 'flex',
                alignItems: 'center',
                gap: 1,
              }}
            >
              <InsertDriveFileIcon color="action" />
              <Typography variant="body2" color="text.secondary">
                {editDriver.fileName} ({formatFileSize(editDriver.fileSize)})
              </Typography>
              <Typography variant="caption" color="text.disabled" sx={{ ml: 'auto' }}>
                编辑时不可更换文件
              </Typography>
            </Box>
          ) : null}

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} sx={{ textTransform: 'none' }}>
          取消
        </Button>
        <Button
          onClick={handleUpload}
          variant="contained"
          disabled={!isValid || uploading}
          sx={{ textTransform: 'none' }}
        >
          {uploading ? <CircularProgress size={18} sx={{ mr: 0.5 }} color="inherit" /> : null}
          {isEdit ? '保存' : '上传'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default DriverUpload;
