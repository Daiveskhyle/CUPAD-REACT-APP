// app/co/savings.tsx
import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Share,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  saveSavingsOffline,
  cacheClients,
  loadOfflineWorkspace,
} from "../../src/db/database";
import { fetchUnionsForOfficer, mergeUnionNames } from "../../src/db/offlineHelpers";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_SAVINGS = `${API_BASE}/api/savings_api.php`;
const API_HISTORY = `${API_BASE}/api/history_api.php`;

const CACHE_KEYS = {
  STATS: "cupad_cache_savings_stats",
  CLIENTS: "cupad_cache_savings_clients",
  TRANSACTIONS: "cupad_cache_savings_transactions",
  SETTINGS: "cupad_cache_savings_settings",
  PRIVACY: "cupad_cache_privacy_hide_amounts",
};

const EMERALD_ACCENT = "#10B981";
const EMERALD_DARK = "#059669";
const QUICK_AMOUNTS = [200, 500, 1000, 2000, 5000];

type ClientItem = {
  id: string | number;
  name: string;
  union?: string;
  phone?: string;
  savings_balance?: number;
  savings?: number;
  total_savings?: number;
  loan_balance?: number;
  outstanding_loan?: number;
  today_savings?: number;
};

type SavingsTransaction = {
  transaction_id: string;
  client_name: string;
  amount_collected: number | string;
  date: string;
  officer?: string;
  union?: string;
};

type SavingsStats = {
  active_savers: number;
  total_savings: number;
  month_total: number;
};

function formatNaira(amount: number | string, hide = false): string {
  if (hide) return "••••••••";
  const num = Math.abs(Number(amount) || 0);
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatTxDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();

    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `Today, ${timeStr}`;

    const yesterday = new Date();
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
      return `Yesterday, ${timeStr}`;
    }

    return `${d.toLocaleDateString("en-NG", { month: "short", day: "numeric" })}, ${timeStr}`;
  } catch {
    return dateStr;
  }
}

function isWeekend(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

/**
 * Generates an uppercase full UUID-formatted Transaction ID
 * Example: SAV-D96DCFD6-2578-406A-84E1-0650276A7EAA
 */
function generateSavingsTxId(): string {
  const uuid = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    .replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })
    .toUpperCase();
  return `SAV-${uuid}`;
}

/* ================= AMBIENT PARTICLES & ORBS ================= */
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

