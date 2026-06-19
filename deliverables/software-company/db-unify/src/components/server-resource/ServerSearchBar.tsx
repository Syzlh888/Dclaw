import React from 'react';
import { Box, TextField, IconButton } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import type { ServerSearchFilter } from '../../types/server';

interface Props {
  filter: ServerSearchFilter;
  onChange: (filter: Partial<ServerSearchFilter>) => void;
}

const ServerSearchBar: React.FC<Props> = ({ filter, onChange }) => {
  return (
    <Box sx={{ px: 2, py: 1.5 }}>
      <TextField
        size="small"
        placeholder="搜索名称/IP/OS..."
        value={filter.keyword || ''}
        onChange={e => onChange({ keyword: e.target.value })}
        sx={{ minWidth: 200 }}
        InputProps={{
          startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 18 }} />,
          endAdornment: filter.keyword ? (
            <IconButton size="small" onClick={() => onChange({ keyword: '' })}><ClearIcon sx={{ fontSize: 16 }} /></IconButton>
          ) : null,
        }}
      />
    </Box>
  );
};

export default ServerSearchBar;
