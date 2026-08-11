import { createTheme } from '@mui/material/styles';

type ThemeMode = 'light' | 'dark';

/**
 * 根据模式和缩放比例创建 MUI 主题
 * @param mode 'light' | 'dark'
 * @param scale 缩放比例，1.0 = 100%，范围 0.4~1.5
 */
export function createAppTheme(mode: ThemeMode, scale: number) {
  // 精修（v1.6+）：baseFontSize 13→12, htmlFontSizePx 默认 16→15
  // 让默认 scale=1.0 比 v1.5 更精致紧凑，但保留 --dc-scale 跟随缩放
  const baseFontSize = 12;
  const fontSize = Math.round(baseFontSize * scale);
  const htmlFontSizePx = Math.round(15 * scale);
  // 关键修复：rem 转换的分母必须使用 htmlFontSizePx（同步缩放），否则 0.7rem 等字面量会锁死在 16px 基准上
  const rem = (px: number) => `${(px / htmlFontSizePx).toFixed(4)}rem`;
  const iconSize = scale <= 0.85 ? 'small' : scale >= 1.1 ? 'medium' : 'small';

  // CJK 字体栈 — 关键修复：避免 Modal/Button 等 MUI 组件内中文显示豆腐块
  const FONT_FAMILY = [
    '-apple-system',
    'BlinkMacSystemFont',
    '"Segoe UI"',
    'Roboto',
    '"Helvetica Neue"',
    'Arial',
    '"PingFang SC"',
    '"Microsoft YaHei"',
    '"Hiragino Sans GB"',
    '"Noto Sans CJK SC"',
    '"Source Han Sans CN"',
    'sans-serif',
  ].join(',');

  if (mode === 'dark') {
    return createTheme({
      palette: {
        mode: 'dark',
        primary: { main: '#4DB8E6', light: '#6CC8F0', dark: '#2DA0D0' }, // DBeaver 数据蓝
        secondary: { main: '#DAAA4E', light: '#E0C077', dark: '#B8903A' }, // DBeaver SQL 关键字金橙色
        error: { main: '#EF5350' },
        warning: { main: '#FF9800' },
        success: { main: '#66BB6A' },
        background: { default: '#2B2B2B', paper: '#3C3F41' }, // DBeaver 主背景 / 面板背景
        text: { primary: '#BBBBBB', secondary: '#888888' }, // DBeaver 文字主色 / 次要文字
        divider: '#4B4B4B', // DBeaver 分割线
        action: { hover: 'rgba(255,255,255,0.06)', selected: 'rgba(255,255,255,0.10)' }, // DBeaver 悬浮/选中高亮
      },
      typography: {
        fontSize,
        htmlFontSize: htmlFontSizePx,
        // 关键：在字体栈里插入 CJK fallback
        fontFamily: FONT_FAMILY,
      },
      components: {
        MuiCssBaseline: {
          styleOverrides: {
            // 关键修复：把 htmlFontSize 实际写到 <html> 上，让所有 rem（以及 MUI 内部 pxToRem）随 scale 一起缩放
            html: { fontSize: `${htmlFontSizePx}px !important` },
            // 全局兜底：html/body/#root 全部声明 CJK 字体
            'html, body, #root': { fontFamily: FONT_FAMILY },
            // 关键修复：Dialog/Modal 内部全部使用带 CJK fallback 的字体
            '.MuiDialog-root, .MuiDialog-root *': {
              fontFamily: `${FONT_FAMILY} !important`,
            },
          },
        },
        MuiButton: { styleOverrides: { root: { textTransform: 'none', fontSize: rem(fontSize) } } },
        MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
        MuiSvgIcon: { defaultProps: { fontSize: iconSize } }, // DBeaver 彩色图标：颜色通过 palette primary/secondary/error 映射
        // ─── DBeaver 风格表格 ───
        MuiTableHead: {
          styleOverrides: {
            root: {
              backgroundColor: '#3C3F41', // DBeaver 表头背景（与面板背景一致）
              '& .MuiTableCell-head': {
                fontWeight: 700, // 表头文字加粗
              },
            },
          },
        },
        MuiTableRow: {
          styleOverrides: {
            root: {
              '&:hover': {
                backgroundColor: 'rgba(255,255,255,0.04)', // DBeaver 表格行悬浮高亮
              },
            },
          },
        },
        MuiIconButton: { styleOverrides: { sizeSmall: { padding: Math.round(3 * scale) }, root: { padding: Math.round(5 * scale) } } },
        MuiTab: { styleOverrides: { root: { fontSize: rem(fontSize), minHeight: Math.round(28 * scale) } } },
        MuiTableCell: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
        MuiInputBase: { styleOverrides: { input: { fontSize: rem(fontSize) }, root: { fontSize: rem(fontSize) } } },
        MuiInputLabel: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
        MuiFormLabel: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
        MuiDialogTitle: { styleOverrides: { root: { fontSize: rem(Math.round(fontSize * 1.2)) } } },
        MuiMenuItem: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
      },
    });
  }

  return createTheme({
    palette: {
      mode: 'light',
      primary: { main: '#1976D2', light: '#42A5F5', dark: '#1565C0' },
      secondary: { main: '#FFA726', light: '#FFB74D', dark: '#F57C00' },
      error: { main: '#D32F2F' },
      warning: { main: '#ED6C02' },
      success: { main: '#2E7D32' },
      background: { default: '#F5F5F5', paper: '#FFFFFF' },
      text: { primary: 'rgba(0,0,0,0.87)', secondary: 'rgba(0,0,0,0.6)' },
      divider: 'rgba(0,0,0,0.12)',
      action: { hover: 'rgba(0,0,0,0.04)', selected: 'rgba(25,118,210,0.08)' },
    },
    typography: {
      fontSize,
      htmlFontSize: htmlFontSizePx,
      fontFamily: FONT_FAMILY,
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          // 关键修复：把 htmlFontSize 实际写到 <html> 上，让所有 rem（以及 MUI 内部 pxToRem）随 scale 一起缩放
          html: { fontSize: `${htmlFontSizePx}px !important` },
          'html, body, #root': { fontFamily: FONT_FAMILY },
          '.MuiDialog-root, .MuiDialog-root *': {
            fontFamily: `${FONT_FAMILY} !important`,
          },
        },
      },
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontSize: rem(fontSize) } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiSvgIcon: { defaultProps: { fontSize: iconSize } },
      MuiTableHead: {
        styleOverrides: {
          root: {
            backgroundColor: '#F5F5F5',
            '& .MuiTableCell-head': { fontWeight: 700 },
          },
        },
      },
      MuiTableRow: {
        styleOverrides: {
          root: {
            '&:hover': { backgroundColor: 'rgba(0,0,0,0.04)' },
          },
        },
      },
      MuiIconButton: { styleOverrides: { sizeSmall: { padding: Math.round(3 * scale) }, root: { padding: Math.round(5 * scale) } } },
      MuiTab: { styleOverrides: { root: { fontSize: rem(fontSize), minHeight: Math.round(28 * scale) } } },
      MuiTableCell: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
      MuiInputBase: { styleOverrides: { input: { fontSize: rem(fontSize) }, root: { fontSize: rem(fontSize) } } },
      MuiInputLabel: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
      MuiFormLabel: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: rem(Math.round(fontSize * 1.2)) } } },
      MuiMenuItem: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
    },
  });
}