/* ================= SKELETON LOADERS ================= */
function ClientCardSkeleton({ isDark, cardBg, glassBorder }: { isDark: boolean; cardBg: string; glassBorder: string }) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const bg = isDark ? "rgba(255,255,255,0.08)" : "rgba(148, 163, 184, 0.22)";

  return (
    <View style={[styles.clientCard, { backgroundColor: cardBg, borderColor: glassBorder }]}>
      <View style={styles.clientCardTop}>
        <Animated.View style={[styles.clientAvatar, { backgroundColor: bg, opacity: pulseAnim }]} />
        <View style={{ flex: 1, marginHorizontal: 10, gap: 6 }}>
          <Animated.View style={{ height: 14, width: "65%", borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
          <Animated.View style={{ height: 10, width: "38%", borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
        </View>
        <Animated.View style={{ height: 22, width: 68, borderRadius: 10, backgroundColor: bg, opacity: pulseAnim }} />
      </View>

      <View style={[styles.clientCardMetrics, { backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC", borderColor: glassBorder }]}>
        <View style={styles.metricItem}>
          <Animated.View style={{ height: 8, width: 45, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
          <Animated.View style={{ height: 13, width: 55, borderRadius: 4, marginTop: 4, backgroundColor: bg, opacity: pulseAnim }} />
        </View>
        <View style={[styles.metricDivider, { backgroundColor: glassBorder }]} />
        <View style={styles.metricItem}>
          <Animated.View style={{ height: 8, width: 50, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
          <Animated.View style={{ height: 13, width: 60, borderRadius: 4, marginTop: 4, backgroundColor: bg, opacity: pulseAnim }} />
        </View>
        <View style={[styles.metricDivider, { backgroundColor: glassBorder }]} />
        <View style={styles.metricItem}>
          <Animated.View style={{ height: 8, width: 55, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
          <Animated.View style={{ height: 13, width: 50, borderRadius: 4, marginTop: 4, backgroundColor: bg, opacity: pulseAnim }} />
        </View>
      </View>

      <View style={styles.depositBox}>
        <View style={styles.depositInputRow}>
          <Animated.View style={[styles.cardInputWrap, { backgroundColor: bg, borderColor: glassBorder, opacity: pulseAnim }]} />
          <Animated.View style={{ width: 88, height: 42, borderRadius: 10, backgroundColor: bg, opacity: pulseAnim }} />
        </View>

        <View style={styles.presetsRow}>
          {[1, 2, 3, 4, 5].map((idx) => (
            <Animated.View
              key={idx}
              style={[
                styles.cardPresetChip,
                { backgroundColor: bg, borderColor: glassBorder, opacity: pulseAnim },
              ]}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function UnionStripSkeleton({ isDark, cardBg, glassBorder }: { isDark: boolean; cardBg: string; glassBorder: string }) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const bg = isDark ? "rgba(255,255,255,0.08)" : "rgba(148, 163, 184, 0.22)";

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unionChipScroll}>
      {[95, 120, 85, 110, 100].map((w, i) => (
        <Animated.View
          key={`union-skel-${i}`}
          style={[
            styles.unionChip,
            { backgroundColor: cardBg, borderColor: glassBorder, width: w, height: 36, opacity: pulseAnim, justifyContent: "center" },
          ]}
        >
          <View style={{ height: 11, width: "70%", borderRadius: 4, backgroundColor: bg }} />
        </Animated.View>
      ))}
    </ScrollView>
  );
}

function HistorySkeletonItem({ isDark, cardBg, glassBorder }: { isDark: boolean; cardBg: string; glassBorder: string }) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.7, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.3, duration: 750, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  const bg = isDark ? "rgba(255,255,255,0.08)" : "rgba(148, 163, 184, 0.22)";

  return (
    <View style={[styles.txCard, { backgroundColor: cardBg, borderColor: glassBorder }]}>
      <Animated.View style={[styles.txIconBox, { backgroundColor: bg, opacity: pulseAnim }]} />
      <View style={{ flex: 1, marginHorizontal: 12, gap: 8 }}>
        <Animated.View style={{ height: 13, width: "65%", borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
        <Animated.View style={{ height: 10, width: "35%", borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Animated.View style={{ height: 15, width: 68, borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
        <Animated.View style={{ height: 10, width: 45, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
      </View>
    </View>
  );
}

export default function SavingsScreen() {
  const { colors, isDark } = useTheme();

  const orbColor1 = isDark ? "rgba(16, 185, 129, 0.20)" : "rgba(16, 185, 129, 0.12)";
  const orbColor2 = isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.08)";
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Officer Session
  const [officerUsername, setOfficerUsername] = useState("");

  // Stats & Settings
  const [stats, setStats] = useState<SavingsStats>({ active_savers: 0, total_savings: 0, month_total: 0 });
  const [minSavings, setMinSavings] = useState(100);
  const [maxSavings, setMaxSavings] = useState(1000000);
  const [allowWeekend, setAllowWeekend] = useState(false);
  const [hideBalances, setHideBalances] = useState(false);

  // Union
  const [selectedUnion, setSelectedUnion] = useState<string>("");

  // Per-Client State & Synchronous Lock Ref
  const [clientAmounts, setClientAmounts] = useState<Record<string | number, string>>({});
  const [submittingClientId, setSubmittingClientId] = useState<string | number | null>(null);
  const submittingRef = useRef<Record<string | number, boolean>>({});

  // Session Deposits
  const [sessionPaidMap, setSessionPaidMap] = useState<Record<string | number, { amount: number; time: string }>>({});

  // Data Lists
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [unionsList, setUnionsList] = useState<string[]>([]);
  const [transactions, setTransactions] = useState<SavingsTransaction[]>([]);

  // History Pagination
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  // UI Flow States
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Modals
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [selectedTxDetail, setSelectedTxDetail] = useState<SavingsTransaction | null>(null);
  const [copiedTxId, setCopiedTxId] = useState<string | null>(null);

  // Floating Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
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

  const toggleHideBalances = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !hideBalances;
    setHideBalances(next);
    await AsyncStorage.setItem(CACHE_KEYS.PRIVACY, String(next));
  };

  const copyTransactionId = async (txId: string) => {
    if (!txId) return;
    try {
      await Clipboard.setStringAsync(txId);
    } catch {}
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopiedTxId(txId);
    showToast(`Copied ID: #${txId}`);
    setTimeout(() => setCopiedTxId(null), 2000);
  };

  const handleShareReceipt = async (data: any) => {
    try {
      if (Platform.OS !== "web") Haptics.selectionAsync();
      await Share.share({
        message: `Savings Deposit Receipt\nClient: ${data.client_name}\nTransaction ID: #${data.transaction_id}\nAmount: ₦${Number(data.amount || data.amount_collected).toLocaleString()}\nBalance: ₦${Number(data.new_balance || 0).toLocaleString()}\nDate: ${new Date(data.date || Date.now()).toLocaleString()}`,
      });
    } catch {}
  };

  // Portfolio Totals
  const computedPortfolioStats = useMemo(() => {
    let clientTotalSavings = 0;
    let activeSavers = 0;

    clients.forEach((c) => {
      const s = Number(c.savings_balance ?? c.savings ?? c.total_savings ?? 0);
      clientTotalSavings += s;
      if (s > 0) activeSavers += 1;
    });

    return {
      total_savings: clients.length > 0 ? clientTotalSavings : Number(stats.total_savings) || 0,
      active_savers: clients.length > 0 ? activeSavers : Number(stats.active_savers) || 0,
      month_total: Number(stats.month_total) || 0,
    };
  }, [clients, stats]);

  // Union Member Counts
  const unionMemberCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c) => {
      const u = c.union || "Unassigned";
      counts[u] = (counts[u] || 0) + 1;
    });
    return counts;
  }, [clients]);

  // Filter clients by union
  const filteredUnionClients = useMemo(() => {
    return clients.filter((c) => {
      return !selectedUnion || (c.union && c.union.toLowerCase() === selectedUnion.toLowerCase());
    });
  }, [clients, selectedUnion]);

  // Fast O(1) Lookup for Daily Deposits
  const clientTodayDeposits = useMemo(() => {
    const map: Record<string | number, number> = {};

    clients.forEach((c) => {
      const todayAmt = Number(c.today_savings ?? (c as any).today_deposit ?? (c as any).paid_today ?? 0);
      if (todayAmt > 0) {
        map[c.id] = todayAmt;
      }
    });

    Object.entries(sessionPaidMap).forEach(([cid, info]) => {
      map[cid] = Math.max(map[cid] || 0, info.amount);
    });

    return map;
  }, [clients, sessionPaidMap]);

  // Read User Session
  const loadUserSession = useCallback(async () => {
    try {
      const [stored, priv] = await Promise.all([
        AsyncStorage.getItem("cupad_user"),
        AsyncStorage.getItem(CACHE_KEYS.PRIVACY),
      ]);
      if (priv !== null) setHideBalances(priv === "true");
      if (stored) {
        const u = JSON.parse(stored);
        const name = u.username || "";
        if (name) setOfficerUsername(name);
        return name;
      }
    } catch {}
    return "";
  }, []);

  // Fetch Savings Transactions Feed
  const fetchTransactions = useCallback(
    async (pageNum = 1, append = false, userOverride?: string) => {
      const user = userOverride || officerUsername;
      if (!user) return;

      if (!append) {
        setHistoryLoading(true);
      } else {
        setLoadingMoreHistory(true);
      }

      try {
        const res = await axios.get(API_HISTORY, {
          params: { username: user, page: pageNum, limit: 20, type: "saving" },
          timeout: 9000,
        });

        if (res.data?.success && Array.isArray(res.data.data)) {
          const list: SavingsTransaction[] = res.data.data.map((item: any) => ({
            transaction_id: String(
              item.transaction_id ||
              item.reference_id ||
              item.ref ||
              item.id ||
              generateSavingsTxId()
            ),
            client_name: item.client || item.client_name || "Client",
            amount_collected: Number(item.amount ?? item.amount_collected) || 0,
            date: item.date || new Date().toISOString(),
            officer: item.officer || user,
            union: item.union || "",
          }));

          setHasMoreHistory(Boolean(res.data.hasMore) || res.data.data.length >= 20);
          setHistoryPage(pageNum);

          if (append) {
            setTransactions((prev) => [...prev, ...list]);
          } else {
            setTransactions(list);
            AsyncStorage.setItem(CACHE_KEYS.TRANSACTIONS, JSON.stringify(list)).catch(() => {});
          }
        }
      } catch (err) {
        console.log("History fetch failed:", err);
      } finally {
        setHistoryLoading(false);
        setLoadingMoreHistory(false);
      }
    },
    [officerUsername]
  );

  // Load Cached Data Instantly
  const loadCache = useCallback(async () => {
    try {
      const [cStats, cClients, cTx, cSettings] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEYS.STATS),
        AsyncStorage.getItem(CACHE_KEYS.CLIENTS),
        AsyncStorage.getItem(CACHE_KEYS.TRANSACTIONS),
        AsyncStorage.getItem(CACHE_KEYS.SETTINGS),
      ]);
      if (cStats) setStats(JSON.parse(cStats));
      if (cClients) {
        const parsed = JSON.parse(cClients);
        const mappedClients: ClientItem[] = parsed.map((c: any) => ({
          ...c,
          savings_balance: Number(c.savings_balance ?? c.savings ?? c.total_savings ?? 0),
          savings: Number(c.savings ?? c.savings_balance ?? c.total_savings ?? 0),
          total_savings: Number(c.total_savings ?? c.savings_balance ?? c.savings ?? 0),
          loan_balance: Number(c.loan_balance ?? c.outstanding_loan ?? c.loan ?? 0),
          today_savings: Number(c.today_savings ?? c.today_deposit ?? c.paid_today ?? 0),
        }));
        setClients(mappedClients);

        const fromClients = Array.from(new Set(mappedClients.map((c: ClientItem) => c.union).filter(Boolean))) as string[];
        if (fromClients.length > 0) {
          setUnionsList(fromClients);
          setSelectedUnion((prev) => (prev && fromClients.includes(prev) ? prev : fromClients[0]));
        }
      }
      if (cTx) setTransactions(JSON.parse(cTx));
      if (cSettings) {
        const settings = JSON.parse(cSettings);
        if (settings.min_savings_amount !== undefined) setMinSavings(Number(settings.min_savings_amount));
        if (settings.max_savings_amount !== undefined) setMaxSavings(Number(settings.max_savings_amount));
        if (settings.allow_weekend_collection !== undefined) {
          setAllowWeekend(
            settings.allow_weekend_collection === true ||
              settings.allow_weekend_collection === "true" ||
              Number(settings.allow_weekend_collection) === 1
          );
        }
      }
    } catch {}
  }, []);

  // Fetch initial data
  const fetchInitialData = useCallback(async (username: string) => {
    if (!username) return;
    try {
      const res = await axios
        .get(`${API_SAVINGS}?action=init&username=${encodeURIComponent(username)}`, {
          timeout: 10000,
        })
        .catch(() => null);

      if (res?.data?.success) {
        if (res.data.stats) {
          setStats(res.data.stats);
          AsyncStorage.setItem(CACHE_KEYS.STATS, JSON.stringify(res.data.stats)).catch(() => {});
        }
        if (Array.isArray(res.data.clients)) {
          const mappedClients: ClientItem[] = res.data.clients.map((c: any) => ({
            ...c,
            savings_balance: Number(c.savings_balance ?? c.savings ?? c.total_savings ?? 0),
            savings: Number(c.savings ?? c.savings_balance ?? c.total_savings ?? 0),
            total_savings: Number(c.total_savings ?? c.savings_balance ?? c.savings ?? 0),
            loan_balance: Number(c.loan_balance ?? c.outstanding_loan ?? c.loan ?? 0),
            today_savings: Number(c.today_savings ?? c.today_deposit ?? c.paid_today ?? 0),
          }));
          setClients(mappedClients);

          const fromClients = Array.from(new Set(mappedClients.map((c: any) => c.union).filter(Boolean))) as string[];
          const fromInit = Array.isArray(res.data.unions)
            ? res.data.unions.map((u: any) => (typeof u === "string" ? u : u?.name)).filter(Boolean)
            : [];

          let fromApi: string[] = [];
          if (fromInit.length === 0 && fromClients.length === 0) {
            try {
              const uf = await fetchUnionsForOfficer(username);
              fromApi = uf.names || [];
            } catch {}
          }

          const u = mergeUnionNames(fromApi, fromInit, fromClients);
          setUnionsList(u);
          if (u.length > 0) {
            setSelectedUnion((prev) => (prev && u.includes(prev) ? prev : u[0]));
          }

          AsyncStorage.setItem(CACHE_KEYS.CLIENTS, JSON.stringify(mappedClients)).catch(() => {});
          cacheClients(mappedClients, username).catch(() => {});
        }
        if (res.data.settings) {
          if (res.data.settings.min_savings_amount !== undefined) {
            setMinSavings(Number(res.data.settings.min_savings_amount));
          }
          if (res.data.settings.max_savings_amount !== undefined) {
            setMaxSavings(Number(res.data.settings.max_savings_amount));
          }
          if (res.data.settings.allow_weekend_collection !== undefined) {
            setAllowWeekend(
              res.data.settings.allow_weekend_collection === true ||
                res.data.settings.allow_weekend_collection === "true" ||
                Number(res.data.settings.allow_weekend_collection) === 1
            );
          }
          AsyncStorage.setItem(CACHE_KEYS.SETTINGS, JSON.stringify(res.data.settings)).catch((error) =>
            console.warn("Could not cache savings settings:", error)
          );
        }
      } else {
        try {
          const ws = await loadOfflineWorkspace(username);
          if (ws.clients.length > 0) {
            const mappedClients: ClientItem[] = ws.clients.map((c: any) => ({
              ...c,
              savings_balance: Number(c.savings_balance ?? c.savings ?? c.total_savings ?? 0),
              savings: Number(c.savings ?? c.savings_balance ?? c.total_savings ?? 0),
              total_savings: Number(c.total_savings ?? c.savings_balance ?? c.savings ?? 0),
              loan_balance: Number(c.loan_balance ?? c.outstanding_loan ?? c.loan ?? 0),
              today_savings: Number(c.today_savings ?? c.today_deposit ?? c.paid_today ?? 0),
            }));
            setClients(mappedClients);
            const u = ws.unionNames.length
              ? ws.unionNames
              : (Array.from(new Set(mappedClients.map((c) => c.union).filter(Boolean))) as string[]);
            setUnionsList(u);
            if (u.length > 0) {
              setSelectedUnion((prev) => (prev && u.includes(prev) ? prev : u[0]));
            }
          }
        } catch {}
      }
    } catch (err) {
      console.log("Initial fetch error:", err);
    }
  }, []);

  const loadAll = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      const user = await loadUserSession();
      if (user) {
        await Promise.all([fetchInitialData(user), fetchTransactions(1, false, user)]);
      }
      setLoading(false);
      setRefreshing(false);
    },
    [loadUserSession, fetchInitialData, fetchTransactions]
  );

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    loadCache();
    loadAll(true);
  }, [loadCache, loadAll, fadeAnim]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadAll(false);
  }, [loadAll]);

  const handleAmountChange = (clientId: string | number, text: string) => {
    const cleaned = text.replace(/[^0-9]/g, "");
    setClientAmounts((prev) => ({ ...prev, [clientId]: cleaned }));
  };

  const handleQuickPreset = (clientId: string | number, addVal: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const curr = Number(clientAmounts[clientId]) || 0;
    setClientAmounts((prev) => ({ ...prev, [clientId]: String(curr + addVal) }));
  };

  // Perform Savings Deposit
  const handleDepositForClient = async (client: ClientItem) => {
    if (submittingRef.current[client.id]) return;

    const valStr = clientAmounts[client.id] || "";
    const depositAmt = Number(valStr);

    if (!depositAmt || depositAmt < minSavings) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Invalid Amount", `Please enter at least ${formatNaira(minSavings)} for ${client.name}.`);
      return;
    }

    if (depositAmt > maxSavings) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Limit Exceeded", `Maximum deposit allowed is ${formatNaira(maxSavings)}.`);
      return;
    }

    if (!allowWeekend && isWeekend()) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Weekend Disabled", "Savings collections are restricted on weekends by management policy.");
      return;
    }

    submittingRef.current[client.id] = true;
    setSubmittingClientId(client.id);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const now = new Date();
    const formattedDate = now.toISOString().slice(0, 19).replace("T", " ");
    
    // Always generate full UUID format
    const masterTxId = generateSavingsTxId();

    const payload = {
      action: "record_savings",
      client_id: client.id,
      amount: depositAmt,
      date: formattedDate,
      officer: officerUsername,
      transaction_id: masterTxId,
      reference_id: masterTxId,
    };

    try {
      const res = await axios.post(API_SAVINGS, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 10000,
      });

      if (res.data?.success) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        const currentBal = Number(client.savings_balance ?? client.savings ?? client.total_savings ?? 0);
        const newBal = Number(res.data.new_balance) || currentBal + depositAmt;

        // FIXED: Protect the full UUID. If the server returns a short ID, preserve our generated masterTxId.
        const serverTxId = res.data.transaction_id || res.data.reference_id;
        const resolvedId = (serverTxId && String(serverTxId).length >= 20) 
          ? String(serverTxId) 
          : masterTxId;

        const updatedClients = clients.map((c) =>
          c.id === client.id
            ? {
                ...c,
                savings_balance: newBal,
                savings: newBal,
                total_savings: newBal,
                today_savings: (Number(c.today_savings) || 0) + depositAmt,
              }
            : c
        );

        setClients(updatedClients);
        AsyncStorage.setItem(CACHE_KEYS.CLIENTS, JSON.stringify(updatedClients)).catch(() => {});

        setSessionPaidMap((prev) => ({
          ...prev,
          [client.id]: {
            amount: (prev[client.id]?.amount || 0) + depositAmt,
            time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        }));

        setClientAmounts((prev) => ({ ...prev, [client.id]: "" }));

        setStats((prev) => ({
          ...prev,
          total_savings: prev.total_savings + depositAmt,
          month_total: prev.month_total + depositAmt,
        }));

        setReceiptData({
          client_name: client.name,
          amount: depositAmt,
          new_balance: newBal,
          union: client.union || selectedUnion,
          transaction_id: resolvedId,
          date: formattedDate,
          is_offline: false,
        });
        setShowReceiptModal(true);
        fetchTransactions(1, false, undefined);
      } else {
        Alert.alert("Deposit Failed", res.data?.message || res.data?.error || "Could not record savings.");
      }
    } catch {
      // Offline fallback
      try {
        await saveSavingsOffline({
          tempId: masterTxId,
          clientId: client.id,
          clientName: client.name,
          amount: Number(depositAmt),
          date: formattedDate,
          officer: officerUsername,
          union: client.union || selectedUnion,
        });

        const currentBal = Number(client.savings_balance ?? client.savings ?? client.total_savings ?? 0);
        const newBal = currentBal + depositAmt;

        const updatedClients = clients.map((c) =>
          c.id === client.id
            ? {
                ...c,
                savings_balance: newBal,
                savings: newBal,
                total_savings: newBal,
                today_savings: (Number(c.today_savings) || 0) + depositAmt,
              }
            : c
        );

        setClients(updatedClients);
        AsyncStorage.setItem(CACHE_KEYS.CLIENTS, JSON.stringify(updatedClients)).catch(() => {});
        cacheClients(updatedClients, officerUsername).catch(() => {});

        setSessionPaidMap((prev) => ({
          ...prev,
          [client.id]: {
            amount: (prev[client.id]?.amount || 0) + depositAmt,
            time: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          },
        }));

        setClientAmounts((prev) => ({ ...prev, [client.id]: "" }));

        const offlineTx: SavingsTransaction = {
          transaction_id: masterTxId,
          client_name: client.name,
          amount_collected: depositAmt,
          date: formattedDate,
          officer: officerUsername,
          union: client.union || selectedUnion,
        };
        setTransactions((prev) => [offlineTx, ...prev]);

        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);

        setReceiptData({
          client_name: client.name,
          amount: depositAmt,
          new_balance: newBal,
          union: client.union || selectedUnion,
          transaction_id: masterTxId,
          date: formattedDate,
          is_offline: true,
        });
        setShowReceiptModal(true);
      } catch (err) {
        Alert.alert("Error", "Could not complete offline save.");
      }
    } finally {
      submittingRef.current[client.id] = false;
      setSubmittingClientId(null);
    }
  };

  const handleLoadMoreHistory = () => {
    if (!loadingMoreHistory && hasMoreHistory) {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      fetchTransactions(historyPage + 1, true);
    }
  };

  return (
    <CoScreenWrapper>
      {/* BACKGROUND ORBS */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={260} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={height * 0.45} delay={2000} />
      </View>

      {/* FLOATING ACTION TOAST */}
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

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.container}>
          <Animated.ScrollView
            style={{ flex: 1, opacity: fadeAnim }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={EMERALD_ACCENT} />}
          >
            {/* HERO CARD */}
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
                <View style={[styles.heroTagPill, { backgroundColor: "rgba(16, 185, 129, 0.15)" }]}>
                  <View style={[styles.statusPulseDot, { backgroundColor: EMERALD_ACCENT }]} />
                  <Text style={[styles.heroTagText, { color: EMERALD_ACCENT }]}>SAVINGS TERMINAL</Text>
                </View>

                <View
                  style={[
                    styles.syncTimePill,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)" },
                  ]}
                >
                  <Ionicons name="shield-checkmark-outline" size={12} color={colors.textMuted} />
                  <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>Verified Ledger</Text>
                </View>
              </View>

              <View style={styles.heroMainBalanceSection}>
                <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                  TOTAL SAVINGS PORTFOLIO
                </Text>
                <View style={styles.heroAmountRow}>
                  <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                    {formatNaira(computedPortfolioStats.total_savings, hideBalances)}
                  </Text>
                  <Pressable
                    onPress={toggleHideBalances}
                    hitSlop={12}
                    style={[
                      styles.eyeInlineBtn,
                      { backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(0, 0, 0, 0.05)" },
                    ]}
                  >
                    <Ionicons
                      name={hideBalances ? "eye-off" : "eye"}
                      size={16}
                      color={colors.text}
                    />
                  </Pressable>
                </View>
              </View>

              {/* Metrics Grid */}
              <View style={styles.heroMetricsGrid}>
                <View
                  style={[
                    styles.metricGridItem,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                  ]}
                >
                  <View style={styles.metricItemHeader}>
                    <Ionicons name="sparkles" size={11} color="#10B981" />
                    <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>This Month</Text>
                  </View>
                  <Text style={[styles.metricItemValue, { color: "#10B981" }]}>
                    {formatNaira(computedPortfolioStats.month_total, hideBalances)}
                  </Text>
                </View>

                <View
                  style={[
                    styles.metricGridItem,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                  ]}
                >
                  <View style={styles.metricItemHeader}>
                    <Ionicons name="people" size={11} color="#3B82F6" />
                    <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Savers</Text>
                  </View>
                  <Text style={[styles.metricItemValue, { color: colors.text }]}>
                    {computedPortfolioStats.active_savers}
                  </Text>
                  <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>active clients</Text>
                </View>

                <View
                  style={[
                    styles.metricGridItem,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                  ]}
                >
                  <View style={styles.metricItemHeader}>
                    <Ionicons name="receipt" size={11} color="#8B5CF6" />
                    <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Collections</Text>
                  </View>
                  <Text style={[styles.metricItemValue, { color: colors.text }]}>
                    {transactions.length}
                  </Text>
                  <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>logged</Text>
                </View>
              </View>
            </LinearGradient>

            {/* UNION HORIZONTAL SELECTOR STRIP */}
            {loading && unionsList.length === 0 ? (
              <UnionStripSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
            ) : unionsList.length > 0 ? (
              <View style={styles.unionFilterSection}>
                <View style={styles.unionHeaderRow}>
                  <View>
                    <Text style={[styles.sectionTitle, { color: colors.text }]}>Union Groups</Text>
                    <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Target group collection</Text>
                  </View>
                  <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                    <Text style={[styles.badgeCountText, { color: colors.textMuted }]}>
                      {unionsList.length}
                    </Text>
                  </View>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unionChipScroll}>
                  {unionsList.map((u) => {
                    const isSel = selectedUnion === u;
                    const memberCount = unionMemberCounts[u] || 0;
                    return (
                      <Pressable
                        key={u}
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.selectionAsync();
                          setSelectedUnion(u);
                        }}
                        style={({ pressed }) => [
                          styles.unionChip,
                          {
                            backgroundColor: isSel ? EMERALD_ACCENT : cardSurfaceBg,
                            borderColor: isSel ? EMERALD_ACCENT : glassBorder,
                            transform: [{ scale: pressed ? 0.96 : 1 }],
                          },
                        ]}
                      >
                        <Ionicons
                          name="people-outline"
                          size={14}
                          color={isSel ? "#FFFFFF" : colors.textMuted}
                        />
                        <Text style={[styles.unionChipText, { color: isSel ? "#FFFFFF" : colors.text }]}>
                          {u}
                        </Text>
                        <View
                          style={[
                            styles.unionCountBadge,
                            {
                              backgroundColor: isSel
                                ? "rgba(255, 255, 255, 0.28)"
                                : isDark
                                ? "rgba(255, 255, 255, 0.08)"
                                : "rgba(0, 0, 0, 0.06)",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.unionCountBadgeText,
                              { color: isSel ? "#FFFFFF" : colors.textMuted },
                            ]}
                          >
                            {memberCount}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>
            ) : null}

            {/* CLIENT CARDS SECTION */}
            <View style={styles.clientCardsSection}>
              <View style={styles.clientCardsHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {selectedUnion ? `${selectedUnion} Collection Sheet` : "Collection Sheet"}
                  </Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                    Instant field deposit & balance credits
                  </Text>
                </View>
                {!loading && (
                  <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                    <Text style={[styles.badgeCountText, { color: EMERALD_ACCENT }]}>
                      {filteredUnionClients.length} Members
                    </Text>
                  </View>
                )}
              </View>

              {loading && clients.length === 0 ? (
                <View style={styles.cardsGrid}>
                  <ClientCardSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <ClientCardSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <ClientCardSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                </View>
              ) : filteredUnionClients.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                    <Ionicons name="people-outline" size={26} color={colors.textMuted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No clients found</Text>
                  <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                    No active clients registered in this union
                  </Text>
                </View>
              ) : (
                <View style={styles.cardsGrid}>
                  {filteredUnionClients.map((client) => {
                    const cSavings = Number(client.savings_balance ?? client.savings ?? client.total_savings ?? 0);
                    const cLoan = Number(client.loan_balance ?? client.outstanding_loan ?? 0);
                    const cCoverage = cLoan > 0 ? Math.min(100, Math.round((cSavings / cLoan) * 100)) : 100;
                    const currAmount = clientAmounts[client.id] || "";
                    const isSubmitting = submittingClientId === client.id;
                    const todayDepositAmt = clientTodayDeposits[client.id] || 0;
                    const hasDepositedToday = todayDepositAmt > 0;

                    return (
                      <View
                        key={client.id}
                        style={[
                          styles.clientCard,
                          {
                            backgroundColor: cardSurfaceBg,
                            borderColor: hasDepositedToday ? "rgba(16, 185, 129, 0.35)" : glassBorder,
                          },
                        ]}
                      >
                        {/* CARD HEADER */}
                        <View style={styles.clientCardTop}>
                          <View
                            style={[
                              styles.clientAvatar,
                              { backgroundColor: hasDepositedToday ? EMERALD_ACCENT : isDark ? "rgba(16, 185, 129, 0.2)" : "rgba(16, 185, 129, 0.12)" },
                            ]}
                          >
                            <Text
                              style={[
                                styles.clientAvatarText,
                                { color: hasDepositedToday ? "#FFFFFF" : EMERALD_ACCENT },
                              ]}
                            >
                              {client.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>

                          <View style={{ flex: 1, marginHorizontal: 10 }}>
                            <Text style={[styles.clientCardName, { color: colors.text }]} numberOfLines={1}>
                              {client.name}
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                              <Text style={[styles.clientCardPhone, { color: colors.textMuted }]} numberOfLines={1}>
                                {client.phone || "No phone"}
                              </Text>
                              {client.union && (
                                <Text style={[styles.clientUnionTag, { color: colors.textMuted }]} numberOfLines={1}>
                                  • {client.union}
                                </Text>
                              )}
                            </View>
                          </View>

                          {/* STATUS BADGE */}
                          {hasDepositedToday ? (
                            <View style={styles.paidBadge}>
                              <Ionicons name="checkmark-circle" size={11} color="#059669" />
                              <Text style={styles.paidBadgeText}>Paid Today</Text>
                            </View>
                          ) : (
                            <View style={styles.pendingBadge}>
                              <Text style={styles.pendingBadgeText}>Pending</Text>
                            </View>
                          )}
                        </View>

                        {/* FINANCIAL METRICS ROW */}
                        <View
                          style={[
                            styles.clientCardMetrics,
                            {
                              backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(241, 245, 249, 0.65)",
                              borderColor: glassBorder,
                            },
                          ]}
                        >
                          <View style={styles.metricItem}>
                            <Text style={styles.metricLabel}>PAID TODAY</Text>
                            <Text style={[styles.metricVal, { color: hasDepositedToday ? "#10B981" : colors.textMuted }]}>
                              {formatNaira(todayDepositAmt, hideBalances)}
                            </Text>
                          </View>

                          <View style={[styles.metricDivider, { backgroundColor: glassBorder }]} />

                          <View style={styles.metricItem}>
                            <Text style={styles.metricLabel}>SAVINGS BALANCE</Text>
                            <Text style={[styles.metricVal, { color: colors.text }]}>
                              {formatNaira(cSavings, hideBalances)}
                            </Text>
                          </View>

                          <View style={[styles.metricDivider, { backgroundColor: glassBorder }]} />

                          <View style={styles.metricItem}>
                            <Text style={styles.metricLabel}>OUTSTANDING LOAN</Text>
                            <Text style={[styles.metricVal, { color: cLoan > 0 ? "#EF4444" : colors.textMuted }]}>
                              {formatNaira(cLoan, hideBalances)}
                            </Text>
                          </View>

                          {cLoan > 0 && (
                            <>
                              <View style={[styles.metricDivider, { backgroundColor: glassBorder }]} />
                              <View style={styles.metricItem}>
                                <Text style={styles.metricLabel}>COVERAGE</Text>
                                <Text style={[styles.metricVal, { color: cCoverage >= 100 ? "#10B981" : "#F59E0B" }]}>
                                  {cCoverage}%
                                </Text>
                              </View>
                            </>
                          )}
                        </View>

                        {/* DEPOSIT ACTION DRAWER */}
                        <View style={styles.depositBox}>
                          <View style={styles.depositInputRow}>
                            <View style={[styles.cardInputWrap, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                              <Text style={styles.nairaPrefix}>₦</Text>
                              <TextInput
                                value={currAmount}
                                onChangeText={(val) => handleAmountChange(client.id, val)}
                                placeholder="Enter amount..."
                                placeholderTextColor={colors.textMuted}
                                keyboardType="numeric"
                                style={[styles.cardInputField, { color: colors.text }]}
                              />
                              {currAmount.length > 0 && (
                                <Pressable onPress={() => handleAmountChange(client.id, "")} hitSlop={6}>
                                  <Ionicons name="close-circle" size={17} color={colors.textMuted} />
                                </Pressable>
                              )}
                            </View>

                            <Pressable
                              onPress={() => handleDepositForClient(client)}
                              disabled={isSubmitting || !currAmount}
                              style={({ pressed }) => [
                                styles.cardSubmitBtn,
                                {
                                  backgroundColor: EMERALD_ACCENT,
                                  opacity: isSubmitting || !currAmount ? 0.45 : pressed ? 0.88 : 1,
                                  transform: [{ scale: pressed ? 0.98 : 1 }],
                                },
                              ]}
                            >
                              {isSubmitting ? (
                                <ActivityIndicator size="small" color="#fff" />
                              ) : (
                                <>
                                  <Ionicons name="arrow-down-circle" size={16} color="#fff" />
                                  <Text style={styles.cardSubmitBtnText}>Deposit</Text>
                                </>
                              )}
                            </Pressable>
                          </View>

                          {/* QUICK PRESETS ROW */}
                          <View style={styles.presetsRow}>
                            {QUICK_AMOUNTS.map((amt) => (
                              <Pressable
                                key={amt}
                                onPress={() => handleQuickPreset(client.id, amt)}
                                style={({ pressed }) => [
                                  styles.cardPresetChip,
                                  {
                                    backgroundColor: cardSurfaceBg,
                                    borderColor: glassBorder,
                                    transform: [{ scale: pressed ? 0.94 : 1 }],
                                  },
                                ]}
                              >
                                <Text style={[styles.cardPresetChipText, { color: colors.text }]}>
                                  +{amt >= 1000 ? `${amt / 1000}k` : amt}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* RECENT COLLECTIONS SECTION */}
            <View style={styles.historySection}>
              <View style={styles.historyHeader}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Collections</Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                    Verified savings deposit ledger
                  </Text>
                </View>
              </View>

              {historyLoading ? (
                <View style={{ gap: 8 }}>
                  <HistorySkeletonItem isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <HistorySkeletonItem isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <HistorySkeletonItem isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                </View>
              ) : transactions.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                    <Ionicons name="receipt-outline" size={26} color={colors.textMuted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No savings records found</Text>
                  <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                    Completed deposits will appear here
                  </Text>
                </View>
              ) : (
                <>
                  {transactions.map((tx, idx) => {
                    const isCopied = copiedTxId === tx.transaction_id;

                    return (
                      <Pressable
                        key={`${tx.transaction_id}-${idx}`}
                        onPress={() => setSelectedTxDetail(tx)}
                        style={({ pressed }) => [
                          styles.txCard,
                          {
                            backgroundColor: cardSurfaceBg,
                            borderColor: isCopied ? "rgba(16, 185, 129, 0.5)" : glassBorder,
                            transform: [{ scale: pressed ? 0.98 : 1 }],
                          },
                        ]}
                      >
                        <View style={[styles.txIconBox, { backgroundColor: "rgba(16, 185, 129, 0.12)" }]}>
                          <Ionicons name="wallet" size={18} color="#10B981" />
                        </View>

                        <View style={{ flex: 1, marginHorizontal: 12 }}>
                          <Text style={[styles.txClientName, { color: colors.text }]} numberOfLines={1}>
                            {tx.client_name}
                          </Text>

                          <View style={styles.txMetaRow}>
                            {/* TRANSACTION ID CHIP WITH COPY ICON IN BACKGROUND */}
                            <Pressable
                              onPress={(e) => {
                                e.stopPropagation();
                                copyTransactionId(tx.transaction_id);
                              }}
                              hitSlop={6}
                              style={({ pressed }) => [
                                styles.miniTxChip,
                                {
                                  backgroundColor: isCopied
                                    ? "rgba(16, 185, 129, 0.15)"
                                    : isDark
                                    ? "rgba(255,255,255,0.06)"
                                    : "rgba(0,0,0,0.04)",
                                  borderColor: isCopied ? "#10B981" : glassBorder,
                                  opacity: pressed ? 0.75 : 1,
                                },
                              ]}
                            >
                              <Text
                                style={[
                                  styles.miniTxText,
                                  { color: isCopied ? "#10B981" : colors.textMuted },
                                ]}
                                numberOfLines={1}
                              >
                                #{tx.transaction_id}
                              </Text>

                              <View
                                style={[
                                  styles.miniTxCopyBadge,
                                  {
                                    backgroundColor: isCopied
                                      ? "rgba(16, 185, 129, 0.25)"
                                      : isDark
                                      ? "rgba(255, 255, 255, 0.1)"
                                      : "rgba(0, 0, 0, 0.07)",
                                  },
                                ]}
                              >
                                <Ionicons
                                  name={isCopied ? "checkmark" : "copy-outline"}
                                  size={10.5}
                                  color={isCopied ? "#10B981" : colors.textMuted}
                                />
                              </View>
                            </Pressable>

                            {tx.union ? (
                              <Text style={[styles.txUnionTag, { color: colors.textMuted }]}>
                                • {tx.union}
                              </Text>
                            ) : null}
                          </View>
                        </View>

                        <View style={{ alignItems: "flex-end" }}>
                          <Text style={styles.txAmount}>{formatNaira(tx.amount_collected, hideBalances)}</Text>
                          <Text style={[styles.txDate, { color: colors.textMuted }]}>
                            {formatTxDate(tx.date)}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}

                  {/* LOAD MORE BUTTON */}
                  {hasMoreHistory && (
                    <Pressable
                      onPress={handleLoadMoreHistory}
                      disabled={loadingMoreHistory}
                      style={({ pressed }) => [
                        styles.loadMoreBtn,
                        {
                          backgroundColor: cardSurfaceBg,
                          borderColor: glassBorder,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      {loadingMoreHistory ? (
                        <ActivityIndicator size="small" color={EMERALD_ACCENT} />
                      ) : (
                        <>
                          <Text style={[styles.loadMoreText, { color: colors.text }]}>Load More Collections</Text>
                          <Ionicons name="chevron-down" size={15} color={colors.text} />
                        </>
                      )}
                    </Pressable>
                  )}
                </>
              )}
            </View>
          </Animated.ScrollView>
        </View>

        {/* MODAL: TRANSACTION DETAIL */}
        <Modal
          visible={Boolean(selectedTxDetail)}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedTxDetail(null)}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedTxDetail(null)} />
            <View style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.modalHandle} />
              <View style={styles.receiptTop}>
                <View style={[styles.receiptCheckCircle, { backgroundColor: "rgba(16, 185, 129, 0.12)" }]}>
                  <Ionicons name="receipt" size={26} color="#10B981" />
                </View>
                <Text style={[styles.receiptTitle, { color: colors.text }]}>Collection Record</Text>
                <Text style={[styles.receiptSub, { color: colors.textMuted }]}>
                  Confirmed deposit in server ledger
                </Text>
              </View>

              {selectedTxDetail && (
                <View style={[styles.receiptSlip, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Client Name</Text>
                    <Text style={[styles.receiptVal, { color: colors.text }]}>{selectedTxDetail.client_name}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Union / Group</Text>
                    <Text style={[styles.receiptVal, { color: colors.text }]}>{selectedTxDetail.union || "Unassigned"}</Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Amount Collected</Text>
                    <Text style={[styles.receiptVal, { color: "#10B981", fontWeight: "900", fontSize: 16 }]}>
                      {formatNaira(selectedTxDetail.amount_collected)}
                    </Text>
                  </View>
                  <View style={styles.receiptRow}>
                    <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Date & Time</Text>
                    <Text style={[styles.receiptVal, { color: colors.text }]}>
                      {new Date(selectedTxDetail.date).toLocaleString("en-NG", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </Text>
                  </View>
                  <View style={[styles.receiptRow, { flexDirection: "column", alignItems: "flex-start", gap: 5 }]}>
                    <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Transaction ID</Text>
                    <Pressable
                      onPress={() => copyTransactionId(selectedTxDetail.transaction_id)}
                      hitSlop={8}
                      style={[
                        styles.modalTxChip,
                        {
                          backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                          borderColor: glassBorder,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.receiptVal,
                          {
                            color: "#3B82F6",
                            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                            fontSize: 11,
                            flex: 1,
                          },
                        ]}
                        numberOfLines={1}
                      >
                        #{selectedTxDetail.transaction_id}
                      </Text>
                      <View
                        style={[
                          styles.modalTxCopyBadge,
                          {
                            backgroundColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(59,130,246,0.12)",
                          },
                        ]}
                      >
                        <Ionicons name="copy-outline" size={13} color="#3B82F6" />
                      </View>
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.modalButtonsRow}>
                <Pressable
                  onPress={() => selectedTxDetail && handleShareReceipt(selectedTxDetail)}
                  style={[styles.modalSecondaryBtn, { borderColor: glassBorder }]}
                >
                  <Ionicons name="share-social-outline" size={17} color={colors.text} />
                  <Text style={[styles.modalSecondaryText, { color: colors.text }]}>Share</Text>
                </Pressable>

                <Pressable
                  onPress={() => setSelectedTxDetail(null)}
                  style={[styles.modalPrimaryBtn, { backgroundColor: EMERALD_ACCENT }]}
                >
                  <Text style={styles.receiptCloseBtnText}>Done</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* MODAL: DIGITAL DEPOSIT RECEIPT */}
        <Modal visible={showReceiptModal} transparent animationType="fade" onRequestClose={() => setShowReceiptModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.receiptCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.modalHandle} />
              <View style={styles.receiptTop}>
                <View style={[styles.receiptCheckCircle, { backgroundColor: receiptData?.is_offline ? "rgba(217, 119, 6, 0.15)" : "rgba(16, 185, 129, 0.15)" }]}>
                  <Ionicons
                    name={receiptData?.is_offline ? "cloud-offline" : "checkmark-done"}
                    size={28}
                    color={receiptData?.is_offline ? "#D97706" : "#10B981"}
                  />
                </View>
                <Text style={[styles.receiptTitle, { color: colors.text }]}>
                  {receiptData?.is_offline ? "Saved Offline" : "Savings Deposited!"}
                </Text>
                <Text style={[styles.receiptSub, { color: colors.textMuted }]}>
                  {receiptData?.is_offline
                    ? "Recorded locally on your device. Will automatically sync once online."
                    : "Deposit confirmed and credited to client ledger."}
                </Text>
              </View>

              <View style={[styles.receiptSlip, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                <View style={styles.receiptRow}>
                  <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Client Name</Text>
                  <Text style={[styles.receiptVal, { color: colors.text }]}>{receiptData?.client_name}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Union</Text>
                  <Text style={[styles.receiptVal, { color: colors.text }]}>{receiptData?.union}</Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Amount Deposited</Text>
                  <Text style={[styles.receiptVal, { color: "#10B981", fontWeight: "900", fontSize: 16 }]}>
                    {formatNaira(receiptData?.amount || 0)}
                  </Text>
                </View>
                <View style={styles.receiptRow}>
                  <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>New Savings Total</Text>
                  <Text style={[styles.receiptVal, { color: colors.text, fontWeight: "800" }]}>
                    {formatNaira(receiptData?.new_balance || 0)}
                  </Text>
                </View>
                <View style={[styles.receiptRow, { flexDirection: "column", alignItems: "flex-start", gap: 5 }]}>
                  <Text style={[styles.receiptLabel, { color: colors.textMuted }]}>Transaction ID</Text>
                  <Pressable
                    onPress={() => copyTransactionId(receiptData?.transaction_id)}
                    hitSlop={8}
                    style={[
                      styles.modalTxChip,
                      {
                        backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
                        borderColor: glassBorder,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.receiptVal,
                        {
                          color: colors.textMuted,
                          fontSize: 11,
                          fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
                          flex: 1,
                        },
                      ]}
                      numberOfLines={1}
                    >
                      #{receiptData?.transaction_id}
                    </Text>
                    <View
                      style={[
                        styles.modalTxCopyBadge,
                        {
                          backgroundColor: isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.06)",
                        },
                      ]}
                    >
                      <Ionicons name="copy-outline" size={13} color={colors.textMuted} />
                    </View>
                  </Pressable>
                </View>
              </View>

              <View style={styles.modalButtonsRow}>
                <Pressable
                  onPress={() => receiptData && handleShareReceipt(receiptData)}
                  style={[styles.modalSecondaryBtn, { borderColor: glassBorder }]}
                >
                  <Ionicons name="share-social-outline" size={17} color={colors.text} />
                  <Text style={[styles.modalSecondaryText, { color: colors.text }]}>Share</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowReceiptModal(false);
                  }}
                  style={[styles.modalPrimaryBtn, { backgroundColor: EMERALD_ACCENT }]}
                >
                  <Text style={styles.receiptCloseBtnText}>Continue</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 60, paddingTop: 6 },

  /* HERO CARD */
  heroCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 16,
  },
  heroHeaderBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  heroTagPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 5,
  },
  statusPulseDot: { width: 6, height: 6, borderRadius: 3 },
  heroTagText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  syncTimePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  syncTimeText: { fontSize: 10, fontWeight: "600" },

  heroMainBalanceSection: {
    marginTop: 12,
    marginBottom: 12,
  },
  heroBalanceLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.1,
  },
  heroAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  heroMainAmount: {
    fontSize: 27,
    fontWeight: "900",
    letterSpacing: -0.6,
  },
  eyeInlineBtn: {
    padding: 6,
    borderRadius: 10,
  },

  heroMetricsGrid: {
    flexDirection: "row",
    gap: 8,
    paddingTop: 4,
  },
  metricGridItem: {
    flex: 1,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  metricItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  metricItemLabel: {
    fontSize: 9.5,
    fontWeight: "600",
  },
  metricItemValue: {
    fontSize: 13.5,
    fontWeight: "800",
    marginTop: 3,
  },
  metricItemSub: {
    fontSize: 9,
    marginTop: 1,
    fontWeight: "500",
  },

  /* SECTION HEADERS */
  sectionTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  badgeCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeCountText: { fontSize: 11, fontWeight: "700" },

  unionFilterSection: { marginBottom: 18 },
  unionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  unionChipScroll: { paddingHorizontal: 16, gap: 8 },
  unionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  unionChipText: { fontSize: 12, fontWeight: "700" },
  unionCountBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    minWidth: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  unionCountBadgeText: { fontSize: 10, fontWeight: "800" },

  clientCardsSection: { paddingHorizontal: 16, marginBottom: 20 },
  clientCardsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  cardsGrid: { gap: 12 },

  clientCard: {
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  clientCardTop: {
    flexDirection: "row",
    alignItems: "center",
  },
  clientAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  clientAvatarText: {
    fontSize: 15,
    fontWeight: "800",
  },
  clientCardName: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.2,
  },
  clientCardPhone: {
    fontSize: 11,
    fontWeight: "500",
  },
  clientUnionTag: {
    fontSize: 11,
    fontWeight: "600",
  },
  paidBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  paidBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#15803D",
  },
  pendingBadge: {
    backgroundColor: "rgba(148,163,184,0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: "700",
    color: "#64748B",
  },

  clientCardMetrics: {
    flexDirection: "row",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderWidth: 1,
    alignItems: "center",
  },
  metricItem: {
    flex: 1,
    alignItems: "center",
  },
  metricLabel: {
    fontSize: 8,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 0.4,
  },
  metricVal: {
    fontSize: 11.5,
    fontWeight: "800",
    marginTop: 2,
  },
  metricDivider: {
    width: 1,
    height: 18,
  },

  depositBox: {
    gap: 8,
  },
  depositInputRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  cardInputWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    height: 42,
    borderRadius: 11,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  nairaPrefix: {
    fontSize: 15,
    fontWeight: "800",
    color: "#10B981",
    marginRight: 4,
  },
  cardInputField: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
    height: "100%",
  },
  cardSubmitBtn: {
    height: 42,
    paddingHorizontal: 16,
    borderRadius: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  cardSubmitBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "800",
  },

  presetsRow: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
  },
  cardPresetChip: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cardPresetChipText: {
    fontSize: 11,
    fontWeight: "800",
  },

  /* HISTORY */
  historySection: {
    paddingHorizontal: 16,
  },
  historyHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  txCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  txIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  txClientName: {
    fontSize: 13.5,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  txMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 4,
  },
  miniTxChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingLeft: 7,
    paddingRight: 4,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    maxWidth: 220,
  },
  miniTxText: {
    fontSize: 9.5,
    fontWeight: "700",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    flexShrink: 1,
  },
  miniTxCopyBadge: {
    width: 17,
    height: 17,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  txUnionTag: {
    fontSize: 10.5,
    fontWeight: "500",
  },
  txDate: {
    fontSize: 10,
    fontWeight: "500",
    marginTop: 2,
  },
  txAmount: {
    fontSize: 13.5,
    fontWeight: "900",
    color: "#10B981",
  },

  loadMoreBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 6,
    marginBottom: 14,
  },
  loadMoreText: {
    fontSize: 12.5,
    fontWeight: "700",
  },

  emptyCard: {
    padding: 26,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    gap: 6,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  emptySub: {
    fontSize: 11.5,
    textAlign: "center",
  },

  toastBox: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 36,
    alignSelf: "center",
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    zIndex: 9999,
    maxWidth: "88%",
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  toastText: {
    fontSize: 12,
    fontWeight: "700",
  },

  /* MODALS */
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 14,
  },
  receiptCard: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
  },
  receiptTop: {
    alignItems: "center",
    marginBottom: 14,
  },
  receiptCheckCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  receiptTitle: {
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 3,
  },
  receiptSub: {
    fontSize: 11.5,
    textAlign: "center",
  },
  receiptSlip: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginBottom: 16,
  },
  receiptRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  receiptLabel: {
    fontSize: 11.5,
    fontWeight: "600",
  },
  receiptVal: {
    fontSize: 12.5,
    fontWeight: "700",
  },
  modalTxChip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    paddingLeft: 10,
    paddingRight: 6,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  modalTxCopyBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },

  modalButtonsRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  modalSecondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: "700",
  },
  modalPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptCloseBtnText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
});