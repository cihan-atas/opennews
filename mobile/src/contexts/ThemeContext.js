import { createContext, useContext, useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { darkColors, lightColors } from '../theme';

const ThemeContext = createContext({ theme: 'dark', colors: darkColors, toggleTheme: () => {} });

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState('dark');

  useEffect(() => {
    SecureStore.getItemAsync('theme').then((saved) => {
      if (saved === 'light' || saved === 'dark') setTheme(saved);
    });
  }, []);

  const toggleTheme = () => {
    setTheme((p) => {
      const next = p === 'dark' ? 'light' : 'dark';
      SecureStore.setItemAsync('theme', next);
      return next;
    });
  };

  const themeColors = theme === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ theme, colors: themeColors, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
