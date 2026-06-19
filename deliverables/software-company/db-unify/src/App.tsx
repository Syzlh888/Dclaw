import React, { useEffect, useState, useCallback } from 'react';
import { Box, Tabs, Tab, Snackbar, Alert, CircularProgress } from '@mui/material';

import AppHeader from './components/layout/AppHeader';
import AppSidebar from './components/layout/AppSidebar';
import StatusBar from './components/layout/StatusBar';
import SqlEditor from './components/sql-editor/SqlEditor';
import EditorToolbar from './components/sql-editor/EditorToolbar';
import ExecutionPanel from './components/execution/ExecutionPanel';
import ResultTabs from './components/results/ResultTabs';
import HistoryPanel from './components/history/HistoryPanel';
import ServerResourceView from './components/server-resource/ServerResourceView';
import AssetSummaryView from './components/server-resource/AssetSummaryView';
import ResizableHandle from './components/layout/ResizableHandle';
import ShortcutsDialog from './components/layout/ShortcutsDialog';
import LoginPage from './components/auth/LoginPage';
import ActivationPage from './components/auth/ActivationPage';
import { useTreeStore } from './stores/treeStore';
import { useConnectionStore } from './stores/connectionStore';
import { useEditorStore } from './stores/editorStore';
import { useExecutionStore } from './stores/executionStore';
import { useResultStore } from './stores/resultStore';
import { useAuthStore } from './stores/authStore';
import { useExecution } from './hooks/useExecution';

/** 授权状态接口 */
export interface LicenseStatus {
  status: 'activated' | 'trial' | 'trial_available' | 'trial_expired' | 'unknown';
  activated: boolean;
  isPermanent: boolean;
  expiryDate: string | null;
  activatedAt?: string;
  daysLeft: number | null;
  trialStart?: string;
  trialEnd?: string;
  remainingMs?: number;
  hoursLeft?: number;
  minsLeft?: number;
  statusText: string;
}

/** Error boundary wrapper */
class ErrorBoundary extends React.Component<
  { children: React.ReactNode; name?: string },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <Box
          sx={{
            p: 3, textAlign: 'center', color: 'error.main',
            bgcolor: '#FFF5F5', height: '100%',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Box sx={{ fontSize: '1.2rem', fontWeight: 600, mb: 1 }}>
            {this.props.name ? `${this.props.name} 出错` : '组件渲染出错'}
          </Box>
          <Box sx={{ fontSize: '0.85rem', color: 'text.secondary', maxWidth: 600 }}>
            {this.state.error?.message}
          </Box>
        </Box>
      );
    }
    return this.props.children;
  }
}

