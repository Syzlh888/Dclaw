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

  // ─── 深空科技阴影 ───
  // 柔和分层阴影（不黑/不硬），dark 模式专用
  const shadowLayer = (blur: number, y: number, opacity: number) =>
    `0 ${y}px ${blur}px rgba(0,0,0,${opacity})`;
  const SPACE_SHADOWS = [
    'none',                                                              // 0
    shadowLayer(2, 1, 0.30),                                            // 1
    shadowLayer(6, 2, 0.32),                                            // 2 — 卡片
    shadowLayer(10, 4, 0.36),                                           // 3
    shadowLayer(14, 6, 0.38),                                           // 4 — 浮层
    shadowLayer(20, 8, 0.42),                                           // 5
    shadowLayer(24, 10, 0.46),                                          // 6
    shadowLayer(28, 12, 0.48),                                          // 7
    shadowLayer(32, 14, 0.50),                                          // 8 — 抽屉
    shadowLayer(36, 16, 0.52),                                          // 9
    shadowLayer(40, 18, 0.54),                                          // 10
    shadowLayer(44, 20, 0.56),                                          // 11
    shadowLayer(48, 22, 0.58),                                          // 12
    shadowLayer(52, 24, 0.60),                                          // 13
    shadowLayer(56, 26, 0.62),                                          // 14
    shadowLayer(60, 28, 0.64),                                          // 15
    shadowLayer(64, 30, 0.66),                                          // 16
    shadowLayer(68, 32, 0.68),                                          // 17
    shadowLayer(72, 34, 0.70),                                          // 18
    shadowLayer(76, 36, 0.72),                                          // 19
    shadowLayer(80, 38, 0.74),                                          // 20
    shadowLayer(84, 40, 0.76),                                          // 21
    shadowLayer(88, 42, 0.78),                                          // 22
    shadowLayer(92, 44, 0.80),                                          // 23
    shadowLayer(96, 46, 0.82),                                          // 24
  ] as unknown as ["none", string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string];

  // 全局过渡（仅作用于主要交互组件，不影响 MUI 内部 transform/opacity 动画）
  const globalTransition =
    'background-color 150ms ease, color 150ms ease, border-color 150ms ease, box-shadow 150ms ease';
  const TRANSITION_SELECTORS =
    '.MuiPaper-root, .MuiCard-root, .MuiButton-root, .MuiIconButton-root, .MuiChip-root, .MuiMenuItem-root, .MuiListItemButton-root, .MuiListItem-root, .MuiTab-root, .MuiTableRow-root, .MuiAlert-root, .MuiAlertMessage-root, .MuiOutlinedInput-root, .MuiFilledInput-root, .MuiInput-root, .MuiDivider-root, .MuiSwitch-root, .MuiCheckbox-root, .MuiRadio-root, .MuiTooltip-tooltip, .MuiBackdrop-root';

  if (mode === 'dark') {
    return createTheme({
      palette: {
        mode: 'dark',
        primary: { main: '#0084C8', light: '#4FC3F7', dark: '#2DA0D0', contrastText: '#FFFFFF' },
        secondary: { main: '#D4A72C', light: '#E0C077', dark: '#B8903A', contrastText: '#0F1418' },
        error: { main: '#F87171', light: '#FCA5A5', dark: '#DC2626', contrastText: '#0F1418' },
        warning: { main: '#FFB020', light: '#FFCD56', dark: '#D97706', contrastText: '#0F1418' },
        success: { main: '#4ADE80', light: '#86EFAC', dark: '#22C55E', contrastText: '#0F1418' },
        info: { main: '#4FC3F7', light: '#7DD3FC', dark: '#2DA0D0', contrastText: '#0F1418' },
        background: { default: '#0F1418', paper: '#141A1F' },
        text: { primary: '#D5DCE3', secondary: '#8AA0AD', disabled: '#5A6B78' },
        divider: '#22303A',
        action: {
          hover: 'rgba(255,255,255,0.06)',
          selected: 'rgba(79,195,247,0.15)',
          selectedOpacity: 1,
          disabled: 'rgba(255,255,255,0.30)',
          disabledBackground: 'rgba(255,255,255,0.10)',
          focus: 'rgba(79,195,247,0.20)',
          active: 'rgba(79,195,247,0.18)',
          hoverOpacity: 0.06,
        },
      },
      shape: { borderRadius: 8 },
      shadows: SPACE_SHADOWS,
      typography: {
        fontSize,
        htmlFontSize: htmlFontSizePx,
        // 关键：在字体栈里插入 CJK fallback
        fontFamily: FONT_FAMILY,
      },
      transitions: {
        duration: {
          shortest: 120,
          shorter: 150,
          short: 180,
          standard: 200,
          complex: 240,
          enteringScreen: 200,
          leavingScreen: 160,
        },
        easing: {
          easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
          easeOut: 'cubic-bezier(0.0, 0, 0.2, 1)',
          easeIn: 'cubic-bezier(0.4, 0, 1, 1)',
          sharp: 'cubic-bezier(0.4, 0, 0.6, 1)',
        },
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
            // 全局过渡：色彩/边框/阴影平滑切换（仅作用于主要交互组件，避免与 MUI 内部 transform/opacity 动画冲突）
            [TRANSITION_SELECTORS]: { transition: globalTransition },
            // 自定义滚动条：深空科技配色
            '::-webkit-scrollbar': { width: 10, height: 10 },
            '::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
            '::-webkit-scrollbar-thumb': {
              backgroundColor: 'rgba(138,160,173,0.25)',
              borderRadius: 5,
              border: '2px solid transparent',
              backgroundClip: 'content-box',
            },
            '::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(79,195,247,0.40)' },
            '::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },
          },
        },

        // ─── 基础面板 ───
        MuiPaper: {
          defaultProps: { elevation: 0 },
          styleOverrides: {
            root: {
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.018) 0%, rgba(255,255,255,0) 100%)',
              border: '1px solid #22303A',
              borderRadius: 10,
              backgroundColor: '#141A1F',
            },
            outlined: {
              border: '1px solid #22303A',
              boxShadow: shadowLayer(2, 1, 0.30),
            },
            elevation1: { boxShadow: shadowLayer(2, 1, 0.30) },
            elevation2: { boxShadow: shadowLayer(6, 2, 0.32) },
            elevation3: { boxShadow: shadowLayer(10, 4, 0.36) },
            elevation4: { boxShadow: shadowLayer(14, 6, 0.38) },
            elevation6: { boxShadow: shadowLayer(24, 10, 0.46) },
            elevation8: { boxShadow: shadowLayer(32, 14, 0.50) },
            elevation12: { boxShadow: shadowLayer(48, 22, 0.58) },
            elevation16: { boxShadow: shadowLayer(64, 30, 0.66) },
            elevation24: { boxShadow: shadowLayer(96, 46, 0.82) },
          },
        },

        // ─── 卡片（深空科技风：1px 边框 + 微阴影 + hover 增强）───
        MuiCard: {
          defaultProps: { elevation: 0 },
          styleOverrides: {
            root: {
              backgroundColor: '#141A1F',
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 100%)',
              border: '1px solid #22303A',
              borderRadius: 10,
              boxShadow: shadowLayer(2, 1, 0.30),
              transition: 'border-color 150ms ease, box-shadow 150ms ease, transform 150ms ease',
              '&:hover': {
                borderColor: 'rgba(79,195,247,0.35)',
                boxShadow: shadowLayer(10, 4, 0.36),
              },
            },
          },
        },

        // ─── 弹窗（圆角 12px + 阴影 + 描边 + 轻微顶部高光）───
        MuiDialog: {
          styleOverrides: {
            paper: {
              borderRadius: 12,
              border: '1px solid #22303A',
              boxShadow: shadowLayer(28, 12, 0.55),
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 100%)',
              backgroundColor: '#141A1F',
            },
          },
        },
        MuiDialogTitle: {
          styleOverrides: {
            root: {
              fontSize: rem(Math.round(fontSize * 1.2)),
              fontWeight: 600,
              borderBottom: '1px solid #22303A',
              padding: '10px 16px',
            },
          },
        },
        MuiDialogContent: {
          styleOverrides: {
            root: { padding: '12px 16px' },
          },
        },
        MuiDialogActions: {
          styleOverrides: {
            root: { padding: '8px 16px 12px', borderTop: '1px solid #22303A' },
          },
        },

        // ─── 按钮（圆角 8px + primary 渐变 + hover 提亮+上浮+阴影增强）───
        MuiButton: {
          defaultProps: { disableElevation: true },
          styleOverrides: {
            root: {
              textTransform: 'none',
              fontSize: rem(fontSize),
              borderRadius: 8,
              minHeight: 28,
              padding: '4px 12px',
              fontWeight: 500,
              transition:
                'background 150ms ease, box-shadow 150ms ease, color 150ms ease, transform 150ms ease, border-color 150ms ease',
              '&:hover': {
                transform: 'translateY(-1px)',
                boxShadow: shadowLayer(6, 2, 0.36),
              },
              '&:active': { transform: 'translateY(0)' },
              '&.Mui-disabled': { transform: 'none' },
            },
            // Primary：深空蓝渐变 + hover 加强
            containedPrimary: {
              background: 'linear-gradient(135deg, #0084C8 0%, #2DA0D0 100%)',
              color: '#FFFFFF',
              border: '1px solid rgba(255,255,255,0.08)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.15)',
              '&:hover': {
                background: 'linear-gradient(135deg, #1B95D8 0%, #3FB0DE 100%)',
                boxShadow:
                  '0 4px 14px rgba(0,132,200,0.45), inset 0 1px 0 rgba(255,255,255,0.20)',
                transform: 'translateY(-1px)',
              },
              '&.Mui-disabled': {
                background: 'rgba(0,132,200,0.30)',
                color: 'rgba(255,255,255,0.50)',
              },
            },
            // Secondary：金橙渐变（用于警告/执行类按钮）
            containedSecondary: {
              background: 'linear-gradient(135deg, #D4A72C 0%, #E0C077 100%)',
              color: '#0F1418',
              border: '1px solid rgba(255,255,255,0.10)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.20)',
              '&:hover': {
                background: 'linear-gradient(135deg, #E0B540 0%, #EBC987 100%)',
                boxShadow:
                  '0 4px 14px rgba(212,167,44,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
                transform: 'translateY(-1px)',
              },
            },
            containedSuccess: {
              background: 'linear-gradient(135deg, #22C55E 0%, #4ADE80 100%)',
              color: '#0F1418',
              border: '1px solid rgba(255,255,255,0.10)',
              '&:hover': {
                background: 'linear-gradient(135deg, #34D26A 0%, #6EE79B 100%)',
                boxShadow: '0 4px 14px rgba(74,222,128,0.40)',
                transform: 'translateY(-1px)',
              },
            },
            containedError: {
              background: 'linear-gradient(135deg, #DC2626 0%, #F87171 100%)',
              color: '#FFFFFF',
              border: '1px solid rgba(255,255,255,0.08)',
              '&:hover': {
                background: 'linear-gradient(135deg, #EF4444 0%, #FCA5A5 100%)',
                boxShadow: '0 4px 14px rgba(248,113,113,0.40)',
                transform: 'translateY(-1px)',
              },
            },
            containedWarning: {
              background: 'linear-gradient(135deg, #D97706 0%, #FFB020 100%)',
              color: '#0F1418',
              border: '1px solid rgba(255,255,255,0.10)',
              '&:hover': {
                background: 'linear-gradient(135deg, #F59E0B 0%, #FFCD56 100%)',
                boxShadow: '0 4px 14px rgba(255,176,32,0.40)',
                transform: 'translateY(-1px)',
              },
            },
            outlined: {
              borderColor: '#22303A',
              color: '#D5DCE3',
              '&:hover': {
                borderColor: '#4FC3F7',
                backgroundColor: 'rgba(79,195,247,0.08)',
                color: '#4FC3F7',
              },
            },
            outlinedPrimary: {
              borderColor: 'rgba(0,132,200,0.50)',
              color: '#4FC3F7',
              '&:hover': {
                borderColor: '#4FC3F7',
                backgroundColor: 'rgba(79,195,247,0.10)',
              },
            },
            outlinedError: {
              borderColor: 'rgba(248,113,113,0.50)',
              color: '#F87171',
              '&:hover': {
                borderColor: '#F87171',
                backgroundColor: 'rgba(248,113,113,0.08)',
              },
            },
            text: {
              color: '#D5DCE3',
              '&:hover': {
                backgroundColor: 'rgba(79,195,247,0.10)',
                color: '#4FC3F7',
              },
            },
            contained: {
              boxShadow: 'none',
              '&:hover': { boxShadow: shadowLayer(6, 2, 0.36) },
            },
            sizeSmall: {
              minHeight: 24,
              padding: '2px 10px',
              fontSize: rem(Math.max(10, fontSize - 1)),
            },
            sizeLarge: { minHeight: 34, padding: '6px 16px' },
          },
        },

        // ─── IconButton（hover 背景提亮 + transition）───
        MuiIconButton: {
          styleOverrides: {
            root: {
              borderRadius: 6,
              padding: Math.round(5 * scale),
              color: '#D5DCE3',
              transition:
                'background-color 150ms ease, color 150ms ease, transform 150ms ease, box-shadow 150ms ease',
              '&:hover': {
                backgroundColor: 'rgba(79,195,247,0.12)',
                color: '#4FC3F7',
              },
              '&:active': { transform: 'scale(0.95)' },
            },
            sizeSmall: { padding: Math.round(3 * scale) },
            colorPrimary: {
              color: '#4FC3F7',
              '&:hover': { backgroundColor: 'rgba(79,195,247,0.15)' },
            },
            colorError: {
              color: '#F87171',
              '&:hover': { backgroundColor: 'rgba(248,113,113,0.12)' },
            },
          },
        },

        // ─── 输入框（圆角 8px + focus 边框亮蓝 + 光环）───
        MuiTextField: { defaultProps: { variant: 'outlined' } },
        MuiOutlinedInput: {
          styleOverrides: {
            root: {
              borderRadius: 8,
              fontSize: rem(fontSize),
              backgroundColor: 'rgba(255,255,255,0.02)',
              transition:
                'background-color 150ms ease, box-shadow 150ms ease',
              '& fieldset': {
                borderColor: '#22303A',
                borderWidth: 1,
                transition: 'border-color 150ms ease',
              },
              '&:hover fieldset': {
                borderColor: 'rgba(79,195,247,0.55)',
              },
              '&:hover': { backgroundColor: 'rgba(255,255,255,0.04)' },
              '&.Mui-focused': {
                backgroundColor: 'rgba(79,195,247,0.04)',
                boxShadow: '0 0 0 3px rgba(79,195,247,0.15)',
              },
              '&.Mui-focused fieldset': {
                borderColor: '#4FC3F7',
                borderWidth: 1,
              },
              '&.Mui-error fieldset': { borderColor: '#F87171' },
              '&.Mui-error.Mui-focused': {
                boxShadow: '0 0 0 3px rgba(248,113,113,0.18)',
              },
              '&.Mui-disabled': {
                backgroundColor: 'rgba(255,255,255,0.02)',
                '& fieldset': { borderColor: 'rgba(255,255,255,0.08)' },
              },
            },
            input: { fontSize: rem(fontSize), padding: '6px 10px' },
            sizeSmall: { '& input': { padding: '4px 8px', fontSize: rem(Math.max(10, fontSize - 1)) } },
            adornedStart: { paddingLeft: 8 },
            adornedEnd: { paddingRight: 8 },
            notchedOutline: { borderColor: '#22303A' },
          },
        },
        MuiInputBase: {
          styleOverrides: {
            root: { fontSize: rem(fontSize) },
            input: { fontSize: rem(fontSize) },
          },
        },
        MuiInputLabel: {
          styleOverrides: {
            root: {
              fontSize: rem(fontSize),
              color: '#8AA0AD',
              '&.Mui-focused': { color: '#4FC3F7' },
            },
          },
        },
        MuiFormLabel: { styleOverrides: { root: { fontSize: rem(fontSize) } } },
        MuiFormHelperText: {
          styleOverrides: {
            root: {
              fontSize: rem(Math.max(10, fontSize - 1)),
              color: '#8AA0AD',
              marginLeft: 2,
              marginRight: 2,
            },
          },
        },

        // ─── 菜单项（hover 背景 + 圆角）───
        MuiMenuItem: {
          styleOverrides: {
            root: {
              fontSize: rem(fontSize),
              borderRadius: 6,
              margin: '2px 4px',
              padding: '5px 10px',
              minHeight: 28,
              transition: 'background-color 150ms ease, color 150ms ease',
              '&:hover': { backgroundColor: 'rgba(79,195,247,0.10)' },
              '&.Mui-selected': { backgroundColor: 'rgba(79,195,247,0.15)' },
              '&.Mui-selected:hover': { backgroundColor: 'rgba(79,195,247,0.22)' },
            },
          },
        },

        // ─── 菜单/弹层（圆角 8px + 阴影 + 描边 + 顶部高光）───
        MuiMenu: {
          styleOverrides: {
            paper: {
              borderRadius: 8,
              border: '1px solid #22303A',
              boxShadow: shadowLayer(14, 6, 0.42),
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 100%)',
              backgroundColor: '#141A1F',
            },
          },
        },
        MuiPopover: {
          styleOverrides: {
            paper: {
              borderRadius: 8,
              border: '1px solid #22303A',
              boxShadow: shadowLayer(14, 6, 0.42),
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 100%)',
              backgroundColor: '#141A1F',
            },
          },
        },

        // ─── Tooltip（圆角 6px + 阴影 + 描边）───
        MuiTooltip: {
          styleOverrides: {
            tooltip: {
              backgroundColor: '#1B232B',
              color: '#D5DCE3',
              borderRadius: 6,
              border: '1px solid #22303A',
              boxShadow: shadowLayer(6, 2, 0.36),
              fontSize: rem(Math.max(10, fontSize - 1)),
              padding: '4px 8px',
            },
            arrow: { color: '#1B232B' },
          },
        },

        // ─── 表格 ───
        MuiTableHead: {
          styleOverrides: {
            root: {
              backgroundColor: '#141A1F',
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.030) 0%, rgba(255,255,255,0) 100%)',
              '& .MuiTableCell-head': {
                fontWeight: 700,
                color: '#D5DCE3',
              },
            },
          },
        },
        MuiTableBody: {
          styleOverrides: {
            root: {
              '& .MuiTableRow-root': { transition: 'background-color 150ms ease' },
            },
          },
        },
        MuiTableRow: {
          styleOverrides: {
            root: {
              transition: 'background-color 150ms ease',
              '&:hover': { backgroundColor: 'rgba(79,195,247,0.06)' },
              '&.Mui-selected': { backgroundColor: 'rgba(79,195,247,0.12)' },
              '&.Mui-selected:hover': { backgroundColor: 'rgba(79,195,247,0.18)' },
            },
          },
        },
        MuiTableCell: {
          styleOverrides: {
            root: {
              fontSize: rem(fontSize),
              borderColor: '#22303A',
              padding: '5px 10px',
            },
            head: { fontWeight: 700, color: '#D5DCE3' },
            sizeSmall: { padding: '3px 8px' },
          },
        },
        MuiTableContainer: {
          styleOverrides: {
            root: {
              borderRadius: 8,
              border: '1px solid #22303A',
            },
          },
        },

        // ─── Chip（圆角 6px + 配色重映射）───
        MuiChip: {
          styleOverrides: {
            root: {
              fontWeight: 500,
              fontSize: rem(Math.max(10, fontSize - 1)),
              borderRadius: 6,
              height: 22,
              backgroundColor: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.06)',
              color: '#D5DCE3',
              transition:
                'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
              '&:hover': {
                backgroundColor: 'rgba(79,195,247,0.10)',
                borderColor: 'rgba(79,195,247,0.30)',
              },
            },
            colorPrimary: {
              backgroundColor: 'rgba(0,132,200,0.18)',
              borderColor: 'rgba(79,195,247,0.30)',
              color: '#4FC3F7',
            },
            colorSecondary: {
              backgroundColor: 'rgba(212,167,44,0.18)',
              borderColor: 'rgba(224,192,119,0.30)',
              color: '#E0C077',
            },
            colorSuccess: {
              backgroundColor: 'rgba(74,222,128,0.15)',
              borderColor: 'rgba(74,222,128,0.30)',
              color: '#4ADE80',
            },
            colorWarning: {
              backgroundColor: 'rgba(255,176,32,0.15)',
              borderColor: 'rgba(255,176,32,0.30)',
              color: '#FFB020',
            },
            colorError: {
              backgroundColor: 'rgba(248,113,113,0.15)',
              borderColor: 'rgba(248,113,113,0.30)',
              color: '#F87171',
            },
            colorInfo: {
              backgroundColor: 'rgba(79,195,247,0.15)',
              borderColor: 'rgba(79,195,247,0.30)',
              color: '#4FC3F7',
            },
            deleteIcon: {
              color: 'inherit',
              opacity: 0.6,
              '&:hover': { opacity: 1 },
            },
          },
        },

        // ─── Tab（圆角 + hover 背景 + 指示器胶囊 + 发光）───
        MuiTab: {
          styleOverrides: {
            root: {
              fontSize: rem(fontSize),
              minHeight: Math.round(28 * scale),
              textTransform: 'none',
              borderRadius: 6,
              padding: '4px 12px',
              color: '#8AA0AD',
              transition:
                'background-color 150ms ease, color 150ms ease',
              '&:hover': {
                backgroundColor: 'rgba(79,195,247,0.08)',
                color: '#4FC3F7',
              },
              '&.Mui-selected': { color: '#4FC3F7' },
            },
          },
        },
        MuiTabs: {
          styleOverrides: {
            root: { minHeight: Math.round(28 * scale) },
            indicator: {
              height: 2,
              borderRadius: 2,
              backgroundColor: '#4FC3F7',
              boxShadow: '0 0 6px rgba(79,195,247,0.55)',
            },
          },
        },

        // ─── Alert / Snackbar（圆角 8px + 阴影 + 配色重映射）───
        MuiAlert: {
          defaultProps: { variant: 'standard' },
          styleOverrides: {
            root: {
              borderRadius: 8,
              border: '1px solid',
              fontSize: rem(fontSize),
              boxShadow: shadowLayer(6, 2, 0.32),
            },
            standardSuccess: {
              backgroundColor: 'rgba(74,222,128,0.10)',
              borderColor: 'rgba(74,222,128,0.30)',
              color: '#86EFAC',
            },
            standardWarning: {
              backgroundColor: 'rgba(255,176,32,0.10)',
              borderColor: 'rgba(255,176,32,0.30)',
              color: '#FFCD56',
            },
            standardError: {
              backgroundColor: 'rgba(248,113,113,0.10)',
              borderColor: 'rgba(248,113,113,0.30)',
              color: '#FCA5A5',
            },
            standardInfo: {
              backgroundColor: 'rgba(79,195,247,0.10)',
              borderColor: 'rgba(79,195,247,0.30)',
              color: '#7DD3FC',
            },
          },
        },
        MuiSnackbarContent: {
          styleOverrides: {
            root: {
              borderRadius: 8,
              border: '1px solid #22303A',
              backgroundColor: '#141A1F',
              backgroundImage:
                'linear-gradient(180deg, rgba(255,255,255,0.025) 0%, rgba(255,255,255,0) 100%)',
              boxShadow: shadowLayer(14, 6, 0.42),
              color: '#D5DCE3',
            },
          },
        },

        // ─── 分割线 ───
        MuiDivider: {
          styleOverrides: {
            root: { borderColor: '#22303A' },
          },
        },

        // ─── 开关/复选/单选 ───
        MuiSwitch: {
          styleOverrides: {
            root: { padding: 6 },
            switchBase: {
              padding: 9,
              '&.Mui-checked': {
                color: '#4FC3F7',
                '& + .MuiSwitch-track': {
                  backgroundColor: 'rgba(79,195,247,0.45)',
                  opacity: 1,
                },
              },
              transition:
                'background-color 150ms ease, color 150ms ease, left 200ms ease',
            },
            thumb: { boxShadow: '0 1px 3px rgba(0,0,0,0.45)' },
            track: {
              borderRadius: 12,
              border: '1px solid #22303A',
              backgroundColor: 'rgba(255,255,255,0.10)',
              opacity: 1,
            },
          },
        },
        MuiCheckbox: {
          styleOverrides: {
            root: {
              color: '#8AA0AD',
              padding: 6,
              '&.Mui-checked': { color: '#4FC3F7' },
              '&.Mui-indeterminate': { color: '#4FC3F7' },
              '&:hover': { backgroundColor: 'rgba(79,195,247,0.08)' },
            },
          },
        },
        MuiRadio: {
          styleOverrides: {
            root: {
              color: '#8AA0AD',
              padding: 6,
              '&.Mui-checked': { color: '#4FC3F7' },
            },
          },
        },

        // ─── 进度条 ───
        MuiLinearProgress: {
          styleOverrides: {
            root: {
              borderRadius: 4,
              backgroundColor: 'rgba(79,195,247,0.10)',
              height: 6,
            },
            bar: { borderRadius: 4 },
          },
        },
        MuiCircularProgress: {
          styleOverrides: {
            root: { color: '#4FC3F7' },
          },
        },

        // ─── 列表（侧栏/菜单专用）───
        MuiListSubheader: {
          styleOverrides: {
            root: {
              backgroundColor: 'transparent',
              color: '#4FC3F7',
              fontWeight: 600,
              fontSize: rem(Math.max(10, fontSize - 1)),
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              lineHeight: '22px',
              padding: '4px 10px',
            },
          },
        },
        MuiListItemButton: {
          styleOverrides: {
            root: {
              borderRadius: 6,
              transition: 'background-color 150ms ease, color 150ms ease',
              '&:hover': { backgroundColor: 'rgba(79,195,247,0.10)' },
              '&.Mui-selected': {
                backgroundColor: 'rgba(79,195,247,0.15)',
              },
              '&.Mui-selected:hover': {
                backgroundColor: 'rgba(79,195,247,0.22)',
              },
            },
          },
        },
        MuiListItemIcon: {
          styleOverrides: {
            root: { color: '#8AA0AD', minWidth: 28 },
          },
        },

        // ─── Modal 遮罩 ───
        MuiBackdrop: {
          styleOverrides: {
            root: {
              backgroundColor: 'rgba(0,0,0,0.55)',
            },
          },
        },

        // ─── SVG 图标默认尺寸 ───
        MuiSvgIcon: { defaultProps: { fontSize: iconSize } },
      },
    });
  }

  // light 分支：保持原版基本结构，仅加入 shape 圆角统一（避免 light 模式组件圆角突兀）
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
    shape: { borderRadius: 8 },
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
          [TRANSITION_SELECTORS]: { transition: globalTransition },
        },
      },
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontSize: rem(fontSize), borderRadius: 8 } } },
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