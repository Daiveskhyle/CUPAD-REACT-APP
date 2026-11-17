// app/co/repayment.tsx
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
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

import {
  cacheRepaymentDataLocally,
  saveRepaymentOffline,
  processRepaymentPendingSync,
  getPendingRepaymentsCount,
  loadCachedRepayments,
  clearStuckPendingRepayments,
  isOnline,
  autoSyncIfOnline,
  cacheClients,
  cacheUnions,
} from "../../src/db/database";
import {
  fetchUnionsForOfficer,
  mergeUnionNames,
  bootstrapCoScreenData,
} from "../../src/db/offlineHelpers";
import { hydrateOfflineCache } from "../../src/db/sync";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_REPAYMENT = `${API_BASE}/api/loan_collection_api.php`;

const CACHE_KEYS = {
  STATS: "cupad_cache_repay_stats",
  CLIENTS: "cupad_cache_repay_clients",
  DISBURSEMENTS: "cupad_cache_repay_disbursements",
  SETTINGS: "cupad_cache_repay_settings",
  HISTORY: "cupad_cache_repay_history",
  LAST_SYNC: "cupad_cache_repay_last_sync",
  PRIVACY: "cupad_cache_privacy_hide_amounts",
};

const PURPLE_ACCENT = "#8B5CF6";

type ClientItem = {
  id: string | number;
  name: string;
  union?: string;
  phone?: string;
};

type DisbursementRecord = {
  id: string | number;
  client_id: string | number;
  total_payable: number;
  remaining_balance: number;
  num_installments: number;
  date: string;
  status: string;
  payoff_date?: string;
  loan_term_type?: string;
  client_type?: string;
};

type RepaymentEntry = {
  transaction_id: string;
  client_id?: string | number;
  client_name: string;
  union?: string;
  amount_collected: number;
  date: string;
  remaining_balance: number;
  type?: string;
  status?: string;
};

