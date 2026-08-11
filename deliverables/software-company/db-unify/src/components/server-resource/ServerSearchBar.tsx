import React from 'react';
import { Box, TextField, IconButton, Button } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import type { ServerSearchFilter } from '../../types/server';

interface Props {
  filter: ServerSearchFilter;
  onChange: (filter: Partial<ServerSearchFilter>) => void;
  onImport?: () => void;
}

const ServerSearchBar: React.FC<Props> = ({ filter, onChange, onImport }) => {
  return (
    <Box sx={{ px: 1, py: 1, display: 'flex', gap: 0.5, alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider' }}>
      <TextField
        size="small"
        placeholder="搜索名称/IP/OS..."
        value={filter.keyword || ''}
        onChange={e => onChange({ keyword: e.target.value })}
        sx={{ flex: 1, '& .MuiOutlinedInput-root': { fontSize: '0.75rem' } }}
        InputProps={{
          startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: '1.125rem' }} />,
          endAdornment: filter.keyword ? (
            <IconButton size="small" onClick={() => onChange({ keyword: '' })}><ClearIcon sx={{ fontSize: '1rem' }} /></IconButton>
          ) : null,
        }}
      />
      {onImport && (
        <Button
          size="small"
          onClick={onImport}
          variant="outlined"
          startIcon={<FileUploadIcon sx={{ fontSize: '0.875rem' }} />}
          sx={{ textTransform: 'none', fontSize: '0.7rem', py: 0.5, minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}
          title="批量导入服务器资源"
        >
          导入
        </Button>
      )}
    </Box>
  );
};

export default ServerSearchBar;
