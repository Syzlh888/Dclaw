import React, { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, CircularProgress, Collapse, List, ListItemButton,
  ListItemText, IconButton, Tooltip, Chip, Snackbar, Alert,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import TableChartIcon from '@mui/icons-material/TableChart';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import RefreshIcon from '@mui/icons-material/Refresh';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { fetchMetadata, generateSelectSql } from '../../services/metadataService';
import type { TableMeta, ColumnMeta } from '../../services/metadataService';
import { useEditorStore } from '../../stores/editorStore';
import type { DbConnection } from '../../types/connection';

interface MetadataBrowserProps {
  connection: DbConnection;
}

const MetadataBrowser: React.FC<MetadataBrowserProps> = ({ connection }) => {
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedTables, setExpandedTables] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState(false);
  const [snackbar, setSnackbar] = useState(false);
  const setSql = useEditorStore(s => s.setSql);

  const loadMetadata = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchMetadata(connection.id);
      setTables(data);
      setLoaded(true);
    } catch (err: any) {
      setError(err.message || '加载元数据失败');
    } finally {
      setLoading(false);
    }
  }, [connection.id]);

  useEffect(() => {
    loadMetadata();
  }, [loadMetadata]);

  const toggleTable = (tableName: string) => {
    setExpandedTables(prev => {
      const next = new Set(prev);
      if (next.has(tableName)) next.delete(tableName);
      else next.add(tableName);
      return next;
    });
  };

  const handleInsertSelect = (table: TableMeta) => {
    const sql = generateSelectSql(table.name, table.columns);
    setSql(sql);
    setSnackbar(true);
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, px: 5 }}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">加载表结构...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ py: 1, px: 5 }}>
        <Tooltip title="重试">
          <IconButton size="small" onClick={loadMetadata} sx={{ ml: 0.5 }}>
            <RefreshIcon sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }

  if (!loaded) return null;

  if (tables.length === 0) {
    return (
      <Box sx={{ py: 1, px: 5 }}>
      </Box>
    );
  }

  return (
    <Box sx={{ pl: 6.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 500 }}>
          表结构 ({tables.length} 张表)
        </Typography>
        <Tooltip title="刷新">
          <IconButton size="small" onClick={loadMetadata} sx={{ p: 0 }}>
            <RefreshIcon sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <List dense disablePadding>
        {tables.map(table => {
          const isExpanded = expandedTables.has(table.name);
          return (
            <Box key={table.name}>
              <ListItemButton
                onClick={() => toggleTable(table.name)}
                sx={{ py: 0.25, pl: 2, '&:hover': { bgcolor: 'action.hover' } }}
              >
                {isExpanded ? (
                  <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} />
                ) : (
                  <ChevronRightIcon sx={{ fontSize: 16, color: 'text.secondary', mr: 0.5 }} />
                )}
                <TableChartIcon sx={{ fontSize: 14, color: 'primary.light', mr: 0.5 }} />
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                      <Typography variant="caption" sx={{ fontSize: '0.62rem', fontWeight: 500 }}>
                        {table.name}
                      </Typography>
                      {table.rows > 0 && (
                        <Chip
                          label={`${table.rows.toLocaleString()} 行`}
                          size="small"
                          sx={{ fontSize: '0.55rem', height: 16 }}
                        />
                      )}
                    </Box>
                  }
                  primaryTypographyProps={{ fontSize: '0.62rem' }}
                />
                <Tooltip title="生成 SELECT 语句">
                  <IconButton
                    size="small"
                    onClick={(e) => { e.stopPropagation(); handleInsertSelect(table); }}
                    sx={{ p: 0 }}
                  >
                    <ContentCopyIcon sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
              <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                <Box sx={{ pl: 3.5, pr: 1, py: 0.5 }}>
                  {table.columns.map(col => (
                    <Box
                      key={col.name}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.75,
                        py: 0.15,
                        px: 0.5,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        '&:last-child': { borderBottom: 'none' },
                      }}
                    >
                      <ViewColumnIcon sx={{ fontSize: 12, color: 'text.disabled' }} />
                      <Typography variant="caption" sx={{ fontSize: '0.6rem', fontWeight: 500, minWidth: 80, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {col.name}
                      </Typography>
                      <Typography variant="caption" sx={{ fontSize: '0.58rem', color: 'text.secondary', minWidth: 60 }}>
                        {col.type}
                      </Typography>
                      {!col.nullable && (
                        <Chip label="NOT NULL" size="small" color="warning" variant="outlined" sx={{ fontSize: '0.5rem', height: 14 }} />
                      )}
                      {col.comment && (
                        <Typography variant="caption" sx={{ fontSize: '0.58rem', color: 'text.disabled', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {col.comment}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              </Collapse>
            </Box>
          );
        })}
      </List>
      <Snackbar
        open={snackbar}
        autoHideDuration={2000}
        onClose={() => setSnackbar(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%', fontSize: '0.8rem' }}>
          已生成 SELECT 语句
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default MetadataBrowser;
