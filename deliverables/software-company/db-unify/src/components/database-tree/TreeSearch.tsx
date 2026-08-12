import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, TextField, InputAdornment, IconButton, Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import HealthAndSafetyIcon from '@mui/icons-material/HealthAndSafety';
import { useTreeStore } from '../../stores/treeStore';
import BulkImportDialog from '../connection/BulkImportDialog';
import DbInspectionDialog from './DbInspectionDialog';

/**
 * 数据库树顶部：搜索框 + 批量导入按钮 + 数据库巡检按钮（同一行）
 */
const TreeSearch: React.FC = () => {
  const [value, setValue] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const search = useTreeStore((s) => s.search);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value;
      setValue(val);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        search(val);
      }, 300);
    },
    [search]
  );

  const handleClear = useCallback(() => {
    setValue('');
    search('');
  }, [search]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <Box sx={{ p: 0.5, display: 'flex', gap: 0.5, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
      <TextField
        size="small"
        placeholder="搜索数据库..."
        value={value}
        onChange={handleChange}
        sx={{ flex: 1, '& .MuiOutlinedInput-root': { fontSize: 'calc(0.68rem * var(--dc-scale, 1))' } }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 'calc(0.95rem * var(--dc-scale, 1))', color: 'text.secondary' }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={handleClear}>
                <ClearIcon sx={{ fontSize: 'calc(0.9rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
      />
      <Button
        size="small"
        onClick={() => setImportOpen(true)}
        variant="outlined"
        startIcon={<UploadFileIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />}
        sx={{ textTransform: 'none', fontSize: 'calc(0.68rem * var(--dc-scale, 1))', py: 0.25, minHeight: 26, whiteSpace: 'nowrap', flexShrink: 0 }}
        title="从 CSV/JSON 文件批量导入连接"
      >
        导入
      </Button>
      <Button
        size="small"
        onClick={() => setInspectionOpen(true)}
        variant="outlined"
        startIcon={<HealthAndSafetyIcon sx={{ fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }} />}
        sx={{ textTransform: 'none', fontSize: 'calc(0.68rem * var(--dc-scale, 1))', py: 0.25, minHeight: 26, whiteSpace: 'nowrap', flexShrink: 0 }}
        title="并发巡检所有数据库连接，列出连接不通的数据库"
      >
        巡检
      </Button>
      <BulkImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <DbInspectionDialog open={inspectionOpen} onClose={() => setInspectionOpen(false)} />
    </Box>
  );
};

export default TreeSearch;
