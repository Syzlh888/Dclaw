import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, FormControl, InputLabel, Select, MenuItem,
  Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
} from '@mui/material';
import StorageIcon from '@mui/icons-material/Storage';
import DnsIcon from '@mui/icons-material/Dns';
import AppsIcon from '@mui/icons-material/Apps';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';

const AssetSummaryView: React.FC = () => {
  const summary = useServerStore(s => s.summary);
  const loadSummary = useServerStore(s => s.loadSummary);
  const servers = useServerStore(s => s.servers);
  const loadServers = useServerStore(s => s.loadServers);
  const projects = useProjectStore(s => s.projects);
  const loadProjects = useProjectStore(s => s.loadProjects);

  const [dimension, setDimension] = useState<'project' | 'engineering'>('project');
  const [selectedProjectId, setSelectedProjectId] = useState('');

  useEffect(() => { loadSummary(); loadServers(); loadProjects(); }, [loadSummary, loadServers, loadProjects]);

  const StatCard = ({ icon, label, value, color }: any) => (
    <Card sx={{ flex: 1, minWidth: 160 }}>
      <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Box sx={{ color, display: 'flex' }}>{icon}</Box>
          <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Box>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>{value}</Typography>
      </CardContent>
    </Card>
  );

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      <Typography variant="h6" sx={{ fontWeight: 600, mb: 2, fontSize: '1.1rem' }}>资产汇总分析</Typography>

      {/* 统计卡片 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
        <StatCard icon={<StorageIcon />} label="服务器总数" value={summary?.totalServers || 0} color="#1565C0" />
        <StatCard icon={<DnsIcon />} label="数据库实例" value={summary?.totalDbInstances || 0} color="#2E7D32" />
        <StatCard icon={<AppsIcon />} label="应用实例" value={summary?.totalAppInstances || 0} color="#ED6C02" />
      </Box>

      {/* 维度切换 */}
      <Box sx={{ display: 'flex', gap: 2, mb: 2, alignItems: 'center' }}>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>维度</InputLabel>
          <Select value={dimension} label="维度" onChange={e => setDimension(e.target.value as any)}>
            <MenuItem value="project">按项目</MenuItem>
            <MenuItem value="engineering">按工程</MenuItem>
          </Select>
        </FormControl>
        {dimension === 'engineering' && (
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>选择项目</InputLabel>
            <Select value={selectedProjectId} label="选择项目" onChange={e => setSelectedProjectId(e.target.value)}>
              <MenuItem value="">全部项目</MenuItem>
              {projects.map(p => <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>)}
            </Select>
          </FormControl>
        )}
      </Box>

      {/* OS 分布 */}
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>操作系统分布</Typography>
      {summary?.osDistribution && summary.osDistribution.length > 0 ? (
        <TableContainer sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>操作系统</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>数量</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>占比</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {summary.osDistribution.map(d => (
                <TableRow key={d.name}>
                  <TableCell sx={{ fontSize: '0.8rem' }}>{d.name}</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>{d.count}</TableCell>
                  <TableCell>
                    <Chip label={`${((d.count / summary.totalServers) * 100).toFixed(1)}%`} size="small"
                      sx={{ fontSize: '0.7rem' }} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>暂无数据</Typography>}

      {/* 服务器类型分布 */}
      <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, fontSize: '0.85rem' }}>服务器类型分布</Typography>
      {summary?.serverTypeDistribution && summary.serverTypeDistribution.length > 0 ? (
        <TableContainer sx={{ mb: 3 }}>
          <Table size="small">
            <TableHead><TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>类型</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '0.75rem' }}>数量</TableCell>
            </TableRow></TableHead>
            <TableBody>
              {summary.serverTypeDistribution.map(d => (
                <TableRow key={d.name}>
                  <TableCell sx={{ fontSize: '0.8rem' }}>{d.name}</TableCell>
                  <TableCell sx={{ fontSize: '0.8rem' }}>{d.count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      ) : <Typography variant="body2" color="text.secondary">暂无数据</Typography>}
    </Box>
  );
};

export default AssetSummaryView;
