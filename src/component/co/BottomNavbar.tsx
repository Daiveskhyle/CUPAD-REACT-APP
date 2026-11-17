import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  PanResponder,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { usePathname, router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeContext";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const HORIZONTAL_PADDING = 12;
const BAR_INNER_WIDTH = SCREEN_WIDTH - HORIZONTAL_PADDING * 2;

type NavItem = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  activeIcon: keyof typeof Ionicons.glyphMap;
  route: string;
  color: string;
};

// BOTTOM NAV BAR ITEMS
const NAV_ITEMS: NavItem[] = [
  {
    id: "home",
    label: "Home",
    icon: "home-outline",
    activeIcon: "home",
    route: "/co/dashboard",
    color: "#1677FF",
  },
  {
    id: "collect",
    label: "Collect",
    icon: "flash-outline",
    activeIcon: "flash",
    route: "/co/combined",
    color: "#10B981",
  },
  {
    id: "disburse",
    label: "Disburse",
    icon: "paper-plane-outline",
    activeIcon: "paper-plane",
    route: "/co/disbursement",
    color: "#3B82F6",
  },
  {
    id: "analytics",
    label: "Analytics",
    icon: "bar-chart-outline",
    activeIcon: "bar-chart",
    route: "/co/reports",
    color: "#EA580C",
  },
  {
    id: "more",
    label: "More",
    icon: "grid-outline",
    activeIcon: "grid",
    route: "#more",
    color: "#8B5CF6",
  },
];

// QUICK ACTIONS
const QUICK_LINKS = [
  { id: "collect", title: "Collect", route: "/co/combined", icon: "flash" as const, color: "#10B981" },
  { id: "savings", title: "Savings", route: "/co/savings", icon: "wallet" as const, color: "#2563EB" },
  { id: "repayment", title: "Repayment", route: "/co/repayment", icon: "cash" as const, color: "#8B5CF6" },
  { id: "disburse", title: "Disburse", route: "/co/disbursement", icon: "paper-plane" as const, color: "#0284C7" },
  { id: "register", title: "Register", route: "/co/add-client", icon: "person-add" as const, color: "#4F46E5" },
  { id: "clients", title: "Clients", route: "/co/clients", icon: "people" as const, color: "#0D9488" },
  { id: "withdraw", title: "Withdraw", route: "/co/withdrawal", icon: "arrow-down-circle" as const, color: "#EF4444" },
  { id: "unions", title: "Unions", route: "/co/unions", icon: "business" as const, color: "#D97706" },
  { id: "analytics", title: "Analytics", route: "/co/reports", icon: "bar-chart" as const, color: "#EA580C" },
  { id: "history", title: "History", route: "/co/history", icon: "time" as const, color: "#059669" },
  { id: "summary", title: "Summary", route: "/co/client_summary", icon: "document-text" as const, color: "#64748B" },
  { id: "close", title: "Close Acc", route: "/co/close", icon: "person-remove" as const, color: "#E11D48" },
  { id: "profile", title: "Profile", route: "/co/profile", icon: "person" as const, color: "#8B5CF6" },
];

const ITEM_WIDTH = BAR_INNER_WIDTH / NAV_ITEMS.length;

