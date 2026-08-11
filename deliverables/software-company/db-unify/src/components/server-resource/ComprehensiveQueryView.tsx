/**
 * 综合查询视图 — 嵌入主页面布局
 * 左侧面板：字段选择 + 模板管理
 * 右侧主区域：过滤条件 + 查询结果（表格/图表切换）
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Typography, Button, IconButton, Chip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Paper, Checkbox, FormControl, Select, MenuItem, TextField,
  Stack, Divider, Tooltip, Alert, CircularProgress,
  Accordion, AccordionSummary, AccordionDetails,
  ToggleButtonGroup, ToggleButton, Radio, useTheme,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Save as SaveIcon,
  Delete as DeleteIcon,
  FileDownload as ExportIcon,
  ExpandMore as ExpandMoreIcon,
  Add as AddIcon,
  Edit as EditIcon,
  Visibility as VisibilityIcon,
  NavigateNext as NavigateNextIcon,
  TableChart as TableIcon,
  ShowChart as ChartLineIcon,
} from '@mui/icons-material';
import type { FilterCondition, QueryTemplate, QueryResult, QueryFieldGroup } from '../../types/server';
import {
  executeQuery,
  getQueryFields,
  getQueryTemplates,
  saveQueryTemplate,
  updateQueryTemplate,
  deleteQueryTemplate,
} from '../../services/queryService';
import QueryChartPanel from './QueryChartPanel';

interface Props {
  /** 返回按钮回调（点击后切回服务器资源视图） */
  onBack?: () => void;
}

const OPERATORS = [
  { value: 'contains', label: '包含' },
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'gt', label: '大于' },
  { value: 'lt', label: '小于' },
  { value: 'gte', label: '大于等于' },
  { value: 'lte', label: '小于等于' },
  { value: 'isEmpty', label: '为空' },
  { value: 'isNotEmpty', label: '不为空' },
];

const SIDEBAR_WIDTH = 300;

