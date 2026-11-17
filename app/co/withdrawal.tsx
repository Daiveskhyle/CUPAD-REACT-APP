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
  saveWithdrawalOffline,
  cacheClients,
  loadOfflineWorkspace,
  getAllPendingCounts,
} from "../../src/db/database";
import { fetchUnionsForOfficer, mergeUnionNames } from "../../src/db/offlineHelpers";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_WITHDRAWAL = `${API_BASE}/api/saving_withdrawal_api.php`;

const CACHE_KEYS = {
  STATS: "cupad_cache_wth_stats",
  CLIENTS: "cupad_cache_wth_clients",
  HISTORY: "cupad_cache_wth_history",
  SETTINGS: "cupad_cache_wth_settings",
  PRIVACY: "cupad_cache_privacy_hide_amounts",
};

const RED_ACCENT = "#EF4444";
const RED_DARK = "#DC2626";
const CASH_QUICK_ADD = [2000, 5000, 10000, 20000];

type WithdrawalType = "withdrawal" | "cash" | "return";

type ClientItem = {
  id: string | number;
  name: string;
  union?: string;
  phone?: string;
  savings_balance: number;
  loan_balance: number;
  total_installment_amount: number;
  active_loan_type: string;
  active_loan_total: number;
  active_loan_installments: number;
  installments_paid: number;
  active_loan_principal: number;
  next_loan_limit: number;
};

type WithdrawalHistoryEntry = {
  transaction_id: string;
  client_id?: string | number;
  client_name: string;
  amount: number;
  type: string;
  date: string;
  balance_after?: number;
  notes?: string;
  union?: string;
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

/* ================= DASHBOARD SKELETON ================= */
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
        <Animated.View style={{ height: 10, width: "40%", borderRadius: 4, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 8 }}>
        <Animated.View style={{ height: 16, width: 70, borderRadius: 6, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }} />
        <Animated.View style={{ height: 10, width: 45, borderRadius: 4, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity }} />
      </View>
    </View>
  );
}

