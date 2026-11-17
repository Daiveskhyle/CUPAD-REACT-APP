import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Dimensions,
  Pressable,
  ScrollView,
  FlatList,
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
  Image,
  Share,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cacheDisbursements,
  cacheClients,
  loadOfflineWorkspace,
  loadCachedClients,
  isOnline,
  saveDisbursementOffline,
  getPendingDisbursementsCount,
  processDisbursementsPendingSync,
} from "../../src/db/database";
import { fetchUnionsForOfficer, mergeUnionNames } from "../../src/db/offlineHelpers";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

const { width } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_DISBURSEMENT = `${API_BASE}/api/disbursement_api.php`;

// LUXURY GOLD & FINTECH SYSTEM PALETTE
const GOLD_PRIMARY = "#F59E0B";
const GOLD_DARK = "#D97706";
const GOLD_GLOW = "rgba(245, 158, 11, 0.14)";
const EMERALD_SUCCESS = "#10B981";
const ROSE_DANGER = "#EF4444";

const CACHE_KEYS = {
  STATS: "cupad_cache_disb_stats",
  CLIENTS: "cupad_cache_disb_clients",
  HISTORY: "cupad_cache_disb_history",
  PLANS: "cupad_cache_disb_plans",
  SETTINGS: "cupad_cache_disb_settings",
  PRIVACY: "cupad_cache_privacy_hide_amounts",
};

const QUICK_AMOUNTS = [10000, 20000, 50000, 100000];

type ClientItem = {
  id: string | number;
  name: string;
  union?: string;
  phone?: string;
  client_type?: string;
  branch_id?: string;
  savings_balance?: number;
  savings?: number;
  total_savings?: number;
  outstanding_loan?: number;
  loan_balance?: number;
  loan_principal?: number;
  principal?: number;
  days_registered?: number;
  last_loan_id?: string | number;
};

type LoanPlan = {
  duration: number;
  installments: number;
  unit: string;
  interest_rate: number;
  min_amount: number;
  max_amount: number;
  increment_amount: number;
  max_first_loan_amount: number;
  savings_requirement_percentage: number;
  disbursement_picture_required?: boolean;
};

type ClientProfile = {
  client_id: string | number;
  client_name: string;
  client_type: string;
  is_first_loan: boolean;
  has_active_loan: boolean;
  active_loan_balance: number;
  max_next_loan: number;
  client_savings: number;
  days_registered: number;
};

type DisbursementEntry = {
  transaction_id: string;
  client_name: string;
  principal: number;
  total_payable: number;
  remaining_balance: number;
  installments: number;
  plan_type: string;
  date: string;
  payoff_date?: string;
  union?: string;
  offline?: boolean;
};

function formatNaira(amount: number | string, hide = false): string {
  if (hide) return "••••••••";
  const num = Math.abs(Number(amount) || 0);
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatRawNumber(amountStr: string): string {
  const cleaned = amountStr.replace(/[^0-9]/g, "");
  if (!cleaned) return "";
  return Number(cleaned).toLocaleString("en-NG");
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

/* ================= DASHBOARD-MATCHED BREATHING ORBS ================= */
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
        opacity: 0.38,
        transform: [{ translateY }, { scale }],
      }}
    />
  );
}

