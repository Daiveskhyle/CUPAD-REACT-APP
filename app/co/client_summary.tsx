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
  Platform,
  RefreshControl,
  Linking,
  LayoutAnimation,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cacheClients,
  isOnline,
} from "../../src/db/database";
import {
  fetchUnionsForOfficer,
  bootstrapCoScreenData,
} from "../../src/db/offlineHelpers";
import { hydrateOfflineCache } from "../../src/db/sync";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_FINANCIAL_SUMMARY = `${API_BASE}/api/client_financial_summary.php`;
const API_CLIENTS_API = `${API_BASE}/api/clients_api.php`;

const CACHE_KEYS = {
  FINANCIAL_SUMMARY_DATA: "cupad_cache_co_financial_summary_data",
  FINANCIAL_SUMMARY_TOTALS: "cupad_cache_co_financial_summary_totals",
  LAST_SYNC: "cupad_cache_co_financial_last_sync",
};

export type FinancialClient = {
  id: string | number;
  name: string;
  phone: string;
  union: string;
  savings: number;
  loan_balance: number;
  loan_principal: number;
  loan_progress: number;
  net_position: number;
  has_loan: boolean;
  status_type: "saver" | "debtor" | "risk";
};

export type UnionGroup = {
  name: string;
  clients: FinancialClient[];
  totals: {
    savings: number;
    loans: number;
    net: number;
    count: number;
    risk_count: number;
  };
};

export type GrandTotals = {
  savings: number;
  loans: number;
  net: number;
  clients_count: number;
  debtors_count: number;
  savers_count: number;
  risk_count: number;
};

type HistoryItem = {
  timestamp: number;
  date_formatted: string;
  type: "savings" | "loan" | "repayment";
  title: string;
  amount: string;
  raw_amount: number;
  description: string;
  icon?: any;
  transaction_id: string;
  is_withdrawal?: boolean;
};

function parseAmount(val: any): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

function formatNaira(amount: number | string): string {
  const num = parseAmount(amount);
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatSyncTime(isoString: string | null): string {
  if (!isoString) return "Never";
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 45) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoString).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
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

