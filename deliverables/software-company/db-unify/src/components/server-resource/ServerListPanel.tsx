import React, { useMemo, useState } from 'react';
import {
  Box, List, ListItemButton, ListItemText, Typography, Button, Chip, Pagination,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import StorageIcon from '@mui/icons-material/Storage';
import { useServerStore } from '../../stores/serverStore';
import ServerSearchBar from './ServerSearchBar';
import { getTemplateDownloadUrl } from '../../services/serverService';

interface Props {
  onAdd: () => void;
  onImport: () => void;
}

const PAGE_SIZE = 50;

const ServerListPanel: React.FC<Props> = ({ onAdd, onImport }) => {
  const searchFilter = useServerStore(s => s.searchFilter);
  const setSearchFilter = useServerStore(s => s.setSearchFilter);
  const selectedId = useServerStore(s => s.selectedId);
  const selectServer = useServerStore(s => s.selectServer);
  const [page, setPage] = useState(1);

  const filtered = useServerStore(s => s.getFilteredServers());
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paged = useMemo(() => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filtered, page]);

  // Reset page when filter changes
  useMemo(() => { setPage(1); }, [JSON.stringify(searchFilter)]);

  return (
    <Box sx={{ width: 320, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', bgcolor: '#FAFAFA' }}>
      <ServerSearchBar filter={searchFilter} onChange={setSearchFilter} />

      <Box sx={{ px: 2, py: 1, display: 'flex', gap: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={onAdd} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
          新建
        </Button>
        <Button size="small" variant="outlined" startIcon={<FileUploadIcon />} onClick={onImport} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
          导入
        </Button>
        <Button size="small" variant="outlined" startIcon={<FileDownloadIcon />}
          href={getTemplateDownloadUrl()} target="_blank" sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
          模板
        </Button>
      </Box>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {paged.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {filtered.length === 0 ? '暂无服务器记录' : '无匹配结果'}
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {paged.map(s => (
              <ListItemButton
                key={s.id}
                selected={selectedId === s.id}
                onClick={() => selectServer(s.id)}
                sx={{
                  px: 2, py: 1,
                  '&.Mui-selected': { bgcolor: 'primary.lighter', borderRight: '3px solid', borderColor: 'primary.main' },
                }}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <StorageIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                      <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem' }}>{s.name}</Typography>
                    </Box>
                  }
                  secondaryTypographyProps={{ component: 'div' }}
                  secondary={
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.3, mt: 0.3 }}>
                      {s.ips && Array.isArray(s.ips) && s.ips.length > 0
                        ? s.ips.map((ip: any, i: number) => (
                            <Typography key={i} variant="caption" color="text.secondary">
                              {ip.type} · {ip.ip}{ip.port ? `:${ip.port}` : ''}
                            </Typography>
                          ))
                        : <Typography variant="caption" color="text.secondary">{s.internalIp}</Typography>
                      }
                      {s.serverType && <Chip label={s.serverType} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />}
                    </Box>
                  }
                />
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>

      {pages > 1 && (
        <Box sx={{ p: 1, display: 'flex', justifyContent: 'center', borderTop: '1px solid', borderColor: 'divider' }}>
          <Pagination size="small" count={pages} page={page} onChange={(_, v) => setPage(v)} />
        </Box>
      )}
    </Box>
  );
};

export default ServerListPanel;