const App: React.FC = () => {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const checkAuth = useAuthStore((s) => s.checkAuth);
  // 开发环境：跳过激活页和登录页，直接进入主界面
  const isDev = import.meta.env.DEV;
  const authRequired = isDev ? false : (import.meta.env.PROD || !!import.meta.env.VITE_FORCE_AUTH);

  const loadTree = useTreeStore((s) => s.loadTree);
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const startHealthCheck = useConnectionStore((s) => s.startHealthCheck);
  const stopHealthCheck = useConnectionStore((s) => s.stopHealthCheck);
  const tasks = useExecutionStore((s) => s.tasks);
  const isExecuting = useEditorStore((s) => s.isExecuting);

  const [bottomTab, setBottomTab] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mainView, setMainView] = useState<'sql-editor' | 'server-resource' | 'asset-summary'>('sql-editor');  // Electron 激活状态（null=检测中，true/false 兼容旧逻辑）
  // 开发环境直接激活
  const [electronActivated, setElectronActivated] = useState<boolean | null>(isDev ? true : null);
  // 完整授权状态（含试用信息）
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);

  const isElectron = !isDev && typeof window !== 'undefined' && (
    !!(window as any).electronAPI ||
    navigator.userAgent.toLowerCase().includes('electron')
  );

  const [notify, setNotify] = useState<{ message: string; severity: 'success' | 'info' | 'warning' | 'error' } | null>(null);

  const getPersisted = (key: string, fallback: number) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        const v = parseInt(raw, 10);
        if (!isNaN(v)) return v;
      }
    } catch { /* ignore */ }
    return fallback;
  };

  const [sidebarWidth, setSidebarWidth] = useState(() => getPersisted('dc_sidebar_width', 320));
  const handleSidebarWidthChange = useCallback((delta: number) => {
    setSidebarWidth((prev) => {
      const next = Math.max(200, Math.min(600, prev + delta));
      try { localStorage.setItem('dc_sidebar_width', String(next)); } catch {}
      return next;
    });
  }, []);

  const [sqlEditorHeight, setSqlEditorHeight] = useState(() => getPersisted('dc_sql_editor_height', 260));
  const handleSqlEditorHeightChange = useCallback((delta: number) => {
    setSqlEditorHeight((prev) => {
      const next = Math.max(120, Math.min(800, prev + delta));
      try { localStorage.setItem('dc_sql_editor_height', String(next)); } catch {}
      return next;
    });
  }, []);

  const { handleExecute, handleStop } = useExecution();

  useEffect(() => { if (isExecuting) setBottomTab(0); }, [isExecuting]);

  const selectedDbId = useResultStore((s) => s.selectedDbId);
  useEffect(() => { if (selectedDbId) setBottomTab(1); }, [selectedDbId]);

  // 数据加载（激活或试用中才加载）
  useEffect(() => {
    if (!isElectron || electronActivated === true || (licenseStatus?.status === 'trial')) {
      loadTree();
      const timer = setTimeout(() => loadConnections(), 100);
      return () => clearTimeout(timer);
    }
  }, [loadTree, loadConnections, isElectron, electronActivated, licenseStatus?.status]);

  // 切换到 SQL 编辑器时，刷新连接和树数据（确保服务器资源中新增的实例已同步）
  useEffect(() => {
    if (mainView === 'sql-editor') {
      loadTree();
      const timer = setTimeout(() => loadConnections(), 100);
      return () => clearTimeout(timer);
    }
  }, [mainView, loadTree, loadConnections]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1' || (e.key === '?' && e.shiftKey)) {
        e.preventDefault();
        setShortcutsOpen(true);
        return;
      }
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('dc:save-script'));
      }
      if (e.ctrlKey && e.key === 'o') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('dc:open-scripts'));
      }
      if (e.shiftKey && e.altKey && e.key === 'F') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('dc:format-sql'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Health check（激活或试用中才启动）
  useEffect(() => {
    if (isElectron && electronActivated !== true && licenseStatus?.status !== 'trial') return;
    startHealthCheck();
    return () => stopHealthCheck();
  }, [startHealthCheck, stopHealthCheck, isElectron, electronActivated, licenseStatus?.status]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  // Electron 激活状态检测（含试用）
  useEffect(() => {
    if (!isElectron) { setElectronActivated(true); return; }
    const api = (window as any).electronAPI;
    if (!api || typeof api.checkLicense !== 'function') {
      console.warn('[DClaw] electronAPI 未注入');
      setElectronActivated(false);
      return;
    }
    api.checkLicense().then((status: LicenseStatus) => {
      setLicenseStatus(status);
      if (status.status === 'activated' || status.status === 'trial') {
        setElectronActivated(true);
      } else {
        // trial_available / trial_expired / unknown → 显示激活页
        setElectronActivated(false);
      }
    }).catch(() => {
      setElectronActivated(false);
    });
  }, [isElectron]);

  /** 激活成功回调 */
  const handleActivationSuccess = useCallback(() => {
    // 激活成功后重新获取完整状态
    const api = (window as any).electronAPI;
    if (api?.getLicenseStatus) {
      api.getLicenseStatus().then((status: LicenseStatus) => {
        setLicenseStatus(status);
        setElectronActivated(true);
      });
    } else {
      setElectronActivated(true);
    }
  }, []);

  /** 试用回调（用户点击"暂不注册，试用24h"） */
  const handleStartTrial = useCallback(async () => {
    const api = (window as any).electronAPI;
    if (api?.startTrial) {
      const result = await api.startTrial();
      if (result.success) {
        handleActivationSuccess();
      }
    }
  }, [handleActivationSuccess]);

  /** 从主界面跳转到激活页（重新激活） */
  const handleShowActivation = useCallback(() => {
    setElectronActivated(false);
  }, []);

  // 计算当前视图：activation 页面 / loading / main
  let view: 'activation' | 'loading' | 'main' = 'main';
  if (isElectron && electronActivated === null) {
    view = 'loading';
  } else if (isElectron && electronActivated === false) {
    view = 'activation';
  }

  // Global notify listener
  useEffect(() => {
    const handler = (e: Event) => setNotify((e as CustomEvent).detail);
    window.addEventListener('dc:notify', handler);
    return () => window.removeEventListener('dc:notify', handler);
  }, []);

  // 非 Electron 未登录 → 登录页
  if (!isElectron && authRequired && !isAuthenticated) return <LoginPage />;

  return (
    <ErrorBoundary name="App">
      {view === 'activation' ? (
        <ActivationPage onActivated={handleActivationSuccess} onStartTrial={handleStartTrial} licenseStatus={licenseStatus} />
      ) : view === 'loading' ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
          <CircularProgress />
        </Box>
      ) : (
        /* ===== 主应用界面 ===== */
        <Box sx={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <ErrorBoundary key="hdr" name="Header">
            <AppHeader mainView={mainView} onNavigate={setMainView} />
          </ErrorBoundary>

          {mainView === 'server-resource' ? (
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              <ErrorBoundary key="srv" name="服务器资源">
                <ServerResourceView />
              </ErrorBoundary>
            </Box>
          ) : mainView === 'asset-summary' ? (
            <Box sx={{ flex: 1, overflow: 'hidden' }}>
              <ErrorBoundary key="asum" name="资产汇总">
                <AssetSummaryView />
              </ErrorBoundary>
            </Box>
          ) : (
            <>
              <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
                <ErrorBoundary key="sbar" name="侧边栏">
                  <AppSidebar width={sidebarWidth} onWidthChange={handleSidebarWidthChange} />
                </ErrorBoundary>

                <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
                  <Box sx={{ height: sqlEditorHeight, display: 'flex', flexDirection: 'column', px: 1.5, pt: 1.5, overflow: 'hidden' }}>
                    <ErrorBoundary key="etb" name="工具栏">
                      <EditorToolbar onExecute={handleExecute} onStop={handleStop} isExecuting={isExecuting} />
                    </ErrorBoundary>
                    <ErrorBoundary key="sqle" name="SQL编辑器">
                      <Box sx={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
                        <React.Suspense fallback={
                          <Box sx={{ display:'flex',alignItems:'center',justifyContent:'center',height:'100%',color:'text.secondary',fontSize:'0.85rem' }}>
                            编辑器加载中...
                          </Box>
                        }>
                          <SqlEditor onExecute={handleExecute} />
                        </React.Suspense>
                      </Box>
                    </ErrorBoundary>
                  </Box>

                  <ResizableHandle direction="horizontal" onResize={handleSqlEditorHeightChange}
                    style={{ marginLeft: 8, marginRight: 8, borderRadius: 2 }} />

                  <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', borderTop: '2px solid', borderColor: 'divider' }}>
                    <Box sx={{ display: 'flex', borderBottom: '1px solid', borderColor: 'divider', bgcolor: '#FAFAFA' }}>
                      <Tabs value={bottomTab} onChange={(_, v) => setBottomTab(v)} sx={{ minHeight: 32 }}>
                        <Tab label={`执行状态${tasks.length > 0 ? ` (${tasks.length})` : ''}`} sx={{ minHeight: 32, textTransform: 'none', fontSize: '0.8rem' }} />
                        <Tab label="查询结果" sx={{ minHeight: 32, textTransform: 'none', fontSize: '0.8rem' }} />
                        <Tab label="执行历史" sx={{ minHeight: 32, textTransform: 'none', fontSize: '0.8rem' }} />
                      </Tabs>
                    </Box>
                    <Box sx={{ flex: 1, overflow: 'auto', p: 1, minHeight: 0 }}>
                      {bottomTab === 0 && <ErrorBoundary key="exec" name="执行面板"><ExecutionPanel /></ErrorBoundary>}
                      {bottomTab === 1 && <ErrorBoundary key="res" name="查询结果"><ResultTabs /></ErrorBoundary>}
                      {bottomTab === 2 && <ErrorBoundary key="hist" name="执行历史"><HistoryPanel /></ErrorBoundary>}
                    </Box>
                  </Box>
                </Box>
              </Box>

              <ErrorBoundary key="stbar" name="状态栏">
                <StatusBar licenseStatus={licenseStatus} isElectron={isElectron} onShowActivation={handleShowActivation} />
              </ErrorBoundary>
            </>
          )}

          <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

          <Snackbar open={!!notify} autoHideDuration={4000} onClose={() => setNotify(null)}
            anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
            {notify ? (
              <Alert onClose={() => setNotify(null)} severity={notify.severity} variant="filled" sx={{ width: '100%' }}>
                {notify.message}
              </Alert>
            ) : undefined}
          </Snackbar>

        </Box>
      )}
    </ErrorBoundary>
  );
};

export default App;
