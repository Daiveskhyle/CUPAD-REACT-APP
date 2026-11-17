import React from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useTheme } from "../../src/theme/ThemeContext";
import { terminateSession } from "../../src/utils/session";

export default function AdminDashboard() {
  const { colors, isDark } = useTheme();

  const handleLogout = () => {
    Alert.alert("Logout", "Terminate your session?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Logout", style: "destructive",
        onPress: async () => {
          await terminateSession();
          router.replace("/logout" as any); // shows 3s animated screen
        }
      }
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.cardBorder }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.text }]}>Admin Portal</Text>
          <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>Dashboard Overview</Text>
        </View>
        <Pressable
          onPress={handleLogout}
          style={({ pressed }) => [styles.logoutButton, { opacity: pressed? 0.7 : 1 }]}
        >
          <Ionicons name="log-out-outline" size={20} color="#FF4D4F" />
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <View style={[styles.welcomeCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={[styles.iconCircle, { backgroundColor: isDark? "rgba(22,119,255,0.15)" : "rgba(22,119,255,0.10)" }]}>
            <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
          </View>
          <Text style={[styles.welcomeText, { color: colors.text }]}>Welcome to Admin Dashboard</Text>
          <Text style={[styles.subText, { color: colors.textMuted }]}>Session secured with SecureStore + JWT invalidation</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 50 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: 1 },
  headerTitle: { fontSize: 20, fontWeight: "800" },
  headerSubtitle: { fontSize: 12, marginTop: 2 },
  logoutButton: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,77,79,0.12)", borderWidth: 1, borderColor: "rgba(255,77,79,0.3)", paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, gap: 6 },
  logoutText: { color: "#FF4D4F", fontSize: 13, fontWeight: "700" },
  content: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  welcomeCard: { borderRadius: 24, borderWidth: 1, padding: 28, alignItems: "center", gap: 8, width: "100%" },
  iconCircle: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  welcomeText: { fontSize: 16, fontWeight: "800", textAlign: "center" },
  subText: { fontSize: 12, textAlign: "center", marginTop: 4 },
});