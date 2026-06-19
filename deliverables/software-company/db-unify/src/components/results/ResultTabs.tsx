import React, { useState, useEffect, useMemo } from 'react';
import { Box, Tabs, Tab, Fade, Badge } from '@mui/material';
import AggregateView from './AggregateView';
import CompareView from './CompareView';
import SingleDbView from './SingleDbView';
import { useResultStore } from '../../stores/resultStore';
import { useExecutionStore } from '../../stores/executionStore';
import { ExecutionStatus } from '../../types/execution';

interface ResultTabsProps {
  showExecution?: boolean;
}

const ResultTabs: React.FC<ResultTabsProps> = ({ showExecution = false }) => {
  const [activeTab, setActiveTab] = useState(0);
  const selectedDbId = useResultStore((s) => s.selectedDbId);
  const tasks = useExecutionStore((s) => s.tasks);

  const { successCount, failCount, totalCount } = useMemo(() => {
    const finished = tasks.filter(t => t.status !== ExecutionStatus.Pending && t.status !== ExecutionStatus.Running);
    const success = finished.filter(t => t.status === ExecutionStatus.Success).length;
    const fail = finished.filter(t => t.status === ExecutionStatus.Failed || t.status === ExecutionStatus.Timeout).length;
    return { successCount: success, failCount: fail, totalCount: finished.length };
  }, [tasks]);

  useEffect(() => {
    if (selectedDbId) {
      setActiveTab(0);
    }
  }, [selectedDbId]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <Tabs
        value={activeTab}
        onChange={(_, val) => setActiveTab(val)}
        sx={{ minHeight: 36, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab label="单库详情" sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.85rem' }} />
        <Tab label="聚合视图" sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.85rem' }} />
        <Tab label="对比视图" sx={{ minHeight: 36, textTransform: 'none', fontSize: '0.85rem' }} />
        {totalCount > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, ml: 2, pr: 1 }}>
            {successCount > 0 && (
              <Badge badgeContent={successCount} color="success" sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem', minWidth: 18, height: 18 } }}>
                <Box sx={{ width: 8 }} />
              </Badge>
            )}
            {failCount > 0 && (
              <Badge badgeContent={failCount} color="error" sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem', minWidth: 18, height: 18 } }}>
                <Box sx={{ width: 8 }} />
              </Badge>
            )}
          </Box>
        )}
      </Tabs>
      <Box sx={{ flex: 1, overflow: 'hidden', minHeight: 0 }}>
        <Fade in={activeTab === 0} unmountOnExit>
          <Box sx={{ height: '100%' }}>
            {activeTab === 0 && <SingleDbView />}
          </Box>
        </Fade>
        <Fade in={activeTab === 1} unmountOnExit>
          <Box sx={{ height: '100%' }}>
            {activeTab === 1 && <AggregateView />}
          </Box>
        </Fade>
        <Fade in={activeTab === 2} unmountOnExit>
          <Box sx={{ height: '100%' }}>
            {activeTab === 2 && <CompareView />}
          </Box>
        </Fade>
      </Box>
    </Box>
  );
};

export default ResultTabs;
