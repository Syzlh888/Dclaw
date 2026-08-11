import React, { useEffect, useState } from 'react';
import {
  Box, Button, Chip, Divider, IconButton, MenuItem, Select, Switch, TextField,
  Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { useProxyStore } from '../../stores/proxyStore';
import type { DangerAction, DangerRiskLevel, ProxyDangerRule } from '../../types/proxy';

const RISK_OPTS: { value: DangerRiskLevel; label: string; color: string }[] = [
  { value: 'high', label: '高危', color: 'error.main' },
  { value: 'medium', label: '中危', color: 'warning.main' },
  { value: 'low', label: '低危', color: 'text.secondary' },
];

const ACTION_OPTS: { value: DangerAction; label: string }[] = [
  { value: 'block', label: '拦截' },
  { value: 'warn', label: '仅警告' },
];

/**
 * 危险SQL规则管理面板
 * 紧凑布局：DBeaver 风格（fontSize 0.7-0.85rem、紧凑按钮）
 */
const DangerRulesPanel: React.FC = () => {
  const { rules, rulesLoading, loadRules, createRule, updateRule, toggleRule, deleteRule } = useProxyStore();
  const [editing, setEditing] = useState<ProxyDangerRule | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  return (
    <Box sx={{ flex: 1, overflow: 'auto', bgcolor: 'background.default', p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography sx={{ color: 'text.primary', fontWeight: 600, fontSize: 'calc(0.85rem * var(--dc-scale, 1))' }}>
          危险SQL规则
        </Typography>
        <Chip
          size="small"
          label={`${rules.filter((r) => r.enabled).length} 启用 / 共 ${rules.length}`}
          sx={{ ml: 1, height: 18, fontSize: 'calc(0.6rem * var(--dc-scale, 1))', bgcolor: 'action.disabledBackground', color: 'text.secondary' }}
        />
        <Box sx={{ flex: 1 }} />
        <Button
          size="small"
          variant="text"
          startIcon={<AddIcon sx={{ fontSize: 'calc(0.875rem * var(--dc-scale, 1))' }} />}
          onClick={() => setCreating(true)}
          sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}
        >
          新建规则
        </Button>
        <Button size="small" variant="text" onClick={() => loadRules()} sx={{ color: 'primary.main', textTransform: 'none', fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
          刷新
        </Button>
      </Box>

      <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.65rem * var(--dc-scale, 1))', mb: 1, lineHeight: 1.3 }}>
        匹配 SQL 去除注释后的首词（按整词、不区分大小写）。命中后按 action 决定拦截或仅警告。
      </Typography>

      <Divider sx={{ borderColor: 'divider', mb: 1 }} />

      {(creating || editing) && (
        <RuleEditor
          rule={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSubmit={async (payload) => {
            if (editing) {
              const r = await updateRule(editing.id, payload);
              if (r) { setEditing(null); }
            } else {
              const r = await createRule(payload);
              if (r) { setCreating(false); }
            }
          }}
        />
      )}

      {rulesLoading ? (
        <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', py: 2, textAlign: 'center' }}>加载中…</Typography>
      ) : rules.length === 0 ? (
        <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.7rem * var(--dc-scale, 1))', py: 2, textAlign: 'center' }}>
          暂无规则（点击右上角"新建规则"添加）
        </Typography>
      ) : (
        rules.map((r) => (
          <Box
            key={r.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              py: 0.5,
              borderBottom: '1px solid',
              borderColor: 'divider',
              opacity: r.enabled ? 1 : 0.55,
            }}
          >
            <Switch
              size="small"
              checked={r.enabled}
              onChange={() => toggleRule(r.id)}
              sx={{ '& .MuiSwitch-thumb': { width: 12, height: 12 } }}
            />
            <Typography
              sx={{
                color: r.enabled ? 'text.primary' : 'text.disabled',
                fontFamily: 'monospace',
                fontSize: 'calc(0.75rem * var(--dc-scale, 1))',
                fontWeight: 600,
                width: 120,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.keyword}
            </Typography>
            <Chip
              size="small"
              label={(RISK_OPTS.find((o) => o.value === r.risk_level) || RISK_OPTS[0]).label}
              sx={{
                height: 16,
                fontSize: 'calc(0.6rem * var(--dc-scale, 1))',
                color: (RISK_OPTS.find((o) => o.value === r.risk_level) || RISK_OPTS[0]).color,
                bgcolor: 'action.disabledBackground',
              }}
            />
            <Chip
              size="small"
              label={r.action === 'block' ? '拦截' : '警告'}
              sx={{
                height: 16,
                fontSize: 'calc(0.6rem * var(--dc-scale, 1))',
                color: r.action === 'block' ? 'error.main' : 'warning.main',
                bgcolor: 'action.disabledBackground',
              }}
            />
            <Typography
              sx={{
                color: 'text.disabled',
                fontSize: 'calc(0.65rem * var(--dc-scale, 1))',
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {r.description || '—'}
            </Typography>
            <Typography sx={{ color: 'text.disabled', fontSize: 'calc(0.6rem * var(--dc-scale, 1))' }}>#{r.sort_order}</Typography>
            <Tooltip title="编辑">
              <IconButton size="small" onClick={() => setEditing(r)} sx={{ p: 0.3 }}>
                <EditIcon sx={{ fontSize: 'calc(0.75rem * var(--dc-scale, 1))' }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="删除">
              <IconButton
                size="small"
                onClick={() => {
                  if (confirm(`确定删除规则 "${r.keyword}" ？`)) deleteRule(r.id);
                }}
                sx={{ p: 0.3 }}
              >
                <DeleteIcon sx={{ fontSize: 'calc(0.75rem * var(--dc-scale, 1))', color: 'error.main' }} />
              </IconButton>
            </Tooltip>
          </Box>
        ))
      )}
    </Box>
  );
};

interface EditorProps {
  rule: ProxyDangerRule | null;
  onClose: () => void;
  onSubmit: (payload: {
    keyword: string;
    risk_level: DangerRiskLevel;
    action: DangerAction;
    enabled: boolean;
    sort_order: number;
    description?: string;
  }) => Promise<void>;
}

const RuleEditor: React.FC<EditorProps> = ({ rule, onClose, onSubmit }) => {
  const [keyword, setKeyword] = useState(rule?.keyword || '');
  const [riskLevel, setRiskLevel] = useState<DangerRiskLevel>(rule?.risk_level || 'high');
  const [action, setAction] = useState<DangerAction>(rule?.action || 'block');
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [sortOrder, setSortOrder] = useState<number>(rule?.sort_order || 0);
  const [description, setDescription] = useState(rule?.description || '');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!keyword.trim()) return;
    setBusy(true);
    try {
      await onSubmit({
        keyword: keyword.trim(),
        risk_level: riskLevel,
        action,
        enabled,
        sort_order: sortOrder,
        description: description.trim() || undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ bgcolor: 'action.hover', p: 1, borderRadius: 1, mb: 1 }}>
      <Typography sx={{ color: 'text.primary', fontSize: 'calc(0.75rem * var(--dc-scale, 1))', fontWeight: 600, mb: 0.75 }}>
        {rule ? '编辑规则' : '新建规则'}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 0.75, mb: 0.75 }}>
        <TextField
          size="small"
          label="关键字"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value.toUpperCase())}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }, '& .MuiInputLabel-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' } }}
        />
        <TextField
          select
          size="small"
          label="风险等级"
          value={riskLevel}
          onChange={(e) => setRiskLevel(e.target.value as DangerRiskLevel)}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }, '& .MuiInputLabel-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' } }}
        >
          {RISK_OPTS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
        <TextField
          select
          size="small"
          label="动作"
          value={action}
          onChange={(e) => setAction(e.target.value as DangerAction)}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }, '& .MuiInputLabel-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' } }}
        >
          {ACTION_OPTS.map((o) => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
        </TextField>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 0.75, mb: 0.75, alignItems: 'center' }}>
        <TextField
          size="small"
          type="number"
          label="排序"
          value={sortOrder}
          onChange={(e) => setSortOrder(parseInt(e.target.value, 10) || 0)}
          sx={{ '& .MuiInputBase-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }, '& .MuiInputLabel-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' } }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Switch
            size="small"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            sx={{ '& .MuiSwitch-thumb': { width: 12, height: 12 } }}
          />
          <Typography sx={{ color: 'text.secondary', fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>{enabled ? '启用' : '停用'}</Typography>
        </Box>
        <Box />
      </Box>
      <TextField
        size="small"
        fullWidth
        label="描述（可选）"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        sx={{ mb: 0.75, '& .MuiInputBase-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }, '& .MuiInputLabel-root': { fontSize: 'calc(0.7rem * var(--dc-scale, 1))' } }}
      />
      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
        <Button size="small" onClick={onClose} disabled={busy} sx={{ color: 'text.secondary', textTransform: 'none', fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
          取消
        </Button>
        <Button size="small" variant="contained" onClick={submit} disabled={busy || !keyword.trim()} sx={{ textTransform: 'none', fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>
          {rule ? '保存' : '创建'}
        </Button>
      </Box>
    </Box>
  );
};

export default DangerRulesPanel;