export default function ClientSummaryScreen() {
  const { colors, isDark } = useTheme();

  // Design tokens
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37,99,235,0.18)" : "rgba(37,99,235,0.10)";
  const orbColor2 = isDark ? "rgba(14,165,233,0.14)" : "rgba(14,165,233,0.08)";
  const shadowDark = {
    shadowColor: "#000",
    shadowOpacity: isDark ? 0.28 : 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  } as any;
  const shadowLight = {
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  } as any;

  // Officer Session
  const [officerUsername, setOfficerUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);

  // Grouped Data & Totals
  const [unionsData, setUnionsData] = useState<Record<string, UnionGroup>>({});
  const [grandTotals, setGrandTotals] = useState<GrandTotals>({
    savings: 0,
    loans: 0,
    net: 0,
    clients_count: 0,
    debtors_count: 0,
    savers_count: 0,
    risk_count: 0,
  });

  // UI States
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"all" | "debtor" | "saver" | "risk">("all");
  const [collapsedUnions, setCollapsedUnions] = useState<Record<string, boolean>>({});

  // History Ledger Modal State
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [selectedHistoryClient, setSelectedHistoryClient] = useState<FinancialClient | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<HistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "savings" | "loan" | "repayment">("all");
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historySummary, setHistorySummary] = useState<{ savings: number; loan: number }>({ savings: 0, loan: 0 });

  // Floating Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastY = useRef(new Animated.Value(-60)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, []);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    Animated.parallel([
      Animated.spring(toastY, { toValue: 0, tension: 90, friction: 9, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastY, { toValue: -40, duration: 250, useNativeDriver: true }),
        Animated.timing(toastOpacity, { toValue: 0, duration: 250, useNativeDriver: true }),
      ]).start(() => setToastMessage(null));
    }, 2200);
  };

  const copyTxCode = async (code: string) => {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`Copied Ref: #${code}`);
  };

  const makeCall = (phone?: string) => {
    if (!phone || phone === "N/A" || phone.trim() === "") {
      Alert.alert("No Phone", "This client has no contact telephone registered.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`);
  };

  const openWhatsApp = (phone?: string) => {
    if (!phone || phone === "N/A" || phone.trim() === "") {
      Alert.alert("No Phone", "This client has no WhatsApp telephone registered.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let p = phone.replace(/\D/g, "");
    if (p.startsWith("0")) p = "234" + p.substring(1);
    const waUrl = `https://wa.me/${p}`;
    Linking.canOpenURL(waUrl)
      .then((supported) => {
        if (supported) Linking.openURL(waUrl);
        else Alert.alert("WhatsApp Missing", "WhatsApp is not installed on this device.");
      })
      .catch(() => Alert.alert("Error", "Could not launch WhatsApp."));
  };

  const toggleUnion = (unionName: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCollapsedUnions((prev) => ({
      ...prev,
      [unionName]: !prev[unionName],
    }));
  };

  const areAllCollapsed = useMemo(() => {
    const keys = Object.keys(unionsData);
    if (!keys.length) return false;
    return keys.every((k) => collapsedUnions[k]);
  }, [unionsData, collapsedUnions]);

  const toggleAllUnions = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const nextState: Record<string, boolean> = {};
    const willCollapse = !areAllCollapsed;
    Object.keys(unionsData).forEach((k) => {
      nextState[k] = willCollapse;
    });
    setCollapsedUnions(nextState);
  };

  const processClientsData = useCallback((rawClients: any[], serverTotals?: any) => {
    const unions: Record<string, UnionGroup> = {};
    const totals: GrandTotals = {
      savings: 0,
      loans: 0,
      net: 0,
      clients_count: 0,
      debtors_count: 0,
      savers_count: 0,
      risk_count: 0,
    };

    rawClients.forEach((row) => {
      const uName = (row.union || row.union_name || "Unassigned").trim();
      const savings = parseAmount(
        row.savings ?? row.savings_balance ?? row.total_savings ?? row.balance ?? row.wallet_balance ?? 0
      );
      const loanBalance = parseAmount(
        row.outstanding_loan ?? row.loan_balance ?? row.total_loan ?? row.loan ?? row.amount_due ?? 0
      );
      const principal = parseAmount(
        row.loan_principal ?? row.principal ?? row.loan_amount ?? row.original_loan ?? (loanBalance > 0 ? loanBalance : 0)
      );

      const hasLoan = loanBalance > 0;
      let loanProgress = 0;
      if (hasLoan && principal > 0) {
        const repaid = Math.max(0, principal - loanBalance);
        loanProgress = Math.min(100, Math.round((repaid / principal) * 100));
      }

      const netPos = savings - loanBalance;
      let statusType: "saver" | "debtor" | "risk" = "saver";
      if (hasLoan) statusType = "debtor";
      if (netPos < 0) statusType = "risk";

      const clientObj: FinancialClient = {
        id: row.id,
        name: row.name || "Unknown Client",
        phone: row.phone || "",
        union: uName,
        savings,
        loan_balance: loanBalance,
        loan_principal: principal,
        loan_progress: loanProgress,
        net_position: netPos,
        has_loan: hasLoan,
        status_type: statusType,
      };

      if (!unions[uName]) {
        unions[uName] = {
          name: uName,
          clients: [],
          totals: { savings: 0, loans: 0, net: 0, count: 0, risk_count: 0 },
        };
      }

      unions[uName].clients.push(clientObj);
      unions[uName].totals.savings += savings;
      unions[uName].totals.loans += loanBalance;
      unions[uName].totals.net += netPos;
      unions[uName].totals.count += 1;
      if (statusType === "risk") unions[uName].totals.risk_count += 1;

      totals.savings += savings;
      totals.loans += loanBalance;
      totals.net += netPos;
      totals.clients_count += 1;
      if (hasLoan) totals.debtors_count += 1;
      if (statusType === "saver") totals.savers_count += 1;
      if (statusType === "risk") totals.risk_count += 1;
    });

    return { unions, totals };
  }, []);

  const loadFinancialData = useCallback(
    async (useCacheFirst = true) => {
      if (useCacheFirst) setLoading(true);
      try {
        const stored = await AsyncStorage.getItem("cupad_user");
        let usernameForFetch = officerUsername;
        if (stored) {
          const user = JSON.parse(stored);
          if (user?.username) usernameForFetch = user.username;
        }
        if (!usernameForFetch) {
          setLoading(false);
          return;
        }

        const [cachedData, cachedTotals, cachedSync] = await Promise.all([
          AsyncStorage.getItem(CACHE_KEYS.FINANCIAL_SUMMARY_DATA),
          AsyncStorage.getItem(CACHE_KEYS.FINANCIAL_SUMMARY_TOTALS),
          AsyncStorage.getItem(CACHE_KEYS.LAST_SYNC),
        ]);

        if (useCacheFirst && cachedData && cachedTotals) {
          try {
            setUnionsData(JSON.parse(cachedData));
            setGrandTotals(JSON.parse(cachedTotals));
            if (cachedSync) setLastSyncTime(formatSyncTime(cachedSync));
            setLoading(false);
          } catch {}
        }

        const isOn = await isOnline();
        if (!isOn) {
          const boot = await bootstrapCoScreenData(usernameForFetch);
          if (boot.clients.length > 0) {
            const { unions, totals } = processClientsData(boot.clients);
            setUnionsData(unions);
            setGrandTotals(totals);
            if (cachedSync) setLastSyncTime(formatSyncTime(cachedSync));
            return;
          }
          if (cachedData) return;
        }

        const response = await axios.get(
          `${API_FINANCIAL_SUMMARY}?action=financial_summary&username=${encodeURIComponent(usernameForFetch)}`,
          { timeout: 12000 }
        );

        if (response.data?.success) {
          const fetchedClients = response.data.clients || [];
          const serverTotals = response.data.totals || response.data.grand_totals;
          const { unions, totals } = processClientsData(fetchedClients, serverTotals);

          setUnionsData(unions);
          setGrandTotals(serverTotals ? { ...totals, ...serverTotals } : totals);
          const now = new Date().toISOString();
          setLastSyncTime(formatSyncTime(now));

          await AsyncStorage.setItem(CACHE_KEYS.FINANCIAL_SUMMARY_DATA, JSON.stringify(unions));
          await AsyncStorage.setItem(CACHE_KEYS.FINANCIAL_SUMMARY_TOTALS, JSON.stringify(totals));
          await AsyncStorage.setItem(CACHE_KEYS.LAST_SYNC, now);
          try { await cacheClients(fetchedClients, usernameForFetch); } catch {}
          try { hydrateOfflineCache(usernameForFetch); } catch {}
          try { await fetchUnionsForOfficer(usernameForFetch); } catch {}
        } else {
          const boot = await bootstrapCoScreenData(usernameForFetch);
          if (boot.clients.length > 0) {
            const { unions, totals } = processClientsData(boot.clients);
            setUnionsData(unions);
            setGrandTotals(totals);
          }
        }
      } catch {
        try {
          const boot = await bootstrapCoScreenData(officerUsername);
          if (boot.clients.length > 0) {
            const { unions, totals } = processClientsData(boot.clients);
            setUnionsData(unions);
            setGrandTotals(totals);
          } else {
            const [cachedData, cachedTotals, cachedSync] = await Promise.all([
              AsyncStorage.getItem(CACHE_KEYS.FINANCIAL_SUMMARY_DATA),
              AsyncStorage.getItem(CACHE_KEYS.FINANCIAL_SUMMARY_TOTALS),
              AsyncStorage.getItem(CACHE_KEYS.LAST_SYNC),
            ]);
            if (cachedData) setUnionsData(JSON.parse(cachedData));
            if (cachedTotals) setGrandTotals(JSON.parse(cachedTotals));
            if (cachedSync) setLastSyncTime(formatSyncTime(cachedSync));
          }
        } catch {}
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [officerUsername, processClientsData]
  );

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem("cupad_user");
        if (stored) {
          const user = JSON.parse(stored);
          if (user?.username) setOfficerUsername(user.username);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    if (officerUsername) loadFinancialData();
  }, [officerUsername, loadFinancialData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadFinancialData(false);
  }, [loadFinancialData]);

  // Open client history modal & fetch via clients_api.php
  const openHistoryLedger = async (client: FinancialClient) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedHistoryClient(client);
    setHistoryFilter("all");
    setHistorySearchQuery("");
    setHistoryRecords([]);
    setHistorySummary({ savings: client.savings, loan: client.loan_balance });
    setHistoryLoading(true);
    setHistoryModalVisible(true);

    try {
      let activeUser = officerUsername;
      if (!activeUser) {
        const stored = await AsyncStorage.getItem("cupad_user");
        if (stored) {
          const u = JSON.parse(stored);
          if (u?.username) activeUser = u.username;
        }
      }

      const res = await axios.get(
        `${API_CLIENTS_API}?action=get_client_history&username=${encodeURIComponent(activeUser)}&client_id=${client.id}`,
        { timeout: 10000 }
      );

      if (res.data?.success) {
        setHistoryRecords(res.data.history || []);
        if (res.data.summary) {
          setHistorySummary({
            savings: parseAmount(res.data.summary.savings ?? client.savings),
            loan: parseAmount(res.data.summary.loan ?? client.loan_balance),
          });
        }
      }
    } catch {
      showToast("Viewing client ledger snapshot");
    } finally {
      setHistoryLoading(false);
    }
  };

  // Counts for history segmented tabs
  const historyCounts = useMemo(() => {
    const counts = { all: historyRecords.length, savings: 0, loan: 0, repayment: 0 };
    historyRecords.forEach((item) => {
      if (item.type === "savings") counts.savings += 1;
      else if (item.type === "loan") counts.loan += 1;
      else if (item.type === "repayment") counts.repayment += 1;
    });
    return counts;
  }, [historyRecords]);

  // Filtered timeline with search
  const filteredHistory = useMemo(() => {
    const q = historySearchQuery.toLowerCase().trim();
    return historyRecords.filter((item) => {
      const matchesType = historyFilter === "all" || item.type === historyFilter;
      if (!matchesType) return false;
      if (!q) return true;
      return (
        item.title?.toLowerCase().includes(q) ||
        item.description?.toLowerCase().includes(q) ||
        item.amount?.toLowerCase().includes(q) ||
        item.transaction_id?.toLowerCase().includes(q)
      );
    });
  }, [historyRecords, historyFilter, historySearchQuery]);

  const filteredUnions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const result: UnionGroup[] = [];
    Object.values(unionsData).forEach((union) => {
      const unionMatchesSearch = union.name.toLowerCase().includes(q);
      const matchedClients = union.clients.filter((c) => {
        const matchesFilter =
          activeFilter === "all" ||
          (activeFilter === "debtor" && (c.status_type === "debtor" || c.status_type === "risk")) ||
          (activeFilter === "risk" && c.status_type === "risk") ||
          (activeFilter === "saver" && c.status_type === "saver");
        if (!matchesFilter) return false;
        if (!q) return true;
        return unionMatchesSearch || c.name.toLowerCase().includes(q) || c.phone.includes(q);
      });
      if (matchedClients.length > 0) result.push({ ...union, clients: matchedClients });
    });
    return result;
  }, [unionsData, searchQuery, activeFilter]);

  const activeSummaryTotals = useMemo(() => {
    const isFiltered = Boolean(searchQuery.trim()) || activeFilter !== "all";
    if (!isFiltered) return { ...grandTotals, isFiltered: false };
    let savings = 0, loans = 0, net = 0, clients_count = 0, debtors_count = 0, savers_count = 0, risk_count = 0;
    filteredUnions.forEach((u) => {
      u.clients.forEach((c) => {
        savings += c.savings; loans += c.loan_balance; net += c.net_position; clients_count += 1;
        if (c.has_loan) debtors_count += 1;
        if (c.status_type === "saver") savers_count += 1;
        if (c.status_type === "risk") risk_count += 1;
      });
    });
    return { savings, loans, net, clients_count, debtors_count, savers_count, risk_count, isFiltered: true };
  }, [grandTotals, filteredUnions, searchQuery, activeFilter]);

  const isNetPositive = activeSummaryTotals.net >= 0;
  const unionGroupsArray = useMemo(() => Object.values(unionsData), [unionsData]);

  return (
    <CoScreenWrapper>
      {/* BACKGROUND ORBS */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={260} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={height * 0.45} delay={2000} />
      </View>

      {toastMessage && (
        <Animated.View style={[styles.toastBox, { backgroundColor: colors.card, borderColor: colors.cardBorder, opacity: toastOpacity, transform: [{ translateY: toastY }] }]}>
          <Ionicons name="checkmark-circle" size={17} color="#10B981" />
          <Text style={[styles.toastText, { color: colors.text }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        style={{ flex: 1, opacity: fadeAnim }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        {/* TERRITORY PILLS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.territoryRow}>
          <View style={[styles.territoryPill, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, ...shadowLight }]}>
            <Ionicons name="people-outline" size={12} color="#3B82F6" />
            <Text style={[styles.territoryText, { color: colors.text }]}>{activeSummaryTotals.clients_count} Clients</Text>
          </View>
          <View style={[styles.territoryPill, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, ...shadowLight }]}>
            <Ionicons name="business-outline" size={12} color="#8B5CF6" />
            <Text style={[styles.territoryText, { color: colors.text }]}>{Object.keys(unionsData).length} Unions</Text>
          </View>
          {lastSyncTime ? (
            <View style={[styles.territoryPill, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, ...shadowLight }]}>
              <View style={[styles.statusPulseDot, { backgroundColor: "#10B981" }]} />
              <Text style={[styles.territoryText, { color: colors.textMuted }]}>Updated {lastSyncTime}</Text>
            </View>
          ) : null}
        </ScrollView>

        {/* HERO GRAND TOTAL CARD */}
        <LinearGradient
          colors={isDark ? ["rgba(30, 41, 59, 0.88)", "rgba(15, 23, 42, 0.92)"] : ["#FFFFFF", "rgba(248, 250, 252, 0.95)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroCard, { borderColor: glassBorder, ...shadowDark }]}
        >
          <View style={styles.heroHeaderBar}>
            <View style={[styles.heroTagPill, { backgroundColor: isNetPositive ? "rgba(16,185,129,0.15)" : "rgba(239,68,68,0.15)" }]}>
              <View style={[styles.statusPulseDot, { backgroundColor: isNetPositive ? "#10B981" : "#EF4444" }]} />
              <Text style={[styles.heroTagText, { color: isNetPositive ? "#10B981" : "#EF4444" }]}>
                {activeSummaryTotals.isFiltered ? "FILTERED PORTFOLIO" : "PORTFOLIO OVERVIEW"}
              </Text>
            </View>
            <Pressable
              onPress={toggleAllUnions}
              style={[styles.syncTimePill, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}
            >
              <Ionicons name={areAllCollapsed ? "expand-outline" : "contract-outline"} size={12} color={colors.textMuted} />
              <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>{areAllCollapsed ? "Expand All" : "Collapse All"}</Text>
            </Pressable>
          </View>

          {/* Avatar Hero Row */}
          <View style={styles.avatarHeroRow}>
            <View style={styles.avatarStack}>
              <LinearGradient colors={isNetPositive ? ["#10B981","#059669"] : ["#EF4444","#DC2626"]} style={styles.heroAvatarGradient}>
                <Text style={styles.heroAvatarText}>{(officerUsername?.[0] || "C").toUpperCase()}</Text>
              </LinearGradient>
              <View style={[styles.heroAvatarRibbon, { backgroundColor: isNetPositive ? "#10B981" : "#EF4444" }]}>
                <Ionicons name={isNetPositive ? "trending-up" : "alert-circle"} size={10} color="#FFF" />
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                {activeSummaryTotals.isFiltered ? "FILTERED PORTFOLIO TOTALS" : "PORTFOLIO FINANCIAL SUMMARY"}
              </Text>
              <Text style={[styles.heroMetricsCount, { color: colors.text }]} numberOfLines={1}>
                {activeSummaryTotals.clients_count} Clients • {activeSummaryTotals.debtors_count} Borrowers
              </Text>
            </View>
            <View style={[styles.netPillHero, { backgroundColor: isNetPositive ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }]}>
              <Text style={[styles.netPillHeroText, { color: isNetPositive ? "#10B981" : "#EF4444" }]}>
                {isNetPositive ? "+" : ""}{formatNaira(activeSummaryTotals.net)}
              </Text>
            </View>
          </View>

          {/* Dual Balance */}
          <View style={styles.dualBalanceRow}>
            <View style={styles.dualCol}>
              <Text style={[styles.dualLabel, { color: colors.textMuted }]}>TOTAL SAVINGS</Text>
              <Text style={[styles.dualAmount, { color: "#10B981" }]} numberOfLines={1}>{formatNaira(activeSummaryTotals.savings)}</Text>
            </View>
            <View style={[styles.verticalDividerLight, { backgroundColor: glassBorder }]} />
            <View style={[styles.dualCol, { alignItems: "flex-end" }]}>
              <Text style={[styles.dualLabel, { color: colors.textMuted }]}>OUTSTANDING LOANS</Text>
              <Text style={[styles.dualAmount, { color: activeSummaryTotals.loans > 0 ? "#EF4444" : colors.text }]} numberOfLines={1}>{formatNaira(activeSummaryTotals.loans)}</Text>
            </View>
          </View>

          {/* Ratio bar */}
          <View style={styles.portfolioRatioContainer}>
            <View style={styles.ratioHeader}>
              <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>Net: {activeSummaryTotals.net >=0 ? "+" : ""}{formatNaira(activeSummaryTotals.net)}</Text>
              <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>{activeSummaryTotals.risk_count} high risk</Text>
            </View>
            <View style={styles.ratioTrack}>
              <View style={[styles.ratioSavingsBar, { width: `${Math.max(5, Math.min(95, (activeSummaryTotals.savings / Math.max(1, activeSummaryTotals.savings + activeSummaryTotals.loans)) * 100))}%` }]} />
            </View>
          </View>

          {/* Metrics 3-grid */}
          <View style={styles.heroMetricsGrid}>
            <View style={[styles.metricGridItem, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,245,249,0.65)" }]}>
              <View style={styles.metricItemHeader}><Ionicons name="trending-up" size={11} color="#3B82F6"/><Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>NET</Text></View>
              <Text style={[styles.metricItemValue, { color: isNetPositive ? "#10B981" : "#EF4444" }]} numberOfLines={1}>{isNetPositive ? "+" : ""}{formatNaira(activeSummaryTotals.net)}</Text>
            </View>
            <View style={[styles.metricGridItem, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,245,249,0.65)" }]}>
              <View style={styles.metricItemHeader}><Ionicons name="people" size={11} color="#F59E0B"/><Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>BORROWERS</Text></View>
              <Text style={[styles.metricItemValue, { color: colors.text }]}>{activeSummaryTotals.debtors_count}/{activeSummaryTotals.clients_count}</Text>
            </View>
            <View style={[styles.metricGridItem, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,245,249,0.65)", width: "100%" as any }]}>
              <View style={styles.metricItemHeader}><Ionicons name="alert-circle" size={11} color={activeSummaryTotals.risk_count>0 ? "#EF4444" : "#10B981"}/><Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>RISK</Text></View>
              <Text style={[styles.metricItemValue, { color: activeSummaryTotals.risk_count>0 ? "#EF4444" : "#10B981" }]}>{activeSummaryTotals.risk_count} clients</Text>
            </View>
          </View>
        </LinearGradient>

        {/* UNION GROUPS HORIZONTAL RAIL */}
        <View style={[styles.sectionHeader, { marginTop: 22 }]}>
          <View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Union Groups</Text>
            <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Portfolio breakdown by union</Text>
          </View>
          <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            <Text style={[styles.badgeCountText, { color: colors.textMuted }]}>{Object.keys(unionsData).length} unions</Text>
          </View>
        </View>

        {loading ? (
          <View style={{ flexDirection: "row", paddingHorizontal: 16, gap: 12 }}>
            {[1,2,3].map((i) => <Skeleton key={i} style={{ width: 220, height: 110, borderRadius: 16 }} />)}
          </View>
        ) : (
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={unionGroupsArray}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
            keyExtractor={(item) => item.name}
            renderItem={({ item }) => {
              const unionTotal = (item.totals.savings || 0) + (item.totals.loans || 0);
              const ratio = unionTotal > 0 ? ((item.totals.savings || 0) / unionTotal) * 100 : 50;
              return (
                <Pressable
                  onPress={() => { Haptics.selectionAsync(); setSearchQuery(item.name); }}
                  style={({ pressed }) => [styles.unionCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, transform: [{ scale: pressed ? 0.97 : 1 }], ...shadowLight }]}
                >
                  <View style={styles.unionCardTop}>
                    <Text style={[styles.unionCardName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                    <View style={[styles.unionClientBadgePill, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                      <Text style={[styles.unionClientBadge, { color: colors.textMuted }]}>{item.totals.count} clients</Text>
                    </View>
                  </View>
                  <View style={styles.unionAmountRow}>
                    <View><Text style={[styles.unionLabel, { color: colors.textMuted }]}>Savings</Text><Text style={[styles.unionValue, { color: "#10B981" }]}>{formatNaira(item.totals.savings)}</Text></View>
                    <View style={{ alignItems: "flex-end" }}><Text style={[styles.unionLabel, { color: colors.textMuted }]}>Loans</Text><Text style={[styles.unionValue, { color: "#EF4444" }]}>{formatNaira(item.totals.loans)}</Text></View>
                  </View>
                  <View style={styles.unionMicroBar}><View style={[styles.unionMicroSavings, { width: `${ratio}%` }]} /></View>
                </Pressable>
              );
            }}
          />
        )}

        {/* SEARCH & FILTER */}
        <View style={[styles.sectionHeader, { marginTop: 24 }]}>
          <View><Text style={[styles.sectionTitle, { color: colors.text }]}>Clients</Text><Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Audit financial standing</Text></View>
        </View>

        <View style={[styles.searchContainer, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, ...shadowLight }]}>
          <Ionicons name="search" size={18} color={colors.textMuted} />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search by client, union or phone..."
            placeholderTextColor={colors.textMuted}
            style={[styles.searchInput, { color: colors.text }]}
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterBarContainer}>
          {[
            { k: "all", label: "All" },
            { k: "debtor", label: "Borrowers" },
            { k: "saver", label: "Savers" },
            { k: "risk", label: "Risk" },
          ].map((tab) => {
            const active = activeFilter === tab.k;
            return (
              <Pressable
                key={tab.k}
                onPress={() => { Haptics.selectionAsync(); setActiveFilter(tab.k as any); }}
                style={[styles.filterChip, { backgroundColor: active ? colors.primary : cardSurfaceBg, borderColor: active ? colors.primary : glassBorder, ...shadowLight }]}
              >
                <Text style={[styles.filterChipText, { color: active ? "#FFF" : colors.textMuted }]}>{tab.label}</Text>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setViewMode(viewMode === "grid" ? "table" : "grid")} style={[styles.filterChip, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            <Ionicons name={viewMode === "grid" ? "list-outline" : "grid-outline"} size={12} color={colors.textMuted} />
            <Text style={[styles.filterChipText, { color: colors.textMuted, marginLeft: 4 }]}>{viewMode === "grid" ? "Table" : "Grid"}</Text>
          </Pressable>
        </ScrollView>

        {/* CLIENT CARDS LIST */}
        {loading ? (
          <View style={{ paddingHorizontal: 16, gap: 12, marginTop: 8 }}>
            {[1,2,3].map((i) => <Skeleton key={i} style={{ height: 124, borderRadius: 16 }} />)}
          </View>
        ) : filteredUnions.length === 0 ? (
          <View style={[styles.emptyCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, ...shadowLight }]}>
            <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
              <Ionicons name="search-outline" size={28} color={colors.textMuted} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.text }]}>No Matching Clients</Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>Try adjusting your filters or search query.</Text>
            <Pressable onPress={() => { setSearchQuery(""); setActiveFilter("all"); }} style={styles.resetFilterBtn}>
              <Ionicons name="reload-outline" size={13} color="#3B82F6" />
              <Text style={styles.resetFilterText}>Reset Filters</Text>
            </Pressable>
          </View>
        ) : (
          filteredUnions.map((union) => {
            const isCollapsed = Boolean(collapsedUnions[union.name]) && !searchQuery.trim();
            const unionInitial = (union.name[0] || "U").toUpperCase();
            const unionNetPos = union.totals.net >= 0;
            return (
              <View key={union.name} style={[styles.unionSectionCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, ...shadowLight }]}>
                <Pressable onPress={() => toggleUnion(union.name)} style={styles.unionHeaderPressable}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                    <View style={[styles.unionLetterBadge, { backgroundColor: isDark ? "rgba(59,130,246,0.25)" : "rgba(59,130,246,0.12)" }]}>
                      <Text style={styles.unionLetterText}>{unionInitial}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.unionTitle, { color: colors.text }]} numberOfLines={1}>{union.name}</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                        <Text style={[styles.unionSubCount, { color: colors.textMuted }]}>{union.clients.length} {union.clients.length === 1 ? "Member" : "Members"}</Text>
                        {union.totals.risk_count > 0 && (
                          <View style={styles.unionRiskBadge}>
                            <Ionicons name="alert-circle" size={10} color="#EF4444" />
                            <Text style={styles.unionRiskText}>{union.totals.risk_count} Risk</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={[styles.headerNetBadge, { backgroundColor: unionNetPos ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }]}>
                      <Text style={[styles.headerNetText, { color: unionNetPos ? "#10B981" : "#EF4444" }]}>{unionNetPos ? "+" : ""}{formatNaira(union.totals.net)}</Text>
                    </View>
                    <Ionicons name={isCollapsed ? "chevron-forward" : "chevron-down"} size={17} color={colors.textMuted} />
                  </View>
                </Pressable>

                {!isCollapsed && (
                  <View style={styles.unionContentBody}>
                    <View style={styles.unionStatRow}>
                      <View style={[styles.unionStatCard, { backgroundColor: isDark ? "rgba(16,185,129,0.1)" : "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.2)" }]}>
                        <Ionicons name="wallet-outline" size={14} color="#10B981" />
                        <View><Text style={styles.unionStatLabel}>SAVINGS</Text><Text style={[styles.unionStatVal, { color: "#10B981" }]} numberOfLines={1}>{formatNaira(union.totals.savings)}</Text></View>
                      </View>
                      <View style={[styles.unionStatCard, { backgroundColor: isDark ? "rgba(239,68,68,0.1)" : "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }]}>
                        <Ionicons name="hand-left-outline" size={14} color="#EF4444" />
                        <View><Text style={styles.unionStatLabel}>LOANS</Text><Text style={[styles.unionStatVal, { color: "#EF4444" }]} numberOfLines={1}>{formatNaira(union.totals.loans)}</Text></View>
                      </View>
                      <View style={[styles.unionStatCard, { backgroundColor: union.totals.net >=0 ? (isDark ? "rgba(59,130,246,0.1)" : "rgba(59,130,246,0.08)") : (isDark ? "rgba(245,158,11,0.1)" : "rgba(245,158,11,0.08)"), borderColor: union.totals.net >=0 ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)" }]}>
                        <Ionicons name={union.totals.net >=0 ? "trending-up" : "alert-circle"} size={14} color={union.totals.net >=0 ? "#3B82F6" : "#F59E0B"} />
                        <View><Text style={styles.unionStatLabel}>NET</Text><Text style={[styles.unionStatVal, { color: union.totals.net >=0 ? "#3B82F6" : "#F59E0B" }]} numberOfLines={1}>{union.totals.net >=0 ? "+" : ""}{formatNaira(union.totals.net)}</Text></View>
                      </View>
                    </View>

                    {viewMode === "grid" ? (
                      <View style={styles.gridContainer}>
                        {union.clients.map((client) => {
                          const isClientNetPos = client.net_position >= 0;
                          const initials = client.name.split(" ").map((n) => n[0]).join("").substring(0,2).toUpperCase();
                          return (
                            <Pressable
                              key={client.id}
                              onPress={() => openHistoryLedger(client)}
                              style={({ pressed }) => [
                                styles.clientSummaryCard,
                                {
                                  backgroundColor: cardSurfaceBg,
                                  borderColor: glassBorder,
                                  borderLeftColor: client.status_type === "saver" ? "#10B981" : client.status_type === "debtor" ? "#F59E0B" : "#EF4444",
                                  opacity: pressed ? 0.94 : 1,
                                  ...shadowLight,
                                },
                              ]}
                            >
                              <View style={styles.csHeaderRow}>
                                <View style={[styles.csAvatar, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(59,130,246,0.10)" }]}>
                                  <Text style={styles.csAvatarText}>{initials}</Text>
                                </View>
                                <View style={{ flex: 1, marginRight: 6 }}>
                                  <Text style={[styles.csClientName, { color: colors.text }]} numberOfLines={1}>{client.name}</Text>
                                  <Text style={[styles.csClientId, { color: colors.textMuted }]}>ID: #{client.id} • {client.phone || "No Phone"}</Text>
                                </View>
                                <View style={[styles.netPositionPill, { backgroundColor: isClientNetPos ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }]}>
                                  <Text style={[styles.netPositionText, { color: isClientNetPos ? "#10B981" : "#EF4444" }]}>{isClientNetPos ? "+" : ""}{formatNaira(client.net_position)}</Text>
                                </View>
                              </View>

                              <View style={[styles.csBalanceStrip, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,245,249,0.60)", borderColor: glassBorder }]}>
                                <View style={styles.csBalCol}><Text style={styles.csBalLabel}>SAVED</Text><Text style={[styles.csBalVal, { color: "#10B981" }]}>{formatNaira(client.savings)}</Text></View>
                                <View style={[styles.csBalDivider, { backgroundColor: glassBorder }]} />
                                <View style={styles.csBalCol}><Text style={styles.csBalLabel}>LOAN</Text><Text style={[styles.csBalVal, { color: client.loan_balance > 0 ? "#EF4444" : colors.textMuted }]}>{formatNaira(client.loan_balance)}</Text></View>
                              </View>

                              {client.has_loan ? (
                                <View style={styles.progressSection}>
                                  <View style={styles.progressLabelRow}><Text style={[styles.progressLabel, { color: colors.textMuted }]}>Repayment Progress</Text><Text style={styles.progressPercent}>{client.loan_progress}%</Text></View>
                                  <View style={[styles.progressBarBg, { backgroundColor: isDark ? "#334155" : "#E2E8F0" }]}><View style={[styles.progressBarFill, { width: `${client.loan_progress}%`, backgroundColor: client.loan_progress > 60 ? "#10B981" : "#F59E0B" }]} /></View>
                                </View>
                              ) : (
                                <View style={styles.goodStandingBadge}><Ionicons name="checkmark-circle" size={13} color="#10B981" /><Text style={styles.goodStandingText}>In Good Standing • Debt Free</Text></View>
                              )}

                              {/* Action Row with Direct History Button */}
                              <View style={styles.csActionRow}>
                                <Pressable
                                  onPress={(e) => { e.stopPropagation?.(); makeCall(client.phone); }}
                                  disabled={!client.phone}
                                  style={[styles.csSmallBtn, { borderColor: glassBorder, backgroundColor: cardSurfaceBg, opacity: client.phone ? 1 : 0.4 }]}
                                >
                                  <Ionicons name="call-outline" size={13} color="#3B82F6" />
                                  <Text style={[styles.csSmallBtnText, { color: "#3B82F6" }]}>Call</Text>
                                </Pressable>

                                <Pressable
                                  onPress={(e) => { e.stopPropagation?.(); openWhatsApp(client.phone); }}
                                  disabled={!client.phone}
                                  style={[styles.csSmallBtn, { borderColor: glassBorder, backgroundColor: cardSurfaceBg, opacity: client.phone ? 1 : 0.4 }]}
                                >
                                  <Ionicons name="logo-whatsapp" size={13} color="#10B981" />
                                  <Text style={[styles.csSmallBtnText, { color: "#10B981" }]}>WhatsApp</Text>
                                </Pressable>

                                <Pressable
                                  onPress={(e) => { e.stopPropagation?.(); openHistoryLedger(client); }}
                                  style={[
                                    styles.csSmallBtn,
                                    {
                                      borderColor: isDark ? "rgba(139,92,246,0.3)" : "rgba(139,92,246,0.25)",
                                      backgroundColor: isDark ? "rgba(139,92,246,0.12)" : "rgba(139,92,246,0.08)",
                                    },
                                  ]}
                                >
                                  <Ionicons name="time-outline" size={14} color="#8B5CF6" />
                                  <Text style={[styles.csSmallBtnText, { color: "#8B5CF6" }]}>History</Text>
                                </Pressable>
                              </View>
                            </Pressable>
                          );
                        })}
                      </View>
                    ) : (
                      <View style={[styles.compactListWrap, { borderColor: glassBorder, backgroundColor: cardSurfaceBg }]}>
                        {union.clients.map((client, idx) => {
                          const isLast = idx === union.clients.length - 1;
                          return (
                            <Pressable
                              key={client.id}
                              onPress={() => openHistoryLedger(client)}
                              style={({ pressed }) => [
                                styles.compactListRow,
                                {
                                  backgroundColor: pressed ? (isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)") : "transparent",
                                  borderBottomWidth: isLast ? 0 : 1,
                                  borderBottomColor: glassBorder,
                                },
                              ]}
                            >
                              <View style={[styles.statusDot, { backgroundColor: client.status_type === "saver" ? "#10B981" : client.status_type === "debtor" ? "#F59E0B" : "#EF4444" }]} />
                              <View style={{ flex: 1.8, marginLeft: 8 }}>
                                <Text style={[styles.trName, { color: colors.text }]} numberOfLines={1}>{client.name}</Text>
                                <Text style={[styles.trPhone, { color: colors.textMuted }]}>{client.phone || "No Phone"}</Text>
                              </View>
                              <View style={styles.compactFinCol}>
                                <Text style={styles.compactSavedVal}>{formatNaira(client.savings)}</Text>
                                <Text style={[styles.compactLoanVal, { color: client.loan_balance > 0 ? "#EF4444" : colors.textMuted }]}>{formatNaira(client.loan_balance)}</Text>
                              </View>
                              <View style={[styles.compactNetPill, { backgroundColor: client.net_position >=0 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" }]}>
                                <Text style={[styles.compactNetText, { color: client.net_position >=0 ? "#10B981" : "#EF4444" }]}>{client.net_position >=0 ? "+" : ""}{formatNaira(client.net_position)}</Text>
                              </View>
                              <Pressable
                                onPress={(e) => { e.stopPropagation?.(); openHistoryLedger(client); }}
                                hitSlop={8}
                                style={[styles.compactHistoryBtn, { borderColor: isDark ? "rgba(139,92,246,0.3)" : "rgba(139,92,246,0.2)", backgroundColor: isDark ? "rgba(139,92,246,0.12)" : "rgba(139,92,246,0.08)" }]}
                              >
                                <Ionicons name="time-outline" size={14} color="#8B5CF6" />
                              </Pressable>
                            </Pressable>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </Animated.ScrollView>

      {/* ENHANCED CLIENT HISTORY AUDIT MODAL */}
      <Modal visible={historyModalVisible} transparent animationType="slide" onRequestClose={() => setHistoryModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setHistoryModalVisible(false)} />
          <LinearGradient
            colors={isDark ? ["rgba(30, 41, 59, 0.98)", "rgba(15, 23, 42, 0.99)"] : ["#FFFFFF", "rgba(248,250,252,0.99)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={[styles.modalSheet, { borderColor: glassBorder, ...shadowDark }]}
          >
            {/* Sheet Handle */}
            <View style={styles.sheetHandle} />

            {/* Modal Head & Profile Info */}
            <View style={styles.modalHead}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flex: 1 }}>
                <View style={[styles.modalAvatar, { backgroundColor: isDark ? "rgba(139,92,246,0.22)" : "rgba(139,92,246,0.12)" }]}>
                  <Text style={styles.modalAvatarText}>
                    {selectedHistoryClient?.name?.split(" ").map((n) => n[0]).join("").substring(0, 2).toUpperCase() || "C"}
                  </Text>
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>{selectedHistoryClient?.name}</Text>
                    <View style={[styles.idBadge, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                      <Text style={[styles.idBadgeText, { color: colors.textMuted }]}>#{selectedHistoryClient?.id}</Text>
                    </View>
                  </View>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 }}>
                    <Ionicons name="business-outline" size={11} color={colors.textMuted} />
                    <Text style={[styles.modalSub, { color: colors.textMuted }]} numberOfLines={1}>{selectedHistoryClient?.union || "General"} • {selectedHistoryClient?.phone || "No Phone"}</Text>
                  </View>
                </View>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                {selectedHistoryClient?.phone ? (
                  <>
                    <Pressable onPress={() => makeCall(selectedHistoryClient.phone)} style={[styles.modalContactBtn, { backgroundColor: "rgba(59,130,246,0.12)" }]}>
                      <Ionicons name="call" size={13} color="#3B82F6" />
                    </Pressable>
                    <Pressable onPress={() => openWhatsApp(selectedHistoryClient.phone)} style={[styles.modalContactBtn, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
                      <Ionicons name="logo-whatsapp" size={13} color="#10B981" />
                    </Pressable>
                  </>
                ) : null}
                <Pressable onPress={() => setHistoryModalVisible(false)} hitSlop={10} style={styles.closeBtn}>
                  <Ionicons name="close-circle" size={24} color={colors.textMuted} />
                </Pressable>
              </View>
            </View>

            {/* Financial Overview Snapshot */}
            <View style={styles.modalStatsCardsRow}>
              <View style={[styles.modalBalanceBox, { backgroundColor: isDark ? "rgba(16,185,129,0.10)" : "rgba(16,185,129,0.08)", borderColor: "rgba(16,185,129,0.2)" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Ionicons name="wallet-outline" size={12} color="#10B981" />
                  <Text style={styles.modalBalanceLabel}>SAVINGS</Text>
                </View>
                <Text style={[styles.modalBalanceValue, { color: "#10B981" }]} numberOfLines={1}>{formatNaira(historySummary.savings)}</Text>
              </View>

              <View style={[styles.modalBalanceBox, { backgroundColor: isDark ? "rgba(239,68,68,0.10)" : "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.2)" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Ionicons name="hand-left-outline" size={12} color="#EF4444" />
                  <Text style={styles.modalBalanceLabel}>OUTSTANDING LOAN</Text>
                </View>
                <Text style={[styles.modalBalanceValue, { color: historySummary.loan > 0 ? "#EF4444" : colors.textMuted }]} numberOfLines={1}>{formatNaira(historySummary.loan)}</Text>
              </View>

              <View style={[styles.modalBalanceBox, { backgroundColor: (historySummary.savings - historySummary.loan) >= 0 ? (isDark ? "rgba(59,130,246,0.1)" : "rgba(59,130,246,0.08)") : (isDark ? "rgba(245,158,11,0.1)" : "rgba(245,158,11,0.08)"), borderColor: (historySummary.savings - historySummary.loan) >= 0 ? "rgba(59,130,246,0.2)" : "rgba(245,158,11,0.2)" }]}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Ionicons name="trending-up-outline" size={12} color={(historySummary.savings - historySummary.loan) >= 0 ? "#3B82F6" : "#F59E0B"} />
                  <Text style={styles.modalBalanceLabel}>NET POSITION</Text>
                </View>
                <Text style={[styles.modalBalanceValue, { color: (historySummary.savings - historySummary.loan) >= 0 ? "#3B82F6" : "#F59E0B" }]} numberOfLines={1}>
                  {(historySummary.savings - historySummary.loan) >= 0 ? "+" : ""}{formatNaira(historySummary.savings - historySummary.loan)}
                </Text>
              </View>
            </View>

            {/* Filter Tabs with Dynamic Counters */}
            <View style={styles.historyTabsContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                {[
                  { key: "all", label: "All Activity", count: historyCounts.all },
                  { key: "savings", label: "Savings", count: historyCounts.savings },
                  { key: "loan", label: "Disbursed", count: historyCounts.loan },
                  { key: "repayment", label: "Repaid", count: historyCounts.repayment },
                ].map((tab) => {
                  const isActive = historyFilter === tab.key;
                  return (
                    <Pressable
                      key={tab.key}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setHistoryFilter(tab.key as any);
                      }}
                      style={[
                        styles.historyPillTab,
                        {
                          backgroundColor: isActive ? colors.primary : (isDark ? "rgba(255,255,255,0.05)" : "#F1F5F9"),
                          borderColor: isActive ? colors.primary : glassBorder,
                        },
                      ]}
                    >
                      <Text style={[styles.historyPillText, { color: isActive ? "#FFF" : colors.textMuted }]}>{tab.label}</Text>
                      <View style={[styles.historyCountPill, { backgroundColor: isActive ? "rgba(255,255,255,0.25)" : (isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0") }]}>
                        <Text style={[styles.historyCountText, { color: isActive ? "#FFF" : colors.text }]}>{tab.count}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            {/* Optional Search inside Ledger */}
            {historyRecords.length > 3 && (
              <View style={[styles.modalSearchBox, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                <Ionicons name="search" size={14} color={colors.textMuted} />
                <TextInput
                  value={historySearchQuery}
                  onChangeText={setHistorySearchQuery}
                  placeholder="Filter by ref code, description or amount..."
                  placeholderTextColor={colors.textMuted}
                  style={[styles.modalSearchInput, { color: colors.text }]}
                />
                {historySearchQuery.length > 0 && (
                  <Pressable onPress={() => setHistorySearchQuery("")} hitSlop={6}>
                    <Ionicons name="close-circle" size={15} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
            )}

            {/* List / Loading / Empty states */}
            {historyLoading ? (
              <View style={styles.historyLoadingWrap}>
                <Skeleton style={{ height: 60, borderRadius: 14 }} />
                <Skeleton style={{ height: 60, borderRadius: 14 }} />
                <Skeleton style={{ height: 60, borderRadius: 14 }} />
              </View>
            ) : filteredHistory.length === 0 ? (
              <View style={styles.historyEmptyWrap}>
                <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                  <Ionicons name="receipt-outline" size={28} color={colors.textMuted} />
                </View>
                <Text style={{ fontSize: 14, fontWeight: "800", color: colors.text }}>No Activity Recorded</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>
                  {historySearchQuery ? "No entries match your search query." : "Transactions will appear here once saved or booked."}
                </Text>
                {historySearchQuery.length > 0 && (
                  <Pressable onPress={() => setHistorySearchQuery("")} style={styles.resetFilterBtn}>
                    <Text style={styles.resetFilterText}>Clear search</Text>
                  </Pressable>
                )}
              </View>
            ) : (
              <FlatList
                data={filteredHistory}
                keyExtractor={(item, idx) => `${item.transaction_id}-${idx}`}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingVertical: 10, gap: 8 }}
                renderItem={({ item }) => {
                  const isSavings = item.type === "savings";
                  const isDisbursement = item.type === "loan";
                  const isRepayment = item.type === "repayment";

                  let iconName: any = "wallet-outline";
                  let iconBg = "rgba(16,185,129,0.12)";
                  let iconColor = "#10B981";
                  let amountColor = "#10B981";
                  let prefix = "+";

                  if (isSavings) {
                    if (item.is_withdrawal) {
                      iconName = "arrow-down-circle-outline";
                      iconBg = "rgba(239,68,68,0.12)";
                      iconColor = "#EF4444";
                      amountColor = "#EF4444";
                      prefix = "-";
                    }
                  } else if (isDisbursement) {
                    iconName = "arrow-up-circle-outline";
                    iconBg = "rgba(245,158,11,0.12)";
                    iconColor = "#F59E0B";
                    amountColor = "#F59E0B";
                    prefix = "";
                  } else if (isRepayment) {
                    iconName = "checkmark-done-circle-outline";
                    iconBg = "rgba(59,130,246,0.12)";
                    iconColor = "#3B82F6";
                    amountColor = "#3B82F6";
                    prefix = "";
                  }

                  return (
                    <View style={[styles.timelineCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, ...shadowLight }]}>
                      <View style={[styles.timelineIconBox, { backgroundColor: iconBg }]}>
                        <Ionicons name={iconName} size={18} color={iconColor} />
                      </View>
                      <View style={{ flex: 1, marginHorizontal: 10 }}>
                        <Text style={[styles.txTitle, { color: colors.text }]} numberOfLines={1}>{item.title}</Text>
                        <Text style={[styles.txDate, { color: colors.textMuted }]}>{item.date_formatted}</Text>
                        <View style={styles.badgeWrap}>
                          <Text style={[styles.descBadge, { color: iconColor }]} numberOfLines={1}>{item.description}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.txAmount, { color: amountColor }]}>{prefix}{item.amount}</Text>
                        {item.transaction_id ? (
                          <Pressable
                            onPress={() => copyTxCode(item.transaction_id)}
                            hitSlop={6}
                            style={[styles.refCodeBadge, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" }]}
                          >
                            <Ionicons name="copy-outline" size={10} color={colors.textMuted} />
                            <Text style={[styles.refCodeText, { color: colors.textMuted }]}>
                              {item.transaction_id}
                            </Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  );
                }}
              />
            )}
          </LinearGradient>
        </View>
      </Modal>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 60, paddingTop: 6 },

  // Toast
  toastBox: {
    position: "absolute", top: Platform.OS === "ios" ? 54 : 36, alignSelf: "center",
    borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24,
    flexDirection: "row", alignItems: "center", gap: 8, zIndex: 9999, maxWidth: "88%",
    shadowColor: "#000", shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.15, shadowRadius: 6, elevation: 5,
  },
  toastText: { fontSize: 12.5, fontWeight: "700" },

  // Territory
  territoryRow: { paddingHorizontal: 16, gap: 8, marginBottom: 14 },
  territoryPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  territoryText: { fontSize: 11, fontWeight: "600" },

  // Hero
  heroCard: { marginHorizontal: 16, borderRadius: 24, padding: 18, borderWidth: 1 },
  heroHeaderBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroTagPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 20, gap: 5 },
  statusPulseDot: { width: 6, height: 6, borderRadius: 3 },
  heroTagText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  syncTimePill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12 },
  syncTimeText: { fontSize: 10, fontWeight: "600" },

  avatarHeroRow: { flexDirection: "row", alignItems: "center", marginTop: 14, gap: 12 },
  avatarStack: { position: "relative" },
  heroAvatarGradient: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  heroAvatarText: { color: "#FFF", fontSize: 16, fontWeight: "900" },
  heroAvatarRibbon: { position: "absolute", bottom: -4, right: -4, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFF" },
  heroBalanceLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  heroMetricsCount: { fontSize: 12, fontWeight: "700", marginTop: 2 },

  netPillHero: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 },
  netPillHeroText: { fontSize: 11.5, fontWeight: "800" },

  dualBalanceRow: { flexDirection: "row", alignItems: "center", marginTop: 16, gap: 12 },
  dualCol: { flex: 1 },
  dualLabel: { fontSize: 9.5, fontWeight: "700", letterSpacing: 0.6 },
  dualAmount: { fontSize: 20, fontWeight: "900", marginTop: 3, letterSpacing: -0.4 },
  verticalDividerLight: { width: 1, height: 32 },

  portfolioRatioContainer: { marginTop: 14, marginBottom: 12 },
  ratioHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  ratioLabel: { fontSize: 9.5, fontWeight: "600" },
  ratioTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(148, 163, 184, 0.2)", flexDirection: "row", overflow: "hidden" },
  ratioSavingsBar: { backgroundColor: "#10B981", height: "100%" },

  heroMetricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  metricGridItem: { width: "48.5%", borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  metricItemHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  metricItemLabel: { fontSize: 9.5, fontWeight: "600" },
  metricItemValue: { fontSize: 13.5, fontWeight: "800", marginTop: 3 },

  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  badgeCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeCountText: { fontSize: 11, fontWeight: "700" },

  // Union Card
  unionCard: { width: 220, borderRadius: 16, borderWidth: 1, padding: 14 },
  unionCardTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  unionCardName: { fontSize: 13, fontWeight: "800", flex: 1, marginRight: 6 },
  unionClientBadgePill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  unionClientBadge: { fontSize: 9.5, fontWeight: "700" },
  unionAmountRow: { flexDirection: "row", justifyContent: "space-between" },
  unionLabel: { fontSize: 9, fontWeight: "600" },
  unionValue: { fontSize: 12, fontWeight: "800", marginTop: 2 },
  unionMicroBar: { height: 3, backgroundColor: "rgba(239, 68, 68, 0.4)", borderRadius: 2, marginTop: 8, overflow: "hidden" },
  unionMicroSavings: { height: "100%", backgroundColor: "#10B981" },

  searchContainer: { flexDirection: "row", alignItems: "center", marginHorizontal: 16, paddingHorizontal: 12, height: 44, borderRadius: 14, borderWidth: 1, gap: 8 },
  searchInput: { flex: 1, fontSize: 13, height: "100%" },
  filterBarContainer: { paddingHorizontal: 16, gap: 8, marginTop: 10, marginBottom: 12 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, flexDirection: "row", alignItems: "center" },
  filterChipText: { fontSize: 11, fontWeight: "700" },

  // Union section card
  unionSectionCard: { marginHorizontal: 16, marginBottom: 14, borderWidth: 1, borderRadius: 18, overflow: "hidden" },
  unionHeaderPressable: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 14 },
  unionLetterBadge: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  unionLetterText: { fontSize: 15, fontWeight: "900", color: "#3B82F6" },
  unionTitle: { fontSize: 13.5, fontWeight: "800" },
  unionSubCount: { fontSize: 11, fontWeight: "600" },
  unionRiskBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "rgba(239,68,68,0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  unionRiskText: { fontSize: 9, fontWeight: "700", color: "#EF4444" },
  headerNetBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  headerNetText: { fontSize: 11, fontWeight: "800" },
  unionContentBody: { padding: 12, paddingTop: 0, gap: 10 },
  unionStatRow: { flexDirection: "row", gap: 8 },
  unionStatCard: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, padding: 10, borderRadius: 12, borderWidth: 1 },
  unionStatLabel: { fontSize: 8, fontWeight: "800", color: "#64748B", letterSpacing: 0.3 },
  unionStatVal: { fontSize: 11.5, fontWeight: "900", marginTop: 1 },

  gridContainer: { gap: 10 },
  clientSummaryCard: { borderRadius: 14, borderWidth: 1, borderLeftWidth: 4, padding: 12, gap: 10 },
  csHeaderRow: { flexDirection: "row", alignItems: "center" },
  csAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", marginRight: 10 },
  csAvatarText: { fontSize: 13, fontWeight: "800", color: "#3B82F6" },
  csClientName: { fontSize: 13.5, fontWeight: "800" },
  csClientId: { fontSize: 10.5, fontWeight: "600", marginTop: 1 },
  netPositionPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  netPositionText: { fontSize: 11, fontWeight: "800" },
  csBalanceStrip: { flexDirection: "row", alignItems: "center", paddingVertical: 8, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1 },
  csBalCol: { flex: 1, alignItems: "center" },
  csBalLabel: { fontSize: 8, fontWeight: "800", color: "#64748B", letterSpacing: 0.3 },
  csBalVal: { fontSize: 13, fontWeight: "900", marginTop: 1 },
  csBalDivider: { width: 1, height: 20 },
  progressSection: { gap: 4 },
  progressLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  progressLabel: { fontSize: 9.5, fontWeight: "700" },
  progressPercent: { fontSize: 9.5, fontWeight: "800", color: "#F59E0B" },
  progressBarBg: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressBarFill: { height: 6, borderRadius: 3 },
  goodStandingBadge: { flexDirection: "row", alignItems: "center", gap: 5, justifyContent: "center", paddingVertical: 2 },
  goodStandingText: { fontSize: 10.5, fontWeight: "700", color: "#10B981" },

  // Client Action Row
  csActionRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  csSmallBtn: { flex: 1, height: 34, borderRadius: 8, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  csSmallBtnText: { fontSize: 11, fontWeight: "700" },

  // Compact table
  compactListWrap: { borderRadius: 12, borderWidth: 1, overflow: "hidden" },
  compactListRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  trName: { fontSize: 12.5, fontWeight: "800" },
  trPhone: { fontSize: 10, fontWeight: "500", marginTop: 1 },
  compactFinCol: { alignItems: "flex-end", flex: 1.2, marginRight: 8 },
  compactSavedVal: { fontSize: 11.5, fontWeight: "800", color: "#10B981" },
  compactLoanVal: { fontSize: 10, fontWeight: "700", marginTop: 1 },
  compactNetPill: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, marginRight: 6 },
  compactNetText: { fontSize: 10.5, fontWeight: "800" },
  compactHistoryBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  emptyCard: { padding: 32, borderRadius: 18, borderWidth: 1, alignItems: "center", gap: 6, marginTop: 10, marginHorizontal: 16 },
  emptyIconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  emptyTitle: { fontSize: 15, fontWeight: "800" },
  emptySub: { fontSize: 12, textAlign: "center", lineHeight: 17 },
  resetFilterBtn: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(59,130,246,0.12)" },
  resetFilterText: { fontSize: 12, fontWeight: "700", color: "#3B82F6" },

  // History Modal Styling
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, padding: 18, paddingBottom: Platform.OS === "ios" ? 34 : 20, maxHeight: "90%" },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: "rgba(150,150,150,0.3)", alignSelf: "center", marginBottom: 12 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  modalAvatar: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalAvatarText: { fontSize: 15, fontWeight: "900", color: "#8B5CF6" },
  modalTitle: { fontSize: 15.5, fontWeight: "900" },
  modalSub: { fontSize: 11, marginTop: 1 },
  modalContactBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  closeBtn: { padding: 2 },
  idBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  idBadgeText: { fontSize: 9.5, fontWeight: "800", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },

  // Snapshot Cards Row
  modalStatsCardsRow: { flexDirection: "row", gap: 8, marginBottom: 12 },
  modalBalanceBox: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 9, gap: 4 },
  modalBalanceLabel: { fontSize: 8.5, fontWeight: "800", color: "#64748B", letterSpacing: 0.3 },
  modalBalanceValue: { fontSize: 12, fontWeight: "900" },

  // History Tabs
  historyTabsContainer: { marginBottom: 10 },
  historyPillTab: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  historyPillText: { fontSize: 11, fontWeight: "700" },
  historyCountPill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 10 },
  historyCountText: { fontSize: 9.5, fontWeight: "800" },

  // Modal Search
  modalSearchBox: { flexDirection: "row", alignItems: "center", height: 38, borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, gap: 6, marginBottom: 10 },
  modalSearchInput: { flex: 1, fontSize: 12, height: "100%" },

  // Timeline List
  historyLoadingWrap: { padding: 20, gap: 10 },
  historyEmptyWrap: { padding: 36, alignItems: "center", justifyContent: "center", gap: 8 },
  timelineCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1 },
  timelineIconBox: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  txTitle: { fontSize: 13, fontWeight: "800" },
  txDate: { fontSize: 10.5, marginTop: 1 },
  badgeWrap: { marginTop: 4 },
  descBadge: { fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  txAmount: { fontSize: 13.5, fontWeight: "900" },
  refCodeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, marginTop: 4 },
  refCodeText: { fontSize: 10, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontWeight: "700" },
});