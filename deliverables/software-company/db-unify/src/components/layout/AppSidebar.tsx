import React, { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import TreeSearch from '../database-tree/TreeSearch';
import DatabaseTree from '../database-tree/DatabaseTree';
import GroupPanel from '../database-tree/GroupPanel';
import ResizableHandle from './ResizableHandle';

interface AppSidebarProps {
  width: number;
  onWidthChange: (delta: number) => void;
}

type SidebarTab = 'tree' | 'groups';

const AppSidebar: React.FC<AppSidebarProps> = ({ width, onWidthChange }) => {
  const [activeTab, setActiveTab] = useState<SidebarTab>('tree');

  return (
    <Box
      sx={{
        width,
        minWidth: 200,
        maxWidth: 600,
        borderRight: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: 'background.paper',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Tab 切换：数据库树 | 临时分组 */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="fullWidth"
        sx={{ minHeight: 36, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Tab
          value="tree"
          icon={<AccountTreeIcon sx={{ fontSize: 16 }} />}
          iconPosition="start"
          label="数据库"
          sx={{ minHeight: 36, py: 0, textTransform: 'none', fontSize: '0.8rem' }}
        />
        <Tab
          value="groups"
          icon={<GroupWorkIcon sx={{ fontSize: 16 }} />}
          iconPosition="start"
          label="分组"
          sx={{ minHeight: 36, py: 0, textTransform: 'none', fontSize: '0.8rem' }}
        />
      </Tabs>

      {activeTab === 'tree' ? (
        <>
          {/* 搜索区 - 固定顶部 */}
          <TreeSearch />

          {/* 数据库树 - 占满剩余空间，内部滚动 */}
          <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <DatabaseTree />
          </Box>
        </>
      ) : (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <GroupPanel />
        </Box>
      )}

      {/* 右侧拖拽调整大小的分割条 */}
      <ResizableHandle
        direction="vertical"
        onResize={onWidthChange}
        style={{ position: 'absolute', right: -2, top: 0, bottom: 0 }}
      />
    </Box>
  );
};

export default AppSidebar;
