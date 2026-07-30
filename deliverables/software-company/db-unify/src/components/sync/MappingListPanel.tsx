import React from 'react';
import { Box, Button, Chip, Divider, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TableChartIcon from '@mui/icons-material/TableChart';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import { useSyncStore } from '../../stores/syncStore';

interface Props {
  onCreateMapping: () => void;
  /** 父组件提供：打开字段映射编辑器 */
  onEditColumns: (mappingId: string) => void;
}

const MappingListPanel: React.FC<Props> = ({ onCreateMapping, onEditColumns }) => {
  const { mappings, selectedTaskId, selectedMappingId, selectMapping } = useSyncStore();
  const list = mappings.filter((mapping) => mapping.task_id === selectedTaskId);
  const selected = list.find((mapping) => mapping.id === selectedMappingId);
  if (selected) return <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
      <Typography sx={{ color: '#EEE', fontWeight: 600 }}>字段映射</Typography>
      <Chip size="small" label={`${selected.column_mappings?.length || 0} 个字段`} sx={{ ml: 1, height: 20, color: '#BBB', bgcolor: '#4A4A4A' }} />
      <Box sx={{ flex: 1 }} />
      <Button
        size="small"
        startIcon={<AccountTreeIcon sx={{ fontSize: 16 }} />}
        onClick={() => onEditColumns(selected.id)}
        sx={{ color: '#42A5F5', border: '1px solid #42A5F5' }}
        variant="outlined"
      >
        字段映射
      </Button>
    </Box>
    <Typography sx={{ color: '#888', fontSize: 12, mb: 1.5 }}>{selected.source_table} → {selected.target_table}</Typography>
    <Box sx={{ bgcolor: '#3C3F41', border: '1px solid #505050', borderRadius: 1 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 30px 1fr 100px', p: 1, color: '#888', fontSize: 11 }}><span>源字段</span><span /><span>目标字段</span><span>类型</span></Box><Divider sx={{ borderColor: '#505050' }} />
      {(selected.column_mappings || []).map((column, index) => <Box key={`${column.source}-${index}`} sx={{ display: 'grid', gridTemplateColumns: '1fr 30px 1fr 100px', alignItems: 'center', p: 1, color: '#CCC', fontSize: 12, borderBottom: index < (selected.column_mappings?.length || 0) - 1 ? '1px solid #494949' : 0 }}><span>{column.source}</span><span>→</span><span>{column.target}</span><span style={{ color: '#888' }}>{column.type || '-'}</span></Box>)}
      {(selected.column_mappings || []).length === 0 && <Typography sx={{ p: 3, color: '#777', textAlign: 'center', fontSize: 12 }}>未配置字段映射（默认按同名字段同步）。点击右上「字段映射」配置。</Typography>}
    </Box>
  </Box>;
  return <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
    <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}><Typography sx={{ color: '#EEE', fontWeight: 600 }}>表映射</Typography><Chip size="small" label={list.length} sx={{ ml: 1, height: 20, color: '#BBB' }} /><Box sx={{ flex: 1 }} /><Button size="small" startIcon={<AddIcon />} onClick={onCreateMapping} sx={{ color: '#42A5F5' }}>新建映射</Button></Box>
    {list.length === 0 && <Typography sx={{ mt: 6, textAlign: 'center', color: '#777', fontSize: 13 }}>该任务暂无表映射</Typography>}
    {list.map((mapping) => <Box key={mapping.id} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, p: 1.5, mb: 1, bgcolor: '#3C3F41', border: '1px solid #505050', borderRadius: 1, '&:hover': { borderColor: '#42A5F5' } }}>
      <Box onClick={() => selectMapping(mapping.id)} sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flex: 1, minWidth: 0, cursor: 'pointer' }}>
        <TableChartIcon sx={{ color: '#90CAF9' }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: '#EEE', fontSize: 13 }}>{mapping.source_table} → {mapping.target_table}</Typography>
          <Typography sx={{ color: '#888', fontSize: 11 }}>{mapping.column_mappings?.length || 0} 个字段 · 顺序 {mapping.sequence ?? 0}</Typography>
        </Box>
        <Chip size="small" label={mapping.enabled === false ? '停用' : '启用'} color={mapping.enabled === false ? 'default' : 'success'} variant="outlined" sx={{ height: 22 }} />
      </Box>
      <Button
        size="small"
        startIcon={<AccountTreeIcon sx={{ fontSize: 14 }} />}
        onClick={(e) => {
          e.stopPropagation();
          onEditColumns(mapping.id);
        }}
        sx={{ color: '#42A5F5', border: '1px solid #4D4D4D', '&:hover': { borderColor: '#42A5F5' }, minWidth: 'auto', px: 1, fontSize: 11 }}
        variant="outlined"
      >
        字段映射
      </Button>
    </Box>)}
  </Box>;
};
export default MappingListPanel;
