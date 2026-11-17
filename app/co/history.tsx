import React, { useEffect, useRef, useState, useCallback } from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  Easing,
  ActivityIndicator,
  Modal,
  RefreshControl,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isOnline,
  getAllPendingCounts,
  loadOfflineWorkspace,
} from "../../src/db/database";
import { bootstrapCoScreenData, fetchUnionsForOfficer } from "../../src/db/offlineHelpers";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_HISTORY = `${API_BASE}/api/history_api.php`;

type TxCategory = "all" | "today" | "saving" | "withdrawal" | "repayment" | "disbursement";

type HistoryTransaction = {
  id: string;
  date: string;
  client: string;
  union?: string;
  type: string;
  category: "saving" | "withdrawal" | "repayment" | "disbursement" | string;
  amount: number;
};

function formatNaira(amount: number | string): string {
  const num = Number(amount) || 0;
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/* ================= PREMIUM AMBIENT ORBS - MATCH DASHBOARD ================= */
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
            toValue: -18,
            duration: 4000,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1.12,
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
        opacity: 0.45,
        transform: [{ translateY }, { scale }],
      }}
    />
  );
}

function Skeleton({ style }: { style?: any }) {
  const opacity = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 750, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);
  return (
    <Animated.View
      style={[
        {
          backgroundColor: "rgba(148, 163, 184, 0.25)",
          opacity,
          borderRadius: 14,
        },
        style,
      ]}
    />
  );
}

function getActivityMeta(type: string) {
  const t = (type || "").toLowerCase();
  if (t.includes("saving")) {
    return {
      icon: "wallet" as const,
      color: "#10B981",
      bg: "rgba(16, 185, 129, 0.12)",
      label: "Savings Deposit",
      sign: "+",
    };
  }
  if (t.includes("withdraw")) {
    return {
      icon: "arrow-down-circle" as const,
      color: "#EF4444",
      bg: "rgba(239, 68, 68, 0.12)",
      label: "Withdrawal",
      sign: "-",
    };
  }
  if (t.includes("payment") || t.includes("repay")) {
    return {
      icon: "checkmark-circle" as const,
      color: "#8B5CF6",
      bg: "rgba(139, 92, 246, 0.12)",
      label: "Loan Repayment",
      sign: "+",
    };
  }
  if (t.includes("disburse") || t.includes("loan")) {
    return {
      icon: "paper-plane" as const,
      color: "#0284C7",
      bg: "rgba(2, 132, 199, 0.12)",
      label: "Loan Disbursal",
      sign: "-",
    };
  }
  return {
    icon: "swap-horizontal" as const,
    color: "#64748B",
    bg: "rgba(100, 116, 139, 0.12)",
    label: type || "Transaction",
    sign: "",
  };
}

const FILTER_TABS: { key: TxCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: "all", label: "All", icon: "layers-outline" },
  { key: "today", label: "Today", icon: "today-outline" },
  { key: "saving", label: "Savings", icon: "wallet-outline" },
  { key: "withdrawal", label: "Withdrawals", icon: "arrow-up-circle-outline" },
  { key: "repayment", label: "Loans", icon: "card-outline" },
  { key: "disbursement", label: "Disbursed", icon: "paper-plane-outline" },
];

