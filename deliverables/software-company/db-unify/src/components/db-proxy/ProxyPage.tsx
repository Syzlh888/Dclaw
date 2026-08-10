import React, { useEffect, useState } from 'react';
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Button, Typography, Snackbar, Alert } from '@mui/material';
import { useProxyStore } from '../../stores/proxyStore';
import ProxyStatusBar from './ProxyStatusBar';
import ProxyListPanel from './ProxyListPanel';
import ProxyDetailPanel from './ProxyDetailPanel';
import ProxyCreateDialog from './ProxyCreateDialog';

const ProxyPage: React.FC = () => {
  const { connections, selectedId, loadConnections, loadProcessStatus, revokeConnection } = useProxyStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

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

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: 'background.default' }}>
      <ProxyStatusBar />
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ProxyListPanel onCreate={() => setCreateOpen(true)} onEdit={(id) => { useProxyStore.getState().selectConnection(id); }} />
        <ProxyDetailPanel
          connection={selected}
          onEdit={(id) => useProxyStore.getState().selectConnection(id)}
          onRevoke={(id) => setRevokeTarget(id)}
        />
      </Box>

      <ProxyCreateDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => { setSnackbar('代理连接创建成功'); setCreateOpen(false); }}
      />

      <Dialog open={!!revokeTarget} onClose={() => setRevokeTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ color: 'text.primary', fontSize: '0.95rem', pb: 1 }}>确认撤销</DialogTitle>
        <DialogContent sx={{ pt: '12px !important' }}>
          <Typography sx={{ fontSize: '0.8rem', color: 'text.secondary' }}>
            确定撤销该代理连接吗？撤销后外部用户将无法再连接，活动连接会被断开。
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button size="small" onClick={() => setRevokeTarget(null)} sx={{ color: 'text.secondary', textTransform: 'none' }}>取消</Button>
          <Button size="small" variant="contained" color="error" onClick={handleRevoke} sx={{ textTransform: 'none' }}>撤销</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={!!snackbar} autoHideDuration={2500} onClose={() => setSnackbar(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Alert severity="success" variant="filled" sx={{ fontSize: '0.75rem' }}>{snackbar}</Alert>
      </Snackbar>
    </Box>
  );
};

export default ProxyPage;
