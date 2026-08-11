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
        sx={{ flex: 1, '& .MuiOutlinedInput-root': { fontSize: 'calc(0.75rem * var(--dc-scale, 1))' } }}
        InputProps={{
          startAdornment: <SearchIcon sx={{ mr: 0.5, color: 'text.secondary', fontSize: 'calc(1.125rem * var(--dc-scale, 1))' }} />,
          endAdornment: filter.keyword ? (
            <IconButton size="small" onClick={() => onChange({ keyword: '' })}><ClearIcon sx={{ fontSize: 'calc(1rem * var(--dc-scale, 1))' }} /></IconButton>
          ) : null,
        }}
      />
      {onImport && (
        <Button
          size="small"
          onClick={onImport}
          variant="outlined"
          startIcon={<FileUploadIcon sx={{ fontSize: 'calc(0.875rem * var(--dc-scale, 1))' }} />}
          sx={{ textTransform: 'none', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', py: 0.5, minHeight: 32, whiteSpace: 'nowrap', flexShrink: 0 }}
          title="批量导入服务器资源"
        >
          导入
        </Button>
      )}
    </Box>
  );
};

export default ServerSearchBar;
