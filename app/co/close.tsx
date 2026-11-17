import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Dimensions,
  Animated,
  Easing,
  Linking,
  PanResponder,
  Clipboard,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cacheClients,
  loadCachedClients,
  isOnline,
  enqueueSync,
} from "../../src/db/database";
import { fetchUnionsForOfficer, mergeUnionNames } from "../../src/db/offlineHelpers";
import { hydrateOfflineCache } from "../../src/db/sync";
import axios from "axios";
import { router } from "expo-router";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_CLOSE = `${API_BASE}/api/close_client_api.php`;
const CACHE_KEY = "cupad_cache_close_clients_v3";

const SLIDER_CONTAINER_WIDTH = width - 48;
const SLIDER_HANDLE_SIZE = 52;
const SLIDER_MAX_TRANSLATE = SLIDER_CONTAINER_WIDTH - SLIDER_HANDLE_SIZE - 6;

type Client = {
  id: string;
  name: string;
  union: string;
  phone: string;
  total_savings: number;
  total_loan: number;
  can_close: boolean;
};

type AuditReceipt = {
  clientName: string;
  union: string;
  reference: string;
  reason: string;
  timestamp: string;
};

const REASONS = [
  "Voluntary Exit",
  "Relocated / Moved",
  "Loan Cycle Completed",
  "Business Inactive",
  "Non-compliance",
];

