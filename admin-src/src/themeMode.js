import { createContext, useContext } from 'react';
// Appearance: 'system' | 'light' | 'dark'
export const ThemeModeContext = createContext({ mode: 'system', setMode: () => {} });
export const useThemeMode = () => useContext(ThemeModeContext);
