import React, { useEffect, useState } from 'react';
import {
  Box, Tabs, Tab, Dialog, DialogActions, DialogContent, DialogTitle,
  Button, Typography, Snackbar, Alert, Tooltip,
} from '@mui/material';
import CleaningServicesIcon from '@mui/icons-material/CleaningServices';
import { useProxyStore } from '../../stores/proxyStore';
import ProxyStatusBar from './ProxyStatusBar';
import ProxyListPanel from './ProxyListPanel';
import ProxyDetailPanel from './ProxyDetailPanel';
import ProxyCreateDialog from './ProxyCreateDialog';
import DangerRulesPanel from './DangerRulesPanel';

const ProxyPage: React.FC = () => {
  const { connections, selectedId, loadConnections, loadProcessStatus, revokeConnection, runAuditCleanup } = useProxyStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'detail' | 'rules'>('detail');

  const selected = connections.find((c) => c.id === selectedId) || null;

  useEffect(() => {
    loadConnections();
    loadProcessStatus();
  }, [loadConnections, loadProcessStatus]);

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    const target = revokeTarget;
    setRevokeTarget(null);
    try {
      await revokeConnection(target);
      setSnackbar('代理连接已撤销');
    } catch (e) {
      setSnackbar(e instanceof Error ? `撤销失败：${e.message}` : '撤销失败');
    }
  };

  const handleCleanup = async () => {
    try {
      const r = await runAuditCleanup();
      if (r) setSnackbar(`清理完成：删除 ${r.deleted} 条审计记录`);
    } catch (e) {
      setSnackbar(e instanceof Error ? `清理失败：${e.message}` : '清理失败');
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default' }}>
      <ProxyStatusBar />
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ProxyListPanel onCreate={() => setCreateOpen(true)} onEdit={(id) => { useProxyStore.getState().selectConnection(id); }} />
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper', minHeight: 26 }}>
            <Tabs
              value={activeTab}
              onChange={(_, v) => setActiveTab(v)}
              sx={{
                minHeight: 26,
                '& .MuiTab-root': { minHeight: 26, fontSize: 'calc(0.66rem * var(--dc-scale, 1))', py: 0.1, px: 1.25, textTransform: 'none' },
                '& .MuiTabs-indicator': { height: 2 },
              }}
            >
              <Tab value="detail" label="连接详情" />
              <Tab value="rules" label="危险SQL规则" />
            </Tabs>
            <Box sx={{ flex: 1 }} />
            {activeTab === 'detail' && (
              <Tooltip title="手动触发审计日志清理（按当前 retention 配置）">
                <Button
                  size="small"
                  variant="text"
                  startIcon={<CleaningServicesIcon sx={{ fontSize: 'calc(0.78rem * var(--dc-scale, 1))' }} />}
                  onClick={handleCleanup}
                  sx={{ color: 'text.secondary', textTransform: 'none', fontSize: 'calc(0.62rem * var(--dc-scale, 1))', mr: 0.5 }}
                >
                  清理审计
                </Button>
              </Tooltip>
            )}
          </Box>
          <Box sx={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
            {activeTab === 'detail' ? (
              <ProxyDetailPanel
                connection={selected}
                onEdit={(id) => useProxyStore.getState().selectConnection(id)}
                onRevoke={(id) => setRevokeTarget(id)}
              />
            ) : (
              <DangerRulesPanel />
            )}
          </Box>
        </Box>
      </Box>

      <ProxyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setSnackbar('代理连接创建成功'); setCreateOpen(false); }}
      />

      <Dialog open={!!revokeTarget} onClose={() => setRevokeTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ color: 'text.primary', fontSize: 'calc(0.92rem * var(--dc-scale, 1))', pb: 0.75 }}>确认撤销</DialogTitle>
        <DialogContent sx={{ pt: '12px !important', py: 1.25 }}>
          <Typography sx={{ fontSize: 'calc(0.75rem * var(--dc-scale, 1))', color: 'text.secondary' }}>
            确定撤销该代理连接吗？撤销后外部用户将无法再连接，活动连接会被断开。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1 }}>
          <Button size="small" onClick={() => setRevokeTarget(null)} sx={{ color: 'text.secondary', textTransform: 'none' }}>取消</Button>
          <Button size="small" variant="contained" color="error" onClick={handleRevoke} sx={{ textTransform: 'none' }}>撤销</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snackbar} autoHideDuration={2500} onClose={() => setSnackbar(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" sx={{ fontSize: 'calc(0.7rem * var(--dc-scale, 1))' }}>{snackbar}</Alert>
      </Snackbar>
    </Box>
  );
};

export default ProxyPage;
