import { createContext, useContext } from 'react';

type ThemeMode = 'light' | 'dark';

export interface ThemeContextType {
  mode: ThemeMode;
  toggleTheme: () => void;
  scale: number;
  setScale: (scale: number) => void;
}

export const ThemeModeContext = createContext<ThemeContextType>({
  mode: 'light',
  toggleTheme: () => {},
  scale: 1,
  setScale: () => {},
});

export const useThemeMode = () => useContext(ThemeModeContext);
