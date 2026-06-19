import { createTheme } from '@mui/material/styles';

type ThemeMode = 'light' | 'dark';

/**
 * 根据模式和缩放比例创建 MUI 主题
 * @param mode 'light' | 'dark'
 * @param scale 缩放比例，1.0 = 100%，范围 0.7~1.5
 */
export function createAppTheme(mode: ThemeMode, scale: number) {
  const baseFontSize = 13;
  const fontSize = Math.round(baseFontSize * scale);
  const rem = (px: number) => `${(px / 16).toFixed(4)}rem`;
  const iconSize = scale <= 0.85 ? 'small' : scale >= 1.1 ? 'medium' : 'small';

  if (mode === 'dark') {
    return createTheme({
      palette: {
        mode: 'dark',
        primary: { main: '#90CAF9', light: '#BBDEFB', dark: '#64B5F6' },
        secondary: { main: '#FFB74D', light: '#FFCC80', dark: '#FFA726' },
        error: { main: '#EF5350' },
        warning: { main: '#FF9800' },
        success: { main: '#66BB6A' },
        background: { default: '#121212', paper: '#1E1E1E' },
      },
      typography: {
        fontSize,
        htmlFontSize: 16,
        fontFamily: ['-apple-system','BlinkMacSystemFont','"Segoe UI"','Roboto','"Helvetica Neue"','Arial','sans-serif'].join(','),
      },
      components: {
        MuiButton: { styleOverrides: { root: { textTransform: 'none', fontSize: rem(fontSize) } } },
        MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
        MuiSvgIcon: { defaultProps: { fontSize: iconSize } },
        MuiIconButton: { styleOverrides: { sizeSmall: { padding: Math.round(4 * scale) }, root: { padding: Math.round(6 * scale) } } },
        MuiTab: { styleOverrides: { root: { fontSize: rem(fontSize), minHeight: Math.round(36 * scale) } } },
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
    },
    typography: {
      fontSize,
      htmlFontSize: 16,
      fontFamily: ['-apple-system','BlinkMacSystemFont','"Segoe UI"','Roboto','"Helvetica Neue"','Arial','sans-serif'].join(','),
    },
    components: {
      MuiButton: { styleOverrides: { root: { textTransform: 'none', fontSize: rem(fontSize) } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 500 } } },
      MuiSvgIcon: { defaultProps: { fontSize: iconSize } },
      MuiIconButton: { styleOverrides: { sizeSmall: { padding: Math.round(4 * scale) }, root: { padding: Math.round(6 * scale) } } },
      MuiTab: { styleOverrides: { root: { fontSize: rem(fontSize), minHeight: Math.round(36 * scale) } } },
    },
  });
}
