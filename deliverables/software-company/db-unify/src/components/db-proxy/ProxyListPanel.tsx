import React, { useEffect, useState } from 'react';
import {
  Box, Button, List, ListItem, ListItemButton, ListItemText, Typography,
  IconButton, TextField, InputAdornment, Chip, Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import DnsIcon from '@mui/icons-material/Dns';
import { useProxyStore } from '../../stores/proxyStore';
import type { HealthStatus, ProxyStatus } from '../../types/proxy';

interface Props {
  onCreate: () => void;
  onEdit: (id: string) => void;
}

const STATUS_COLOR: Record<ProxyStatus, string> = {
  active: 'success.main',
  revoked: 'error.main',
  expired: 'warning.main',
};

const STATUS_TEXT: Record<ProxyStatus, string> = {
  active: '运行中',
  revoked: '已撤销',
  expired: '已过期',
};

const HEALTH_COLOR: Record<HealthStatus, string> = {
  ok: 'success.main',
  fail: 'error.main',
  unknown: 'text.disabled',
};

const HEALTH_TEXT: Record<HealthStatus, string> = {
  ok: '健康',
  fail: '异常',
  unknown: '未检查',
};

const ProxyListPanel: React.FC<Props> = ({ onCreate, onEdit }) => {
  const { connections, selectedId, selectConnection, healthMap, loadHealthAll } = useProxyStore();
  const [searchText, setSearchText] = useState('');

  useEffect(() => {
    loadHealthAll();
    const iv = setInterval(loadHealthAll, 30000);
    return () => clearInterval(iv);
  }, [loadHealthAll]);

  const filtered = connections.filter((c) => c.name.toLowerCase().includes(searchText.toLowerCase()));

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
          {filtered.map((c) => {
            const hs: HealthStatus = (healthMap[c.id]?.health_status as HealthStatus) || 'unknown';
            const lastCheck = healthMap[c.id]?.last_health_check_at;
            const err = healthMap[c.id]?.last_error;
            const healthTitle = err
              ? `${HEALTH_TEXT[hs]}（${err}）`
              : (lastCheck ? `${HEALTH_TEXT[hs]}（${new Date(lastCheck).toLocaleTimeString('zh-CN')}）` : HEALTH_TEXT[hs]);
            return (
              <ListItem
                key={c.id}
                disablePadding
                sx={{ bgcolor: selectedId === c.id ? 'action.selected' : 'transparent' }}
              >
                <ListItemButton
                  onClick={() => selectConnection(c.id)}
                  sx={{ py: 0.15, px: 1, minHeight: 22, lineHeight: 1.2 }}
                >
                  <DnsIcon sx={{ fontSize: 13, color: 'primary.main', mr: 0.75 }} />
                  <ListItemText
                    disableTypography
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, lineHeight: 1.2 }}>
                        <Typography sx={{ fontSize: '0.75rem', color: 'text.primary', lineHeight: 1.2 }}>{c.name}</Typography>
                        <Chip size="small" label={c.proxy_port} sx={{ height: 15, fontSize: '0.6rem', bgcolor: 'action.disabledBackground', color: 'text.secondary' }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, ml: 'auto' }}>
                          <Tooltip title={`健康：${healthTitle}`}>
                            <Box
                              sx={{
                                width: 6,
                                height: 6,
                                borderRadius: '50%',
                                bgcolor: HEALTH_COLOR[hs],
                                outline: hs === 'fail' ? '1px solid' : 'none',
                                outlineColor: 'error.main',
                              }}
                            />
                          </Tooltip>
                          <Typography sx={{ fontSize: '0.6rem', color: STATUS_COLOR[c.status], lineHeight: 1.2 }}>
                            {STATUS_TEXT[c.status]}
                          </Typography>
                        </Box>
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Box>

      <Box sx={{ px: 1, py: 0.5, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ color: 'text.disabled', fontSize: '0.65rem' }}>共 {connections.length} 条代理连接</Typography>
      </Box>
    </Box>
  );
};

export default ProxyListPanel;
