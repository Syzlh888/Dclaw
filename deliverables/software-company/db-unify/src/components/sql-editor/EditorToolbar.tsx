import React, { useState, useMemo, useEffect } from 'react';
import {
  Box, Button, FormControlLabel, FormControl, InputLabel, Switch, Typography, Chip,
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, List, ListItem, ListItemText, IconButton,
  Tooltip, Snackbar, Alert, Select, MenuItem,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import CloseIcon from '@mui/icons-material/Close';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import SaveIcon from '@mui/icons-material/Save';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteIcon from '@mui/icons-material/Delete';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useEditorStore } from '../../stores/editorStore';
import type { EditorTheme } from '../../stores/editorStore';
import { format } from 'sql-formatter';
import { useTreeStore } from '../../stores/treeStore';
import { useGroupStore } from '../../stores/groupStore';
import { fetchScripts, saveScript, deleteScript, fetchScript } from '../../services/scriptsService';
import type { SqlScript, ScriptCategory } from '../../types/script';
import { SCRIPT_CATEGORIES } from '../../types/script';
import TemplatesDialog from './TemplatesDialog';
import { detectSqlParams } from '../../utils/sqlUtils';
import ParamsDialog from './ParamsDialog';

const themeOptions: { value: EditorTheme; color: string; label: string }[] = [
  { value: 'vs-dark', color: '#1E1E1E', label: '暗色' },
  { value: 'vs', color: '#F0F0F0', label: '亮色' },
  { value: 'hc-black', color: '#000000', label: '高对比暗' },
  { value: 'hc-light', color: '#FFFFFF', label: '高对比亮' },
];
const themeColors: Record<EditorTheme, { color: string; label: string }> = Object.fromEntries(
  themeOptions.map((t) => [t.value, { color: t.color, label: t.label }])
) as Record<EditorTheme, { color: string; label: string }>;

interface EditorToolbarProps {
  onExecute: () => void;
  onStop: () => void;
  isExecuting: boolean;
}