export default function HistoryScreen() {
  const { colors, isDark } = useTheme();

  // Premium glass tokens - MATCH DASHBOARD
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37,99,235,0.18)" : "rgba(37,99,235,0.10)";
  const orbColor2 = isDark ? "rgba(14,165,233,0.14)" : "rgba(14,165,233,0.08)";

  // Officer Session
  const [officerUsername, setOfficerUsername] = useState("");

  // Data & Pagination
  const [transactions, setTransactions] = useState<HistoryTransaction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState<TxCategory>("all");
  const [searchText, setSearchText] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  // UI Flow States
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Per-ID copy tracker
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);

  // Selected for Details Sheet
  const [selectedTx, setSelectedTx] = useState<HistoryTransaction | null>(null);

  const searchTimer = useRef<NodeJS.Timeout | null>(null);
  const copyTimer = useRef<NodeJS.Timeout | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Toast animation
  const toastY = useRef(new Animated.Value(-60)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    Animated.parallel([
      Animated.spring(toastY, { toValue: 0, tension: 80, friction: 9, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastY, { toValue: -40, duration: 250, useNativeDriver: true }),
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start(() => setToastMessage(null));
    }, 2200);
  };

  // Load Officer Session
  const loadUser = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("cupad_user");
      if (stored) {
        const u = JSON.parse(stored);
        if (u.username) {
          setOfficerUsername(u.username);
          return u.username;
        }
      }
    } catch {}
    return "";
  }, []);

  // Fetch Transactions
  const fetchHistory = useCallback(
    async (
      pageNum = 1,
      append = false,
      activeFilter = categoryFilter,
      searchVal = searchText
    ) => {
      const user = officerUsername || (await loadUser());
      if (!user) return;

      if (!append) {
        setLoading(true);
        setFetchError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const params: Record<string, any> = {
          username: user,
          page: pageNum,
          limit: 20,
        };

        if (activeFilter && activeFilter !== "all") {
          params.type = activeFilter;
        }

        const trimmedSearch = searchVal.trim();
        if (trimmedSearch) {
          params.search = trimmedSearch;
        }

        if (startDate) params.startDate = startDate;
        if (endDate) params.endDate = endDate;

        const res = await axios.get(API_HISTORY, {
          params,
          timeout: 15000,
        });

        if (res.data?.success) {
          const list: HistoryTransaction[] = res.data.data || [];
          setTotalCount(res.data.totalCount || 0);
          setHasMore(Boolean(res.data.hasMore));
          setPage(pageNum);

          if (append) {
            setTransactions((prev) => [...prev, ...list]);
          } else {
            setTransactions(list);
            try {
              await AsyncStorage.setItem("cupad_cache_co_history", JSON.stringify(list));
            } catch {}
          }
          try { await fetchUnionsForOfficer(user); } catch {}
        } else {
          setFetchError(res.data?.message || "Failed to load ledger records");
        }
      } catch (err: any) {
        const errMsg = err?.response?.data?.message || err?.message || "Network error loading ledger";
        if (!append) {
          try {
            const cached = await AsyncStorage.getItem("cupad_cache_co_history");
            if (cached) {
              setTransactions(JSON.parse(cached));
              setFetchError(null);
            } else {
              setFetchError(errMsg + " (offline – no cached ledger)");
            }
          } catch {
            setFetchError(errMsg);
          }
          try { await bootstrapCoScreenData(user); } catch {}
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [officerUsername, loadUser, categoryFilter, searchText, startDate, endDate]
  );

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }).start();
    loadUser().then((u) => {
      if (u) fetchHistory(1, false, "all", "");
    });
  }, []);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchHistory(1, false, categoryFilter, searchText);
  }, [fetchHistory, categoryFilter, searchText]);

  const handleSelectFilter = (cat: TxCategory) => {
    Haptics.selectionAsync();
    setCategoryFilter(cat);
    fetchHistory(1, false, cat, searchText);
  };

  const handleSearchChange = (text: string) => {
    setSearchText(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchHistory(1, false, categoryFilter, text);
    }, 400);
  };

  const handleClearFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearchText("");
    setCategoryFilter("all");
    fetchHistory(1, false, "all", "");
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      fetchHistory(page + 1, true);
    }
  };

  const copyFullTxId = async (fullId: string) => {
    if (!fullId) return;
    try {
      await Clipboard.setStringAsync(fullId);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCopiedTxId(fullId);
      showToast(`Copied Ref #${fullId}`);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => {
        setCopiedTxId(null);
      }, 2000);
    } catch (e) {
      console.log("Clipboard error:", e);
    }
  };

  const getCatBadge = (cat: string) => {
    const meta = getActivityMeta(cat);
    return { color: meta.color, bg: meta.bg, icon: meta.icon, label: meta.label, sign: meta.sign };
  };

  // Calculate summary for hero
  const summaryStats = (() => {
    const total = transactions.reduce((s, t) => s + Number(t.amount || 0), 0);
    const savings = transactions.filter(t => t.category === "saving").reduce((s, t) => s + Number(t.amount || 0), 0);
    const withdrawals = transactions.filter(t => t.category === "withdrawal").reduce((s, t) => s + Number(t.amount || 0), 0);
    return { total, savings, withdrawals };
  })();

  return (
    <CoScreenWrapper>
      {/* PREMIUM BACKGROUND - MATCH DASHBOARD */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={260} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={height * 0.45} delay={2000} />
      </View>

      <View style={styles.container}>
        {/* PREMIUM GLASS TOAST */}
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
              isDark ? styles.shadowDark : styles.shadowLight,
            ]}
          >
            <View style={styles.toastDot} />
            <Text style={[styles.toastText, { color: colors.text }]} numberOfLines={1}>
              {toastMessage}
            </Text>
          </Animated.View>
        )}

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
          {/* ===== PREMIUM HERO CARD - MATCH DASHBOARD HERO ===== */}
          <LinearGradient
            colors={
              isDark
                ? ["rgba(30, 41, 59, 0.88)", "rgba(15, 23, 42, 0.92)"]
                : ["#FFFFFF", "rgba(248, 250, 252, 0.95)"]
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroCard, { borderColor: glassBorder }]}
          >
            <View style={styles.heroHeaderBar}>
              <View
                style={[
                  styles.heroTagPill,
                  { backgroundColor: "rgba(16, 185, 129, 0.15)" },
                ]}
              >
                <View style={[styles.statusPulseDot, { backgroundColor: "#10B981" }]} />
                <Text style={[styles.heroTagText, { color: "#10B981" }]}>
                  LEDGER AUDIT
                </Text>
              </View>

              <View
                style={[
                  styles.syncTimePill,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" },
                ]}
              >
                <Ionicons name="time-outline" size={12} color={colors.textMuted} />
                <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>
                  {totalCount} records
                </Text>
              </View>
            </View>

            <View style={styles.heroMainBalanceSection}>
              <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                TOTAL VOLUME (FILTERED)
              </Text>
              <View style={styles.heroAmountRow}>
                <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                  {formatNaira(summaryStats.total)}
                </Text>
                <View style={[styles.heroCountBadge, { backgroundColor: `${colors.primary}15` }]}>
                  <Text style={[styles.heroCountText, { color: colors.primary }]}>
                    {categoryFilter.toUpperCase()}
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.heroMetricsGrid}>
              <View style={[styles.metricGridItem, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,245,249,0.65)" }]}>
                <View style={styles.metricItemHeader}>
                  <Ionicons name="wallet" size={11} color="#10B981" />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Savings</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: "#10B981" }]}>{formatNaira(summaryStats.savings)}</Text>
              </View>
              <View style={[styles.metricGridItem, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,245,249,0.65)" }]}>
                <View style={styles.metricItemHeader}>
                  <Ionicons name="arrow-down-circle" size={11} color="#EF4444" />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Outflow</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: "#EF4444" }]}>{formatNaira(summaryStats.withdrawals)}</Text>
              </View>
            </View>
          </LinearGradient>

          {/* SEARCH & FILTERS - PREMIUM GLASS */}
          <View style={styles.filterSection}>
            <View
              style={[
                styles.searchBox,
                {
                  backgroundColor: cardSurfaceBg,
                  borderColor: glassBorder,
                },
                isDark ? styles.shadowDark : styles.shadowLight,
              ]}
            >
              <Ionicons name="search" size={18} color={colors.textMuted} />
              <TextInput
                value={searchText}
                onChangeText={handleSearchChange}
                placeholder="Search by client, ID or amount..."
                placeholderTextColor={colors.textMuted}
                style={[styles.searchInput, { color: colors.text }]}
                returnKeyType="search"
              />
              {searchText.length > 0 ? (
                <Pressable onPress={() => handleSearchChange("")} hitSlop={10} style={styles.searchClearBtn}>
                  <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                </Pressable>
              ) : null}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsScroll}>
              {FILTER_TABS.map((tab) => {
                const isSel = categoryFilter === tab.key;
                return (
                  <Pressable
                    key={tab.key}
                    onPress={() => handleSelectFilter(tab.key)}
                    style={({ pressed }) => [
                      styles.filterTab,
                      {
                        backgroundColor: isSel ? colors.primary : cardSurfaceBg,
                        borderColor: isSel ? colors.primary : glassBorder,
                        transform: [{ scale: pressed ? 0.96 : 1 }],
                      },
                      !isSel && (isDark ? styles.shadowDark : styles.shadowLight),
                    ]}
                  >
                    <Ionicons name={tab.icon} size={13} color={isSel ? "#FFFFFF" : colors.textMuted} />
                    <Text style={[styles.filterTabText, { color: isSel ? "#FFFFFF" : colors.text }]}>
                      {tab.label}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* TRANSACTION LIST FEED */}
          <View style={styles.listSection}>
            <View style={styles.listHeaderRow}>
              <View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Ledger Feed</Text>
                <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Immutable collection audit trail</Text>
              </View>
              <View style={[styles.countBadge, { backgroundColor: `${colors.primary}15` }]}>
                <Text style={[styles.countBadgeText, { color: colors.primary }]}>
                  {totalCount} {totalCount === 1 ? "entry" : "entries"}
                </Text>
              </View>
            </View>

            {loading && !refreshing ? (
              <View style={{ gap: 10 }}>
                <Skeleton style={{ width: "100%", height: 78 }} />
                <Skeleton style={{ width: "100%", height: 78 }} />
                <Skeleton style={{ width: "100%", height: 78 }} />
                <Skeleton style={{ width: "100%", height: 78 }} />
              </View>
            ) : fetchError ? (
              <LinearGradient
                colors={isDark ? ["rgba(30,41,59,0.88)", "rgba(15,23,42,0.92)"] : ["#FFFFFF", "rgba(248,250,252,0.95)"]}
                style={[styles.emptyCard, { borderColor: glassBorder }]}
              >
                <View style={[styles.emptyIconCircle, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
                  <Ionicons name="cloud-offline-outline" size={28} color="#EF4444" />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>Connection Issue</Text>
                <Text style={[styles.emptySub, { color: colors.textMuted }]}>{fetchError}</Text>
                <Pressable onPress={() => fetchHistory(1, false, categoryFilter, searchText)} style={styles.emptyResetBtnPrimary}>
                  <Text style={styles.emptyResetBtnTextPrimary}>Tap to Retry</Text>
                </Pressable>
              </LinearGradient>
            ) : transactions.length === 0 ? (
              <LinearGradient
                colors={isDark ? ["rgba(30,41,59,0.88)", "rgba(15,23,42,0.92)"] : ["#FFFFFF", "rgba(248,250,252,0.95)"]}
                style={[styles.emptyCard, { borderColor: glassBorder }]}
              >
                <View style={[styles.emptyIconCircle, { backgroundColor: "rgba(148,163,184,0.12)" }]}>
                  <Ionicons name="file-tray-outline" size={28} color={colors.textMuted} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No transactions found</Text>
                <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                  {searchText ? "No activity matched your current search keyword." : "There are no transactions recorded under this category."}
                </Text>
                {(searchText.length > 0 || categoryFilter !== "all") && (
                  <Pressable onPress={handleClearFilters} style={[styles.emptyResetBtn, { backgroundColor: `${colors.primary}15` }]}>
                    <Text style={[styles.emptyResetBtnText, { color: colors.primary }]}>Reset Filters</Text>
                  </Pressable>
                )}
              </LinearGradient>
            ) : (
              transactions.map((tx, idx) => {
                const meta = getActivityMeta(tx.category);
                const isCopied = copiedTxId === tx.id;
                const d = new Date(tx.date);
                const dateStr = d.toLocaleDateString("en-NG", { month: "short", day: "numeric" });
                const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

                return (
                  <Pressable
                    key={`${tx.id}-${idx}`}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSelectedTx(tx);
                    }}
                    onLongPress={() => copyFullTxId(tx.id)}
                    delayLongPress={350}
                    style={({ pressed }) => [
                      styles.txCard,
                      {
                        backgroundColor: cardSurfaceBg,
                        borderColor: isCopied ? "rgba(16,185,129,0.35)" : glassBorder,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                        opacity: pressed ? 0.9 : 1,
                      },
                      isDark ? styles.shadowDark : styles.shadowLight,
                    ]}
                  >
                    <View style={[styles.txIconBox, { backgroundColor: meta.bg }]}>
                      <Ionicons name={meta.icon as any} size={20} color={meta.color} />
                    </View>

                    <View style={styles.txMainInfo}>
                      <Text style={[styles.txClientName, { color: colors.text }]} numberOfLines={1}>
                        {tx.client}
                      </Text>
                      <View style={styles.txMetaRow}>
                        <Text style={[styles.txTypeBadge, { color: colors.textMuted }]} numberOfLines={1}>
                          {meta.label}
                        </Text>
                        {tx.union ? (
                          <>
                            <Text style={[styles.dotSeparator, { color: colors.textMuted }]}>•</Text>
                            <Text style={[styles.txTypeBadge, { color: colors.textMuted }]} numberOfLines={1}>
                              {tx.union}
                            </Text>
                          </>
                        ) : null}
                      </View>

                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          copyFullTxId(tx.id);
                        }}
                        hitSlop={8}
                        style={({ pressed }) => [
                          styles.idChip,
                          {
                            backgroundColor: isCopied ? "rgba(16,185,129,0.14)" : isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)",
                            borderColor: isCopied ? "rgba(16,185,129,0.35)" : glassBorder,
                            transform: [{ scale: pressed ? 0.96 : 1 }],
                          },
                        ]}
                      >
                        <Text style={[styles.idChipPrefix, { color: isCopied ? "#10B981" : colors.textMuted }]}>ID</Text>
                        <Text style={[styles.idChipText, { color: isCopied ? "#10B981" : colors.text }]} numberOfLines={1}>
                          {tx.id.slice(0, 14)}...
                        </Text>
                        <View style={[styles.idActionCircle, { backgroundColor: isCopied ? "rgba(16,185,129,0.18)" : "transparent" }]}>
                          <Ionicons name={isCopied ? "checkmark" : "copy-outline"} size={11} color={isCopied ? "#10B981" : colors.textMuted} />
                        </View>
                      </Pressable>
                    </View>

                    <View style={styles.txAmountCol}>
                      <Text style={[styles.txAmount, { color: meta.color }]}>
                        {meta.sign}{formatNaira(tx.amount)}
                      </Text>
                      <Text style={[styles.txDate, { color: colors.textMuted }]}>
                        {dateStr}, {timeStr}
                      </Text>
                    </View>
                  </Pressable>
                );
              })
            )}

            {hasMore && !loading && (
              <Pressable
                onPress={handleLoadMore}
                disabled={loadingMore}
                style={({ pressed }) => [
                  styles.loadMoreBtn,
                  {
                    backgroundColor: cardSurfaceBg,
                    borderColor: glassBorder,
                    opacity: pressed ? 0.8 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                  isDark ? styles.shadowDark : styles.shadowLight,
                ]}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <>
                    <Text style={[styles.loadMoreText, { color: colors.text }]}>Load Older Records</Text>
                    <Ionicons name="chevron-down" size={15} color={colors.text} />
                  </>
                )}
              </Pressable>
            )}
          </View>
        </Animated.ScrollView>

        {/* PREMIUM BOTTOM SHEET MODAL */}
        <Modal visible={Boolean(selectedTx)} transparent animationType="slide" onRequestClose={() => setSelectedTx(null)}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedTx(null)} />
            <LinearGradient
              colors={isDark ? ["rgba(30, 41, 59, 0.98)", "rgba(15, 23, 42, 0.98)"] : ["#FFFFFF", "rgba(248, 250, 252, 1)"]}
              style={[styles.modalCard, { borderColor: glassBorder }]}
            >
              <View style={styles.modalDragHandle} />
              <View style={styles.modalHeader}>
                <View>
                  <Text style={[styles.modalTitle, { color: colors.text }]}>Payment Slip</Text>
                  <Text style={[styles.modalSub, { color: colors.textMuted }]}>Verified immutable collection record</Text>
                </View>
                <Pressable
                  onPress={() => setSelectedTx(null)}
                  hitSlop={12}
                  style={[styles.modalCloseIconBtn, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}
                >
                  <Ionicons name="close" size={18} color={colors.text} />
                </Pressable>
              </View>

              {selectedTx && (
                <View style={[styles.modalBody, { backgroundColor: isDark ? "rgba(11,18,32,0.8)" : "#F8FAFC", borderColor: glassBorder }]}>
                  <View style={[styles.referenceCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                    <View style={styles.referenceHeader}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Ionicons name="finger-print-outline" size={13} color={colors.textMuted} />
                        <Text style={[styles.referenceSub, { color: colors.textMuted }]}>TRANSACTION REF</Text>
                      </View>
                      <Pressable
                        onPress={() => copyFullTxId(selectedTx.id)}
                        hitSlop={6}
                        style={({ pressed }) => [
                          styles.refCopyPill,
                          { backgroundColor: copiedTxId === selectedTx.id ? "#10B981" : `${colors.primary}18`, opacity: pressed ? 0.75 : 1 },
                        ]}
                      >
                        <Ionicons name={copiedTxId === selectedTx.id ? "checkmark" : "copy-outline"} size={11} color={copiedTxId === selectedTx.id ? "#FFFFFF" : colors.primary} />
                        <Text style={[styles.refCopyPillText, { color: copiedTxId === selectedTx.id ? "#FFFFFF" : colors.primary }]}>
                          {copiedTxId === selectedTx.id ? "Copied" : "Copy"}
                        </Text>
                      </Pressable>
                    </View>
                    <Text selectable style={[styles.referenceCode, { color: colors.text }]}>{selectedTx.id}</Text>
                  </View>

                  <View style={styles.slipRow}>
                    <Text style={[styles.slipLabel, { color: colors.textMuted }]}>Client Name</Text>
                    <Text style={[styles.slipVal, { color: colors.text }]}>{selectedTx.client}</Text>
                  </View>
                  <View style={styles.slipRow}>
                    <Text style={[styles.slipLabel, { color: colors.textMuted }]}>Group / Union</Text>
                    <Text style={[styles.slipVal, { color: colors.text }]}>{selectedTx.union || "Direct Client"}</Text>
                  </View>
                  <View style={styles.slipRow}>
                    <Text style={[styles.slipLabel, { color: colors.textMuted }]}>Collection Type</Text>
                    <View style={[styles.typePillSmall, { backgroundColor: getActivityMeta(selectedTx.category).bg }]}>
                      <Text style={[styles.typePillText, { color: getActivityMeta(selectedTx.category).color }]}>{getActivityMeta(selectedTx.category).label}</Text>
                    </View>
                  </View>
                  <View style={styles.slipRow}>
                    <Text style={[styles.slipLabel, { color: colors.textMuted }]}>Total Amount</Text>
                    <Text style={[styles.slipVal, { color: getActivityMeta(selectedTx.category).color, fontWeight: "900", fontSize: 18 }]}>
                      {getActivityMeta(selectedTx.category).sign}{formatNaira(selectedTx.amount)}
                    </Text>
                  </View>
                  <View style={styles.slipRow}>
                    <Text style={[styles.slipLabel, { color: colors.textMuted }]}>Timestamp</Text>
                    <Text style={[styles.slipVal, { color: colors.text }]}>
                      {new Date(selectedTx.date).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" })}
                    </Text>
                  </View>
                </View>
              )}

              <View style={styles.modalActionGroup}>
                <Pressable onPress={() => setSelectedTx(null)} style={styles.modalCloseBtn}>
                  <Text style={styles.modalCloseBtnText}>Close Slip</Text>
                </Pressable>
              </View>
            </LinearGradient>
          </View>
        </Modal>
      </View>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 36 },

  // HERO CARD - MATCH DASHBOARD
  heroCard: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 20,
    borderWidth: 1,
    padding: 18,
  },
  heroHeaderBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  heroTagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  statusPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  heroTagText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  syncTimePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  syncTimeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  heroMainBalanceSection: {
    marginBottom: 16,
  },
  heroBalanceLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.8,
    marginBottom: 6,
  },
  heroAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroMainAmount: {
    fontSize: 28,
    fontWeight: "900",
    letterSpacing: -1,
  },
  heroCountBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  heroCountText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  heroMetricsGrid: {
    flexDirection: "row",
    gap: 10,
  },
  metricGridItem: {
    flex: 1,
    borderRadius: 14,
    padding: 12,
  },
  metricItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 6,
  },
  metricItemLabel: {
    fontSize: 10,
    fontWeight: "600",
  },
  metricItemValue: {
    fontSize: 15,
    fontWeight: "800",
  },

  // TOAST
  toastBox: {
    position: "absolute",
    top: 10,
    left: 16,
    right: 16,
    zIndex: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  toastDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#10B981",
  },
  toastText: { fontSize: 12.5, fontWeight: "700", flex: 1 },

  // FILTER SECTION
  filterSection: {
    marginTop: 16,
    gap: 10,
  },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingHorizontal: 14,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
  },
  searchInput: { flex: 1, fontSize: 13.5, height: "100%", fontWeight: "500" },
  searchClearBtn: { padding: 4 },

  tabsScroll: { paddingHorizontal: 16, gap: 8, paddingBottom: 2 },
  filterTab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterTabText: { fontSize: 12, fontWeight: "700" },

  // LIST
  listSection: { paddingHorizontal: 16, marginTop: 6 },
  listHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 14,
    marginTop: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 2 },
  countBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
  },
  countBadgeText: { fontSize: 11, fontWeight: "700" },

  emptyCard: {
    padding: 28,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    marginTop: 6,
  },
  emptyIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: { fontSize: 15, fontWeight: "800" },
  emptySub: { fontSize: 12, fontWeight: "500", marginTop: 4, textAlign: "center", lineHeight: 18 },
  emptyResetBtn: {
    marginTop: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  emptyResetBtnText: { fontSize: 12, fontWeight: "700" },
  emptyResetBtnPrimary: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "#3B82F6",
  },
  emptyResetBtnTextPrimary: { fontSize: 12, fontWeight: "700", color: "#FFFFFF" },

  // TX CARD PREMIUM
  txCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    borderRadius: 18,
    borderWidth: 1,
    marginBottom: 10,
  },
  txIconBox: {
    width: 44,
    height: 44,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  txMainInfo: { flex: 1, marginHorizontal: 11 },
  txClientName: { fontSize: 13.5, fontWeight: "700", letterSpacing: -0.2 },
  txMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  txTypeBadge: { fontSize: 11, fontWeight: "600" },
  dotSeparator: { fontSize: 10 },
  txTypeSub: { fontSize: 11, marginTop: 2 },
  idChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingLeft: 7,
    paddingRight: 4,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
    alignSelf: "flex-start",
    maxWidth: width * 0.48,
  },
  idChipPrefix: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.3 },
  idChipText: {
    fontSize: 9,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  idActionCircle: { width: 16, height: 16, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  txAmountCol: { alignItems: "flex-end" },
  txAmount: { fontSize: 14.5, fontWeight: "900" },
  txDate: { fontSize: 10, fontWeight: "500", marginTop: 3 },

  loadMoreBtn: {
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 12,
  },
  loadMoreText: { fontSize: 13, fontWeight: "700" },

  // MODAL PREMIUM
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalCard: {
    width: "100%",
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 38 : 24,
  },
  modalDragHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(148,163,184,0.35)",
    alignSelf: "center",
    marginBottom: 16,
  },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 },
  modalTitle: { fontSize: 18, fontWeight: "800", letterSpacing: -0.3 },
  modalSub: { fontSize: 12, fontWeight: "500", marginTop: 2 },
  modalCloseIconBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  modalBody: { borderRadius: 16, borderWidth: 1, padding: 16, gap: 12, marginBottom: 18 },
  referenceCard: { padding: 12, borderRadius: 12, borderWidth: 1, marginBottom: 4 },
  referenceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  referenceSub: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  refCopyPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  refCopyPillText: { fontSize: 10, fontWeight: "700" },
  referenceCode: { fontSize: 11, fontWeight: "700", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", letterSpacing: 0.3 },
  slipRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 4 },
  slipLabel: { fontSize: 12, fontWeight: "600" },
  slipVal: { fontSize: 12.5, fontWeight: "700" },
  typePillSmall: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  typePillText: { fontSize: 10, fontWeight: "700" },
  modalActionGroup: { gap: 10 },
  modalCloseBtn: { height: 48, borderRadius: 14, backgroundColor: "#3B82F6", alignItems: "center", justifyContent: "center" },
  modalCloseBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "700" },

  // SHADOWS - MATCH DASHBOARD
  shadowDark: { shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 4 },
  shadowLight: { shadowColor: "#1E3A8A", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 2 },
});
