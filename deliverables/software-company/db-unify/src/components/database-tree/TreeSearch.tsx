import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Box, TextField, InputAdornment, IconButton } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useTreeStore } from '../../stores/treeStore';

const TreeSearch: React.FC = () => {
  const [value, setValue] = useState('');
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
    <Box sx={{ p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
      <TextField
        size="small"
        placeholder="搜索数据库..."
        value={value}
        onChange={handleChange}
        fullWidth
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
            </InputAdornment>
          ),
          endAdornment: value ? (
            <InputAdornment position="end">
              <IconButton size="small" onClick={handleClear}>
                <ClearIcon sx={{ fontSize: 16 }} />
              </IconButton>
            </InputAdornment>
          ) : null,
        }}
        sx={{ '& .MuiOutlinedInput-root': { fontSize: '0.7rem' } }}
      />
    </Box>
  );
};

export default TreeSearch;