const EditorToolbar: React.FC<EditorToolbarProps> = ({ onExecute, onStop, isExecuting }) => {
  const sql = useEditorStore((s) => s.sql);
  const setSql = useEditorStore((s) => s.setSql);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const addTab = useEditorStore((s) => s.addTab);
  const removeTab = useEditorStore((s) => s.removeTab);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const renameTab = useEditorStore((s) => s.renameTab);
  const readOnlyMode = useEditorStore((s) => s.readOnlyMode);
  const toggleReadOnly = useEditorStore((s) => s.toggleReadOnly);
  const editorTheme = useEditorStore((s) => s.editorTheme);
  const setEditorTheme = useEditorStore((s) => s.setEditorTheme);
  const fontSize = useEditorStore((s) => s.fontSize);
  const setFontSize = useEditorStore((s) => s.setFontSize);
  const treeSelectedDbIds = useTreeStore((s) => s.selectedDbIds);
  const nodes = useTreeStore((s) => s.nodes);
  const activeGroupId = useGroupStore((s) => s.activeGroupId);
  const activeGroup = useGroupStore((s) => activeGroupId ? s.groups.find(g => g.id === activeGroupId) : null);
  const getActiveDbIds = useGroupStore((s) => s.getActiveDbIds);

  // 根据是否有激活的分组，决定生效的数据库ID
  const isGroupMode = !!activeGroupId;
  const effectiveDbIds = useMemo(() => {
    return isGroupMode ? getActiveDbIds() : treeSelectedDbIds;
  }, [isGroupMode, treeSelectedDbIds, activeGroupId, getActiveDbIds]);

  // 构建已选数据库的展示信息（连接实例名 + 业务模块）
  const selectedDbInfo = useMemo(() => {
    return Object.values(nodes)
      .filter((n) => n.type === 'hospital' && n.dbConnectionId && effectiveDbIds.includes(n.dbConnectionId))
      .map((h) => {
        let current = h;
        let predbName = '';
        while (current.parentId) {
          const parent = nodes[current.parentId];
          if (!parent) break;
          if (parent.type === 'predb_type') {
            predbName = parent.name;
            break;
          }
          current = parent;
        }
        return { hospitalName: h.name, predbName };
      });
  }, [nodes, effectiveDbIds]);

  // 执行确认对话框
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);

  // 参数化查询对话框
  const [paramsDialogOpen, setParamsDialogOpen] = useState(false);
  const [pendingParams, setPendingParams] = useState<string[]>([]);

  // 点击执行按钮：先检查参数，再检查非只读模式
  const handleExecuteClick = () => {
    const params = detectSqlParams(sql);
    if (params.length > 0) {
      setPendingParams(params);
      setParamsDialogOpen(true);
      return;
    }
    if (!readOnlyMode && selectedDbInfo.length > 0) {
      setConfirmDialogOpen(true);
    } else {
      onExecute();
    }
  };

  // 参数确认
  const handleParamsConfirm = (values: Record<string, string>) => {
    let newSql = sql;
    Object.entries(values).forEach(([key, val]) => {
      newSql = newSql.replaceAll(`:${key}`, val);
    });
    setSql(newSql);
    setParamsDialogOpen(false);
    // 继续执行流程
    if (!readOnlyMode && selectedDbInfo.length > 0) {
      setConfirmDialogOpen(true);
    } else {
      onExecute();
    }
  };

  // 确认执行
  const handleExecuteConfirm = () => {
    setConfirmDialogOpen(false);
    onExecute();
  };

  // 双击标签名重命名
  const handleTabDoubleClick = (tabId: string, currentName: string) => {
    const newName = window.prompt('重命名标签：', currentName);
    if (newName && newName.trim()) {
      renameTab(tabId, newName.trim());
    }
  };

  // 脚本列表对话框
  const [openDialog, setOpenDialog] = useState(false);
  const [scripts, setScripts] = useState<SqlScript[]>([]);
  const [loading, setLoading] = useState(false);
  const [scriptFilterCat, setScriptFilterCat] = useState<ScriptCategory>('');

  // 保存对话框
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [saveCategory, setSaveCategory] = useState<ScriptCategory>('');

  // 模板对话框
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);

  // 提示消息
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const showMessage = (message: string, severity: 'success' | 'error' = 'success') => {
    setSnackbar({ open: true, message, severity });
  };

  // 监听全局快捷键事件
  useEffect(() => {
    const onSave = () => { if (sql.trim()) handleSaveClick(); };
    const onOpen = () => handleOpenClick();
    const onFormat = () => { if (sql.trim()) handleFormatSql(); };
    window.addEventListener('dc:save-script', onSave);
    window.addEventListener('dc:open-scripts', onOpen);
    window.addEventListener('dc:format-sql', onFormat);
    return () => {
      window.removeEventListener('dc:save-script', onSave);
      window.removeEventListener('dc:open-scripts', onOpen);
      window.removeEventListener('dc:format-sql', onFormat);
    };
  }, [sql]);

  // 打开脚本列表
  const handleOpenClick = async () => {
    setOpenDialog(true);
    setLoading(true);
    try {
      const list = await fetchScripts();
      setScripts(list);
    } catch (err: any) {
      showMessage(err.message || '获取脚本列表失败', 'error');
    } finally {
      setLoading(false);
    }
  };

  // 加载脚本到编辑器
  const handleLoadScript = async (script: SqlScript) => {
    try {
      const full = await fetchScript(script.id);
      setSql(full.sql_text);
      showMessage(`已加载脚本: ${script.name}`);
      setOpenDialog(false);
    } catch (err: any) {
      showMessage(err.message || '加载脚本失败', 'error');
    }
  };

  // 删除脚本
  const handleDeleteScript = async (id: string, name: string) => {
    if (!window.confirm(`确定删除脚本「${name}」吗？`)) return;
    try {
      await deleteScript(id);
      showMessage('删除成功');
      const list = await fetchScripts();
      setScripts(list);
    } catch (err: any) {
      showMessage(err.message || '删除失败', 'error');
    }
  };

  // 打开保存对话框
  const handleSaveClick = () => {
    setSaveName(`脚本_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '-')}`);
    setSaveDesc('');
    setSaveCategory('');
    setSaveDialogOpen(true);
  };

  // 确认保存
  const handleSaveConfirm = async () => {
    if (!saveName.trim()) return;
    try {
      await saveScript({
        name: saveName.trim(),
        description: saveDesc,
        category: saveCategory || undefined,
        sql_text: sql,
      } as any);
      showMessage('保存成功');
      setSaveDialogOpen(false);
    } catch (err: any) {
      showMessage(err.message || '保存失败', 'error');
    }
  };

  // SQL 格式化
  const handleFormatSql = () => {
    try {
      const formatted = format(sql, { language: 'mysql', tabWidth: 2 });
      setSql(formatted);
    } catch { /* ignore format errors */ }
  };

  return (
    <Box>
      {/* SQL Tab Bar */}
      <Box
        sx={{
          display: 'flex',
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          overflow: 'auto',
          '&::-webkit-scrollbar': { height: 4 },
          '&::-webkit-scrollbar-thumb': { backgroundColor: '#ccc', borderRadius: 2 },
        }}
      >
        {tabs.map((tab) => (
          <Box
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            onDoubleClick={() => handleTabDoubleClick(tab.id, tab.name)}
            sx={{
              px: 1.5,
              py: 0.5,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              borderBottom: tab.id === activeTabId ? '2px solid' : '2px solid transparent',
              borderColor: tab.id === activeTabId ? 'primary.main' : 'transparent',
              color: tab.id === activeTabId ? 'primary.main' : 'text.secondary',
              fontSize: '0.8rem',
              maxWidth: 150,
              whiteSpace: 'nowrap',
              '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography variant="caption" noWrap sx={{ maxWidth: 100 }}>{tab.name}</Typography>
            {tabs.length > 1 && (
              <IconButton
                size="small"
                onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                sx={{ p: 0 }}
              >
                <CloseIcon sx={{ fontSize: 12 }} />
              </IconButton>
            )}
          </Box>
        ))}
        <IconButton size="small" onClick={addTab} sx={{ borderRadius: 0 }}>
          <AddIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Box>

      {/* Original Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          py: 0.75,
          px: 1,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: '#FAFAFA',
        }}
      >
        <Button
          variant="contained"
          size="small"
          color={readOnlyMode ? 'primary' : 'warning'}
          startIcon={<PlayArrowIcon />}
          onClick={handleExecuteClick}
          disabled={isExecuting || effectiveDbIds.length === 0}
          sx={{ textTransform: 'none' }}
        >
          执行 (Ctrl+Enter)
        </Button>
        <Button
          variant="outlined"
          size="small"
          color="error"
          startIcon={<StopIcon />}
          onClick={onStop}
          disabled={!isExecuting}
          sx={{ textTransform: 'none' }}
        >
          停止
        </Button>

        {/* SQL 脚本操作 */}
        <Button
          variant="outlined"
          size="small"
          startIcon={<FolderOpenIcon />}
          onClick={handleOpenClick}
          sx={{ textTransform: 'none' }}
        >
          打开脚本
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<SaveIcon />}
          onClick={handleSaveClick}
          disabled={!sql.trim()}
          sx={{ textTransform: 'none' }}
        >
          保存脚本
        </Button>
        <Button variant="outlined" size="small" onClick={handleFormatSql} disabled={!sql.trim()} sx={{ textTransform: 'none' }}>
          格式化
        </Button>
        <Button
          variant="outlined"
          size="small"
          startIcon={<AutoAwesomeIcon />}
          onClick={() => setTemplateDialogOpen(true)}
          sx={{ textTransform: 'none' }}
        >
          模板
        </Button>

        <FormControlLabel
        control={
          <Switch
            size="small"
            checked={readOnlyMode}
            onChange={toggleReadOnly}
            color="warning"
          />
        }
        label={
          <Typography variant="caption" sx={{ color: readOnlyMode ? 'warning.main' : 'text.secondary' }}>
            只读模式
          </Typography>
        }
        sx={{ ml: 1 }}
      />

      <Box sx={{ flex: 1 }} />

      <Select
        value={editorTheme}
        onChange={(e) => setEditorTheme(e.target.value as EditorTheme)}
        size="small"
        sx={{ minWidth: 80, '& .MuiSelect-select': { display: 'flex', alignItems: 'center', gap: 1, py: 0.5 } }}
        renderValue={(value) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: themeColors[value].color, border: value === 'hc-light' ? '1px solid #ccc' : 'none', flexShrink: 0 }} />
            <Typography variant="body2" noWrap>{themeColors[value].label}</Typography>
          </Box>
        )}
      >
        {themeOptions.map((t) => (
          <MenuItem key={t.value} value={t.value}>
            <Box sx={{ width: 14, height: 14, borderRadius: 0.5, bgcolor: t.color, border: t.value === 'hc-light' ? '1px solid #ccc' : 'none', mr: 1, flexShrink: 0 }} />
            {t.label}
          </MenuItem>
        ))}
      </Select>

      {/* 字体大小调整 */}
      <Box sx={{ display: 'flex', alignItems: 'center', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Tooltip title="缩小字体">
          <IconButton
            size="small"
            onClick={() => setFontSize(Math.max(10, fontSize - 1))}
            disabled={fontSize <= 10}
            sx={{ borderRadius: 0 }}
          >
            <RemoveIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Typography
          variant="caption"
          sx={{ minWidth: 28, textAlign: 'center', userSelect: 'none', color: 'text.secondary' }}
        >
          {fontSize}
        </Typography>
        <Tooltip title="放大字体">
          <IconButton
            size="small"
            onClick={() => setFontSize(Math.min(30, fontSize + 1))}
            disabled={fontSize >= 30}
            sx={{ borderRadius: 0 }}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {isGroupMode && activeGroup ? (
        <Chip
          label={`分组: ${activeGroup.name} (${effectiveDbIds.length}库)`}
          size="small"
          color="secondary"
          variant="filled"
        />
      ) : (
        <Chip
          label={`已选: ${effectiveDbIds.length}库`}
          size="small"
          color={effectiveDbIds.length > 0 ? 'primary' : 'default'}
          variant={effectiveDbIds.length > 0 ? 'filled' : 'outlined'}
        />
      )}

      {/* 脚本列表对话框 */}
      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} maxWidth="sm" fullWidth>
        <DialogTitle>打开脚本</DialogTitle>
        <DialogContent dividers sx={{ minHeight: 300 }}>
          {/* 分类筛选 */}
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
            <Chip
              label="全部"
              size="small"
              color={!scriptFilterCat ? 'primary' : 'default'}
              onClick={() => setScriptFilterCat('')}
              variant={!scriptFilterCat ? 'filled' : 'outlined'}
              sx={{ fontSize: '0.7rem' }}
            />
            {SCRIPT_CATEGORIES.filter(Boolean).map(cat => (
              <Chip
                key={cat}
                label={cat}
                size="small"
                color={scriptFilterCat === cat ? 'primary' : 'default'}
                onClick={() => setScriptFilterCat(cat)}
                variant={scriptFilterCat === cat ? 'filled' : 'outlined'}
                sx={{ fontSize: '0.7rem' }}
              />
            ))}
          </Box>
          {loading ? (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>加载中...</Box>
          ) : scripts.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>暂无保存的脚本</Box>
          ) : (
            <List dense>
              {scripts
                .filter(s => !scriptFilterCat || s.category === scriptFilterCat)
                .map((s) => (
                <ListItem
                  key={s.id}
                  secondaryAction={
                    <Tooltip title="删除">
                      <IconButton edge="end" size="small" onClick={() => handleDeleteScript(s.id, s.name)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  }
                  sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' } }}
                  onClick={() => handleLoadScript(s)}
                >
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography sx={{ fontSize: '0.9rem' }}>{s.name}</Typography>
                        {s.category && (
                          <Chip
                            label={s.category}
                            size="small"
                            variant="outlined"
                            color="primary"
                            sx={{ fontSize: '0.6rem', height: 18 }}
                          />
                        )}
                      </Box>
                    }
                    secondary={s.description || s.sql_preview || '无描述'}
                    primaryTypographyProps={{ fontSize: '0.9rem' }}
                    secondaryTypographyProps={{ fontSize: '0.75rem', sx: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDialog(false)}>关闭</Button>
        </DialogActions>
      </Dialog>

      {/* 保存脚本对话框 */}
      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>保存脚本</DialogTitle>
        <DialogContent dividers sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <TextField
            label="脚本名称"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            size="small"
            fullWidth
            required
          />
          <FormControl size="small" fullWidth>
            <InputLabel>分类（可选）</InputLabel>
            <Select
              value={saveCategory}
              label="分类（可选）"
              onChange={(e) => setSaveCategory(e.target.value as ScriptCategory)}
            >
              <MenuItem value="">未分类</MenuItem>
              {SCRIPT_CATEGORIES.filter(Boolean).map(cat => (
                <MenuItem key={cat} value={cat}>{cat}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="描述（可选）"
            value={saveDesc}
            onChange={(e) => setSaveDesc(e.target.value)}
            size="small"
            fullWidth
            multiline
            rows={2}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>取消</Button>
          <Button onClick={handleSaveConfirm} variant="contained" disabled={!saveName.trim()}>保存</Button>
        </DialogActions>
      </Dialog>

      {/* 执行确认对话框 */}
      <Dialog open={confirmDialogOpen} onClose={() => setConfirmDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningAmberIcon color="warning" />
          确认执行 SQL
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            当前为非只读模式，将直接对数据库执行 <Box component="span" sx={{ fontWeight: 600, color: 'error.main' }}>写入操作</Box>，请在执行前仔细确认 SQL 语句。
          </Typography>
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
            将影响以下 {selectedDbInfo.length} 个数据库：
          </Typography>
          <Box
            sx={{
              maxHeight: 200,
              overflow: 'auto',
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
              bgcolor: '#F5F5F5',
            }}
          >
            <List dense disablePadding>
              {selectedDbInfo.map((db, i) => (
                <ListItem key={i} sx={{ borderBottom: i < selectedDbInfo.length - 1 ? '1px solid' : 'none', borderColor: 'divider' }}>
                  <ListItemText
                    primary={db.hospitalName}
                    secondary={db.predbName || '—'}
                    primaryTypographyProps={{ fontSize: '0.85rem' }}
                    secondaryTypographyProps={{ fontSize: '0.75rem' }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDialogOpen(false)}>取消</Button>
          <Button onClick={handleExecuteConfirm} variant="contained" color="warning" autoFocus>
            确认执行
          </Button>
        </DialogActions>
      </Dialog>

      {/* 模板对话框 */}
      <TemplatesDialog
        open={templateDialogOpen}
        onClose={() => setTemplateDialogOpen(false)}
        onInsert={(sql) => { setSql(sql); setTemplateDialogOpen(false); }}
      />

      {/* 参数化查询对话框 */}
      <ParamsDialog
        open={paramsDialogOpen}
        params={pendingParams}
        onConfirm={handleParamsConfirm}
        onCancel={() => setParamsDialogOpen(false)}
      />

      {/* 提示消息 */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snackbar.severity} sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
    </Box>
  );
};

export default EditorToolbar;
