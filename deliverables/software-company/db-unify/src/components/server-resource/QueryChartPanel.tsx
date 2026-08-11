/**
 * 综合查询 - 图表分析面板
 */
import React, { useMemo } from 'react';
import {
  Box, Typography, FormControl, Select, MenuItem, InputLabel,
} from '@mui/material';
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import type { QueryResult, QueryFieldGroup } from '../../types/server';

interface Props {
  queryResult: QueryResult | null;
  selectedFields: string[];
  fieldGroups: QueryFieldGroup[];
  chartType: 'bar' | 'pie' | 'line' | 'scatter';
  chartXField: string;
  chartYField: string;
  onChartTypeChange: (t: 'bar' | 'pie' | 'line' | 'scatter') => void;
  onXFieldChange: (f: string) => void;
  onYFieldChange: (f: string) => void;
}

const COLORS = ['#1976d2', '#4caf50', '#ff9800', '#f44336', '#9c27b0', '#00bcd4', '#795548', '#607d8b'];

const QueryChartPanel: React.FC<Props> = ({
  queryResult, fieldGroups, chartType, chartXField, chartYField,
  onChartTypeChange, onXFieldChange, onYFieldChange,
}) => {
  const numericFields = useMemo(() => {
    const all = fieldGroups.flatMap((g) => g.fields);
    return all.filter((f) => f.type === 'number').map((f) => f.key);
  }, [fieldGroups]);

  const allFields = useMemo(() => {
    return fieldGroups.flatMap((g) => g.fields);
  }, [fieldGroups]);

  const chartData = useMemo(() => {
    if (!queryResult || queryResult.rows.length === 0) return [];
    return queryResult.rows.slice(0, 100).map((row) => {
      const item: Record<string, any> = {};
      for (const col of queryResult.columns) {
        item[col.key] = row[col.key];
      }
      return item;
    });
  }, [queryResult]);

  const renderChart = () => {
    if (!queryResult || chartData.length === 0) {
      return <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>暂无数据，请先执行查询</Typography>;
    }

    if ((chartType === 'bar' || chartType === 'line') && (!chartXField || !chartYField)) {
      return <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>请选择 X 轴和 Y 轴字段</Typography>;
    }

    if (chartType === 'pie' && !chartYField) {
      return <Typography color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>请选择数值字段（Y轴）</Typography>;
    }

    switch (chartType) {
      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={350}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={chartXField} tick={{ fontSize: 'calc(0.625rem * var(--dc-scale, 1))' }} />
              <YAxis tick={{ fontSize: 'calc(0.625rem * var(--dc-scale, 1))' }} />
              <Tooltip />
              <Legend />
              <Bar dataKey={chartYField} fill="#1976d2" />
            </BarChart>
          </ResponsiveContainer>
        );
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={350}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey={chartXField} tick={{ fontSize: 'calc(0.625rem * var(--dc-scale, 1))' }} />
              <YAxis tick={{ fontSize: 'calc(0.625rem * var(--dc-scale, 1))' }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey={chartYField} stroke="#1976d2" />
            </LineChart>
          </ResponsiveContainer>
        );
      case 'pie': {
        // 聚合数据用于饼图
        const pieData: { name: string; value: number }[] = [];
        const aggMap = new Map<string, number>();
        if (chartXField) {
          for (const row of chartData) {
            const key = String(row[chartXField] || '未知');
            const val = Number(row[chartYField]) || 0;
            aggMap.set(key, (aggMap.get(key) || 0) + val);
          }
        }
        aggMap.forEach((v, k) => pieData.push({ name: k, value: v }));
        return (
          <ResponsiveContainer width="100%" height={350}>
            <PieChart>
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {pieData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        );
      }
      default:
        return null;
    }
  };

  return (
    <Box sx={{ p: 3, height: '100%', overflow: 'auto' }}>
      {/* 控制栏 */}
      <Box
        sx={{
          display: 'flex',
          gap: 2,
          mb: 3,
          flexWrap: 'wrap',
          alignItems: 'center',
          p: 2,
          bgcolor: 'background.paper',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <Typography variant="subtitle2" sx={{ mr: 1, fontWeight: 600, color: 'text.primary' }}>
          图表配置
        </Typography>

        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel>图表类型</InputLabel>
          <Select value={chartType} onChange={(e) => onChartTypeChange(e.target.value as any)} label="图表类型" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>
            <MenuItem value="bar" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>柱状图</MenuItem>
            <MenuItem value="pie" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>饼图</MenuItem>
            <MenuItem value="line" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>折线图</MenuItem>
          </Select>
        </FormControl>

        {(chartType === 'bar' || chartType === 'line' || chartType === 'pie') && (
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>分类字段（X轴）</InputLabel>
            <Select value={chartXField} onChange={(e) => onXFieldChange(e.target.value)} label="分类字段（X轴）" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>
              <MenuItem value="" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>请选择</MenuItem>
              {allFields.map((f) => (
                <MenuItem key={f.key} value={f.key} sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>{f.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>数值字段（Y轴）</InputLabel>
          <Select value={chartYField} onChange={(e) => onYFieldChange(e.target.value)} label="数值字段（Y轴）" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>
            <MenuItem value="" sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>请选择</MenuItem>
            {allFields.filter((f) => f.type === 'number' || numericFields.includes(f.key)).map((f) => (
              <MenuItem key={f.key} value={f.key} sx={{ fontSize: 'calc(0.8rem * var(--dc-scale, 1))' }}>{f.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* 图表区域 */}
      <Box
        sx={{
          width: '100%',
          minHeight: 350,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          bgcolor: 'background.paper',
          borderRadius: 1,
          border: '1px solid',
          borderColor: 'divider',
          p: 2,
        }}
      >
        {renderChart()}
      </Box>
    </Box>
  );
};

export default QueryChartPanel;
