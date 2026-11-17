/**
 * CO screen header – title + sync button + optional back / profile
 */
import React from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  StatusBar,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";
import HeaderSyncButton from "./HeaderSyncButton";

const TITLE_MAP: Record<string, string> = {
  dashboard: "Dashboard",
  savings: "Savings",
  repayment: "Repayment",
  combined: "Collect",
  disbursement: "Disbursement",
  withdrawal: "Withdrawal",
  clients: "Clients",
  "add-client": "Register Client",
  unions: "Unions",
  reports: "Analytics",
  history: "History",
  client_summary: "Financial Summary",
  close: "Close Account",
  profile: "Profile",
};

type Props = {
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  right?: React.ReactNode;
  hideSync?: boolean;
  backgroundColor?: string;
  textColor?: string;
  mutedColor?: string;
  onSynced?: (n: number) => void;
  showProfile?: boolean;
};

export default function Header({
  title,
  subtitle,
  showBack,
  onBack,
  right,
  hideSync = false,
  backgroundColor = "#FFFFFF",
  textColor = "#0F172A",
  mutedColor = "#64748B",
  onSynced,
  showProfile = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname() || "";

  const slug = pathname.split("/").filter(Boolean).pop() || "dashboard";
  const resolvedTitle = title || TITLE_MAP[slug] || "Cupad CO";

  // Auto back on non-root screens unless overridden
  const canBack =
    showBack !== undefined
      ? showBack
      : !["dashboard", "co"].includes(slug);

  const handleBack = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace("/co/dashboard" as any);
  };

  return (
    <View style={[styles.wrap, { backgroundColor }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {canBack && (
            <Pressable onPress={handleBack} hitSlop={10} style={styles.iconBtn}>
              <Ionicons name="chevron-back" size={24} color={textColor} />
            </Pressable>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.title, { color: textColor }]} numberOfLines={1}>
              {resolvedTitle}
            </Text>
            {!!subtitle && (
              <Text style={[styles.sub, { color: mutedColor }]} numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.right}>
          {right}
          {!hideSync && (
            <HeaderSyncButton color={mutedColor} onSynced={onSynced} />
          )}
          {showProfile && (
            <Pressable
              onPress={() => router.push("/co/profile" as any)}
              hitSlop={8}
              style={styles.iconBtn}
            >
              <Ionicons name="person-circle-outline" size={26} color={mutedColor} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingTop:
      Platform.OS === "android" ? (StatusBar.currentHeight || 0) + 6 : 48,
    paddingBottom: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(226,232,240,0.9)",
    zIndex: 30,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  left: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
  },
  sub: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 1,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
});
