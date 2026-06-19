/**
 * 服务器端文件夹选择器
 * 通过后端 API 浏览文件系统目录
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  List, ListItemButton, ListItemText, ListItemIcon, Typography,
  Box, Breadcrumbs, Link, CircularProgress,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import { browseDirectory, fetchDrives } from '../../services/backupService';

interface FolderPickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  currentPath?: string;
}

const FolderPicker: React.FC<FolderPickerProps> = ({ open, onClose, onSelect, currentPath }) => {
  const [path, setPath] = useState('');
  const [dirs, setDirs] = useState<{ name: string; path: string }[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 盘符列表（"此电脑"模式）
  const [drives, setDrives] = useState<{ name: string; path: string }[]>([]);
  const [showDrives, setShowDrives] = useState(false);

  const loadDir = useCallback(async (dir: string) => {
    setLoading(true);
    setError('');
    setShowDrives(false);
    try {
      const result = await browseDirectory(dir);
      setPath(result.current);
      setDirs(result.dirs);
      setParent(result.parent);
    } catch (err: any) {
      setError(err.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDrives = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await fetchDrives();
      setDrives(result.items);
      setShowDrives(true);
      setPath('');
      setDirs([]);
      setParent(null);
    } catch (err: any) {
      setError(err.message || '加载盘符失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;

    if (currentPath) {
      loadDir(currentPath);
    } else {
      // 首次打开：显示"此电脑"（盘符列表）
      loadDrives();
    }
  }, [open, currentPath, loadDir, loadDrives]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleClickDir = (dirPath: string) => loadDir(dirPath);
  const handleGoParent = () => parent && loadDir(parent);

  // 面包屑路径段
  const pathSegments = path ? path.replace(/\\/g, '/').split('/').filter(Boolean) : [];
  // 检测是否 Windows 路径（盘符格式如 C:）
  const isWindowsPath = /^[A-Z]:$/i.test(pathSegments[0] || '');

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>选择文件夹</DialogTitle>
      <DialogContent dividers sx={{ minHeight: 350 }}>
        {/* 当前路径面包屑 */}
        <Breadcrumbs sx={{ mb: 1.5, fontSize: '0.8rem', flexWrap: 'wrap' }}>
          {showDrives || pathSegments.length === 0 ? (
            <Typography variant="body2" color="text.secondary">此电脑</Typography>
          ) : (
            <>
              <Link
                component="button"
                underline="hover"
                onClick={loadDrives}
                sx={{ fontSize: '0.8rem', cursor: 'pointer' }}
              >
                此电脑
              </Link>
              {pathSegments.map((seg, idx) => {
                const segPath = isWindowsPath
                  ? (idx === 0 ? seg + '\\' : pathSegments.slice(0, idx + 1).join('\\'))
                  : '/' + pathSegments.slice(0, idx + 1).join('/');
                return (
                  <Link
                    key={idx}
                    component="button"
                    underline="hover"
                    onClick={() => loadDir(segPath)}
                    sx={{ fontSize: '0.8rem', cursor: 'pointer' }}
                  >
                    {seg}
                  </Link>
                );
              })}
            </>
          )}
        </Breadcrumbs>

        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
            <CircularProgress size={28} />
          </Box>
        ) : error ? (
          <Typography color="error" sx={{ py: 4, textAlign: 'center' }}>{error}</Typography>
        ) : (
          <List dense sx={{ maxHeight: 300, overflow: 'auto', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
            {showDrives ? (
              // 盘符列表视图（此电脑）
              drives.map((d) => (
                <ListItemButton
                  key={d.path}
                  onClick={() => loadDir(d.path)}
                  sx={{
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <FolderIcon fontSize="small" sx={{ color: '#1976D2' }} />
                  </ListItemIcon>
                  <ListItemText primary={d.name} secondary="本地磁盘" primaryTypographyProps={{ fontSize: '0.85rem' }} secondaryTypographyProps={{ fontSize: '0.7rem' }} />
                </ListItemButton>
              ))
            ) : (
              // 目录浏览视图
              <>
                {/* 返回上级 / 返回此电脑 */}
                <ListItemButton onClick={() => parent ? loadDir(parent) : loadDrives()} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <ArrowUpwardIcon fontSize="small" color="action" />
                  </ListItemIcon>
                  <ListItemText primary={parent ? '..' : '此电脑'} primaryTypographyProps={{ fontSize: '0.85rem' }} />
                </ListItemButton>
                {dirs.map((d) => (
                  <ListItemButton
                    key={d.path}
                    onClick={() => handleClickDir(d.path)}
                    sx={{
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <FolderIcon fontSize="small" sx={{ color: '#FFB300' }} />
                    </ListItemIcon>
                    <ListItemText primary={d.name} primaryTypographyProps={{ fontSize: '0.85rem' }} />
                  </ListItemButton>
                ))}
                {dirs.length === 0 && parent === null && (
                  <Box sx={{ textAlign: 'center', py: 3, color: 'text.secondary' }}>
                    空目录
                  </Box>
                )}
              </>
            )}
          </List>
        )}
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 400 }}>
          {path}
        </Typography>
        <Box>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="contained"
            onClick={() => { onSelect(path); onClose(); }}
            disabled={!path}
          >
            选择此文件夹
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
};

export default FolderPicker;
