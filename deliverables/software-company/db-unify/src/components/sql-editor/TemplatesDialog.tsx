import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, List, ListItem, ListItemButton, ListItemText,
  Typography, Box, Chip, TextField, ToggleButtonGroup, ToggleButton,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import StorageIcon from '@mui/icons-material/Storage';
import { DbDriver } from '../../types/connection';

interface Template {
  id: string;
  name: string;
  description: string;
  /** 各数据库方言对应的 SQL，键为 DbDriver 值 */
  sql: Record<string, string>;
  category: string;
}

/** 驱动标签映射 */
const driverLabels: Record<string, string> = {
  [DbDriver.MySQL]: 'MySQL',
  [DbDriver.PostgreSQL]: 'PostgreSQL',
  [DbDriver.Oracle]: 'Oracle',
  [DbDriver.SQLServer]: 'SQL Server',
};

/** 驱动优先级排序 */
const driverOrder = [DbDriver.MySQL, DbDriver.PostgreSQL, DbDriver.Oracle, DbDriver.SQLServer];

// ============================================================
// 内置模板 — 每个模板都提供 4 种数据库方言的等价 SQL
// ============================================================
const builtInTemplates: Template[] = [
  {
    id: '1',
    name: '表结构查询',
    description: '查看当前数据库中所有表的基本信息',
    category: '信息查询',
    sql: {
      [DbDriver.MySQL]: `SELECT
  TABLE_NAME,
  TABLE_TYPE,
  ENGINE,
  TABLE_ROWS,
  CREATE_TIME,
  TABLE_COMMENT
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;`,
      [DbDriver.PostgreSQL]: `SELECT
  table_name,
  table_type,
  (SELECT reltuples::bigint FROM pg_class WHERE oid = (quote_ident(table_schema) || '.' || quote_ident(table_name))::regclass) AS estimated_rows
FROM information_schema.tables
WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_name;`,
      [DbDriver.Oracle]: `SELECT
  table_name,
  tablespace_name,
  num_rows,
  last_analyzed
FROM user_tables
ORDER BY table_name;`,
      [DbDriver.SQLServer]: `SELECT
  t.name AS TABLE_NAME,
  CASE WHEN t.type = 'U' THEN 'BASE TABLE' ELSE 'VIEW' END AS TABLE_TYPE,
  p.rows AS TABLE_ROWS,
  t.create_date AS CREATE_TIME
FROM sys.tables t
LEFT JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
ORDER BY t.name;`,
    },
  },
  {
    id: '2',
    name: '表/库大小统计',
    description: '统计各表或数据库占用磁盘大小',
    category: '信息查询',
    sql: {
      [DbDriver.MySQL]: `SELECT
  table_schema AS 数据库,
  table_name AS 表名,
  ROUND((data_length + index_length) / 1024 / 1024, 2) AS 大小_MB,
  table_rows AS 行数
FROM information_schema.TABLES
WHERE table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
ORDER BY (data_length + index_length) DESC;`,
      [DbDriver.PostgreSQL]: `SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) AS size,
  pg_total_relation_size(schemaname || '.' || tablename) AS bytes
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
ORDER BY bytes DESC;`,
      [DbDriver.Oracle]: `SELECT
  segment_name AS 表名,
  segment_type AS 类型,
  SUM(bytes) / 1024 / 1024 AS 大小_MB
FROM user_segments
GROUP BY segment_name, segment_type
ORDER BY 大小_MB DESC;`,
      [DbDriver.SQLServer]: `SELECT
  t.name AS 表名,
  SUM(a.total_pages) * 8 / 1024 AS 大小_MB,
  SUM(p.rows) AS 行数
FROM sys.tables t
JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
JOIN sys.allocation_units a ON p.partition_id = a.container_id
GROUP BY t.name
ORDER BY 大小_MB DESC;`,
    },
  },
  {
    id: '3',
    name: '活动会话/慢查询',
    description: '查看当前正在执行的活跃查询',
    category: '性能诊断',
    sql: {
      [DbDriver.MySQL]: `SELECT
  id, user, host, db, command, time, state,
  LEFT(info, 200) AS query_preview
FROM information_schema.PROCESSLIST
WHERE command != 'Sleep'
ORDER BY time DESC;`,
      [DbDriver.PostgreSQL]: `SELECT
  pid, usename, application_name,
  client_addr, state,
  NOW() - query_start AS duration,
  LEFT(query, 200) AS query_preview
FROM pg_stat_activity
WHERE state = 'active'
  AND pid <> pg_backend_pid()
ORDER BY query_start;`,
      [DbDriver.Oracle]: `SELECT
  s.sid, s.serial#, s.username, s.status,
  s.last_call_et AS seconds_active,
  SUBSTR(q.sql_text, 1, 200) AS query_preview
FROM v$session s
LEFT JOIN v$sql q ON s.sql_id = q.sql_id
WHERE s.status = 'ACTIVE'
  AND s.username IS NOT NULL
ORDER BY s.last_call_et DESC;`,
      [DbDriver.SQLServer]: `SELECT
  r.session_id, s.login_name, r.status,
  r.total_elapsed_time / 1000 AS seconds_active,
  SUBSTRING(t.text, 1, 200) AS query_preview
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
WHERE r.status NOT IN ('background', 'sleeping')
ORDER BY r.total_elapsed_time DESC;`,
    },
  },
  {
    id: '4',
    name: '未使用索引检查',
    description: '查找可能从未使用过的索引',
    category: '性能诊断',
    sql: {
      [DbDriver.MySQL]: `SELECT
  object_schema AS 数据库,
  object_name AS 表名,
  index_name AS 索引名
FROM performance_schema.table_io_waits_summary_by_index_usage
WHERE index_name IS NOT NULL
  AND count_star = 0
  AND object_schema NOT IN ('mysql', 'performance_schema', 'sys')
ORDER BY object_schema, object_name;`,
      [DbDriver.PostgreSQL]: `SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan AS 扫描次数,
  idx_tup_read AS 读取行数
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY schemaname, tablename;`,
      [DbDriver.Oracle]: `SELECT
  index_name,
  table_name,
  status,
  last_analyzed
FROM user_indexes
WHERE status = 'UNUSABLE'
ORDER BY table_name;`,
      [DbDriver.SQLServer]: `SELECT
  o.name AS 表名,
  i.name AS 索引名,
  i.type_desc AS 索引类型,
  dm_ius.user_seeks,
  dm_ius.user_scans,
  dm_ius.user_lookups
FROM sys.indexes i
JOIN sys.objects o ON i.object_id = o.object_id
LEFT JOIN sys.dm_db_index_usage_stats dm_ius
  ON i.index_id = dm_ius.index_id AND i.object_id = dm_ius.object_id
WHERE o.type = 'U'
  AND dm_ius.user_seeks = 0
  AND dm_ius.user_scans = 0
  AND dm_ius.user_lookups = 0
  AND i.name IS NOT NULL
ORDER BY o.name;`,
    },
  },
  {
    id: '5',
    name: '数据巡检（行数+时间）',
    description: '统计各表行数及最后更新时间',
    category: '巡检脚本',
    sql: {
      [DbDriver.MySQL]: `SELECT
  TABLE_NAME,
  TABLE_ROWS,
  ROUND(DATA_LENGTH / 1024 / 1024, 2) AS data_mb,
  CREATE_TIME,
  UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_ROWS DESC;`,
      [DbDriver.PostgreSQL]: `SELECT
  schemaname,
  tablename,
  n_live_tup AS 预估行数,
  n_dead_tup AS 死行数,
  last_vacuum,
  last_analyze
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;`,
      [DbDriver.Oracle]: `SELECT
  table_name,
  num_rows,
  last_analyzed,
  ROUND((SELECT SUM(bytes) FROM user_segments WHERE segment_name = t.table_name) / 1024 / 1024, 2) AS size_mb
FROM user_tables t
ORDER BY num_rows DESC NULLS LAST;`,
      [DbDriver.SQLServer]: `SELECT
  t.name AS 表名,
  SUM(p.rows) AS 行数,
  t.create_date,
  t.modify_date
FROM sys.tables t
JOIN sys.partitions p ON t.object_id = p.object_id AND p.index_id IN (0, 1)
GROUP BY t.name, t.create_date, t.modify_date
ORDER BY SUM(p.rows) DESC;`,
    },
  },
  {
    id: '6',
    name: '重复数据检查',
    description: '按指定字段查重（使用时替换占位符）',
    category: '巡检脚本',
    sql: {
      [DbDriver.MySQL]: `-- 请替换 表名 / 字段1,字段2 / 保留条件
SELECT
  字段1, 字段2,
  COUNT(*) AS 重复次数
FROM 表名
GROUP BY 字段1, 字段2
HAVING COUNT(*) > 1
ORDER BY 重复次数 DESC;`,
      [DbDriver.PostgreSQL]: `-- 请替换 表名 / 字段1,字段2 / 保留条件
SELECT
  字段1, 字段2,
  COUNT(*) AS 重复次数
FROM 表名
GROUP BY 字段1, 字段2
HAVING COUNT(*) > 1
ORDER BY 重复次数 DESC;`,
      [DbDriver.Oracle]: `-- 请替换 表名 / 字段1,字段2 / 保留条件
SELECT
  字段1, 字段2,
  COUNT(*) AS 重复次数
FROM 表名
GROUP BY 字段1, 字段2
HAVING COUNT(*) > 1
ORDER BY 重复次数 DESC;`,
      [DbDriver.SQLServer]: `-- 请替换 表名 / 字段1,字段2 / 保留条件
SELECT
  字段1, 字段2,
  COUNT(*) AS 重复次数
FROM 表名
GROUP BY 字段1, 字段2
HAVING COUNT(*) > 1
ORDER BY 重复次数 DESC;`,
    },
  },
];

