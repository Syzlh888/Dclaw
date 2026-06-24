import React, { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useEditorStore } from '../../stores/editorStore';
import { useTreeStore } from '../../stores/treeStore';
import { fetchMetadata } from '../../services/metadataService';
import type { TableMeta, ColumnMeta } from '../../services/metadataService';
import type { EditorTheme } from '../../stores/editorStore';
import { parseTableAliases, getIdentifierBeforeDot } from '../../utils/sqlCompletionUtils';

// Lazy load Monaco Editor
const MonacoEditor = React.lazy(() =>
  import('@monaco-editor/react').then((mod) => ({ default: mod.Editor }))
);

/** 不同主题对应的加载占位背景色 */
const fallbackStyle: Record<EditorTheme, { bg: string; color: string }> = {
  'vs-dark': { bg: '#1E1E1E', color: '#888' },
  'vs': { bg: '#FFFFFF', color: '#999' },
  'hc-black': { bg: '#000000', color: '#FFF' },
  'hc-light': { bg: '#FFFFFF', color: '#000' },
};

interface SqlEditorProps {
  onExecute: () => void;
}

const SqlEditor: React.FC<SqlEditorProps> = ({ onExecute }) => {
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const setTabSql = useEditorStore((s) => s.setTabSql);
  const sql = useEditorStore((s) => s.sql);
  const setSql = useEditorStore((s) => s.setSql);
  const readOnlyMode = useEditorStore((s) => s.readOnlyMode);
  const editorTheme = useEditorStore((s) => s.editorTheme);
  const fontSize = useEditorStore((s) => s.fontSize);
  const editorRef = useRef<any>(null);
  const [zoomReady, setZoomReady] = useState(false);

  // 元数据缓存: connectionId -> TableMeta[]
  const [metadataCache, setMetadataCache] = useState<Record<string, TableMeta[]>>({});
  // 用 ref 保持最新缓存引用，解决 CompletionProvider 的 stale closure 问题
  const metadataCacheRef = useRef<Record<string, TableMeta[]>>({});
  useEffect(() => {
    metadataCacheRef.current = metadataCache;
  }, [metadataCache]);

  // 获取当前选中的数据库连接 ID 列表
  const selectedDbIds = useTreeStore((s) => s.selectedDbIds);
  const nodes = useTreeStore((s) => s.nodes);

  // 当选中库变化时，加载元数据
  useEffect(() => {
    if (selectedDbIds.length === 0) return;
    selectedDbIds.forEach(async (dbId) => {
      if (metadataCacheRef.current[dbId]) return; // 已缓存则跳过
      try {
        const tables = await fetchMetadata(dbId);
        // 立即更新 ref（不等待 React 渲染周期），避免 CompletionProvider 读到空缓存
        metadataCacheRef.current = { ...metadataCacheRef.current, [dbId]: tables };
        setMetadataCache(prev => ({ ...prev, [dbId]: tables }));
      } catch {
        // 静默失败，元数据加载非关键路径
      }
    });
  }, [selectedDbIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const fb = useMemo(() => fallbackStyle[editorTheme], [editorTheme]);

  /** 在 Monaco 加载后、编辑器创建前注册补全 Provider（空依赖：通过 metadataCacheRef 访问最新缓存） */
  const handleBeforeMount = useCallback((monaco: any) => {
    // ====== 统一的智能补全 Provider（列名 + 表名） ======
    monaco.languages.registerCompletionItemProvider('sql', {
      provideCompletionItems: (model: any, position: any) => {
        try {
          const lineContent = model.getLineContent(position.lineNumber);
          const textBeforeCursor = lineContent.slice(0, position.column - 1);

          // --- 优先级1: 列名补全（紧跟在 alias. 之后） ---
          const alias = getIdentifierBeforeDot(textBeforeCursor);
          if (alias) {
            const fullText = model.getValue();
            const tableMap = parseTableAliases(fullText);
            const realTableName = tableMap.get(alias);

            if (realTableName) {
              const cache = metadataCacheRef.current;
              const realTN = realTableName.toLowerCase();
              const tableOnly = realTN.includes('.') ? realTN.split('.').pop()! : realTN;

              let columns: ColumnMeta[] | null = null;
              for (const tables of Object.values(cache)) {
                const table = tables.find(t => {
                  const tn = t.name.toLowerCase();
                  return tn === realTN || tn === tableOnly;
                });
                if (table?.columns.length) {
                  columns = table.columns;
                  break;
                }
              }

              if (columns?.length) {
                const suggestions = columns.map((col: ColumnMeta) => ({
                  label: col.name,
                  kind: monaco.languages.CompletionItemKind.Field,
                  detail: `${col.type}${col.nullable ? '' : ' NOT NULL'}`,
                  documentation: col.comment || undefined,
                  insertText: col.name,
                }));
                return { suggestions };
              }
            }
          }

          // --- 优先级2: 表名补全（FROM/JOIN/逗号后） ---
          const fromJoinPat = /(?:FROM|JOIN|,)\s+$/i;
          const partialPat = /(?:FROM|JOIN|,)\s+\w*$/i;
          if (fromJoinPat.test(textBeforeCursor) || partialPat.test(textBeforeCursor)) {
            const cache = metadataCacheRef.current;
            const allTables: TableMeta[] = Object.values(cache).flat();
            if (allTables.length > 0) {
              const suggestions = allTables.map(t => ({
                label: t.name,
                kind: monaco.languages.CompletionItemKind.Class,
                detail: `${t.columns.length} columns`,
                documentation: t.comment || undefined,
                insertText: t.name,
              }));
              return { suggestions };
            }
          }

          return { suggestions: [] as any };
        } catch {
          return { suggestions: [] as any };
        }
      },
    });
  }, []);

  const handleEditorMount = useCallback((editor: any, _monaco: any) => {
    editorRef.current = editor;

    // Register Ctrl+Enter to execute
    editor.addAction({
      id: 'execute-sql',
      label: 'Execute SQL',
      keybindings: [/* KeyMod.CtrlCmd */ 2048 | /* KeyCode.Enter */ 3],
      run: () => {
        onExecute();
      },
    });

    // 输入 . 后强制触发 suggest widget（Monaco 某些版本 bug 兜底）
    editor.onKeyDown((e: any) => {
      if (e.browserEvent.key === '.') {
        // 等待 Monaco 的 completion provider 处理完，再强制弹窗
        setTimeout(() => {
          // 检查光标是否紧跟在标识符.之后
          const pos = editor.getPosition();
          const model = editor.getModel();
          if (!pos || !model) return;
          const lineContent = model.getLineContent(pos.lineNumber);
          const textBefore = lineContent.slice(0, pos.column - 1);
          if (getIdentifierBeforeDot(textBefore)) {
            editor.trigger('Keyboard', 'editor.action.triggerSuggest', {});
          }
        }, 100);
      }
    });

    editor.focus();
    setZoomReady(true);
  }, [onExecute]);

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        setTabSql(activeTabId, value);
        setSql(value);
      }
    },
    [activeTabId, setTabSql, setSql]
  );

  // Ctrl+Wheel zoom
  useEffect(() => {
    if (!zoomReady) return;
    const container = editorRef.current?.getDomNode?.()?.parentElement;
    if (!container) return;
    const handler = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -1 : 1;
        const currentSize = useEditorStore.getState().fontSize;
        useEditorStore.getState().setFontSize(Math.max(10, Math.min(30, currentSize + delta)));
      }
    };
    container.addEventListener('wheel', handler, { passive: false });
    return () => container.removeEventListener('wheel', handler);
  }, [zoomReady]);

  return (
    <Box sx={{ height: '100%', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <React.Suspense
        fallback={
          <Box
            sx={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: fb.bg,
              color: fb.color,
              fontSize: '0.85rem',
            }}
          >
            加载编辑器...
          </Box>
        }
      >
        <MonacoEditor
          height="100%"
          language="sql"
          theme={editorTheme}
          value={sql}
          onChange={handleChange}
          beforeMount={handleBeforeMount}
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize,
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            automaticLayout: true,
            padding: { top: 8 },
            suggestOnTriggerCharacters: true,
            quickSuggestions: { other: true, comments: false, strings: false },
            fixedOverflowWidgets: true,
          }}
        />
      </React.Suspense>
    </Box>
  );
};

export default SqlEditor;
