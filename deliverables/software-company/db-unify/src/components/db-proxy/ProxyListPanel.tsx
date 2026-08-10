import React, { useState } from 'react';
import {
  Box, Button, List, ListItem, ListItemButton, ListItemText, Typography,
  IconButton, TextField, InputAdornment, Chip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import DnsIcon from '@mui/icons-material/Dns';
import { useProxyStore } from '../../stores/proxyStore';

interface Props {
  onCreate: () => void;
  onEdit: (id: string) => void;
}

const ProxyListPanel: React.FC<Props> = ({ onCreate, onEdit }) => {
  const { connections, selectedId, selectConnection } = useProxyStore();
  const [searchText, setSearchText] = useState('');

  const filtered = connections.filter((c) => c.name.toLowerCase().includes(searchText.toLowerCase()));

  const statusColor = (s: string) => (s === 'active' ? 'success.main' : s === 'revoked' ? 'error.main' : 'warning.main');

  return (
    <Box sx={{ width: 260, display: 'flex', flexDirection: 'column', borderRight: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
      <Box sx={{ px: 1, pt: 1, pb: 0.5 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="搜索代理连接..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 14, color: 'text.disabled' }} /></InputAdornment>
            ),
            endAdornment: searchText ? (
              <IconButton size="small" onClick={() => setSearchText('')} sx={{ p: 0.2 }}>
                <CloseIcon sx={{ fontSize: 12 }} />
              </IconButton>
            ) : null,
          }}
          sx={{
            '& .MuiInputBase-root': { fontSize: '0.7rem', bgcolor: 'action.hover', borderRadius: 1 },
            '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
          }}
        />
      </Box>

      <Box sx={{ px: 1, pb: 0.5 }}>
        <Button
          fullWidth
          variant="text"
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 14 }} />}
          onClick={onCreate}
          sx={{ fontSize: '0.75rem', color: 'text.secondary', textTransform: 'none', justifyContent: 'flex-start', '&:hover': { bgcolor: 'action.hover', color: 'primary.main' } }}
        >
          新建代理连接
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 && (
          <Typography sx={{ p: 2, color: 'text.disabled', fontSize: '0.7rem', textAlign: 'center' }}>
            暂无代理连接
          </Typography>
        )}
        <List dense disablePadding>
          {filtered.map((c) => (
            <ListItem
              key={c.id}
              disablePadding
              sx={{ bgcolor: selectedId === c.id ? 'action.selected' : 'transparent' }}
            >
              <ListItemButton onClick={() => selectConnection(c.id)} sx={{ py: 0.5, px: 1 }}>
                <DnsIcon sx={{ fontSize: 14, color: 'primary.main', mr: 0.75 }} />
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Typography sx={{ fontSize: '0.75rem', color: 'text.primary' }}>{c.name}</Typography>
                      <Chip size="small" label={c.proxy_port} sx={{ height: 16, fontSize: '0.6rem', bgcolor: 'action.disabledBackground', color: 'text.secondary' }} />
                      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: statusColor(c.status) }} />
                    </Box>
                  }
                />
              </ListItemButton>
            </ListItem>
          ))}
        </List>
      </Box>

      <Box sx={{ px: 1, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>共 {connections.length} 条代理连接</Typography>
      </Box>
    </Box>
  );
};

export default ProxyListPanel;
