import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { ThemeProvider, useTheme } from "../src/theme/ThemeContext";

function ThemedRootNavigator() {
  const { colors, isDark } = useTheme();

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "transparent" } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="logout" />
        <Stack.Screen name="co" />
        <Stack.Screen name="admin" />
        <Stack.Screen name="am" />
        <Stack.Screen name="bm" />
        <Stack.Screen name="tm" />
        <Stack.Screen name="zm" />
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedRootNavigator />
    </ThemeProvider>
  );
}