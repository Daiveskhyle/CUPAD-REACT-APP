import React, { createContext, useContext, useState, useEffect } from "react";
import { Appearance } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { darkColors, lightColors, ColorsType } from "./theme";

type ThemeContextType = {
  colors: ColorsType;
  isDark: boolean;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeContextType>({} as any);

export const ThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const [isDark, setIsDark] = useState(Appearance.getColorScheme() === "dark");

  useEffect(() => {
    (async () => {
      const saved = await AsyncStorage.getItem("cupad_theme");
      if (saved) setIsDark(saved === "dark");
    })();
  }, []);

  const toggleTheme = async () => {
    const next = !isDark;
    setIsDark(next);
    await AsyncStorage.setItem("cupad_theme", next ? "dark" : "light");
  };

  const colors: ColorsType = isDark ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colors, isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);