interface TemplatesDialogProps {
  open: boolean;
  onClose: () => void;
  onInsert: (sql: string) => void;
}

const TemplatesDialog: React.FC<TemplatesDialogProps> = ({ open, onClose, onInsert }) => {
  const [searchText, setSearchText] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedDriver, setSelectedDriver] = useState<string>(DbDriver.MySQL);

  const categories = Array.from(new Set(builtInTemplates.map(t => t.category)));

  const filtered = builtInTemplates.filter(t => {
    if (selectedCategory && t.category !== selectedCategory) return false;
    if (searchText && !t.name.includes(searchText) && !t.description.includes(searchText)) return false;
    return true;
  });

  /** 获取模板在当前选中驱动下的 SQL，若该驱动无适配版本则回退到 MySQL */
  const getSql = (t: Template): string => {
    return t.sql[selectedDriver] || t.sql[DbDriver.MySQL] || '';
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>SQL 模板库</DialogTitle>
      <DialogContent dividers sx={{ minHeight: 450 }}>
        {/* 数据库类型切换 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <StorageIcon fontSize="small" color="action" />
          <ToggleButtonGroup
            size="small"
            value={selectedDriver}
            exclusive
            onChange={(_, val) => val && setSelectedDriver(val)}
          >
            {driverOrder.map(driver => (
              <ToggleButton key={driver} value={driver} sx={{ px: 1.5, py: 0.4, fontSize: '0.75rem', textTransform: 'none' }}>
                {driverLabels[driver]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        {/* 搜索 & 分类筛选 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="搜索模板..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            sx={{ flex: 1, minWidth: 180, maxWidth: 260 }}
            inputProps={{ style: { paddingTop: 4, paddingBottom: 4 } }}
          />
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            <Chip
              label="全部"
              size="small"
              color={!selectedCategory ? 'primary' : 'default'}
              onClick={() => setSelectedCategory(null)}
              variant={!selectedCategory ? 'filled' : 'outlined'}
            />
            {categories.map(cat => (
              <Chip
                key={cat}
                label={cat}
                size="small"
                color={selectedCategory === cat ? 'primary' : 'default'}
                onClick={() => setSelectedCategory(cat)}
                variant={selectedCategory === cat ? 'filled' : 'outlined'}
              />
            ))}
          </Box>
        </Box>

        <List dense disablePadding>
          {filtered.map(t => {
            const currentSql = getSql(t);
            return (
              <ListItem
                key={t.id}
                disablePadding
                secondaryAction={
                  <Button
                    size="small"
                    startIcon={<ContentCopyIcon sx={{ fontSize: 14 }} />}
                    onClick={() => onInsert(currentSql)}
                    sx={{ textTransform: 'none', fontSize: '0.75rem' }}
                  >
                    使用
                  </Button>
                }
                sx={{
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <ListItemButton onClick={() => onInsert(currentSql)} sx={{ py: 1 }}>
                  <ListItemText
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{t.name}</Typography>
                        <Chip label={t.category} size="small" variant="outlined" sx={{ fontSize: '0.65rem', height: 18 }} />
                        <Chip
                          label={driverLabels[selectedDriver]}
                          size="small"
                          icon={<StorageIcon sx={{ fontSize: 12 }} />}
                          sx={{ fontSize: '0.65rem', height: 18 }}
                        />
                      </Box>
                    }
                    secondary={
                      <>
                        <Typography variant="caption" color="text.secondary">{t.description}</Typography>
                        <Box
                          component="pre"
                          sx={{
                            mt: 0.5,
                            p: 0.75,
                            fontSize: '0.7rem',
                            bgcolor: 'grey.50',
                            borderRadius: 0.5,
                            maxHeight: 70,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'pre-wrap',
                            fontFamily: 'monospace',
                            color: 'text.secondary',
                            border: '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          {currentSql}
                        </Box>
                      </>
                    }
                  />
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
        {filtered.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.disabled' }}>未找到匹配的模板</Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
      </DialogActions>
    </Dialog>
  );
};

export default TemplatesDialog;