export default function CoBottomNavbar() {
  const { colors, isDark } = useTheme();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const [isMoreOpen, setIsMoreOpen] = useState(false);

  // Exact Dashboard Glass Tokens
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.72)" : "rgba(255, 255, 255, 0.94)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.9)";

  // Ambient glows matching dashboard.tsx orbs
  const orbBlue = isDark ? "rgba(37, 99, 235, 0.22)" : "rgba(37, 99, 235, 0.12)";
  const orbSky = isDark ? "rgba(14, 165, 233, 0.18)" : "rgba(14, 165, 233, 0.10)";
  const orbPurple = isDark ? "rgba(139, 92, 246, 0.16)" : "rgba(139, 92, 246, 0.08)";

  // Deeper, richer gradients
  const navGradientColors = isDark
    ? (["#0B1222", "#060A14"] as const)
    : (["#FFFFFF", "#EEF2F6"] as const);

  const sheetGradientColors = isDark
    ? (["#0D1628", "#060A14"] as const)
    : (["#FFFFFF", "#F1F5F9"] as const);

  const activeIndex = isMoreOpen
    ? NAV_ITEMS.findIndex((item) => item.id === "more")
    : NAV_ITEMS.findIndex(
        (item) => pathname === item.route || pathname?.startsWith(item.route + "/")
      );

  const indicatorAnim = useRef(new Animated.Value(0)).current;
  const indicatorOpacity = useRef(new Animated.Value(0)).current;
  const iconScaleAnims = useRef(NAV_ITEMS.map(() => new Animated.Value(1))).current;

  // Sheet gesture & transition animations
  const sheetTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (activeIndex >= 0) {
      Animated.parallel([
        Animated.spring(indicatorAnim, {
          toValue: activeIndex * ITEM_WIDTH,
          friction: 8,
          tension: 70,
          useNativeDriver: true,
        }),
        Animated.timing(indicatorOpacity, {
          toValue: 1,
          duration: 180,
          useNativeDriver: true,
        }),
      ]).start();

      iconScaleAnims[activeIndex].setValue(0.85);
      Animated.spring(iconScaleAnims[activeIndex], {
        toValue: 1,
        friction: 4,
        tension: 90,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(indicatorOpacity, {
        toValue: 0,
        duration: 150,
        useNativeDriver: true,
      }).start();
    }
  }, [activeIndex, indicatorAnim, indicatorOpacity, iconScaleAnims]);

  // Open Sheet with fluid spring
  const openMoreSheet = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setIsMoreOpen(true);

    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.spring(sheetTranslateY, {
        toValue: 0,
        friction: 8,
        tension: 65,
        useNativeDriver: true,
      }),
    ]).start();
  };

  // Close Sheet with momentum
  const closeMoreSheet = (onClosed?: () => void) => {
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(sheetTranslateY, {
        toValue: SCREEN_HEIGHT * 0.7,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setIsMoreOpen(false);
      onClosed?.();
    });
  };

  // Interactive Pull-down PanResponder
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => gesture.dy > 8,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) {
          sheetTranslateY.setValue(gesture.dy);
        }
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 120 || gesture.vy > 0.8) {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          closeMoreSheet();
        } else {
          Animated.spring(sheetTranslateY, {
            toValue: 0,
            friction: 7,
            tension: 80,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  const handleTabPress = (item: NavItem) => {
    if (item.id === "more") {
      openMoreSheet();
      return;
    }

    if (pathname === item.route) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return;
    }

    Haptics.selectionAsync();
    router.push(item.route as any);
  };

  const handleQuickLinkPress = (route: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    closeMoreSheet(() => {
      router.push(route as any);
    });
  };

  const activeColor = activeIndex >= 0 ? NAV_ITEMS[activeIndex].color : colors.primary;

  return (
    <>
      <View style={[styles.rootContainer, { backgroundColor: isDark ? "#060A14" : "#EEF2F6" }]}>
        {/* DEEP THEMED BAR WRAPPER */}
        <View
          style={[
            styles.barWrapper,
            {
              paddingBottom: Math.max(insets.bottom, Platform.OS === "ios" ? 18 : 8),
              borderTopColor: glassBorder,
              shadowOpacity: isDark ? 0.45 : 0.08,
            },
          ]}
        >
          {/* SOLID DEEP GRADIENT */}
          <LinearGradient
            colors={navGradientColors}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={StyleSheet.absoluteFill}
          />

          {/* TOP ACCENT LINE */}
          <LinearGradient
            colors={[
              "rgba(255, 255, 255, 0)",
              activeColor + "70",
              "rgba(255, 255, 255, 0)",
            ]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.topAccentLine}
          />

          {/* NAV ITEMS ROW */}
          <View style={styles.navRow} accessibilityRole="tablist">
            {/* SLIDING PILL INDICATOR */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.slidingIndicator,
                {
                  width: ITEM_WIDTH - 6,
                  opacity: indicatorOpacity,
                  transform: [{ translateX: indicatorAnim }],
                },
              ]}
            >
              <View
                style={[
                  styles.slidingPill,
                  {
                    backgroundColor: `${activeColor}1C`,
                    borderColor: `${activeColor}38`,
                  },
                ]}
              >
                <View style={[styles.activeTopDot, { backgroundColor: activeColor }]} />
              </View>
            </Animated.View>

            {/* TAB BUTTONS */}
            {NAV_ITEMS.map((item, index) => {
              const isActive = activeIndex === index;
              const currentItemColor = isActive ? item.color : colors.textMuted;

              return (
                <Pressable
                  key={item.id}
                  onPress={() => handleTabPress(item)}
                  style={({ pressed }) => [
                    styles.tabButton,
                    { width: ITEM_WIDTH, transform: [{ scale: pressed ? 0.92 : 1 }] },
                  ]}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: isActive }}
                  accessibilityLabel={`${item.label} tab`}
                >
                  <Animated.View
                    style={[
                      styles.iconBox,
                      { transform: [{ scale: iconScaleAnims[index] }] },
                    ]}
                  >
                    <Ionicons
                      name={isActive ? item.activeIcon : item.icon}
                      size={19}
                      color={currentItemColor}
                    />
                  </Animated.View>

                  <Text
                    style={[
                      styles.tabLabel,
                      {
                        color: currentItemColor,
                        fontWeight: isActive ? "800" : "600",
                      },
                    ]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* HOME DRAG INDICATOR PILL */}
          <View
            style={[
              styles.homeIndicatorBar,
              { backgroundColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.12)" },
            ]}
          />
        </View>
      </View>

      {/* ================= GESTURE BOTTOM SHEET MODAL ================= */}
      <Modal
        visible={isMoreOpen}
        transparent
        animationType="none"
        onRequestClose={() => closeMoreSheet()}
      >
        <View style={styles.modalOverlay}>
          {/* ANIMATED BACKDROP TAP TO DISMISS */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdropOpacity }]}>
            <Pressable
              style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0, 0, 0, 0.74)" }]}
              onPress={() => closeMoreSheet()}
            />
          </Animated.View>

          {/* DRAGGABLE MODAL SHEET */}
          <Animated.View
            style={[
              styles.modalSheet,
              {
                borderColor: glassBorder,
                paddingBottom: Math.max(insets.bottom + 12, 28),
                transform: [{ translateY: sheetTranslateY }],
              },
            ]}
          >
            {/* DEEP MIDNIGHT GRADIENT SHEET BACKGROUND */}
            <LinearGradient
              colors={sheetGradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            {/* DASHBOARD-STYLE AMBIENT GLOW ORBS */}
            <View
              pointerEvents="none"
              style={[
                styles.modalAmbientOrb,
                { top: -50, left: -40, backgroundColor: orbBlue, width: 220, height: 220, borderRadius: 110 },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.modalAmbientOrb,
                { top: 80, right: -50, backgroundColor: orbSky, width: 200, height: 200, borderRadius: 100 },
              ]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.modalAmbientOrb,
                { bottom: 20, left: SCREEN_WIDTH * 0.25, backgroundColor: orbPurple, width: 180, height: 180, borderRadius: 90 },
              ]}
            />

            {/* PULL GESTURE HANDLE BAR AREA */}
            <View {...panResponder.panHandlers} style={styles.gestureHeaderArea}>
              <View style={styles.sheetHandle} />

              <View style={styles.modalHeader}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Quick Actions</Text>
                  <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                    All field operations & tools
                  </Text>
                </View>

                <Pressable
                  onPress={() => closeMoreSheet()}
                  hitSlop={8}
                  style={[
                    styles.closeIconBtn,
                    {
                      backgroundColor: cardSurfaceBg,
                      borderColor: glassBorder,
                    },
                  ]}
                >
                  <Ionicons name="close" size={18} color={colors.text} />
                </Pressable>
              </View>
            </View>

            {/* GRID OF ACTIONS */}
            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.actionsGrid}
            >
              {QUICK_LINKS.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => handleQuickLinkPress(item.route)}
                  style={({ pressed }) => [
                    styles.actionGridCard,
                    {
                      backgroundColor: cardSurfaceBg,
                      borderColor: glassBorder,
                      transform: [{ scale: pressed ? 0.93 : 1 }],
                    },
                  ]}
                >
                  <LinearGradient
                    colors={[`${item.color}25`, `${item.color}08`]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.actionGridIconCircle}
                  >
                    <Ionicons name={item.icon} size={20} color={item.color} />
                  </LinearGradient>

                  <Text
                    style={[styles.actionGridTitle, { color: colors.text }]}
                    numberOfLines={1}
                  >
                    {item.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  rootContainer: {
    overflow: "hidden",
  },
  barWrapper: {
    borderTopWidth: 1.2,
    paddingTop: 8,
    position: "relative",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowRadius: 14,
    elevation: 20,
  },
  topAccentLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1.5,
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: HORIZONTAL_PADDING,
    position: "relative",
    height: 52,
  },
  slidingIndicator: {
    position: "absolute",
    left: HORIZONTAL_PADDING + 3,
    height: 48,
    borderRadius: 14,
    overflow: "hidden",
  },
  slidingPill: {
    flex: 1,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "flex-start",
    borderWidth: 1,
  },
  activeTopDot: {
    width: 14,
    height: 3,
    borderRadius: 2,
    marginTop: 2,
  },
  tabButton: {
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 2,
    gap: 2,
  },
  iconBox: {
    width: 26,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -1,
  },
  tabLabel: {
    fontSize: 10,
    letterSpacing: 0.1,
  },
  homeIndicatorBar: {
    width: 40,
    height: 3.5,
    borderRadius: 2,
    alignSelf: "center",
    marginTop: 6,
  },

  /* MODAL BOTTOM SHEET */
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalSheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1.2,
    borderBottomWidth: 0,
    paddingTop: 8,
    paddingHorizontal: 16,
    maxHeight: "82%",
    overflow: "hidden",
    position: "relative",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 28,
  },
  gestureHeaderArea: {
    paddingTop: 4,
  },
  modalAmbientOrb: {
    position: "absolute",
    opacity: 0.5,
  },
  sheetHandle: {
    width: 40,
    height: 4.5,
    borderRadius: 3,
    backgroundColor: "#94A3B8",
    alignSelf: "center",
    marginBottom: 12,
    opacity: 0.5,
  },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  modalTitle: {
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  modalSubtitle: {
    fontSize: 11.5,
    fontWeight: "500",
    marginTop: 1,
  },
  closeIconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  /* ACTION GRID */
  actionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingBottom: 20,
  },
  actionGridCard: {
    width: "23%",
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 4,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 2,
  },
  actionGridIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  actionGridTitle: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
});