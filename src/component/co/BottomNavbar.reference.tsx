/**
 * CO bottom navigation bar
 */
import React from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, usePathname } from "expo-router";

type NavItem = {
  label: string;
  route: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
};

const TABS: NavItem[] = [
  { label: "Home", route: "/co/dashboard", icon: "home-outline", iconActive: "home" },
  { label: "Savings", route: "/co/savings", icon: "wallet-outline", iconActive: "wallet" },
  { label: "Collect", route: "/co/combined", icon: "flash-outline", iconActive: "flash" },
  { label: "Repay", route: "/co/repayment", icon: "cash-outline", iconActive: "cash" },
  { label: "More", route: "/co/profile", icon: "grid-outline", iconActive: "grid" },
];

type Props = { hidden?: boolean };

export default function BottomNavbar({ hidden = false }: Props) {
  const router = useRouter();
  const pathname = usePathname() || "";

  if (hidden) return null;

  const isActive = (route: string) => {
    const p = pathname.replace(/\/$/, "");
    const r = route.replace(/\/$/, "");
    if (r.endsWith("/dashboard")) {
      return p.endsWith("/dashboard") || p.endsWith("/co");
    }
    const slug = r.split("/").pop() || "";
    return p === r || p.includes("/" + slug);
  };

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {TABS.map((tab) => {
          const active = isActive(tab.route);
          return (
            <Pressable
              key={tab.route}
              onPress={() => {
                if (!active) router.push(tab.route as any);
              }}
              style={styles.tab}
            >
              <View style={[styles.iconWrap, active && styles.iconWrapActive]}>
                <Ionicons
                  name={active ? tab.iconActive : tab.icon}
                  size={22}
                  color={active ? "#2563EB" : "#94A3B8"}
                />
              </View>
              <Text style={[styles.label, active && styles.labelActive]} numberOfLines={1}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    elevation: 20,
    paddingBottom: Platform.OS === "ios" ? 18 : 10,
    paddingHorizontal: 12,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: "rgba(226,232,240,0.95)",
    shadowColor: "#0F172A",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 10,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: 2,
  },
  iconWrap: {
    width: 36,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  iconWrapActive: {
    backgroundColor: "rgba(37,99,235,0.1)",
  },
  label: {
    fontSize: 10,
    fontWeight: "600",
    color: "#94A3B8",
  },
  labelActive: {
    color: "#2563EB",
    fontWeight: "700",
  },
});
