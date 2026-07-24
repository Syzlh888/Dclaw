import React, { useState, useMemo, useCallback, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, CssBaseline } from '@mui/material';
import { createAppTheme } from './theme';
import { ThemeModeContext } from './contexts/ThemeModeContext';
import { useEditorStore } from './stores/editorStore';
import App from './App';
import './index.css';

type ThemeMode = 'light' | 'dark';

const SCALE_STEPS = [0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5];

const Root: React.FC = () => {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try { return (localStorage.getItem('dc_theme_mode') as ThemeMode) || 'light'; } catch { return 'light'; }
  });

  const [scale, setScale] = useState<number>(() => {
    try { const v = parseFloat(localStorage.getItem('dc_ui_scale') || '1'); return SCALE_STEPS.includes(v) ? v : 1; } catch { return 1; }
  });

  const toggleTheme = useCallback(() => {
    setMode((prev) => {
      const next = prev === 'light' ? 'dark' : 'light';
      try { localStorage.setItem('dc_theme_mode', next); } catch {}
      return next;
    });
  }, []);

  // 同步 data-theme 属性到 <html>（用于 CSS 选择器）
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', mode);
  }, [mode]);

  // 同步 Monaco 编辑器主题跟随应用主题
  useEffect(() => {
    const editorTheme = mode === 'dark' ? 'vs-dark' : 'vs';
    const store = useEditorStore.getState();
    store.setEditorTheme(editorTheme);
  }, [mode]);

  const handleSetScale = useCallback((s: number) => {
    setScale(s);
    try { localStorage.setItem('dc_ui_scale', String(s)); } catch {}
  }, []);

  const theme = useMemo(() => createAppTheme(mode, scale), [mode, scale]);
  const contextValue = useMemo(() => ({ mode, toggleTheme, scale, setScale: handleSetScale }), [mode, toggleTheme, scale, handleSetScale]);

  return (
    <ThemeModeContext.Provider value={contextValue}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </ThemeModeContext.Provider>
  );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
