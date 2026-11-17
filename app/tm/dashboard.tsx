import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../../src/theme/ThemeContext";

export default function TmDashboard() {
  const { colors } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>TM Dashboard</Text>
      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Team Management</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center" },
  title: { fontSize: 24, fontWeight: "800" },
  subtitle: { fontSize: 14, marginTop: 8 },
});
