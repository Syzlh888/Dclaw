/**
 * DClaw 系统操作指南
 * 点击右上角帮助图标弹出
 */
import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stepper,
  Step,
  StepLabel,
  Divider,
  Chip,
  IconButton,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import CodeIcon from '@mui/icons-material/Code';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TableChartIcon from '@mui/icons-material/TableChart';
import AnalyticsIcon from '@mui/icons-material/Analytics';
import PaletteIcon from '@mui/icons-material/Palette';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import SchemaIcon from '@mui/icons-material/Schema';
import VpnKeyIcon from '@mui/icons-material/VpnKey';
import LanIcon from '@mui/icons-material/Lan';
import SettingsInputComponentIcon from '@mui/icons-material/SettingsInputComponent';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import SearchIcon from '@mui/icons-material/Search';
import CheckBoxIcon from '@mui/icons-material/CheckBox';
import DownloadIcon from '@mui/icons-material/Download';
import LightModeIcon from '@mui/icons-material/LightMode';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import CompareIcon from '@mui/icons-material/Compare';
import ViewListIcon from '@mui/icons-material/ViewList';

interface HelpGuideProps {
  open: boolean;
  onClose: () => void;
}

type SectionId =
  | 'overview'
  | 'tree'
  | 'connection'
  | 'editor'
  | 'results'
  | 'status'
  | 'groups'
  | 'other';

interface Section {
  id: SectionId;
  title: string;
  icon: React.ReactNode;
  content: string;
}

const SECTIONS: Section[] = [
  {
    id: 'overview',
    title: '概述',
    icon: <AnalyticsIcon />,
    content:
      'DClaw（数据钳）是一款多数据库统一查询工具，支持 MySQL、PostgreSQL、Oracle、SQL Server、达梦 DM、人大金仓、TDSQL 等多种数据库类型。' +
      '它提供统一的 SQL 编辑器，可以同时对多个数据库实例执行查询，查看执行状态，并对查询结果进行聚合分析和对比。',
  },
  {
    id: 'tree',
    title: '数据库树管理',
    icon: <AccountTreeIcon />,
    content:
      '左侧边栏的"数据库"标签下是四层树形结构，用于组织和管理所有数据库连接：\n\n' +
      '  第1层（项目/平台）—— 顶层分类，如"医保平台"、"HIS 系统"；\n' +
      '  第2层（业务模块）—— 如"门诊"、"住院"、"药品"等；\n' +
      '  第3层（区域节点）—— 如"市区"、"县区"；\n' +
      '  第4层（连接实例）—— 具体的医院/机构数据库连接。\n\n' +
      '操作说明：\n' +
      '  • 勾选复选框选择需要参与查询的实例；\n' +
      '  • 点击节点名称或左侧箭头展开/折叠子节点；\n' +
      '  • Hover 节点会显示操作按钮（新增/编辑/删除）；\n' +
      '  • 拖拽节点可调整同级排序；\n' +
      '  • 上方搜索框支持按名称过滤定位；\n' +
      '  • 实例节点前有在线状态指示灯（绿=在线，灰=离线，红=异常）；\n' +
      '  • 实例节点可点击展开按钮查看表结构（元数据浏览器）。',
  },
  {
    id: 'connection',
    title: '连接与驱动管理',
    icon: <LanIcon />,
    content:
      '右上角"连接管理"按钮可打开已配置的连接列表，支持新增/编辑/删除/测试连接。\n' +
      '右上角"驱动管理"按钮可查看和管理各数据库类型的 JDBC 驱动，支持上传、下载、启用/禁用。\n\n' +
      '添加连接的步骤：\n' +
      '  1. 确保对应数据库类型的驱动已安装启用；\n' +
      '  2. 在左侧树中定位到第3层（区域节点）；\n' +
      '  3. Hover 该节点，点击 ➕ 新增按钮；\n' +
      '  4. 填写连接信息（主机、端口、数据库名、用户名、密码）；\n' +
      '  5. 点击"测试连接"确认可用，再保存。',
  },
  {
    id: 'editor',
    title: 'SQL 编辑器与执行',
    icon: <CodeIcon />,
    content:
      '中央编辑区是 SQL 编辑器，支持语法高亮、自动补全、多标签编辑。\n\n' +
      '操作方式：\n' +
      '  • 直接在编辑器中编写 SQL 语句；\n' +
      '  • 点击 ▶ 执行按钮（或 Ctrl/Cmd+Enter）执行查询；\n' +
      '  • 系统会将同一 SQL 发送到所有已勾选的数据库实例并行执行；\n' +
      '  • 使用编辑器上方的数据库类型选择器筛选目标实例类型；\n' +
      '  • 分页查询可设置分页大小和偏移量；\n' +
      '  • 编辑器字体大小可通过右侧按钮独立调节（10-30px）；\n' +
      '  • 支持 Ctrl+Z/Y 撤销重做、查找替换等常用编辑功能。\n\n' +
      '执行前请确保在左侧数据库树中勾选了目标实例。',
  },
  {
    id: 'results',
    title: '查询结果查看',
    icon: <TableChartIcon />,
    content:
      '底部面板的"查询结果"标签页提供三种查看模式：\n\n' +
      '  单库详情 —— 下拉选择查看单个数据库的完整查询结果；\n' +
      '  聚合视图 —— 将所有数据库的结果按行合并展示，可多条件筛选来源；\n' +
      '  对比视图 —— 选择两个数据库，并排对比相同列的数据差异（不同/缺失/多余）。\n\n' +
      '通用功能：\n' +
      '  • 点击列头可按该列排序（升序/降序）；\n' +
      '  • 拖拽列头右侧边界可调整列宽；\n' +
      '  • 使用虚拟滚动高效渲染大量数据；\n' +
      '  • 导出 CSV 按钮可将当前结果导出为 CSV 文件。',
  },
  {
    id: 'status',
    title: '执行状态',
    icon: <ViewListIcon />,
    content:
      '底部面板的"执行状态"标签页展示每个数据库实例的 SQL 执行情况：\n\n' +
      '  • 顶部统计栏显示总计、成功、失败、执行中、等待、超时的数量和占比；\n' +
      '  • 堆叠进度条直观展示各状态分布；\n' +
      '  • 每个数据库实例卡片显示：实例名称、执行状态、耗时、错误信息；\n' +
      '  • 执行中实时更新进度，完成后显示结果行数；\n' +
      '  • 点击✅/❌图标可复制该实例的详细结果。\n\n' +
      '提示：勾选的实例数量过多时，建议分批执行以避免超时。',
  },
  {
    id: 'groups',
    title: '临时分组',
    icon: <GroupWorkIcon />,
    content:
      '左侧边栏的"分组"标签页支持创建临时数据库分组，便于批量操作同一批实例：\n\n' +
      '  • 创建分组：输入分组名称 → 从数据库树中勾选实例 → 保存；\n' +
      '  • 使用分组：在 SQL 编辑器上方的实例选择器中切换到分组视图；\n' +
      '  • 管理分组：可重命名、修改成员、删除分组；\n' +
      '  • 分组不会影响数据库树的原有结构，纯属快捷操作工具。',
  },
  {
    id: 'other',
    title: '其他功能',
    icon: <PaletteIcon />,
    content:
      '主题切换 —— 点击右上角 ☀/🌙 图标在亮色/暗色模式之间切换；\n' +
      '界面缩放 —— 右上角 🔍-/🔍+ 按钮调节整体界面大小（40%-150%，11档）；\n' +
      '元数据浏览 —— 展开第4层数据库节点可查看表结构和列详情，点击表格可生成 SELECT 语句；\n' +
      '执行历史 —— 底部"执行历史"标签页可回溯之前的执行记录和结果；\n' +
      '授权激活 —— 点击右下角状态栏的激活状态可查看详细信息，支持重新激活或重置。',
  },
];

