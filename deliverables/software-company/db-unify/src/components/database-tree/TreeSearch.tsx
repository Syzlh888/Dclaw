import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, TextField, InputAdornment, IconButton, Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import { useTreeStore } from '../../stores/treeStore';
import BulkImportDialog from '../connection/BulkImportDialog';

/**
 * 数据库树顶部：搜索框 + 批量导入按钮（同一行）
 */
const TreeSearch: React.FC = () => {
  const [value, setValue] = useState('');
  const [importOpen, setImportOpen] = useState(false);
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
    <Box sx={{ p: 1, display: 'flex', gap: 0.5, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
      <TextField
        size="small"
        placeholder="搜索数据库..."
        value={value}
        onChange={handleChange}
        sx={{ flex: 1, '& .MuiOutlinedInput-root': { fontSize: '0.7rem' } }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: '1.125rem', color: 'text.secondary' }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={handleClear}>
                <ClearIcon sx={{ fontSize: '1rem' }} />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
      />
      <Button
        size="small"
        onClick={() => setImportOpen(true)}
        variant="outlined"
        startIcon={<UploadFileIcon sx={{ fontSize: '0.875rem' }} />}
        sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0.5, minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}
        title="从 CSV/JSON 文件批量导入连接"
      >
        导入
      </Button>
      <BulkImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </Box>
  );
};

export default TreeSearch;