function formatNaira(amount: number | string, hide = false): string {
  if (hide) return "••••••••";
  const num = Math.abs(Number(amount) || 0);
  return `₦${num.toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatRawNumber(amountStr: string): string {
  const cleaned = amountStr.replace(/[^0-9]/g, "");
  if (!cleaned) return "";
  return Number(cleaned).toLocaleString("en-NG");
}

function formatSyncTime(isoString: string | null): string {
  if (!isoString) return "Never";
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 45) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoString).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
}

function formatTxDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (isToday) return `Today, ${timeStr}`;
    return `${d.toLocaleDateString("en-NG", { month: "short", day: "numeric" })}, ${timeStr}`;
  } catch {
    return dateStr;
  }
}

function isWeekend(date: Date = new Date()): boolean {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getTodayYmd(): string {
  return new Date().toISOString().slice(0, 10);
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
function SkeletonItem({ isDark, cardBg, glassBorder }: { isDark: boolean; cardBg: string; glassBorder: string }) {
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
        <Animated.View style={{ height: 13, width: "60%", borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
        <Animated.View style={{ height: 10, width: "40%", borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Animated.View style={{ height: 15, width: 70, borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
        <Animated.View style={{ height: 10, width: 45, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
      </View>
    </View>
  );
}

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
      <View style={styles.clientCardHeader}>
        <Animated.View style={[styles.avatarBox, { backgroundColor: bg, opacity: pulseAnim }]} />
        <View style={{ flex: 1, marginHorizontal: 10, gap: 6 }}>
          <Animated.View style={{ height: 14, width: "60%", borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
          <Animated.View style={{ height: 10, width: "38%", borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
        </View>
        <Animated.View style={{ height: 22, width: 70, borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
      </View>

      <View style={styles.loanSnapshotBox}>
        <View style={styles.loanNumbersRow}>
          <View style={{ gap: 6 }}>
            <Animated.View style={{ height: 9, width: 110, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
            <Animated.View style={{ height: 17, width: 90, borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
          </View>
          <View style={{ alignItems: "flex-end", gap: 6 }}>
            <Animated.View style={{ height: 9, width: 85, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
            <Animated.View style={{ height: 17, width: 70, borderRadius: 6, backgroundColor: bg, opacity: pulseAnim }} />
          </View>
        </View>

        <Animated.View style={[styles.progressTrack, { backgroundColor: bg, opacity: pulseAnim }]} />

        <View style={styles.progressTextRow}>
          <Animated.View style={{ height: 10, width: 100, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
          <Animated.View style={{ height: 10, width: 90, borderRadius: 4, backgroundColor: bg, opacity: pulseAnim }} />
        </View>

        <Animated.View style={[styles.cardCollectBtn, { backgroundColor: bg, opacity: pulseAnim }]} />
      </View>
    </View>
  );
}

function UnionChipsSkeleton({ isDark, cardBg, glassBorder }: { isDark: boolean; cardBg: string; glassBorder: string }) {
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unionScroll}>
      {[90, 115, 80, 125, 95].map((w, idx) => (
        <Animated.View
          key={idx}
          style={[
            styles.unionChip,
            {
              backgroundColor: cardBg,
              borderColor: glassBorder,
              width: w,
              height: 36,
              opacity: pulseAnim,
              justifyContent: "center",
            },
          ]}
        >
          <View style={{ height: 11, width: "70%", borderRadius: 4, backgroundColor: bg }} />
        </Animated.View>
      ))}
    </ScrollView>
  );
}

export default function RepaymentScreen() {
  const { colors, isDark } = useTheme();

  const orbColor1 = isDark ? "rgba(139, 92, 246, 0.22)" : "rgba(139, 92, 246, 0.12)";
  const orbColor2 = isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.08)";
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Officer Session & Settings
  const [officerUsername, setOfficerUsername] = useState("");
  const [isWeekly, setIsWeekly] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [stats, setStats] = useState({
    total_outstanding_loans: 0,
    total_outstanding_amount: 0,
    personal_month_total: 0,
  });

  const [settings, setSettings] = useState({
    max_installments_per_payment: 3,
    min_installments_per_payment: 1,
    grace_period_days: 2,
    allow_partial_payments: false,
    allow_overpayment: false,
    collection_date_readonly: false,
  });

  // Offline Sync State
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [deviceOffline, setDeviceOffline] = useState(false);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [hideBalances, setHideBalances] = useState(false);

  // Lists & Filtering
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [disbursements, setDisbursements] = useState<DisbursementRecord[]>([]);
  const [unionsList, setUnionsList] = useState<string[]>([]);
  const [selectedUnion, setSelectedUnion] = useState<string>("");

  // Target Client Collection Modal
  const [collectModalVisible, setCollectModalVisible] = useState(false);
  const [targetClient, setTargetClient] = useState<ClientItem | null>(null);
  const [targetLoan, setTargetLoan] = useState<DisbursementRecord | null>(null);
  const [selectedInstallments, setSelectedInstallments] = useState<number>(1);
  const [qualifiedFor3, setQualifiedFor3] = useState(false);
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customAmount, setCustomAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // History State
  const [history, setHistory] = useState<RepaymentEntry[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"current_month" | "today" | "all">("current_month");
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  // Receipt Modal
  const [receiptData, setReceiptData] = useState<any>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // Refresh
  const [refreshing, setRefreshing] = useState(false);

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
    }, 2500);
  };

  const toggleHideBalances = async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !hideBalances;
    setHideBalances(next);
    await AsyncStorage.setItem(CACHE_KEYS.PRIVACY, String(next));
  };

  const copyTxCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    showToast(`Copied Ref #${code}`);
  };

  const handleShareReceipt = async (data: any) => {
    try {
      if (Platform.OS !== "web") Haptics.selectionAsync();
      await Share.share({
        message: `Loan Repayment Receipt\nClient: ${data.client_name}\nRef: ${data.transaction_id}\nAmount: ₦${Number(data.amount_collected).toLocaleString()}\nRemaining: ₦${Number(data.remaining_balance).toLocaleString()}\nStatus: ${data.loan_paid_off ? "Paid Off" : "Active Loan"}\nDate: ${new Date().toLocaleString()}`,
      });
    } catch {}
  };

  const checkPendingQueue = useCallback(async () => {
    try {
      if (typeof getPendingRepaymentsCount === "function") {
        const count = await getPendingRepaymentsCount();
        setPendingSyncCount(count || 0);
      } else {
        setPendingSyncCount(0);
      }
    } catch (e) {
      console.log("Could not check pending sync count", e);
    }
  }, []);

  /* ================= 1. FAST SQLITE CACHE FIRST HYDRATION (0ms instant load) ================= */
  const hydrateFromSqlite = useCallback(async (username?: string) => {
    try {
      let loadedClients: ClientItem[] = [];
      let loadedDisbursements: DisbursementRecord[] = [];

      // 1. Check local SQLite repayments & disbursements table
      if (typeof loadCachedRepayments === "function") {
        const local = await loadCachedRepayments();
        if (local && Array.isArray(local.clients) && local.clients.length > 0) {
          loadedClients = local.clients;
          loadedDisbursements = local.disbursements || [];
        }
      }

      // 2. Augment / fallback via bootstrapCoScreenData
      if (loadedClients.length === 0 && typeof bootstrapCoScreenData === "function") {
        const boot = await bootstrapCoScreenData(username);
        if (boot && Array.isArray(boot.clients) && boot.clients.length > 0) {
          loadedClients = boot.clients.map((c: any) => ({
            id: c.id || c.client_id,
            name: c.name || c.client_name,
            union: c.union || c.union_name,
            phone: c.phone || c.phone_number,
          }));

          loadedDisbursements = boot.clients
            .filter((c: any) => Number(c.outstanding_loan ?? c.loan_balance ?? c.loan ?? 0) > 0.01)
            .map((c: any) => ({
              id: `loan_${c.id || c.client_id}`,
              client_id: c.id || c.client_id,
              total_payable: Number(c.total_payable || c.outstanding_loan || c.loan_balance || 0),
              remaining_balance: Number(c.outstanding_loan ?? c.loan_balance ?? 0),
              num_installments: Number(c.num_installments || 23),
              date: c.loan_date || new Date().toISOString(),
              status: "active",
            }));
        }
      }

      if (loadedClients.length > 0) {
        setClients(loadedClients);
        setDisbursements(loadedDisbursements);

        const uList = Array.from(
          new Set(loadedClients.map((c: any) => c.union).filter(Boolean))
        ) as string[];
        if (uList.length > 0) {
          setUnionsList(uList);
          setSelectedUnion((prev) => (prev && uList.includes(prev) ? prev : uList[0]));
        }

        // Compute local stats from active loans
        let outLoansCount = 0;
        let outTotalAmount = 0;
        loadedDisbursements.forEach((d) => {
          const rem = Number(d.remaining_balance ?? d.total_payable ?? 0);
          if (rem > 0.01 && d.status !== "completed") {
            outLoansCount++;
            outTotalAmount += rem;
          }
        });

        setStats((prev) => ({
          ...prev,
          total_outstanding_loans: outLoansCount,
          total_outstanding_amount: outTotalAmount,
        }));

        setIsInitialLoading(false);
      }
    } catch (err) {
      console.log("Error during SQLite hydration note:", err);
    }
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const [stored, priv, cachedSync, cachedStats, cachedSett, cachedHist] = await Promise.all([
        AsyncStorage.getItem("cupad_user"),
        AsyncStorage.getItem(CACHE_KEYS.PRIVACY),
        AsyncStorage.getItem(CACHE_KEYS.LAST_SYNC),
        AsyncStorage.getItem(CACHE_KEYS.STATS),
        AsyncStorage.getItem(CACHE_KEYS.SETTINGS),
        AsyncStorage.getItem(CACHE_KEYS.HISTORY),
      ]);

      if (priv !== null) setHideBalances(priv === "true");
      if (cachedSync) setLastSync(cachedSync);
      if (cachedStats) setStats(JSON.parse(cachedStats));
      if (cachedSett) setSettings(JSON.parse(cachedSett));
      if (cachedHist) setHistory(JSON.parse(cachedHist));

      let uname = "";
      if (stored) {
        const u = JSON.parse(stored);
        uname = u.username || "";
        setOfficerUsername(uname);
      } else {
        const bio = await AsyncStorage.getItem("cupad_biometric_user");
        if (bio) {
          const u = JSON.parse(bio);
          uname = u.username || "";
          setOfficerUsername(uname);
        }
      }

      await hydrateFromSqlite(uname);
      await checkPendingQueue();
      return uname;
    } catch {
      return "";
    }
  }, [hydrateFromSqlite, checkPendingQueue]);

  const paidTodayClientIds = useMemo(() => {
    const today = getTodayYmd();
    const set = new Set<string>();
    history.forEach((tx) => {
      if (tx.date && tx.date.slice(0, 10) === today && tx.client_id) {
        set.add(String(tx.client_id));
      }
    });
    return set;
  }, [history]);

  const unionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c) => {
      if (c.union) {
        counts[c.union] = (counts[c.union] || 0) + 1;
      }
    });
    return counts;
  }, [clients]);

  const activeLoansMap = useMemo(() => {
    const map = new Map<string | number, DisbursementRecord>();
    const sorted = [...disbursements].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    for (const d of sorted) {
      const rem = Number(d.remaining_balance ?? d.total_payable);
      if (rem > 0.01 && d.status !== "completed" && !map.has(d.client_id)) {
        map.set(d.client_id, d);
      }
    }
    return map;
  }, [disbursements]);

  const unionClients = useMemo(() => {
    return clients.filter((c) => {
      return !selectedUnion || (c.union && c.union.toLowerCase() === selectedUnion.toLowerCase());
    });
  }, [clients, selectedUnion]);

  /* ================= LOAN METRICS ================= */
  // Baseline strictly populates up to 2 installments first.
  // The 3rd installment is ONLY populated if the client is explicitly qualified.
  const modalLoanMetrics = useMemo(() => {
    if (!targetLoan) return null;
    const total = Number(targetLoan.total_payable) || 0;
    const remaining = Number(targetLoan.remaining_balance ?? total) || 0;
    const paid = Math.max(0, total - remaining);
    const numInst = Number(targetLoan.num_installments) || (isWeekly ? 24 : 23);
    const instAmt = numInst > 0 ? Math.round(total / numInst) : 0;
    const instPaid = instAmt > 0 ? Math.min(numInst, Math.round(paid / instAmt)) : 0;
    const instRem = Math.max(0, numInst - instPaid);

    // Default/baseline allowed count is at most 2
    let maxAllowed = Math.min(2, Math.max(instRem, 1));

    // Only allow 3 if verified qualified and loan has at least 3 installments remaining
    if (qualifiedFor3 && instRem >= 3) {
      maxAllowed = 3;
    }

    return { total, remaining, paid, numInst, instAmt, instPaid, instRem, maxAllowed };
  }, [targetLoan, isWeekly, qualifiedFor3]);

  // Clamp selection safely if maxAllowed changes
  useEffect(() => {
    if (modalLoanMetrics && selectedInstallments > modalLoanMetrics.maxAllowed) {
      setSelectedInstallments(modalLoanMetrics.maxAllowed);
    }
  }, [modalLoanMetrics, selectedInstallments]);

  const modalPayableAmount = useMemo(() => {
    if (!modalLoanMetrics) return 0;
    if (isCustomMode) {
      return Number(customAmount.replace(/[^0-9]/g, "")) || 0;
    }
    // If paying remaining installments in full, use exact remaining balance to prevent rounding discrepancies
    if (selectedInstallments >= modalLoanMetrics.instRem) {
      return modalLoanMetrics.remaining;
    }
    return Math.min(modalLoanMetrics.remaining, Math.round(selectedInstallments * modalLoanMetrics.instAmt));
  }, [modalLoanMetrics, isCustomMode, selectedInstallments, customAmount]);

  const isWeekendToday = useMemo(() => isWeekend(), []);

  const openCollectForClient = async (client: ClientItem, loan: DisbursementRecord) => {
    if (isWeekendToday) {
      Alert.alert("Collections Closed", "Loan repayments are not accepted on Saturdays and Sundays.");
      return;
    }

    if (paidTodayClientIds.has(String(client.id))) {
      Alert.alert(
        "Payment Already Made",
        `${client.name} has already made a repayment today. Only 1 collection per client is allowed per day.`
      );
      return;
    }

    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    // Step 1: Open modal immediately with 2 installments populated first (1 and 2)
    setTargetClient(client);
    setTargetLoan(loan);
    setSelectedInstallments(1);
    setIsCustomMode(false);
    setCustomAmount("");
    setQualifiedFor3(false); // ALWAYS starts at 2 installments max!
    setCollectModalVisible(true);

    // Step 2: Asynchronously verify if client qualifies for 3 installments
    const total = Number(loan.total_payable) || 0;
    const remaining = Number(loan.remaining_balance ?? total) || 0;
    const paid = Math.max(0, total - remaining);
    const numInst = Number(loan.num_installments) || (isWeekly ? 24 : 23);
    const instAmt = numInst > 0 ? Math.round(total / numInst) : 0;
    const instPaid = instAmt > 0 ? Math.min(numInst, Math.round(paid / instAmt)) : 0;
    const instRem = Math.max(0, numInst - instPaid);

    const settingAllows3 = (Number(settings.max_installments_per_payment) || 3) >= 3;

    try {
      const on = await isOnline().catch(() => false);
      setDeviceOffline(!on);
      // ONLY add the 3rd installment if online, setting allows, and remaining >= 3
      if (on && settingAllows3 && instRem >= 3) {
        setQualifiedFor3(true);
      } else {
        setQualifiedFor3(false);
      }
    } catch {
      setDeviceOffline(true);
      setQualifiedFor3(false);
    }
  };

  /* ================= 2. SERVER FETCH & SYNC ================= */
  const fetchHistory = useCallback(
    async (pageNum = 1, append = false, filter = historyFilter, union = selectedUnion) => {
      if (!officerUsername) return;
      if (!append) setHistoryLoading(true);
      else setLoadingMoreHistory(true);

      try {
        const online = await isOnline().catch(() => false);
        if (!online) {
          const cached = await AsyncStorage.getItem(CACHE_KEYS.HISTORY);
          if (cached) {
            try {
              setHistory(JSON.parse(cached));
            } catch {}
          }
          setHistoryLoading(false);
          setLoadingMoreHistory(false);
          return;
        }

        const res = await axios.get(
          `${API_REPAYMENT}?action=history&username=${encodeURIComponent(
            officerUsername
          )}&filter=${filter}&union=${encodeURIComponent(union)}&page=${pageNum}&limit=15`,
          { timeout: 9000 }
        );

        if (res.data?.success && Array.isArray(res.data.entries)) {
          if (append) {
            setHistory((prev) => [...prev, ...res.data.entries]);
          } else {
            setHistory(res.data.entries);
            await AsyncStorage.setItem(CACHE_KEYS.HISTORY, JSON.stringify(res.data.entries));
          }
          setHasMoreHistory(Boolean(res.data.has_more));
          setHistoryPage(pageNum);
        }
      } catch (err) {
        console.log("Error loading repayment history:", err);
        const cached = await AsyncStorage.getItem(CACHE_KEYS.HISTORY);
        if (cached) {
          try {
            setHistory(JSON.parse(cached));
          } catch {}
        }
      } finally {
        setHistoryLoading(false);
        setLoadingMoreHistory(false);
      }
    },
    [officerUsername, historyFilter, selectedUnion]
  );

  const fetchInitData = useCallback(
    async (user: string) => {
      if (!user) {
        setIsInitialLoading(false);
        return;
      }

      const online = await isOnline().catch(() => false);
      if (!online) {
        setDeviceOffline(true);
        await hydrateFromSqlite(user);
        await checkPendingQueue();
        setIsInitialLoading(false);
        return;
      }

      try {
        const res = await axios.get(
          `${API_REPAYMENT}?action=init&username=${encodeURIComponent(user)}`,
          { timeout: 9000 }
        );

        if (res.data?.success) {
          setDeviceOffline(false);
          setClients(res.data.clients || []);
          setDisbursements(res.data.disbursements || []);

          const fromInit = Array.isArray(res.data.unions)
            ? res.data.unions.map((u: any) => (typeof u === "string" ? u : u?.name)).filter(Boolean)
            : [];
          const fromClients = Array.from(
            new Set((res.data.clients || []).map((c: any) => c.union).filter(Boolean))
          ) as string[];

          let fromApi: string[] = [];
          try {
            const uf = await fetchUnionsForOfficer(user);
            fromApi = uf.names || [];
          } catch {}

          const incomingUnions = mergeUnionNames(fromApi, fromInit, fromClients);
          setUnionsList(incomingUnions);
          if (incomingUnions.length > 0) {
            setSelectedUnion((prev) => (prev && incomingUnions.includes(prev) ? prev : incomingUnions[0]));
          }

          if (res.data.settings) setSettings(res.data.settings);
          if (res.data.stats) setStats(res.data.stats);
          setIsWeekly(Boolean(res.data.is_weekly));

          if (typeof cacheRepaymentDataLocally === "function") {
            try {
              await cacheRepaymentDataLocally(res.data.clients || [], res.data.disbursements || []);
            } catch (e) {
              console.log("SQLite cacheRepaymentDataLocally note:", e);
            }
          }

          if (Array.isArray(res.data.clients) && res.data.clients.length > 0) {
            try {
              await cacheClients(res.data.clients, user);
            } catch {}
          }

          if (incomingUnions.length > 0) {
            try {
              await cacheUnions(
                incomingUnions.map((name) => ({ name, clients: 0, savings: 0, loans: 0 })),
                user
              );
            } catch {}
          }

          try {
            hydrateOfflineCache(user);
          } catch {}

          const now = new Date().toISOString();
          setLastSync(now);
          await AsyncStorage.setItem(CACHE_KEYS.LAST_SYNC, now);
          await AsyncStorage.setItem(CACHE_KEYS.CLIENTS, JSON.stringify(res.data.clients));
          await AsyncStorage.setItem(CACHE_KEYS.DISBURSEMENTS, JSON.stringify(res.data.disbursements));
          await AsyncStorage.setItem(CACHE_KEYS.STATS, JSON.stringify(res.data.stats));
          await AsyncStorage.setItem(CACHE_KEYS.SETTINGS, JSON.stringify(res.data.settings));
        }
      } catch {
        setDeviceOffline(true);
        await hydrateFromSqlite(user);
      } finally {
        await checkPendingQueue();
        setIsInitialLoading(false);
      }
    },
    [hydrateFromSqlite, checkPendingQueue]
  );

  /* ================= 3. TRANSACTION CONFIRMATION ================= */
  const saveOfflineTransaction = async (
    nowIso: string,
    tempTxId: string,
    calculatedNewBal: number,
    clientIdStr: string,
    isPayingAll: boolean
  ) => {
    if (!targetClient || !targetLoan) return;

    const safeInstallments = isCustomMode ? 1 : Math.min(selectedInstallments, 2);

    if (typeof saveRepaymentOffline === "function") {
      await saveRepaymentOffline({
        tempTxId,
        clientId: targetClient.id,
        clientName: targetClient.name,
        unionName: targetClient.union,
        amount: modalPayableAmount,
        date: nowIso,
        remainingBalance: calculatedNewBal,
        officer: officerUsername,
        numInstallments: safeInstallments,
        isCustom: isCustomMode || isPayingAll,
        loanId: targetLoan.id,
      });
    }

    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }

    setDisbursements((prev) =>
      prev.map((d) =>
        String(d.client_id) === clientIdStr
          ? {
              ...d,
              remaining_balance: calculatedNewBal,
              status: calculatedNewBal <= 0.01 ? "completed" : d.status,
            }
          : d
      )
    );

    setStats((prev) => ({
      ...prev,
      total_outstanding_amount: Math.max(0, prev.total_outstanding_amount - modalPayableAmount),
      personal_month_total: prev.personal_month_total + modalPayableAmount,
    }));

    const offlineEntry: RepaymentEntry = {
      transaction_id: tempTxId,
      client_id: targetClient.id,
      client_name: targetClient.name,
      union: targetClient.union,
      amount_collected: modalPayableAmount,
      date: nowIso,
      remaining_balance: calculatedNewBal,
      status: "pending",
    };

    setHistory((prev) => {
      const updated = [offlineEntry, ...prev];
      AsyncStorage.setItem(CACHE_KEYS.HISTORY, JSON.stringify(updated)).catch(() => {});
      return updated;
    });

    setCollectModalVisible(false);
    setReceiptData({
      transaction_id: tempTxId,
      client_name: targetClient.name,
      amount_collected: modalPayableAmount,
      remaining_balance: calculatedNewBal,
      loan_paid_off: calculatedNewBal <= 0.01,
      isOffline: true,
    });
    setShowReceiptModal(true);

    await checkPendingQueue();
    showToast(calculatedNewBal <= 0.01 ? "Loan Paid Off! Saved offline to SQLite." : "Saved offline to SQLite. Pending server sync.");
  };

  const handleConfirmRepayment = async () => {
    if (!targetClient || !targetLoan || !modalLoanMetrics) return;

    const clientIdStr = String(targetClient.id);

    if (paidTodayClientIds.has(clientIdStr)) {
      Alert.alert(
        "Action Denied",
        `${targetClient.name} has already made a collection payment today. A second transaction is not allowed.`
      );
      setCollectModalVisible(false);
      return;
    }

    if (modalPayableAmount <= 0) {
      Alert.alert("Invalid Amount", "Please specify a payment amount.");
      return;
    }

    // Safety guard against fast tapping
    if (!isCustomMode && selectedInstallments > modalLoanMetrics.maxAllowed) {
      Alert.alert(
        "Limit Exceeded",
        `You can only collect up to ${modalLoanMetrics.maxAllowed} installment${modalLoanMetrics.maxAllowed > 1 ? "s" : ""} at this time.`
      );
      return;
    }

    const isPayingAll = !isCustomMode && selectedInstallments >= modalLoanMetrics.instRem;

    if (!settings.allow_overpayment && !isPayingAll && modalPayableAmount > modalLoanMetrics.remaining + 0.01) {
      Alert.alert("Overpayment Disallowed", `Amount exceeds remaining balance of ${formatNaira(modalLoanMetrics.remaining)}`);
      return;
    }

    setIsSubmitting(true);
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }

    const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
    const tempTxId = `LCL-OFF-${Date.now().toString(36).toUpperCase()}`;
    const calculatedNewBal = isPayingAll ? 0 : Math.max(0, modalLoanMetrics.remaining - modalPayableAmount);

    const online = await isOnline().catch(() => false);

    if (!online) {
      setDeviceOffline(true);
      await saveOfflineTransaction(nowIso, tempTxId, calculatedNewBal, clientIdStr, isPayingAll);
      setIsSubmitting(false);
      setTargetClient(null);
      setTargetLoan(null);
      return;
    }

    const payload = {
      action: "record_repayment",
      client_id: targetClient.id,
      num_installments: isCustomMode ? 1 : selectedInstallments,
      custom_pay_amount: isCustomMode ? modalPayableAmount : (isPayingAll ? modalPayableAmount : 0),
      amount: modalPayableAmount,
      officer: officerUsername,
      date: nowIso,
    };

    try {
      const res = await axios.post(API_REPAYMENT, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 9000,
      });

      if (res.data?.success) {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        setCollectModalVisible(false);
        setReceiptData(res.data.transaction);
        setShowReceiptModal(true);

        setDisbursements((prev) =>
          prev.map((d) => {
            if (String(d.client_id) === clientIdStr) {
              return {
                ...d,
                remaining_balance: res.data.transaction.remaining_balance,
                status: res.data.transaction.loan_paid_off ? "completed" : d.status,
              };
            }
            return d;
          })
        );

        setStats((prev) => ({
          ...prev,
          total_outstanding_amount: Math.max(0, prev.total_outstanding_amount - modalPayableAmount),
          personal_month_total: prev.personal_month_total + modalPayableAmount,
        }));

        fetchHistory(1, false, historyFilter, selectedUnion);
      } else {
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        }
        Alert.alert("Collection Blocked", res.data?.message || "Server declined collection.");
      }
    } catch {
      setDeviceOffline(true);
      await saveOfflineTransaction(nowIso, tempTxId, calculatedNewBal, clientIdStr, isPayingAll);
    } finally {
      setIsSubmitting(false);
      setTargetClient(null);
      setTargetLoan(null);
    }
  };

  /* ================= 4. MANUAL & PULL-TO-REFRESH SYNC ================= */
  const handleManualSync = async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const online = await isOnline().catch(() => false);
      if (!online) {
        showToast("Cannot sync: device is offline");
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }

      if (typeof autoSyncIfOnline === "function") {
        await autoSyncIfOnline();
      }

      if (typeof processRepaymentPendingSync === "function") {
        const { syncedCount } = await processRepaymentPendingSync();
        await checkPendingQueue();
        if (syncedCount > 0) {
          showToast(`Synced ${syncedCount} collection(s) to server`);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        } else {
          showToast("All collections are up to date");
        }
      }

      if (officerUsername) {
        await Promise.all([
          fetchInitData(officerUsername),
          fetchHistory(1, false, historyFilter, selectedUnion),
        ]);
      }
    } catch (err: any) {
      showToast(err?.message || "Sync failed. Will retry later.");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setIsSyncing(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    if (officerUsername) {
      try {
        const online = await isOnline().catch(() => false);
        if (online && typeof processRepaymentPendingSync === "function") {
          const { syncedCount } = await processRepaymentPendingSync();
          await checkPendingQueue();
          if (syncedCount > 0) {
            showToast(`Synced ${syncedCount} collection(s)`);
          }
        }
      } catch (e) {
        console.log("Sync error during refresh:", e);
      }

      await Promise.all([
        fetchInitData(officerUsername),
        fetchHistory(1, false, historyFilter, selectedUnion),
        checkPendingQueue(),
      ]);
    }
    setRefreshing(false);
  }, [officerUsername, historyFilter, selectedUnion, fetchInitData, fetchHistory, checkPendingQueue]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    loadUser().then(async (u) => {
      if (u) {
        await fetchInitData(u);
        await checkPendingQueue();
      } else {
        setIsInitialLoading(false);
      }
    });
  }, [loadUser, fetchInitData, checkPendingQueue, fadeAnim]);

  useEffect(() => {
    if (officerUsername) {
      fetchHistory(1, false, historyFilter, selectedUnion);
    }
  }, [selectedUnion, historyFilter, officerUsername, fetchHistory]);

  const filteredHistory = useMemo(() => {
    if (!historySearch.trim()) return history;
    const q = historySearch.toLowerCase().trim();
    return history.filter(
      (tx) =>
        tx.client_name.toLowerCase().includes(q) ||
        tx.transaction_id.toLowerCase().includes(q) ||
        tx.union?.toLowerCase().includes(q)
    );
  }, [history, historySearch]);

  return (
    <CoScreenWrapper>
      {/* BACKGROUND ORBS */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={260} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={height * 0.45} delay={2000} />
      </View>

      {/* FLOATING TOAST */}
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
          <Text style={[styles.toastText, { color: colors.text }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.container}>
          <Animated.ScrollView
            style={{ flex: 1, opacity: fadeAnim }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={PURPLE_ACCENT} />}
          >
            {/* WEEKEND NOTICE BANNER */}
            {isWeekendToday && (
              <View style={styles.weekendBanner}>
                <Ionicons name="alert-circle" size={18} color="#fff" />
                <Text style={styles.weekendBannerText}>
                  Collections Closed: Repayments are not accepted on Saturdays and Sundays.
                </Text>
              </View>
            )}

            {/* PENDING SYNC CALLOUT */}
            {pendingSyncCount > 0 && (
              <Pressable
                onPress={handleManualSync}
                disabled={isSyncing}
                style={({ pressed }) => [
                  styles.syncNoticeCard,
                  {
                    backgroundColor: "rgba(245, 158, 11, 0.14)",
                    borderColor: "rgba(245, 158, 11, 0.35)",
                    opacity: pressed || isSyncing ? 0.8 : 1,
                  },
                ]}
              >
                <View style={styles.syncNoticeLeft}>
                  <View style={styles.syncNoticeDot} />
                  <Text style={styles.syncNoticeText}>
                    {pendingSyncCount} collection{pendingSyncCount > 1 ? "s" : ""} pending server sync
                  </Text>
                </View>
                <View style={styles.syncNoticeAction}>
                  {isSyncing ? (
                    <ActivityIndicator size="small" color="#D97706" />
                  ) : (
                    <>
                      <Text style={styles.syncNoticeActionText}>Sync Now</Text>
                      <Ionicons name="sync" size={13} color="#D97706" />
                    </>
                  )}
                </View>
              </Pressable>
            )}

            {/* ================= HERO CARD ================= */}
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
                    {
                      backgroundColor: deviceOffline
                        ? "rgba(245, 158, 11, 0.15)"
                        : "rgba(139, 92, 246, 0.15)",
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.statusPulseDot,
                      { backgroundColor: deviceOffline ? "#F59E0B" : PURPLE_ACCENT },
                    ]}
                  />
                  <Text
                    style={[
                      styles.heroTagText,
                      { color: deviceOffline ? "#F59E0B" : PURPLE_ACCENT },
                    ]}
                  >
                    {deviceOffline ? "OFFLINE SQLITE ACTIVE" : "COLLECTION TERMINAL"}
                  </Text>
                </View>

                <Pressable
                  onPress={onRefresh}
                  style={[
                    styles.syncTimePill,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)" },
                  ]}
                >
                  <Ionicons
                    name={deviceOffline ? "cloud-offline-outline" : "checkmark-circle-outline"}
                    size={12}
                    color={colors.textMuted}
                  />
                  <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>
                    {formatSyncTime(lastSync)}
                  </Text>
                </Pressable>
              </View>

              <View style={styles.heroMainBalanceSection}>
                <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                  TOTAL BALANCE DUE
                </Text>
                <View style={styles.heroAmountRow}>
                  <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                    {formatNaira(stats.total_outstanding_amount, hideBalances)}
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

              <View style={styles.heroMetricsGrid}>
                <View
                  style={[
                    styles.metricGridItem,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                  ]}
                >
                  <View style={styles.metricItemHeader}>
                    <Ionicons name="layers-outline" size={12} color={PURPLE_ACCENT} />
                    <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Active Loans</Text>
                  </View>
                  <Text style={[styles.metricItemValue, { color: colors.text }]}>
                    {stats.total_outstanding_loans}
                  </Text>
                  <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>open borrower accounts</Text>
                </View>

                <View
                  style={[
                    styles.metricGridItem,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                  ]}
                >
                  <View style={styles.metricItemHeader}>
                    <Ionicons name="sparkles-outline" size={12} color="#10B981" />
                    <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Month Collected</Text>
                  </View>
                  <Text style={[styles.metricItemValue, { color: "#10B981" }]}>
                    {formatNaira(stats.personal_month_total, hideBalances)}
                  </Text>
                  <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>personal ledger</Text>
                </View>
              </View>
            </LinearGradient>

            {/* UNION SELECTOR CHIPS */}
            <View style={styles.unionSection}>
              <View style={styles.unionHeaderRow}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Union Groups</Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Filtered collection feeds</Text>
                </View>
                <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <Text style={[styles.badgeCountText, { color: colors.textMuted }]}>
                    {isInitialLoading && unionsList.length === 0 ? "..." : `${unionsList.length}`}
                  </Text>
                </View>
              </View>

              {isInitialLoading && unionsList.length === 0 ? (
                <UnionChipsSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unionScroll}>
                  {unionsList.map((u) => {
                    const isSelected = selectedUnion === u;
                    const count = unionCounts[u] || 0;
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
                            backgroundColor: isSelected ? PURPLE_ACCENT : cardSurfaceBg,
                            borderColor: isSelected ? PURPLE_ACCENT : glassBorder,
                            transform: [{ scale: pressed ? 0.96 : 1 }],
                          },
                        ]}
                      >
                        <Ionicons name="people-outline" size={14} color={isSelected ? "#fff" : colors.textMuted} />
                        <Text style={[styles.unionChipText, { color: isSelected ? "#fff" : colors.text }]}>{u}</Text>
                        <View
                          style={[
                            styles.unionCountBadge,
                            {
                              backgroundColor: isSelected
                                ? "rgba(255,255,255,0.28)"
                                : isDark
                                ? "rgba(255,255,255,0.08)"
                                : "rgba(0,0,0,0.06)",
                            },
                          ]}
                        >
                          <Text style={[styles.unionCountText, { color: isSelected ? "#fff" : colors.textMuted }]}>
                            {count}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              )}
            </View>

            {/* BORROWER CARDS SECTION */}
            <View style={styles.clientCardsSection}>
              <View style={styles.sectionHeaderRow}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>
                    {selectedUnion || "Union"} Borrowers
                  </Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                    Daily limit: 1 repayment per borrower
                  </Text>
                </View>
                <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <Text style={[styles.badgeCountText, { color: PURPLE_ACCENT }]}>
                    {isInitialLoading && clients.length === 0 ? "..." : `${unionClients.length} Members`}
                  </Text>
                </View>
              </View>

              {isInitialLoading && clients.length === 0 ? (
                <View style={styles.clientCardsList}>
                  <ClientCardSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <ClientCardSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <ClientCardSkeleton isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                </View>
              ) : unionClients.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                    <Ionicons name="people-outline" size={26} color={colors.textMuted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No borrowers found</Text>
                  <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                    No registered clients matching this union group
                  </Text>
                </View>
              ) : (
                <View style={styles.clientCardsList}>
                  {unionClients.map((client) => {
                    const loan = activeLoansMap.get(client.id);

                    const total = Number(loan?.total_payable || 0);
                    const remaining = Number(loan?.remaining_balance ?? total);
                    const paid = Math.max(0, total - remaining);
                    const numInst = Number(loan?.num_installments || 23);
                    const instAmt = numInst > 0 ? Math.round(total / numInst) : 0;
                    const instPaid = instAmt > 0 ? Math.min(numInst, Math.round(paid / instAmt)) : 0;
                    const instRem = Math.max(0, numInst - instPaid);
                    const progressPct = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;

                    const hasPaidToday = paidTodayClientIds.has(String(client.id));

                    return (
                      <View
                        key={client.id}
                        style={[
                          styles.clientCard,
                          {
                            backgroundColor: cardSurfaceBg,
                            borderColor: glassBorder,
                          },
                        ]}
                      >
                        <View style={styles.clientCardHeader}>
                          <View
                            style={[
                              styles.avatarBox,
                              { backgroundColor: isDark ? "rgba(139, 92, 246, 0.2)" : "rgba(139, 92, 246, 0.12)" },
                            ]}
                          >
                            <Text style={[styles.avatarText, { color: PURPLE_ACCENT }]}>
                              {client.name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={{ flex: 1, marginHorizontal: 10 }}>
                            <Text style={[styles.clientCardName, { color: colors.text }]} numberOfLines={1}>
                              {client.name}
                            </Text>
                            <Text style={[styles.clientCardMeta, { color: colors.textMuted }]}>
                              {client.phone || "No phone"} • {client.union || "Union"}
                            </Text>
                          </View>

                          {hasPaidToday ? (
                            <View style={styles.paidTodayBadge}>
                              <Ionicons name="checkmark-circle" size={11} color="#059669" />
                              <Text style={styles.paidTodayBadgeText}>Paid Today</Text>
                            </View>
                          ) : loan ? (
                            <View style={styles.activeTag}>
                              <Text style={styles.activeTagText}>Active Loan</Text>
                            </View>
                          ) : (
                            <View style={styles.paidOffTag}>
                              <Text style={styles.paidOffTagText}>No Active Loan</Text>
                            </View>
                          )}
                        </View>

                        {loan ? (
                          <View style={styles.loanSnapshotBox}>
                            <View style={styles.loanNumbersRow}>
                              <View>
                                <Text style={[styles.loanMetaLabel, { color: colors.textMuted }]}>OUTSTANDING BALANCE</Text>
                                <Text style={[styles.loanBalVal, { color: PURPLE_ACCENT }]}>
                                  {formatNaira(remaining, hideBalances)}
                                </Text>
                              </View>
                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={[styles.loanMetaLabel, { color: colors.textMuted }]}>SINGLE INSTALLMENT</Text>
                                <Text style={[styles.loanInstVal, { color: colors.text }]}>
                                  {formatNaira(instAmt, hideBalances)}
                                </Text>
                              </View>
                            </View>

                            <View style={[styles.progressTrack, { backgroundColor: isDark ? "#334155" : "#E2E8F0" }]}>
                              <View style={[styles.progressBar, { width: `${progressPct}%`, backgroundColor: PURPLE_ACCENT }]} />
                            </View>
                            <View style={styles.progressTextRow}>
                              <Text style={[styles.progressSubText, { color: colors.textMuted }]}>
                                {instPaid} of {numInst} Paid ({progressPct}%)
                              </Text>
                              <Text style={[styles.progressSubText, { color: PURPLE_ACCENT, fontWeight: "700" }]}>
                                {instRem} installments left
                              </Text>
                            </View>

                            <Pressable
                              onPress={() => openCollectForClient(client, loan)}
                              disabled={isWeekendToday || hasPaidToday}
                              style={({ pressed }) => [
                                styles.cardCollectBtn,
                                {
                                  backgroundColor: hasPaidToday
                                    ? "#10B981"
                                    : isWeekendToday
                                    ? "#94A3B8"
                                    : PURPLE_ACCENT,
                                  opacity: hasPaidToday ? 0.8 : pressed ? 0.92 : 1,
                                  transform: [{ scale: pressed ? 0.98 : 1 }],
                                },
                              ]}
                            >
                              <Ionicons
                                name={hasPaidToday ? "checkmark-circle" : "cash-outline"}
                                size={17}
                                color="#fff"
                              />
                              <Text style={styles.cardCollectBtnText}>
                                {hasPaidToday
                                  ? "Payment Recorded Today"
                                  : isWeekendToday
                                  ? "Closed on Weekends"
                                  : instRem <= 3
                                  ? `Collect (${instRem} left)`
                                  : `Collect ${formatNaira(instAmt)}`}
                              </Text>
                              {!isWeekendToday && !hasPaidToday && <Ionicons name="chevron-forward" size={16} color="#fff" />}
                            </Pressable>
                          </View>
                        ) : (
                          <View style={styles.noLoanWrap}>
                            <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                            <Text style={styles.noLoanText}>Client has no pending loan repayments</Text>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* RECENT REPAYMENTS STREAM */}
            <View style={styles.historySection}>
              <View style={styles.historyHead}>
                <View>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Repayments</Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Audit logs & balance updates</Text>
                </View>
                <View style={[styles.historyFilterTabs, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}>
                  {(["current_month", "today", "all"] as const).map((f) => (
                    <Pressable
                      key={f}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.selectionAsync();
                        setHistoryFilter(f);
                        fetchHistory(1, false, f, selectedUnion);
                      }}
                      style={[
                        styles.hTab,
                        {
                          backgroundColor: historyFilter === f ? PURPLE_ACCENT : "transparent",
                        },
                      ]}
                    >
                      <Text style={[styles.hTabText, { color: historyFilter === f ? "#fff" : colors.textMuted }]}>
                        {f === "all" ? "All" : f === "current_month" ? "Month" : "Today"}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>

              {historyLoading ? (
                <View style={{ gap: 8 }}>
                  <SkeletonItem isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <SkeletonItem isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                  <SkeletonItem isDark={isDark} cardBg={cardSurfaceBg} glassBorder={glassBorder} />
                </View>
              ) : filteredHistory.length === 0 ? (
                <View style={[styles.emptyCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                    <Ionicons name="receipt-outline" size={26} color={colors.textMuted} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.text }]}>No records found</Text>
                  <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                    Collected loan payments will appear here
                  </Text>
                </View>
              ) : (
                filteredHistory.map((tx, idx) => (
                  <Pressable
                    key={`${tx.transaction_id}-${idx}`}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      setReceiptData(tx);
                      setShowReceiptModal(true);
                    }}
                    style={({ pressed }) => [
                      styles.txCard,
                      {
                        backgroundColor: cardSurfaceBg,
                        borderColor: glassBorder,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      },
                    ]}
                  >
                    <View style={[styles.txIconBox, { backgroundColor: "rgba(139, 92, 246, 0.12)" }]}>
                      <Ionicons name="arrow-down-circle" size={20} color={PURPLE_ACCENT} />
                    </View>
                    <View style={{ flex: 1, marginHorizontal: 10 }}>
                      <Text style={[styles.txClientName, { color: colors.text }]} numberOfLines={1}>
                        {tx.client_name}
                      </Text>
                      <View style={styles.txMetaRow}>
                        {tx.status === "pending" ? (
                          <View style={styles.pendingHistoryTag}>
                            <Text style={styles.pendingHistoryText}>PENDING SYNC</Text>
                          </View>
                        ) : (
                          <Text style={[styles.txPlanTag, { color: PURPLE_ACCENT }]}>REPAYMENT</Text>
                        )}
                        <Text style={[styles.txUnionTag, { color: colors.textMuted }]}>• {tx.union || "Union"}</Text>
                      </View>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.txAmount, { color: PURPLE_ACCENT }]}>
                        {formatNaira(tx.amount_collected, hideBalances)}
                      </Text>
                      <Text style={[styles.txDate, { color: colors.textMuted }]}>{formatTxDate(tx.date)}</Text>
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          </Animated.ScrollView>
        </View>

        {/* ================= MODAL: COLLECT REPAYMENT ================= */}
        <Modal
          visible={collectModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setCollectModalVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setCollectModalVisible(false)} />
            <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.modalHandle} />
              <View style={styles.modalSheetHead}>
                <View>
                  <Text style={[styles.modalSheetTitle, { color: colors.text }]}>Collect Payment</Text>
                  <Text style={[styles.modalSheetSub, { color: colors.textMuted }]}>
                    {targetClient?.name} ({targetClient?.union || "Union"})
                  </Text>
                </View>
                <Pressable onPress={() => setCollectModalVisible(false)} hitSlop={10} style={styles.closeModalBtn}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              {/* PAYOFF NOTIFICATION CALLOUT */}
              {modalLoanMetrics && modalLoanMetrics.instRem <= 3 && (
                <View style={styles.payoffNoticeBadge}>
                  <Ionicons name="sparkles" size={13} color="#10B981" />
                  <Text style={styles.payoffNoticeText}>
                    {modalLoanMetrics.instRem === 1
                      ? "Final installment remaining — client can clear loan today!"
                      : modalLoanMetrics.instRem <= modalLoanMetrics.maxAllowed
                      ? `${modalLoanMetrics.instRem} installments remaining — client can pay all ${modalLoanMetrics.instRem} to clear loan!`
                      : `${modalLoanMetrics.instRem} installments remaining — up to ${modalLoanMetrics.maxAllowed} installments payable per collection.`}
                  </Text>
                </View>
              )}

              {modalLoanMetrics && (
                <View style={[styles.modalBalCard, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                  <View style={styles.modalBalRow}>
                    <Text style={[styles.mBalLabel, { color: colors.textMuted }]}>Outstanding</Text>
                    <Text style={[styles.mBalVal, { color: PURPLE_ACCENT }]}>{formatNaira(modalLoanMetrics.remaining)}</Text>
                  </View>
                  <View style={styles.modalBalRow}>
                    <Text style={[styles.mBalLabel, { color: colors.textMuted }]}>Single Installment</Text>
                    <Text style={[styles.mBalVal, { color: colors.text }]}>{formatNaira(modalLoanMetrics.instAmt)}</Text>
                  </View>
                  <View style={styles.modalBalRow}>
                    <Text style={[styles.mBalLabel, { color: colors.textMuted }]}>Remaining Balance After</Text>
                    <Text style={[styles.mBalVal, { color: "#10B981" }]}>
                      {formatNaira(Math.max(0, modalLoanMetrics.remaining - modalPayableAmount))}
                    </Text>
                  </View>
                </View>
              )}

              {modalLoanMetrics && (
                <View style={{ gap: 8, marginBottom: 16 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>CHOOSE INSTALLMENT COUNT</Text>
                  <View style={styles.installmentTabs}>
                    {Array.from({ length: modalLoanMetrics.maxAllowed }, (_, i) => i + 1).map((num) => {
                      const isPayAll = num === modalLoanMetrics.instRem;
                      const cost = isPayAll ? modalLoanMetrics.remaining : Math.min(modalLoanMetrics.remaining, num * modalLoanMetrics.instAmt);
                      if (!settings.allow_overpayment && !isPayAll && cost > modalLoanMetrics.remaining + 1) return null;
                      const isSelected = !isCustomMode && selectedInstallments === num;

                      return (
                        <Pressable
                          key={num}
                          onPress={() => {
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setIsCustomMode(false);
                            setSelectedInstallments(num);
                          }}
                          style={[
                            styles.instTabBtn,
                            {
                              backgroundColor: isSelected ? PURPLE_ACCENT : cardSurfaceBg,
                              borderColor: isSelected ? PURPLE_ACCENT : glassBorder,
                            },
                          ]}
                        >
                          <Text style={[styles.instTabCount, { color: isSelected ? "#fff" : colors.text }]}>
                            {isPayAll ? `Pay All (${num})` : `${num} ${num === 1 ? "Installment" : "Installments"}`}
                          </Text>
                          <Text style={[styles.instTabPrice, { color: isSelected ? "rgba(255,255,255,0.9)" : colors.textMuted }]}>
                            {formatNaira(cost)}
                          </Text>
                        </Pressable>
                      );
                    })}

                    {settings.allow_partial_payments && (
                      <Pressable
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          setIsCustomMode(true);
                        }}
                        style={[
                          styles.instTabBtn,
                          {
                            backgroundColor: isCustomMode ? PURPLE_ACCENT : cardSurfaceBg,
                            borderColor: isCustomMode ? PURPLE_ACCENT : glassBorder,
                          },
                        ]}
                      >
                        <Text style={[styles.instTabCount, { color: isCustomMode ? "#fff" : colors.text }]}>Custom</Text>
                        <Text style={[styles.instTabPrice, { color: isCustomMode ? "rgba(255,255,255,0.9)" : colors.textMuted }]}>
                          Amount
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  {isCustomMode && (
                    <View style={[styles.amountInputWrap, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                      <Text style={[styles.nairaPrefix, { color: PURPLE_ACCENT }]}>₦</Text>
                      <TextInput
                        value={customAmount}
                        onChangeText={(val) => setCustomAmount(formatRawNumber(val))}
                        placeholder="Enter payment amount"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        autoFocus
                        style={[styles.amountInput, { color: colors.text }]}
                      />
                    </View>
                  )}
                </View>
              )}

              <Pressable
                onPress={handleConfirmRepayment}
                disabled={isSubmitting || modalPayableAmount <= 0}
                style={({ pressed }) => [
                  styles.confirmCollectBtn,
                  {
                    backgroundColor: PURPLE_ACCENT,
                    opacity: isSubmitting || modalPayableAmount <= 0 ? 0.45 : pressed ? 0.9 : 1,
                  },
                ]}
              >
                {isSubmitting ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-done" size={19} color="#fff" />
                    <Text style={styles.confirmCollectBtnText}>
                      {modalLoanMetrics && !isCustomMode && selectedInstallments >= modalLoanMetrics.instRem
                        ? `Pay Off Loan • ${formatNaira(modalPayableAmount)}`
                        : `Confirm & Collect ${formatNaira(modalPayableAmount)}`}
                    </Text>
                  </>
                )}
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* ================= MODAL: RECEIPT ================= */}
        <Modal visible={showReceiptModal} transparent animationType="fade" onRequestClose={() => setShowReceiptModal(false)}>
          <View style={styles.receiptOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowReceiptModal(false)} />
            <View style={[styles.receiptBox, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={[styles.receiptTopCircle, { backgroundColor: PURPLE_ACCENT }]}>
                <Ionicons name="checkmark-done" size={30} color="#fff" />
              </View>
              <Text style={[styles.receiptHeading, { color: colors.text }]}>Payment Recorded</Text>
              <Text style={[styles.receiptSubHeading, { color: colors.textMuted }]}>
                {receiptData?.isOffline ? "Saved locally to SQLite (Offline mode)" : "Repayment successfully registered"}
              </Text>

              {receiptData && (
                <View style={[styles.receiptSlip, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                  <View style={styles.receiptSlipRow}>
                    <Text style={[styles.rLabel, { color: colors.textMuted }]}>Client</Text>
                    <Text style={[styles.rVal, { color: colors.text }]}>{receiptData.client_name}</Text>
                  </View>
                  <View style={styles.receiptSlipRow}>
                    <Text style={[styles.rLabel, { color: colors.textMuted }]}>Amount Paid</Text>
                    <Text style={[styles.rVal, { color: PURPLE_ACCENT, fontWeight: "900" }]}>
                      {formatNaira(receiptData.amount_collected)}
                    </Text>
                  </View>
                  <View style={styles.receiptSlipRow}>
                    <Text style={[styles.rLabel, { color: colors.textMuted }]}>Remaining Balance</Text>
                    <Text style={[styles.rVal, { color: colors.text }]}>{formatNaira(receiptData.remaining_balance)}</Text>
                  </View>
                  <View style={styles.receiptSlipRow}>
                    <Text style={[styles.rLabel, { color: colors.textMuted }]}>Reference</Text>
                    <Pressable
                      onPress={() => copyTxCode(receiptData.transaction_id)}
                      hitSlop={6}
                      style={{ flexDirection: "row", alignItems: "center", gap: 5 }}
                    >
                      <Text style={[styles.rVal, { color: "#F59E0B", fontSize: 11 }]}>{receiptData.transaction_id}</Text>
                      <Ionicons name="copy-outline" size={13} color="#F59E0B" />
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.receiptBtnRow}>
                <Pressable
                  onPress={() => receiptData && handleShareReceipt(receiptData)}
                  style={[styles.receiptShareBtn, { borderColor: glassBorder }]}
                >
                  <Ionicons name="share-social-outline" size={16} color={colors.text} />
                  <Text style={[styles.receiptShareBtnText, { color: colors.text }]}>Share</Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowReceiptModal(false)}
                  style={[styles.receiptDoneBtn, { backgroundColor: PURPLE_ACCENT }]}
                >
                  <Text style={styles.receiptDoneBtnText}>Done</Text>
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

  weekendBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#EF4444",
    padding: 12,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  weekendBannerText: { color: "#fff", fontSize: 11.5, fontWeight: "700", flex: 1 },

  syncNoticeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  syncNoticeLeft: { flexDirection: "row", alignItems: "center", gap: 6 },
  syncNoticeDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#D97706" },
  syncNoticeText: { color: "#D97706", fontSize: 11.5, fontWeight: "700" },
  syncNoticeAction: { flexDirection: "row", alignItems: "center", gap: 4 },
  syncNoticeActionText: { color: "#D97706", fontSize: 11, fontWeight: "800" },

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
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  metricItemHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  metricItemLabel: {
    fontSize: 9.5,
    fontWeight: "600",
  },
  metricItemValue: {
    fontSize: 14.5,
    fontWeight: "800",
    marginTop: 3,
  },
  metricItemSub: {
    fontSize: 9,
    marginTop: 1,
    fontWeight: "500",
  },

  sectionTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  badgeCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeCountText: { fontSize: 11, fontWeight: "700" },

  unionSection: { marginBottom: 18 },
  unionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  unionScroll: { paddingHorizontal: 16, gap: 8 },
  unionChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
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
  unionCountText: { fontSize: 10, fontWeight: "800" },

  clientCardsSection: { marginBottom: 20, paddingHorizontal: 16 },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },

  clientCardsList: { gap: 12 },
  clientCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 1,
  },
  clientCardHeader: { flexDirection: "row", alignItems: "center" },
  avatarBox: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontWeight: "800" },
  clientCardName: { fontSize: 14, fontWeight: "800" },
  clientCardMeta: { fontSize: 11, marginTop: 1 },
  activeTag: { backgroundColor: "rgba(139,92,246,0.12)", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  activeTagText: { color: PURPLE_ACCENT, fontSize: 9.5, fontWeight: "800" },
  paidOffTag: { backgroundColor: "#DCFCE7", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  paidOffTagText: { color: "#166534", fontSize: 9.5, fontWeight: "700" },

  paidTodayBadge: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  paidTodayBadgeText: { color: "#065F46", fontSize: 10, fontWeight: "800" },

  loanSnapshotBox: { gap: 10 },
  loanNumbersRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  loanMetaLabel: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5 },
  loanBalVal: { fontSize: 15, fontWeight: "900", marginTop: 2 },
  loanInstVal: { fontSize: 13, fontWeight: "800", marginTop: 2 },

  progressTrack: { height: 6, borderRadius: 3, width: "100%", overflow: "hidden" },
  progressBar: { height: "100%", borderRadius: 3 },
  progressTextRow: { flexDirection: "row", justifyContent: "space-between" },
  progressSubText: { fontSize: 10, fontWeight: "600" },

  cardCollectBtn: {
    height: 44,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 2,
  },
  cardCollectBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  noLoanWrap: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  noLoanText: { fontSize: 11.5, fontWeight: "600", color: "#10B981" },

  historySection: { paddingHorizontal: 16 },
  historyHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 12,
  },
  historyFilterTabs: { flexDirection: "row", borderRadius: 10, padding: 2 },
  hTab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  hTabText: { fontSize: 11, fontWeight: "700" },

  txCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  txIconBox: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  txClientName: { fontSize: 13, fontWeight: "700" },
  txMetaRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  txPlanTag: { fontSize: 10, fontWeight: "800" },
  txUnionTag: { fontSize: 10.5, fontWeight: "500" },
  pendingHistoryTag: { backgroundColor: "#FEF3C7", paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4 },
  pendingHistoryText: { color: "#D97706", fontSize: 8.5, fontWeight: "800" },
  txAmount: { fontSize: 13.5, fontWeight: "900" },
  txDate: { fontSize: 10, fontWeight: "500", marginTop: 2 },

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
  emptyTitle: { fontSize: 14, fontWeight: "700" },
  emptySub: { fontSize: 11.5, textAlign: "center" },

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
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 4,
  },
  toastText: { fontSize: 12, fontWeight: "700" },

  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 20 },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalSheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalSheetTitle: { fontSize: 17, fontWeight: "800" },
  modalSheetSub: { fontSize: 11.5, marginTop: 2 },
  closeModalBtn: { padding: 4 },

  payoffNoticeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    marginBottom: 12,
  },
  payoffNoticeText: {
    color: "#059669",
    fontSize: 11,
    fontWeight: "700",
    flex: 1,
  },

  modalBalCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8, marginBottom: 14 },
  modalBalRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mBalLabel: { fontSize: 11.5, fontWeight: "600" },
  mBalVal: { fontSize: 12.5, fontWeight: "800" },

  fieldLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  installmentTabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  instTabBtn: {
    flex: 1,
    minWidth: 70,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  instTabCount: { fontSize: 11.5, fontWeight: "800" },
  instTabPrice: { fontSize: 10, marginTop: 2, fontWeight: "600" },

  amountInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  nairaPrefix: { fontSize: 18, fontWeight: "900", marginRight: 6 },
  amountInput: { flex: 1, fontSize: 16, fontWeight: "800", height: "100%" },

  confirmCollectBtn: {
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  confirmCollectBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  receiptOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  receiptBox: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
  },
  receiptTopCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  receiptHeading: { fontSize: 18, fontWeight: "800" },
  receiptSubHeading: { fontSize: 11.5, marginTop: 2, textAlign: "center" },
  receiptSlip: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 8,
    marginVertical: 16,
  },
  receiptSlipRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rLabel: { fontSize: 11.5, fontWeight: "600" },
  rVal: { fontSize: 12, fontWeight: "700" },
  receiptBtnRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  receiptShareBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  receiptShareBtnText: { fontSize: 13, fontWeight: "700" },
  receiptDoneBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  receiptDoneBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});