const ComprehensiveQueryView: React.FC<Props> = ({ onBack }) => {
  const theme = useTheme();
  // ---- 核心状态 ----
  const [fieldGroups, setFieldGroups] = useState<QueryFieldGroup[]>([]);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [filters, setFilters] = useState<FilterCondition[]>([]);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterExpanded, setFilterExpanded] = useState(false);
  const [viewMode, setViewMode] = useState<'table' | 'chart'>('table');

  // ---- 左侧面板切换 ----
  const [sidebarTab, setSidebarTab] = useState<'fields' | 'templates'>('fields');

  // ---- 模板相关 ----
  const [templates, setTemplates] = useState<QueryTemplate[]>([]);
  const [templateName, setTemplateName] = useState('');
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [renamingTemplateId, setRenamingTemplateId] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState('');
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);
  const [addFieldForTemplate, setAddFieldForTemplate] = useState<Record<string, string>>({});

  // ---- 图表相关 ----
  const [chartType, setChartType] = useState<'bar' | 'pie' | 'line' | 'scatter'>('bar');
  const [chartXField, setChartXField] = useState('');
  const [chartYField, setChartYField] = useState('');

  // ---- 加载数据 ----
  useEffect(() => {
    getQueryFields().then(setFieldGroups).catch(() => setError('加载字段定义失败'));
    loadTemplates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTemplates = useCallback(async () => {
    try {
      const data = await getQueryTemplates();
      setTemplates(data);
    } catch { /* ignore */ }
  }, []);

  // ---- key -> label 映射 ----
  const fieldLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of fieldGroups) {
      for (const f of g.fields) {
        map[f.key] = f.label;
      }
    }
    return map;
  }, [fieldGroups]);

  // ---- key -> group 映射 ----
  const fieldGroupMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of fieldGroups) {
      for (const f of g.fields) {
        map[f.key] = g.group;
      }
    }
    return map;
  }, [fieldGroups]);

  // ---- 字段操作 ----
  const toggleField = useCallback((key: string) => {
    setSelectedFields((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }, []);

  const toggleGroup = useCallback((group: QueryFieldGroup, selectAll: boolean) => {
    const keys = group.fields.map((f) => f.key);
    setSelectedFields((prev) => {
      if (selectAll) return [...new Set([...prev, ...keys])];
      return prev.filter((k) => !keys.includes(k));
    });
  }, []);

  // ---- 过滤条件操作 ----
  const addFilter = useCallback(() => {
    setFilters((prev) => [...prev, { field: '', operator: 'contains', value: '' }]);
    setFilterExpanded(true);
  }, []);

  const updateFilter = useCallback((index: number, patch: Partial<FilterCondition>) => {
    setFilters((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }, []);

  const removeFilter = useCallback((index: number) => {
    setFilters((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---- 执行查询 ----
  const handleExecute = useCallback(async () => {
    if (selectedFields.length === 0) {
      setError('请至少选择一个查询字段');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await executeQuery(selectedFields, filters);
      setQueryResult(result);
    } catch (err: any) {
      setError(err.message || '查询失败');
    } finally {
      setLoading(false);
    }
  }, [selectedFields, filters]);

  // ---- 模板操作 ----
  const handleSaveTemplate = useCallback(async () => {
    if (!templateName.trim()) {
      setError('请输入模板名称');
      return;
    }
    setSavingTemplate(true);
    try {
      await saveQueryTemplate(templateName.trim(), selectedFields, filters);
      setTemplateName('');
      await loadTemplates();
    } catch (err: any) {
      setError(err.message || '保存模板失败');
    } finally {
      setSavingTemplate(false);
    }
  }, [templateName, selectedFields, filters, loadTemplates]);

  const handleLoadTemplate = useCallback((t: QueryTemplate) => {
    setSelectedFields([...t.fields]);
    setFilters((t.filters || []).map((f: any) => ({ ...f })));
    setQueryResult(null);
    setError('');
  }, []);

  const handleDeleteTemplate = useCallback(async (id: string) => {
    try {
      await deleteQueryTemplate(id);
      if (selectedTemplateId === id) setSelectedTemplateId(null);
      await loadTemplates();
    } catch (err: any) {
      setError(err.message || '删除模板失败');
    }
  }, [loadTemplates, selectedTemplateId]);

  const handleStartRename = useCallback((t: QueryTemplate) => {
    setRenamingTemplateId(t.id);
    setRenamingName(t.name);
  }, []);

  const handleConfirmRename = useCallback(async () => {
    if (!renamingTemplateId || !renamingName.trim()) {
      setRenamingTemplateId(null);
      return;
    }
    try {
      await updateQueryTemplate(renamingTemplateId, { name: renamingName.trim() });
      await loadTemplates();
    } catch (err: any) {
      setError(err.message || '重命名模板失败');
    } finally {
      setRenamingTemplateId(null);
    }
  }, [renamingTemplateId, renamingName, loadTemplates]);

  const handleUpdateTemplateWithCurrent = useCallback(async () => {
    if (!selectedTemplateId) return;
    try {
      await updateQueryTemplate(selectedTemplateId, { fields: selectedFields, filters });
      await loadTemplates();
    } catch (err: any) {
      setError(err.message || '更新模板字段失败');
    }
  }, [selectedTemplateId, selectedFields, filters, loadTemplates]);

  const handleRemoveFieldFromTemplate = useCallback(async (templateId: string, fieldKey: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    const newFields = (template.fields || []).filter(f => f !== fieldKey);
    try {
      await updateQueryTemplate(templateId, { fields: newFields });
      setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, fields: newFields } : t));
    } catch (err: any) {
      setError(err.message || '删除字段失败');
      await loadTemplates();
    }
  }, [templates, loadTemplates]);

  const handleAddFieldToTemplate = useCallback(async (templateId: string, fieldKey: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;
    const newFields = [...(template.fields || []), fieldKey];
    try {
      await updateQueryTemplate(templateId, { fields: newFields });
      setTemplates(prev => prev.map(t => t.id === templateId ? { ...t, fields: newFields } : t));
      setAddFieldForTemplate(prev => ({ ...prev, [templateId]: '' }));
    } catch (err: any) {
      setError(err.message || '添加字段失败');
      await loadTemplates();
    }
  }, [templates, loadTemplates]);

  // ---- 导出 ----
  const handleExport = useCallback(() => {
    if (!queryResult) return;
    fetch('/api/query/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: selectedFields, filters }),
    }).then((res) => {
      if (!res.ok) throw new Error('导出失败');
      return res.blob();
    }).then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `综合查询_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    }).catch(() => setError('导出失败'));
  }, [queryResult, selectedFields, filters]);

  // ---- 助手函数 ----
  const getGroupState = (group: QueryFieldGroup) => {
    const keys = group.fields.map((f) => f.key);
    const allChecked = keys.every((k) => selectedFields.includes(k));
    const someChecked = keys.some((k) => selectedFields.includes(k));
    return { allChecked, someChecked };
  };

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.default', overflow: 'hidden' }}>
      {/* ======= 顶部标题栏 ======= */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 1,
          bgcolor: 'background.paper',
          borderBottom: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          {onBack && (
            <Button
              size="small"
              onClick={onBack}
              sx={{ textTransform: 'none', fontSize: '0.8rem', minWidth: 'auto' }}
            >
              ← 返回
            </Button>
          )}
          <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'primary.main' }}>
            综合查询
          </Typography>
          {selectedFields.length > 0 && (
            <Chip
              label={`${selectedFields.length} 个字段`}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.72rem', height: 22 }}
            />
          )}
          {filters.length > 0 && (
            <Chip
              label={`${filters.length} 个条件`}
              size="small"
              variant="outlined"
              sx={{ fontSize: '0.72rem', height: 22 }}
            />
          )}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {queryResult && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ExportIcon sx={{ fontSize: '1.125rem' }} />}
              onClick={handleExport}
              sx={{ textTransform: 'none', fontSize: '0.8rem' }}
            >
              导出 XLSX
            </Button>
          )}
          <Button
            size="small"
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <SearchIcon sx={{ fontSize: '1.125rem' }} />}
            onClick={handleExecute}
            disabled={loading || selectedFields.length === 0}
            sx={{ textTransform: 'none', fontSize: '0.8rem' }}
          >
            {loading ? '查询中...' : '执行查询'}
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert
          severity="error"
          onClose={() => setError('')}
          sx={{ mx: 3, mt: 1.5, flexShrink: 0 }}
        >
          {error}
        </Alert>
      )}

      {/* ======= 主体：左侧边栏 + 右侧工作区 ======= */}
      <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* ===== 左侧面板 ===== */}
        <Box
          sx={{
            width: SIDEBAR_WIDTH,
            minWidth: SIDEBAR_WIDTH,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            borderRight: '1px solid',
            borderColor: 'divider',
            overflow: 'hidden',
          }}
        >
          {/* Tab 切换按钮 */}
          <Box
            sx={{
              display: 'flex',
              borderBottom: '2px solid',
              borderColor: 'divider',
              flexShrink: 0,
            }}
          >
            <Box
              onClick={() => setSidebarTab('fields')}
              sx={{
                flex: 1,
                textAlign: 'center',
                py: 1.25,
                cursor: 'pointer',
                borderBottom: '2px solid',
                borderColor: sidebarTab === 'fields' ? 'primary.main' : 'transparent',
                color: sidebarTab === 'fields' ? 'primary.main' : 'text.secondary',
                fontWeight: sidebarTab === 'fields' ? 600 : 400,
                fontSize: '0.8rem',
                mb: '-2px',
                transition: 'all 0.15s',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              可选字段
              {selectedFields.length > 0 && (
                <Chip
                  label={selectedFields.length}
                  size="small"
                  sx={{ ml: 0.5, height: 18, fontSize: '0.65rem', fontWeight: 600 }}
                  color="primary"
                  variant="filled"
                />
              )}
            </Box>
            <Box
              onClick={() => setSidebarTab('templates')}
              sx={{
                flex: 1,
                textAlign: 'center',
                py: 1.25,
                cursor: 'pointer',
                borderBottom: '2px solid',
                borderColor: sidebarTab === 'templates' ? 'primary.main' : 'transparent',
                color: sidebarTab === 'templates' ? 'primary.main' : 'text.secondary',
                fontWeight: sidebarTab === 'templates' ? 600 : 400,
                fontSize: '0.8rem',
                mb: '-2px',
                transition: 'all 0.15s',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              模板查看
              {templates.length > 0 && (
                <Chip
                  label={templates.length}
                  size="small"
                  sx={{ ml: 0.5, height: 18, fontSize: '0.65rem', fontWeight: 600 }}
                  color="primary"
                  variant="filled"
                />
              )}
            </Box>
          </Box>

          {/* ===== 可选字段 Tab ===== */}
          {sidebarTab === 'fields' && (
            <Box sx={{ flex: 1, overflow: 'auto' }}>
              <Box
                sx={{
                  px: 2,
                  py: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  position: 'sticky',
                  top: 0,
                  bgcolor: 'background.paper',
                  zIndex: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.72rem' }}>
                  勾选需要查询的字段
                </Typography>
                {selectedFields.length > 0 && (
                  <Button
                    size="small"
                    onClick={() => setSelectedFields([])}
                    sx={{ textTransform: 'none', fontSize: '0.7rem', minWidth: 'auto', px: 0.5 }}
                  >
                    清空全部
                  </Button>
                )}
              </Box>

              {fieldGroups.map((group) => {
                const { allChecked, someChecked } = getGroupState(group);
                const checkedCount = group.fields.filter((f) => selectedFields.includes(f.key)).length;
                return (
                  <Accordion
                    key={group.prefix}
                    disableGutters
                    elevation={0}
                    defaultExpanded
                    sx={{
                      '&:before': { display: 'none' },
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <AccordionSummary
                      expandIcon={<ExpandMoreIcon sx={{ fontSize: '1.125rem' }} />}
                      sx={{
                        minHeight: 40,
                        '& .MuiAccordionSummary-content': { my: 0.5 },
                        px: 2,
                        bgcolor: allChecked ? 'action.selected' : 'transparent',
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <Checkbox
                          size="small"
                          checked={allChecked}
                          indeterminate={!allChecked && someChecked}
                          onChange={(_, checked) => toggleGroup(group, checked)}
                          onClick={(e) => e.stopPropagation()}
                          sx={{ py: 0, mr: 0.5 }}
                        />
                        <Typography variant="body2" sx={{ fontWeight: 600, fontSize: '0.8rem' }}>
                          {group.group}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ ml: 'auto', color: 'text.secondary', fontSize: '0.68rem' }}
                        >
                          {checkedCount}/{group.fields.length}
                        </Typography>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails sx={{ py: 0, px: 0 }}>
                      {group.fields.map((field) => (
                        <Box
                          key={field.key}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            pl: 5.5,
                            pr: 2,
                            py: 0.25,
                            cursor: 'pointer',
                            '&:hover': { bgcolor: 'action.hover' },
                            bgcolor: selectedFields.includes(field.key) ? 'action.selected' : 'transparent',
                          }}
                          onClick={() => toggleField(field.key)}
                        >
                          <Checkbox
                            size="small"
                            checked={selectedFields.includes(field.key)}
                            sx={{ py: 0 }}
                          />
                          <Typography variant="body2" sx={{ fontSize: '0.76rem' }}>
                            {field.label}
                          </Typography>
                        </Box>
                      ))}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}

          {/* ===== 模板查看 Tab ===== */}
          {sidebarTab === 'templates' && (
            <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {/* 模板列表 */}
              <Box sx={{ flex: 1, overflow: 'auto' }}>
                <Box sx={{ px: 2, pt: 1.5, pb: 0.75 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem', fontWeight: 500 }}>
                    已有模板 {templates.length > 0 ? `(${templates.length})` : ''}
                  </Typography>
                </Box>

                {templates.length === 0 ? (
                  <Box sx={{ px: 2, py: 4, textAlign: 'center' }}>
                    <SaveIcon sx={{ fontSize: '2rem', color: 'text.disabled', mb: 1 }} />
                    <Typography variant="body2" color="text.disabled" sx={{ fontSize: '0.75rem' }}>
                      还没有保存任何模板
                    </Typography>
                  </Box>
                ) : (
                  <Stack spacing={0} sx={{ px: 1.5, pb: 1 }}>
                    {templates.map((t) => {
                      const isSelected = selectedTemplateId === t.id;
                      const isRenaming = renamingTemplateId === t.id;
                      const isExpanded = expandedTemplateId === t.id;
                      return (
                        <Box key={t.id}>
                          {/* 模板行：Radio + 名称 + 信息 */}
                          <Box
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              px: 0.5,
                              py: 0.5,
                              borderRadius: 1,
                              bgcolor: isSelected ? 'action.selected' : 'transparent',
                              transition: 'background-color 0.15s',
                            }}
                          >
                            <Radio
                              size="small"
                              checked={isSelected}
                              onChange={() =>
                                setSelectedTemplateId(isSelected ? null : t.id)
                              }
                              sx={{ py: 0.5, mr: 0.25 }}
                            />
                            <Box sx={{ minWidth: 0, flex: 1 }}>
                              {isRenaming ? (
                                <TextField
                                  size="small"
                                  value={renamingName}
                                  onChange={(e) => setRenamingName(e.target.value)}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleConfirmRename();
                                    if (e.key === 'Escape') setRenamingTemplateId(null);
                                  }}
                                  onBlur={handleConfirmRename}
                                  sx={{
                                    '& .MuiOutlinedInput-root': { fontSize: '0.78rem', bgcolor: 'background.paper' },
                                  }}
                                  inputProps={{ style: { padding: '4px 8px' } }}
                                />
                              ) : (
                                <>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontSize: '0.78rem',
                                      fontWeight: 500,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {t.name}
                                  </Typography>
                                  <Box sx={{ display: 'flex', gap: 1, mt: 0.25 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }}>
                                      {t.fields?.length || 0} 个字段
                                    </Typography>
                                    {t.filters && t.filters.length > 0 && (
                                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.66rem' }}>
                                        {t.filters.length} 个条件
                                      </Typography>
                                    )}
                                  </Box>
                                </>
                              )}
                            </Box>
                            {/* 操作图标与名称同行 */}
                            {isSelected && (
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
                                <Tooltip title={isExpanded ? '收起字段' : '查看字段'}>
                                  <IconButton size="small" onClick={() => setExpandedTemplateId(isExpanded ? null : t.id)}>
                                    <VisibilityIcon sx={{ fontSize: '0.9375rem' }} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="加载">
                                  <IconButton size="small" onClick={() => { handleLoadTemplate(t); setSidebarTab('fields'); }}>
                                    <NavigateNextIcon sx={{ fontSize: '0.9375rem' }} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="重命名">
                                  <IconButton size="small" onClick={() => handleStartRename(t)}>
                                    <EditIcon sx={{ fontSize: '0.9375rem' }} />
                                  </IconButton>
                                </Tooltip>
                                <Tooltip title="删除">
                                  <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleDeleteTemplate(t.id); }}>
                                    <DeleteIcon sx={{ fontSize: '0.9375rem' }} />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            )}
                          </Box>

                          {/* 展开查看字段 */}
                          {isExpanded && (
                            <Box sx={{ pl: 5, pr: 1, pb: 1 }}>
                              <Paper
                                variant="outlined"
                                sx={{
                                  bgcolor: 'background.paper',
                                  overflow: 'hidden',
                                }}
                              >
                                {/* 字段列表 */}
                                <Box sx={{ px: 1.5, py: 1 }}>
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
                                    <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 600, color: 'text.primary' }}>
                                      字段列表
                                    </Typography>
                                    <Chip
                                      label={t.fields?.length || 0}
                                      size="small"
                                      sx={{ height: 18, fontSize: '0.6rem', minWidth: 18, bgcolor: 'action.selected' }}
                                    />
                                  </Box>
                                  {t.fields && t.fields.length > 0 ? (
                                    <Stack spacing={0}>
                                      {t.fields.map((f, idx) => (
                                        <Box
                                          key={f}
                                          sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            py: 0.4,
                                            px: 0.75,
                                            borderRadius: 0.5,
                                            '&:hover': { bgcolor: 'action.hover' },
                                          }}
                                        >
                                          <Typography
                                            variant="caption"
                                            sx={{
                                              fontSize: '0.7rem',
                                              color: 'text.secondary',
                                              minWidth: 20,
                                              fontWeight: 500,
                                            }}
                                          >
                                            {idx + 1}.
                                          </Typography>
                                          <Typography variant="body2" sx={{ fontSize: '0.74rem', flex: 1 }}>
                                            <Typography
                                              component="span"
                                              variant="caption"
                                              sx={{ color: 'text.secondary', mr: 0.5, fontSize: '0.65rem' }}
                                            >
                                              [{fieldGroupMap[f] || ''}]
                                            </Typography>
                                            {fieldLabelMap[f] || f}
                                          </Typography>
                                          <Tooltip title="移除字段">
                                            <IconButton
                                              size="small"
                                              onClick={() => handleRemoveFieldFromTemplate(t.id, f)}
                                              sx={{ p: 0.25, opacity: 0.4, '&:hover': { opacity: 1, color: 'error.main' } }}
                                            >
                                              <CloseIcon sx={{ fontSize: '0.8125rem' }} />
                                            </IconButton>
                                          </Tooltip>
                                        </Box>
                                      ))}
                                    </Stack>
                                  ) : (
                                    <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.68rem' }}>
                                      无字段
                                    </Typography>
                                  )}
                                  {/* 添加字段下拉 */}
                                  <Box sx={{ px: 0.75, pt: 0.5 }}>
                                    <FormControl size="small" fullWidth>
                                      <Select
                                        value={addFieldForTemplate[t.id] || ''}
                                        onChange={(e) => {
                                          if (e.target.value) {
                                            handleAddFieldToTemplate(t.id, e.target.value);
                                          }
                                        }}
                                        displayEmpty
                                        sx={{ fontSize: '0.68rem', '& .MuiSelect-select': { py: 0.5 } }}
                                      >
                                        <MenuItem value="" disabled sx={{ fontSize: '0.68rem' }}>
                                          <em>+ 添加字段</em>
                                        </MenuItem>
                                        {fieldGroups.flatMap(g =>
                                          g.fields
                                            .filter(fd => !(t.fields || []).includes(fd.key))
                                            .map(fd => ({ ...fd, groupName: g.group }))
                                        ).map(fd => (
                                          <MenuItem key={fd.key} value={fd.key} sx={{ fontSize: '0.68rem' }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5, fontSize: '0.62rem' }}>
                                              [{fd.groupName}]
                                            </Typography>
                                            {fd.label}
                                          </MenuItem>
                                        ))}
                                      </Select>
                                    </FormControl>
                                  </Box>
                                </Box>

                                {/* 过滤条件 */}
                                {t.filters && t.filters.length > 0 && (
                                  <>
                                    <Divider />
                                    <Box sx={{ px: 1.5, py: 1 }}>
                                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
                                        <Typography variant="caption" sx={{ fontSize: '0.7rem', fontWeight: 600, color: 'text.primary' }}>
                                          过滤条件
                                        </Typography>
                                        <Chip
                                          label={t.filters.length}
                                          size="small"
                                          sx={{ height: 18, fontSize: '0.6rem', minWidth: 18, bgcolor: 'warning.light', color: 'warning.dark' }}
                                        />
                                      </Box>
                                      <Stack spacing={0}>
                                        {t.filters.map((f: any, i: number) => (
                                          <Box
                                            key={i}
                                            sx={{
                                              display: 'flex',
                                              alignItems: 'center',
                                              py: 0.4,
                                              px: 0.75,
                                              borderRadius: 0.5,
                                              '&:hover': { bgcolor: 'action.hover' },
                                            }}
                                          >
                                            <Typography
                                              variant="caption"
                                              sx={{
                                                fontSize: '0.7rem',
                                                color: 'text.secondary',
                                                minWidth: 20,
                                                fontWeight: 500,
                                              }}
                                            >
                                              {i + 1}.
                                            </Typography>
                                            <Chip
                                              label={fieldLabelMap[f.field] || f.field}
                                              size="small"
                                              sx={{ height: 20, fontSize: '0.68rem', fontWeight: 500, mr: 0.75 }}
                                            />
                                            <Typography variant="caption" sx={{ fontSize: '0.68rem', color: 'text.secondary', mr: 0.75 }}>
                                              {OPERATORS.find((op) => op.value === f.operator)?.label || f.operator}
                                            </Typography>
                                            {!['isEmpty', 'isNotEmpty'].includes(f.operator) && (
                                              <Typography variant="caption" sx={{ fontSize: '0.68rem', color: 'primary.main' }}>
                                                {f.value || '(空)'}
                                              </Typography>
                                            )}
                                          </Box>
                                        ))}
                                      </Stack>
                                    </Box>
                                  </>
                                )}
                              </Paper>
                            </Box>
                          )}

                          <Divider sx={{ my: 0.25 }} />
                        </Box>
                      );
                    })}
                  </Stack>
                )}
              </Box>

              {/* 底部：新建模板（简化版） */}
              <Box
                sx={{
                  px: 2,
                  pt: 1.5,
                  pb: 1.5,
                  borderTop: '1px solid',
                  borderColor: 'divider',
                  bgcolor: 'background.paper',
                  flexShrink: 0,
                }}
              >
                <Box sx={{ display: 'flex', gap: 0.75 }}>
                  <TextField
                    size="small"
                    placeholder="新模板名称..."
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    fullWidth
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        fontSize: '0.78rem',
                        bgcolor: 'background.paper',
                      },
                    }}
                    inputProps={{ style: { padding: '6px 10px' } }}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTemplate(); }}
                  />
                  <Button
                    size="small"
                    variant="contained"
                    startIcon={<SaveIcon sx={{ fontSize: '1rem' }} />}
                    onClick={handleSaveTemplate}
                    disabled={savingTemplate || !templateName.trim()}
                    sx={{
                      textTransform: 'none',
                      fontSize: '0.75rem',
                      minWidth: 72,
                      px: 1.5,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                    }}
                  >
                    {savingTemplate ? '...' : '保存'}
                  </Button>
                </Box>
                {selectedFields.length > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mt: 0.75 }}>
                    <Chip
                      label={`${selectedFields.length} 个字段`}
                      size="small"
                      sx={{ height: 20, fontSize: '0.65rem' }}
                      color="primary"
                      variant="outlined"
                    />
                    {selectedTemplateId && (
                      <Button
                        size="small"
                        variant="text"
                        onClick={handleUpdateTemplateWithCurrent}
                        sx={{ textTransform: 'none', fontSize: '0.68rem', minWidth: 0, px: 0.5, py: 0 }}
                      >
                        更新到已选模板
                      </Button>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          )}
        </Box>

        {/* ===== 右侧工作区 ===== */}
        <Box
          sx={{
            flex: 1,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            bgcolor: 'background.default',
          }}
        >
          {/* 过滤条件区域 */}
          <Box
            sx={{
              mx: 3,
              mt: 2,
              bgcolor: 'background.paper',
              borderRadius: 1,
              border: '1px solid',
              borderColor: 'divider',
              overflow: 'hidden',
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1,
                cursor: 'pointer',
                bgcolor: filters.length > 0 ? 'action.selected' : 'transparent',
              }}
              onClick={() => setFilterExpanded(!filterExpanded)}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    bgcolor: filters.length > 0 ? 'success.main' : 'grey.400',
                  }}
                />
                <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '0.8rem' }}>
                  过滤条件
                </Typography>
                {filters.length > 0 && (
                  <Chip label={filters.length} size="small" color="primary" sx={{ height: 20, fontSize: '0.68rem' }} />
                )}
              </Box>
              <ExpandMoreIcon
                sx={{
                  fontSize: '1.25rem',
                  transform: filterExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.2s',
                }}
              />
            </Box>

            {filterExpanded && (
              <Box sx={{ px: 2, pb: 1.5 }}>
                {filters.length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1, fontSize: '0.78rem' }}>
                    暂无过滤条件，点击下方按钮添加
                  </Typography>
                ) : (
                  <Stack spacing={1} sx={{ mt: 0.5 }}>
                    {filters.map((f, i) => (
                      <Stack key={i} direction="row" spacing={1} alignItems="center">
                        <FormControl size="small" sx={{ minWidth: 160 }}>
                          <Select
                            value={f.field}
                            onChange={(e) => updateFilter(i, { field: e.target.value })}
                            displayEmpty
                            sx={{ fontSize: '0.76rem' }}
                          >
                            <MenuItem value="" disabled>
                              <em style={{ color: theme.palette.text.disabled }}>选择字段</em>
                            </MenuItem>
                            {fieldGroups.flatMap((g) =>
                              g.fields.map((fd) => (
                                <MenuItem key={fd.key} value={fd.key} sx={{ fontSize: '0.76rem' }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                                    [{g.group}]
                                  </Typography>
                                  {fd.label}
                                </MenuItem>
                              ))
                            )}
                          </Select>
                        </FormControl>
                        <FormControl size="small" sx={{ minWidth: 110 }}>
                          <Select
                            value={f.operator}
                            onChange={(e) =>
                              updateFilter(i, { operator: e.target.value as FilterCondition['operator'] })
                            }
                            sx={{ fontSize: '0.76rem' }}
                          >
                            {OPERATORS.map((op) => (
                              <MenuItem key={op.value} value={op.value} sx={{ fontSize: '0.76rem' }}>
                                {op.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        {!['isEmpty', 'isNotEmpty'].includes(f.operator) && (
                          <TextField
                            size="small"
                            placeholder="输入值"
                            value={f.value}
                            onChange={(e) => updateFilter(i, { value: e.target.value })}
                            sx={{ flex: 1, '& .MuiOutlinedInput-root': { fontSize: '0.76rem' } }}
                            inputProps={{ style: { padding: '4px 8px' } }}
                          />
                        )}
                        <IconButton
                          size="small"
                          onClick={() => removeFilter(i)}
                          sx={{ color: 'error.main' }}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ))}
                  </Stack>
                )}
                <Button
                  size="small"
                  startIcon={<AddIcon sx={{ fontSize: '1rem' }} />}
                  onClick={addFilter}
                  sx={{ mt: 1, textTransform: 'none', fontSize: '0.73rem' }}
                >
                  添加条件
                </Button>
              </Box>
            )}
          </Box>

          {/* 查询结果头部 */}
          {queryResult && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mx: 3, mt: 1.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8rem' }}>
                查询结果 {queryResult.total} 条
              </Typography>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(_, v) => v && setViewMode(v)}
                size="small"
                sx={{ ml: 'auto' }}
              >
                <ToggleButton value="table" sx={{ textTransform: 'none', px: 1.5, py: 0.5, fontSize: '0.73rem' }}>
                  <TableIcon sx={{ fontSize: '1rem', mr: 0.5 }} />
                  表格
                </ToggleButton>
                <ToggleButton value="chart" sx={{ textTransform: 'none', px: 1.5, py: 0.5, fontSize: '0.73rem' }}>
                  <ChartLineIcon sx={{ fontSize: '1rem', mr: 0.5 }} />
                  图表
                </ToggleButton>
              </ToggleButtonGroup>
            </Box>
          )}

          {/* 结果区域 */}
          {/* 表格视图 */}
          {viewMode === 'table' && (
            <Box sx={{ flex: 1, mx: 3, mb: 2, mt: 1.5, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {!queryResult ? (
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: 'background.paper',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    color: 'text.secondary',
                  }}
                >
                  <SearchIcon sx={{ fontSize: '3rem', color: 'text.disabled', mb: 1 }} />
                  <Typography variant="body1" color="text.secondary">
                    请在左侧选择字段，点击"执行查询"获取结果
                  </Typography>
                  <Typography variant="caption" color="text.disabled" sx={{ mt: 0.5 }}>
                    已选 {selectedFields.length} 个字段
                  </Typography>
                </Box>
              ) : (
                <TableContainer
                  component={Paper}
                  variant="outlined"
                  sx={{ flex: 1, bgcolor: 'background.paper', borderRadius: 1 }}
                >
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell
                          padding="checkbox"
                          sx={{
                            bgcolor: 'action.hover',
                            fontWeight: 600,
                            fontSize: '0.76rem',
                            borderBottom: '2px solid',
                            borderColor: 'divider',
                          }}
                        >
                          #
                        </TableCell>
                        {queryResult.columns.map((col) => (
                          <TableCell
                            key={col.key}
                            sx={{
                              bgcolor: 'action.hover',
                              fontWeight: 600,
                              fontSize: '0.76rem',
                              whiteSpace: 'nowrap',
                              borderBottom: '2px solid',
                              borderColor: 'divider',
                            }}
                          >
                            {col.label}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {queryResult.rows.slice(0, 500).map((row, idx) => (
                        <TableRow
                          key={row._id || idx}
                          hover
                          sx={{ '&:nth-of-type(odd)': { bgcolor: 'action.hover' } }}
                        >
                          <TableCell sx={{ fontSize: '0.72rem', color: 'text.secondary' }}>
                            {idx + 1}
                          </TableCell>
                          {queryResult.columns.map((col) => (
                            <TableCell
                              key={col.key}
                              sx={{
                                fontSize: '0.73rem',
                                whiteSpace: 'nowrap',
                                maxWidth: 300,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {row[col.key] != null ? String(row[col.key]) : (
                                <Typography component="span" variant="caption" color="text.disabled">
                                  -
                                </Typography>
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          )}

          {/* 图表视图 */}
          {viewMode === 'chart' && (
            <Box sx={{ flex: 1, mx: 3, mb: 2, mt: 1.5, overflow: 'auto', bgcolor: 'background.paper', borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
              <QueryChartPanel
                queryResult={queryResult}
                selectedFields={selectedFields}
                fieldGroups={fieldGroups}
                chartType={chartType}
                chartXField={chartXField}
                chartYField={chartYField}
                onChartTypeChange={setChartType}
                onXFieldChange={setChartXField}
                onYFieldChange={setChartYField}
              />
            </Box>
          )}
        </Box>
      </Box>

      {/* ======= 底部状态栏 ======= */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 3,
          py: 0.75,
          bgcolor: 'background.paper',
          borderTop: '1px solid',
          borderColor: 'divider',
          flexShrink: 0,
        }}
      >
        <Typography variant="caption" color="text.secondary">
          {queryResult ? `共 ${queryResult.total} 条记录 | 显示前 ${Math.min(queryResult.total, 500)} 条` : '请选择字段后执行查询'}
        </Typography>
        {onBack && (
          <Button size="small" onClick={onBack} sx={{ textTransform: 'none', fontSize: '0.75rem' }}>
            返回服务器资源
          </Button>
        )}
      </Box>
    </Box>
  );
};

export default ComprehensiveQueryView;
