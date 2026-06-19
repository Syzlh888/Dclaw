import React from 'react';
import { Box } from '@mui/material';
import { useExecutionStore } from '../../stores/executionStore';
import ExecutionSummary from './ExecutionSummary';
import ExecutionItem from './ExecutionItem';
import { ExecutionStatus } from '../../types/execution';

const ExecutionPanel: React.FC = () => {
  const tasks = useExecutionStore((s) => s.tasks);
  const isExecuting = useExecutionStore((s) => s.currentExecutionId !== null);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <ExecutionSummary tasks={tasks} />
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {tasks.map((task) => (
          <ExecutionItem key={task.id} task={task} />
        ))}
      </Box>
      {tasks.length === 0 && (
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.disabled',
            fontSize: '0.9rem',
          }}
        >
          执行 SQL 后在此查看状态
        </Box>
      )}
    </Box>
  );
};

export default ExecutionPanel;