function formatNaira(amount: number): string {
  return `₦${Number(amount || 0).toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

/* ================= BACKGROUND AMBIENT PARTICLES ================= */
function AmbientOrb({
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
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: -16,
            duration: 3800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 3800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(translateY, {
            toValue: 0,
            duration: 3800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 3800,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
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
        opacity: 0.55,
        transform: [{ translateY }, { scale }],
      }}
    />
  );
}

function SkeletonLoader({ style }: { style?: any }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.75, duration: 800, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        {
          backgroundColor: "rgba(148, 163, 184, 0.22)",
          opacity,
          borderRadius: 14,
        },
        style,
      ]}
    />
  );
}

export default function PremiumCloseClientScreen() {
  const { colors, isDark } = useTheme();

  // Color Tokens
  const cardBg = isDark ? "rgba(30, 41, 59, 0.7)" : "rgba(255, 255, 255, 0.92)";
  const cardBgMuted = isDark ? "rgba(15, 23, 42, 0.6)" : "rgba(248, 250, 252, 0.85)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const primaryRose = "#E11D48";
  const primaryEmerald = "#10B981";
  const primaryAmber = "#F59E0B";

  const orbColor1 = isDark ? "rgba(225, 29, 72, 0.12)" : "rgba(225, 29, 72, 0.08)";
  const orbColor2 = isDark ? "rgba(37, 99, 235, 0.14)" : "rgba(37, 99, 235, 0.08)";

  // Primary State
  const [username, setUsername] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [unions, setUnions] = useState<string[]>([]);
  const [selectedUnion, setSelectedUnion] = useState("All");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "READY" | "BLOCKED">("ALL");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Review & Sheet State
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [clientDetails, setClientDetails] = useState<any>(null);
  const [selectedReason, setSelectedReason] = useState(REASONS[0]);
  const [closureNotes, setClosureNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<AuditReceipt | null>(null);

  // Floating Toast
  const [toast, setToast] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const toastAnim = useRef(new Animated.Value(-100)).current;

  // Slide Animation
  const slideAnim = useRef(new Animated.Value(0)).current;
  const slideComplete = useRef(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const showToast = useCallback((text: string, type: "success" | "error") => {
    setToast({ text, type });
    Animated.sequence([
      Animated.spring(toastAnim, { toValue: 24, useNativeDriver: true }),
      Animated.delay(2600),
      Animated.timing(toastAnim, { toValue: -100, duration: 240, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [toastAnim]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 350,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Initial Data Load
  const initData = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("cupad_user");
      let u = "";
      if (stored) {
        const parsed = JSON.parse(stored);
        u = parsed.username;
        setUsername(u);
      }

      const cached = await AsyncStorage.getItem(CACHE_KEY);
      if (cached) {
        const p = JSON.parse(cached);
        setClients(p.clients || []);
        setUnions(p.unions || []);
      }

      if (u) {
        await fetchClients(u, false);
      }
    } catch {
      // Offline fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initData();
  }, [initData]);

  const fetchClients = async (u: string, showIndicator = true) => {
    if (showIndicator) setLoading(true);
    try {
      const res = await axios.get(
        `${API_CLOSE}?action=list_clients&username=${encodeURIComponent(u)}`,
        { timeout: 9000 }
      );
      if (res.data?.success) {
        const list = res.data.clients || [];
        setClients(list);
        const fromInit = Array.isArray(res.data.unions)
          ? res.data.unions.map((uu: any) => (typeof uu === "string" ? uu : uu?.name)).filter(Boolean)
          : [];
        const fromClients = Array.from(new Set(list.map((c: any) => c.union).filter(Boolean))) as string[];
        let fromApi: string[] = [];
        try {
          const uf = await fetchUnionsForOfficer(u || undefined);
          try { hydrateOfflineCache(u || ""); } catch {}
          fromApi = uf.names || [];
        } catch {}
        const merged = mergeUnionNames(fromApi, fromInit, fromClients);
        setUnions(merged);
        await AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ clients: list, unions: merged })
        );
      }
    } catch {
      showToast("Offline mode: Loaded local cache", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    if (username) fetchClients(username, false);
    else setRefreshing(false);
  }, [username]);

  const handleOpenClientSheet = async (c: Client) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedClient(c);
    setClientDetails(c);
    setLoadingDetails(true);
    setSelectedReason(REASONS[0]);
    setClosureNotes("");
    slideAnim.setValue(0);
    slideComplete.current = false;

    try {
      const res = await axios.get(
        `${API_CLOSE}?action=get_client_details&username=${encodeURIComponent(
          username
        )}&client_id=${encodeURIComponent(c.id)}`,
        { timeout: 9000 }
      );
      if (res.data?.success) {
        setClientDetails(res.data.client);
      }
    } catch {
      // Local fallback
    } finally {
      setLoadingDetails(false);
    }
  };

  const executeClosure = useCallback(async () => {
    if (!selectedClient) return;
    setSubmitting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

    try {
      const res = await axios.post(
        API_CLOSE,
        {
          action: "close_client",
          username,
          client_id: selectedClient.id,
          reason: selectedReason,
          notes: closureNotes,
        },
        { timeout: 12000 }
      );

      if (res.data?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setClients((prev) => {
          const updated = prev.filter((i) => i.id !== selectedClient.id);
          AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ clients: updated, unions }));
          return updated;
        });

        setReceipt({
          clientName: selectedClient.name,
          union: selectedClient.union,
          reference: res.data.reference || "CLS-" + Math.floor(100000 + Math.random() * 900000),
          reason: selectedReason,
          timestamp: res.data.timestamp || new Date().toLocaleString("en-NG"),
        });
        setSelectedClient(null);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast(res.data?.error || "Closure rejected by server", "error");
        slideAnim.setValue(0);
        slideComplete.current = false;
      }
    } catch {
      showToast("Network failure executing deactivation", "error");
      slideAnim.setValue(0);
      slideComplete.current = false;
    } finally {
      setSubmitting(false);
    }
  }, [selectedClient, username, selectedReason, closureNotes, unions, slideAnim, showToast]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !submitting,
        onMoveShouldSetPanResponder: (_, { dx, dy }) =>
          !submitting && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4,
        onMoveShouldSetPanResponderCapture: (_, { dx, dy }) =>
          !submitting && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gestureState) => {
          if (slideComplete.current || submitting) return;
          const newX = Math.max(0, Math.min(gestureState.dx, SLIDER_MAX_TRANSLATE));
          slideAnim.setValue(newX);

          if (newX > SLIDER_MAX_TRANSLATE * 0.9) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          } else if (newX > SLIDER_MAX_TRANSLATE * 0.48 && newX < SLIDER_MAX_TRANSLATE * 0.52) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          }
        },
        onPanResponderRelease: (_, gestureState) => {
          if (slideComplete.current || submitting) return;
          if (gestureState.dx >= SLIDER_MAX_TRANSLATE * 0.85) {
            slideComplete.current = true;
            Animated.timing(slideAnim, {
              toValue: SLIDER_MAX_TRANSLATE,
              duration: 120,
              useNativeDriver: false,
            }).start(() => executeClosure());
          } else {
            Animated.spring(slideAnim, {
              toValue: 0,
              useNativeDriver: false,
              friction: 7,
            }).start();
          }
        },
        onPanResponderTerminate: () => {
          slideAnim.setValue(0);
          slideComplete.current = false;
        },
      }),
    [submitting, slideAnim, executeClosure]
  );

  const jumpToResolution = (target: "withdrawal" | "repayment") => {
    if (!selectedClient) return;
    const cid = selectedClient.id;
    setSelectedClient(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (target === "withdrawal") {
      router.push(`/co/withdrawal?clientId=${cid}` as any);
    } else {
      router.push(`/co/repayment?clientId=${cid}` as any);
    }
  };

  const unionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c) => {
      const u = c.union?.trim() || "General";
      counts[u] = (counts[u] || 0) + 1;
    });
    return counts;
  }, [clients]);

  const { filteredClients, readyCount, blockedCount } = useMemo(() => {
    const q = search.trim().toLowerCase();
    let ready = 0;
    let blocked = 0;

    clients.forEach((c) => {
      if (c.can_close) ready++;
      else blocked++;
    });

    const filtered = clients.filter((c) => {
      const matchUnion =
        selectedUnion === "All" || (c.union || "").toLowerCase() === selectedUnion.toLowerCase();
      const matchSearch =
        !q ||
        c.name.toLowerCase().includes(q) ||
        (c.union && c.union.toLowerCase().includes(q)) ||
        (c.phone && c.phone.includes(q));
      const matchStatus =
        statusFilter === "ALL" ||
        (statusFilter === "READY" && c.can_close) ||
        (statusFilter === "BLOCKED" && !c.can_close);

      return matchUnion && matchSearch && matchStatus;
    });

    return { filteredClients: filtered, readyCount: ready, blockedCount: blocked };
  }, [clients, search, selectedUnion, statusFilter]);

  return (
    <CoScreenWrapper>
      {/* Dynamic Background Atmosphere */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <AmbientOrb size={300} color={orbColor1} left={-80} top={-60} delay={0} />
        <AmbientOrb size={260} color={orbColor2} left={width - 150} top={120} delay={1200} />
        <AmbientOrb size={320} color={orbColor1} left={width * 0.2} top={height * 0.55} delay={2400} />
      </View>

      {/* Floating Animated Toast */}
      {toast && (
        <Animated.View
          style={[
            styles.toastContainer,
            {
              transform: [{ translateY: toastAnim }],
              backgroundColor: toast.type === "success" ? "#065F46" : "#991B1B",
            },
          ]}
        >
          <View style={styles.toastIconBox}>
            <Ionicons
              name={toast.type === "success" ? "checkmark-circle" : "alert-circle"}
              size={18}
              color="#FFF"
            />
          </View>
          <Text style={styles.toastMessage}>{toast.text}</Text>
        </Animated.View>
      )}

      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={primaryRose}
              colors={[primaryRose]}
            />
          }
        >
          {/* ================= HERO CARD ================= */}
          <LinearGradient
            colors={
              isDark
                ? ["rgba(30, 41, 59, 0.94)", "rgba(15, 23, 42, 0.98)"]
                : ["#FFFFFF", "rgba(248, 250, 252, 0.96)"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroCard, { borderColor: glassBorder }]}
          >
            {/* Upper Badge Row */}
            <View style={styles.heroTopRow}>
              <View style={[styles.heroBadge, { backgroundColor: isDark ? "rgba(225, 29, 72, 0.16)" : "#FFE4E6" }]}>
                <View style={[styles.pulseDot, { backgroundColor: primaryRose }]} />
                <Text style={[styles.heroBadgeText, { color: primaryRose }]}>DEACTIVATION PORTAL</Text>
              </View>

              <View style={[styles.complianceBadge, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                <Ionicons name="shield-checkmark" size={13} color={primaryEmerald} />
                <Text style={[styles.complianceText, { color: colors.textMuted }]}>AUDIT READY</Text>
              </View>
            </View>

            {/* Core Metrics Title */}
            <View style={styles.heroMain}>
              <Text style={[styles.heroSubHeader, { color: colors.textMuted }]}>CLIENT PORTFOLIO OFF-BOARDING</Text>
              <View style={styles.heroCountRow}>
                <Text style={[styles.heroCountNumber, { color: colors.text }]}>{filteredClients.length}</Text>
                <Text style={[styles.heroCountLabel, { color: colors.textMuted }]}>
                  {filteredClients.length === 1 ? "member in queue" : "members in queue"}
                </Text>
              </View>
              <Text style={[styles.heroDescription, { color: colors.textMuted }]}>
                Verify zero outstanding liability before issuing permanent account closure tokens.
              </Text>
            </View>

            {/* 4-Box Telemetry Matrix */}
            <View style={styles.matrixContainer}>
              <View style={[styles.matrixCard, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.03)" : "#F8FAFC" }]}>
                <View style={styles.matrixCardHeader}>
                  <View style={[styles.miniIndicator, { backgroundColor: primaryEmerald }]} />
                  <Text style={[styles.matrixCardTitle, { color: colors.textMuted }]}>Cleared</Text>
                </View>
                <Text style={[styles.matrixCardValue, { color: primaryEmerald }]}>{readyCount}</Text>
                <Text style={[styles.matrixCardFooter, { color: colors.textMuted }]}>Ready to exit</Text>
              </View>

              <View style={[styles.matrixCard, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.03)" : "#F8FAFC" }]}>
                <View style={styles.matrixCardHeader}>
                  <View style={[styles.miniIndicator, { backgroundColor: primaryRose }]} />
                  <Text style={[styles.matrixCardTitle, { color: colors.textMuted }]}>Blocked</Text>
                </View>
                <Text style={[styles.matrixCardValue, { color: primaryRose }]}>{blockedCount}</Text>
                <Text style={[styles.matrixCardFooter, { color: colors.textMuted }]}>Unsettled bal</Text>
              </View>

              <View style={[styles.matrixCard, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.03)" : "#F8FAFC" }]}>
                <View style={styles.matrixCardHeader}>
                  <Ionicons name="people" size={11} color="#60A5FA" />
                  <Text style={[styles.matrixCardTitle, { color: colors.textMuted }]}>Total Active</Text>
                </View>
                <Text style={[styles.matrixCardValue, { color: colors.text }]}>{clients.length}</Text>
                <Text style={[styles.matrixCardFooter, { color: colors.textMuted }]}>Managed</Text>
              </View>

              <View style={[styles.matrixCard, { backgroundColor: isDark ? "rgba(225, 29, 72, 0.08)" : "#FFF1F2" }]}>
                <View style={styles.matrixCardHeader}>
                  <Ionicons name="funnel" size={11} color={primaryRose} />
                  <Text style={[styles.matrixCardTitle, { color: primaryRose }]}>Filtered</Text>
                </View>
                <Text style={[styles.matrixCardValue, { color: primaryRose }]}>{filteredClients.length}</Text>
                <Text style={[styles.matrixCardFooter, { color: colors.textMuted }]} numberOfLines={1}>
                  {selectedUnion}
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* ================= SEARCH & INTERACTIVE CONTROLS ================= */}
          <View style={styles.controlsSection}>
            <View style={[styles.searchPill, { backgroundColor: cardBg, borderColor: glassBorder }]}>
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                placeholder="Search member name, phone or union..."
                placeholderTextColor={colors.textMuted}
                value={search}
                onChangeText={setSearch}
                style={[styles.searchInput, { color: colors.text }]}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch("")} hitSlop={10}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              )}
            </View>

            {/* Status Segmented Tabs */}
            <View style={[styles.segmentedTrack, { backgroundColor: isDark ? "rgba(15, 23, 42, 0.6)" : "#F1F5F9" }]}>
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setStatusFilter("ALL");
                }}
                style={[
                  styles.segmentButton,
                  statusFilter === "ALL" && [styles.segmentButtonActive, { backgroundColor: cardBg }],
                ]}
              >
                <Text
                  style={[
                    styles.segmentButtonText,
                    { color: statusFilter === "ALL" ? colors.text : colors.textMuted },
                  ]}
                >
                  All ({clients.length})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setStatusFilter("READY");
                }}
                style={[
                  styles.segmentButton,
                  statusFilter === "READY" && [styles.segmentButtonActive, { backgroundColor: cardBg }],
                ]}
              >
                <View style={[styles.tabDot, { backgroundColor: primaryEmerald }]} />
                <Text
                  style={[
                    styles.segmentButtonText,
                    { color: statusFilter === "READY" ? primaryEmerald : colors.textMuted },
                  ]}
                >
                  Eligible ({readyCount})
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setStatusFilter("BLOCKED");
                }}
                style={[
                  styles.segmentButton,
                  statusFilter === "BLOCKED" && [styles.segmentButtonActive, { backgroundColor: cardBg }],
                ]}
              >
                <View style={[styles.tabDot, { backgroundColor: primaryRose }]} />
                <Text
                  style={[
                    styles.segmentButtonText,
                    { color: statusFilter === "BLOCKED" ? primaryRose : colors.textMuted },
                  ]}
                >
                  Blocked ({blockedCount})
                </Text>
              </Pressable>
            </View>

            {/* Union Chips Scroll */}
            {unions.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.unionScrollTrack}
              >
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedUnion("All");
                  }}
                  style={[
                    styles.unionPill,
                    {
                      backgroundColor: selectedUnion === "All" ? primaryRose : cardBg,
                      borderColor: selectedUnion === "All" ? primaryRose : glassBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name="grid-outline"
                    size={12}
                    color={selectedUnion === "All" ? "#FFF" : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.unionPillText,
                      { color: selectedUnion === "All" ? "#FFF" : colors.text },
                    ]}
                  >
                    All Unions
                  </Text>
                </Pressable>

                {unions.map((u) => {
                  const active = selectedUnion === u;
                  const count = unionCounts[u] || 0;
                  return (
                    <Pressable
                      key={u}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedUnion(u);
                      }}
                      style={[
                        styles.unionPill,
                        {
                          backgroundColor: active ? primaryRose : cardBg,
                          borderColor: active ? primaryRose : glassBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.unionPillText,
                          { color: active ? "#FFF" : colors.text },
                        ]}
                      >
                        {u} <Text style={{ opacity: 0.65 }}>({count})</Text>
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* ================= CLIENT LIST VIEW ================= */}
          {loading && clients.length === 0 ? (
            <View style={styles.loadingContainer}>
              <SkeletonLoader style={{ height: 110 }} />
              <SkeletonLoader style={{ height: 110 }} />
              <SkeletonLoader style={{ height: 110 }} />
            </View>
          ) : filteredClients.length === 0 ? (
            <View style={[styles.emptyContainer, { backgroundColor: cardBg, borderColor: glassBorder }]}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="folder-open-outline" size={36} color={colors.textMuted} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No clients matching query</Text>
              <Text style={[styles.emptySubtitle, { color: colors.textMuted }]}>
                {search
                  ? "Try adjusting your search criteria or union filters."
                  : "No records found in this category."}
              </Text>
              {search.length > 0 && (
                <Pressable
                  onPress={() => setSearch("")}
                  style={[styles.resetSearchBtn, { borderColor: glassBorder }]}
                >
                  <Text style={[styles.resetSearchText, { color: colors.text }]}>Clear search</Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View style={styles.clientsList}>
              {filteredClients.map((client) => {
                const isReady = client.can_close;
                return (
                  <Pressable
                    key={client.id}
                    onPress={() => handleOpenClientSheet(client)}
                    style={({ pressed }) => [
                      styles.clientCard,
                      {
                        backgroundColor: cardBg,
                        borderColor: isReady
                          ? "rgba(16, 185, 129, 0.35)"
                          : glassBorder,
                        transform: [{ scale: pressed ? 0.985 : 1 }],
                      },
                    ]}
                  >
                    {/* Status Left Accent Bar */}
                    <View
                      style={[
                        styles.cardSideAccent,
                        { backgroundColor: isReady ? primaryEmerald : primaryRose },
                      ]}
                    />

                    <View style={styles.cardContent}>
                      {/* Top Row: Avatar + Name + Readiness Badge */}
                      <View style={styles.cardHeader}>
                        <LinearGradient
                          colors={
                            isReady
                              ? ["rgba(16, 185, 129, 0.2)", "rgba(5, 150, 105, 0.08)"]
                              : ["rgba(225, 29, 72, 0.2)", "rgba(190, 18, 60, 0.08)"]
                          }
                          style={styles.clientAvatar}
                        >
                          <Text
                            style={[
                              styles.clientAvatarText,
                              { color: isReady ? primaryEmerald : primaryRose },
                            ]}
                          >
                            {client.name.charAt(0).toUpperCase()}
                          </Text>
                        </LinearGradient>

                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={[styles.clientNameText, { color: colors.text }]} numberOfLines={1}>
                            {client.name}
                          </Text>
                          <View style={styles.clientMetaRow}>
                            <Ionicons name="business-outline" size={11} color="#60A5FA" />
                            <Text style={styles.clientMetaUnion} numberOfLines={1}>
                              {client.union || "Standard Group"}
                            </Text>
                          </View>
                        </View>

                        <View
                          style={[
                            styles.badgePill,
                            {
                              backgroundColor: isReady
                                ? "rgba(16, 185, 129, 0.12)"
                                : "rgba(225, 29, 72, 0.12)",
                              borderColor: isReady
                                ? "rgba(16, 185, 129, 0.3)"
                                : "rgba(225, 29, 72, 0.3)",
                            },
                          ]}
                        >
                          <View
                            style={[
                              styles.badgeSmallDot,
                              { backgroundColor: isReady ? primaryEmerald : primaryRose },
                            ]}
                          />
                          <Text
                            style={[
                              styles.badgePillText,
                              { color: isReady ? primaryEmerald : primaryRose },
                            ]}
                          >
                            {isReady ? "Ready" : "Blocked"}
                          </Text>
                        </View>
                      </View>

                      {/* Financial Snippets Bar */}
                      <View style={styles.cardFinancialRow}>
                        <View
                          style={[
                            styles.balanceChip,
                            {
                              backgroundColor:
                                client.total_savings > 0
                                  ? isDark
                                    ? "rgba(16, 185, 129, 0.12)"
                                    : "#ECFDF5"
                                  : isDark
                                  ? "rgba(255,255,255,0.03)"
                                  : "#F8FAFC",
                            },
                          ]}
                        >
                          <Text style={[styles.balanceChipLabel, { color: colors.textMuted }]}>SAVINGS</Text>
                          <Text
                            style={[
                              styles.balanceChipAmount,
                              {
                                color:
                                  client.total_savings > 0
                                    ? primaryEmerald
                                    : colors.textMuted,
                              },
                            ]}
                          >
                            {formatNaira(client.total_savings)}
                          </Text>
                        </View>

                        <View
                          style={[
                            styles.balanceChip,
                            {
                              backgroundColor:
                                client.total_loan > 0
                                  ? isDark
                                    ? "rgba(225, 29, 72, 0.12)"
                                    : "#FFF1F2"
                                  : isDark
                                  ? "rgba(255,255,255,0.03)"
                                  : "#F8FAFC",
                            },
                          ]}
                        >
                          <Text style={[styles.balanceChipLabel, { color: colors.textMuted }]}>LOAN BAL</Text>
                          <Text
                            style={[
                              styles.balanceChipAmount,
                              {
                                color:
                                  client.total_loan > 0
                                    ? primaryRose
                                    : colors.textMuted,
                              },
                            ]}
                          >
                            {formatNaira(client.total_loan)}
                          </Text>
                        </View>

                        {/* Direct Call Button */}
                        {client.phone ? (
                          <Pressable
                            onPress={(e) => {
                              e.stopPropagation();
                              Haptics.selectionAsync();
                              Linking.openURL(`tel:${client.phone}`);
                            }}
                            hitSlop={6}
                            style={[
                              styles.callButton,
                              { borderColor: glassBorder, backgroundColor: cardBgMuted },
                            ]}
                          >
                            <Ionicons name="call" size={13} color={primaryEmerald} />
                          </Pressable>
                        ) : null}

                        <View style={styles.actionArrowBox}>
                          <Ionicons name="chevron-forward" size={16} color={primaryRose} />
                        </View>
                      </View>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </Animated.View>

      {/* ================= CLOSURE REVIEW BOTTOM SHEET ================= */}
      <Modal
        visible={!!selectedClient}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedClient(null)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedClient(null)} />
          <LinearGradient
            colors={
              isDark
                ? ["rgba(30, 41, 59, 0.98)", "rgba(15, 23, 42, 1)"]
                : ["#FFFFFF", "rgba(248, 250, 252, 1)"]
            }
            style={[styles.sheetContent, { borderColor: glassBorder }]}
          >
            {/* Grabber Handle */}
            <View style={styles.sheetGrabber} />

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleGroup}>
                <View style={styles.sheetIconShield}>
                  <Ionicons name="shield-half" size={18} color={primaryRose} />
                </View>
                <View>
                  <Text style={[styles.sheetMainTitle, { color: colors.text }]}>Audit & Deactivation</Text>
                  <Text style={[styles.sheetSubTitle, { color: colors.textMuted }]}>Compliance settlement gate</Text>
                </View>
              </View>

              <Pressable
                onPress={() => setSelectedClient(null)}
                style={[styles.sheetCloseBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}
                hitSlop={8}
              >
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </Pressable>
            </View>

            {loadingDetails ? (
              <View style={styles.sheetLoadingBox}>
                <SkeletonLoader style={{ width: "100%", height: 60, marginBottom: 12 }} />
                <SkeletonLoader style={{ width: "100%", height: 90, marginBottom: 12 }} />
                <ActivityIndicator size="small" color={primaryRose} style={{ marginTop: 16 }} />
                <Text style={[styles.sheetLoadingMsg, { color: colors.textMuted }]}>
                  Verifying live ledger balances across database...
                </Text>
              </View>
            ) : clientDetails ? (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* Target Client Profile Card */}
                <View style={[styles.clientProfileCard, { backgroundColor: cardBgMuted, borderColor: glassBorder }]}>
                  <LinearGradient
                    colors={["rgba(225, 29, 72, 0.25)", "rgba(225, 29, 72, 0.05)"]}
                    style={styles.profileAvatar}
                  >
                    <Text style={styles.profileAvatarLetter}>
                      {clientDetails.name?.charAt(0).toUpperCase() || "C"}
                    </Text>
                  </LinearGradient>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.profileName, { color: colors.text }]}>{clientDetails.name}</Text>
                    <Text style={[styles.profileMeta, { color: colors.textMuted }]}>
                      {clientDetails.union || "Standard"} • {clientDetails.phone || "No phone number"}
                    </Text>
                  </View>
                  <View
                    style={[
                      styles.badgePill,
                      {
                        backgroundColor: clientDetails.can_close
                          ? "rgba(16, 185, 129, 0.12)"
                          : "rgba(225, 29, 72, 0.12)",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgePillText,
                        { color: clientDetails.can_close ? primaryEmerald : primaryRose },
                      ]}
                    >
                      {clientDetails.can_close ? "CLEAR" : "HOLD"}
                    </Text>
                  </View>
                </View>

                {/* Ledger Comparison Cards */}
                <View style={styles.ledgerGrid}>
                  <View
                    style={[
                      styles.ledgerBox,
                      {
                        backgroundColor:
                          clientDetails.total_savings > 0
                            ? isDark
                              ? "rgba(16, 185, 129, 0.08)"
                              : "#F0FDF4"
                            : cardBgMuted,
                        borderColor:
                          clientDetails.total_savings > 0
                            ? "rgba(16, 185, 129, 0.3)"
                            : glassBorder,
                      },
                    ]}
                  >
                    <View style={styles.ledgerBoxHeader}>
                      <Ionicons
                        name="wallet-outline"
                        size={13}
                        color={clientDetails.total_savings > 0 ? primaryEmerald : colors.textMuted}
                      />
                      <Text style={[styles.ledgerBoxTag, { color: colors.textMuted }]}>UNCLAIMED SAVINGS</Text>
                    </View>
                    <Text
                      style={[
                        styles.ledgerBoxValue,
                        { color: clientDetails.total_savings > 0 ? primaryEmerald : colors.text },
                      ]}
                    >
                      {formatNaira(clientDetails.total_savings)}
                    </Text>
                    <Text style={[styles.ledgerBoxNote, { color: colors.textMuted }]}>
                      {clientDetails.total_savings > 0 ? "Requires cash refund" : "Account settled"}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.ledgerBox,
                      {
                        backgroundColor:
                          clientDetails.total_loan > 0
                            ? isDark
                              ? "rgba(225, 29, 72, 0.08)"
                              : "#FFF1F2"
                            : cardBgMuted,
                        borderColor:
                          clientDetails.total_loan > 0
                            ? "rgba(225, 29, 72, 0.35)"
                            : glassBorder,
                      },
                    ]}
                  >
                    <View style={styles.ledgerBoxHeader}>
                      <Ionicons
                        name="alert-circle-outline"
                        size={13}
                        color={clientDetails.total_loan > 0 ? primaryRose : colors.textMuted}
                      />
                      <Text style={[styles.ledgerBoxTag, { color: colors.textMuted }]}>REMAINING DEBT</Text>
                    </View>
                    <Text
                      style={[
                        styles.ledgerBoxValue,
                        { color: clientDetails.total_loan > 0 ? primaryRose : colors.text },
                      ]}
                    >
                      {formatNaira(clientDetails.total_loan)}
                    </Text>
                    <Text style={[styles.ledgerBoxNote, { color: colors.textMuted }]}>
                      {clientDetails.total_loan > 0 ? "Outstanding balance" : "Fully discharged"}
                    </Text>
                  </View>
                </View>

                {/* Condition 1: BLOCKED STATE WITH ACTION BUTTONS */}
                {!clientDetails.can_close ? (
                  <View style={styles.blockerAlertBox}>
                    <View style={styles.blockerTopRow}>
                      <Ionicons name="lock-closed" size={20} color={primaryRose} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.blockerAlertTitle}>Deactivation Blocked</Text>
                        <Text style={styles.blockerAlertDesc}>
                          Cupad Microfinance policy mandates an absolute balance of ₦0 in both savings and active loan accounts before records can be permanently closed.
                        </Text>
                      </View>
                    </View>

                    <View style={styles.resolutionActionsGroup}>
                      {clientDetails.total_savings > 0 && (
                        <Pressable
                          onPress={() => jumpToResolution("withdrawal")}
                          style={[styles.resolutionActionButton, { backgroundColor: primaryEmerald }]}
                        >
                          <Ionicons name="arrow-down-circle-outline" size={16} color="#FFF" />
                          <Text style={styles.resolutionActionButtonText}>
                            Withdraw Full Savings ({formatNaira(clientDetails.total_savings)})
                          </Text>
                          <Ionicons name="chevron-forward" size={14} color="#FFF" style={{ marginLeft: "auto" }} />
                        </Pressable>
                      )}

                      {clientDetails.total_loan > 0 && (
                        <Pressable
                          onPress={() => jumpToResolution("repayment")}
                          style={[styles.resolutionActionButton, { backgroundColor: "#8B5CF6", marginTop: 8 }]}
                        >
                          <Ionicons name="cash-outline" size={16} color="#FFF" />
                          <Text style={styles.resolutionActionButtonText}>
                            Collect Final Repayment ({formatNaira(clientDetails.total_loan)})
                          </Text>
                          <Ionicons name="chevron-forward" size={14} color="#FFF" style={{ marginLeft: "auto" }} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                ) : (
                  /* Condition 2: READY TO CLOSE STATE */
                  <>
                    <View style={styles.readyVerificationBanner}>
                      <Ionicons name="checkmark-done-circle" size={22} color={primaryEmerald} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.readyVerificationTitle}>Ledger Balance Cleared</Text>
                        <Text style={styles.readyVerificationSubtitle}>
                          This profile is completely settled and cleared for permanent closure.
                        </Text>
                      </View>
                    </View>

                    <Text style={[styles.inputSectionLabel, { color: colors.text }]}>Exit Reason</Text>
                    <View style={styles.reasonsList}>
                      {REASONS.map((r) => {
                        const active = selectedReason === r;
                        return (
                          <Pressable
                            key={r}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setSelectedReason(r);
                            }}
                            style={[
                              styles.reasonTag,
                              {
                                backgroundColor: active
                                  ? isDark
                                    ? "rgba(225, 29, 72, 0.2)"
                                    : "#FFE4E6"
                                  : cardBgMuted,
                                borderColor: active ? primaryRose : glassBorder,
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.reasonTagText,
                                { color: active ? primaryRose : colors.textMuted },
                              ]}
                            >
                              {r}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    <Text style={[styles.inputSectionLabel, { color: colors.text, marginTop: 12 }]}>
                      Officer Audit Notes (Optional)
                    </Text>
                    <TextInput
                      placeholder="Enter details, file references, or witness notes..."
                      placeholderTextColor={colors.textMuted}
                      value={closureNotes}
                      onChangeText={setClosureNotes}
                      style={[
                        styles.notesInputField,
                        {
                          backgroundColor: cardBgMuted,
                          color: colors.text,
                          borderColor: glassBorder,
                        },
                      ]}
                      multiline
                    />

                    {/* SLIDE TO CONFIRM WIDGET */}
                    <View style={styles.slideWidgetWrapper}>
                      <View style={[styles.slideTrack, { backgroundColor: isDark ? "#0F172A" : "#E2E8F0" }]}>
                        <Animated.View
                          style={[
                            styles.slideTrackFill,
                            {
                              width: Animated.add(slideAnim, new Animated.Value(SLIDER_HANDLE_SIZE)),
                              backgroundColor: primaryRose,
                            },
                          ]}
                        />
                        <View style={styles.slideTrackTextContainer} pointerEvents="none">
                          <Text style={styles.slideTrackInstruction}>
                            {submitting ? "Processing closure..." : "SLIDE TO CLOSE ACCOUNT"}
                          </Text>
                          {!submitting && (
                            <View style={styles.chevronsRow}>
                              <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.45)" />
                              <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.75)" />
                            </View>
                          )}
                        </View>

                        <Animated.View
                          {...panResponder.panHandlers}
                          style={[
                            styles.slideGrabberHandle,
                            {
                              transform: [{ translateX: slideAnim }],
                            },
                          ]}
                        >
                          {submitting ? (
                            <ActivityIndicator size="small" color="#FFF" />
                          ) : (
                            <Ionicons name="lock-open-outline" size={20} color="#FFF" />
                          )}
                        </Animated.View>
                      </View>
                      <Text style={[styles.slideSafetyNotice, { color: colors.textMuted }]}>
                        Action is permanent. Audit timestamp and officer ID will be committed.
                      </Text>
                    </View>
                  </>
                )}
              </ScrollView>
            ) : null}
          </LinearGradient>
        </View>
      </Modal>

      {/* ================= DIGITAL AUDIT RECEIPT MODAL ================= */}
      <Modal visible={!!receipt} transparent animationType="fade">
        <View style={styles.receiptOverlay}>
          <LinearGradient
            colors={
              isDark
                ? ["rgba(30, 41, 59, 0.98)", "rgba(15, 23, 42, 0.98)"]
                : ["#FFFFFF", "rgba(248, 250, 252, 0.98)"]
            }
            style={[styles.receiptFrame, { borderColor: glassBorder }]}
          >
            {/* Success Shield Icon */}
            <View style={styles.receiptHeaderSeal}>
              <Ionicons name="checkmark-done" size={32} color={primaryEmerald} />
            </View>

            <Text style={[styles.receiptMainHeading, { color: colors.text }]}>Deactivation Certified</Text>
            <Text style={[styles.receiptSubHeading, { color: colors.textMuted }]}>
              Official Member Closure Log Recorded
            </Text>

            {receipt && (
              <View style={[styles.receiptBody, { backgroundColor: cardBgMuted, borderColor: glassBorder }]}>
                {/* Perforation decorative edge top */}
                <View style={styles.receiptPerforationBar}>
                  <View style={[styles.perforationHole, { left: -22 }]} />
                  <View style={[styles.perforationHole, { right: -22 }]} />
                </View>

                <View style={styles.receiptItemRow}>
                  <Text style={[styles.receiptItemKey, { color: colors.textMuted }]}>Client Name</Text>
                  <Text style={[styles.receiptItemVal, { color: colors.text }]}>{receipt.clientName}</Text>
                </View>

                <View style={styles.receiptItemRow}>
                  <Text style={[styles.receiptItemKey, { color: colors.textMuted }]}>Group Union</Text>
                  <Text style={[styles.receiptItemVal, { color: colors.text }]}>{receipt.union}</Text>
                </View>

                <View style={styles.receiptItemRow}>
                  <Text style={[styles.receiptItemKey, { color: colors.textMuted }]}>Reference No.</Text>
                  <Pressable
                    onPress={() => {
                      Clipboard.setString(receipt.reference);
                      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      showToast("Reference copied to clipboard", "success");
                    }}
                    style={styles.referenceCopyBadge}
                  >
                    <Text style={[styles.referenceCopyText, { color: primaryRose }]}>{receipt.reference}</Text>
                    <Ionicons name="copy-outline" size={12} color={primaryRose} />
                  </Pressable>
                </View>

                <View style={styles.receiptItemRow}>
                  <Text style={[styles.receiptItemKey, { color: colors.textMuted }]}>Closure Reason</Text>
                  <Text style={[styles.receiptItemVal, { color: colors.text }]}>{receipt.reason}</Text>
                </View>

                <View style={[styles.receiptItemRow, { borderBottomWidth: 0 }]}>
                  <Text style={[styles.receiptItemKey, { color: colors.textMuted }]}>Audit Timestamp</Text>
                  <Text style={[styles.receiptItemVal, { color: colors.text }]}>{receipt.timestamp}</Text>
                </View>
              </View>
            )}

            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setReceipt(null);
              }}
              style={[styles.receiptDismissBtn, { backgroundColor: primaryRose }]}
            >
              <Text style={styles.receiptDismissBtnText}>Done & Return to List</Text>
            </Pressable>
          </LinearGradient>
        </View>
      </Modal>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: 80,
    paddingTop: 8,
  },

  /* Floating Toast */
  toastContainer: {
    position: "absolute",
    top: 10,
    left: 20,
    right: 20,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 8,
  },
  toastIconBox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  toastMessage: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },

  /* Hero Card */
  heroCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 3,
  },
  heroTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  pulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heroBadgeText: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  complianceBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 12,
  },
  complianceText: {
    fontSize: 9.5,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
  heroMain: {
    marginBottom: 14,
  },
  heroSubHeader: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  heroCountRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    marginTop: 2,
  },
  heroCountNumber: {
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  heroCountLabel: {
    fontSize: 13,
    fontWeight: "600",
  },
  heroDescription: {
    fontSize: 11.5,
    marginTop: 4,
    lineHeight: 16,
  },

  /* 4-Item Matrix */
  matrixContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  matrixCard: {
    width: "48.5%",
    borderRadius: 14,
    padding: 10,
  },
  matrixCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  miniIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  matrixCardTitle: {
    fontSize: 9.5,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  matrixCardValue: {
    fontSize: 15,
    fontWeight: "900",
    marginTop: 3,
  },
  matrixCardFooter: {
    fontSize: 9,
    fontWeight: "500",
    marginTop: 1,
  },

  /* Controls Section */
  controlsSection: {
    paddingHorizontal: 16,
    gap: 10,
    marginBottom: 8,
  },
  searchPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    height: "100%",
  },
  segmentedTrack: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 3,
  },
  segmentButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 11,
    gap: 6,
  },
  segmentButtonActive: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  tabDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  segmentButtonText: {
    fontSize: 11.5,
    fontWeight: "800",
  },

  unionScrollTrack: {
    gap: 8,
    paddingVertical: 2,
  },
  unionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1,
  },
  unionPillText: {
    fontSize: 11,
    fontWeight: "700",
  },

  /* Client List */
  loadingContainer: {
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 6,
  },
  clientsList: {
    paddingHorizontal: 16,
    gap: 10,
    marginTop: 4,
  },
  clientCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    flexDirection: "row",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  cardSideAccent: {
    width: 4,
  },
  cardContent: {
    flex: 1,
    padding: 12,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  clientAvatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  clientAvatarText: {
    fontSize: 16,
    fontWeight: "900",
  },
  clientNameText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  clientMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  clientMetaUnion: {
    color: "#60A5FA",
    fontSize: 11,
    fontWeight: "600",
  },
  badgePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  badgeSmallDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  badgePillText: {
    fontSize: 9.5,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  cardFinancialRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(148, 163, 184, 0.12)",
  },
  balanceChip: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  balanceChipLabel: {
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  balanceChipAmount: {
    fontSize: 12,
    fontWeight: "900",
    marginTop: 1,
  },
  callButton: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  actionArrowBox: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  /* Empty State */
  emptyContainer: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 36,
    alignItems: "center",
    gap: 8,
    marginTop: 14,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(148, 163, 184, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  emptySubtitle: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
  },
  resetSearchBtn: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  resetSearchText: {
    fontSize: 12,
    fontWeight: "700",
  },

  /* Bottom Sheet */
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.6)",
    justifyContent: "flex-end",
  },
  sheetContent: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    maxHeight: height * 0.9,
  },
  sheetGrabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#94A3B8",
    opacity: 0.4,
    alignSelf: "center",
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sheetTitleGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  sheetIconShield: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(225, 29, 72, 0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  sheetMainTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  sheetSubTitle: {
    fontSize: 11,
    fontWeight: "500",
  },
  sheetCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetLoadingBox: {
    paddingVertical: 36,
    alignItems: "center",
  },
  sheetLoadingMsg: {
    fontSize: 12,
    fontWeight: "600",
    marginTop: 10,
  },
  clientProfileCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 12,
  },
  profileAvatar: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  profileAvatarLetter: {
    color: "#E11D48",
    fontSize: 17,
    fontWeight: "900",
  },
  profileName: {
    fontSize: 14,
    fontWeight: "800",
  },
  profileMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  ledgerGrid: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 14,
  },
  ledgerBox: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  ledgerBoxHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  ledgerBoxTag: {
    fontSize: 8.5,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  ledgerBoxValue: {
    fontSize: 16,
    fontWeight: "900",
    marginVertical: 4,
  },
  ledgerBoxNote: {
    fontSize: 10,
    fontWeight: "600",
  },
  blockerAlertBox: {
    backgroundColor: "rgba(225, 29, 72, 0.08)",
    borderColor: "rgba(225, 29, 72, 0.25)",
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },
  blockerTopRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "flex-start",
  },
  blockerAlertTitle: {
    color: "#E11D48",
    fontSize: 14,
    fontWeight: "800",
  },
  blockerAlertDesc: {
    color: "#BE123C",
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 3,
  },
  resolutionActionsGroup: {
    marginTop: 12,
  },
  resolutionActionButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  resolutionActionButtonText: {
    color: "#FFF",
    fontSize: 12,
    fontWeight: "800",
  },
  readyVerificationBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
    padding: 12,
    borderRadius: 14,
    marginBottom: 14,
  },
  readyVerificationTitle: {
    color: "#059669",
    fontSize: 13,
    fontWeight: "800",
  },
  readyVerificationSubtitle: {
    color: "#047857",
    fontSize: 11,
    marginTop: 1,
  },
  inputSectionLabel: {
    fontSize: 11.5,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  reasonsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 6,
  },
  reasonTag: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  reasonTagText: {
    fontSize: 11,
    fontWeight: "700",
  },
  notesInputField: {
    height: 60,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 12,
    textAlignVertical: "top",
    marginBottom: 16,
  },

  /* Slider */
  slideWidgetWrapper: {
    alignItems: "center",
    marginTop: 6,
  },
  slideTrack: {
    width: SLIDER_CONTAINER_WIDTH,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    position: "relative",
    overflow: "hidden",
  },
  slideTrackFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 28,
    opacity: 0.85,
  },
  slideTrackTextContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  slideTrackInstruction: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFF",
    letterSpacing: 1,
  },
  chevronsRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  slideGrabberHandle: {
    position: "absolute",
    left: 3,
    top: 2,
    width: SLIDER_HANDLE_SIZE,
    height: SLIDER_HANDLE_SIZE,
    borderRadius: SLIDER_HANDLE_SIZE / 2,
    backgroundColor: "#E11D48",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
  },
  slideSafetyNotice: {
    fontSize: 10,
    marginTop: 8,
    textAlign: "center",
    fontWeight: "500",
  },

  /* Receipt Modal */
  receiptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    justifyContent: "center",
    padding: 20,
  },
  receiptFrame: {
    borderRadius: 26,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
  },
  receiptHeaderSeal: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: "rgba(16, 185, 129, 0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  receiptMainHeading: {
    fontSize: 19,
    fontWeight: "900",
    letterSpacing: -0.3,
  },
  receiptSubHeading: {
    fontSize: 12,
    marginTop: 2,
    marginBottom: 16,
  },
  receiptBody: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    position: "relative",
    overflow: "hidden",
  },
  receiptPerforationBar: {
    position: "absolute",
    top: 48,
    left: 0,
    right: 0,
    height: 1,
    borderStyle: "dashed",
    borderColor: "rgba(148, 163, 184, 0.3)",
    borderWidth: 1,
  },
  perforationHole: {
    position: "absolute",
    top: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  receiptItemRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148, 163, 184, 0.15)",
  },
  receiptItemKey: {
    fontSize: 11,
    fontWeight: "600",
  },
  receiptItemVal: {
    fontSize: 12,
    fontWeight: "800",
  },
  referenceCopyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: "rgba(225, 29, 72, 0.1)",
  },
  referenceCopyText: {
    fontSize: 11,
    fontWeight: "900",
  },
  receiptDismissBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  receiptDismissBtnText: {
    color: "#FFF",
    fontSize: 14,
    fontWeight: "800",
  },
});