import React, { useEffect, useState, useCallback } from 'react';
import { Box, Tabs, Tab, Snackbar, Alert } from '@mui/material';

import AppHeader from './components/layout/AppHeader';
import AppSidebar from './components/layout/AppSidebar';
import StatusBar from './components/layout/StatusBar';
import SqlEditor from './components/sql-editor/SqlEditor';
import EditorToolbar from './components/sql-editor/EditorToolbar';
import ExecutionPanel from './components/execution/ExecutionPanel';
import ResultTabs from './components/results/ResultTabs';
import HistoryPanel from './components/history/HistoryPanel';
import SqlViewPanel from './components/history/SqlViewPanel';
import ServerResourceView from './components/server-resource/ServerResourceView';
import ResizableHandle from './components/layout/ResizableHandle';
import ShortcutsDialog from './components/layout/ShortcutsDialog';
import LoginPage from './components/auth/LoginPage';
import ComprehensiveQueryView from './components/server-resource/ComprehensiveQueryView';
import { useTreeStore } from './stores/treeStore';
import { useConnectionStore } from './stores/connectionStore';
import { useEditorStore } from './stores/editorStore';
import { useExecutionStore } from './stores/executionStore';
import { useResultStore } from './stores/resultStore';
import { useAuthStore } from './stores/authStore';
import { useExecution } from './hooks/useExecution';

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
            bgcolor: 'error.light', height: '100%',
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
  // 开发环境：跳过登录页，依靠 refresh() 兜底为 admin
  // 生产环境：强制登录
  const isDev = import.meta.env.DEV;
  const requireLogin = import.meta.env.PROD && !import.meta.env.VITE_DISABLE_AUTH;

  const loadTree = useTreeStore((s) => s.loadTree);
  const loadConnections = useConnectionStore((s) => s.loadConnections);
  const startHealthCheck = useConnectionStore((s) => s.startHealthCheck);
  const stopHealthCheck = useConnectionStore((s) => s.stopHealthCheck);
  const tasks = useExecutionStore((s) => s.tasks);
  const isExecuting = useEditorStore((s) => s.isExecuting);

  const [bottomTab, setBottomTab] = useState(0);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [mainView, setMainView] = useState<'sql-editor' | 'server-resource' | 'comprehensive-query'>('sql-editor');

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

  // 数据加载
  useEffect(() => {
    if (requireLogin && !isAuthenticated) return;
    loadTree();
    const timer = setTimeout(() => loadConnections(), 100);
    return () => clearTimeout(timer);
  }, [loadTree, loadConnections, requireLogin, isAuthenticated]);

  // 切换到 SQL 编辑器时，刷新连接和树数据
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

  // Health check
  useEffect(() => {
    if (requireLogin && !isAuthenticated) return;
    startHealthCheck();
    return () => stopHealthCheck();
  }, [startHealthCheck, stopHealthCheck, requireLogin, isAuthenticated]);

  useEffect(() => {
    checkAuth();
    // 开发环境单机模式兜底: 让后端 /me 返回 admin
    if (isDev) {
      useAuthStore.getState().refresh().catch(() => {});
    }
  }, [checkAuth, isDev]);

  // Global notify listener
  useEffect(() => {
    const handler = (e: Event) => setNotify((e as CustomEvent).detail);
    window.addEventListener('dc:notify', handler);
    return () => window.removeEventListener('dc:notify', handler);
  }, []);

  // 生产环境未登录 → 登录页
  if (requireLogin && !isAuthenticated) return <LoginPage />;

  return (
    <ErrorBoundary name="App">
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
        ) : mainView === 'comprehensive-query' ? (
          <Box sx={{ flex: 1, overflow: 'hidden' }}>
            <ErrorBoundary key="query" name="综合查询">
              <ComprehensiveQueryView onBack={() => setMainView('server-resource')} />
            </ErrorBoundary>
          </Box>
        ) : (
          <>
            <Box sx={{ flex: 1, display: 'flex', overflow: 'hidden', bgcolor: 'background.default' }}>
              <ErrorBoundary key="sbar" name="侧边栏">
                <AppSidebar width={sidebarWidth} onWidthChange={handleSidebarWidthChange} />
              </ErrorBoundary>

              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, bgcolor: 'background.default' }}>
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
                  <Box sx={{ display: 'flex', borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'background.paper' }}>
                    <Tabs value={bottomTab} onChange={(_, v) => setBottomTab(v)} sx={{ minHeight: 32 }}>
                      <Tab label={`执行状态${tasks.length > 0 ? ` (${tasks.length})` : ''}`} sx={{ minHeight: 32, textTransform: 'none', fontSize: '0.8rem' }} />
                      <Tab label="查询结果" sx={{ minHeight: 32, textTransform: 'none', fontSize: '0.8rem' }} />
                      <Tab label="SQL查看" sx={{ minHeight: 32, textTransform: 'none', fontSize: '0.8rem' }} />
                      <Tab label="执行历史" sx={{ minHeight: 32, textTransform: 'none', fontSize: '0.8rem' }} />
                    </Tabs>
                  </Box>
                  <Box sx={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', p: 1, minHeight: 0 }}>
                    {bottomTab === 0 && <ErrorBoundary key="exec" name="执行面板"><ExecutionPanel /></ErrorBoundary>}
                    {bottomTab === 1 && <ErrorBoundary key="res" name="查询结果"><ResultTabs /></ErrorBoundary>}
                    {bottomTab === 2 && <ErrorBoundary key="sqlview" name="SQL查看"><SqlViewPanel /></ErrorBoundary>}
                    {bottomTab === 3 && <ErrorBoundary key="hist" name="执行历史"><HistoryPanel /></ErrorBoundary>}
                  </Box>
                </Box>
              </Box>
            </Box>

            <ErrorBoundary key="stbar" name="状态栏">
              <StatusBar />
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
    </ErrorBoundary>
  );
};

export default App;
