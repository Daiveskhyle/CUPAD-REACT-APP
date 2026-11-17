// app/co/profile.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Animated,
  Easing,
  Alert,
  Image,
  RefreshControl,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as LocalAuthentication from "expo-local-authentication";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as ImagePicker from "expo-image-picker";
import axios from "axios";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import { router } from "expo-router";
import {
  getDb,
  getLoginHistory,
  clearCacheForAccountSwitch,
  getAllPendingCounts,
  autoSyncIfOnline,
  isOnline as checkIsOnline,
} from "../../src/db/database";
import { terminateSession, fullWipeSession } from "../../src/utils/session";

const { width } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_PROFILE = `${API_BASE}/api/profile.php`;

function triggerHaptic(type: "light" | "medium" | "heavy" | "success" | "warning" | "error" = "light") {
  if (Platform.OS === "web") return;
  try {
    if (type === "success") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (type === "warning") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (type === "error") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    else if (type === "medium") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    else if (type === "heavy") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {}
}

/**
 * Intelligent avatar candidates builder.
 */
function buildAvatarCandidates(user: any, localUri?: string | null): string[] {
  const candidates: string[] = [];

  if (localUri && typeof localUri === "string" && localUri.trim().length > 0) {
    candidates.push(localUri.trim());
  }

  const rawTarget =
    user?.profile_pic ||
    user?.profile_pic_url ||
    user?.photo ||
    user?.photo_url ||
    user?.avatar ||
    user?.avatar_url ||
    user?.image;

  if (!rawTarget || typeof rawTarget !== "string") return candidates;

  const target = rawTarget.trim();
  if (
    !target ||
    target === "null" ||
    target === "undefined" ||
    target.includes("default_avatar") ||
    target === "default.png"
  ) {
    return candidates;
  }

  if (target.startsWith("http://") || target.startsWith("https://")) {
    candidates.push(target);
    if (target.startsWith("http://")) {
      candidates.push(target.replace("http://", "https://"));
    }
    return candidates;
  }

  if (target.startsWith("file://") || target.startsWith("content://") || target.startsWith("data:image")) {
    candidates.push(target);
    return candidates;
  }

  const clean = target.replace(/^(\.\.\/|\.\/|\/)+/, "");

  candidates.push(`${API_BASE}/${clean}`);

  if (!clean.startsWith("api/")) {
    candidates.push(`${API_BASE}/api/${clean}`);
  }

  if (clean.startsWith("uploads/") && !clean.includes("profile_pics/")) {
    const filename = clean.replace(/^uploads\//, "");
    candidates.push(`${API_BASE}/uploads/profile_pics/${filename}`);
    candidates.push(`${API_BASE}/api/uploads/profile_pics/${filename}`);
  } else if (clean.includes("profile_pics/")) {
    const filename = clean.split("/").pop();
    if (filename) {
      candidates.push(`${API_BASE}/uploads/${filename}`);
    }
  }

  return Array.from(new Set(candidates));
}

function formatLastLogin(iso?: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  return d.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getHistoryIcon(method?: string): keyof typeof Ionicons.glyphMap {
  if (method?.includes("finger")) return "finger-print";
  if (method?.includes("face")) return "scan";
  return "lock-open-outline";
}

function getHistoryColor(method?: string): string {
  if (method?.includes("finger")) return "#8B5CF6";
  if (method?.includes("face")) return "#06B6D4";
  return "#10B981";
}

function formatMethodTitle(method?: string): string {
  if (!method) return "Password Login";
  if (method.includes("finger")) return "Fingerprint Verified";
  if (method.includes("face")) return "Face Recognition";
  return "Standard Auth";
}

/* ================= AMBIENT ORBS ================= */
function Orb({
  size,
  color,
  left,
  top,
  delay = 0,
}: {
  size: number;
  color: string;
  left: number;
  top: number;
  delay?: number;
}) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -16,
            duration: 4000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.1,
            duration: 4000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: 0,
            duration: 4000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 4000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, [delay, translateY, scale]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left,
        top,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: 0.35,
        transform: [{ translateY }, { scale }],
      }}
    />
  );
}

/* ================= MODERN BIOMETRIC SWITCH ================= */
function ModernBiometricToggle({
  value,
  onToggle,
  primaryColor,
  isDark,
}: {
  value: boolean;
  onToggle: (next: boolean) => void;
  primaryColor: string;
  isDark: boolean;
}) {
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: value ? 1 : 0,
      tension: 70,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 22],
  });

  const trackBg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [isDark ? "rgba(71, 85, 105, 0.45)" : "rgba(203, 213, 225, 0.75)", primaryColor],
  });

  return (
    <Pressable
      onPress={() => onToggle(!value)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      style={styles.bioToggleWrapper}
    >
      <View
        style={[
          styles.bioBadgePill,
          {
            backgroundColor: value ? "rgba(16, 185, 129, 0.12)" : isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.05)",
          },
        ]}
      >
        <View
          style={[
            styles.bioBadgeDot,
            { backgroundColor: value ? "#10B981" : "#94A3B8" },
          ]}
        />
        <Text
          style={[
            styles.bioBadgeText,
            { color: value ? "#10B981" : "#94A3B8" },
          ]}
        >
          {value ? "ACTIVE" : "OFF"}
        </Text>
      </View>

      <Animated.View
        style={[
          styles.bioSwitchTrack,
          {
            backgroundColor: trackBg,
            borderColor: value ? `${primaryColor}55` : isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
          },
        ]}
      >
        <Animated.View
          style={[
            styles.bioSwitchThumb,
            {
              transform: [{ translateX }],
              shadowColor: value ? primaryColor : "#000",
            },
          ]}
        >
          <Ionicons
            name={value ? "finger-print" : "lock-closed"}
            size={11.5}
            color={value ? primaryColor : "#94A3B8"}
          />
        </Animated.View>
      </Animated.View>
    </Pressable>
  );
}

/* ================= SYNCHRONIZED SHIMMER SKELETON ENGINE ================= */
const ShimmerContext = React.createContext<Animated.Value | null>(null);

function Skeleton({
  width: w,
  height: h,
  borderRadius = 10,
  style,
}: {
  width?: number | `${number}%` | "100%" | "auto";
  height?: number | `${number}%`;
  borderRadius?: number;
  style?: any;
}) {
  const { isDark } = useTheme();
  const shimmerAnim = React.useContext(ShimmerContext);

  const baseColor = isDark ? "rgba(51, 65, 85, 0.45)" : "rgba(226, 232, 240, 0.75)";
  const highlightColor = isDark ? "rgba(100, 116, 139, 0.35)" : "rgba(255, 255, 255, 0.85)";

  const translateX = shimmerAnim
    ? shimmerAnim.interpolate({
        inputRange: [-1, 1],
        outputRange: [-width, width],
      })
    : 0;

  return (
    <View
      style={[
        {
          width: w,
          height: h,
          borderRadius,
          backgroundColor: baseColor,
          overflow: "hidden",
        },
        style,
      ]}
    >
      {shimmerAnim && (
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              transform: [{ translateX }],
            },
          ]}
        >
          <LinearGradient
            colors={["transparent", highlightColor, "transparent"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      )}
    </View>
  );
}

