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

  // 获取当前选中的数据库连接 ID 列表
  const selectedDbIds = useTreeStore((s) => s.selectedDbIds);
  const nodes = useTreeStore((s) => s.nodes);

  // 当选中库变化时，加载元数据
  useEffect(() => {
    if (selectedDbIds.length === 0) return;
    const controller = new AbortController();
    selectedDbIds.forEach(async (dbId) => {
      if (metadataCache[dbId]) return; // 已缓存则跳过
      try {
        const tables = await fetchMetadata(dbId);
        setMetadataCache(prev => ({ ...prev, [dbId]: tables }));
      } catch {
        // 静默失败
      }
    });
    return () => controller.abort();
  }, [selectedDbIds]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 从所有已缓存的库中查找指定表的列 */
  const findTableColumns = useCallback(
    (tableName: string): ColumnMeta[] | null => {
      for (const dbId of Object.keys(metadataCache)) {
        const tables = metadataCache[dbId];
        const table = tables.find(
          t => t.name.toLowerCase() === tableName.toLowerCase()
        );
        if (table && table.columns.length > 0) return table.columns;
      }
      return null;
    },
    [metadataCache]
  );

  const fb = useMemo(() => fallbackStyle[editorTheme], [editorTheme]);

  const handleEditorMount = useCallback((editor: any, monaco: any) => {
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

    // ====== 注册列名智能补全 Provider ======
    monaco.languages.registerCompletionItemProvider('sql', {
      triggerCharacters: ['.'],
      provideCompletionItems: (model: any, position: any) => {
        const textUntilPosition = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });

        // 检测是否是 alias. 模式
        const alias = getIdentifierBeforeDot(textUntilPosition);
        if (!alias) return { suggestions: [] };

        // 解析当前 SQL 中所有表名-别名映射
        const fullText = model.getValue();
        const tableMap = parseTableAliases(fullText);

        // 根据别名查找实际表名
        const realTableName = tableMap.get(alias);
        if (!realTableName) return { suggestions: [] };

        // 查找该表的列信息
        const columns = findTableColumns(realTableName);
        if (!columns || columns.length === 0) return { suggestions: [] };

        // 构建补全建议
        const suggestions = columns.map(col => ({
          label: col.name,
          kind: monaco.CompletionItemKind.Field,
          detail: `${col.type}${col.nullable ? '' : ' NOT NULL'}`,
          documentation: col.comment || undefined,
          insertText: col.name,
          range: {
            startLineNumber: position.lineNumber,
            startColumn: position.column - alias.length - 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          },
        }));

        return { suggestions };
      },
    });

    // Focus editor
    editor.focus();
    setZoomReady(true);
  }, [onExecute, findTableColumns]);

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
          }}
        />
      </React.Suspense>
    </Box>
  );
};

export default SqlEditor;
