import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTreeStore } from '../../stores/treeStore';
import { CheckState } from '../../types/tree';

const SelectedCounter: React.FC = () => {
  const nodes = useTreeStore((s) => s.nodes);

  const total = Object.values(nodes).filter((n) => n.type === 'hospital').length;
  const checked = Object.values(nodes).filter(
    (n) => n.type === 'hospital' && n.checkState === CheckState.Checked
  ).length;

  return (
    <Box
      sx={{
        py: 1,
        px: 2,
        borderTop: '1px solid',
        borderColor: 'divider',
        bgcolor: '#F5F5F5',
      }}
    >
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        已选中 {checked} / 共 {total} 个数据库
      </Typography>
    </Box>
  );
};

export default SelectedCounter;