/* ================= FULL PAGE SKELETON ================= */
function ProfileSkeleton({ cardSurfaceBg, glassBorder }: { cardSurfaceBg: string; glassBorder: string }) {
  const shimmerAnim = useRef(new Animated.Value(-1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerAnim]);

  return (
    <ShimmerContext.Provider value={shimmerAnim}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        scrollEnabled={false}
      >
        {/* HERO CARD SKELETON */}
        <View style={[styles.heroCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
          <View style={styles.heroTopBar}>
            <Skeleton width={110} height={22} borderRadius={20} />
            <Skeleton width={90} height={22} borderRadius={12} />
          </View>

          <View style={styles.avatarSection}>
            <Skeleton width={92} height={92} borderRadius={46} />
          </View>

          <Skeleton width={180} height={20} borderRadius={8} style={{ marginTop: 6 }} />
          <Skeleton width={110} height={14} borderRadius={6} style={{ marginTop: 8 }} />

          <View style={styles.heroQuickActions}>
            <Skeleton width={96} height={32} borderRadius={18} />
            <Skeleton width={120} height={32} borderRadius={18} />
          </View>

          <View style={styles.heroMetricsGrid}>
            <View style={[styles.metricGridItem, { backgroundColor: "rgba(148, 163, 184, 0.1)" }]}>
              <Skeleton width={60} height={10} borderRadius={4} />
              <Skeleton width={50} height={14} borderRadius={4} style={{ marginTop: 6 }} />
            </View>
            <View style={[styles.metricGridItem, { backgroundColor: "rgba(148, 163, 184, 0.1)" }]}>
              <Skeleton width={60} height={10} borderRadius={4} />
              <Skeleton width={50} height={14} borderRadius={4} style={{ marginTop: 6 }} />
            </View>
            <View style={[styles.metricGridItem, { backgroundColor: "rgba(148, 163, 184, 0.1)" }]}>
              <Skeleton width={60} height={10} borderRadius={4} />
              <Skeleton width={40} height={14} borderRadius={4} style={{ marginTop: 6 }} />
            </View>
          </View>
        </View>

        {/* ACCOUNT IDENTITY SKELETON */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeader}>
            <View style={{ gap: 4 }}>
              <Skeleton width={140} height={16} borderRadius={6} />
              <Skeleton width={180} height={11} borderRadius={4} />
            </View>
            <Skeleton width={48} height={24} borderRadius={12} />
          </View>

          <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            {[1, 2, 3, 4].map((i) => (
              <React.Fragment key={i}>
                <View style={styles.cellRow}>
                  <Skeleton width={36} height={36} borderRadius={12} />
                  <View style={{ flex: 1, gap: 6, marginLeft: 4 }}>
                    <Skeleton width={90} height={11} borderRadius={4} />
                    <Skeleton width={150} height={14} borderRadius={5} />
                  </View>
                  <Skeleton width={20} height={20} borderRadius={10} />
                </View>
                {i < 4 && <View style={[styles.cellDivider, { backgroundColor: glassBorder }]} />}
              </React.Fragment>
            ))}
          </View>
        </View>

        {/* OFFLINE DATABASE VAULT SKELETON */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeader}>
            <View style={{ gap: 4 }}>
              <Skeleton width={160} height={16} borderRadius={6} />
              <Skeleton width={190} height={11} borderRadius={4} />
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <Skeleton width={74} height={22} borderRadius={12} />
              <Skeleton width={30} height={30} borderRadius={15} />
            </View>
          </View>

          <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            <View style={styles.metricsGrid}>
              {[1, 2, 3, 4].map((m) => (
                <View
                  key={m}
                  style={[
                    styles.metricTile,
                    { backgroundColor: "rgba(148, 163, 184, 0.1)" },
                  ]}
                >
                  <Skeleton width={16} height={16} borderRadius={8} />
                  <Skeleton width={28} height={14} borderRadius={4} style={{ marginTop: 4 }} />
                  <Skeleton width={36} height={9} borderRadius={3} style={{ marginTop: 2 }} />
                </View>
              ))}
            </View>

            <View style={[styles.backupDetailsWrap, { gap: 8, marginTop: 12 }]}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Skeleton width={100} height={12} borderRadius={4} />
                <Skeleton width={60} height={12} borderRadius={4} />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Skeleton width={120} height={12} borderRadius={4} />
                <Skeleton width={70} height={12} borderRadius={4} />
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Skeleton width={90} height={12} borderRadius={4} />
                <Skeleton width={80} height={12} borderRadius={4} />
              </View>
            </View>

            {/* Storage Hygiene Box Skeleton */}
            <View style={[styles.storageCleanTile, { backgroundColor: "rgba(148, 163, 184, 0.08)", borderColor: glassBorder }]}>
              <View style={styles.storageCleanHeader}>
                <Skeleton width={32} height={32} borderRadius={10} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Skeleton width={150} height={13} borderRadius={4} />
                  <Skeleton width={190} height={10} borderRadius={3} />
                </View>
                <Skeleton width={75} height={20} borderRadius={8} />
              </View>
              <Skeleton width="100%" height={34} borderRadius={11} style={{ marginTop: 6 }} />
            </View>
          </View>
        </View>

        {/* SECURITY & PREFERENCES SKELETON */}
        <View style={styles.sectionWrap}>
          <View style={styles.sectionHeader}>
            <View style={{ gap: 4 }}>
              <Skeleton width={160} height={16} borderRadius={6} />
              <Skeleton width={210} height={11} borderRadius={4} />
            </View>
          </View>

          <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            {/* Biometric Tile */}
            <View style={[styles.bioTileContainer, { borderColor: glassBorder, padding: 10 }]}>
              <View style={styles.bioTileTopRow}>
                <Skeleton width={40} height={40} borderRadius={14} />
                <View style={{ flex: 1, gap: 5, marginLeft: 6 }}>
                  <Skeleton width={140} height={14} borderRadius={5} />
                  <Skeleton width={180} height={11} borderRadius={4} />
                </View>
                <Skeleton width={70} height={26} borderRadius={13} />
              </View>
              <View style={{ marginTop: 8, paddingTop: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(148, 163, 184, 0.2)" }}>
                <Skeleton width="85%" height={11} borderRadius={4} />
              </View>
            </View>

            <View style={[styles.cellDivider, { backgroundColor: glassBorder, marginVertical: 8 }]} />

            {/* Appearance Mode Tile */}
            <View style={styles.cellRow}>
              <Skeleton width={36} height={36} borderRadius={12} />
              <View style={{ flex: 1, gap: 5, marginLeft: 4 }}>
                <Skeleton width={110} height={13} borderRadius={4} />
                <Skeleton width={140} height={11} borderRadius={4} />
              </View>
              <Skeleton width={18} height={18} borderRadius={9} />
            </View>
          </View>
        </View>

        {/* SESSION & DANGER ACTIONS SKELETON */}
        <View style={[styles.sectionWrap, { marginBottom: 34 }]}>
          <View style={styles.sectionHeader}>
            <View style={{ gap: 4 }}>
              <Skeleton width={170} height={16} borderRadius={6} />
              <Skeleton width={190} height={11} borderRadius={4} />
            </View>
          </View>

          <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, gap: 10 }]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12 }}>
              <Skeleton width={36} height={36} borderRadius={12} />
              <View style={{ flex: 1, gap: 4 }}>
                <Skeleton width={90} height={14} borderRadius={4} />
                <Skeleton width={180} height={11} borderRadius={4} />
              </View>
              <Skeleton width={16} height={16} borderRadius={8} />
            </View>

            <View style={[styles.cellDivider, { backgroundColor: glassBorder }]} />

            <View style={{ padding: 12, gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Skeleton width={32} height={32} borderRadius={10} />
                <View style={{ flex: 1, gap: 4 }}>
                  <Skeleton width={160} height={13} borderRadius={4} />
                  <Skeleton width={200} height={10} borderRadius={3} />
                </View>
              </View>
            </View>
          </View>
          <Skeleton width={160} height={12} borderRadius={4} style={{ alignSelf: "center", marginTop: 16 }} />
        </View>
      </ScrollView>
    </ShimmerContext.Provider>
  );
}

export default function ProfileScreen() {
  const { colors, isDark, toggleTheme } = useTheme();

  // Glassmorphic Theme Palette
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.72)" : "rgba(255, 255, 255, 0.92)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.09)";
  const orbColor2 = isDark ? "rgba(14, 165, 233, 0.13)" : "rgba(14, 165, 233, 0.07)";

  // User & State
  const [user, setUser] = useState<any>(null);
  const [lastLogin, setLastLogin] = useState<string | null>(null);
  const [loginHistory, setLoginHistory] = useState<any[]>([]);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioTypeLabel, setBioTypeLabel] = useState<string>("Biometric Unlock");
  const [isOnlineState, setIsOnlineState] = useState(true);

  // Avatar Management
  const [localAvatarUri, setLocalAvatarUri] = useState<string | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imageKey, setImageKey] = useState<number>(Date.now());
  const [previewModal, setPreviewModal] = useState(false);

  // System State
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [syncingNow, setSyncingNow] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [clearingCache, setClearingCache] = useState(false);

  // Confirmation Modals State
  type ConfirmModalType = "clear_cache" | "logout" | "wipe" | null;
  const [confirmModal, setConfirmModal] = useState<ConfirmModalType>(null);

  // Edit Profile Modal
  const [editModal, setEditModal] = useState(false);
  const [editFullName, setEditFullName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // Database Statistics
  const [offlineStats, setOfflineStats] = useState<any>({
    clients: 0,
    savings: 0,
    loans: 0,
    collections: 0,
    pendingSync: 0,
    lastSync: null,
    dbSize: "0 items",
    backupTime: null,
  });

  // Animated Toasts
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastY = useRef(new Animated.Value(-60)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const syncRotateAnim = useRef(new Animated.Value(0)).current;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    Animated.parallel([
      Animated.spring(toastY, { toValue: 0, tension: 90, friction: 9, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastY, { toValue: -40, duration: 250, useNativeDriver: true }),
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start(() => setToastMessage(null));
    }, 2400);
  };

  const startSyncRotate = () => {
    syncRotateAnim.setValue(0);
    Animated.loop(
      Animated.timing(syncRotateAnim, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    ).start();
  };

  const stopSyncRotate = () => {
    syncRotateAnim.stopAnimation();
    syncRotateAnim.setValue(0);
  };

  const syncSpin = syncRotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  const avatarCandidates = useMemo(() => {
    return buildAvatarCandidates(user, localAvatarUri);
  }, [user, localAvatarUri]);

  const activeAvatarUri = useMemo(() => {
    if (avatarCandidates.length === 0 || candidateIndex >= avatarCandidates.length) {
      return null;
    }
    const current = avatarCandidates[candidateIndex];
    if (current && current.startsWith("http") && imageKey) {
      return `${current}${current.includes("?") ? "&" : "?"}_k=${imageKey}`;
    }
    return current;
  }, [avatarCandidates, candidateIndex, imageKey]);

  const showImage = !!activeAvatarUri && !imgError;

  const loadOfflineStats = async (db: any) => {
    try {
      const statsObj: any = {
        clients: 0,
        savings: 0,
        loans: 0,
        collections: 0,
        pendingSync: 0,
        lastSync: null,
        dbSize: "0 items",
        backupTime: null,
      };

      try {
        const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM clients`)) as any;
        statsObj.clients = r?.c || 0;
      } catch {}

      try {
        const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM savings`)) as any;
        statsObj.savings = r?.c || 0;
      } catch {}

      try {
        const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM loans`)) as any;
        statsObj.loans = r?.c || 0;
      } catch {}

      try {
        const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM collections`)) as any;
        statsObj.collections = r?.c || 0;
      } catch {}

      try {
        const pendingCounts = await getAllPendingCounts();
        statsObj.pendingSync = pendingCounts.total || 0;
      } catch {
        try {
          const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM sync_queue WHERE synced = 0`)) as any;
          statsObj.pendingSync = r?.c || 0;
        } catch {}
      }

      statsObj.lastSync = await AsyncStorage.getItem("cupad_last_sync");
      statsObj.backupTime = await AsyncStorage.getItem("cupad_last_backup");

      const total = statsObj.clients + statsObj.savings + statsObj.loans + statsObj.collections;
      statsObj.dbSize = total > 1000 ? `${(total / 1000).toFixed(1)}k records` : `${total} items`;

      setOfflineStats(statsObj);
    } catch {}
  };

  const refreshFromApi = useCallback(async (targetUsername?: string) => {
    const uname = targetUsername || user?.username;
    if (!uname) return;
    try {
      const res = await axios.get(`${API_PROFILE}?action=get&username=${encodeURIComponent(uname)}`, {
        timeout: 9000,
      });

      const serverUser = res.data?.user || res.data?.data;
      if (res.data?.success && serverUser) {
        setUser((prev: any) => {
          const updated = { ...(prev || {}), ...serverUser };
          AsyncStorage.setItem("cupad_user", JSON.stringify(updated)).catch(() => {});
          AsyncStorage.setItem("cupad_biometric_user", JSON.stringify(updated)).catch(() => {});
          return updated;
        });

        try {
          const db = await getDb();
          await db.runAsync(
            `UPDATE users SET 
              name = COALESCE(?, name),
              full_name = COALESCE(?, full_name),
              email = COALESCE(?, email),
              phone = COALESCE(?, phone),
              profile_pic = COALESCE(?, profile_pic)
             WHERE username = ? COLLATE NOCASE`,
            [
              serverUser.name || serverUser.full_name,
              serverUser.full_name || serverUser.name,
              serverUser.email,
              serverUser.phone,
              serverUser.profile_pic,
              uname,
            ]
          );
        } catch {}

        setCandidateIndex(0);
        setImgError(false);
        setImageKey(Date.now());
        setIsOnlineState(true);
        await AsyncStorage.setItem("cupad_last_sync", new Date().toISOString());
      }
    } catch (err: any) {
      if (!err.response) {
        setIsOnlineState(false);
      }
    }
  }, [user?.username]);

  const loadData = useCallback(async () => {
    let resolvedUsername = "";
    try {
      let stored = await AsyncStorage.getItem("cupad_user");
      if (!stored) stored = await AsyncStorage.getItem("cupad_biometric_user");
      if (!stored) stored = await AsyncStorage.getItem("auth_user");

      let parsedUser: any = stored ? JSON.parse(stored) : null;

      if (parsedUser) {
        resolvedUsername = parsedUser.username;

        const cachedLocal = await AsyncStorage.getItem(`cupad_local_avatar_${parsedUser.username}`);
        if (cachedLocal) {
          setLocalAvatarUri(cachedLocal);
        }

        const bioFlag =
          (await AsyncStorage.getItem("cupad_biometric_enabled")) ||
          (await AsyncStorage.getItem("cupad_bio_enabled"));
        setBioEnabled(bioFlag === "true");

        // Biometric Sensor Detection
        try {
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync().catch(() => []);
          const hasFace = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION);
          const hasFinger = types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT);
          if (hasFace && hasFinger) setBioTypeLabel("Fingerprint & Face ID");
          else if (hasFace) setBioTypeLabel("Face ID / Face Unlock");
          else setBioTypeLabel("Fingerprint Unlock");
        } catch {
          setBioTypeLabel("Biometric Unlock");
        }

        const online = await checkIsOnline().catch(() => false);
        setIsOnlineState(online);

        try {
          const db = await getDb();
          const dbUser = (await db.getFirstAsync(
            `SELECT * FROM users WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE LIMIT 1`,
            [parsedUser.username, parsedUser.username]
          )) as any;

          if (dbUser) {
            parsedUser = {
              ...dbUser,
              ...parsedUser,
              profile_pic: parsedUser.profile_pic || dbUser.profile_pic,
              full_name: parsedUser.full_name || dbUser.full_name || dbUser.name,
              phone: parsedUser.phone || parsedUser.phone_number || dbUser.phone,
              email: parsedUser.email || dbUser.email,
            };
          }

          if (dbUser?.last_login) {
            setLastLogin(dbUser.last_login);
          } else {
            const fallback = (await AsyncStorage.getItem("cupad_last_login")) || parsedUser.last_login;
            if (fallback) setLastLogin(fallback);
          }

          const hist = await getLoginHistory(parsedUser.username, 5);
          setLoginHistory(hist || []);
          await loadOfflineStats(db);
        } catch {
          const fallback = (await AsyncStorage.getItem("cupad_last_login")) || parsedUser.last_login;
          if (fallback) setLastLogin(fallback);
        }

        setUser(parsedUser);
      }
    } catch {}
    setInitialLoading(false);

    if (resolvedUsername) {
      refreshFromApi(resolvedUsername);
    }
  }, [refreshFromApi]);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 380, useNativeDriver: true }).start();
    loadData();
  }, [loadData, fadeAnim]);

  const onRefresh = useCallback(async () => {
    triggerHaptic("medium");
    setRefreshing(true);
    setCandidateIndex(0);
    setImgError(false);
    const online = await checkIsOnline().catch(() => false);
    setIsOnlineState(online);
    await loadData();
    if (user?.username) {
      await refreshFromApi(user.username);
    }
    setRefreshing(false);
  }, [loadData, refreshFromApi, user?.username]);

  const copyToClipboard = async (text: string, key: string, label = "Copied to clipboard") => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    triggerHaptic("success");
    setCopiedKey(key);
    showToast(label);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const pickAndUpload = useCallback(async () => {
    triggerHaptic("medium");
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission Needed", "Please enable photo gallery permissions to change your profile picture.");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (result.canceled || !result.assets?.[0]?.uri) return;

      const chosenUri = result.assets[0].uri;
      setUploading(true);

      setLocalAvatarUri(chosenUri);
      await AsyncStorage.setItem(`cupad_local_avatar_${user.username}`, chosenUri);
      setCandidateIndex(0);
      setImgError(false);
      setImageKey(Date.now());

      const form = new FormData();
      form.append("action", "upload");
      form.append("username", user.username);
      form.append("profile_pic", {
        uri: chosenUri,
        name: `profile_${Date.now()}.jpg`,
        type: "image/jpeg",
      } as any);

      const res = await axios.post(API_PROFILE, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 25000,
      });

      if (res.data?.success) {
        triggerHaptic("success");
        const returnedPic =
          res.data?.user?.profile_pic ||
          res.data?.profile_pic ||
          res.data?.profile_pic_url ||
          res.data?.photo ||
          res.data?.avatar ||
          res.data?.image ||
          res.data?.url;

        const serverUser = res.data?.user || {};
        const newUser = {
          ...user,
          ...serverUser,
          ...(returnedPic ? { profile_pic: returnedPic } : {}),
        };

        setUser(newUser);
        await AsyncStorage.setItem("cupad_user", JSON.stringify(newUser));
        await AsyncStorage.setItem("cupad_biometric_user", JSON.stringify(newUser));

        try {
          const db = await getDb();
          await db.runAsync(`UPDATE users SET profile_pic = ? WHERE username = ? COLLATE NOCASE`, [
            returnedPic || chosenUri,
            user.username,
          ]);
        } catch {}

        setCandidateIndex(0);
        setImgError(false);
        setImageKey(Date.now());
        showToast("Profile picture updated successfully");
      } else {
        triggerHaptic("warning");
        showToast("Saved locally (Server sync pending)");
      }
    } catch {
      triggerHaptic("warning");
      showToast("Photo saved locally on device");
    } finally {
      setUploading(false);
    }
  }, [user]);

  const openEditModal = () => {
    triggerHaptic("light");
    setEditFullName(user?.full_name || user?.name || "");
    setEditEmail(user?.email || "");
    setEditPhone(user?.phone || user?.phone_number || "");
    setEditModal(true);
  };

  const saveProfile = async () => {
    if (!editFullName.trim() || editFullName.trim().length < 2) {
      Alert.alert("Validation Error", "Full name must be at least 2 characters.");
      return;
    }
    if (editEmail && !/^\S+@\S+\.\S+$/.test(editEmail)) {
      Alert.alert("Validation Error", "Please provide a valid email address.");
      return;
    }
    if (editPhone && editPhone.replace(/[^0-9]/g, "").length < 10) {
      Alert.alert("Validation Error", "Please provide a valid phone number.");
      return;
    }

    setSavingProfile(true);
    try {
      const form = new FormData();
      form.append("action", "update");
      form.append("username", user.username);
      form.append("full_name", editFullName.trim());
      form.append("email", editEmail.trim());
      form.append("phone", editPhone.trim());

      const res = await axios.post(API_PROFILE, form, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 10000,
      });

      if (res.data?.success) {
        triggerHaptic("success");
        const updated = { ...user, ...res.data.user };
        setUser(updated);
        await AsyncStorage.setItem("cupad_user", JSON.stringify(updated));
        await AsyncStorage.setItem("cupad_biometric_user", JSON.stringify(updated));

        try {
          const db = await getDb();
          await db.runAsync(
            `UPDATE users SET full_name = ?, name = ?, email = ?, phone = ? WHERE username = ? COLLATE NOCASE`,
            [editFullName.trim(), editFullName.trim(), editEmail.trim(), editPhone.trim(), user.username]
          );
        } catch {}

        setEditModal(false);
        showToast("Profile details updated successfully");
      } else {
        throw new Error(res.data?.message || "Server update error");
      }
    } catch {
      triggerHaptic("medium");
      const updated = {
        ...user,
        full_name: editFullName.trim(),
        name: editFullName.trim(),
        email: editEmail.trim(),
        phone: editPhone.trim(),
        phone_number: editPhone.trim(),
      };
      setUser(updated);
      await AsyncStorage.setItem("cupad_user", JSON.stringify(updated));
      await AsyncStorage.setItem("cupad_biometric_user", JSON.stringify(updated));

      try {
        const db = await getDb();
        await db.runAsync(
          `UPDATE users SET full_name = ?, name = ?, email = ?, phone = ? WHERE username = ? COLLATE NOCASE`,
          [editFullName.trim(), editFullName.trim(), editEmail.trim(), editPhone.trim(), user.username]
        );
        await db.runAsync(`INSERT INTO sync_queue (type, data, synced, created_at) VALUES (?, ?, 0, ?)`, [
          "profile_update",
          JSON.stringify({
            username: user.username,
            full_name: editFullName.trim(),
            email: editEmail.trim(),
            phone: editPhone.trim(),
          }),
          new Date().toISOString(),
        ]);
      } catch {}

      setEditModal(false);
      showToast("Saved locally to offline sync queue");
    } finally {
      setSavingProfile(false);
    }
  };

  /* ================= REAL BIOMETRIC HARDWARE ENROLLMENT ================= */
  const handleToggleBiometrics = async (nextState: boolean) => {
    triggerHaptic("medium");
    if (!nextState) {
      Alert.alert(
        "Disable Biometrics?",
        `Fingerprint & Face unlock will be deactivated on this phone. You will need your master password for next login.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Turn Off",
            style: "destructive",
            onPress: async () => {
              await AsyncStorage.removeItem("cupad_biometric_enabled");
              await AsyncStorage.removeItem("cupad_bio_enabled");
              setBioEnabled(false);
              triggerHaptic("warning");
              showToast("Biometric access disabled");
            },
          },
        ]
      );
    } else {
      try {
        const hasHardware = await LocalAuthentication.hasHardwareAsync().catch(() => false);
        if (!hasHardware) {
          triggerHaptic("error");
          Alert.alert(
            "Hardware Unsupported",
            "This device does not have fingerprint or face recognition hardware available."
          );
          return;
        }

        const isEnrolled = await LocalAuthentication.isEnrolledAsync().catch(() => false);
        if (!isEnrolled) {
          triggerHaptic("warning");
          Alert.alert(
            "No Biometrics Enrolled",
            "No fingerprints or facial scans are registered on this device. Please register biometrics in your phone's security settings first."
          );
          return;
        }

        // Prompt biometric sensor authentication
        const authResult = await LocalAuthentication.authenticateAsync({
          promptMessage: `Verify your fingerprint or face to link quick login`,
          fallbackLabel: "Enter Password",
          cancelLabel: "Cancel",
          disableDeviceFallback: false,
        });

        if (authResult.success) {
          await AsyncStorage.setItem("cupad_biometric_enabled", "true");
          await AsyncStorage.setItem("cupad_bio_enabled", "true");
          if (user) {
            await AsyncStorage.setItem("cupad_biometric_user", JSON.stringify(user));
          }
          setBioEnabled(true);
          triggerHaptic("success");
          showToast(`${bioTypeLabel} activated successfully`);
        } else {
          triggerHaptic("error");
        }
      } catch (err: any) {
        triggerHaptic("error");
        Alert.alert("Biometric Error", err?.message || "Failed to authenticate biometrics.");
      }
    }
  };

  /* ================= CACHE & SESSION HANDLERS ================= */
  const executeClearOfflineCache = async () => {
    setConfirmModal(null);
    try {
      setClearingCache(true);
      triggerHaptic("heavy");
      const result = await clearCacheForAccountSwitch();
      setOfflineStats({
        clients: 0,
        savings: 0,
        loans: 0,
        collections: 0,
        pendingSync: 0,
        lastSync: null,
        backupTime: null,
        dbSize: "0 items",
      });

      if (user?.username) {
        await refreshFromApi(user.username);
      }

      triggerHaptic("success");
      showToast(
        result.pendingDiscarded > 0
          ? `Cache purged (${result.pendingDiscarded} discarded)`
          : "Offline cache cleared successfully"
      );
    } catch (e: any) {
      triggerHaptic("error");
      Alert.alert("Clear Error", e?.message || "Could not clear local database cache.");
    } finally {
      setClearingCache(false);
    }
  };

  const executeLogout = async () => {
    setConfirmModal(null);
    triggerHaptic("medium");
    await terminateSession();
    router.replace("/login" as any);
  };

  const executeFullWipe = async () => {
    setConfirmModal(null);
    triggerHaptic("heavy");
    try {
      await clearCacheForAccountSwitch();
    } catch {}
    await fullWipeSession();
    setBioEnabled(false);
    router.replace("/login" as any);
  };

  const initials = (user?.full_name || user?.name || user?.username || "CO")
    .split(" ")
    .filter(Boolean)
    .map((s: string) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isPendingSync = offlineStats.pendingSync > 0;
  const userRole = (user?.role || "co").toUpperCase();
  const locationTag = user?.last_city || user?.last_region || user?.branch_id || "Active Region";

  return (
    <CoScreenWrapper>
      {/* Background Ambient Orbs */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={270} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={420} delay={2000} />
      </View>

      {/* Floating Dynamic Toast */}
      {toastMessage && (
        <Animated.View
          style={[
            styles.toastBox,
            {
              backgroundColor: cardSurfaceBg,
              borderColor: glassBorder,
              opacity: toastOpacity,
              transform: [{ translateY: toastY }],
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={[styles.toastText, { color: colors.text }]} numberOfLines={1}>
            {toastMessage}
          </Text>
        </Animated.View>
      )}

      {/* Render Enhanced Shimmer Skeleton UI during initial load */}
      {initialLoading ? (
        <ProfileSkeleton cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
      ) : (
        <Animated.ScrollView
          style={{ flex: 1, opacity: fadeAnim }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* ================= HERO PROFILE CARD ================= */}
          <LinearGradient
            colors={
              isDark
                ? ["rgba(30, 41, 59, 0.9)", "rgba(15, 23, 42, 0.94)"]
                : ["#FFFFFF", "rgba(248, 250, 252, 0.96)"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroCard, { borderColor: glassBorder }]}
          >
            <View style={styles.heroTopBar}>
              <View
                style={[
                  styles.heroTagPill,
                  {
                    backgroundColor: isOnlineState ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.15)",
                  },
                ]}
              >
                <View
                  style={[
                    styles.statusPulseDot,
                    { backgroundColor: isOnlineState ? "#10B981" : "#EF4444" },
                  ]}
                />
                <Text
                  style={[
                    styles.heroTagText,
                    { color: isOnlineState ? "#10B981" : "#EF4444" },
                  ]}
                >
                  {isOnlineState ? "ONLINE & ACTIVE" : "OFFLINE WORKSPACE"}
                </Text>
              </View>

              <View
                style={[
                  styles.syncTimePill,
                  {
                    backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)",
                  },
                ]}
              >
                <Ionicons name="location-outline" size={11} color={colors.primary} />
                <Text style={[styles.syncTimeText, { color: colors.textMuted }]} numberOfLines={1}>
                  {locationTag}
                </Text>
              </View>
            </View>

            {/* Avatar Section */}
            <View style={styles.avatarSection}>
              <Pressable
                onPress={() => {
                  if (showImage) setPreviewModal(true);
                  else pickAndUpload();
                }}
                style={[styles.avatarRing, { borderColor: `${colors.primary}45` }]}
              >
                {showImage ? (
                  <View style={styles.avatarImgWrap}>
                    <Image
                      key={`${activeAvatarUri}_${candidateIndex}`}
                      source={{ uri: activeAvatarUri! }}
                      style={styles.avatarImg}
                      onLoadStart={() => setImgLoading(true)}
                      onLoadEnd={() => setImgLoading(false)}
                      onError={() => {
                        if (candidateIndex + 1 < avatarCandidates.length) {
                          setCandidateIndex((prev) => prev + 1);
                        } else {
                          setImgError(true);
                          setImgLoading(false);
                        }
                      }}
                    />
                    {imgLoading && (
                      <View style={styles.avatarLoadingOverlay}>
                        <ActivityIndicator size="small" color="#fff" />
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={[styles.avatarPlaceholder, { backgroundColor: colors.primary }]}>
                    <Text style={styles.avatarLetters}>{initials}</Text>
                  </View>
                )}

                <View style={[styles.ribbonWrap, { backgroundColor: colors.primary }]}>
                  <Text style={styles.ribbonChipText}>{userRole}</Text>
                </View>
              </Pressable>

              <Pressable
                style={[styles.cameraFab, { backgroundColor: colors.primary }]}
                onPress={pickAndUpload}
                disabled={uploading}
              >
                {uploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="camera" size={14} color="#fff" />
                )}
              </Pressable>
            </View>

            <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={1}>
              {user?.full_name || user?.name || "Credit Officer"}
            </Text>

            <Pressable
              onPress={() => copyToClipboard(`@${user?.username || "officer"}`, "username", "Username copied")}
              style={styles.usernameRow}
            >
              <Text style={[styles.heroSub, { color: colors.textMuted }]}>@{user?.username || "officer"}</Text>
              {copiedKey === "username" ? (
                <Text style={styles.copiedFeedback}>Copied</Text>
              ) : (
                <Ionicons name="copy-outline" size={12} color={colors.textMuted} />
              )}
            </Pressable>

            {/* Quick Hero Actions */}
            <View style={styles.heroQuickActions}>
              <Pressable
                onPress={openEditModal}
                style={[styles.heroQuickBtn, { borderColor: glassBorder, backgroundColor: cardSurfaceBg }]}
              >
                <Ionicons name="create-outline" size={13} color={colors.primary} />
                <Text style={[styles.heroQuickBtnText, { color: colors.text }]}>Edit Info</Text>
              </Pressable>

              <Pressable
                onPress={pickAndUpload}
                style={[styles.heroQuickBtn, { borderColor: glassBorder, backgroundColor: cardSurfaceBg }]}
              >
                <Ionicons name="image-outline" size={13} color={colors.primary} />
                <Text style={[styles.heroQuickBtnText, { color: colors.text }]}>Change Photo</Text>
              </Pressable>
            </View>

            {/* Metrics 3-Grid */}
            <View style={styles.heroMetricsGrid}>
              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>LAST LOGIN</Text>
                <Text style={[styles.metricItemValue, { color: colors.text }]} numberOfLines={1}>
                  {formatLastLogin(lastLogin)}
                </Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>LOCAL CACHE</Text>
                <Text style={[styles.metricItemValue, { color: colors.text }]} numberOfLines={1}>
                  {offlineStats.dbSize}
                </Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>PENDING SYNC</Text>
                <Text
                  style={[
                    styles.metricItemValue,
                    { color: isPendingSync ? "#F59E0B" : colors.text },
                  ]}
                  numberOfLines={1}
                >
                  {offlineStats.pendingSync}
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* ================= ACCOUNT IDENTITY ================= */}
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Account Identity</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Official officer credentials</Text>
              </View>
              <Pressable onPress={openEditModal} style={styles.editActionHeader}>
                <Ionicons name="pencil" size={13} color={colors.primary} />
                <Text style={[styles.editActionText, { color: colors.primary }]}>Edit</Text>
              </Pressable>
            </View>

            <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Pressable
                onPress={() => copyToClipboard(user?.full_name || user?.name || "", "fullname", "Legal name copied")}
                style={styles.cellRow}
              >
                <View style={[styles.cellIconWrap, { backgroundColor: `${colors.primary}15` }]}>
                  <Ionicons name="person" size={16} color={colors.primary} />
                </View>
                <View style={styles.cellContent}>
                  <Text style={[styles.cellLabel, { color: colors.textMuted }]}>Full Legal Name</Text>
                  <Text style={[styles.cellValue, { color: colors.text }]}>{user?.full_name || user?.name || "—"}</Text>
                </View>
                {copiedKey === "fullname" ? (
                  <Text style={styles.copiedFeedback}>Copied</Text>
                ) : (
                  <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                )}
              </Pressable>

              <View style={[styles.cellDivider, { backgroundColor: glassBorder }]} />

              <Pressable
                onPress={() => copyToClipboard(user?.email || "", "email", "Email copied")}
                style={styles.cellRow}
              >
                <View style={[styles.cellIconWrap, { backgroundColor: "rgba(59,130,246,0.12)" }]}>
                  <Ionicons name="mail" size={16} color="#3B82F6" />
                </View>
                <View style={styles.cellContent}>
                  <Text style={[styles.cellLabel, { color: colors.textMuted }]}>Email Address</Text>
                  <Text style={[styles.cellValue, { color: colors.text }]}>{user?.email || "—"}</Text>
                </View>
                {copiedKey === "email" ? (
                  <Text style={styles.copiedFeedback}>Copied</Text>
                ) : (
                  <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                )}
              </Pressable>

              <View style={[styles.cellDivider, { backgroundColor: glassBorder }]} />

              <Pressable
                onPress={() =>
                  copyToClipboard(user?.phone || user?.phone_number || "", "phone", "Phone number copied")
                }
                style={styles.cellRow}
              >
                <View style={[styles.cellIconWrap, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
                  <Ionicons name="call" size={16} color="#10B981" />
                </View>
                <View style={styles.cellContent}>
                  <Text style={[styles.cellLabel, { color: colors.textMuted }]}>Phone Number</Text>
                  <Text style={[styles.cellValue, { color: colors.text }]}>
                    {user?.phone || user?.phone_number || "—"}
                  </Text>
                </View>
                {copiedKey === "phone" ? (
                  <Text style={styles.copiedFeedback}>Copied</Text>
                ) : (
                  <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                )}
              </Pressable>

              <View style={[styles.cellDivider, { backgroundColor: glassBorder }]} />

              <Pressable
                onPress={() => copyToClipboard(user?.username || "", "uname2", "Username copied")}
                style={styles.cellRow}
              >
                <View style={[styles.cellIconWrap, { backgroundColor: "rgba(139,92,246,0.12)" }]}>
                  <Ionicons name="at" size={16} color="#8B5CF6" />
                </View>
                <View style={styles.cellContent}>
                  <Text style={[styles.cellLabel, { color: colors.textMuted }]}>Account Identifier</Text>
                  <Text style={[styles.cellValue, { color: colors.text }]}>@{user?.username || "—"}</Text>
                </View>
                {copiedKey === "uname2" ? (
                  <Text style={styles.copiedFeedback}>Copied</Text>
                ) : (
                  <Ionicons name="copy-outline" size={14} color={colors.textMuted} />
                )}
              </Pressable>
            </View>
          </View>

          {/* ================= OFFLINE WORKSPACE VAULT ================= */}
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Offline Database Vault</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Local cache & synchronization</Text>
              </View>

              <View style={styles.headerRightActions}>
                <View
                  style={[
                    styles.syncStateBadge,
                    { backgroundColor: isPendingSync ? "rgba(245, 158, 11, 0.12)" : "rgba(16, 185, 129, 0.12)" },
                  ]}
                >
                  <View
                    style={[
                      styles.statusPulseDot,
                      { backgroundColor: isPendingSync ? "#F59E0B" : "#10B981" },
                    ]}
                  />
                  <Text
                    style={[
                      styles.syncStateText,
                      { color: isPendingSync ? "#D97706" : "#10B981" },
                    ]}
                  >
                    {isPendingSync ? `${offlineStats.pendingSync} Pending` : "In Sync"}
                  </Text>
                </View>

                <Pressable
                  onPress={async () => {
                    if (syncingNow) return;
                    triggerHaptic("medium");
                    setSyncingNow(true);
                    startSyncRotate();
                    try {
                      await autoSyncIfOnline();
                      if (user?.username) {
                        await refreshFromApi(user.username);
                      }
                      await loadData();
                      showToast("Synchronized with central database");
                    } catch {
                      showToast("Sync completed (offline cached)");
                    } finally {
                      stopSyncRotate();
                      setSyncingNow(false);
                    }
                  }}
                  style={[
                    styles.headerSyncIconBtn,
                    { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}25` },
                  ]}
                >
                  <Animated.View style={{ transform: [{ rotate: syncSpin }] }}>
                    <Ionicons name="sync" size={15} color={colors.primary} />
                  </Animated.View>
                </Pressable>
              </View>
            </View>

            <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <View style={styles.metricsGrid}>
                {[
                  { k: "clients", label: "Clients", icon: "people" as const, color: "#3B82F6" },
                  { k: "loans", label: "Loans", icon: "card" as const, color: "#8B5CF6" },
                  { k: "savings", label: "Savings", icon: "wallet" as const, color: "#10B981" },
                  { k: "collections", label: "Records", icon: "receipt" as const, color: "#F59E0B" },
                ].map((m) => (
                  <View
                    key={m.k}
                    style={[
                      styles.metricTile,
                      { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241, 245, 249, 0.65)" },
                    ]}
                  >
                    <Ionicons name={m.icon} size={13} color={m.color} />
                    <Text style={[styles.metricNumber, { color: colors.text }]}>{offlineStats[m.k] ?? 0}</Text>
                    <Text style={[styles.metricTitle, { color: colors.textMuted }]}>{m.label}</Text>
                  </View>
                ))}
              </View>

              <View style={styles.backupDetailsWrap}>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Pending Queue</Text>
                  <Text
                    style={[
                      styles.detailVal,
                      { color: isPendingSync ? "#F59E0B" : colors.text },
                    ]}
                  >
                    {offlineStats.pendingSync} items
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Last Sync</Text>
                  <Text style={[styles.detailVal, { color: colors.text }]}>
                    {offlineStats.lastSync ? formatLastLogin(offlineStats.lastSync) : "Never"}
                  </Text>
                </View>
                <View style={styles.detailRow}>
                  <Text style={[styles.detailLabel, { color: colors.textMuted }]}>Total Local Footprint</Text>
                  <Text style={[styles.detailVal, { color: colors.text }]}>{offlineStats.dbSize}</Text>
                </View>
              </View>

              {/* STORAGE HYGIENE TILE (CLEAR CACHE) */}
              <View
                style={[
                  styles.storageCleanTile,
                  {
                    backgroundColor: isDark ? "rgba(15, 23, 42, 0.55)" : "rgba(248, 250, 252, 0.9)",
                    borderColor: isPendingSync ? "rgba(245, 158, 11, 0.35)" : glassBorder,
                  },
                ]}
              >
                <View style={styles.storageCleanHeader}>
                  <View style={styles.storageCleanIconWrap}>
                    <Ionicons name="file-tray-full-outline" size={17} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.storageCleanTitle, { color: colors.text }]}>Local Cache Management</Text>
                    <Text style={[styles.storageCleanSub, { color: colors.textMuted }]}>
                      Purge cached clients before switching officer accounts
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.storageCleanStatusBadge,
                      {
                        backgroundColor: isPendingSync ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.12)",
                      },
                    ]}
                  >
                    <Ionicons
                      name={isPendingSync ? "warning" : "checkmark-circle"}
                      size={11}
                      color={isPendingSync ? "#D97706" : "#10B981"}
                    />
                    <Text
                      style={[
                        styles.storageCleanStatusText,
                        { color: isPendingSync ? "#D97706" : "#10B981" },
                      ]}
                    >
                      {isPendingSync ? `${offlineStats.pendingSync} Unsynced` : "Safe to Clear"}
                    </Text>
                  </View>
                </View>

                <Pressable
                  onPress={() => {
                    triggerHaptic("medium");
                    setConfirmModal("clear_cache");
                  }}
                  disabled={clearingCache || syncingNow}
                  style={({ pressed }) => [
                    styles.storageActionBtn,
                    {
                      backgroundColor: isDark ? "rgba(239, 68, 68, 0.12)" : "rgba(254, 242, 242, 0.95)",
                      borderColor: "rgba(239, 68, 68, 0.35)",
                      opacity: pressed || clearingCache ? 0.75 : 1,
                    },
                  ]}
                >
                  {clearingCache ? (
                    <ActivityIndicator size="small" color="#EF4444" />
                  ) : (
                    <>
                      <Ionicons name="trash-outline" size={15} color="#EF4444" />
                      <Text style={styles.storageActionBtnText}>Clear Offline Tables</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </View>

          {/* ================= SECURITY & HARDWARE BIOMETRICS ================= */}
          <View style={styles.sectionWrap}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Security & Preferences</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                  Hardware biometric protection & appearance
                </Text>
              </View>
            </View>

            <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              {/* MODERN BIOMETRIC TILE */}
              <Pressable
                onPress={() => handleToggleBiometrics(!bioEnabled)}
                style={[
                  styles.bioTileContainer,
                  {
                    backgroundColor: bioEnabled
                      ? isDark
                        ? "rgba(37, 99, 235, 0.08)"
                        : "rgba(37, 99, 235, 0.04)"
                      : "transparent",
                    borderColor: bioEnabled ? `${colors.primary}40` : "transparent",
                  },
                ]}
              >
                <View style={styles.bioTileTopRow}>
                  <View
                    style={[
                      styles.bioIconBox,
                      {
                        backgroundColor: bioEnabled ? `${colors.primary}20` : isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)",
                        borderColor: bioEnabled ? `${colors.primary}45` : "transparent",
                      },
                    ]}
                  >
                    <Ionicons
                      name={bioTypeLabel.includes("Face") ? "scan" : "finger-print"}
                      size={20}
                      color={bioEnabled ? colors.primary : colors.textMuted}
                    />
                  </View>

                  <View style={styles.bioTextContent}>
                    <View style={styles.bioLabelRow}>
                      <Text style={[styles.bioMainTitle, { color: colors.text }]}>
                        {bioTypeLabel}
                      </Text>
                    </View>
                    <Text style={[styles.bioSubTitle, { color: colors.textMuted }]}>
                      Secure Enclave hardware-backed unlock
                    </Text>
                  </View>

                  <ModernBiometricToggle
                    value={bioEnabled}
                    onToggle={handleToggleBiometrics}
                    primaryColor={colors.primary}
                    isDark={isDark}
                  />
                </View>

                <View style={styles.bioProtectionFootnote}>
                  <Ionicons
                    name="shield-checkmark"
                    size={12}
                    color={bioEnabled ? "#10B981" : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.bioFootnoteText,
                      { color: bioEnabled ? (isDark ? "#A7F3D0" : "#047857") : colors.textMuted },
                    ]}
                  >
                    {bioEnabled
                      ? "Hardware sensor active • 1-tap PIN/biometric sign-in"
                      : "Disabled • Requires master password on every launch"}
                  </Text>
                </View>
              </Pressable>

              <View style={[styles.cellDivider, { backgroundColor: glassBorder, marginVertical: 8 }]} />

              <Pressable
                onPress={() => {
                  triggerHaptic("light");
                  toggleTheme();
                }}
                style={styles.cellRow}
              >
                <View style={[styles.cellIconWrap, { backgroundColor: "rgba(251,191,36,0.12)" }]}>
                  <Ionicons name={isDark ? "moon" : "sunny"} size={16} color={isDark ? "#818CF8" : "#F59E0B"} />
                </View>
                <View style={styles.cellContent}>
                  <Text style={[styles.cellValue, { color: colors.text }]}>Appearance Mode</Text>
                  <Text style={[styles.cellLabel, { color: colors.textMuted }]}>
                    {isDark ? "Dark Theme Active" : "Light Theme Active"}
                  </Text>
                </View>
                <Ionicons name="swap-horizontal" size={17} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>

          {/* ================= ACCESS AUDIT TRAIL ================= */}
          {loginHistory.length > 0 && (
            <View style={styles.sectionWrap}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Device Access History</Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Recent authentications on this hardware</Text>
                </View>
              </View>

              <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                {loginHistory.map((item, idx) => (
                  <View key={idx}>
                    <View style={styles.cellRow}>
                      <View style={[styles.cellIconWrap, { backgroundColor: `${getHistoryColor(item.login_method)}15` }]}>
                        <Ionicons
                          name={getHistoryIcon(item.login_method)}
                          size={15}
                          color={getHistoryColor(item.login_method)}
                        />
                      </View>
                      <View style={styles.cellContent}>
                        <Text style={[styles.cellValue, { color: colors.text, fontSize: 13 }]}>
                          {formatMethodTitle(item.login_method)}
                        </Text>
                        <Text style={[styles.cellLabel, { color: colors.textMuted }]}>
                          {new Date(item.login_time).toLocaleString("en-NG", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </Text>
                      </View>
                      <Text style={[styles.historyAgoText, { color: colors.textMuted }]}>
                        {formatLastLogin(item.login_time)}
                      </Text>
                    </View>
                    {idx < loginHistory.length - 1 && (
                      <View style={[styles.cellDivider, { backgroundColor: glassBorder }]} />
                    )}
                  </View>
                ))}
              </View>
            </View>
          )}

          {/* ================= SESSION & DEVICE MANAGEMENT ================= */}
          <View style={[styles.sectionWrap, { marginBottom: 34 }]}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Session & Device Management</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Log out or decouple officer credentials</Text>
              </View>
            </View>

            <View style={[styles.cardGroup, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, gap: 10 }]}>
              {/* PRIMARY LOGOUT ACTION */}
              <Pressable
                onPress={() => {
                  triggerHaptic("medium");
                  setConfirmModal("logout");
                }}
                style={({ pressed }) => [
                  styles.sessionActionRow,
                  {
                    backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(241, 245, 249, 0.7)",
                    borderColor: glassBorder,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <View style={[styles.sessionActionIconWrap, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}>
                  <Ionicons name="log-out" size={18} color="#EF4444" />
                </View>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={[styles.sessionActionTitle, { color: colors.text }]}>Sign Out</Text>
                  <Text style={[styles.sessionActionSub, { color: colors.textMuted }]}>
                    Keeps biometric credentials active for fast return
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
              </Pressable>

              <View style={[styles.cellDivider, { backgroundColor: glassBorder }]} />

              {/* HARD DEVICE DE-AUTHORIZE / WIPE */}
              <Pressable
                onPress={() => {
                  triggerHaptic("heavy");
                  setConfirmModal("wipe");
                }}
                style={({ pressed }) => [
                  styles.wipeActionBox,
                  {
                    backgroundColor: isDark ? "rgba(239, 68, 68, 0.08)" : "rgba(254, 242, 242, 0.75)",
                    borderColor: "rgba(239, 68, 68, 0.25)",
                    opacity: pressed ? 0.75 : 1,
                  },
                ]}
              >
                <View style={styles.wipeTopRow}>
                  <View style={styles.wipeBadgeIcon}>
                    <Ionicons name="shield-half-outline" size={15} color="#EF4444" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.wipeTitle}>De-authorize & Wipe Device</Text>
                    <Text style={[styles.wipeSub, { color: colors.textMuted }]}>
                      Revokes saved tokens, drops biometrics, and clears local SQLite DB
                    </Text>
                  </View>
                </View>
              </Pressable>
            </View>

            <Text style={[styles.footerMeta, { color: colors.textMuted }]}>
              CUPAD Officer Workspace • v2.4.0
            </Text>
          </View>
        </Animated.ScrollView>
      )}

      {/* ================= MODAL: UNIFIED CONFIRMATION SHEET ================= */}
      <Modal visible={!!confirmModal} transparent animationType="fade" onRequestClose={() => setConfirmModal(null)}>
        <View style={styles.confirmBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setConfirmModal(null)} />
          <View style={[styles.confirmCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
            {confirmModal === "clear_cache" && (
              <>
                <View style={[styles.confirmIconBubble, { backgroundColor: "rgba(245, 158, 11, 0.15)" }]}>
                  <Ionicons name="file-tray-full" size={28} color="#F59E0B" />
                </View>
                <Text style={[styles.confirmTitle, { color: colors.text }]}>Purge Offline Cache?</Text>
                <Text style={[styles.confirmMessage, { color: colors.textMuted }]}>
                  This clears downloaded clients, loan records, and offline queues on this device.
                </Text>

                {isPendingSync && (
                  <View style={styles.confirmWarningBox}>
                    <Ionicons name="warning-outline" size={16} color="#D97706" />
                    <Text style={styles.confirmWarningText}>
                      Attention: {offlineStats.pendingSync} pending offline item(s) will be permanently discarded!
                    </Text>
                  </View>
                )}

                <View style={styles.confirmBtnRow}>
                  <Pressable
                    onPress={() => setConfirmModal(null)}
                    style={[styles.confirmBtnOutline, { borderColor: glassBorder }]}
                  >
                    <Text style={[styles.confirmBtnOutlineText, { color: colors.text }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={executeClearOfflineCache}
                    style={[styles.confirmBtnSolid, { backgroundColor: "#EF4444" }]}
                  >
                    <Text style={styles.confirmBtnSolidText}>Yes, Clear Cache</Text>
                  </Pressable>
                </View>
              </>
            )}

            {confirmModal === "logout" && (
              <>
                <View style={[styles.confirmIconBubble, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}>
                  <Ionicons name="log-out" size={28} color="#EF4444" />
                </View>
                <Text style={[styles.confirmTitle, { color: colors.text }]}>Sign Out of CUPAD?</Text>
                <Text style={[styles.confirmMessage, { color: colors.textMuted }]}>
                  Your active session will end. Your fast biometric unlock will remain saved for 1-tap quick re-entry.
                </Text>

                <View style={styles.confirmBtnRow}>
                  <Pressable
                    onPress={() => setConfirmModal(null)}
                    style={[styles.confirmBtnOutline, { borderColor: glassBorder }]}
                  >
                    <Text style={[styles.confirmBtnOutlineText, { color: colors.text }]}>Keep Active</Text>
                  </Pressable>
                  <Pressable
                    onPress={executeLogout}
                    style={[styles.confirmBtnSolid, { backgroundColor: colors.primary }]}
                  >
                    <Text style={styles.confirmBtnSolidText}>Sign Out</Text>
                  </Pressable>
                </View>
              </>
            )}

            {confirmModal === "wipe" && (
              <>
                <View style={[styles.confirmIconBubble, { backgroundColor: "rgba(239, 68, 68, 0.18)" }]}>
                  <Ionicons name="shield-outline" size={28} color="#EF4444" />
                </View>
                <Text style={[styles.confirmTitle, { color: colors.text }]}>De-authorize Hardware?</Text>
                <Text style={[styles.confirmMessage, { color: colors.textMuted }]}>
                  This wipes biometric access, authentication tokens, and drops local offline tables. Next login will require full master password credentials.
                </Text>

                <View style={styles.confirmBtnRow}>
                  <Pressable
                    onPress={() => setConfirmModal(null)}
                    style={[styles.confirmBtnOutline, { borderColor: glassBorder }]}
                  >
                    <Text style={[styles.confirmBtnOutlineText, { color: colors.text }]}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={executeFullWipe}
                    style={[styles.confirmBtnSolid, { backgroundColor: "#EF4444" }]}
                  >
                    <Text style={styles.confirmBtnSolidText}>Wipe Everything</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ================= AVATAR LIGHTBOX PREVIEW MODAL ================= */}
      <Modal visible={previewModal} transparent animationType="fade" onRequestClose={() => setPreviewModal(false)}>
        <View style={styles.lightboxBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setPreviewModal(false)} />
          <View style={[styles.lightboxCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
            <View style={styles.lightboxHeader}>
              <Text style={[styles.lightboxTitle, { color: colors.text }]}>Profile Photo</Text>
              <Pressable
                onPress={() => setPreviewModal(false)}
                style={[styles.modalCloseBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.lightboxImgWrap}>
              {activeAvatarUri ? (
                <Image source={{ uri: activeAvatarUri }} style={styles.lightboxImg} resizeMode="cover" />
              ) : null}
            </View>

            <View style={styles.lightboxActions}>
              <Pressable
                onPress={() => {
                  setPreviewModal(false);
                  pickAndUpload();
                }}
                style={[styles.lightboxActionBtn, { backgroundColor: colors.primary }]}
              >
                <Ionicons name="camera" size={16} color="#fff" />
                <Text style={styles.lightboxActionBtnText}>Upload New Picture</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* ================= EDIT PROFILE MODAL ================= */}
      <Modal visible={editModal} transparent animationType="slide" onRequestClose={() => setEditModal(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <Pressable style={styles.modalDismissArea} onPress={() => setEditModal(false)} />
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: glassBorder }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Profile Details</Text>
                <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>
                  Update contact & official credentials
                </Text>
              </View>
              <Pressable
                onPress={() => setEditModal(false)}
                style={[styles.modalCloseBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)" }]}
              >
                <Ionicons name="close" size={18} color={colors.text} />
              </Pressable>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Full Legal Name</Text>
              <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                <Ionicons name="person-outline" size={15} color={colors.textMuted} />
                <TextInput
                  value={editFullName}
                  onChangeText={setEditFullName}
                  placeholder="Officer Legal Name"
                  placeholderTextColor={colors.textMuted}
                  style={[styles.inputField, { color: colors.text }]}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Email Address</Text>
              <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                <Ionicons name="mail-outline" size={15} color={colors.textMuted} />
                <TextInput
                  value={editEmail}
                  onChangeText={setEditEmail}
                  placeholder="officer@cupad.org"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  style={[styles.inputField, { color: colors.text }]}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={[styles.inputLabel, { color: colors.textMuted }]}>Phone Number</Text>
              <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                <Ionicons name="call-outline" size={15} color={colors.textMuted} />
                <TextInput
                  value={editPhone}
                  onChangeText={setEditPhone}
                  placeholder="080XXXXXXXX"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="phone-pad"
                  style={[styles.inputField, { color: colors.text }]}
                />
              </View>
            </View>

            <Pressable
              onPress={saveProfile}
              disabled={savingProfile}
              style={[styles.saveModalBtn, { backgroundColor: colors.primary, opacity: savingProfile ? 0.7 : 1 }]}
            >
              {savingProfile ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.saveModalBtnText}>Save Changes</Text>
              )}
            </Pressable>

            <Text style={[styles.offlineNotice, { color: colors.textMuted }]}>
              Changes save instantly offline and automatically queue for central sync
            </Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 60, paddingTop: 6 },

  /* HERO PROFILE CARD */
  heroCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 3,
    alignItems: "center",
    marginBottom: 8,
  },
  heroTopBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 14,
  },
  heroTagPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4.5,
    borderRadius: 20,
    gap: 5.5,
  },
  statusPulseDot: { width: 6.5, height: 6.5, borderRadius: 3.25 },
  heroTagText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  syncTimePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4.5,
    paddingHorizontal: 8.5,
    paddingVertical: 4,
    borderRadius: 12,
    maxWidth: "48%",
  },
  syncTimeText: { fontSize: 10, fontWeight: "600" },

  avatarSection: { position: "relative", marginBottom: 10 },
  avatarRing: { padding: 3.5, borderWidth: 2, borderRadius: 54, position: "relative" },
  avatarImgWrap: { width: 92, height: 92, borderRadius: 46, overflow: "hidden", position: "relative" },
  avatarImg: { width: "100%", height: "100%" },
  avatarLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarPlaceholder: { width: 92, height: 92, borderRadius: 46, alignItems: "center", justifyContent: "center" },
  avatarLetters: { color: "#fff", fontSize: 30, fontWeight: "900" },
  cameraFab: {
    position: "absolute",
    bottom: -2,
    right: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 3,
  },
  ribbonWrap: {
    position: "absolute",
    top: -4,
    right: -4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  ribbonChipText: { fontSize: 9.5, fontWeight: "900", color: "#fff" },

  heroName: { fontSize: 19.5, fontWeight: "900", letterSpacing: -0.3, textAlign: "center" },
  usernameRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 },
  heroSub: { fontSize: 13, fontWeight: "600" },
  copiedFeedback: { fontSize: 11, fontWeight: "700", color: "#10B981" },

  heroQuickActions: { flexDirection: "row", gap: 10, marginTop: 12 },
  heroQuickBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 18,
    borderWidth: 1,
  },
  heroQuickBtnText: { fontSize: 11.5, fontWeight: "700" },

  heroMetricsGrid: { flexDirection: "row", gap: 8, paddingTop: 14, width: "100%" },
  metricGridItem: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  metricItemLabel: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5 },
  metricItemValue: { fontSize: 12.5, fontWeight: "800", marginTop: 2 },

  /* SECTION HEADERS */
  sectionWrap: { marginHorizontal: 16, marginTop: 18 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  headerRightActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerSyncIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  editActionHeader: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 4 },
  editActionText: { fontSize: 12.5, fontWeight: "700" },
  syncStateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  syncStateText: { fontSize: 10.5, fontWeight: "800" },

  /* CARD GROUP */
  cardGroup: { borderRadius: 20, borderWidth: 1, padding: 14, overflow: "hidden" },
  cellRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 },
  cellIconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  cellContent: { flex: 1, gap: 1 },
  cellLabel: { fontSize: 10.5, fontWeight: "500" },
  cellValue: { fontSize: 13.5, fontWeight: "700" },
  cellDivider: { height: 1, marginVertical: 4 },

  /* MODERN BIOMETRIC TILE */
  bioTileContainer: { borderRadius: 16, borderWidth: 1, padding: 10, marginVertical: 2 },
  bioTileTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  bioIconBox: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  bioTextContent: { flex: 1, gap: 2 },
  bioLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  bioMainTitle: { fontSize: 14, fontWeight: "800", letterSpacing: -0.2 },
  bioSubTitle: { fontSize: 11, fontWeight: "500" },

  bioToggleWrapper: { flexDirection: "row", alignItems: "center", gap: 7 },
  bioBadgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6.5,
    paddingVertical: 3.5,
    borderRadius: 8,
  },
  bioBadgeDot: { width: 5, height: 5, borderRadius: 2.5 },
  bioBadgeText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },

  bioSwitchTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    borderWidth: 1,
    justifyContent: "center",
  },
  bioSwitchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 2.5,
    elevation: 3,
  },
  bioProtectionFootnote: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 8,
    paddingTop: 7,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(148, 163, 184, 0.2)",
    paddingHorizontal: 2,
  },
  bioFootnoteText: { fontSize: 10.5, fontWeight: "600", letterSpacing: -0.1 },

  /* OFFLINE SECTION */
  metricsGrid: { flexDirection: "row", gap: 6, marginVertical: 6 },
  metricTile: { flex: 1, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12, alignItems: "center", gap: 2 },
  metricNumber: { fontSize: 14.5, fontWeight: "800", marginTop: 2 },
  metricTitle: { fontSize: 9, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.3 },

  backupDetailsWrap: { marginTop: 10, marginBottom: 12, gap: 4 },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 3 },
  detailLabel: { fontSize: 11.5, fontWeight: "500" },
  detailVal: { fontSize: 12, fontWeight: "700" },

  /* STORAGE CLEAN TILE */
  storageCleanTile: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginTop: 6,
    gap: 10,
  },
  storageCleanHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  storageCleanIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(37, 99, 235, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  storageCleanTitle: { fontSize: 13, fontWeight: "800" },
  storageCleanSub: { fontSize: 10.5, fontWeight: "500", marginTop: 1 },
  storageCleanStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 8,
  },
  storageCleanStatusText: { fontSize: 9.5, fontWeight: "800" },
  storageActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 11,
    borderWidth: 1,
    paddingVertical: 9,
  },
  storageActionBtnText: { color: "#EF4444", fontSize: 12, fontWeight: "800" },

  historyAgoText: { fontSize: 11, fontWeight: "600" },

  /* SESSION & LOGOUT CARDS */
  sessionActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  sessionActionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sessionActionTitle: { fontSize: 13.5, fontWeight: "800" },
  sessionActionSub: { fontSize: 10.5, fontWeight: "500" },

  wipeActionBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginTop: 2,
  },
  wipeTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  wipeBadgeIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  wipeTitle: { color: "#EF4444", fontSize: 13, fontWeight: "800" },
  wipeSub: { fontSize: 10.5, fontWeight: "500", marginTop: 2, lineHeight: 14 },

  footerMeta: { textAlign: "center", fontSize: 10.5, marginTop: 14, letterSpacing: 0.3 },

  /* CONFIRMATION BOTTOM SHEET / MODAL */
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.72)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 22,
    borderWidth: 1,
    padding: 20,
    alignItems: "center",
  },
  confirmIconBubble: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  confirmTitle: { fontSize: 17, fontWeight: "900", textAlign: "center" },
  confirmMessage: {
    fontSize: 12.5,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  confirmWarningBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(245, 158, 11, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(245, 158, 11, 0.35)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginTop: 12,
  },
  confirmWarningText: { flex: 1, color: "#D97706", fontSize: 11, fontWeight: "700" },
  confirmBtnRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 20,
    width: "100%",
  },
  confirmBtnOutline: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnOutlineText: { fontSize: 13, fontWeight: "700" },
  confirmBtnSolid: {
    flex: 1.2,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnSolidText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },

  /* LIGHTBOX MODAL */
  lightboxBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.78)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  lightboxCard: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 24,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
  },
  lightboxHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    marginBottom: 14,
  },
  lightboxTitle: { fontSize: 16, fontWeight: "800" },
  lightboxImgWrap: {
    width: 260,
    height: 260,
    borderRadius: 20,
    overflow: "hidden",
    backgroundColor: "#000",
  },
  lightboxImg: { width: "100%", height: "100%" },
  lightboxActions: { width: "100%", marginTop: 14 },
  lightboxActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
  },
  lightboxActionBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  /* EDIT MODAL */
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalDismissArea: { flex: 1 },
  modalSheet: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    padding: 20,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  modalSubtitle: { fontSize: 11.5, marginTop: 2 },
  modalCloseBtn: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 10, fontWeight: "800", marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  inputBox: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    gap: 8,
  },
  inputField: { flex: 1, fontSize: 13.5, fontWeight: "600", height: "100%" },
  saveModalBtn: { borderRadius: 14, paddingVertical: 13, alignItems: "center", marginTop: 6 },
  saveModalBtnText: { color: "#fff", fontSize: 13.5, fontWeight: "800" },
  offlineNotice: { fontSize: 11, textAlign: "center", marginTop: 12 },

  /* TOAST */
  toastBox: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 36,
    alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 9999,
  },
  toastText: { fontSize: 12, fontWeight: "700" },
});