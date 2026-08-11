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
  const setSelectedSql = useEditorStore((s) => s.setSelectedSql);
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

  /** 在 Monaco 加载后、编辑器创建前注册补全 Provider 和自定义暗色主题 */
  const handleBeforeMount = useCallback((monaco: any) => {
    // ====== DBeaver 风格自定义暗色主题 ======
    monaco.editor.defineTheme('dc-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        // DBeaver 语法高亮色
        { token: 'keyword', foreground: '#DAAA4E' },      // SELECT, FROM, WHERE 等关键字 → 金橙色
        { token: 'string', foreground: '#6A8759' },       // 字符串 → 绿色
        { token: 'number', foreground: '#6897BB' },       // 数字 → 蓝色
        { token: 'type', foreground: '#4DB8E6' },         // 类型 → 数据蓝
        { token: 'function', foreground: '#DCDCAA' },     // 函数 → 浅黄
        { token: 'comment', foreground: '#6A9955', fontStyle: 'italic' },  // 注释 → 绿色斜体
        { token: 'identifier', foreground: '#A9D4E3' },   // 标识符 → 浅青
        { token: 'delimiter', foreground: '#BBBBBB' },    // 分隔符 → 主文字色
        { token: 'operator', foreground: '#D4D4D4' },     // 运算符 → 浅灰
        { token: 'variable', foreground: '#9CDCFE' },     // 变量 → 淡蓝
        { token: 'attribute', foreground: '#A9C6D9' },    // 属性 → 浅灰蓝
      ],
      colors: {
        'editor.background': '#2B2B2B',                    // DBeaver 主背景
        'editor.foreground': '#BBBBBB',                    // 主文字色
        'editor.lineHighlightBackground': '#3C3F4180',     // 当前行高亮
                'editor.selectionBackground': '#42A5F5CC',          // 选中背景：DBeaver 强调蓝 + alpha，鲜明对比
                'editor.inactiveSelectionBackground': '#42A5F566', // 非聚焦时的选中
                'editor.selectionHighlightBackground': '#42A5F566', // 词选中高亮
        'editorCursor.foreground': '#DAAA4E',              // 光标金色
        'editorLineNumber.foreground': '#555555',          // 行号
        'editorLineNumber.activeForeground': '#BBBBBB',    // 当前行号
        'editor.separator': '#4B4B4B',                     // 分割线
        'editorRuler.foreground': '#4B4B4B',
        'editorWidget.background': '#2B2B2B',
        'editorWidget.border': '#4B4B4B',
        'editorSuggestWidget.background': '#2B2B2B',
        'editorSuggestWidget.border': '#4B4B4B',
        'editorSuggestWidget.selectedBackground': '#3C3F41',
        'input.background': '#3C3F41',
        'input.foreground': '#BBBBBB',
        'input.border': '#4B4B4B',
        'scrollbarSlider.background': '#4B4B4B80',
        'scrollbarSlider.hoverBackground': '#4B4B4B',
        'scrollbarSlider.activeBackground': '#5A5A5A',
        'editorBracketMatch.background': '#3C3F4180',
        'editorBracketMatch.border': '#DAAA4E80',
      },
    });

    // 当当前是暗色主题时切换到 dc-dark
    if (editorTheme === 'vs-dark') {
      monaco.editor.setTheme('dc-dark');
    }
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

    // 确保右键菜单可用（Monaco 默认开启，此处显式设置以防被父级 CSS/事件影响）
    editor.updateOptions({ contextmenu: true });

    // Register Ctrl+Enter to execute
    editor.addAction({
      id: 'execute-sql',
      label: '执行 SQL (Ctrl+Enter)',
      keybindings: [/* KeyMod.CtrlCmd */ 2048 | /* KeyCode.Enter */ 3],
      contextMenuGroupId: '1_dc_execute',
      contextMenuOrder: 1,
      run: () => {
        onExecute();
      },
    });

    // 执行选中语句
    editor.addAction({
      id: 'execute-selected-sql',
      label: '执行选中语句',
      contextMenuGroupId: '1_dc_execute',
      contextMenuOrder: 2,
      precondition: 'editorHasSelection',
      run: (ed: any) => {
        const sel = ed.getSelection();
        const model = ed.getModel();
        if (sel && model && !sel.isEmpty()) {
          const selected = model.getValueInRange(sel);
          setSelectedSql(selected);
          // 等待 store 更新后执行（onExecute 会读 selectedSql）
          setTimeout(() => onExecute(), 0);
        }
      },
    });

    // 格式化 SQL
    editor.addAction({
      id: 'format-sql',
      label: '格式化 SQL (Shift+Alt+F)',
      keybindings: [/* Shift */ 1024 | /* Alt */ 512 | /* F */ 36],
      contextMenuGroupId: '2_dc_edit',
      contextMenuOrder: 1,
      run: () => {
        window.dispatchEvent(new CustomEvent('dc:format-sql'));
      },
    });

    // 切换行注释
    editor.addAction({
      id: 'toggle-line-comment',
      label: '切换行注释 (Ctrl+/)',
      keybindings: [/* KeyMod.CtrlCmd */ 2048 | /* Slash */ 85],
      contextMenuGroupId: '2_dc_edit',
      contextMenuOrder: 2,
      run: (ed: any) => {
        ed.trigger('keyboard', 'editor.action.commentLine', null);
      },
    });

    // 复制 SQL 全文到剪贴板
    editor.addAction({
      id: 'copy-all-sql',
      label: '复制全部 SQL 到剪贴板',
      contextMenuGroupId: '3_dc_copy',
      contextMenuOrder: 1,
      run: (ed: any) => {
        const val = ed.getValue();
        if (val) {
          navigator.clipboard.writeText(val).catch(() => {});
        }
      },
    });

    // 清空编辑器
    editor.addAction({
      id: 'clear-editor',
      label: '清空编辑器',
      contextMenuGroupId: '9_dc_danger',
      contextMenuOrder: 1,
      run: (ed: any) => {
        ed.setValue('');
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

    // 监听选中文本变化，用于"执行选中语句"
    editor.onDidChangeCursorSelection((e: any) => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      if (selection && model && !selection.isEmpty()) {
        const selected = model.getValueInRange(selection);
        setSelectedSql(selected);
      } else {
        setSelectedSql('');
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

  // 处理从左侧树拖入的表名
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const tableName = e.dataTransfer.getData('text/plain');
    if (tableName) {
      // 在光标位置插入表名
      const editor = editorRef.current;
      if (editor) {
        const position = editor.getPosition();
        const model = editor.getModel();
        if (position && model) {
          // 在当前位置插入表名 + 空格
          const newText = `${tableName} `;
          const range = {
            startLineNumber: position.lineNumber,
            startColumn: position.column,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          };
          editor.executeEdits('insert-table', [{
            range,
            text: newText,
          }]);
          editor.focus();
        }
      }
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  return (
    <Box
      sx={{ height: '100%', border: '1px solid', borderColor: 'divider', borderRadius: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
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
          theme={editorTheme === 'vs-dark' ? 'dc-dark' : editorTheme}
          value={sql}
          onChange={handleChange}
          beforeMount={handleBeforeMount}
          onMount={handleEditorMount}
          options={{
                      minimap: { enabled: false },
                      fontSize,
                      lineHeight: Math.max(28, Math.round(fontSize * 2)), // 行间距×2 方便阅读
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      automaticLayout: true,
                      padding: { top: 12 },
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