const HelpGuide: React.FC<HelpGuideProps> = ({ open, onClose }) => {
  const [activeSection, setActiveSection] = useState<SectionId>('overview');

  const current = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];
  const currentIndex = SECTIONS.indexOf(current);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
        <Typography variant="h6" sx={{ flex: 1, fontWeight: 600 }}>
          DClaw 操作指南
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers sx={{ p: 0, display: 'flex', minHeight: 420 }}>
        {/* 左侧导航 */}
        <Box
          sx={{
            width: 200,
            flexShrink: 0,
            borderRight: '1px solid',
            borderColor: 'divider',
            py: 1,
            bgcolor: 'grey.50',
          }}
        >
          {SECTIONS.map((s) => {
            const isActive = s.id === activeSection;
            return (
              <Box
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 1,
                  cursor: 'pointer',
                  borderRadius: 0,
                  bgcolor: isActive ? 'primary.light' : 'transparent',
                  color: isActive ? 'white' : 'text.primary',
                  transition: 'all 0.15s',
                  '&:hover': {
                    bgcolor: isActive ? 'primary.light' : 'action.hover',
                  },
                }}
              >
                <Box sx={{ fontSize: 18, display: 'flex' }}>{s.icon}</Box>
                <Typography variant="body2" sx={{ fontWeight: isActive ? 600 : 400, fontSize: '0.8rem' }}>
                  {s.title}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {/* 右侧内容 */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', p: 2.5, overflow: 'auto' }}>
          {/* 章节导航 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2.5 }}>
            <Box sx={{ fontSize: 22, display: 'flex', color: 'primary.main' }}>
              {current.icon}
            </Box>
            <Typography variant="subtitle1" fontWeight={700}>
              {current.title}
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Chip
              label={`${currentIndex + 1} / ${SECTIONS.length}`}
              size="small"
              variant="outlined"
            />
          </Box>

          {/* 内容 */}
          <Box sx={{ flex: 1 }}>
            {current.content.split('\n').map((line, i) => {
              const trimmed = line.trim();
              if (!trimmed) return <Box key={i} sx={{ height: 8 }} />;

              // 标题行（不以 • 开头且不是空行）
              if (!trimmed.startsWith('•') && !trimmed.match(/^\d+\./)) {
                return (
                  <Typography
                    key={i}
                    variant="body2"
                    sx={{
                      fontWeight: 600,
                      color: 'text.primary',
                      fontSize: '1rem',
                      mb: 0.5,
                      mt: i > 0 && trimmed.length > 0 ? 0.5 : 0,
                    }}
                  >
                    {trimmed}
                  </Typography>
                );
              }

              // 项目符号行
              return (
                <Typography
                  key={i}
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                    fontSize: '0.95rem',
                    pl: 2,
                    mb: 0.25,
                    lineHeight: 1.6,
                  }}
                >
                  {trimmed}
                </Typography>
              );
            })}
          </Box>

          {/* 底部导航 */}
          <Divider sx={{ my: 2 }} />
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Button
              size="small"
              disabled={currentIndex === 0}
              onClick={() => {
                const prev = SECTIONS[currentIndex - 1];
                setActiveSection(prev.id);
              }}
            >
              ← 上一页
            </Button>
            <Button
              size="small"
              disabled={currentIndex === SECTIONS.length - 1}
              onClick={() => {
                const next = SECTIONS[currentIndex + 1];
                setActiveSection(next.id);
              }}
            >
              下一页 →
            </Button>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
};

export default HelpGuide;