/* ================= SKELETON PLACEHOLDER ================= */
function SkeletonItem({ cardSurfaceBg, glassBorder }: { cardSurfaceBg: string; glassBorder: string }) {
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
    <View style={[styles.txCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
      <Animated.View style={[styles.txIconBox, { backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }]} />
      <View style={{ flex: 1, marginHorizontal: 12, gap: 8 }}>
        <Animated.View style={{ height: 14, width: "65%", borderRadius: 6, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }} />
        <Animated.View style={{ height: 10, width: "35%", borderRadius: 4, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Animated.View style={{ height: 16, width: 80, borderRadius: 6, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }} />
        <Animated.View style={{ height: 10, width: 45, borderRadius: 4, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }} />
      </View>
    </View>
  );
}

export default function DisbursementScreen() {
  const { colors, isDark } = useTheme();

  // Glassmorphic Surface Styling
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(245, 158, 11, 0.16)" : "rgba(245, 158, 11, 0.08)";
  const orbColor2 = isDark ? "rgba(37, 99, 235, 0.12)" : "rgba(37, 99, 235, 0.06)";

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Officer session & Privacy
  const [officerUsername, setOfficerUsername] = useState("");
  const [hideBalances, setHideBalances] = useState(false);
  const [isOfflineState, setIsOfflineState] = useState(false);

  const [stats, setStats] = useState({ monthly_disbursed_count: 0, monthly_disbursed_total: 0 });

  // Loan requirements state
  const [settings, setSettings] = useState<any>({
    min_disbursement: 50000,
    max_disbursement: 200000,
    num_installments: 23,
    interest_rate: 0.15,
    savings_requirement_percentage: 0.20,
    max_first_loan_amount: 50000,
    max_increment_amount: 20000,
    disbursement_picture_required: true,
  });
  const [loanTerms, setLoanTerms] = useState<Record<string, LoanPlan>>({});

  // Offline Sync State
  const [pendingSyncCount, setPendingSyncCount] = useState<number>(0);
  const [isSyncingOffline, setIsSyncingOffline] = useState<boolean>(false);

  // Lists & Filtering
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [unionsList, setUnionsList] = useState<string[]>([]);
  const [selectedUnion, setSelectedUnion] = useState<string>("");

  // Client Selection & Profile
  const [clientModalVisible, setClientModalVisible] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [modalUnionFilter, setModalUnionFilter] = useState<string>("");
  const [selectedClient, setSelectedClient] = useState<ClientItem | null>(null);
  const [clientProfile, setClientProfile] = useState<ClientProfile | null>(null);
  const [fetchingProfile, setFetchingProfile] = useState(false);

  // Form Fields & Proof
  const [principalAmount, setPrincipalAmount] = useState("");
  const [proofImageUri, setProofImageUri] = useState<string | null>(null);
  const [proofBase64, setProofBase64] = useState<string | null>(null);
  const [showFullImageModal, setShowFullImageModal] = useState(false); // Full-Screen Photo Viewer
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Review & Receipt Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // History State
  const [history, setHistory] = useState<DisbursementEntry[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"current_month" | "today" | "all">("all");
  const [historyPage, setHistoryPage] = useState(1);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [loadingMoreHistory, setLoadingMoreHistory] = useState(false);

  // Refresh
  const [refreshing, setRefreshing] = useState(false);

  // Floating Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastY = useRef(new Animated.Value(-60)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

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
    }, 2500);
  };

  const copyTxCode = async (code: string) => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`Ref #${code} copied to clipboard`);
  };

  const toggleHideBalances = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !hideBalances;
    setHideBalances(next);
    await AsyncStorage.setItem(CACHE_KEYS.PRIVACY, String(next));
  };

  const handleShareReceipt = async () => {
    if (!receiptData) return;
    try {
      Haptics.selectionAsync();
      await Share.share({
        message: `Cupad Capital Disbursement Receipt\nBeneficiary: ${receiptData.client_name}\nPrincipal Issued: ${formatNaira(
          receiptData.principal
        )}\nTotal Payable: ${formatNaira(
          receiptData.total_payable
        )}\nTenure: ${receiptData.installments} Installments\nReference: ${receiptData.transaction_id}`,
      });
    } catch {}
  };

  const checkPendingSync = useCallback(async () => {
    try {
      const count = await getPendingDisbursementsCount();
      setPendingSyncCount(count || 0);
    } catch {
      setPendingSyncCount(0);
    }
  }, []);

  const triggerManualSync = async () => {
    if (isSyncingOffline) return;
    setIsSyncingOffline(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const online = await isOnline().catch(() => false);
      if (!online) {
        Alert.alert("Network Unavailable", "Device is offline. Connect to internet to sync queued vouchers.");
        return;
      }
      const synced = await processDisbursementsPendingSync();
      await checkPendingSync();
      if (synced > 0) {
        showToast(`Synchronized ${synced} disbursement(s)`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        if (officerUsername) fetchHistory(1, false, historyFilter);
      } else {
        showToast("All records are up to date");
      }
    } catch {
      Alert.alert("Sync Notice", "Failed to sync pending records. Will retry on next connection.");
    } finally {
      setIsSyncingOffline(false);
    }
  };

  const unionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c) => {
      if (c.union) {
        counts[c.union] = (counts[c.union] || 0) + 1;
      }
    });
    return counts;
  }, [clients]);

  const avgTicketSize = useMemo(() => {
    if (!stats.monthly_disbursed_count || stats.monthly_disbursed_count === 0) return 0;
    return Math.round(stats.monthly_disbursed_total / stats.monthly_disbursed_count);
  }, [stats.monthly_disbursed_total, stats.monthly_disbursed_count]);

  const numericPrincipal = useMemo(() => {
    return Number(principalAmount.replace(/[^0-9]/g, "")) || 0;
  }, [principalAmount]);

  // DERIVES CURRENT LOAN PLAN ACCORDING TO SAVED REQUIREMENTS
  const matchedPlan = useMemo((): LoanPlan => {
    if (!clientProfile) {
      return {
        duration: settings.num_installments || 23,
        installments: settings.num_installments || 23,
        unit: "Days",
        interest_rate: settings.interest_rate || 0.15,
        min_amount: settings.min_disbursement || 20000,
        max_amount: settings.max_disbursement || 200000,
        increment_amount: settings.max_increment_amount || 20000,
        max_first_loan_amount: settings.max_first_loan_amount || 20000,
        savings_requirement_percentage: settings.savings_requirement_percentage || 0.20,
        disbursement_picture_required: settings.disbursement_picture_required ?? true,
      };
    }

    const typeStr = (clientProfile.client_type || "").toLowerCase().trim();
    for (const [key, plan] of Object.entries(loanTerms)) {
      const cleanKey = key.replace(/_/g, " ");
      if (typeStr.includes(cleanKey)) return plan;
    }

    for (const plan of Object.values(loanTerms)) {
      if (numericPrincipal >= plan.min_amount && numericPrincipal <= plan.max_amount) return plan;
    }

    const fallbackKey = Object.keys(loanTerms)[0];
    return loanTerms[fallbackKey] || {
      duration: settings.num_installments || 23,
      installments: settings.num_installments || 23,
      unit: "Days",
      interest_rate: settings.interest_rate || 0.15,
      min_amount: settings.min_disbursement || 20000,
      max_amount: settings.max_disbursement || 200000,
      increment_amount: settings.max_increment_amount || 20000,
      max_first_loan_amount: settings.max_first_loan_amount || 20000,
      savings_requirement_percentage: settings.savings_requirement_percentage || 0.20,
      disbursement_picture_required: settings.disbursement_picture_required ?? true,
    };
  }, [clientProfile, numericPrincipal, loanTerms, settings]);

  const calculations = useMemo(() => {
    if (numericPrincipal <= 0) {
      return { totalPayable: 0, installmentAmount: 0, serviceCharge: 0 };
    }
    const serviceCharge = Math.round(numericPrincipal * (matchedPlan.interest_rate || 0.15));
    const totalPayable = numericPrincipal + serviceCharge;
    const installments = Math.max(1, matchedPlan.installments || 23);
    const installmentAmount = Math.ceil(totalPayable / installments);
    return { totalPayable, installmentAmount, serviceCharge };
  }, [numericPrincipal, matchedPlan]);

  const effectiveMaxLimit = useMemo(() => {
    if (!clientProfile) return matchedPlan.max_amount;
    if (clientProfile.is_first_loan) {
      return Math.min(clientProfile.max_next_loan, matchedPlan.max_first_loan_amount);
    }
    return Math.min(clientProfile.max_next_loan, matchedPlan.max_amount);
  }, [clientProfile, matchedPlan]);

  const limitProgressPct = useMemo(() => {
    if (!effectiveMaxLimit || numericPrincipal <= 0) return 0;
    return Math.min(100, Math.round((numericPrincipal / effectiveMaxLimit) * 100));
  }, [numericPrincipal, effectiveMaxLimit]);

  // ENFORCES REQUIREMENTS (MINIMUM LOAN, SAVINGS REQUIREMENT BUFFER, CEILING)
  const eligibilityStatus = useMemo(() => {
    if (!clientProfile) return { ok: false, msg: "Choose an active borrower to evaluate limit", color: "#64748B" };
    if (clientProfile.has_active_loan) {
      return { ok: false, msg: "Outstanding loan balance must be cleared first", color: ROSE_DANGER };
    }

    if (numericPrincipal <= 0) return { ok: true, msg: "Borrower verified for capital release", color: EMERALD_SUCCESS };

    if (numericPrincipal < matchedPlan.min_amount) {
      return { ok: false, msg: `Below facility minimum (${formatNaira(matchedPlan.min_amount)})`, color: ROSE_DANGER };
    }

    if (numericPrincipal > effectiveMaxLimit) {
      return { ok: false, msg: `Exceeds credit ceiling (${formatNaira(effectiveMaxLimit)})`, color: ROSE_DANGER };
    }

    // SAVINGS REQUIREMENT VERIFICATION
    if (!clientProfile.is_first_loan) {
      const requiredSavingsPercentage = matchedPlan.savings_requirement_percentage || settings.savings_requirement_percentage || 0.20;
      const neededSavings = numericPrincipal * requiredSavingsPercentage;
      if (clientProfile.client_savings < neededSavings) {
        return {
          ok: false,
          msg: `Savings deficient by ${formatNaira(neededSavings - clientProfile.client_savings)} (${Math.round(requiredSavingsPercentage * 100)}% required)`,
          color: GOLD_PRIMARY,
        };
      }
    }

    return { ok: true, msg: "Credit conditions fully satisfied", color: EMERALD_SUCCESS };
  }, [clientProfile, numericPrincipal, matchedPlan, effectiveMaxLimit, settings]);

  const submitButtonLabel = useMemo(() => {
    if (!selectedClient) return "Select Borrower to Begin";
    if (fetchingProfile) return "Verifying Underwriting Profile...";
    if (!clientProfile) return "Select Borrower";
    if (clientProfile.has_active_loan) return "Release Blocked: Active Loan";
    if (numericPrincipal <= 0) return "Specify Capital Amount";
    if (numericPrincipal < matchedPlan.min_amount) return `Min Amount is ${formatNaira(matchedPlan.min_amount)}`;
    if (numericPrincipal > effectiveMaxLimit) return `Exceeds Ceiling (${formatNaira(effectiveMaxLimit)})`;
    if (settings.disbursement_picture_required && !proofBase64) return "Take Proof Photo to Authorize";
    return `Authorize & Release ${formatNaira(numericPrincipal)}`;
  }, [selectedClient, fetchingProfile, clientProfile, numericPrincipal, matchedPlan, effectiveMaxLimit, settings, proofBase64]);

  const isSubmitDisabled = useMemo(() => {
    return (
      isSubmitting ||
      !selectedClient ||
      !clientProfile ||
      !eligibilityStatus.ok ||
      numericPrincipal <= 0 ||
      (settings.disbursement_picture_required && !proofBase64)
    );
  }, [isSubmitting, selectedClient, clientProfile, eligibilityStatus.ok, numericPrincipal, settings, proofBase64]);

  const loadUser = useCallback(async () => {
    try {
      const [stored, storedPrivacy] = await Promise.all([
        AsyncStorage.getItem("cupad_user"),
        AsyncStorage.getItem(CACHE_KEYS.PRIVACY),
      ]);
      if (storedPrivacy !== null) setHideBalances(storedPrivacy === "true");
      if (stored) {
        const u = JSON.parse(stored);
        setOfficerUsername(u.username || "");
        return u.username || "";
      }
    } catch {}
    return "";
  }, []);

  // HYDRATES SAVED REQUIREMENTS LOCALLY (0ms instant offline startup)
  const hydrateLocalRequirements = useCallback(async () => {
    try {
      const [storedSettings, storedPlans, storedStats] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEYS.SETTINGS),
        AsyncStorage.getItem(CACHE_KEYS.PLANS),
        AsyncStorage.getItem(CACHE_KEYS.STATS),
      ]);

      if (storedSettings) {
        const parsed = JSON.parse(storedSettings);
        if (parsed && typeof parsed === "object") {
          setSettings((prev: any) => ({ ...prev, ...parsed }));
        }
      }

      if (storedPlans) {
        const parsedPlans = JSON.parse(storedPlans);
        if (parsedPlans && typeof parsedPlans === "object") {
          setLoanTerms(parsedPlans);
        }
      }

      if (storedStats) {
        const parsedStats = JSON.parse(storedStats);
        if (parsedStats) setStats(parsedStats);
      }
    } catch (e) {
      console.log("Error hydrating offline requirements:", e);
    }
  }, []);

  // FAST SQLITE CACHE FIRST HYDRATION
  const hydrateFromSqlite = useCallback(async (user: string) => {
    try {
      const ws = await loadOfflineWorkspace(user);
      if (ws && Array.isArray(ws.clients) && ws.clients.length > 0) {
        setClients(ws.clients);
        if (Array.isArray(ws.unionNames) && ws.unionNames.length > 0) {
          setUnionsList(ws.unionNames);
          setSelectedUnion((prev) => (prev && ws.unionNames.includes(prev) ? prev : ws.unionNames[0]));
          setModalUnionFilter((prev) => (prev && ws.unionNames.includes(prev) ? prev : ws.unionNames[0]));
        }
        if (Array.isArray(ws.disbursements) && ws.disbursements.length > 0) {
          setHistory(ws.disbursements);
        }
      }
    } catch (e) {
      console.log("SQLite disbursement load error:", e);
    }
  }, []);

  // FETCH DISBURSEMENT REQUIREMENTS & SAVE LOCALLY FOR OFFLINE USE
  const fetchInitData = useCallback(async (user: string) => {
    if (!user) return;

    await Promise.all([hydrateLocalRequirements(), hydrateFromSqlite(user)]);

    try {
      const online = await isOnline().catch(() => false);
      if (!online) {
        setIsOfflineState(true);
        await checkPendingSync();
        return;
      }

      const res = await axios.get(`${API_DISBURSEMENT}?action=init&username=${encodeURIComponent(user)}`, { timeout: 8000 });
      if (res.data?.success) {
        setIsOfflineState(false);
        const serverClients = res.data.clients || [];
        setClients(serverClients);

        const fromInit = Array.isArray(res.data.unions)
          ? res.data.unions.map((u: any) => (typeof u === "string" ? u : u?.name)).filter(Boolean)
          : [];
        const fromClients = Array.from(new Set(serverClients.map((c: any) => c.union).filter(Boolean))) as string[];

        let fromApi: string[] = [];
        try {
          const uf = await fetchUnionsForOfficer(user);
          fromApi = uf.names || [];
        } catch {}

        const incomingUnions = mergeUnionNames(fromApi, fromInit, fromClients);
        setUnionsList(incomingUnions);
        if (incomingUnions.length > 0) {
          setSelectedUnion((prev) => (prev && incomingUnions.includes(prev) ? prev : incomingUnions[0]));
          setModalUnionFilter((prev) => (prev && incomingUnions.includes(prev) ? prev : incomingUnions[0]));
        }

        const incomingSettings = res.data.settings || res.data.requirements || {};
        const incomingTerms = res.data.loan_terms || res.data.plans || {};

        if (Object.keys(incomingSettings).length > 0) {
          setSettings((prev: any) => {
            const updated = { ...prev, ...incomingSettings };
            AsyncStorage.setItem(CACHE_KEYS.SETTINGS, JSON.stringify(updated)).catch(() => {});
            return updated;
          });
        }

        if (Object.keys(incomingTerms).length > 0) {
          setLoanTerms(incomingTerms);
          await AsyncStorage.setItem(CACHE_KEYS.PLANS, JSON.stringify(incomingTerms));
        }

        if (res.data.stats) {
          setStats(res.data.stats);
          await AsyncStorage.setItem(CACHE_KEYS.STATS, JSON.stringify(res.data.stats));
        }

        await AsyncStorage.setItem(CACHE_KEYS.CLIENTS, JSON.stringify(serverClients));
        
        cacheClients(serverClients, user).catch(() => {});
        if (res.data.disbursements) {
          cacheDisbursements(res.data.disbursements, user).catch(() => {});
        }
      }
    } catch {
      setIsOfflineState(true);
    } finally {
      checkPendingSync();
    }
  }, [hydrateLocalRequirements, hydrateFromSqlite, checkPendingSync]);

  const fetchHistory = useCallback(
    async (pageNum = 1, append = false, filter = historyFilter, union = selectedUnion) => {
      if (!officerUsername) return;
      if (!append) setHistoryLoading(true);
      else setLoadingMoreHistory(true);

      const online = await isOnline().catch(() => false);
      if (!online) {
        try {
          const ws = await loadOfflineWorkspace(officerUsername);
          if (ws?.disbursements && Array.isArray(ws.disbursements) && ws.disbursements.length > 0) {
            setHistory(ws.disbursements);
          }
        } catch {}
        setHistoryLoading(false);
        setLoadingMoreHistory(false);
        return;
      }

      try {
        const res = await axios.get(
          `${API_DISBURSEMENT}?action=history&username=${encodeURIComponent(
            officerUsername
          )}&filter=${filter}&union=${encodeURIComponent(union)}&page=${pageNum}&limit=12`,
          { timeout: 9000 }
        );

        if (res.data?.success && Array.isArray(res.data.entries)) {
          if (append) {
            setHistory((prev) => [...prev, ...res.data.entries]);
          } else {
            setHistory(res.data.entries);
            AsyncStorage.setItem(CACHE_KEYS.HISTORY, JSON.stringify(res.data.entries)).catch(() => {});
          }
          setHasMoreHistory(Boolean(res.data.has_more));
          setHistoryPage(pageNum);
        }
      } catch {
        if (pageNum === 1) {
          const cached = await AsyncStorage.getItem(CACHE_KEYS.HISTORY);
          if (cached) setHistory(JSON.parse(cached));
        }
      } finally {
        setHistoryLoading(false);
        setLoadingMoreHistory(false);
      }
    },
    [officerUsername, historyFilter, selectedUnion]
  );

  const buildOfflineClientProfile = useCallback(
    (c: ClientItem & Record<string, any>): ClientProfile => {
      const outstanding = Number(c.outstanding_loan ?? c.loan_balance ?? 0);
      const savings = Number(c.savings_balance ?? c.savings ?? c.total_savings ?? 0);
      const hasActive = outstanding > 0.5;
      const priorPrincipal = Number(c.loan_principal ?? c.principal ?? 0);
      const isFirst = !hasActive && priorPrincipal <= 0 && !c.last_loan_id;
      const maxDisb = Number(settings.max_disbursement || 200000);
      const maxFirst = Number(settings.max_first_loan_amount || 20000);
      const maxNext = isFirst
        ? maxFirst
        : Math.min(
            maxDisb,
            Math.max(
              maxFirst,
              priorPrincipal > 0 ? priorPrincipal + Number(settings.max_increment_amount || 20000) : maxDisb
            )
          );

      return {
        client_id: c.id,
        client_name: c.name,
        client_type: c.client_type || "regular",
        is_first_loan: isFirst,
        has_active_loan: hasActive,
        active_loan_balance: outstanding,
        max_next_loan: maxNext,
        client_savings: savings,
        days_registered: Number(c.days_registered ?? 365),
      };
    },
    [settings]
  );

  const selectClient = async (c: ClientItem) => {
    setSelectedClient(c);
    setClientModalVisible(false);
    setFetchingProfile(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const online = await isOnline().catch(() => false);
    if (!online) {
      let cached: any = c;
      try {
        const ws = await loadOfflineWorkspace(officerUsername);
        const found = ws?.clients?.find(
          (x: any) => String(x.id) === String(c.id) || String(x.client_id) === String(c.id)
        );
        if (found) cached = { ...c, ...found };
      } catch {}
      setClientProfile(buildOfflineClientProfile(cached));
      setFetchingProfile(false);
      return;
    }

    try {
      const res = await axios.get(`${API_DISBURSEMENT}?action=get_client_profile&client_id=${c.id}`, {
        timeout: 7000,
      });
      if (res.data?.success) {
        setClientProfile(res.data.data);
      } else {
        setClientProfile(buildOfflineClientProfile(c as any));
      }
    } catch {
      setClientProfile(buildOfflineClientProfile(c as any));
    } finally {
      setFetchingProfile(false);
    }
  };

  // CAMERA ONLY - UNCROPPED WITH LIGHTWEIGHT 0.3 QUALITY
  const captureProofPhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Camera Permission Required",
          "Camera access is mandatory to capture the disbursement handover proof."
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        quality: 0.3,
        base64: true,
        allowsEditing: false, // Cropping disabled
      });

      if (!result.canceled && result.assets?.[0]) {
        setProofImageUri(result.assets[0].uri);
        setProofBase64(`data:image/jpeg;base64,${result.assets[0].base64}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert("Camera Error", "Could not capture image from camera.");
    }
  };

  const initiateSubmit = () => {
    if (!selectedClient || !clientProfile) {
      Alert.alert("Missing Borrower", "Please designate a borrower client to continue.");
      return;
    }

    if (numericPrincipal <= 0) {
      Alert.alert("Invalid Amount", "Please input a valid principal capital amount.");
      return;
    }

    if (!eligibilityStatus.ok) {
      Alert.alert("Underwriting Condition Block", eligibilityStatus.msg);
      return;
    }

    if (settings.disbursement_picture_required && !proofBase64) {
      Alert.alert("Handover Proof Mandatory", "Please take a live photo of the client receiving the disbursement.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setShowConfirmModal(true);
  };

  const handleFinalDisbursement = async () => {
    setShowConfirmModal(false);
    setIsSubmitting(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    const dateStr = new Date().toISOString().slice(0, 19).replace("T", " ");
    const tempTxId = `DISB-OFF-${Date.now().toString(36).toUpperCase()}`;

    const payload = {
      action: "record_disbursement",
      client_id: selectedClient!.id,
      principal_amount: numericPrincipal,
      officer: officerUsername,
      picture_base64: proofBase64,
      date: dateStr,
    };

    try {
      await saveDisbursementOffline({
        tempTxId,
        clientId: selectedClient!.id,
        clientName: selectedClient!.name || clientProfile?.client_name,
        principal: numericPrincipal,
        totalPayable: calculations.totalPayable,
        remainingBalance: calculations.totalPayable,
        installments: matchedPlan.installments || 23,
        planType: clientProfile?.is_first_loan ? "first_loan" : "repeat_loan",
        date: dateStr,
        officer: officerUsername,
        union: selectedClient!.union || selectedUnion,
        pictureBase64: proofBase64,
      });
    } catch (sqliteErr) {
      console.log("Local SQLite write note:", sqliteErr);
    }

    const online = await isOnline().catch(() => false);
    if (online) {
      try {
        const res = await axios.post(API_DISBURSEMENT, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 10000,
        });

        if (res.data?.success) {
          setReceiptData(res.data.transaction);
          setShowReceiptModal(true);
        } else {
          setReceiptData({
            transaction_id: tempTxId,
            client_name: selectedClient!.name,
            principal: numericPrincipal,
            total_payable: calculations.totalPayable,
            remaining_balance: calculations.totalPayable,
            installments: matchedPlan.installments || 23,
            plan_type: "offline_queued",
            date: dateStr,
            payoff_date: "",
            union: selectedClient!.union || selectedUnion || "",
            offline: true,
          });
          setShowReceiptModal(true);
        }
      } catch {
        setReceiptData({
          transaction_id: tempTxId,
          client_name: selectedClient!.name,
          principal: numericPrincipal,
          total_payable: calculations.totalPayable,
          remaining_balance: calculations.totalPayable,
          installments: matchedPlan.installments || 23,
          plan_type: "offline_queued",
          date: dateStr,
          payoff_date: "",
          union: selectedClient!.union || selectedUnion || "",
          offline: true,
        });
        setShowReceiptModal(true);
      }
    } else {
      setReceiptData({
        transaction_id: tempTxId,
        client_name: selectedClient!.name,
        principal: numericPrincipal,
        total_payable: calculations.totalPayable,
        remaining_balance: calculations.totalPayable,
        installments: matchedPlan.installments || 23,
        plan_type: "offline_queued",
        date: dateStr,
        payoff_date: "",
        union: selectedClient!.union || selectedUnion || "",
        offline: true,
      });
      setShowReceiptModal(true);
    }

    setStats((prev) => ({
      monthly_disbursed_count: (prev?.monthly_disbursed_count || 0) + 1,
      monthly_disbursed_total: (prev?.monthly_disbursed_total || 0) + numericPrincipal,
    }));

    setPrincipalAmount("");
    setProofImageUri(null);
    setProofBase64(null);
    setSelectedClient(null);
    setClientProfile(null);
    checkPendingSync();
    setIsSubmitting(false);
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (officerUsername) {
      await Promise.all([
        fetchInitData(officerUsername),
        fetchHistory(1, false, historyFilter),
        checkPendingSync(),
      ]);
    }
    setRefreshing(false);
  }, [officerUsername, historyFilter, fetchInitData, fetchHistory, checkPendingSync]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    loadUser().then((u) => {
      if (u) {
        fetchInitData(u);
        fetchHistory(1, false, "all");
      }
    });
  }, [loadUser, fetchInitData, fetchHistory, fadeAnim]);

  const filteredModalClients = useMemo(() => {
    return clients.filter((c) => {
      const matchUnion =
        !modalUnionFilter || (c.union && c.union.toLowerCase() === modalUnionFilter.toLowerCase());
      const query = clientSearch.toLowerCase().trim();
      const matchQuery = !query || c.name.toLowerCase().includes(query) || (c.phone && c.phone.includes(query));
      return matchUnion && matchQuery;
    });
  }, [clients, modalUnionFilter, clientSearch]);

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

  const fuelColor =
    limitProgressPct > 100 ? ROSE_DANGER : limitProgressPct > 80 ? GOLD_DARK : GOLD_PRIMARY;

  return (
    <CoScreenWrapper>
      {/* Ambient Dashboard Breathing Orbs */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={270} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={420} delay={2000} />
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
          <Ionicons name="checkmark-circle" size={16} color={EMERALD_SUCCESS} />
          <Text style={[styles.toastText, { color: colors.text }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Animated.ScrollView
          style={{ flex: 1, opacity: fadeAnim }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={GOLD_PRIMARY}
              colors={[GOLD_PRIMARY]}
            />
          }
        >
          {/* OFFLINE SYNC ALERT BANNER */}
          {pendingSyncCount > 0 && (
            <Pressable
              onPress={triggerManualSync}
              disabled={isSyncingOffline}
              style={({ pressed }) => [
                styles.syncNoticeCard,
                {
                  backgroundColor: "rgba(245, 158, 11, 0.15)",
                  borderColor: GOLD_PRIMARY,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <View style={styles.syncNoticeLeft}>
                <View style={[styles.syncIconWrap, { backgroundColor: GOLD_PRIMARY }]}>
                  <Ionicons name="cloud-offline" size={15} color="#0F172A" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.syncTitle, { color: GOLD_DARK }]}>
                    {pendingSyncCount} Disbursement{pendingSyncCount > 1 ? "s" : ""} Queued Offline
                  </Text>
                  <Text style={[styles.syncSubtitle, { color: colors.textMuted }]}>
                    Tap to synchronize vouchers with central ledger
                  </Text>
                </View>
              </View>
              {isSyncingOffline ? (
                <ActivityIndicator size="small" color={GOLD_PRIMARY} />
              ) : (
                <View style={[styles.syncActionBtn, { backgroundColor: GOLD_PRIMARY }]}>
                  <Text style={styles.syncActionText}>Sync Now</Text>
                </View>
              )}
            </Pressable>
          )}

          {/* HERO FACILITY SUMMARY CARD */}
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
                  { backgroundColor: isOfflineState ? "rgba(245, 158, 11, 0.15)" : "rgba(245, 158, 11, 0.15)" },
                ]}
              >
                <View
                  style={[styles.statusPulseDot, { backgroundColor: isOfflineState ? "#F59E0B" : GOLD_PRIMARY }]}
                />
                <Text style={[styles.heroTagText, { color: GOLD_PRIMARY }]}>
                  {isOfflineState ? "OFFLINE CAPITAL VAULT" : "LIVE CAPITAL FACILITY"}
                </Text>
              </View>

              <View
                style={[
                  styles.syncTimePill,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)" },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={12} color={colors.textMuted} />
                <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>
                  {isOfflineState ? "Rules Cached" : "Audited"}
                </Text>
              </View>
            </View>

            <View style={styles.heroMainBalanceSection}>
              <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                TOTAL DISBURSED CAPITAL (MTD)
              </Text>
              <View style={styles.heroAmountRow}>
                <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                  {formatNaira(stats.monthly_disbursed_total, hideBalances)}
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

            <View style={styles.portfolioRatioContainer}>
              <View style={styles.ratioHeader}>
                <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                  Average Loan Ticket: {formatNaira(avgTicketSize, hideBalances)}
                </Text>
                <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                  {stats.monthly_disbursed_count} Loans Released
                </Text>
              </View>
              <View style={styles.ratioTrack}>
                <View
                  style={[
                    styles.ratioLoansBar,
                    {
                      width: `${Math.min(
                        100,
                        settings.max_disbursement > 0 ? (avgTicketSize / settings.max_disbursement) * 100 : 50
                      )}%`,
                    },
                  ]}
                />
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
                  <Ionicons name="paper-plane" size={11} color={GOLD_PRIMARY} />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Total Releases</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>
                  {stats.monthly_disbursed_count}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Active facilities</Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="business" size={11} color="#3B82F6" />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Active Centers</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: "#3B82F6" }]}>
                  {unionsList.length}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Union branches</Text>
              </View>
            </View>
          </LinearGradient>

          {/* UNION CENTERS SELECTOR */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Portfolio Centers</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Select operating group</Text>
            </View>
            <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Text style={[styles.badgeCountText, { color: colors.textMuted }]}>
                {unionsList.length}
              </Text>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.unionScrollContainer}
          >
            {unionsList.map((u) => {
              const isSelected = selectedUnion.toLowerCase() === u.toLowerCase();
              const count = unionCounts[u] || 0;
              return (
                <Pressable
                  key={u}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedUnion(u);
                    fetchHistory(1, false, historyFilter, u);
                  }}
                  style={({ pressed }) => [
                    styles.unionTabPill,
                    {
                      backgroundColor: isSelected ? GOLD_PRIMARY : cardSurfaceBg,
                      borderColor: isSelected ? GOLD_PRIMARY : glassBorder,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    },
                  ]}
                >
                  <Ionicons
                    name="people"
                    size={13}
                    color={isSelected ? "#0F172A" : GOLD_PRIMARY}
                  />
                  <Text
                    style={[
                      styles.unionTabPillText,
                      { color: isSelected ? "#0F172A" : colors.text },
                    ]}
                  >
                    {u}
                  </Text>
                  <View
                    style={[
                      styles.unionTabCountBadge,
                      {
                        backgroundColor: isSelected
                          ? "rgba(15, 23, 42, 0.16)"
                          : isDark
                          ? "rgba(255, 255, 255, 0.08)"
                          : "#E2E8F0",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.unionTabCountText,
                        { color: isSelected ? "#0F172A" : colors.text },
                      ]}
                    >
                      {count}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* MAIN FORM */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Execute Loan Facility</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                Underwriting & verified fund release
              </Text>
            </View>
          </View>

          <View style={[styles.formCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            {/* BENEFICIARY PICKER */}
            <View style={styles.fieldBlock}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>BENEFICIARY BORROWER</Text>
              {!selectedClient ? (
                <Pressable
                  onPress={() => {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    setModalUnionFilter(selectedUnion || unionsList[0] || "");
                    setClientModalVisible(true);
                  }}
                  style={({ pressed }) => [
                    styles.clientPickerBtn,
                    {
                      backgroundColor: colors.background,
                      borderColor: glassBorder,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                >
                  <View style={styles.pickerLeft}>
                    <View style={[styles.pickerAvatarPlaceholder, { backgroundColor: GOLD_GLOW }]}>
                      <Ionicons name="person-add" size={15} color={GOLD_PRIMARY} />
                    </View>
                    <Text style={[styles.clientPickerText, { color: colors.textMuted }]}>
                      Tap to select center member...
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                </Pressable>
              ) : (
                <View style={[styles.selectedClientCard, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                  <View style={[styles.selAvatar, { backgroundColor: GOLD_PRIMARY }]}>
                    <Text style={styles.selAvatarText}>{selectedClient.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 10 }}>
                    <Text style={[styles.selClientName, { color: colors.text }]} numberOfLines={1}>
                      {selectedClient.name}
                    </Text>
                    <Text style={[styles.selClientMeta, { color: colors.textMuted }]}>
                      {selectedClient.phone || "No phone"} • {selectedClient.union || "Center"}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      setModalUnionFilter(selectedClient.union || selectedUnion || unionsList[0] || "");
                      setClientModalVisible(true);
                    }}
                    style={({ pressed }) => [
                      styles.changeClientBtn,
                      {
                        backgroundColor: GOLD_GLOW,
                        transform: [{ scale: pressed ? 0.94 : 1 }],
                      },
                    ]}
                  >
                    <Text style={[styles.changeClientText, { color: GOLD_DARK }]}>Change</Text>
                  </Pressable>
                </View>
              )}
            </View>

            {/* PROFILE LOADER / CREDIT CARD */}
            {fetchingProfile && (
              <View style={styles.profileLoading}>
                <ActivityIndicator size="small" color={GOLD_PRIMARY} />
                <Text style={[styles.profileLoadingText, { color: colors.textMuted }]}>
                  Evaluating credit profile from database...
                </Text>
              </View>
            )}

            {clientProfile && !fetchingProfile && (
              <View
                style={[
                  styles.creditCard,
                  {
                    backgroundColor: colors.background,
                    borderColor: eligibilityStatus.ok ? "rgba(245, 158, 11, 0.35)" : "rgba(239, 68, 68, 0.35)",
                  },
                ]}
              >
                <View
                  style={[
                    styles.creditCardBanner,
                    { backgroundColor: eligibilityStatus.ok ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)" },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
                    <Ionicons
                      name={eligibilityStatus.ok ? "checkmark-circle" : "alert-circle"}
                      size={15}
                      color={eligibilityStatus.ok ? GOLD_DARK : ROSE_DANGER}
                    />
                    <Text
                      style={[
                        styles.creditBannerText,
                        { color: eligibilityStatus.ok ? GOLD_DARK : ROSE_DANGER },
                      ]}
                      numberOfLines={1}
                    >
                      {eligibilityStatus.msg}
                    </Text>
                  </View>
                  {clientProfile.is_first_loan && (
                    <View style={[styles.firstLoanTag, { backgroundColor: GOLD_PRIMARY }]}>
                      <Text style={styles.firstLoanTagText}>First Loan</Text>
                    </View>
                  )}
                </View>

                <View style={styles.creditMetricsRow}>
                  <View style={styles.creditMetric}>
                    <Text style={styles.cMetricLabel}>QUALIFYING SAVINGS</Text>
                    <Text style={[styles.cMetricVal, { color: "#10B981" }]}>
                      {formatNaira(clientProfile.client_savings, hideBalances)}
                    </Text>
                  </View>
                  <View style={[styles.metricDivider, { backgroundColor: glassBorder }]} />
                  <View style={styles.creditMetric}>
                    <Text style={styles.cMetricLabel}>CREDIT CEILING</Text>
                    <Text style={[styles.cMetricVal, { color: "#3B82F6" }]}>
                      {formatNaira(effectiveMaxLimit, hideBalances)}
                    </Text>
                  </View>
                </View>

                {clientProfile.has_active_loan && (
                  <View style={styles.activeLoanAlert}>
                    <Ionicons name="warning" size={14} color={ROSE_DANGER} />
                    <Text style={styles.activeLoanAlertText}>
                      Existing active debt unpaid: {formatNaira(clientProfile.active_loan_balance, hideBalances)}
                    </Text>
                  </View>
                )}
              </View>
            )}

            {/* LOAN PLAN TERMS & REQUIREMENTS */}
            <View style={[styles.planCard, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
              <View style={styles.planCardHead}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="calendar-outline" size={15} color={GOLD_PRIMARY} />
                  <Text style={[styles.planCardTitle, { color: colors.text }]}>
                    {matchedPlan.duration} {matchedPlan.unit} Repayment Tenure
                  </Text>
                </View>
                <View style={[styles.interestBadge, { backgroundColor: GOLD_GLOW }]}>
                  <Text style={[styles.interestBadgeText, { color: GOLD_DARK }]}>
                    {Math.round(matchedPlan.interest_rate * 100)}% Facility Fee
                  </Text>
                </View>
              </View>
              <View style={styles.planLimitsRow}>
                <Text style={[styles.planLimitText, { color: colors.textMuted }]}>
                  Limit: {formatNaira(matchedPlan.min_amount)} – {formatNaira(effectiveMaxLimit)}
                </Text>
                <Text style={[styles.planLimitText, { color: colors.textMuted }]}>
                  Req. Savings: {Math.round((matchedPlan.savings_requirement_percentage || settings.savings_requirement_percentage || 0.2) * 100)}%
                </Text>
              </View>
            </View>

            {/* PRINCIPAL AMOUNT INPUT */}
            <View style={styles.fieldBlock}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>CAPITAL PRINCIPAL AMOUNT</Text>
                {clientProfile && (
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setPrincipalAmount(formatRawNumber(String(effectiveMaxLimit)));
                    }}
                    hitSlop={8}
                  >
                    <Text style={[styles.fillMaxText, { color: GOLD_DARK }]}>
                      Max Ceiling ({formatNaira(effectiveMaxLimit)})
                    </Text>
                  </Pressable>
                )}
              </View>

              <View style={[styles.amountInputWrap, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                <Text style={[styles.nairaPrefix, { color: GOLD_DARK }]}>₦</Text>
                <TextInput
                  value={principalAmount}
                  onChangeText={(val) => setPrincipalAmount(formatRawNumber(val))}
                  placeholder="0"
                  placeholderTextColor={colors.textMuted}
                  keyboardType="numeric"
                  style={[styles.amountInput, { color: colors.text }]}
                />
                {principalAmount.length > 0 && (
                  <Pressable onPress={() => setPrincipalAmount("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* UTILIZATION PROGRESS BAR */}
              {clientProfile && (
                <View style={styles.progressContainer}>
                  <View style={[styles.progressTrack, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.08)" : "#E2E8F0" }]}>
                    <View
                      style={[
                        styles.progressBar,
                        {
                          width: `${limitProgressPct}%`,
                          backgroundColor: fuelColor,
                        },
                      ]}
                    />
                  </View>
                  <View style={styles.progressLabelRow}>
                    <Text style={[styles.progressHelpText, { color: colors.textMuted }]}>
                      {limitProgressPct}% of maximum ceiling utilized
                    </Text>
                    {limitProgressPct > 100 && (
                      <Text style={styles.progressOverText}>
                        Exceeds by {formatNaira(numericPrincipal - effectiveMaxLimit)}
                      </Text>
                    )}
                  </View>
                </View>
              )}

              {/* QUICK PRESETS */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickPresetRow}>
                {clientProfile && effectiveMaxLimit > 0 && (
                  <>
                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPrincipalAmount(formatRawNumber(String(Math.round(effectiveMaxLimit * 0.25))));
                      }}
                      style={[styles.presetChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9", borderColor: glassBorder }]}
                    >
                      <Text style={[styles.presetChipText, { color: colors.text }]}>25%</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPrincipalAmount(formatRawNumber(String(Math.round(effectiveMaxLimit * 0.5))));
                      }}
                      style={[styles.presetChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9", borderColor: glassBorder }]}
                    >
                      <Text style={[styles.presetChipText, { color: colors.text }]}>50%</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setPrincipalAmount(formatRawNumber(String(Math.round(effectiveMaxLimit * 0.75))));
                      }}
                      style={[styles.presetChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9", borderColor: glassBorder }]}
                    >
                      <Text style={[styles.presetChipText, { color: colors.text }]}>75%</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => {
                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                        setPrincipalAmount(formatRawNumber(String(effectiveMaxLimit)));
                      }}
                      style={[styles.presetChip, { backgroundColor: GOLD_GLOW, borderColor: GOLD_PRIMARY }]}
                    >
                      <Text style={[styles.presetChipText, { color: GOLD_DARK, fontWeight: "800" }]}>
                        Max (100%)
                      </Text>
                    </Pressable>
                  </>
                )}

                {QUICK_AMOUNTS.map((amt) => (
                  <Pressable
                    key={amt}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      const nextVal = numericPrincipal + amt;
                      setPrincipalAmount(formatRawNumber(String(nextVal)));
                    }}
                    style={[styles.presetChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9", borderColor: glassBorder }]}
                  >
                    <Text style={[styles.presetChipText, { color: colors.text }]}>
                      +{amt >= 1000 ? `${amt / 1000}k` : amt}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            </View>

            {/* BREAKDOWN */}
            <View style={styles.calcGrid}>
              <View style={[styles.calcBox, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                <Text style={styles.calcLabel}>SERVICE CHARGE</Text>
                <Text style={[styles.calcValue, { color: colors.text }]}>
                  {formatNaira(calculations.serviceCharge, hideBalances)}
                </Text>
              </View>

              <View style={[styles.calcBox, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                <Text style={styles.calcLabel}>GROSS DUE</Text>
                <Text style={[styles.calcValue, { color: colors.text }]}>
                  {formatNaira(calculations.totalPayable, hideBalances)}
                </Text>
              </View>

              <View style={[styles.calcBox, { backgroundColor: GOLD_GLOW, borderColor: "rgba(245, 158, 11, 0.3)" }]}>
                <Text style={[styles.calcLabel, { color: GOLD_DARK }]}>DAILY DUE</Text>
                <Text style={[styles.calcValue, { color: GOLD_DARK }]}>
                  {formatNaira(calculations.installmentAmount, hideBalances)}
                </Text>
              </View>
            </View>

            {/* HANDOVER PHOTO ATTACHMENT - FULL PICTURE PREVIEW */}
            <View style={styles.fieldBlock}>
              <View style={styles.photoHeaderRow}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                  HANDOVER PROOF {settings.disbursement_picture_required && <Text style={{ color: ROSE_DANGER }}>*</Text>}
                </Text>
                <Pressable onPress={captureProofPhoto} style={[styles.photoActionChip, { backgroundColor: GOLD_GLOW }]}>
                  <Ionicons name="camera" size={13} color={GOLD_DARK} />
                  <Text style={[styles.photoActionText, { color: GOLD_DARK }]}>
                    {proofImageUri ? "Retake" : "Open Camera"}
                  </Text>
                </Pressable>
              </View>

              {proofImageUri ? (
                <View style={[styles.previewWrap, { borderColor: glassBorder }]}>
                  {/* Tap to inspect full-screen */}
                  <Pressable
                    style={{ flex: 1, width: "100%", height: "100%" }}
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowFullImageModal(true);
                    }}
                  >
                    <Image source={{ uri: proofImageUri }} style={styles.previewImage} resizeMode="contain" />
                  </Pressable>

                  {/* Tap Full View Overlay Tag */}
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowFullImageModal(true);
                    }}
                    style={styles.expandImageBtn}
                  >
                    <Ionicons name="scan-outline" size={13} color="#FFFFFF" />
                    <Text style={styles.expandImageText}>Expand Full</Text>
                  </Pressable>

                  <View style={styles.photoVerifiedBadge}>
                    <Ionicons name="checkmark-circle" size={13} color={GOLD_PRIMARY} />
                    <Text style={styles.photoVerifiedText}>Camera Photo (Full View)</Text>
                  </View>

                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setProofImageUri(null);
                      setProofBase64(null);
                    }}
                    style={styles.removeImageBtn}
                  >
                    <Ionicons name="trash" size={14} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <Pressable
                  onPress={captureProofPhoto}
                  style={[styles.uploadBox, { backgroundColor: colors.background, borderColor: glassBorder }]}
                >
                  <View style={[styles.uploadIconCircle, { backgroundColor: GOLD_GLOW }]}>
                    <Ionicons name="camera" size={20} color={GOLD_PRIMARY} />
                  </View>
                  <Text style={[styles.uploadBoxText, { color: colors.text }]}>Snap Live Cash Handover Photo</Text>
                  <Text style={[styles.uploadBoxSub, { color: colors.textMuted }]}>
                    Camera snapshot required for audit integrity & anti-fraud
                  </Text>
                </Pressable>
              )}
            </View>

            {/* AUTHORIZE BUTTON */}
            <Pressable
              onPress={initiateSubmit}
              disabled={isSubmitDisabled}
              style={({ pressed }) => [
                styles.submitBtn,
                {
                  backgroundColor: GOLD_PRIMARY,
                  opacity: isSubmitDisabled ? 0.45 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <Ionicons name="arrow-up-circle" size={20} color="#0F172A" />
              <Text style={styles.submitBtnText}>{submitButtonLabel}</Text>
            </Pressable>
          </View>

          {/* AUDITED RECENT DISBURSEMENTS */}
          <View style={[styles.sectionHeader, { marginTop: 24 }]}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Disbursement Audit Log</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                Verified capital release vouchers
              </Text>
            </View>
            <View style={styles.historyFilterTabs}>
              {(["all", "current_month", "today"] as const).map((f) => (
                <Pressable
                  key={f}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setHistoryFilter(f);
                    fetchHistory(1, false, f, selectedUnion);
                  }}
                  style={[
                    styles.hTab,
                    {
                      backgroundColor: historyFilter === f ? GOLD_PRIMARY : "transparent",
                    },
                  ]}
                >
                  <Text style={[styles.hTabText, { color: historyFilter === f ? "#0F172A" : colors.textMuted }]}>
                    {f === "all" ? "All" : f === "current_month" ? "Month" : "Today"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {history.length > 2 && (
            <View style={[styles.searchContainer, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, marginBottom: 10 }]}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={historySearch}
                onChangeText={setHistorySearch}
                placeholder="Search recent client or Ref voucher..."
                placeholderTextColor={colors.textMuted}
                style={[styles.searchInput, { color: colors.text }]}
              />
              {historySearch.length > 0 && (
                <Pressable onPress={() => setHistorySearch("")} hitSlop={6}>
                  <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                </Pressable>
              )}
            </View>
          )}

          {historyLoading ? (
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              <SkeletonItem cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
              <SkeletonItem cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
            </View>
          ) : filteredHistory.length === 0 ? (
            <View style={[styles.emptyBox, { borderColor: glassBorder, backgroundColor: cardSurfaceBg }]}>
              <Ionicons name="file-tray-outline" size={30} color={colors.textMuted} />
              <Text style={[styles.emptyBoxTitle, { color: colors.text }]}>No records identified</Text>
              <Text style={[styles.emptyBoxSub, { color: colors.textMuted }]}>
                Facilities matching your filter will display here
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16 }}>
              {filteredHistory.map((tx, idx) => (
                <Pressable
                  key={`${tx.transaction_id}-${idx}`}
                  onPress={() => {
                    Haptics.selectionAsync();
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
                  <View style={[styles.txIconBox, { backgroundColor: GOLD_GLOW }]}>
                    <Ionicons name="arrow-up" size={17} color={GOLD_PRIMARY} />
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={[styles.txClientName, { color: colors.text }]} numberOfLines={1}>
                        {tx.client_name}
                      </Text>
                      {tx.offline && (
                        <View style={styles.offlinePill}>
                          <Text style={styles.offlinePillText}>Queued</Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.txMetaRow}>
                      <Text style={[styles.txPlanTag, { color: colors.textMuted }]}>{tx.plan_type}</Text>
                      <Text style={[styles.txUnionTag, { color: colors.textMuted }]}>• {tx.union || "Center"}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.txAmount, { color: GOLD_DARK }]}>
                      {formatNaira(tx.principal, hideBalances)}
                    </Text>
                    <Text style={[styles.txDate, { color: colors.textMuted }]}>{formatTxDate(tx.date)}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          {hasMoreHistory && (
            <Pressable
              onPress={() => fetchHistory(historyPage + 1, true)}
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
                <ActivityIndicator size="small" color={GOLD_PRIMARY} />
              ) : (
                <>
                  <Text style={[styles.loadMoreText, { color: colors.text }]}>Load More Records</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.text} />
                </>
              )}
            </Pressable>
          )}
        </Animated.ScrollView>

        {/* FULL PICTURE PREVIEW MODAL */}
        <Modal
          visible={showFullImageModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowFullImageModal(false)}
        >
          <View style={styles.fullImageModalBackdrop}>
            <View style={styles.fullImageHeader}>
              <View>
                <Text style={styles.fullImageTitle}>Handover Proof Capture</Text>
                <Text style={styles.fullImageSub}>
                  {selectedClient?.name ? `Beneficiary: ${selectedClient.name}` : "Audit Verification"}
                </Text>
              </View>
              <Pressable
                onPress={() => setShowFullImageModal(false)}
                style={styles.fullImageCloseBtn}
                hitSlop={10}
              >
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </Pressable>
            </View>

            {proofImageUri ? (
              <View style={styles.fullImageContainer}>
                <Image
                  source={{ uri: proofImageUri }}
                  style={styles.fullImageDisplay}
                  resizeMode="contain"
                />
              </View>
            ) : null}

            <View style={styles.fullImageFooter}>
              <Pressable
                onPress={() => {
                  setShowFullImageModal(false);
                  captureProofPhoto();
                }}
                style={styles.fullImageRetakeBtn}
              >
                <Ionicons name="camera-reverse" size={17} color="#0F172A" />
                <Text style={styles.fullImageRetakeText}>Retake Photo</Text>
              </Pressable>
              <Pressable
                onPress={() => setShowFullImageModal(false)}
                style={styles.fullImageDoneBtn}
              >
                <Text style={styles.fullImageDoneText}>Looks Good</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* CLIENT PICKER MODAL */}
        <Modal visible={clientModalVisible} transparent animationType="slide" onRequestClose={() => setClientModalVisible(false)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.sheetHandle} />
              <View style={styles.modalSheetHead}>
                <View>
                  <Text style={[styles.modalSheetTitle, { color: colors.text }]}>Designate Beneficiary</Text>
                  <Text style={[styles.modalSheetSub, { color: colors.textMuted }]}>
                    Displaying {filteredModalClients.length} center members
                  </Text>
                </View>
                <Pressable onPress={() => setClientModalVisible(false)} hitSlop={10} style={{ padding: 4 }}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <View style={[styles.searchContainer, { backgroundColor: colors.background, borderColor: glassBorder, marginHorizontal: 0 }]}>
                <Ionicons name="search" size={16} color={colors.textMuted} />
                <TextInput
                  value={clientSearch}
                  onChangeText={setClientSearch}
                  placeholder="Filter name or phone..."
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {clientSearch.length > 0 && (
                  <Pressable onPress={() => setClientSearch("")} hitSlop={6}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>

              <View style={{ marginVertical: 10 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {unionsList.map((u) => {
                    const isSelected = modalUnionFilter.toLowerCase() === u.toLowerCase();
                    return (
                      <Pressable
                        key={u}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setModalUnionFilter(u);
                        }}
                        style={[
                          styles.modalUnionChip,
                          {
                            backgroundColor: isSelected ? GOLD_PRIMARY : colors.background,
                            borderColor: isSelected ? GOLD_PRIMARY : glassBorder,
                          },
                        ]}
                      >
                        <Text style={[styles.modalUnionText, { color: isSelected ? "#0F172A" : colors.text }]}>
                          {u} ({unionCounts[u] || 0})
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <FlatList
                data={filteredModalClients}
                keyExtractor={(item) => String(item.id)}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={14}
                maxToRenderPerBatch={20}
                windowSize={10}
                renderItem={({ item }) => (
                  <Pressable
                    onPress={() => selectClient(item)}
                    style={({ pressed }) => [
                      styles.clientListItem,
                      {
                        borderBottomColor: glassBorder,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.clientAvatar, { backgroundColor: GOLD_GLOW }]}>
                      <Text style={[styles.clientAvatarTxt, { color: GOLD_DARK }]}>{item.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={[styles.cItemName, { color: colors.text }]}>{item.name}</Text>
                      <Text style={[styles.cItemSub, { color: colors.textMuted }]}>
                        {item.phone || "No direct phone"} • {item.union || "Center"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
                ListEmptyComponent={
                  <View style={{ padding: 36, alignItems: "center" }}>
                    <Ionicons name="people-outline" size={32} color={colors.textMuted} />
                    <Text style={{ color: colors.textMuted, marginTop: 8, fontSize: 13, fontWeight: "600" }}>
                      No matching clients identified
                    </Text>
                  </View>
                }
              />
            </View>
          </View>
        </Modal>

        {/* CONFIRMATION MODAL */}
        <Modal visible={showConfirmModal} transparent animationType="fade" onRequestClose={() => setShowConfirmModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.confirmSheet, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.confirmHeader}>
                <View style={[styles.confirmIconBadge, { backgroundColor: GOLD_GLOW }]}>
                  <Ionicons name="shield-checkmark" size={26} color={GOLD_PRIMARY} />
                </View>
                <Text style={[styles.confirmTitle, { color: colors.text }]}>Authorize Capital Release</Text>
                <Text style={[styles.confirmSub, { color: colors.textMuted }]}>
                  Authenticate credit figures before executing funds transfer
                </Text>
              </View>

              <View style={[styles.confirmTable, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Beneficiary</Text>
                  <Text style={[styles.cfVal, { color: colors.text }]}>{selectedClient?.name}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Principal Released</Text>
                  <Text style={[styles.cfVal, { color: GOLD_DARK, fontSize: 15, fontWeight: "900" }]}>
                    {formatNaira(numericPrincipal)}
                  </Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Tenure / Terms</Text>
                  <Text style={[styles.cfVal, { color: colors.text }]}>
                    {matchedPlan.duration} {matchedPlan.unit} ({matchedPlan.installments} Installments)
                  </Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Daily Repayment</Text>
                  <Text style={[styles.cfVal, { color: "#3B82F6", fontWeight: "800" }]}>
                    {formatNaira(calculations.installmentAmount)}
                  </Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Gross Total Repayable</Text>
                  <Text style={[styles.cfVal, { color: colors.text, fontWeight: "900" }]}>
                    {formatNaira(calculations.totalPayable)}
                  </Text>
                </View>
              </View>

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setShowConfirmModal(false)}
                  style={[styles.cancelBtn, { borderColor: glassBorder }]}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.text }]}>Abort</Text>
                </Pressable>

                <Pressable
                  onPress={handleFinalDisbursement}
                  style={[styles.confirmFinalBtn, { backgroundColor: GOLD_PRIMARY }]}
                >
                  <Ionicons name="checkmark-done" size={17} color="#0F172A" />
                  <Text style={[styles.confirmFinalBtnText, { color: "#0F172A" }]}>Authorize Release</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* RECEIPT MODAL */}
        <Modal visible={showReceiptModal} transparent animationType="fade" onRequestClose={() => setShowReceiptModal(false)}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowReceiptModal(false)} />
            <View style={[styles.receiptBox, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.modalHandle} />
              <View style={[styles.receiptTopCircle, { backgroundColor: GOLD_GLOW }]}>
                <Ionicons name="paper-plane" size={28} color={GOLD_PRIMARY} />
              </View>

              <Text style={[styles.receiptHeading, { color: colors.text }]}>
                {receiptData?.client_name || "Beneficiary Client"}
              </Text>
              <Text style={[styles.receiptAmountText, { color: GOLD_DARK }]}>
                {formatNaira(receiptData?.principal || 0)}
              </Text>

              <View style={styles.statusSuccessPill}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                <Text style={styles.statusSuccessText}>
                  {receiptData?.offline ? "Queued for Offline Sync" : "Disbursement Ledger Confirmed"}
                </Text>
              </View>

              {receiptData && (
                <View style={[styles.modalDetailsGroup, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(148, 163, 184, 0.08)" }]}>
                  <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                    <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Total Expected</Text>
                    <Text style={[styles.modalDetailVal, { color: colors.text }]}>
                      {formatNaira(receiptData.total_payable)}
                    </Text>
                  </View>

                  <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                    <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Installments</Text>
                    <Text style={[styles.modalDetailVal, { color: "#3B82F6" }]}>
                      {receiptData.installments} Days
                    </Text>
                  </View>

                  <View style={[styles.modalDetailRow, { borderColor: glassBorder, borderBottomWidth: 0 }]}>
                    <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Voucher Ref</Text>
                    <Pressable
                      onPress={() => copyTxCode(receiptData.transaction_id)}
                      hitSlop={6}
                      style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                    >
                      <Text style={[styles.modalDetailVal, { color: GOLD_DARK, fontFamily: "monospace" }]}>
                        {receiptData.transaction_id}
                      </Text>
                      <Ionicons name="copy-outline" size={12} color={GOLD_PRIMARY} />
                    </Pressable>
                  </View>
                </View>
              )}

              <View style={styles.modalButtonsRow}>
                <Pressable
                  onPress={handleShareReceipt}
                  style={[styles.modalSecondaryBtn, { borderColor: glassBorder }]}
                >
                  <Ionicons name="share-social-outline" size={17} color={colors.text} />
                  <Text style={[styles.modalSecondaryText, { color: colors.text }]}>Share Receipt</Text>
                </Pressable>

                <Pressable
                  onPress={() => setShowReceiptModal(false)}
                  style={[styles.modalPrimaryBtn, { backgroundColor: GOLD_PRIMARY }]}
                >
                  <Text style={[styles.modalCloseText, { color: "#0F172A" }]}>Done</Text>
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
  scrollContent: { paddingBottom: 60, paddingTop: 6 },

  /* OFFLINE SYNC CARD */
  syncNoticeCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  syncNoticeLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  syncIconWrap: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  syncTitle: { fontSize: 12.5, fontWeight: "800" },
  syncSubtitle: { fontSize: 10.5, fontWeight: "500", marginTop: 1 },
  syncActionBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  syncActionText: { color: "#0F172A", fontSize: 11, fontWeight: "800" },

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
    marginBottom: 8,
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

  portfolioRatioContainer: {
    marginBottom: 12,
  },
  ratioHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  ratioLabel: {
    fontSize: 9.5,
    fontWeight: "600",
  },
  ratioTrack: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(148, 163, 184, 0.2)",
    flexDirection: "row",
    overflow: "hidden",
  },
  ratioLoansBar: {
    backgroundColor: GOLD_PRIMARY,
    height: "100%",
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
    fontSize: 14,
    fontWeight: "800",
    marginTop: 3,
  },
  metricItemSub: {
    fontSize: 9,
    marginTop: 1,
    fontWeight: "500",
  },

  /* SECTION HEADINGS */
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 18,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  badgeCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeCountText: { fontSize: 11, fontWeight: "700" },

  /* UNION PILLS */
  unionScrollContainer: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
  unionTabPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 11,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  unionTabPillText: { fontSize: 12, fontWeight: "700" },
  unionTabCountBadge: {
    paddingHorizontal: 6.5,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 18,
    alignItems: "center",
  },
  unionTabCountText: { fontSize: 10, fontWeight: "800" },

  /* FORM CARD */
  formCard: {
    marginHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    marginBottom: 20,
  },
  fieldBlock: { gap: 6 },
  fieldLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.7 },
  clientPickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  pickerLeft: { flexDirection: "row", alignItems: "center", gap: 9 },
  pickerAvatarPlaceholder: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  clientPickerText: { fontSize: 13, fontWeight: "600" },

  selectedClientCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
  },
  selAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  selAvatarText: { color: "#0F172A", fontSize: 14, fontWeight: "800" },
  selClientName: { fontSize: 13.5, fontWeight: "800" },
  selClientMeta: { fontSize: 11, marginTop: 1 },
  changeClientBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  changeClientText: { fontSize: 11, fontWeight: "700" },

  profileLoading: { flexDirection: "row", alignItems: "center", gap: 8, padding: 8 },
  profileLoadingText: { fontSize: 12, fontWeight: "600" },

  creditCard: { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  creditCardBanner: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  creditBannerText: { fontSize: 11, fontWeight: "800" },
  firstLoanTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  firstLoanTagText: { color: "#0F172A", fontSize: 9, fontWeight: "700" },
  creditMetricsRow: { flexDirection: "row", padding: 10, alignItems: "center" },
  creditMetric: { flex: 1, alignItems: "center" },
  cMetricLabel: { fontSize: 8.5, fontWeight: "800", color: "#64748B", letterSpacing: 0.5 },
  cMetricVal: { fontSize: 13.5, fontWeight: "900", marginTop: 2 },
  metricDivider: { width: 1, height: 24 },
  activeLoanAlert: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  activeLoanAlertText: { fontSize: 11, fontWeight: "700", color: ROSE_DANGER },

  planCard: { borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  planCardHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  planCardTitle: { fontSize: 13, fontWeight: "800" },
  interestBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  interestBadgeText: { fontSize: 10.5, fontWeight: "800" },
  planLimitsRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  planLimitText: { fontSize: 10.5, fontWeight: "600" },

  fillMaxText: { fontSize: 11, fontWeight: "800" },
  amountInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  nairaPrefix: { fontSize: 20, fontWeight: "900", marginRight: 8 },
  amountInput: { flex: 1, fontSize: 18, fontWeight: "900", height: "100%" },

  progressContainer: { marginTop: 4, gap: 4 },
  progressTrack: { height: 5, borderRadius: 3, width: "100%", overflow: "hidden" },
  progressBar: { height: "100%", borderRadius: 3 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between" },
  progressHelpText: { fontSize: 10, fontWeight: "600" },
  progressOverText: { fontSize: 10, fontWeight: "700", color: ROSE_DANGER },

  quickPresetRow: { gap: 8, marginTop: 4 },
  presetChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  presetChipText: { fontSize: 11, fontWeight: "700" },

  calcGrid: { flexDirection: "row", gap: 8 },
  calcBox: { flex: 1, padding: 9, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  calcLabel: { fontSize: 8, fontWeight: "800", color: "#64748B", letterSpacing: 0.6 },
  calcValue: { fontSize: 11.5, fontWeight: "900", marginTop: 3 },

  photoHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoActionChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  photoActionText: { fontSize: 10.5, fontWeight: "700" },
  uploadBox: {
    height: 90,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  uploadIconCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  uploadBoxText: { fontSize: 12, fontWeight: "700" },
  uploadBoxSub: { fontSize: 10, fontWeight: "500" },

  /* FULL UNCROPPED PREVIEW CARD */
  previewWrap: {
    position: "relative",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    height: 220, // Expanded height for full preview
    backgroundColor: "#0A0F1D", // Dark letterboxing for contrast
    justifyContent: "center",
    alignItems: "center",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
  expandImageBtn: {
    position: "absolute",
    top: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(15, 23, 42, 0.78)",
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
  },
  expandImageText: { color: "#FFFFFF", fontSize: 10.5, fontWeight: "700" },
  photoVerifiedBadge: {
    position: "absolute",
    bottom: 8,
    left: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.78)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  photoVerifiedText: { color: "#fff", fontSize: 10.5, fontWeight: "700" },
  removeImageBtn: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(239, 68, 68, 0.9)",
    alignItems: "center",
    justifyContent: "center",
  },

  /* FULL IMAGE VIEWER MODAL */
  fullImageModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.96)",
    justifyContent: "space-between",
    paddingTop: Platform.OS === "ios" ? 54 : 30,
    paddingBottom: Platform.OS === "ios" ? 40 : 24,
  },
  fullImageHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  fullImageTitle: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },
  fullImageSub: {
    color: "#94A3B8",
    fontSize: 11.5,
    marginTop: 2,
    fontWeight: "600",
  },
  fullImageCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255, 255, 255, 0.16)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullImageContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    marginVertical: 14,
  },
  fullImageDisplay: {
    width: "100%",
    height: "100%",
  },
  fullImageFooter: {
    flexDirection: "row",
    gap: 12,
    paddingHorizontal: 20,
  },
  fullImageRetakeBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: GOLD_PRIMARY,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  fullImageRetakeText: {
    color: "#0F172A",
    fontSize: 13,
    fontWeight: "800",
  },
  fullImageDoneBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: "rgba(255, 255, 255, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  fullImageDoneText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "700",
  },

  submitBtn: {
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  submitBtnText: { color: "#0F172A", fontSize: 14, fontWeight: "800" },

  /* HISTORY STREAM */
  historyFilterTabs: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 10, padding: 2 },
  hTab: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  hTabText: { fontSize: 11, fontWeight: "700" },

  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 13, height: "100%" },

  txCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 8,
  },
  txIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  txClientName: { fontSize: 13, fontWeight: "700" },
  offlinePill: { backgroundColor: "rgba(245, 158, 11, 0.2)", paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  offlinePillText: { fontSize: 9, fontWeight: "800", color: GOLD_DARK },
  txMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  txPlanTag: { fontSize: 10, fontWeight: "600" },
  txUnionTag: { fontSize: 10.5, fontWeight: "500" },
  txAmount: { fontSize: 13.5, fontWeight: "800" },
  txDate: { fontSize: 10, fontWeight: "500", marginTop: 2 },

  loadMoreBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    marginTop: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  loadMoreText: { fontSize: 12, fontWeight: "700" },

  emptyBox: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  emptyBoxTitle: { fontSize: 14, fontWeight: "700" },
  emptyBoxSub: { fontSize: 11.5, textAlign: "center" },

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

  /* MODALS */
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 20, maxHeight: "88%" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 14 },
  modalSheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalSheetTitle: { fontSize: 16, fontWeight: "800" },
  modalSheetSub: { fontSize: 11.5, marginTop: 1 },

  modalUnionChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16, borderWidth: 1 },
  modalUnionText: { fontSize: 11, fontWeight: "700" },
  clientListItem: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1 },
  clientAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  clientAvatarTxt: { fontSize: 14, fontWeight: "800" },
  cItemName: { fontSize: 13.5, fontWeight: "700" },
  cItemSub: { fontSize: 11, marginTop: 2 },

  /* CONFIRM REVIEW MODAL */
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 20 },
  confirmSheet: { width: "100%", borderRadius: 24, borderWidth: 1, padding: 20 },
  confirmHeader: { alignItems: "center", marginBottom: 16 },
  confirmIconBadge: { width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 8 },
  confirmTitle: { fontSize: 16, fontWeight: "800" },
  confirmSub: { fontSize: 11.5, marginTop: 2, textAlign: "center" },
  confirmTable: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 10, marginBottom: 18 },
  confirmRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cfLabel: { fontSize: 12, fontWeight: "600" },
  cfVal: { fontSize: 12.5, fontWeight: "700" },
  confirmActions: { flexDirection: "row", gap: 10 },
  cancelBtn: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cancelBtnText: { fontSize: 13, fontWeight: "700" },
  confirmFinalBtn: { flex: 2, height: 44, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  confirmFinalBtnText: { fontSize: 13, fontWeight: "800" },

  /* RECEIPT MODAL */
  receiptBox: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: "center",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    marginBottom: 16,
  },
  receiptTopCircle: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  receiptHeading: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  receiptAmountText: { fontSize: 26, fontWeight: "900", marginVertical: 4 },
  statusSuccessPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginTop: 4,
    marginBottom: 14,
  },
  statusSuccessText: { color: "#10B981", fontSize: 11, fontWeight: "700" },
  modalDetailsGroup: {
    width: "100%",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 4,
    marginBottom: 18,
  },
  modalDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  modalDetailLabel: { fontSize: 12, fontWeight: "600" },
  modalDetailVal: { fontSize: 12, fontWeight: "700" },
  modalButtonsRow: {
    flexDirection: "row",
    gap: 10,
    width: "100%",
  },
  modalSecondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
  },
  modalSecondaryText: { fontSize: 13, fontWeight: "700" },
  modalPrimaryBtn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: { fontSize: 13, fontWeight: "700" },
});