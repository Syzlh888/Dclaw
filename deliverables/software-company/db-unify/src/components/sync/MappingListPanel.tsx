import React, { useState } from 'react';
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel, IconButton, MenuItem, Select, Switch, TextField, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TableChartIcon from '@mui/icons-material/TableChart';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import UpdateIcon from '@mui/icons-material/Update';
import CloseIcon from '@mui/icons-material/Close';
import { useSyncStore } from '../../stores/syncStore';

interface Props {
  onCreateMapping: () => void;
  /** 父组件提供：打开字段映射编辑器 */
  onEditColumns: (mappingId: string) => void;
}

const IncrementalDialog: React.FC<{ open: boolean; mapping: any; onClose: () => void }> = ({ open, mapping, onClose }) => {
  const { updateMapping } = useSyncStore();
  const [enabled, setEnabled] = useState(!!mapping?.incremental_column);
  const [column, setColumn] = useState(mapping?.incremental_column || '');
  const [type, setType] = useState(mapping?.incremental_type || 'timestamp');
  const [checkpoint, setCheckpoint] = useState(mapping?.checkpoint_value || '');
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (mapping) {
      setEnabled(!!mapping.incremental_column);
      setColumn(mapping.incremental_column || '');
      setType(mapping.incremental_type || 'timestamp');
      setCheckpoint(mapping.checkpoint_value || '');
    }
  }, [mapping?.id]);

  const handleSave = async () => {
    if (!mapping) return;
    setSaving(true);
    try {
      await updateMapping(mapping.id, {
        incrementalColumn: enabled ? column : null,
        incrementalType: enabled ? type : null,
        checkpointValue: enabled ? checkpoint : null,
      } as any);
      onClose();
    } catch (e) {
      // swallow
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setCheckpoint('');
    setColumn('');
    setEnabled(false);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: '#3C3F41', color: 'text.primary' } }}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: '1rem' }}>
        <UpdateIcon sx={{ fontSize: 18, color: 'primary.main' }} />
        增量同步配置
      </DialogTitle>
      <DialogContent sx={{ pt: '12px !important' }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 11, mb: 2 }}>{mapping?.source_table} → {mapping?.target_table}</Typography>
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: 'primary.main' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'primary.main' } }} />}
          label="启用增量同步"
          sx={{ color: 'text.primary', mb: 2, display: 'block' }}
        />
        {enabled && (
          <>
            <TextField
              fullWidth size="small" label="增量字段名" placeholder="updated_at"
              value={column} onChange={(e) => setColumn(e.target.value)}
              sx={{ mb: 1.5, '& .MuiInputBase-root': { color: 'text.primary' } }}
              helperText="源表中用于跟踪增量进度的字段名"
            />
            <Select fullWidth size="small" value={type} onChange={(e) => setType(e.target.value as 'timestamp' | 'numeric')} sx={{ mb: 1.5, color: 'text.primary' }}>
              <MenuItem value="timestamp">timestamp（时间戳）</MenuItem>
              <MenuItem value="numeric">numeric（自增 ID / 数字）</MenuItem>
            </Select>
            <TextField
              fullWidth size="small" label="当前位点值" placeholder="2024-01-01T00:00:00Z"
              value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)}
              sx={{ mb: 1, '& .MuiInputBase-root': { color: 'text.primary' } }}
              helperText="每次执行后自动更新为最新同步位点"
            />
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleReset} size="small" disabled={saving} sx={{ color: 'error.light' }}>重置</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} size="small" disabled={saving} sx={{ color: 'text.secondary' }}>取消</Button>
        <Button onClick={handleSave} variant="contained" size="small" disabled={saving}>
          {saving ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

const MappingListPanel: React.FC<Props> = ({ onCreateMapping, onEditColumns }) => {
  const { mappings, selectedTaskId, selectedMappingId, selectMapping } = useSyncStore();
  const list = mappings.filter((mapping) => mapping.task_id === selectedTaskId);
  const selected = list.find((mapping) => mapping.id === selectedMappingId);
  const [incrementalDialogFor, setIncrementalDialogFor] = useState<string | null>(null);

  if (selected) return <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
      <Typography sx={{ color: 'text.primary', fontWeight: 600 }}>字段映射</Typography>
      <Chip size="small" label={`${selected.column_mappings?.length || 0} 个字段`} sx={{ ml: 1, height: 20, color: 'text.secondary', bgcolor: 'divider' }} />
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        startIcon={<AccountTreeIcon sx={{ fontSize: 16 }} />}
        onClick={() => onEditColumns(selected.id)}
        sx={{ color: 'primary.main', border: '1px solid', borderColor: 'primary.main' }}
        variant="outlined"
      >
        字段映射
      </Button>
    </Box>
    <Typography sx={{ color: 'text.secondary', fontSize: 12, mb: 1.5 }}>{selected.source_table} → {selected.target_table}</Typography>
    <Box sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 30px 1fr 100px', p: 1, color: 'text.secondary', fontSize: 11 }}><span>源字段</span><span /><span>目标字段</span><span>类型</span></Box><Divider sx={{ borderColor: 'divider' }} />
      {(selected.column_mappings || []).map((column, index) => <Box key={`${column.source}-${index}`} sx={{ display: 'grid', gridTemplateColumns: '1fr 30px 1fr 100px', alignItems: 'center', p: 1, color: 'text.secondary', fontSize: 12, borderBottom: index < (selected.column_mappings?.length || 0) - 1 ? '1px solid' : 0, borderColor: 'divider' }}><span>{column.source}</span><span>→</span><span>{column.target}</span><span style={{ color: 'text.secondary' }}>{column.type || '-'}</span></Box>)}
      {(selected.column_mappings || []).length === 0 && <Typography sx={{ p: 3, color: 'text.disabled', textAlign: 'center', fontSize: 12 }}>未配置字段映射（默认按同名字段同步）。点击右上「字段映射」配置。</Typography>}
    </Box>
    <IncrementalDialog open={!!incrementalDialogFor} mapping={incrementalDialogFor ? list.find((m) => m.id === incrementalDialogFor) : null} onClose={() => setIncrementalDialogFor(null)} />
  </Box>;
  return <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}><Typography sx={{ color: 'text.primary', fontWeight: 600 }}>表映射</Typography><Chip size="small" label={list.length} sx={{ ml: 1, height: 20, color: 'text.secondary' }} /><Box sx={{ flex: 1 }} /><Button size="small" startIcon={<AddIcon />} onClick={onCreateMapping} sx={{ color: 'primary.main' }}>新建映射</Button></Box>
    {list.length === 0 && <Typography sx={{ mt: 6, textAlign: 'center', color: 'text.disabled', fontSize: 13 }}>该任务暂无表映射</Typography>}
    {list.map((mapping) => <Box key={mapping.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, mb: 1, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', borderRadius: 1, '&:hover': { borderColor: 'primary.main' } }}>
      <Box onClick={() => selectMapping(mapping.id)} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <TableChartIcon sx={{ color: 'primary.light' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: 'text.primary', fontSize: 13 }}>{mapping.source_table} → {mapping.target_table}</Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 11 }}>
            {mapping.column_mappings?.length || 0} 个字段 · 顺序 {mapping.sequence ?? 0}
            {mapping.incremental_column && <span style={{ color: 'primary.light', marginLeft: 8 }}>· 增量:{mapping.incremental_column}</span>}
          </Typography>
        </Box>
        <Chip size="small" label={mapping.enabled === false ? '停用' : '启用'} color={mapping.enabled === false ? 'default' : 'success'} variant="outlined" sx={{ height: 22 }} />
      </Box>
      <Tooltip title="字段映射">
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            onEditColumns(mapping.id);
          }}
          sx={{ color: 'primary.main', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'primary.main' } }}
        >
          <AccountTreeIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
      <Tooltip title="增量同步">
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            setIncrementalDialogFor(mapping.id);
          }}
          sx={{ color: mapping.incremental_column ? 'primary.light' : 'text.secondary', border: '1px solid', borderColor: 'divider', '&:hover': { borderColor: 'primary.main' } }}
        >
          <UpdateIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Tooltip>
    </Box>)}
    <IncrementalDialog open={!!incrementalDialogFor} mapping={incrementalDialogFor ? list.find((m) => m.id === incrementalDialogFor) : null} onClose={() => setIncrementalDialogFor(null)} />
  </Box>;
};
export default MappingListPanel;