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
      <Box sx={{ px: 0.75, pt: 0.5, pb: 0.25 }}>
        <TextField
          fullWidth
          size="small"
          placeholder="搜索代理连接..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start"><SearchIcon sx={{ fontSize: 'calc(0.82rem * var(--dc-scale, 1))', color: 'text.disabled' }} /></InputAdornment>
            ),
            endAdornment: searchText ? (
              <IconButton size="small" onClick={() => setSearchText('')} sx={{ p: 0.2 }}>
                <CloseIcon sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }} />
              </IconButton>
            ) : null,
          }}
          sx={{
            '& .MuiInputBase-root': { fontSize: 'calc(0.66rem * var(--dc-scale, 1))', bgcolor: 'action.hover', borderRadius: 1 },
            '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
          }}
        />
      </Box>

      <Box sx={{ px: 0.75, pb: 0.25 }}>
        <Button
          fullWidth
          variant="text"
          size="small"
          startIcon={<AddIcon sx={{ fontSize: 'calc(0.82rem * var(--dc-scale, 1))' }} />}
          onClick={onCreate}
          sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', color: 'text.secondary', textTransform: 'none', justifyContent: 'flex-start', '&:hover': { bgcolor: 'action.hover', color: 'primary.main' } }}
        >
          新建代理连接
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {filtered.length === 0 && (
          <Typography sx={{ p: 1.5, color: 'text.disabled', fontSize: 'calc(0.66rem * var(--dc-scale, 1))', textAlign: 'center' }}>
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
                  sx={{ py: 0.1, px: 0.75, minHeight: 20, lineHeight: 1.2 }}
                >
                  <DnsIcon sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))', color: 'primary.main', mr: 0.5 }} />
                  <ListItemText
                    disableTypography
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, lineHeight: 1.2 }}>
                        <Typography sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))', color: 'text.primary', lineHeight: 1.2 }}>{c.name}</Typography>
                        <Chip size="small" label={c.proxy_port} sx={{ height: 14, fontSize: 'calc(0.55rem * var(--dc-scale, 1))', bgcolor: 'action.disabledBackground', color: 'text.secondary' }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3, ml: 'auto' }}>
                          <Tooltip title={`健康：${healthTitle}`}>
                            <Box
                              sx={{
                                width: 5,
                                height: 5,
                                borderRadius: '50%',
                                bgcolor: HEALTH_COLOR[hs],
                                outline: hs === 'fail' ? '1px solid' : 'none',
                                outlineColor: 'error.main',
                              }}
                            />
                          </Tooltip>
                          <Typography sx={{ fontSize: 'calc(0.55rem * var(--dc-scale, 1))', color: STATUS_COLOR[c.status], lineHeight: 1.2 }}>
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

      <Box sx={{ px: 0.75, py: 0.4, borderTop: '1px solid', borderColor: 'divider' }}>
        <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.6rem * var(--dc-scale, 1))' }}>共 {connections.length} 条代理连接</Typography>
      </Box>
    </Box>
  );
};

export default ProxyListPanel;