export default function WithdrawalScreen() {
  const { colors, isDark } = useTheme();

  // Glassmorphism System Colors
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(239, 68, 68, 0.16)" : "rgba(239, 68, 68, 0.08)";
  const orbColor2 = isDark ? "rgba(37, 99, 235, 0.14)" : "rgba(37, 99, 235, 0.07)";

  // Fade Animation on Mount
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Officer Session & Settings
  const [officerUsername, setOfficerUsername] = useState("");
  const [hideBalances, setHideBalances] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [pendingOffline, setPendingOffline] = useState(0);

  const [stats, setStats] = useState({
    active_savers: 0,
    total_savings: 0,
    monthly_withdrawals_count: 0,
    monthly_withdrawals_amt: 0,
  });

  const [settings, setSettings] = useState<any>({
    max_cash_withdrawal: 50000,
    require_image_for_cash: 1,
    allow_weekend_withdrawals: 0,
    max_withdrawals_per_day: 1,
    blocked_withdrawal_types: "[]",
    withdrawal_date_readonly: 0,
    buffer_cash: 10,
    buffer_withdrawal: 10,
    buffer_return: 10,
  });

  // Client List & Unions
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [unionsList, setUnionsList] = useState<string[]>([]);
  const [selectedUnion, setSelectedUnion] = useState("");
  const [clientSearchInUnion, setClientSearchInUnion] = useState("");

  // Transaction Modal Sheet State
  const [actionSheetVisible, setActionSheetVisible] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientItem | null>(null);
  const [withdrawalType, setWithdrawalType] = useState<WithdrawalType>("withdrawal");
  const [customAmount, setCustomAmount] = useState("");
  const [proofImageUri, setProofImageUri] = useState<string | null>(null);
  const [proofBase64, setProofBase64] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Review & Receipt Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);

  // History State
  const [history, setHistory] = useState<WithdrawalHistoryEntry[]>([]);
  const [historySearch, setHistorySearch] = useState("");
  const [historyFilter, setHistoryFilter] = useState<"all" | "today" | "current_month">("all");
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

  const copyTxCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`Copied Ref #${code}`);
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
        message: `Cupad Withdrawal Receipt\nClient: ${receiptData.client_name}\nAmount Deducted: ${formatNaira(
          receiptData.amount_deducted || receiptData.amount
        )}\nRemaining Savings: ${formatNaira(
          receiptData.savings_balance_after ?? receiptData.balance_after
        )}\nTransaction Ref: ${receiptData.transaction_id}`,
      });
    } catch {}
  };

  // Blocked types list
  const blockedTypes: string[] = useMemo(() => {
    try {
      return JSON.parse(settings.blocked_withdrawal_types || "[]");
    } catch {
      return [];
    }
  }, [settings.blocked_withdrawal_types]);

  // Weekend check
  const isWeekendNow = useMemo(() => {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }, []);

  // Dynamic Available Unions with client count badges
  const availableUnions = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c) => {
      const u = c.union?.trim() || "Unassigned";
      counts[u] = (counts[u] || 0) + 1;
    });

    unionsList.forEach((u) => {
      if (!counts[u]) counts[u] = 0;
    });

    const unionKeys = Object.keys(counts).sort();
    return unionKeys.map((k) => ({
      key: k,
      name: k,
      count: counts[k],
    }));
  }, [clients, unionsList]);

  // Ensure an active union is selected automatically
  useEffect(() => {
    if (availableUnions.length > 0) {
      const exists = availableUnions.some((u) => u.key.toLowerCase() === selectedUnion.toLowerCase());
      if (!exists) {
        setSelectedUnion(availableUnions[0].key);
      }
    }
  }, [availableUnions, selectedUnion]);

  // Clients that have already transacted today
  const dailyWithdrawnClientIds = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const set = new Set<string>();
    history.forEach((tx) => {
      if (tx.date && tx.date.slice(0, 10) === today && tx.client_id) {
        set.add(String(tx.client_id));
      }
    });
    return set;
  }, [history]);

  // Filtered client feed based on selected union tab and query
  const unionClients = useMemo(() => {
    return clients.filter((c) => {
      const matchUnion =
        !selectedUnion || (c.union && c.union.toLowerCase() === selectedUnion.toLowerCase());
      const query = clientSearchInUnion.toLowerCase().trim();
      const matchQuery =
        !query ||
        c.name.toLowerCase().includes(query) ||
        (c.phone && c.phone.includes(query)) ||
        (c.union && c.union.toLowerCase().includes(query));
      return matchUnion && matchQuery;
    });
  }, [clients, selectedUnion, clientSearchInUnion]);

  // Effective transaction amount calculation
  const effectiveTransactionAmount = useMemo(() => {
    if (!selectedClient) return 0;
    if (withdrawalType === "return") {
      return Math.min(selectedClient.savings_balance, selectedClient.loan_balance);
    }
    if (withdrawalType === "withdrawal") {
      return selectedClient.total_installment_amount;
    }
    return Number(customAmount.replace(/[^0-9]/g, "")) || 0;
  }, [selectedClient, withdrawalType, customAmount]);

  // Eligibility Evaluation
  const checkClientEligibility = useCallback(
    (client: ClientItem, type: WithdrawalType, amt: number) => {
      // ADMIN-CONTROLLED: cash payout blocked when offline
      if (type === "cash" && isOffline) {
        return { ok: false, msg: "Cash payout is disabled in offline mode. Admin-controlled operation requires online connection." };
      }

      if (client.savings_balance <= 0) {
        return { ok: false, msg: "This client has no savings available for withdrawal." };
      }

      if (blockedTypes.includes(type)) {
        return { ok: false, msg: `${type.toUpperCase()} is paused by branch policy.` };
      }

      if (!settings.allow_weekend_withdrawals && isWeekendNow) {
        return { ok: false, msg: "Weekend withdrawals paused until Monday." };
      }

      if (dailyWithdrawnClientIds.has(String(client.id))) {
        return { ok: false, msg: "Daily transaction cap reached (1 transaction/day)." };
      }

      if (type === "return") {
        if (client.loan_balance <= 0) return { ok: false, msg: "Client has no outstanding loan debt." };
        if (client.savings_balance <= 0) return { ok: false, msg: "Insufficient client savings for loan payoff." };
        return { ok: true, msg: "Authorized: Savings applies directly to clear active loan." };
      }

      if (client.loan_balance > 0) {
        if (client.installments_paid < 10) {
          return {
            ok: false,
            msg: `Tenure locked: 10 installments required (${client.installments_paid}/${client.active_loan_installments} completed).`,
          };
        }
        const reqAmount = (client.active_loan_principal * (settings[`buffer_${type}`] || 10)) / 100;
        if (client.savings_balance < reqAmount) {
          return {
            ok: false,
            msg: `Savings below ${settings[`buffer_${type}`] || 10}% security buffer (${formatNaira(reqAmount)} required).`,
          };
        }
      }

      if (type === "cash") {
        if (amt <= 0) return { ok: false, msg: "Enter a valid cash payout amount." };
        const maxCash = Number(settings.max_cash_withdrawal || 50000);
        if (amt > maxCash) return { ok: false, msg: `Exceeds max payout limit (${formatNaira(maxCash)}).` };
        if (client.savings_balance < amt) return { ok: false, msg: "Amount exceeds client savings balance." };
        if (settings.require_image_for_cash && !proofBase64) return { ok: false, msg: "Verification receipt photo required." };
      }

      if (type === "withdrawal") {
        if (client.total_installment_amount <= 0) return { ok: false, msg: "Installment schedule not determined." };
        if (client.savings_balance < client.total_installment_amount) return { ok: false, msg: "Insufficient savings to cover installment." };
      }

      return { ok: true, msg: "Authorized: Client meets all policy & buffer criteria." };
    },
    [blockedTypes, settings, isWeekendNow, dailyWithdrawnClientIds, proofBase64, isOffline]
  );

  const activeEligibility = useMemo(() => {
    if (!selectedClient) return { ok: false, msg: "Select a client first." };
    return checkClientEligibility(selectedClient, withdrawalType, effectiveTransactionAmount);
  }, [selectedClient, withdrawalType, effectiveTransactionAmount, checkClientEligibility]);

  // Load User Session & Privacy Preferences
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

  // Fetch Server Data
  const fetchInitData = useCallback(async (user: string) => {
    if (!user) return;
    try {
      const res = await axios.get(`${API_WITHDRAWAL}?action=init&username=${encodeURIComponent(user)}`, { timeout: 10000 });
      if (res.data?.success) {
        setIsOffline(false);
        setClients(res.data.clients || []);
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
        const merged = mergeUnionNames(fromApi, fromInit, fromClients);
        setUnionsList(merged);
        if (res.data.settings) setSettings(res.data.settings);
        if (res.data.stats) setStats(res.data.stats);

        await AsyncStorage.setItem(CACHE_KEYS.CLIENTS, JSON.stringify(res.data.clients));
        try { await cacheClients(res.data.clients || [], user); } catch {}
        await AsyncStorage.setItem(CACHE_KEYS.STATS, JSON.stringify(res.data.stats));
        await AsyncStorage.setItem(CACHE_KEYS.SETTINGS, JSON.stringify(res.data.settings));
      }
    } catch {
      setIsOffline(true);
      try {
        const ws = await loadOfflineWorkspace(user);
        if (ws.clients.length > 0) {
          setClients(ws.clients);
          setUnionsList(ws.unionNames.length ? ws.unionNames : Array.from(new Set(ws.clients.map((c: any) => c.union).filter(Boolean))) as string[]);
        } else {
          const [cClients, cStats, cSett] = await Promise.all([
            AsyncStorage.getItem(CACHE_KEYS.CLIENTS),
            AsyncStorage.getItem(CACHE_KEYS.STATS),
            AsyncStorage.getItem(CACHE_KEYS.SETTINGS),
          ]);
          if (cClients) {
            const cl = JSON.parse(cClients);
            setClients(cl);
            const fromClients = Array.from(new Set(cl.map((c: any) => c.union).filter(Boolean))) as string[];
            setUnionsList(fromClients);
          }
          if (cStats) setStats(JSON.parse(cStats));
          if (cSett) setSettings(JSON.parse(cSett));
        }
      } catch {}
    }
  }, []);

  // Fetch History Stream
  const fetchHistory = useCallback(
    async (pageNum = 1, append = false, filter = historyFilter, union = selectedUnion) => {
      if (!officerUsername) return;
      if (!append) setHistoryLoading(true);
      else setLoadingMoreHistory(true);

      try {
        const res = await axios.get(
          `${API_WITHDRAWAL}?action=history&username=${encodeURIComponent(
            officerUsername
          )}&filter=${filter}&union=${encodeURIComponent(union)}&page=${pageNum}&limit=12`,
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

  // Pick Proof Image
  const pickProofImage = async (useCamera = false) => {
    try {
      let result;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "Camera access is needed to capture proof receipt.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({
          quality: 0.6,
          base64: true,
          allowsEditing: true,
          aspect: [4, 3],
        });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({
          quality: 0.6,
          base64: true,
          allowsEditing: true,
          aspect: [4, 3],
        });
      }

      if (!result.canceled && result.assets?.[0]) {
        setProofImageUri(result.assets[0].uri);
        setProofBase64(`data:image/jpeg;base64,${result.assets[0].base64}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch {
      Alert.alert("Error", "Could not process image.");
    }
  };

  const openActionSheetForClient = (client: ClientItem, initialType: WithdrawalType = "withdrawal") => {
    // ADMIN-CONTROLLED: prevent opening cash sheet while offline
    if (initialType === "cash" && isOffline) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert(
        "Cash Payout Blocked",
        "Cash payout is admin-controlled and requires an online connection. Please connect to the internet to process cash withdrawals."
      );
      return;
    }

    if (client.savings_balance <= 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Withdrawal Unavailable", "This client has no savings available for withdrawal.");
      return;
    }

    if (!settings.allow_weekend_withdrawals && isWeekendNow) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Operations Closed", "Savings withdrawals are paused on weekends.");
      return;
    }

    if (dailyWithdrawnClientIds.has(String(client.id))) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Daily Limit", `${client.name} has already transacted today.`);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedClient(client);
    setWithdrawalType(initialType);
    setCustomAmount("");
    setProofImageUri(null);
    setProofBase64(null);
    setActionSheetVisible(true);
  };

  const initiateReview = () => {
    if (!selectedClient) return;

    if (!activeEligibility.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Transaction Ineligible", activeEligibility.msg);
      return;
    }

    if (effectiveTransactionAmount <= 0) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Invalid Amount", "Please input or select a valid deduction amount.");
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setShowConfirmModal(true);
  };

  const handleFinalSubmission = async () => {
    setShowConfirmModal(false);
    setIsSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const payload = {
      action: "record_withdrawal",
      client_id: selectedClient!.id,
      type: withdrawalType,
      amount: effectiveTransactionAmount,
      officer: officerUsername,
      picture_base64: proofBase64,
      date: new Date().toISOString().slice(0, 19).replace("T", " "),
    };

    try {
      const res = await axios.post(API_WITHDRAWAL, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 12000,
      });

      if (res.data?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setActionSheetVisible(false);
        setReceiptData(res.data.transaction);
        setShowReceiptModal(true);

        setClients((prev) =>
          prev.map((c) => {
            if (String(c.id) === String(selectedClient!.id)) {
              return {
                ...c,
                savings_balance: res.data.transaction.savings_balance_after,
                loan_balance: res.data.transaction.loan_remaining_balance,
              };
            }
            return c;
          })
        );

        setStats((prev) => ({
          ...prev,
          total_savings: Math.max(0, prev.total_savings - effectiveTransactionAmount),
          monthly_withdrawals_count: prev.monthly_withdrawals_count + 1,
          monthly_withdrawals_amt: prev.monthly_withdrawals_amt + effectiveTransactionAmount,
        }));

        fetchHistory(1, false, historyFilter);
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Withdrawal Denied", res.data?.message || "Server declined request.");
      }
    } catch {
      // ADMIN-CONTROLLED: cash withdrawals must NOT be queued offline
      if (withdrawalType === "cash") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          "Cash Payout Requires Internet",
          "Cash payout is controlled by admin and cannot be processed offline. Please reconnect and try again."
        );
        setIsSubmitting(false);
        return;
      }
      try {
        if (!selectedClient) return;
        const amt = Number(effectiveTransactionAmount) || 0;
        const balAfter = Math.max(0, Number(selectedClient.savings_balance || 0) - amt);
        const nowIso = new Date().toISOString().slice(0, 19).replace("T", " ");
        const tempTxId = `WTH-OFF-${Date.now()}`;

        await saveWithdrawalOffline({
          tempTxId,
          clientId: selectedClient.id,
          clientName: selectedClient.name,
          amount: amt,
          type: withdrawalType || "withdrawal",
          balanceAfter: balAfter,
          date: nowIso,
          officer: officerUsername || "",
          union: selectedUnion || selectedClient.union,
          notes: proofBase64 ? "has_proof" : "",
        });

        setClients((prev) =>
          prev.map((c) =>
            String(c.id) === String(selectedClient.id) ? { ...c, savings_balance: balAfter } : c
          )
        );
        setStats((prev) => ({
          ...prev,
          total_savings: Math.max(0, (prev.total_savings || 0) - amt),
          monthly_withdrawals_count: (prev.monthly_withdrawals_count || 0) + 1,
          monthly_withdrawals_amt: (prev.monthly_withdrawals_amt || 0) + amt,
        }));

        setActionSheetVisible(false);
        setReceiptData({
          transaction_id: tempTxId,
          client_name: selectedClient.name,
          amount: amt,
          type: withdrawalType,
          savings_balance_after: balAfter,
          date: nowIso,
          offline: true,
        });
        setShowReceiptModal(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (offErr: any) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Offline Save Failed", offErr?.message || "Could not queue withdrawal locally.");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (officerUsername) {
      await Promise.all([fetchInitData(officerUsername), fetchHistory(1, false, historyFilter)]);
    }
    setRefreshing(false);
  }, [officerUsername, historyFilter, fetchInitData, fetchHistory]);

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

    (async () => {
      try {
        const counts = await getAllPendingCounts();
        setPendingOffline(counts.withdrawals || counts.total || 0);
      } catch {}
    })();
  }, [loadUser, fetchInitData, fetchHistory, fadeAnim]);

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

  const withdrawalVolumeRatio =
    stats.total_savings > 0
      ? Math.min(100, Math.round((stats.monthly_withdrawals_amt / stats.total_savings) * 100))
      : 0;

  return (
    <CoScreenWrapper>
      {/* ================= DASHBOARD-MATCHED AMBIENT ORBS ================= */}
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
        <Animated.ScrollView
          style={{ flex: 1, opacity: fadeAnim }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={RED_ACCENT}
              colors={[RED_ACCENT]}
            />
          }
        >
          {/* WEEKEND WARNING BANNER */}
          {!settings.allow_weekend_withdrawals && isWeekendNow && (
            <View style={styles.weekendBanner}>
              <Ionicons name="alert-circle" size={18} color="#fff" />
              <Text style={styles.weekendBannerText}>
                Weekend Operations Closed: Savings deductions and cash withdrawals resume Monday.
              </Text>
            </View>
          )}

          {/* ================= HERO VAULT TERMINAL CARD (MATCHING DASHBOARD HERO) ================= */}
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
            {/* Live Status & Mode Badge */}
            <View style={styles.heroHeaderBar}>
              <View
                style={[
                  styles.heroTagPill,
                  { backgroundColor: isOffline ? "rgba(245, 158, 11, 0.15)" : "rgba(239, 68, 68, 0.15)" },
                ]}
              >
                <View
                  style={[styles.statusPulseDot, { backgroundColor: isOffline ? "#F59E0B" : RED_ACCENT }]}
                />
                <Text
                  style={[
                    styles.heroTagText,
                    { color: isOffline ? "#F59E0B" : RED_ACCENT },
                  ]}
                >
                  {isOffline ? "OFFLINE VAULT" : "LIVE VAULT TERMINAL"}
                </Text>
              </View>

              {pendingOffline > 0 ? (
                <View style={[styles.syncTimePill, { backgroundColor: "rgba(245, 158, 11, 0.15)" }]}>
                  <Ionicons name="cloud-upload-outline" size={12} color="#F59E0B" />
                  <Text style={[styles.syncTimeText, { color: "#F59E0B" }]}>
                    {pendingOffline} queued
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.syncTimePill,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)" },
                  ]}
                >
                  <Ionicons name="shield-checkmark" size={12} color="#10B981" />
                  <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>Audited</Text>
                </View>
              )}
            </View>

            {/* Total Vault Balance */}
            <View style={styles.heroMainBalanceSection}>
              <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                CURRENT SAVINGS VAULT
              </Text>
              <View style={styles.heroAmountRow}>
                <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                  {formatNaira(stats.total_savings, hideBalances)}
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

            {/* Visual Portfolio Ratio Bar */}
            <View style={styles.portfolioRatioContainer}>
              <View style={styles.ratioHeader}>
                <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                  Vault Depletion Ratio: {withdrawalVolumeRatio}% Deductions
                </Text>
                <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                  {100 - withdrawalVolumeRatio}% Intact
                </Text>
              </View>
              <View style={styles.ratioTrack}>
                <View style={[styles.ratioWithdrawBar, { width: `${withdrawalVolumeRatio}%` }]} />
                <View style={[styles.ratioSavingsBar, { width: `${100 - withdrawalVolumeRatio}%` }]} />
              </View>
            </View>

            {/* Metrics 3-Grid */}
            <View style={styles.heroMetricsGrid}>
              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="people" size={11} color={colors.primary} />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Active Savers</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>
                  {stats.active_savers}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Portfolio Savers</Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="repeat" size={11} color={RED_ACCENT} />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Month Payouts</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: RED_ACCENT }]}>
                  {stats.monthly_withdrawals_count}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>
                  {formatNaira(stats.monthly_withdrawals_amt, hideBalances)}
                </Text>
              </View>
            </View>
          </LinearGradient>

          {/* ================= UNION TERRITORY PILLS ================= */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Union Branches</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Active assigned groups</Text>
            </View>
            <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Text style={[styles.badgeCountText, { color: colors.textMuted }]}>
                {availableUnions.length}
              </Text>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.unionScrollContainer}
          >
            {availableUnions.map((u) => {
              const isSelected = selectedUnion.toLowerCase() === u.key.toLowerCase();
              return (
                <Pressable
                  key={u.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedUnion(u.key);
                    fetchHistory(1, false, historyFilter, u.key);
                  }}
                  style={({ pressed }) => [
                    styles.unionTabPill,
                    {
                      backgroundColor: isSelected ? RED_ACCENT : cardSurfaceBg,
                      borderColor: isSelected ? RED_ACCENT : glassBorder,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    },
                  ]}
                >
                  <Ionicons
                    name="business"
                    size={13}
                    color={isSelected ? "#fff" : RED_ACCENT}
                  />
                  <Text
                    style={[
                      styles.unionTabPillText,
                      { color: isSelected ? "#fff" : colors.text },
                    ]}
                  >
                    {u.name}
                  </Text>
                  <View
                    style={[
                      styles.unionTabCountBadge,
                      {
                        backgroundColor: isSelected
                          ? "rgba(255,255,255,0.22)"
                          : isDark
                          ? "rgba(255,255,255,0.08)"
                          : "#E2E8F0",
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.unionTabCountText,
                        { color: isSelected ? "#fff" : colors.text },
                      ]}
                    >
                      {u.count}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* ================= SAVER CLIENT CARDS FEED ================= */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {selectedUnion ? `${selectedUnion.toUpperCase()} SAVERS` : "REGISTERED SAVERS"}
              </Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                Deduct installment or cash payout
              </Text>
            </View>
            <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Text style={[styles.badgeCountText, { color: RED_ACCENT }]}>
                {unionClients.length} Savers
              </Text>
            </View>
          </View>

          {/* Search Box */}
          <View style={[styles.searchContainer, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              placeholder={selectedUnion ? `Search in ${selectedUnion}...` : "Search by name or phone..."}
              placeholderTextColor={colors.textMuted}
              value={clientSearchInUnion}
              onChangeText={setClientSearchInUnion}
              style={[styles.searchInput, { color: colors.text }]}
              autoCapitalize="none"
            />
            {clientSearchInUnion.length > 0 && (
              <Pressable onPress={() => setClientSearchInUnion("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {unionClients.length === 0 ? (
            <View style={[styles.emptyBox, { borderColor: glassBorder, backgroundColor: cardSurfaceBg }]}>
              <Ionicons name="people-outline" size={32} color={colors.textMuted} />
              <Text style={[styles.emptyBoxTitle, { color: colors.text }]}>No Savers Found</Text>
              <Text style={[styles.emptyBoxSub, { color: colors.textMuted }]}>
                No registered members match your active union or search filter.
              </Text>
            </View>
          ) : (
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {unionClients.map((client) => {
                const hasPaidToday = dailyWithdrawnClientIds.has(String(client.id));
                const isNetSaver = client.savings_balance >= client.loan_balance;
                const deductionEligibility = checkClientEligibility(
                  client,
                  "withdrawal",
                  client.total_installment_amount
                );

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
                    {/* Header Row */}
                    <View style={styles.clientCardHeader}>
                      <View style={[styles.avatarBox, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}>
                        <Text style={[styles.avatarText, { color: RED_ACCENT }]}>
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
                          <Ionicons name="checkmark-circle" size={12} color="#059669" />
                          <Text style={styles.paidTodayBadgeText}>Transacted</Text>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.netBadge,
                            {
                              backgroundColor: isNetSaver ? "rgba(16, 185, 129, 0.12)" : "rgba(239, 68, 68, 0.12)",
                            },
                          ]}
                        >
                          <Text style={[styles.netBadgeText, { color: isNetSaver ? "#10B981" : RED_ACCENT }]}>
                            {isNetSaver ? "Net Saver" : "Borrower"}
                          </Text>
                        </View>
                      )}
                    </View>

                    {/* Balance Dual Pill */}
                    <View style={styles.clientBalanceGrid}>
                      <View
                        style={[
                          styles.balancePill,
                          { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                        ]}
                      >
                        <View style={styles.pillLabelRow}>
                          <Ionicons name="wallet-outline" size={11} color="#10B981" />
                          <Text style={[styles.balancePillLabel, { color: colors.textMuted }]}>SAVINGS VAULT</Text>
                        </View>
                        <Text style={[styles.balancePillVal, { color: "#10B981" }]}>
                          {formatNaira(client.savings_balance, hideBalances)}
                        </Text>
                      </View>

                      <View
                        style={[
                          styles.balancePill,
                          { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                        ]}
                      >
                        <View style={styles.pillLabelRow}>
                          <Ionicons
                            name="trending-down"
                            size={11}
                            color={client.loan_balance > 0 ? RED_ACCENT : colors.textMuted}
                          />
                          <Text style={[styles.balancePillLabel, { color: colors.textMuted }]}>ACTIVE LOAN</Text>
                        </View>
                        <Text
                          style={[
                            styles.balancePillVal,
                            { color: client.loan_balance > 0 ? RED_ACCENT : colors.textMuted },
                          ]}
                        >
                          {client.loan_balance > 0 ? formatNaira(client.loan_balance, hideBalances) : "Clear"}
                        </Text>
                      </View>
                    </View>

                    {/* Tenure Qualified Status */}
                    {client.loan_balance > 0 && (
                      <View
                        style={[
                          styles.installmentStatusRow,
                          { backgroundColor: isDark ? "rgba(0,0,0,0.2)" : "rgba(0,0,0,0.02)" },
                        ]}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                          <Ionicons
                            name={client.installments_paid >= 10 ? "shield-checkmark" : "lock-closed"}
                            size={13}
                            color={client.installments_paid >= 10 ? "#10B981" : RED_ACCENT}
                          />
                          <Text
                            style={[
                              styles.installmentStatusText,
                              { color: client.installments_paid >= 10 ? "#10B981" : RED_ACCENT },
                            ]}
                          >
                            {client.installments_paid >= 10
                              ? `Qualified (${client.installments_paid}/${client.active_loan_installments} Paid)`
                              : `Tenure Lock: ${client.installments_paid}/10 Paid`}
                          </Text>
                        </View>
                        <Text style={[styles.installmentAmountText, { color: colors.textMuted }]}>
                          Due: {formatNaira(client.total_installment_amount, hideBalances)}
                        </Text>
                      </View>
                    )}

                    {/* Action Buttons */}
                    <View style={styles.cardActionsRow}>
                      <Pressable
                        onPress={() => openActionSheetForClient(client, "withdrawal")}
                        disabled={hasPaidToday || !deductionEligibility.ok}
                        style={({ pressed }) => [
                          styles.primaryActionBtn,
                          {
                            backgroundColor: RED_ACCENT,
                            opacity: hasPaidToday || !deductionEligibility.ok ? 0.38 : 1,
                            transform: [{ scale: pressed ? 0.98 : 1 }],
                          },
                        ]}
                      >
                        <Ionicons name="repeat-outline" size={15} color="#fff" />
                        <Text style={styles.primaryActionBtnText}>
                          Deduct {formatNaira(client.total_installment_amount)}
                        </Text>
                      </Pressable>

                      <Pressable
                        onPress={() => openActionSheetForClient(client, "cash")}
                        disabled={hasPaidToday}
                        style={({ pressed }) => [
                          styles.secondaryActionBtn,
                          {
                            borderColor: glassBorder,
                            backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "#F1F5F9",
                            opacity: hasPaidToday ? 0.4 : 1,
                            transform: [{ scale: pressed ? 0.94 : 1 }],
                          },
                        ]}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color={colors.text} />
                      </Pressable>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ================= AUDITED ACTIVITY STREAM ================= */}
          <View style={[styles.sectionHeader, { marginTop: 24 }]}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Audited History</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Recent payouts & deductions</Text>
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
                      backgroundColor: historyFilter === f ? RED_ACCENT : "transparent",
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

          {/* Search History */}
          {history.length > 3 && (
            <View style={[styles.searchContainer, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, marginBottom: 10 }]}>
              <Ionicons name="search" size={16} color={colors.textMuted} />
              <TextInput
                value={historySearch}
                onChangeText={setHistorySearch}
                placeholder="Search recent client or Ref ID..."
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
              <SkeletonItem cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
            </View>
          ) : filteredHistory.length === 0 ? (
            <View style={[styles.emptyBox, { borderColor: glassBorder, backgroundColor: cardSurfaceBg }]}>
              <Ionicons name="file-tray-outline" size={30} color={colors.textMuted} />
              <Text style={[styles.emptyBoxTitle, { color: colors.text }]}>No records found</Text>
              <Text style={[styles.emptyBoxSub, { color: colors.textMuted }]}>Transactions will show up here</Text>
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
                  <View style={[styles.txIconBox, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}>
                    <Ionicons
                      name={
                        tx.type === "cash"
                          ? "cash-outline"
                          : tx.type === "return"
                          ? "checkmark-done-circle-outline"
                          : "wallet-outline"
                      }
                      size={18}
                      color={RED_ACCENT}
                    />
                  </View>
                  <View style={{ flex: 1, marginHorizontal: 10 }}>
                    <Text style={[styles.txClientName, { color: colors.text }]} numberOfLines={1}>
                      {tx.client_name}
                    </Text>
                    <View style={styles.txMetaRow}>
                      <View style={[styles.txTypeTag, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}>
                        <Text style={[styles.txTypeTagText, { color: RED_ACCENT }]}>{tx.type.toUpperCase()}</Text>
                      </View>
                      <Text style={[styles.txUnionTag, { color: colors.textMuted }]}>• {tx.union || "Union"}</Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.txAmount, { color: RED_ACCENT }]}>
                      {formatNaira(tx.amount, hideBalances)}
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
                <ActivityIndicator size="small" color={RED_ACCENT} />
              ) : (
                <>
                  <Text style={[styles.loadMoreText, { color: colors.text }]}>Load More Audits</Text>
                  <Ionicons name="chevron-down" size={14} color={colors.text} />
                </>
              )}
            </Pressable>
          )}
        </Animated.ScrollView>

        {/* ================= TRANSACTION EXECUTION MODAL SHEET ================= */}
        <Modal
          visible={actionSheetVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setActionSheetVisible(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.sheetHandle} />

              <View style={styles.modalSheetHead}>
                <View>
                  <Text style={[styles.modalSheetTitle, { color: colors.text }]}>Process Withdrawal</Text>
                  <Text style={[styles.modalSheetSub, { color: colors.textMuted }]}>
                    {selectedClient?.name} • {selectedClient?.union || "Union"}
                  </Text>
                </View>
                <Pressable onPress={() => setActionSheetVisible(false)} hitSlop={10} style={styles.closeModalBtn}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {/* 3-Way Segmented Switcher */}
                <View style={[styles.segmentedWrap, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "#F1F5F9" }]}>
                  {[
                    { key: "withdrawal", label: "Installment", icon: "repeat-outline" },
                    { key: "cash", label: "Cash Payout", icon: "cash-outline" },
                    { key: "return", label: "Payoff Loan", icon: "checkmark-done-circle-outline" },
                  ].map((tab) => {
                    const isSelected = withdrawalType === tab.key;
                    const isCashOfflineBlocked = tab.key === "cash" && isOffline;
                    const isBlocked = blockedTypes.includes(tab.key) || isCashOfflineBlocked;
                    return (
                      <Pressable
                        key={tab.key}
                        disabled={isBlocked}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setWithdrawalType(tab.key as WithdrawalType);
                        }}
                        style={[
                          styles.segmentBtn,
                          isSelected && {
                            backgroundColor: colors.card,
                            shadowColor: "#000",
                            shadowOpacity: 0.1,
                            shadowRadius: 3,
                            elevation: 2,
                          },
                          isBlocked && { opacity: 0.3 },
                        ]}
                      >
                        <Ionicons
                          name={tab.icon as any}
                          size={13}
                          color={isSelected ? RED_ACCENT : colors.textMuted}
                          style={{ marginRight: 4 }}
                        />
                        <Text
                          style={[
                            styles.segmentBtnText,
                            {
                              color: isSelected ? RED_ACCENT : colors.textMuted,
                              fontWeight: isSelected ? "800" : "600",
                            },
                          ]}
                        >
                          {tab.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>

                {/* Eligibility Pill Banner */}
                <View
                  style={[
                    styles.eligibilityBanner,
                    {
                      backgroundColor: activeEligibility.ok
                        ? isDark
                          ? "rgba(16, 185, 129, 0.12)"
                          : "#ECFDF5"
                        : isDark
                        ? "rgba(239, 68, 68, 0.12)"
                        : "#FEF2F2",
                      borderColor: activeEligibility.ok ? "#10B98130" : "#EF444430",
                    },
                  ]}
                >
                  <Ionicons
                    name={activeEligibility.ok ? "checkmark-circle" : "alert-circle"}
                    size={16}
                    color={activeEligibility.ok ? "#10B981" : RED_ACCENT}
                  />
                  <Text
                    style={[
                      styles.eligibilityBannerText,
                      { color: activeEligibility.ok ? (isDark ? "#34D399" : "#065F46") : RED_ACCENT },
                    ]}
                  >
                    {activeEligibility.msg}
                  </Text>
                </View>

                {/* Amount Input */}
                <View style={{ gap: 8, marginVertical: 14 }}>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                    {withdrawalType === "withdrawal" && "INSTALLMENT AMOUNT (AUTO-CALCULATED)"}
                    {withdrawalType === "cash" && (isOffline ? "CASH PAYOUT - DISABLED OFFLINE" : "CASH AMOUNT TO WITHDRAW")}
                    {withdrawalType === "return" && "FULL PAYOFF DEDUCTION AMOUNT"}
                  </Text>

                  {withdrawalType === "cash" ? (
                    <>
                      <View style={[styles.amountInputWrap, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                        <Text style={[styles.nairaPrefix, { color: RED_ACCENT }]}>₦</Text>
                        <TextInput
                          value={customAmount}
                          onChangeText={(val) => setCustomAmount(formatRawNumber(val))}
                          placeholder="0"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="numeric"
                          autoFocus
                          style={[styles.amountInput, { color: colors.text }]}
                        />
                        {customAmount.length > 0 && (
                          <Pressable onPress={() => setCustomAmount("")} hitSlop={8}>
                            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                          </Pressable>
                        )}
                      </View>

                      {/* Quick Add Cash Chips */}
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.quickAddRow}>
                        {CASH_QUICK_ADD.map((amt) => (
                          <Pressable
                            key={amt}
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              const cur = Number(customAmount.replace(/[^0-9]/g, "")) || 0;
                              setCustomAmount(formatRawNumber(String(cur + amt)));
                            }}
                            style={[
                              styles.quickAddChip,
                              { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "#F1F5F9", borderColor: glassBorder },
                            ]}
                          >
                            <Text style={[styles.quickAddChipText, { color: colors.text }]}>
                              +{amt >= 1000 ? `${amt / 1000}k` : amt}
                            </Text>
                          </Pressable>
                        ))}
                        {selectedClient && selectedClient.savings_balance > 0 && (
                          <Pressable
                            onPress={() => {
                              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                              const maxCash = Math.min(selectedClient.savings_balance, settings.max_cash_withdrawal || 50000);
                              setCustomAmount(formatRawNumber(String(maxCash)));
                            }}
                            style={[
                              styles.quickAddChip,
                              { backgroundColor: "rgba(239, 68, 68, 0.12)", borderColor: "rgba(239, 68, 68, 0.3)" },
                            ]}
                          >
                            <Text style={[styles.quickAddChipText, { color: RED_ACCENT, fontWeight: "800" }]}>
                              Max Cash
                            </Text>
                          </Pressable>
                        )}
                      </ScrollView>
                    </>
                  ) : (
                    <View style={[styles.readOnlyAmountBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                      <Text style={[styles.readOnlyNaira, { color: RED_ACCENT }]}>₦</Text>
                      <Text style={[styles.readOnlyAmountText, { color: colors.text }]}>
                        {effectiveTransactionAmount.toLocaleString("en-NG")}
                      </Text>
                      <View style={styles.fixedBadge}>
                        <Text style={styles.fixedBadgeText}>
                          {withdrawalType === "withdrawal" ? "Exact Installment" : "Full Loan Payoff"}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* Photo Upload (Cash Only) */}
                {withdrawalType === "cash" && (
                  <View style={{ gap: 8, marginBottom: 16 }}>
                    <View style={styles.photoHeaderRow}>
                      <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>
                        RECEIPT VERIFICATION {Boolean(settings.require_image_for_cash) && <Text style={{ color: RED_ACCENT }}>*</Text>}
                      </Text>
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <Pressable onPress={() => pickProofImage(true)} style={styles.photoActionChip}>
                          <Ionicons name="camera" size={13} color={RED_ACCENT} />
                          <Text style={[styles.photoActionText, { color: RED_ACCENT }]}>Camera</Text>
                        </Pressable>
                        <Pressable onPress={() => pickProofImage(false)} style={styles.photoActionChip}>
                          <Ionicons name="image" size={13} color={RED_ACCENT} />
                          <Text style={[styles.photoActionText, { color: RED_ACCENT }]}>Gallery</Text>
                        </Pressable>
                      </View>
                    </View>

                    {proofImageUri ? (
                      <View style={[styles.previewWrap, { borderColor: glassBorder }]}>
                        <Image source={{ uri: proofImageUri }} style={styles.previewImage} />
                        <View style={styles.photoVerifiedBadge}>
                          <Ionicons name="checkmark-circle" size={14} color="#10B981" />
                          <Text style={styles.photoVerifiedText}>Proof Photo Attached</Text>
                        </View>
                        <Pressable
                          onPress={() => {
                            setProofImageUri(null);
                            setProofBase64(null);
                          }}
                          style={styles.removeImageBtn}
                        >
                          <Ionicons name="trash-outline" size={15} color="#fff" />
                        </Pressable>
                      </View>
                    ) : (
                      <Pressable
                        onPress={() => pickProofImage(true)}
                        style={[styles.uploadBox, { backgroundColor: colors.background, borderColor: glassBorder }]}
                      >
                        <Ionicons name="camera-outline" size={24} color={RED_ACCENT} />
                        <Text style={[styles.uploadBoxText, { color: colors.text }]}>Capture Verification Photo</Text>
                        <Text style={[styles.uploadBoxSub, { color: colors.textMuted }]}>Sign-off slip or member receipt</Text>
                      </Pressable>
                    )}
                  </View>
                )}

                {/* Live Vault Balance Breakdown */}
                {selectedClient && (
                  <View
                    style={[
                      styles.summaryPreviewCard,
                      { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC", borderColor: glassBorder },
                    ]}
                  >
                    <View style={styles.summaryPreviewRow}>
                      <Text style={[styles.sPreviewLabel, { color: colors.textMuted }]}>Current Savings Vault</Text>
                      <Text style={[styles.sPreviewVal, { color: colors.text }]}>{formatNaira(selectedClient.savings_balance)}</Text>
                    </View>
                    <View style={styles.summaryPreviewRow}>
                      <Text style={[styles.sPreviewLabel, { color: colors.textMuted }]}>Deduction Amount</Text>
                      <Text style={[styles.sPreviewVal, { color: RED_ACCENT, fontWeight: "800" }]}>
                        -{formatNaira(effectiveTransactionAmount)}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.summaryPreviewRow,
                        { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: glassBorder, paddingTop: 6 },
                      ]}
                    >
                      <Text style={[styles.sPreviewLabel, { color: colors.text, fontWeight: "700" }]}>Remaining Vault Balance</Text>
                      <Text style={[styles.sPreviewVal, { color: "#10B981", fontWeight: "900" }]}>
                        {formatNaira(Math.max(0, selectedClient.savings_balance - effectiveTransactionAmount))}
                      </Text>
                    </View>
                  </View>
                )}

                {/* Authorize Action Button */}
                <Pressable
                  onPress={initiateReview}
                  disabled={isSubmitting || !activeEligibility.ok || effectiveTransactionAmount <= 0}
                  style={({ pressed }) => [
                    styles.submitBtn,
                    {
                      backgroundColor: RED_ACCENT,
                      opacity: isSubmitting || !activeEligibility.ok || effectiveTransactionAmount <= 0 ? 0.45 : 1,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                >
                  <Ionicons name="shield-checkmark" size={18} color="#fff" />
                  <Text style={styles.submitBtnText}>
                    {effectiveTransactionAmount > 0
                      ? `Authorize ${formatNaira(effectiveTransactionAmount)}`
                      : "Input Valid Amount"}
                  </Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* ================= CONFIRMATION REVIEW MODAL ================= */}
        <Modal visible={showConfirmModal} transparent animationType="fade" onRequestClose={() => setShowConfirmModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.confirmSheet, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.confirmHeader}>
                <View style={[styles.confirmIconBadge, { backgroundColor: "rgba(239, 68, 68, 0.14)" }]}>
                  <Ionicons name="warning-outline" size={24} color={RED_ACCENT} />
                </View>
                <Text style={[styles.confirmTitle, { color: colors.text }]}>Authorize Transaction</Text>
                <Text style={[styles.confirmSub, { color: colors.textMuted }]}>
                  {withdrawalType === "return"
                    ? "This action will apply client savings to clear their active debt balance."
                    : "Please review deduction parameters before finalizing."}
                </Text>
              </View>

              <View style={[styles.confirmTable, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Client</Text>
                  <Text style={[styles.cfVal, { color: colors.text }]}>{selectedClient?.name}</Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Mode</Text>
                  <Text style={[styles.cfVal, { color: RED_ACCENT, fontWeight: "800" }]}>
                    {withdrawalType.toUpperCase()}
                  </Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>Deduction Amount</Text>
                  <Text style={[styles.cfVal, { color: RED_ACCENT, fontSize: 15, fontWeight: "900" }]}>
                    {formatNaira(effectiveTransactionAmount)}
                  </Text>
                </View>
                <View style={styles.confirmRow}>
                  <Text style={[styles.cfLabel, { color: colors.textMuted }]}>New Vault Balance</Text>
                  <Text style={[styles.cfVal, { color: "#10B981", fontWeight: "800" }]}>
                    {formatNaira(Math.max(0, (selectedClient?.savings_balance || 0) - effectiveTransactionAmount))}
                  </Text>
                </View>
              </View>

              <View style={styles.confirmActions}>
                <Pressable
                  onPress={() => setShowConfirmModal(false)}
                  style={[styles.cancelBtn, { borderColor: glassBorder }]}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.text }]}>Cancel</Text>
                </Pressable>

                <Pressable onPress={handleFinalSubmission} style={[styles.confirmFinalBtn, { backgroundColor: RED_ACCENT }]}>
                  <Ionicons name="checkmark-done" size={17} color="#fff" />
                  <Text style={styles.confirmFinalBtnText}>Confirm</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>

        {/* ================= RECEIPT DETAIL MODAL (MATCHING DASHBOARD) ================= */}
        <Modal visible={showReceiptModal} transparent animationType="fade" onRequestClose={() => setShowReceiptModal(false)}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowReceiptModal(false)} />
            <View style={[styles.receiptBox, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.modalHandle} />
              <View style={[styles.receiptTopCircle, { backgroundColor: "rgba(239, 68, 68, 0.12)" }]}>
                <Ionicons name="wallet-outline" size={28} color={RED_ACCENT} />
              </View>

              <Text style={[styles.receiptHeading, { color: colors.text }]}>
                {receiptData?.client_name || "Client Transaction"}
              </Text>
              <Text style={[styles.receiptAmountText, { color: RED_ACCENT }]}>
                -{formatNaira(receiptData?.amount_deducted || receiptData?.amount || 0)}
              </Text>

              <View style={styles.statusSuccessPill}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                <Text style={styles.statusSuccessText}>
                  {receiptData?.loan_paid_off ? "Active Debt Fully Satisfied" : "Savings Deduction Recorded"}
                </Text>
              </View>

              {receiptData && (
                <View style={[styles.modalDetailsGroup, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(148, 163, 184, 0.08)" }]}>
                  <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                    <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Mode</Text>
                    <Text style={[styles.modalDetailVal, { color: colors.text }]}>
                      {String(receiptData.type || "withdrawal").toUpperCase()}
                    </Text>
                  </View>

                  <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                    <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Remaining Savings</Text>
                    <Text style={[styles.modalDetailVal, { color: "#10B981" }]}>
                      {formatNaira(receiptData.savings_balance_after ?? receiptData.balance_after)}
                    </Text>
                  </View>

                  {receiptData.loan_remaining_balance !== undefined && (
                    <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                      <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Remaining Loan</Text>
                      <Text style={[styles.modalDetailVal, { color: colors.text }]}>
                        {formatNaira(receiptData.loan_remaining_balance)}
                      </Text>
                    </View>
                  )}

                  <View style={[styles.modalDetailRow, { borderColor: glassBorder, borderBottomWidth: 0 }]}>
                    <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Ref ID</Text>
                    <Pressable
                      onPress={() => copyTxCode(receiptData.transaction_id)}
                      hitSlop={6}
                      style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                    >
                      <Text style={[styles.modalDetailVal, { color: colors.primary, fontFamily: "monospace" }]}>
                        {receiptData.transaction_id}
                      </Text>
                      <Ionicons name="copy-outline" size={12} color={colors.primary} />
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
                  style={[styles.modalPrimaryBtn, { backgroundColor: RED_ACCENT }]}
                >
                  <Text style={styles.modalCloseText}>Done</Text>
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

  weekendBanner: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: RED_ACCENT,
    padding: 12,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  weekendBannerText: { color: "#fff", fontSize: 11.5, fontWeight: "700", flex: 1 },

  /* ================= HERO CARD (MATCHING DASHBOARD HERO) ================= */
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
  ratioWithdrawBar: {
    backgroundColor: RED_ACCENT,
    height: "100%",
  },
  ratioSavingsBar: {
    backgroundColor: "#10B981",
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

  /* SEARCH INPUT */
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

  /* CLIENT CARDS */
  clientCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 15,
    gap: 11,
  },
  clientCardHeader: { flexDirection: "row", alignItems: "center" },
  avatarBox: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 15, fontWeight: "900" },
  clientCardName: { fontSize: 14.5, fontWeight: "800" },
  clientCardMeta: { fontSize: 11, marginTop: 1, fontWeight: "500" },
  netBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  netBadgeText: { fontSize: 9.5, fontWeight: "800" },
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

  clientBalanceGrid: { flexDirection: "row", gap: 8 },
  balancePill: { flex: 1, padding: 10, borderRadius: 12, alignItems: "center" },
  pillLabelRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  balancePillLabel: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.4 },
  balancePillVal: { fontSize: 13.5, fontWeight: "900" },

  installmentStatusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  installmentStatusText: { fontSize: 10.5, fontWeight: "700" },
  installmentAmountText: { fontSize: 10.5, fontWeight: "600" },

  cardActionsRow: { flexDirection: "row", gap: 8, marginTop: 2 },
  primaryActionBtn: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  primaryActionBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  secondaryActionBtn: {
    width: 44,
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  /* EMPTY BOX */
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

  /* HISTORY FILTER & STREAM */
  historyFilterTabs: { flexDirection: "row", backgroundColor: "rgba(0,0,0,0.06)", borderRadius: 10, padding: 2 },
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
  txIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  txClientName: { fontSize: 13, fontWeight: "700" },
  txMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  txTypeTag: { paddingHorizontal: 5, paddingVertical: 1.5, borderRadius: 4 },
  txTypeTagText: { fontSize: 9, fontWeight: "800" },
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

  /* BOTTOM SHEET MODAL */
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 20, maxHeight: "88%" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 14 },
  modalSheetHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 },
  modalSheetTitle: { fontSize: 16, fontWeight: "800" },
  modalSheetSub: { fontSize: 11.5, marginTop: 1 },
  closeModalBtn: { padding: 4 },

  segmentedWrap: { flexDirection: "row", borderRadius: 12, padding: 3, marginBottom: 12 },
  segmentBtn: { flex: 1, paddingVertical: 8, borderRadius: 9, flexDirection: "row", alignItems: "center", justifyContent: "center" },
  segmentBtnText: { fontSize: 11.5 },

  eligibilityBanner: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: 10, borderWidth: 1, marginBottom: 6 },
  eligibilityBannerText: { fontSize: 11.5, fontWeight: "700", flex: 1 },

  fieldLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  amountInputWrap: { flexDirection: "row", alignItems: "center", height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  nairaPrefix: { fontSize: 19, fontWeight: "900", marginRight: 6 },
  amountInput: { flex: 1, fontSize: 18, fontWeight: "900", height: "100%" },

  readOnlyAmountBox: { flexDirection: "row", alignItems: "center", height: 48, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12 },
  readOnlyNaira: { fontSize: 19, fontWeight: "900", marginRight: 6 },
  readOnlyAmountText: { fontSize: 18, fontWeight: "900", flex: 1 },
  fixedBadge: { backgroundColor: "rgba(239, 68, 68, 0.12)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  fixedBadgeText: { fontSize: 10, fontWeight: "800", color: RED_ACCENT },

  quickAddRow: { gap: 8, marginTop: 6 },
  quickAddChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  quickAddChipText: { fontSize: 11, fontWeight: "700" },

  photoHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  photoActionChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "rgba(239, 68, 68, 0.12)" },
  photoActionText: { fontSize: 10.5, fontWeight: "700" },
  uploadBox: { height: 85, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center", gap: 3 },
  uploadBoxText: { fontSize: 12, fontWeight: "700" },
  uploadBoxSub: { fontSize: 10, fontWeight: "500" },
  previewWrap: { position: "relative", borderRadius: 12, overflow: "hidden", borderWidth: 1, height: 115 },
  previewImage: { width: "100%", height: "100%", resizeMode: "cover" },
  photoVerifiedBadge: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(0,0,0,0.7)", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  photoVerifiedText: { color: "#fff", fontSize: 10.5, fontWeight: "700" },
  removeImageBtn: { position: "absolute", top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(239, 68, 68, 0.85)", alignItems: "center", justifyContent: "center" },

  summaryPreviewCard: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 6, marginBottom: 16 },
  summaryPreviewRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sPreviewLabel: { fontSize: 11.5, fontWeight: "600" },
  sPreviewVal: { fontSize: 12.5, fontWeight: "700" },

  submitBtn: {
    height: 48,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 16,
  },
  submitBtnText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  /* MODAL OVERLAY & REVIEW */
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
  confirmFinalBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  /* RECEIPT OVERLAY (MATCHING DASHBOARD DETAIL MODAL) */
  receiptBox: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 24,
    alignItems: "center",
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
  modalCloseText: { color: "#FFF", fontSize: 13, fontWeight: "700" },

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