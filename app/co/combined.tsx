// app/co/combined.tsx - Premium Final with Default Withdrawal Lockdown & Server Verification
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
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loadOfflineWorkspace,
  loadCachedRepayments,
  isOnline,
  saveRepaymentOffline,
  saveSavingsOffline,
  saveWithdrawalOffline,
  cancelPendingOfflineTransaction,
  cacheRepaymentDataLocally,
  cacheClients,
  getAllPendingCounts,
} from "../../src/db/database";
import { fetchUnionsForOfficer, mergeUnionNames, bootstrapCoScreenData } from "../../src/db/offlineHelpers";
import { hydrateOfflineCache } from "../../src/db/sync";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_COMBINED = `${API_BASE}/api/combined_collection_api.php`;
const STORAGE_VIEW_KEY = "@cupad_combined_view_mode";
const STORAGE_SETTINGS_KEY = "cupad_cache_combined_settings";

type WithdrawalType = "" | "cash" | "withdrawal" | "return";

type LoanRecord = {
  id: string | number;
  client_id: string | number;
  principal?: number;
  total_payable: number;
  remaining_balance: number;
  num_installments: number;
  status: string;
  inst_amt?: number;
  date?: string;
};

type ClientRecord = {
  id: string | number;
  name: string;
  union?: string;
  phone?: string;
  savings_balance?: number;
  loan?: LoanRecord | null;
  existing?: {
    loan_amt: number;
    sav_amt: number;
    wth_type: WithdrawalType;
    wth_amt: number;
  };
};

type ClientRowState = {
  loanInstallments: string;
  loanAmount: number;
  savingsAmount: string;
  withdrawalType: WithdrawalType;
  withdrawalAmount: string;
  proofImageUri: string | null;
  proofBase64: string | null;
  status: "idle" | "pending" | "waiting_image" | "saving" | "saved" | "error";
  errorMsg?: string;
};

const createClientRowState = (): ClientRowState => ({
  loanInstallments: "",
  loanAmount: 0,
  savingsAmount: "",
  withdrawalType: "",
  withdrawalAmount: "",
  proofImageUri: null,
  proofBase64: null,
  status: "idle",
});

const updateRowState = (
  clientId: string | number,
  updater: (current: ClientRowState) => ClientRowState
) => (prev: Record<string | number, ClientRowState>) => {
  const current = prev[clientId] ?? createClientRowState();
  const next = { ...prev } as Record<string | number, ClientRowState>;
  next[clientId] = updater(current);
  return next;
};

type DailyTransactionEntry = {
  client_id: string | number;
  client_name: string;
  union: string;
  loan_amount: number;
  savings_amount: number;
  withdrawal_amount: number;
  withdrawal_type: WithdrawalType;
  time: string;
};

const SAVINGS_PRESETS = [200, 500, 1000, 2000];
const CASH_QUICK_PRESETS = [2000, 5000, 10000, 20000];

function settingEnabled(value: unknown, fallback = false): boolean {
  if (value == null) return fallback;
  return value === true || value === 1 || value === "1" || value === "true";
}

function formatNaira(amount: number | string): string {
  const num = Number(amount) || 0;
  return `\u20A6${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatDateDisplay(d: Date): string {
  return d.toLocaleDateString("en-NG", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
}

function dateToYmd(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
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
function ClientCardSkeleton({
  cardSurfaceBg,
  glassBorder,
  isDark,
}: {
  cardSurfaceBg: string;
  glassBorder: string;
  isDark: boolean;
}) {
  const pulseAnim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.85, duration: 750, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 0.35, duration: 750, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  const skeletonColor = isDark ? "#334155" : "#E2E8F0";

  return (
    <Animated.View
      style={[
        styles.clientCard,
        {
          backgroundColor: cardSurfaceBg,
          borderColor: glassBorder,
          opacity: pulseAnim,
        },
      ]}
    >
      <View style={styles.cardHeaderRow}>
        <View style={[styles.avatarBox, { backgroundColor: skeletonColor }]} />
        <View style={{ flex: 1, marginHorizontal: 12, gap: 6 }}>
          <View style={[styles.skeletonLine, { width: "60%", height: 14, backgroundColor: skeletonColor }]} />
          <View style={[styles.skeletonLine, { width: "35%", height: 10, backgroundColor: skeletonColor }]} />
        </View>
        <View style={[styles.skeletonLine, { width: 50, height: 24, borderRadius: 12, backgroundColor: skeletonColor }]} />
      </View>

      <View style={styles.balancesContainer}>
        <View style={[styles.balanceBadge, { backgroundColor: skeletonColor, height: 42, borderWidth: 0 }]} />
        <View style={[styles.balanceBadge, { backgroundColor: skeletonColor, height: 42, borderWidth: 0 }]} />
      </View>

      <View style={{ gap: 8, marginTop: 4 }}>
        <View style={[styles.skeletonLine, { width: 90, height: 10, backgroundColor: skeletonColor }]} />
        <View style={{ flexDirection: "row", gap: 8 }}>
          {[1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.skeletonLine, { flex: 1, height: 44, borderRadius: 12, backgroundColor: skeletonColor }]} />
          ))}
        </View>
      </View>

      <View style={{ gap: 8, marginTop: 4 }}>
        <View style={[styles.skeletonLine, { width: 80, height: 10, backgroundColor: skeletonColor }]} />
        <View style={[styles.skeletonLine, { width: "100%", height: 46, borderRadius: 12, backgroundColor: skeletonColor }]} />
      </View>
    </Animated.View>
  );
}

export default function CombinedCollectionScreen() {
  const { colors, isDark } = useTheme();

  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37,99,235,0.18)" : "rgba(37,99,235,0.10)";
  const orbColor2 = isDark ? "rgba(14,165,233,0.14)" : "rgba(14,165,233,0.08)";
  const shadowDark = isDark ? "rgba(0,0,0,0.35)" : "rgba(15,23,42,0.06)";

  // View Mode: 'card' | 'table'
  const [viewMode, setViewMode] = useState<"card" | "table">("card");

  // Table View Modal Drawer
  const [tableWithdrawalClientId, setTableWithdrawalClientId] = useState<string | number | null>(null);

  // Officer Session
  const [officerUsername, setOfficerUsername] = useState("");
  const [branchName, setBranchName] = useState("");
  const [isWeekly, setIsWeekly] = useState(false);
  const [, setPendingCounts] = useState({
    repayments: 0,
    savings: 0,
    registrations: 0,
    withdrawals: 0,
    disbursements: 0,
    total: 0,
  });
  const [deviceOffline, setDeviceOffline] = useState(false);

  // WITHDRAWALS DEFAULT TO STRICTLY BLOCKED UNTIL CONFIRMED BY API RESPONSE
  const [apiWithdrawalsAuthorized, setApiWithdrawalsAuthorized] = useState(false);
  const [offlineWithdrawalSettingsReady, setOfflineWithdrawalSettingsReady] = useState(false);
  const [offlineSavingsSettingsReady, setOfflineSavingsSettingsReady] = useState(false);

  // Cached disbursements from Repayment Module
  const [cachedDisbursements, setCachedDisbursements] = useState<any[]>([]);

  // Business Rules
  const [colSettings, setColSettings] = useState({
    max_installments_per_payment: 2,
    min_installments_per_payment: 1,
    grace_period_days: 2,
    allow_partial_payments: 0,
    allow_overpayment: 0,
  });
  const [colSettingsReady, setColSettingsReady] = useState(false);
  const [savSettings, setSavSettings] = useState({
    min_savings_amount: 100,
    max_savings_amount: 1000000,
    allow_weekend_collection: 0,
  });
  const [wSettings, setWSettings] = useState({
    max_cash_withdrawal: 50000,
    require_image_for_cash: 1,
    allow_weekend_withdrawals: 0,
    max_withdrawals_per_day: 1,
    blocked_withdrawal_types: "[]",
    buffer_cash: 10,
    buffer_withdrawal: 10,
    buffer_return: 10,
    withdrawals_enabled: true as boolean | number | string,
    status: "",
  });

  // Date Control
  const [dateReadonly, setDateReadonly] = useState(false);
  const [activeDate, setActiveDate] = useState<Date>(new Date());

  // Unions & Clients
  const [unionsList, setUnionsList] = useState<string[]>([]);
  const [selectedUnion, setSelectedUnion] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "collected">("all");

  // Accordion drawer state for card view
  const [expandedWithdrawalClientId, setExpandedWithdrawalClientId] = useState<string | number | null>(null);

  // States
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [rowStates, setRowStates] = useState<Record<string | number, ClientRowState>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modals
  const [showSummarySheet, setShowSummarySheet] = useState(false);
  const [selectedReceipt, setSelectedReceipt] = useState<DailyTransactionEntry | null>(null);
  const [activePhotoClientId, setActivePhotoClientId] = useState<string | number | null>(null);
  const [photoPickerVisible, setPhotoPickerVisible] = useState(false);
  const [blockedWarning, setBlockedWarning] = useState<{ title: string; message: string } | null>(null);

  // Mutex & Timers
  const saveTimersRef = useRef<Record<string | number, ReturnType<typeof setTimeout>>>({});
  const isSavingRef = useRef<Record<string | number, boolean>>({});
  const offlineTransactionIdsRef = useRef(new Map<string, string>());

  // Floating Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastY = useRef(new Animated.Value(-60)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [fadeAnim]);

  // Load persisted view mode on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_VIEW_KEY)
      .then((val) => {
        if (val === "table" || val === "card") {
          setViewMode(val);
        }
      })
      .catch(() => {});
  }, []);

  const handleToggleViewMode = async (mode: "card" | "table") => {
    if (viewMode === mode) return;
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setViewMode(mode);
    try {
      await AsyncStorage.setItem(STORAGE_VIEW_KEY, mode);
    } catch {}
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    Animated.parallel([
      Animated.spring(toastY, { toValue: 0, tension: 90, friction: 10, useNativeDriver: true }),
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    setTimeout(() => {
      Animated.parallel([
        Animated.timing(toastY, { toValue: -40, duration: 220, useNativeDriver: true }),
        Animated.timing(toastOpacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(() => setToastMessage(null));
    }, 2400);
  };

  const showBlockedWarning = (title: string, message: string) => {
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    setBlockedWarning({ title, message });
  };

  const checkPendingQueues = useCallback(async () => {
    try {
      const counts = await getAllPendingCounts();
      setPendingCounts(counts);
    } catch {}
  }, []);

  const isWeekendSelected = useMemo(() => {
    const day = activeDate.getDay();
    return day === 0 || day === 6;
  }, [activeDate]);

  const isColBlocked =
    isWeekendSelected && !settingEnabled(savSettings.allow_weekend_collection);
  const isWthBlocked =
    isWeekendSelected && !settingEnabled(wSettings.allow_weekend_withdrawals);

  const blockedWithdrawalTypes: string[] = useMemo(() => {
    try {
      return JSON.parse(wSettings.blocked_withdrawal_types || "[]");
    } catch {
      return [];
    }
  }, [wSettings.blocked_withdrawal_types]);

  const withdrawalsEnabledBySettings =
    settingEnabled(wSettings.withdrawals_enabled, true) &&
    String(wSettings.status || "").toLowerCase() !== "disabled";
  const canOpenWithdrawalOptions =
    (apiWithdrawalsAuthorized && !deviceOffline) ||
    (deviceOffline && offlineWithdrawalSettingsReady && withdrawalsEnabledBySettings);

  const canUseWithdrawalType = (type: WithdrawalType) => {
    if (!type) return true;
    if (type === "cash") return apiWithdrawalsAuthorized && !deviceOffline;
    if (apiWithdrawalsAuthorized && !deviceOffline) return true;
    return deviceOffline && offlineWithdrawalSettingsReady && withdrawalsEnabledBySettings;
  };

  /* ================= ACTIVE LOANS MAP ================= */
  const activeLoansMap = useMemo(() => {
    const map = new Map<string | number, LoanRecord>();
    const disbByClient = new Map<string | number, any>();
    if (Array.isArray(cachedDisbursements)) {
      for (const d of cachedDisbursements) {
        if (d && d.client_id != null) {
          disbByClient.set(d.client_id, d);
          disbByClient.set(String(d.client_id), d);
          if (typeof d.client_id === "string" && !isNaN(Number(d.client_id))) {
            disbByClient.set(Number(d.client_id), d);
          }
        }
      }
    }

    for (const c of clients) {
      const disb = disbByClient.get(c.id) || disbByClient.get(String(c.id));
      const rawLoan = c.loan || (c as any).disbursement || disb;

      const total = Number(
        rawLoan?.total_payable ??
          disb?.total_payable ??
          (c as any).total_payable ??
          (c as any).outstanding_loan ??
          (c as any).loan_balance ??
          0
      );
      const remaining = Number(
        rawLoan?.remaining_balance ??
          disb?.remaining_balance ??
          (c as any).remaining_balance ??
          (c as any).outstanding_loan ??
          (c as any).loan_balance ??
          total
      );
      const status = rawLoan?.status ?? disb?.status ?? (c as any).loan_status ?? "active";

      if (remaining > 0.01 && status !== "completed") {
        const numInst =
          Number(rawLoan?.num_installments ?? disb?.num_installments ?? (c as any).num_installments) ||
          (isWeekly ? 24 : 23);
        let instAmt = Number(rawLoan?.inst_amt ?? disb?.inst_amt ?? (c as any).inst_amt) || 0;
        if (!instAmt && total > 0 && numInst > 0) {
          instAmt = Math.round(total / numInst);
        }
        const record: LoanRecord = {
          id: rawLoan?.id || disb?.id || `loan_${c.id}`,
          client_id: c.id,
          principal: Number(rawLoan?.principal ?? disb?.principal ?? (c as any).principal ?? Math.round(total / 1.15)),
          total_payable: total,
          remaining_balance: remaining,
          num_installments: numInst,
          status,
          inst_amt: instAmt,
          date: rawLoan?.date || disb?.date || (c as any).loan_date,
        };

        map.set(c.id, record);
        map.set(String(c.id), record);
        if (typeof c.id === "string" && !isNaN(Number(c.id))) {
          map.set(Number(c.id), record);
        }
      }
    }
    return map;
  }, [clients, cachedDisbursements, isWeekly]);

  /* ================= LOAN METRICS ================= */
  const getLoanMetrics = useCallback(
    (loan: LoanRecord | undefined) => {
      if (!loan) return null;
      const total = Number(loan.total_payable) || 0;
      const remaining = Number(loan.remaining_balance ?? total) || 0;
      if (remaining <= 0.01) return null;

      const paid = Math.max(0, total - remaining);
      const numInst = Number(loan.num_installments) || (isWeekly ? 24 : 23);
      const instAmt =
        loan.inst_amt && Number(loan.inst_amt) > 0
          ? Number(loan.inst_amt)
          : total > 0 && numInst > 0
          ? Math.round(total / numInst)
          : 0;
      const instPaid = instAmt > 0 ? Math.min(numInst, Math.round(paid / instAmt)) : 0;
      let instRem = Math.max(0, numInst - instPaid);

      if (instAmt > 0 && remaining > 0) {
        const remByBal = Math.ceil(remaining / instAmt);
        if (remByBal < instRem) {
          instRem = remByBal;
        }
      }

      let maxAllowed = Number(colSettings.max_installments_per_payment) || 2;
      if (deviceOffline) {
        maxAllowed = Math.min(maxAllowed, 2);
      }
      if (instRem <= 3) {
        if (!deviceOffline) {
          maxAllowed = Math.max(maxAllowed, instRem);
        } else if (instRem <= 2) {
          maxAllowed = Math.max(maxAllowed, instRem);
        }
      }
      if (!deviceOffline && colSettingsReady && Number(colSettings.max_installments_per_payment) >= 3) {
        maxAllowed = Math.max(maxAllowed, Number(colSettings.max_installments_per_payment));
      }
      maxAllowed = Math.min(maxAllowed, Math.max(instRem, 1));

      return { total, remaining, paid, numInst, instAmt, instPaid, instRem, maxAllowed };
    },
    [colSettings.max_installments_per_payment, isWeekly, deviceOffline, colSettingsReady]
  );

  const checkInstallmentOption = useCallback(
    (loan: LoanRecord | undefined, count: number) => {
      const metrics = getLoanMetrics(loan);
      if (!metrics) return { enabled: false, label: "No Loan", cost: 0, isPayAll: false };
      const { remaining, instAmt, instRem, maxAllowed } = metrics;
      if (count > maxAllowed || count > instRem) {
        return { enabled: false, label: count > instRem ? "Exceeds Remaining" : "Max Cap", cost: 0, isPayAll: false };
      }
      const isPayAll = count === instRem;
      const cost = isPayAll ? remaining : Math.min(remaining, Math.round(count * instAmt));
      if (!settingEnabled(colSettings.allow_overpayment) && !isPayAll && cost > remaining + 0.01) {
        return { enabled: false, label: "Exceeds", cost, isPayAll: false };
      }
      return { enabled: true, cost, isPayAll };
    },
    [getLoanMetrics, colSettings.allow_overpayment]
  );

  /* ================= SAVING WITHDRAWAL CASH RULES (STRICT API GUARD) ================= */
  const validateCashWithdrawalRule = useCallback(
    (client: ClientRecord, targetCashAmount: number, bypassAmountCheck = false) => {
      // 1. STRICT LOCKDOWN: Must have confirmed API authorization and be online
      if (!apiWithdrawalsAuthorized || deviceOffline) {
        return {
          ok: false,
          msg: "Cash withdrawals locked by default. An active server session and live verification are required.",
        };
      }

      if (blockedWithdrawalTypes.includes("cash")) {
        return { ok: false, msg: "CASH withdrawal is currently disabled by branch policy." };
      }
      if (!wSettings.allow_weekend_withdrawals && isWeekendSelected) {
        return { ok: false, msg: "Weekend withdrawals paused until Monday." };
      }

      const loan = activeLoansMap.get(client.id) || activeLoansMap.get(String(client.id));
      const row = rowStates[client.id];
      const curSavDeposit = Number(row?.savingsAmount) || 0;
      const totalAvailableSavings = (client.savings_balance || 0) + curSavDeposit;

      if (loan && Number(loan.remaining_balance) > 0.01) {
        const numInst = loan.num_installments || 23;
        const total = Number(loan.total_payable) || 0;
        const remaining = Number(loan.remaining_balance ?? total);
        const paid = Math.max(0, total - remaining);
        const instAmt = loan.inst_amt || (numInst > 0 ? Math.round(total / numInst) : 1);
        const installmentsPaid = instAmt > 0 ? Math.floor(paid / instAmt) : 0;

        if (installmentsPaid < 10) {
          return {
            ok: false,
            msg: `Tenure locked: 10 installments required (${installmentsPaid}/${numInst} paid).`,
          };
        }
        const principal = loan.principal || Math.round(total / 1.15);
        const bufferPct = Number(wSettings.buffer_cash || 10);
        const reqBuffer = (principal * bufferPct) / 100;

        if (totalAvailableSavings <= reqBuffer) {
          return {
            ok: false,
            msg: `Savings at or below ${bufferPct}% security buffer (${formatNaira(reqBuffer)} required). No cash withdrawable.`,
          };
        }
        if (!bypassAmountCheck && targetCashAmount > 0) {
          if (totalAvailableSavings - targetCashAmount < reqBuffer) {
            const maxPermissible = Math.max(0, totalAvailableSavings - reqBuffer);
            return {
              ok: false,
              msg: `Remaining savings will fall below ${bufferPct}% security buffer (${formatNaira(reqBuffer)} required). Max allowed: ${formatNaira(maxPermissible)}.`,
            };
          }
        }
      }
      if (!bypassAmountCheck && targetCashAmount > 0) {
        const maxCashLimit = Number(wSettings.max_cash_withdrawal || 50000);
        if (targetCashAmount > maxCashLimit) {
          return {
            ok: false,
            msg: `Amount exceeds maximum cash limit (${formatNaira(maxCashLimit)}).`,
          };
        }
        if (totalAvailableSavings < targetCashAmount) {
          return {
            ok: false,
            msg: `Requested amount exceeds total savings balance (${formatNaira(totalAvailableSavings)} available).`,
          };
        }
      }
      return { ok: true, msg: "Authorized under savings withdrawal cash rules." };
    },
    [apiWithdrawalsAuthorized, deviceOffline, blockedWithdrawalTypes, wSettings, isWeekendSelected, activeLoansMap, rowStates]
  );

  const calculateMaxWithdrawableCash = useCallback(
    (client: ClientRecord) => {
      const eligibility = validateCashWithdrawalRule(client, 0, true);
      if (!eligibility.ok) return 0;
      const loan = activeLoansMap.get(client.id) || activeLoansMap.get(String(client.id));
      const row = rowStates[client.id];
      const curSavDeposit = Number(row?.savingsAmount) || 0;
      const totalAvailableSavings = (client.savings_balance || 0) + curSavDeposit;
      const maxCashSetting = Number(wSettings.max_cash_withdrawal || 50000);
      if (loan && Number(loan.remaining_balance) > 0.01) {
        const principal = loan.principal || Math.round(Number(loan.total_payable || 0) / 1.15);
        const bufferPct = Number(wSettings.buffer_cash || 10);
        const reqBuffer = (principal * bufferPct) / 100;
        const maxPermissible = Math.max(0, totalAvailableSavings - reqBuffer);
        return Math.min(maxCashSetting, maxPermissible);
      }
      return Math.min(maxCashSetting, totalAvailableSavings);
    },
    [validateCashWithdrawalRule, activeLoansMap, rowStates, wSettings]
  );

  const loadUser = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("cupad_user");
      if (stored) {
        const u = JSON.parse(stored);
        if (u.username) setOfficerUsername(u.username);
        if (u.branch_name || u.branch) setBranchName(u.branch_name || u.branch);
        return u.username || "";
      }
    } catch {}
    return "";
  }, []);

  const loadCachedBusinessSettings = useCallback(async () => {
    const [combinedRaw, repaymentRaw, withdrawalRaw, savingsRaw] = await Promise.all([
      AsyncStorage.getItem(STORAGE_SETTINGS_KEY),
      AsyncStorage.getItem("cupad_cache_repay_settings"),
      AsyncStorage.getItem("cupad_cache_wth_settings"),
      AsyncStorage.getItem("cupad_cache_savings_settings"),
    ]);

    const parseSettings = (raw: string | null) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : null;
      } catch {
        return null;
      }
    };

    const combined = parseSettings(combinedRaw);
    const repayment = parseSettings(repaymentRaw);
    const withdrawal = parseSettings(withdrawalRaw);
    const savings = parseSettings(savingsRaw);
    const hasKeys = (value: any) => Boolean(value && Object.keys(value).length > 0);
    const hasCollectionSettings = hasKeys(combined?.colSettings) || hasKeys(repayment);
    const hasWithdrawalSettings = hasKeys(combined?.wSettings) || hasKeys(withdrawal);
    const hasSavingsSettings = hasKeys(combined?.savSettings) || hasKeys(savings);

    if (hasKeys(combined?.colSettings)) {
      setColSettings((current) => ({ ...current, ...combined.colSettings }));
    } else if (hasKeys(repayment)) {
      setColSettings((current) => ({ ...current, ...repayment }));
    }
    const cachedSavingsSettings = hasKeys(combined?.savSettings) ? combined.savSettings : savings;
    if (hasKeys(cachedSavingsSettings)) {
      setSavSettings((current) => ({ ...current, ...cachedSavingsSettings }));
    }
    const cachedWithdrawalSettings = hasKeys(combined?.wSettings) ? combined.wSettings : withdrawal;
    if (cachedWithdrawalSettings) {
      setWSettings((current) => ({ ...current, ...cachedWithdrawalSettings }));
    }
    if (combined?.isWeekly !== undefined) setIsWeekly(settingEnabled(combined.isWeekly));
    if (combined?.dateReadonly !== undefined) setDateReadonly(settingEnabled(combined.dateReadonly));
    if (combined?.allowWithdrawals === false) {
      setWSettings((current) => ({ ...current, withdrawals_enabled: false }));
    }

    setColSettingsReady(hasCollectionSettings);
    setOfflineWithdrawalSettingsReady(hasWithdrawalSettings);
    setOfflineSavingsSettingsReady(hasSavingsSettings);
  }, []);

  const loadAllClients = useCallback(
    async (dateObj: Date, showSpinner = true) => {
      if (!officerUsername) return;
      if (showSpinner) setLoading(true);
      const dateStr = dateToYmd(dateObj);

      let isOfflineMode = false;
      try {
        const online = await isOnline().catch(() => false);
        if (!online) isOfflineMode = true;
      } catch {
        isOfflineMode = true;
      }

      if (isOfflineMode) {
        setDeviceOffline(true);
        // Lock withdrawals immediately when offline
        setApiWithdrawalsAuthorized(false);
        await loadCachedBusinessSettings().catch((error) =>
          console.warn("Could not load cached combined settings:", error)
        );

        try {
          if (typeof loadCachedRepayments === "function") {
            const local = await loadCachedRepayments();
            if (local?.disbursements && Array.isArray(local.disbursements) && local.disbursements.length > 0) {
              setCachedDisbursements(local.disbursements);
              await AsyncStorage.setItem("cupad_cache_repay_disbursements", JSON.stringify(local.disbursements)).catch(() => {});
            }
            if (local?.clients && Array.isArray(local.clients) && local.clients.length > 0) {
              const clientData: ClientRecord[] = local.clients.map((c: any) => ({
                id: c.id || c.client_id,
                name: c.name || c.client_name,
                union: c.union || c.union_name,
                phone: c.phone,
                savings_balance: Number(c.savings_balance ?? c.savings ?? 0),
                loan: c.loan || null,
              }));
              setClients(clientData);
              const unionsFromClients = Array.from(new Set(clientData.map((c) => c.union).filter(Boolean))) as string[];
              if (unionsFromClients.length > 0) {
                setUnionsList((prev) => {
                  const merged = mergeUnionNames(prev.length ? prev : unionsFromClients, unionsFromClients);
                  setSelectedUnion((cur) => (cur && merged.includes(cur) ? cur : merged[0] || ""));
                  return merged;
                });
              }
              const initialStates: Record<string | number, ClientRowState> = {};
              clientData.forEach((c) => {
                initialStates[c.id] = {
                  loanInstallments: "",
                  loanAmount: 0,
                  savingsAmount: "",
                  withdrawalType: "",
                  withdrawalAmount: "",
                  proofImageUri: null,
                  proofBase64: null,
                  status: "idle",
                };
              });
              setRowStates(initialStates);
              setLoading(false);
              return;
            }
          }

          const boot = await bootstrapCoScreenData(officerUsername);
          if (boot.clients && boot.clients.length > 0) {
            const mapped: ClientRecord[] = boot.clients.map((c: any) => {
              const totalPayable = Number(c.total_payable || c.loan_balance || c.outstanding_loan || 0);
              const remaining = Number(c.outstanding_loan ?? c.loan_balance ?? totalPayable ?? 0);
              const numInst = Number(c.num_installments || c.total_installments || 23);
              let instAmt = Number(c.inst_amt) || 0;
              if (!instAmt && totalPayable > 0 && numInst > 0) {
                instAmt = Math.round(totalPayable / numInst);
              } else if (!instAmt && remaining > 0 && numInst > 0 && totalPayable === 0) {
                instAmt = Math.round(remaining / numInst);
              }
              let loanObj: LoanRecord | null = null;
              if (remaining > 0.01 || totalPayable > 0) {
                loanObj = {
                  id: `loan_${c.id || c.client_id}`,
                  client_id: c.id || c.client_id,
                  principal: Math.round((totalPayable || remaining) / 1.15),
                  total_payable: totalPayable || remaining,
                  remaining_balance: remaining || totalPayable,
                  num_installments: numInst,
                  status: "active",
                  inst_amt: instAmt,
                  date: c.loan_date,
                };
              }
              return {
                id: c.id || c.client_id,
                name: c.name || c.client_name,
                union: c.union || c.union_name,
                phone: c.phone,
                savings_balance: Number(c.savings_balance ?? c.savings ?? 0),
                loan: loanObj,
              };
            });
            const disbFromBoot: any[] = mapped
              .filter((c) => c.loan && Number(c.loan.remaining_balance) > 0.01)
              .map((c) => ({
                id: c.loan!.id,
                client_id: c.id,
                total_payable: c.loan!.total_payable,
                remaining_balance: c.loan!.remaining_balance,
                num_installments: c.loan!.num_installments,
                inst_amt: c.loan!.inst_amt,
                date: c.loan!.date,
                status: "active",
              }));
            if (disbFromBoot.length > 0) {
              setCachedDisbursements(disbFromBoot as any);
              await AsyncStorage.setItem("cupad_cache_repay_disbursements", JSON.stringify(disbFromBoot)).catch(() => {});
            }
            setClients(mapped);
            const unionsFromClients = Array.from(new Set(mapped.map((c) => c.union).filter(Boolean))) as string[];
            if (unionsFromClients.length > 0) {
              setUnionsList((prev) => {
                const merged = mergeUnionNames(prev.length ? prev : unionsFromClients, unionsFromClients);
                setSelectedUnion((cur) => (cur && merged.includes(cur) ? cur : merged[0] || ""));
                return merged;
              });
            }
            const initialStates: Record<string | number, ClientRowState> = {};
            mapped.forEach((c) => {
              initialStates[c.id] = {
                loanInstallments: "",
                loanAmount: 0,
                savingsAmount: "",
                withdrawalType: "",
                withdrawalAmount: "",
                proofImageUri: null,
                proofBase64: null,
                status: "idle",
              };
            });
            setRowStates(initialStates);
            setLoading(false);
            return;
          }

          const ws = await loadOfflineWorkspace(officerUsername);
          if (ws.clients && ws.clients.length > 0) {
            const mapped: ClientRecord[] = ws.clients.map((c: any) => {
              const rawLoan = c.loan || c.disbursement || (c as any).last_loan || null;
              const totalPayable = Number(rawLoan?.total_payable ?? c.total_payable ?? c.outstanding_loan ?? 0);
              const remaining = Number(rawLoan?.remaining_balance ?? c.outstanding_loan ?? c.loan_balance ?? totalPayable ?? 0);
              const numInst = Number(rawLoan?.num_installments ?? c.num_installments ?? 23);
              let instAmt = Number(rawLoan?.inst_amt ?? c.inst_amt) || 0;
              if (!instAmt && totalPayable > 0) instAmt = Math.round(totalPayable / numInst);
              let loanObj: LoanRecord | null = null;
              if (rawLoan || remaining > 0.01 || totalPayable > 0) {
                loanObj = {
                  id: rawLoan?.id || `loan_${c.id || c.client_id}`,
                  client_id: c.id || c.client_id,
                  principal: Number(rawLoan?.principal ?? Math.round((totalPayable || remaining) / 1.15)),
                  total_payable: totalPayable || remaining,
                  remaining_balance: remaining || totalPayable,
                  num_installments: numInst,
                  status: rawLoan?.status || "active",
                  inst_amt: instAmt || Math.round((totalPayable || remaining) / numInst) || 0,
                  date: rawLoan?.date || c.loan_date,
                };
              }
              return {
                id: c.id || c.client_id,
                name: c.name || c.client_name,
                union: c.union,
                phone: c.phone,
                savings_balance: Number(c.savings_balance ?? 0),
                loan: loanObj,
              };
            });
            setClients(mapped);
            const unionsFromClients = Array.from(new Set(mapped.map((c) => c.union).filter(Boolean))) as string[];
            if (unionsFromClients.length > 0) setUnionsList(unionsFromClients);
            setLoading(false);
            return;
          }
        } catch (e) {
          console.log("Offline load error:", e);
        } finally {
          setLoading(false);
        }
        return;
      }

      // ONLINE MODE
      try {
        const res = await axios.get(
          `${API_COMBINED}?action=get_union_data&union=All&date=${encodeURIComponent(
            dateStr
          )}&username=${encodeURIComponent(officerUsername)}`,
          { timeout: 9000 }
        );
        if (res.data?.success && Array.isArray(res.data.data)) {
          const clientData: ClientRecord[] = res.data.data;
          setClients(clientData);

          try {
            const disbToCache = clientData
              .filter((c) => c.loan && Number(c.loan.total_payable) > 0)
              .map((c) => ({
                id: c.loan!.id,
                client_id: c.id,
                total_payable: c.loan!.total_payable,
                remaining_balance: c.loan!.remaining_balance,
                num_installments: c.loan!.num_installments,
                inst_amt: c.loan!.inst_amt,
                date: c.loan!.date,
                status: "active",
              }));
            if (disbToCache.length > 0) {
              setCachedDisbursements(disbToCache as any);
              await AsyncStorage.setItem("cupad_cache_repay_disbursements", JSON.stringify(disbToCache)).catch(() => {});
            }

            if (typeof cacheRepaymentDataLocally === "function" && disbToCache.length > 0) {
              await cacheRepaymentDataLocally(clientData as any, disbToCache as any, officerUsername).catch(() => {});
            } else if (typeof cacheClients === "function") {
              await cacheClients(clientData as any, officerUsername).catch(() => {});
            }

            if (typeof hydrateOfflineCache === "function") {
              await hydrateOfflineCache(officerUsername).catch(() => {});
            }
          } catch {}

          const unionsFromClients = Array.from(new Set(clientData.map((c) => c.union).filter(Boolean))) as string[];
          if (unionsFromClients.length > 0) {
            setUnionsList((prev) => {
              const merged = mergeUnionNames(prev, unionsFromClients);
              setSelectedUnion((cur) => (cur && merged.includes(cur) ? cur : merged[0] || ""));
              return merged;
            });
          }
          const initialStates: Record<string | number, ClientRowState> = {};
          clientData.forEach((c) => {
            const ex = c.existing || { loan_amt: 0, sav_amt: 0, wth_type: "", wth_amt: 0 };
            let initialInst = "";
            const rawLoan = c.loan || (c as any).disbursement;
            if (rawLoan && ex.loan_amt > 0) {
              const numInst = Number(rawLoan.num_installments) || (isWeekly ? 24 : 23);
              const total = Number(rawLoan.total_payable) || 0;
              const instAmt = rawLoan.inst_amt || (numInst > 0 ? Math.round(total / numInst) : 1);
              const ratio = Math.round(ex.loan_amt / instAmt);
              initialInst = ratio > 0 ? String(ratio) : "1";
            }
            initialStates[c.id] = {
              loanInstallments: initialInst,
              loanAmount: ex.loan_amt || 0,
              savingsAmount: ex.sav_amt > 0 ? String(ex.sav_amt) : "",
              withdrawalType: (ex.wth_type as WithdrawalType) || "",
              withdrawalAmount: ex.wth_amt > 0 ? String(ex.wth_amt) : "",
              proofImageUri: null,
              proofBase64: null,
              status: "idle",
            };
          });
          setRowStates(initialStates);
        }
      } catch {
        setDeviceOffline(true);
        showToast("Unable to load union collection records.");
      } finally {
        setLoading(false);
      }
    },
    [officerUsername, isWeekly, loadCachedBusinessSettings]
  );

  const initScreen = useCallback(async () => {
    const user = await loadUser();
    if (!user) return;

    try {
      const on = await isOnline().catch(() => false);
      setDeviceOffline(!on);
      if (!on) {
        setApiWithdrawalsAuthorized(false);
        await loadCachedBusinessSettings().catch((error) =>
          console.warn("Could not load cached combined settings:", error)
        );
      }
    } catch {
      setDeviceOffline(false);
    }

    await checkPendingQueues();

    try {
      const cachedDisb = await AsyncStorage.getItem("cupad_cache_repay_disbursements");
      if (cachedDisb) {
        setCachedDisbursements(JSON.parse(cachedDisb));
      }
    } catch {}

    if (typeof loadCachedRepayments === "function") {
      try {
        const local = await loadCachedRepayments();
        if (local?.disbursements && Array.isArray(local.disbursements) && local.disbursements.length > 0) {
          setCachedDisbursements(local.disbursements);
        }
      } catch {}
    }

    try {
      const res = await axios.get(`${API_COMBINED}?action=init&username=${encodeURIComponent(user)}`, {
        timeout: 9000,
      });

      // ONLY OPEN WITHDRAWALS IF API RESPONDS WITH SUCCESS & EXPLICIT SETTINGS
      if (res.data?.success) {
        const fromInit = Array.isArray(res.data.unions)
          ? res.data.unions.map((u: any) => (typeof u === "string" ? u : u?.name)).filter(Boolean)
          : [];
        const fromClients = Array.from(new Set((res.data.clients || []).map((c: any) => c.union).filter(Boolean))) as string[];
        let fromApi: string[] = [];
        try {
          const uf = await fetchUnionsForOfficer(user);
          fromApi = uf.names || [];
        } catch {}
        const merged = mergeUnionNames(fromApi, fromInit, fromClients);
        setUnionsList(merged);
        setSelectedUnion((prev) => (prev && merged.includes(prev) ? prev : merged[0] || ""));
        if (res.data.date_readonly !== undefined) setDateReadonly(settingEnabled(res.data.date_readonly));
        const nextColSettings = res.data.col_settings || res.data.settings || {};
        const nextSavSettings = res.data.sav_settings || {};
        const nextWSettings = res.data.w_settings || {};
        if (res.data.col_settings) setColSettings((prev) => ({ ...prev, ...res.data.col_settings }));
        else if (res.data.settings) setColSettings((prev) => ({ ...prev, ...res.data.settings }));
        setColSettingsReady(true);
        if (res.data.sav_settings) setSavSettings((prev) => ({ ...prev, ...res.data.sav_settings }));
        setOfflineSavingsSettingsReady(
          Boolean(res.data.sav_settings && Object.keys(res.data.sav_settings).length > 0)
        );
        if (res.data.w_settings) setWSettings((prev) => ({ ...prev, ...res.data.w_settings }));
        setOfflineWithdrawalSettingsReady(
          Boolean(res.data.w_settings && Object.keys(res.data.w_settings).length > 0)
        );
        if (res.data.is_weekly !== undefined) setIsWeekly(settingEnabled(res.data.is_weekly));

        // API RESPONDED AND VALIDATED -> UNLOCK WITHDRAWALS
        const canOpenWithdrawals =
          settingEnabled(res.data.allow_withdrawals, true) &&
          settingEnabled(res.data.w_settings?.withdrawals_enabled, true) &&
          res.data.w_settings?.status !== "disabled";

        setApiWithdrawalsAuthorized(Boolean(canOpenWithdrawals));
        try {
          await AsyncStorage.setItem(
            STORAGE_SETTINGS_KEY,
            JSON.stringify({
              colSettings: nextColSettings,
              savSettings: nextSavSettings,
              wSettings: nextWSettings,
              isWeekly: res.data.is_weekly,
              dateReadonly: res.data.date_readonly,
              allowWithdrawals: Boolean(canOpenWithdrawals),
            })
          );
        } catch (error) {
          console.warn("Could not cache combined collection settings:", error);
        }
      } else {
        setApiWithdrawalsAuthorized(false);
      }
    } catch {
      // Treat an unavailable API as offline; use cached settings for eligible non-cash withdrawals.
      setDeviceOffline(true);
      setApiWithdrawalsAuthorized(false);
      await loadCachedBusinessSettings();
      try {
        const ws = await loadOfflineWorkspace(officerUsername || "");
        if (ws.clients.length > 0) {
          setClients(ws.clients);
          setUnionsList(ws.unionNames);
          setSelectedUnion((prev) => (prev && ws.unionNames.includes(prev) ? prev : ws.unionNames[0] || ""));
        }
        setColSettingsReady(true);
      } catch {
        setColSettingsReady(true);
      }
    }
  }, [loadUser, officerUsername, checkPendingQueues, loadCachedBusinessSettings]);

  useEffect(() => {
    initScreen();
  }, [initScreen]);

  useEffect(() => {
    if (officerUsername) {
      loadAllClients(activeDate);
    }
  }, [activeDate, officerUsername, loadAllClients]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await initScreen();
    if (officerUsername) {
      await loadAllClients(activeDate, false);
    }
    setRefreshing(false);
  }, [initScreen, officerUsername, activeDate, loadAllClients]);

  const handleShiftDay = (deltaDays: number) => {
    if (dateReadonly) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Date Modification Restricted", "Collections must be entered against today's date per management lock.");
      return;
    }
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const nextDate = new Date(activeDate);
    nextDate.setDate(nextDate.getDate() + deltaDays);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (nextDate > today) {
      showToast("Cannot log forward collection dates.");
      return;
    }
    setActiveDate(nextDate);
  };

  const handleSetToday = () => {
    if (dateReadonly) {
      showToast("Date locked to today.");
      return;
    }
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setActiveDate(new Date());
  };

  const handleJumpToLastFriday = () => {
    if (dateReadonly) return;
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const next = new Date(activeDate);
    const day = next.getDay();
    const daysToSubtract = day === 0 ? 2 : 1;
    next.setDate(next.getDate() - daysToSubtract);
    setActiveDate(next);
    showToast(`Switched to ${formatDateDisplay(next)}`);
  };

  /* ================= EXECUTE SAVE ================= */
  const executeSave = async (clientId: string | number, stateToSave?: ClientRowState) => {
    if (isSavingRef.current[clientId]) return;
    isSavingRef.current[clientId] = true;
    setRowStates(updateRowState(clientId, (current) => ({ ...current, status: "saving" })));

    const client = clients.find((c) => String(c.id) === String(clientId));
    const row = stateToSave || rowStates[clientId];
    if (!client || !row) {
      isSavingRef.current[clientId] = false;
      return;
    }

    const targetDateIso = `${dateToYmd(activeDate)} 12:00:00`;
    const loan = activeLoansMap.get(clientId) || activeLoansMap.get(String(clientId));
    const loanCount = Number(row.loanInstallments) || 0;
    const savingsAmt = Number(row.savingsAmount) || 0;
    const wthAmt = Number(row.withdrawalAmount) || 0;

    if (row.withdrawalType && Number(client.savings_balance || 0) + savingsAmt <= 0) {
      const message = "Withdrawal is not allowed when the available savings balance is zero.";
      setRowStates(
        updateRowState(clientId, (current) => ({
          ...current,
          withdrawalType: "",
          withdrawalAmount: "",
          status: "error",
          errorMsg: message,
        }))
      );
      showBlockedWarning("Withdrawal unavailable", message);
      isSavingRef.current[clientId] = false;
      delete saveTimersRef.current[clientId];
      return;
    }

    // Check online status before processing
    const online = await isOnline().catch(() => false);

    // Cash payouts always require live server authorization.
    if (row.withdrawalType && wthAmt > 0) {
      if (
        row.withdrawalType === "cash" &&
        (!online || !apiWithdrawalsAuthorized || deviceOffline)
      ) {
        setDeviceOffline(true);
        setRowStates(
          updateRowState(clientId, (current) => ({
            ...current,
            withdrawalType: "",
            withdrawalAmount: "",
            status: "error",
            errorMsg: "Withdrawal rejected: Online server verification is required.",
          }))
        );
        showBlockedWarning(
          "Withdrawal Blocked",
          "Cash payouts must be authorized by the server in real time and cannot be processed offline."
        );
        isSavingRef.current[clientId] = false;
        delete saveTimersRef.current[clientId];
        return;
      }
    }

    const saveOfflineFallback = async () => {
      try {
        const nowIso = targetDateIso;
        const getOfflineTransactionId = (kind: "loan" | "savings" | "withdrawal") => {
          const key = `${String(client.id)}:${dateToYmd(activeDate)}:${kind}`;
          let id = offlineTransactionIdsRef.current.get(key);
          if (!id) {
            id = `COMB-${kind.toUpperCase()}-OFF-${Date.now().toString(36).toUpperCase()}`;
            offlineTransactionIdsRef.current.set(key, id);
          }
          return id;
        };
        const cancelOfflineTransaction = async (
          kind: "loan" | "savings" | "withdrawal",
          transactionType: "repayment" | "savings" | "withdrawal"
        ) => {
          const key = `${String(client.id)}:${dateToYmd(activeDate)}:${kind}`;
          const id = offlineTransactionIdsRef.current.get(key);
          if (id) await cancelPendingOfflineTransaction(transactionType, id);
        };

        if ((loanCount > 0 || savingsAmt > 0) && isColBlocked) {
          throw new Error("Collections are disabled for the selected weekend by admin settings.");
        }
        if (savingsAmt > 0) {
          if (!offlineSavingsSettingsReady) {
            throw new Error("Savings admin settings are not cached; reconnect before collecting savings.");
          }
          const minValue = Number(savSettings.min_savings_amount);
          const maxValue = Number(savSettings.max_savings_amount);
          const minSavings = Number.isFinite(minValue) ? minValue : 100;
          const maxSavings = Number.isFinite(maxValue) ? maxValue : 1000000;
          if (savingsAmt < minSavings || savingsAmt > maxSavings) {
            throw new Error(`Savings must be between ${formatNaira(minSavings)} and ${formatNaira(maxSavings)}.`);
          }
        }
        if (loanCount > 0) {
          const check = loan ? checkInstallmentOption(loan, loanCount) : null;
          if (!check?.enabled || check.cost <= 0) {
            throw new Error("The selected loan installment is not allowed by the cached collection settings.");
          }
        }
        if (row.withdrawalType && wthAmt > 0) {
          if (row.withdrawalType === "cash") {
            throw new Error("Cash payouts require an online server check and cannot be saved offline.");
          }
          if (!offlineWithdrawalSettingsReady || !withdrawalsEnabledBySettings) {
            throw new Error("Withdrawal settings are not cached or withdrawals are disabled by admin.");
          }
          if (blockedWithdrawalTypes.includes(row.withdrawalType)) {
            throw new Error(`${row.withdrawalType.toUpperCase()} withdrawals are disabled by branch policy.`);
          }
          if (isWthBlocked) {
            throw new Error("Weekend withdrawals are disabled by admin settings.");
          }
          if (!loan || Number(loan.remaining_balance) <= 0.01) {
            throw new Error("An active loan is required for this withdrawal type.");
          }
          const availableSavings = Number(client.savings_balance || 0) + savingsAmt;
          if (row.withdrawalType === "withdrawal") {
            const metrics = getLoanMetrics(loan);
            if (!metrics || metrics.instPaid < 10) {
              throw new Error("At least 10 loan installments must be paid before this withdrawal.");
            }
            const bufferPct = Number(wSettings.buffer_withdrawal || 10);
            const requiredBuffer = (Number(loan.principal || 0) * bufferPct) / 100;
            if (availableSavings < requiredBuffer || availableSavings < wthAmt || wthAmt <= 0) {
              throw new Error(`Insufficient savings after the ${bufferPct}% security buffer.`);
            }
          } else if (
            row.withdrawalType === "return" &&
            (wthAmt <= 0 || wthAmt > availableSavings || wthAmt > Number(loan.remaining_balance))
          ) {
            throw new Error("Loan return must be within the available savings and outstanding loan balance.");
          }
        }

        if (loan && loanCount > 0) {
          const check = checkInstallmentOption(loan, loanCount);
          const payable = check.cost || 0;
          if (payable <= 0) throw new Error("Invalid installment amount - loan not loaded offline");
          const isPayingAll = check.isPayAll;
          const newBal = isPayingAll ? 0 : Math.max(0, Number(loan.remaining_balance) - payable);
          const tempTxId = getOfflineTransactionId("loan");
          if (typeof saveRepaymentOffline === "function") {
            await saveRepaymentOffline({
              tempTxId,
              clientId: client.id,
              clientName: client.name,
              unionName: client.union,
              amount: payable,
              date: nowIso,
              remainingBalance: newBal,
              officer: officerUsername,
              numInstallments: loanCount,
              isCustom: isPayingAll,
              loanId: loan.id,
            });
          }
        } else {
          await cancelOfflineTransaction("loan", "repayment");
        }
        if (savingsAmt > 0) {
          const tempSavId = getOfflineTransactionId("savings");
          if (typeof saveSavingsOffline === "function") {
            await saveSavingsOffline({
              tempId: tempSavId,
              clientId: client.id,
              clientName: client.name,
              amount: savingsAmt,
              date: nowIso,
              officer: officerUsername,
              union: client.union,
            });
          }
        } else {
          await cancelOfflineTransaction("savings", "savings");
        }
        if (row.withdrawalType && wthAmt > 0) {
          await saveWithdrawalOffline({
            tempTxId: getOfflineTransactionId("withdrawal"),
            clientId: client.id,
            clientName: client.name,
            amount: wthAmt,
            type: row.withdrawalType,
            balanceAfter: Math.max(0, Number(client.savings_balance || 0) + savingsAmt - wthAmt),
            date: nowIso,
            officer: officerUsername,
            union: client.union,
          });
        } else {
          await cancelOfflineTransaction("withdrawal", "withdrawal");
        }

        if (loanCount === 0 && savingsAmt === 0 && !(row.withdrawalType && wthAmt > 0)) {
          await checkPendingQueues();
          setRowStates(updateRowState(clientId, (current) => ({ ...current, status: "idle" })));
          showToast("Pending offline entries cleared.");
          return;
        }

        await checkPendingQueues();
        setRowStates(updateRowState(clientId, (current) => ({ ...current, status: "saved" })));
        showToast("Saved offline. Pending sync.");
        setTimeout(() => {
          setRowStates((prev) => {
            const current = prev[clientId] ?? createClientRowState();
            const next = { ...prev } as Record<string | number, ClientRowState>;
            if (prev[clientId]?.status === "saved") {
              next[clientId] = { ...current, status: "idle" };
            }
            return next;
          });
        }, 2500);
      } catch (e: any) {
        setRowStates(
          updateRowState(clientId, (current) => ({ ...current, status: "error", errorMsg: e?.message }))
        );
        showToast(`Offline save failed: ${e?.message}`);      } finally {
        isSavingRef.current[clientId] = false;
        delete saveTimersRef.current[clientId];
      }
    };

    if (!online) {
      setDeviceOffline(true);
      await saveOfflineFallback();
      return;
    }

    const payload = {
      action: "save_client",
      client_id: client.id,
      date: targetDateIso,
      installment: row.loanInstallments || "",
      savings_amount: row.savingsAmount || "0",
      withdrawal_type: row.withdrawalType || "",
      withdrawal_amount: row.withdrawalAmount || "0",
      username: officerUsername,
      picture_base64: row.proofBase64 || null,
    };
    try {
      const res = await axios.post(API_COMBINED, payload, { timeout: 10000 });
      if (res.data?.success) {
        setRowStates(updateRowState(clientId, (current) => ({ ...current, status: "saved" })));
        showToast("Saved & synced");
        setTimeout(() => {
          setRowStates((prev) => {
            const current = prev[clientId] ?? createClientRowState();
            const next = { ...prev } as Record<string | number, ClientRowState>;
            if (prev[clientId]?.status === "saved") {
              next[clientId] = { ...current, status: "idle" };
            }
            return next;
          });
        }, 2500);
      } else {
        const message = res.data?.message || "Server rejected the collection.";
        setRowStates(updateRowState(clientId, (current) => ({ ...current, status: "error", errorMsg: message })));
        showToast(message);
      }
    } catch (err: any) {
      if (axios.isAxiosError(err) && err.response) {
        const message = err.response.data?.message || "Server rejected the collection.";
        setRowStates(
          updateRowState(clientId, (current) => ({ ...current, status: "error", errorMsg: message }))
        );
        showToast(message);
        return;
      }
      setDeviceOffline(true);
      await saveOfflineFallback();
    } finally {
      if (isSavingRef.current[clientId]) {
        isSavingRef.current[clientId] = false;
        delete saveTimersRef.current[clientId];
      }
    }
  };

  const triggerAutoSave = (clientId: string | number, updatedState: ClientRowState) => {
    if (
      updatedState.withdrawalType === "cash" &&
      !updatedState.proofImageUri &&
      Number(wSettings.require_image_for_cash) === 1
    ) {
      setRowStates(
        updateRowState(clientId, (current) => ({ ...current, ...updatedState, status: "waiting_image" }))
      );
      return;
    }
    setRowStates(updateRowState(clientId, (current) => ({ ...current, ...updatedState, status: "pending" })));

    if (saveTimersRef.current[clientId]) {
      clearTimeout(saveTimersRef.current[clientId]);
    }
    saveTimersRef.current[clientId] = setTimeout(() => {
      executeSave(clientId, updatedState);
    }, 900);
  };

  /* ================= HANDLE LOAN SELECTION ================= */
  const handleLoanChange = (clientId: string | number, instNum: string) => {
    if (!colSettingsReady && instNum === "3") {
      showToast("Please wait, syncing payment rules...");
      return;
    }
    const loan = activeLoansMap.get(clientId) || activeLoansMap.get(String(clientId));
    if (!loan) return;
    const count = Number(instNum) || 0;
    let loanAmt = 0;

    if (count > 0) {
      const check = checkInstallmentOption(loan, count);
      if (!check.enabled) {
        Alert.alert("Rule Exception", `Cannot select ${count}x installments: ${check.label}`);
        return;
      }
      loanAmt = check.cost;
    }

    if (Platform.OS !== "web") Haptics.selectionAsync();

    setRowStates((prev) => {
      const cur = prev[clientId] || {
        loanInstallments: "",
        loanAmount: 0,
        savingsAmount: "",
        withdrawalType: "",
        withdrawalAmount: "",
        proofImageUri: null,
        proofBase64: null,
        status: "idle",
      };
      const nextWthType = cur.withdrawalType === "withdrawal" || cur.withdrawalType === "return" ? "" : cur.withdrawalType;
      const nextWthAmt = nextWthType === "" ? "" : cur.withdrawalAmount;
      const next: ClientRowState = {
        ...cur,
        loanInstallments: instNum,
        loanAmount: loanAmt,
        withdrawalType: nextWthType,
        withdrawalAmount: nextWthAmt,
      };
      triggerAutoSave(clientId, next);
      return { ...prev, [clientId]: next };
    });
  };

  const handleSavingsChange = (clientId: string | number, val: string) => {
    const cleaned = val.replace(/[^0-9]/g, "");
    setRowStates((prev) => {
      const cur = prev[clientId] || {
        loanInstallments: "",
        loanAmount: 0,
        savingsAmount: "",
        withdrawalType: "",
        withdrawalAmount: "",
        proofImageUri: null,
        proofBase64: null,
        status: "idle",
      };
      const next = { ...cur, savingsAmount: cleaned };
      triggerAutoSave(clientId, next);
      return { ...prev, [clientId]: next };
    });
  };

  const handleQuickAddSavings = (clientId: string | number, addVal: number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const curAmt = Number(rowStates[clientId]?.savingsAmount || 0);
    handleSavingsChange(clientId, String(curAmt + addVal));
  };

  const handleWithdrawalTypeChange = async (clientId: string | number, type: WithdrawalType) => {
    const client = clients.find((c) => String(c.id) === String(clientId));
    const loan = activeLoansMap.get(clientId) || activeLoansMap.get(String(clientId));
    if (!client) return;

    if (type !== "") {
      const currentSavings = Number(client.savings_balance || 0);
      const pendingSavings = Number(rowStates[clientId]?.savingsAmount || 0);
      if (currentSavings + pendingSavings <= 0) {
        showBlockedWarning(
          "Withdrawal Unavailable",
          "This client has no savings available for withdrawal. Enter a savings deposit first, then try again."
        );
        return;
      }

      const online = await isOnline().catch(() => false);
      const offlineAllowed =
        !online &&
        type !== "cash" &&
        offlineWithdrawalSettingsReady &&
        withdrawalsEnabledBySettings;
      if (type === "cash" && (!online || deviceOffline || !apiWithdrawalsAuthorized)) {
        showBlockedWarning(
          "Cash Payout Requires Internet",
          "Cash payouts must be authorized by the server and cannot be processed offline."
        );
        return;
      }
      if ((!online || deviceOffline || !apiWithdrawalsAuthorized) && !offlineAllowed) {
        showBlockedWarning(
          "Withdrawal Blocked",
          "Cached admin withdrawal settings are required for offline withdrawals."
        );
        return;
      }
      if (blockedWithdrawalTypes.includes(type)) {
        showBlockedWarning("Withdrawal Disabled", `${type.toUpperCase()} withdrawals are disabled by branch policy.`);
        return;
      }
      if (isWthBlocked) {
        showBlockedWarning("Withdrawal Disabled", "Weekend withdrawals are disabled by admin settings.");
        return;
      }
      if ((type === "withdrawal" || type === "return") && !loan) {
        showBlockedWarning("Withdrawal Unavailable", "This client has no active loan.");
        return;
      }

      if (type === "cash") {
        const cashCheck = validateCashWithdrawalRule(client, 0, true);
        if (!cashCheck.ok) {
          showBlockedWarning("Cash Payout Ineligible", cashCheck.msg);
          return;
        }
      }
    }

    if (Platform.OS !== "web") Haptics.selectionAsync();

    setRowStates((prev) => {
      const cur = prev[clientId] || {
        loanInstallments: "",
        loanAmount: 0,
        savingsAmount: "",
        withdrawalType: "",
        withdrawalAmount: "",
        proofImageUri: null,
        proofBase64: null,
        status: "idle",
      };
      let nextLoanInst = cur.loanInstallments;
      let nextLoanAmt = cur.loanAmount;
      let nextWthAmt = "";
      if (type === "withdrawal" || type === "return") {
        nextLoanInst = "";
        nextLoanAmt = 0;
      }
      if (type === "return" && loan) {
        const curSav = Number(cur.savingsAmount) || 0;
        const totalSav = (client.savings_balance || 0) + curSav;
        const maxReturn = Math.min(totalSav, loan.remaining_balance);
        nextWthAmt = maxReturn > 0 ? String(Math.round(maxReturn)) : "";
      } else if (type === "withdrawal" && loan) {
        nextWthAmt = String(Math.round(loan.inst_amt || 0));
      } else if (type === "cash") {
        nextWthAmt = cur.withdrawalAmount;
      }
      const next: ClientRowState = {
        ...cur,
        loanInstallments: nextLoanInst,
        loanAmount: nextLoanAmt,
        withdrawalType: type,
        withdrawalAmount: nextWthAmt,
      };
      triggerAutoSave(clientId, next);
      return { ...prev, [clientId]: next };
    });
  };

  const handleCashAmountChange = (clientId: string | number, val: string) => {
    const client = clients.find((c) => String(c.id) === String(clientId));
    const cleaned = val.replace(/[^0-9]/g, "");
    const amt = Number(cleaned) || 0;
    if (client && amt > 0) {
      const check = validateCashWithdrawalRule(client, amt);
      if (!check.ok) {
        showBlockedWarning("Cash Payout Unavailable", check.msg);
      }
    }
    setRowStates((prev) => {
      const cur = prev[clientId] || {
        loanInstallments: "",
        loanAmount: 0,
        savingsAmount: "",
        withdrawalType: "",
        withdrawalAmount: "",
        proofImageUri: null,
        proofBase64: null,
        status: "idle",
      };
      const next = { ...cur, withdrawalAmount: cleaned };
      triggerAutoSave(clientId, next);
      return { ...prev, [clientId]: next };
    });
  };

  const handleQuickAddCash = (clientId: string | number, addVal: number) => {
    const client = clients.find((c) => String(c.id) === String(clientId));
    if (!client) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const curAmt = Number(rowStates[clientId]?.withdrawalAmount || 0);
    const targetAmt = curAmt + addVal;
    const check = validateCashWithdrawalRule(client, targetAmt);
    if (!check.ok) {
      showBlockedWarning("Cash Limit Reached", check.msg);
      return;
    }
    handleCashAmountChange(clientId, String(targetAmt));
  };

  const handleSetMaxCash = (clientId: string | number) => {
    const client = clients.find((c) => String(c.id) === String(clientId));
    if (!client) return;
    const maxAllowed = calculateMaxWithdrawableCash(client);
    if (maxAllowed <= 0) {
      const check = validateCashWithdrawalRule(client, 0, true);
      showBlockedWarning("No Withdrawable Cash", check.msg);
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    handleCashAmountChange(clientId, String(Math.round(maxAllowed)));
    showToast(`Set to maximum allowed: ${formatNaira(maxAllowed)}`);
  };

  const handleClearRow = (clientId: string | number) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (saveTimersRef.current[clientId]) {
      clearTimeout(saveTimersRef.current[clientId]);
    }
    setRowStates((prev) => {
      const next: ClientRowState = {
        loanInstallments: "",
        loanAmount: 0,
        savingsAmount: "",
        withdrawalType: "",
        withdrawalAmount: "",
        proofImageUri: null,
        proofBase64: null,
        status: "idle",
      };
      executeSave(clientId, next);
      return { ...prev, [clientId]: next };
    });
    showToast("Collection cleared");
  };

  const pickProofPhoto = async (useCamera = false) => {
    if (!activePhotoClientId) return;
    setPhotoPickerVisible(false);
    try {
      let result;
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission Required", "Camera access needed to upload payment proof.");
          return;
        }
        result = await ImagePicker.launchCameraAsync({ quality: 0.65, base64: true, allowsEditing: true, aspect: [4, 3] });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ quality: 0.65, base64: true, allowsEditing: true, aspect: [4, 3] });
      }
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        setRowStates((prev) => {
          const cur = prev[activePhotoClientId] || {
            loanInstallments: "",
            loanAmount: 0,
            savingsAmount: "",
            withdrawalType: "",
            withdrawalAmount: "",
            proofImageUri: null,
            proofBase64: null,
            status: "idle",
          };
          const next = {
            ...cur,
            proofImageUri: asset.uri,
            proofBase64: asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : null,
          };
          triggerAutoSave(activePhotoClientId, next);
          return { ...prev, [activePhotoClientId]: next };
        });
        showToast("Proof photo attached");
      }
    } catch {
      Alert.alert("Error", "Could not pick image asset.");
    }
  };

  const baseUnionClients = useMemo(() => {
    if (!selectedUnion) return clients;
    return clients.filter((c) => c.union && c.union.toLowerCase() === selectedUnion.toLowerCase());
  }, [clients, selectedUnion]);

  const skeletonCount = useMemo(() => {
    const knownCount = baseUnionClients.length;
    if (knownCount > 0) return Math.min(knownCount, 6);
    const availableHeight = Dimensions.get("window").height - 300;
    return Math.max(3, Math.ceil(availableHeight / 240));
  }, [baseUnionClients]);

  const filteredClients = useMemo(() => {
    return baseUnionClients.filter((c) => {
      const row = rowStates[c.id];
      const hasCollected = row && (row.loanAmount > 0 || Number(row.savingsAmount) > 0 || Number(row.withdrawalAmount) > 0);
      return statusFilter === "all" ? true : statusFilter === "collected" ? hasCollected : !hasCollected;
    });
  }, [baseUnionClients, statusFilter, rowStates]);

  const dailyTransactionsList = useMemo((): DailyTransactionEntry[] => {
    const list: DailyTransactionEntry[] = [];
    clients.forEach((c) => {
      const row = rowStates[c.id];
      if (row) {
        const l = row.loanAmount || 0;
        const s = Number(row.savingsAmount) || 0;
        const w = Number(row.withdrawalAmount) || 0;
        if (l > 0 || s > 0 || w > 0) {
          list.push({
            client_id: c.id,
            client_name: c.name,
            union: c.union || "Union",
            loan_amount: l,
            savings_amount: s,
            withdrawal_amount: w,
            withdrawal_type: row.withdrawalType,
            time: "Recorded",
          });
        }
      }
    });
    return list;
  }, [clients, rowStates]);

  const totals = useMemo(() => {
    let loanTotal = 0;
    let savingsTotal = 0;
    let withdrawalTotal = 0;
    let collectedCount = 0;
    baseUnionClients.forEach((c) => {
      const row = rowStates[c.id];
      if (row) {
        const l = row.loanAmount || 0;
        const s = Number(row.savingsAmount) || 0;
        const w = Number(row.withdrawalAmount) || 0;
        loanTotal += l;
        savingsTotal += s;
        withdrawalTotal += w;
        if (l > 0 || s > 0 || w > 0) collectedCount++;
      }
    });
    const net = loanTotal + savingsTotal;
    const progressPct = baseUnionClients.length > 0 ? Math.round((collectedCount / baseUnionClients.length) * 100) : 0;
    return { loanTotal, savingsTotal, withdrawalTotal, net, collectedCount, progressPct };
  }, [baseUnionClients, rowStates]);

  return (
    <CoScreenWrapper>
      {/* Background Orbs */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={260} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={height * 0.45} delay={2000} />
      </View>

      {/* Floating Toast */}
      {toastMessage && (
        <Animated.View
          style={[
            styles.toastBox,
            {
              backgroundColor: cardSurfaceBg,
              borderColor: glassBorder,
              opacity: toastOpacity,
              transform: [{ translateY: toastY }],
              shadowColor: shadowDark,
            },
          ]}
        >
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 10,
              backgroundColor: "rgba(16,185,129,0.14)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          </View>
          <Text style={[styles.toastText, { color: colors.text }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      <Modal
        visible={Boolean(blockedWarning)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setBlockedWarning(null)}
      >
        <View style={styles.warningModalOverlay}>
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityRole="button"
            accessibilityLabel="Dismiss warning"
            onPress={() => setBlockedWarning(null)}
          />
          <LinearGradient
            colors={isDark ? ["#1E293B", "#0F172A"] : ["#FFFFFF", "#F8FAFC"]}
            style={[styles.warningModalCard, { borderColor: glassBorder }]}
            accessibilityViewIsModal
          >
            <View style={styles.warningIconCircle}>
              <Ionicons name="lock-closed" size={23} color="#B45309" />
            </View>
            <Text style={[styles.warningModalTitle, { color: colors.text }]}>
              {blockedWarning?.title}
            </Text>
            <Text style={[styles.warningModalMessage, { color: colors.textMuted }]}>
              {blockedWarning?.message}
            </Text>
            <View
              style={[
                styles.warningModalHint,
                {
                  backgroundColor: isDark ? "rgba(245,158,11,0.10)" : "#FFFBEB",
                  borderColor: isDark ? "rgba(245,158,11,0.22)" : "#FDE68A",
                },
              ]}
            >
              <Ionicons name="information-circle-outline" size={16} color="#D97706" />
              <Text style={[styles.warningModalHintText, { color: isDark ? "#FCD34D" : "#92400E" }]}>
                This withdrawal action is blocked. Review the reason and update the details or settings before trying again.
              </Text>
            </View>
            <Pressable
              onPress={() => setBlockedWarning(null)}
              accessibilityRole="button"
              style={[styles.warningModalButton, { backgroundColor: colors.primary }]}
            >
              <Text style={styles.warningModalButtonText}>Got it</Text>
            </Pressable>
          </LinearGradient>
        </View>
      </Modal>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <Animated.ScrollView
          style={{ flex: 1, opacity: fadeAnim }}
          contentContainerStyle={{ paddingBottom: 160 }}
          showsVerticalScrollIndicator={false}
          stickyHeaderIndices={[1]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* Hero Card */}
          <LinearGradient
            colors={isDark ? ["rgba(30, 41, 59, 0.88)", "rgba(15, 23, 42, 0.92)"] : ["#FFFFFF", "rgba(248, 250, 252, 0.95)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.heroCard, { borderColor: glassBorder }]}
          >
            <View style={styles.heroHeaderBar}>
              <View style={[styles.heroTagPill, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                <View style={[styles.statusPulseDot, { backgroundColor: "#2563EB" }]} />
                <Text style={[styles.heroTagText, { color: "#2563EB" }]}>COMBINED COLLECTION</Text>
              </View>
              <View
                style={[
                  styles.badgeCountPill,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" },
                ]}
              >
                <Ionicons name="calendar-outline" size={11} color={colors.textMuted} />
                <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>{formatDateDisplay(activeDate)}</Text>
              </View>
            </View>

            <View style={styles.heroMainBalanceSection}>
              <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                BRANCH | {branchName || "Main Branch"} | {baseUnionClients.length} CLIENTS
              </Text>
              <View style={styles.heroAmountRow}>
                <Text style={[styles.heroMainAmount, { color: colors.text }]}>{formatNaira(totals.net)}</Text>
                <View
                  style={[
                    styles.netPill,
                    { backgroundColor: totals.net >= 0 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" },
                  ]}
                >
                  <Ionicons
                    name={totals.net >= 0 ? "trending-up" : "trending-down"}
                    size={12}
                    color={totals.net >= 0 ? "#10B981" : "#EF4444"}
                  />
                  <Text style={[styles.netPillText, { color: totals.net >= 0 ? "#10B981" : "#EF4444" }]}>
                    {totals.progressPct}% done
                  </Text>
                </View>
              </View>
              <Text style={[styles.heroSubText, { color: colors.textMuted }]}>Net physical cash today's combined inflow</Text>
            </View>

            <View style={styles.heroMetricsGrid}>
              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <View style={[styles.metricIconCircle, { backgroundColor: "rgba(124,58,237,0.12)" }]}>
                    <Ionicons name="cash" size={12} color="#7C3AED" />
                  </View>
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Loans</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>{formatNaira(totals.loanTotal)}</Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>repayments</Text>
              </View>
              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <View style={[styles.metricIconCircle, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
                    <Ionicons name="wallet" size={12} color="#10B981" />
                  </View>
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Savings</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>{formatNaira(totals.savingsTotal)}</Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>deposits</Text>
              </View>
              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <View style={[styles.metricIconCircle, { backgroundColor: "rgba(239,68,68,0.12)" }]}>
                    <Ionicons name="arrow-down-circle" size={12} color="#EF4444" />
                  </View>
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Cash Out</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>{formatNaira(totals.withdrawalTotal)}</Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>withdrawals</Text>
              </View>
              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <View style={[styles.metricIconCircle, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                    <Ionicons name="people" size={12} color="#2563EB" />
                  </View>
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Clients</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>
                  {totals.collectedCount}/{baseUnionClients.length}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>collected</Text>
              </View>
            </View>

            {/* Date Navigator */}
            <View
              style={[
                styles.heroDateNavRow,
                { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(241,245,249,0.7)", borderColor: glassBorder },
              ]}
            >
              <Pressable
                onPress={() => handleShiftDay(-1)}
                style={[
                  styles.dayShiftBtn,
                  { backgroundColor: cardSurfaceBg, borderColor: glassBorder, opacity: dateReadonly ? 0.45 : 1 },
                ]}
              >
                <Ionicons name={dateReadonly ? "lock-closed" : "chevron-back"} size={14} color={colors.text} />
                <Text style={[styles.dayShiftText, { color: colors.text }]}>Prev</Text>
              </Pressable>
              <Text style={[styles.heroDateCenter, { color: colors.text }]}>{formatDateDisplay(activeDate)}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                <Pressable onPress={handleSetToday} disabled={dateReadonly} style={[styles.todayBtn, { opacity: dateReadonly ? 0.5 : 1 }]}>
                  <Text style={styles.todayBtnText}>Today</Text>
                </Pressable>
                <Pressable
                  onPress={() => handleShiftDay(1)}
                  style={[
                    styles.dayShiftBtn,
                    { backgroundColor: cardSurfaceBg, borderColor: glassBorder, opacity: dateReadonly ? 0.45 : 1 },
                  ]}
                >
                  <Text style={[styles.dayShiftText, { color: colors.text }]}>Next</Text>
                  <Ionicons name={dateReadonly ? "lock-closed" : "chevron-forward"} size={14} color={colors.text} />
                </Pressable>
              </View>
            </View>
          </LinearGradient>

          {/* Sticky Union Selector Bar */}
          <View
            style={[
              styles.topControlGlassRow,
              {
                backgroundColor: colors.background,
                borderBottomWidth: 1,
                borderBottomColor: glassBorder,
                paddingTop: 12,
                paddingBottom: 12,
                zIndex: 20,
                elevation: 2,
              },
            ]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.unionScroll, { paddingHorizontal: 16, gap: 10, alignItems: "center" }]}
            >
              {unionsList.map((u) => {
                const isSelected = selectedUnion === u;
                const count = clients.filter((c) => c.union === u).length;
                return (
                  <Pressable
                    key={u}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      setSelectedUnion(u);
                    }}
                    style={[
                      styles.unionChipGlass,
                      {
                        backgroundColor: isSelected ? colors.primary : cardSurfaceBg,
                        borderColor: isSelected ? colors.primary : glassBorder,
                      },
                    ]}
                  >
                    <Ionicons name="business" size={12} color={isSelected ? "#fff" : colors.textMuted} />
                    <Text style={[styles.unionChipText, { color: isSelected ? "#fff" : colors.text }]}>{u}</Text>
                    <View
                      style={[
                        styles.unionCountPill,
                        {
                          backgroundColor: isSelected
                            ? "rgba(255,255,255,0.2)"
                            : isDark
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(0,0,0,0.05)",
                        },
                      ]}
                    >
                      <Text style={[styles.unionCountText, { color: isSelected ? "#fff" : colors.textMuted }]}>{count}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>

          {/* Warning Banner when offline or unconfirmed */}
          {(!canOpenWithdrawalOptions || deviceOffline) && (
            <View style={[styles.warningBanner, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.22)", borderWidth: 1 }]}>
              <Ionicons name={canOpenWithdrawalOptions ? "cloud-offline" : "lock-closed"} size={16} color={canOpenWithdrawalOptions ? "#D97706" : "#EF4444"} />
              <Text style={[styles.warningBannerText, { color: canOpenWithdrawalOptions ? "#D97706" : "#EF4444" }]}>
                {canOpenWithdrawalOptions
                  ? "Offline mode: cash payouts are unavailable; cached admin-approved deductions can be queued."
                  : "Withdrawals are locked until admin settings are available and the server authorizes them."}
              </Text>
            </View>
          )}

          {isWeekendSelected && !savSettings.allow_weekend_collection && (
            <View style={[styles.warningBanner, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, borderWidth: 1 }]}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    backgroundColor: "rgba(245,158,11,0.15)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="warning" size={14} color="#F59E0B" />
                </View>
                <Text style={[styles.warningBannerText, { color: colors.text }]}>Weekend collections paused per savings policy.</Text>
              </View>
              <Pressable onPress={handleJumpToLastFriday} style={styles.fridayShortcutBtn}>
                <Text style={styles.fridayShortcutText}>Friday</Text>
              </Pressable>
            </View>
          )}

          {/* Progress + View Mode Switcher + Reconcile */}
          <View style={styles.progressStatusBar}>
            <View style={styles.progressInfo}>
              <View style={[styles.progressIconBox, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                <Ionicons name="people" size={12} color="#2563EB" />
              </View>
              <View>
                <Text style={[styles.progressCounter, { color: colors.text }]}>{baseUnionClients.length} clients</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.progressSubLabel, { color: colors.textMuted }]}>{selectedUnion || "All Unions"}</Text>
                  <View style={styles.progressPill}>
                    <Text style={styles.progressPctText}>{totals.progressPct}%</Text>
                  </View>
                </View>
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {/* Card / Table Switcher */}
              <View
                style={[
                  styles.viewModeToggleWrap,
                  { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9", borderColor: glassBorder },
                ]}
              >
                <Pressable
                  onPress={() => handleToggleViewMode("card")}
                  style={[
                    styles.viewModeBtn,
                    viewMode === "card" && { backgroundColor: cardSurfaceBg, shadowColor: shadowDark, elevation: 1 },
                  ]}
                  hitSlop={4}
                >
                  <Ionicons name="grid-outline" size={14} color={viewMode === "card" ? colors.primary : colors.textMuted} />
                </Pressable>
                <Pressable
                  onPress={() => handleToggleViewMode("table")}
                  style={[
                    styles.viewModeBtn,
                    viewMode === "table" && { backgroundColor: cardSurfaceBg, shadowColor: shadowDark, elevation: 1 },
                  ]}
                  hitSlop={4}
                >
                  <Ionicons name="list-outline" size={15} color={viewMode === "table" ? colors.primary : colors.textMuted} />
                </Pressable>
              </View>

              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  setShowSummarySheet(true);
                }}
                style={[styles.reconcileActionBtn, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}
              >
                <Ionicons name="document-text-outline" size={12} color={colors.text} />
                <Text style={[styles.reconcileActionText, { color: colors.text }]}>Reconcile</Text>
              </Pressable>
            </View>
          </View>

          {/* Filter Chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginTop: 10 }}>
            {(["all", "pending", "collected"] as const).map((f) => {
              const active = statusFilter === f;
              return (
                <Pressable
                  key={f}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setStatusFilter(f);
                  }}
                  style={[
                    styles.filterChip,
                    {
                      backgroundColor: active ? colors.primary : cardSurfaceBg,
                      borderColor: active ? colors.primary : glassBorder,
                    },
                  ]}
                >
                  <Text style={[styles.filterChipText, { color: active ? "#FFF" : colors.textMuted }]}>
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* CLIENTS FEED (CARD OR TABLE VIEW) */}
          <View style={styles.cardsFeed}>
            {loading ? (
              <>
                {Array.from({ length: skeletonCount }).map((_, i) => (
                  <ClientCardSkeleton key={i} isDark={isDark} cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
                ))}
              </>
            ) : filteredClients.length === 0 ? (
              <View style={[styles.emptyBox, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                  <Ionicons name="people-outline" size={28} color={colors.textMuted} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.text }]}>No Members Found</Text>
                <Text style={[styles.emptySub, { color: colors.textMuted }]}>No clients matched the current filter criteria in this union</Text>
              </View>
            ) : viewMode === "card" ? (
              /* ================= 1. CARD VIEW ================= */
              filteredClients.map((client) => {
                const row = rowStates[client.id] || {
                  loanInstallments: "",
                  loanAmount: 0,
                  savingsAmount: "",
                  withdrawalType: "",
                  withdrawalAmount: "",
                  proofImageUri: null,
                  proofBase64: null,
                  status: "idle",
                };
                const loan = activeLoansMap.get(client.id) || activeLoansMap.get(String(client.id));
                const isWithdrawalDrawerOpen = expandedWithdrawalClientId === client.id;
                const curCash = Number(row.withdrawalAmount) || 0;
                const cashEligibility = validateCashWithdrawalRule(client, 0, true);
                const hasNoSavings =
                  Number(client.savings_balance || 0) + (Number(row.savingsAmount) || 0) <= 0;
                const dynamicRem = loan
                  ? (() => {
                      const base = Number(loan.remaining_balance) || 0;
                      const rowAmt = row.loanAmount || 0;
                      return Math.max(0, base - rowAmt);
                    })()
                  : 0;
                const dynamicSav = (client.savings_balance || 0) + (Number(row.savingsAmount) || 0) - curCash;
                const isLoanLocked = isColBlocked;

                return (
                  <View
                    key={String(client.id)}
                    style={[styles.clientCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder, shadowColor: shadowDark }]}
                  >
                    <View
                      style={[
                        styles.cardAccentLine,
                        {
                          backgroundColor:
                            row.loanAmount > 0
                              ? "#7C3AED"
                              : row.savingsAmount
                              ? "#10B981"
                              : row.withdrawalAmount
                              ? "#EF4444"
                              : glassBorder,
                        },
                      ]}
                    />
                    {/* Header */}
                    <View style={styles.cardHeaderRow}>
                      <View style={[styles.avatarBox, { backgroundColor: "rgba(37,99,235,0.12)" }]}>
                        <Text style={[styles.avatarText, { color: "#2563EB" }]}>{client.name.slice(0, 2).toUpperCase()}</Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={[styles.clientName, { color: colors.text }]}>{client.name}</Text>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                          <View
                            style={[
                              styles.miniUnionPill,
                              { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" },
                            ]}
                          >
                            <Text style={[styles.miniUnionText, { color: colors.textMuted }]}>{client.union || "General"}</Text>
                          </View>
                          {client.phone && <Text style={[styles.clientSub, { color: colors.textMuted }]}>{client.phone}</Text>}
                        </View>
                      </View>

                      <View style={styles.cardRightControls}>
                        {row.status === "saving" && <ActivityIndicator size="small" color={colors.primary} />}
                        {row.status === "saved" && (
                          <View style={[styles.statusPill, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
                            <View style={[styles.pulseDot, { backgroundColor: "#10B981" }]} />
                            <Text style={[styles.statusText, { color: "#10B981" }]}>Saved</Text>
                          </View>
                        )}
                        {row.status === "pending" && (
                          <View style={[styles.statusPill, { backgroundColor: "rgba(217,119,6,0.12)" }]}>
                            <View style={styles.pulseDot} />
                            <Text style={[styles.statusText, { color: "#D97706" }]}>Queued</Text>
                          </View>
                        )}
                        {row.status === "waiting_image" && (
                          <View style={[styles.statusPill, { backgroundColor: "rgba(239,68,68,0.10)" }]}>
                            <Ionicons name="camera-outline" size={12} color="#EF4444" />
                            <Text style={[styles.statusText, { color: "#EF4444" }]}>Proof</Text>
                          </View>
                        )}
                        <Pressable
                          onPress={() => handleClearRow(client.id)}
                          hitSlop={8}
                          style={[
                            styles.clearBtnGlass,
                            { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" },
                          ]}
                        >
                          <Ionicons name="refresh" size={14} color={colors.textMuted} />
                        </Pressable>
                      </View>
                    </View>

                    {/* Balances */}
                    <View style={styles.balancesContainer}>
                      <View
                        style={[
                          styles.balanceBadge,
                          {
                            backgroundColor: isDark ? "rgba(139,92,246,0.10)" : "#FAF5FF",
                            borderColor: isDark ? "rgba(139,92,246,0.18)" : "#E9D5FF",
                          },
                        ]}
                      >
                        <Text style={[styles.balBadgeLabel, { color: isDark ? "#C084FC" : "#7C3AED" }]}>Loan Bal</Text>
                        <Text style={[styles.balBadgeVal, { color: isDark ? "#DDD6FE" : "#6D28D9" }]}>{formatNaira(dynamicRem)}</Text>
                      </View>
                      <View
                        style={[
                          styles.balanceBadge,
                          {
                            backgroundColor: isDark ? "rgba(16,185,129,0.10)" : "#F0FDF4",
                            borderColor: isDark ? "rgba(16,185,129,0.18)" : "#BBF7D0",
                          },
                        ]}
                      >
                        <Text style={[styles.balBadgeLabel, { color: isDark ? "#34D399" : "#059669" }]}>Savings</Text>
                        <Text style={[styles.balBadgeVal, { color: isDark ? "#A7F3D0" : "#047857" }]}>{formatNaira(dynamicSav)}</Text>
                      </View>
                    </View>

                    {/* Loan Matrix */}
                    <View style={styles.fieldSection}>
                      <View style={styles.fieldSectionHeader}>
                        <Text style={[styles.sectionTitleLabel, { color: "#7C3AED" }]}>LOAN INSTALLMENT</Text>
                        {row.loanAmount > 0 && <Text style={styles.selectedAmtPreview}>+{formatNaira(row.loanAmount)}</Text>}
                      </View>
                      {loan ? (
                        <View style={styles.instPillSelector}>
                          <Pressable
                            disabled={isLoanLocked}
                            onPress={() => handleLoanChange(client.id, "")}
                            style={[
                              styles.instPillBtn,
                              {
                                backgroundColor: row.loanInstallments === "" ? "#7C3AED" : cardSurfaceBg,
                                borderColor: row.loanInstallments === "" ? "#7C3AED" : glassBorder,
                                opacity: isLoanLocked ? 0.4 : 1,
                              },
                            ]}
                          >
                            <Text style={[styles.instPillText, { color: row.loanInstallments === "" ? "#fff" : colors.text }]}>None</Text>
                          </Pressable>
                          {(() => {
                            const metrics = getLoanMetrics(loan);
                            const maxAllowedFinal = metrics?.maxAllowed ?? 2;
                            const effectiveMax = colSettingsReady ? maxAllowedFinal : Math.min(maxAllowedFinal, 2);
                            const maxPills = Math.min(effectiveMax, Math.max(1, effectiveMax));
                            const pillNumbers = Array.from({ length: maxPills }, (_, i) => String(i + 1));
                            return pillNumbers.map((val) => {
                              const count = Number(val);
                              const check = checkInstallmentOption(loan, count);
                              const isSelected = row.loanInstallments === val;
                              const isOptionDisabled = isLoanLocked || !check.enabled;
                              return (
                                <Pressable
                                  key={val}
                                  disabled={isOptionDisabled}
                                  onPress={() => handleLoanChange(client.id, isSelected ? "" : val)}
                                  style={[
                                    styles.instPillBtn,
                                    {
                                      backgroundColor: isSelected ? "#7C3AED" : cardSurfaceBg,
                                      borderColor: isSelected ? "#7C3AED" : glassBorder,
                                      opacity: isOptionDisabled ? 0.35 : 1,
                                    },
                                  ]}
                                >
                                  <Text style={[styles.instPillText, { color: isSelected ? "#fff" : colors.text }]}>
                                    {check.isPayAll ? `Pay All (${val})` : `${val}x`}
                                  </Text>
                                  {check.cost > 0 && (
                                    <Text
                                      style={[
                                        styles.instPillCost,
                                        { color: isSelected ? "rgba(255,255,255,0.85)" : colors.textMuted },
                                      ]}
                                    >
                                      {formatNaira(check.cost)}
                                    </Text>
                                  )}
                                </Pressable>
                              );
                            });
                          })()}
                        </View>
                      ) : (
                        <Text style={[styles.noLoanLabel, { color: colors.textMuted }]}>No active loan portfolio for this client</Text>
                      )}
                    </View>

                    {/* Savings Deposit */}
                    <View style={styles.fieldSection}>
                      <View style={styles.fieldSectionHeader}>
                        <Text style={[styles.sectionTitleLabel, { color: "#10B981" }]}>SAVINGS DEPOSIT</Text>
                        {Number(row.savingsAmount) > 0 && (
                          <Text style={[styles.selectedAmtPreview, { color: "#10B981" }]}>+{formatNaira(row.savingsAmount)}</Text>
                        )}
                      </View>
                      <View style={styles.savingsFieldWrap}>
                        <View
                          style={[
                            styles.nairaInputWrap,
                            { backgroundColor: cardSurfaceBg, borderColor: glassBorder, opacity: isColBlocked ? 0.4 : 1 },
                          ]}
                        >
                          <View style={[styles.nairaSignCircle, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
                            <Text style={styles.nairaSign}>{"\u20A6"}</Text>
                          </View>
                          <TextInput
                            value={row.savingsAmount}
                            onChangeText={(txt) => handleSavingsChange(client.id, txt)}
                            placeholder="0"
                            placeholderTextColor={colors.textMuted}
                            keyboardType="numeric"
                            editable={!isColBlocked}
                            style={[styles.mainInput, { color: colors.text }]}
                          />
                          {row.savingsAmount.length > 0 && (
                            <Pressable onPress={() => handleSavingsChange(client.id, "")} hitSlop={8}>
                              <Ionicons name="close-circle" size={17} color={colors.textMuted} />
                            </Pressable>
                          )}
                        </View>
                        <View style={styles.presetChipGrid}>
                          {SAVINGS_PRESETS.map((amt) => (
                            <Pressable
                              key={amt}
                              disabled={isColBlocked}
                              onPress={() => handleQuickAddSavings(client.id, amt)}
                              style={[
                                styles.quickPresetChip,
                                { backgroundColor: cardSurfaceBg, borderColor: glassBorder, opacity: isColBlocked ? 0.35 : 1 },
                              ]}
                            >
                              <Text style={[styles.quickPresetText, { color: colors.text }]}>+{amt >= 1000 ? `${amt / 1000}k` : amt}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    </View>

                    {/* Withdrawal Accordion */}
                    <View
                      style={[
                        styles.withdrawalAccordion,
                        { backgroundColor: cardSurfaceBg, borderColor: row.withdrawalType ? "rgba(239,68,68,0.25)" : glassBorder },
                      ]}
                    >
                      <Pressable
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.selectionAsync();
                          setExpandedWithdrawalClientId(isWithdrawalDrawerOpen ? null : client.id);
                        }}
                        style={styles.accordionHeader}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <View
                            style={[
                              styles.accordionIconBox,
                              { backgroundColor: row.withdrawalType ? "rgba(239,68,68,0.12)" : "rgba(100,116,139,0.10)" },
                            ]}
                          >
                            <Ionicons
                              name={!canOpenWithdrawalOptions ? "lock-closed" : row.withdrawalType ? "alert-circle" : "wallet-outline"}
                              size={14}
                              color={!canOpenWithdrawalOptions ? "#EF4444" : row.withdrawalType ? "#EF4444" : colors.textMuted}
                            />
                          </View>
                          <Text style={[styles.accordionTitle, { color: row.withdrawalType ? "#EF4444" : colors.textMuted }]}>
                            {!canOpenWithdrawalOptions
                              ? "Withdrawals (Admin Settings Required)"
                              : deviceOffline
                              ? row.withdrawalType
                                ? `Offline withdrawal: ${row.withdrawalType.toUpperCase()} (${formatNaira(row.withdrawalAmount)})`
                                : "Offline Withdrawal Options (Cash Disabled)"
                              : row.withdrawalType
                              ? `Withdrawal: ${row.withdrawalType.toUpperCase()} (${formatNaira(row.withdrawalAmount)})`
                              : "Withdrawal & Loan Settlement Options"}
                          </Text>
                        </View>
                        <Ionicons name={isWithdrawalDrawerOpen ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
                      </Pressable>

                      {isWithdrawalDrawerOpen && (
                        <View style={styles.accordionBody}>
                          {!canOpenWithdrawalOptions ? (
                            <View style={[styles.cashRuleBanner, { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.22)" }]}>
                              <Ionicons name="lock-closed" size={14} color="#EF4444" />
                              <Text style={styles.cashRuleBannerText}>
                                Cached admin withdrawal settings are required before offline deductions can be queued.
                              </Text>
                            </View>
                          ) : (
                            <>
                              <View style={styles.wthTypeRow}>
                                {(["", "cash", "withdrawal", "return"] as WithdrawalType[]).map((t) => {
                                  const isSelected = row.withdrawalType === t;
                                  const isBlocked =
                                    t !== "" &&
                                    (hasNoSavings ||
                                      !canUseWithdrawalType(t) ||
                                      isWthBlocked ||
                                      ((t === "withdrawal" || t === "return") && !loan) ||
                                      (t === "cash" && !cashEligibility.ok));
                                  return (
                                    <Pressable
                                      key={t}
                                      onPress={() => handleWithdrawalTypeChange(client.id, isSelected ? "" : t)}
                                      accessibilityRole="button"
                                      accessibilityHint={isBlocked ? "Tap to see why this withdrawal option is unavailable." : undefined}
                                      style={[
                                        styles.wthTypeChip,
                                        {
                                          backgroundColor: isSelected ? "#EF4444" : cardSurfaceBg,
                                          borderColor: isSelected ? "#EF4444" : glassBorder,
                                          opacity: isBlocked ? 0.35 : 1,
                                        },
                                      ]}
                                    >
                                      {isBlocked && <Ionicons name="lock-closed" size={11} color={colors.textMuted} />}
                                      <Text style={[styles.wthChipText, { color: isSelected ? "#fff" : colors.text }]}>
                                        {t === "" ? "None" : t.charAt(0).toUpperCase() + t.slice(1)}
                                      </Text>
                                    </Pressable>
                                  );
                                })}
                              </View>
                              {hasNoSavings && (
                                <View
                                  style={[
                                    styles.cashRuleBanner,
                                    {
                                      backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "#FFFBEB",
                                      borderColor: isDark ? "rgba(245,158,11,0.28)" : "#FDE68A",
                                    },
                                  ]}
                                >
                                  <Ionicons name="wallet-outline" size={16} color="#D97706" />
                                  <Text style={[styles.cashRuleBannerText, { color: isDark ? "#FCD34D" : "#92400E" }]}>
                                    No savings are available. Add a savings deposit above before selecting a withdrawal.
                                  </Text>
                                </View>
                              )}

                              {row.withdrawalType && (
                                <View style={{ gap: 10 }}>
                                  {row.withdrawalType === "cash" && (
                                    <>
                                      {!cashEligibility.ok && (
                                        <View
                                          style={[
                                            styles.cashRuleBanner,
                                            { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.18)" },
                                          ]}
                                        >
                                          <Ionicons name="information-circle" size={14} color="#EF4444" />
                                          <Text style={styles.cashRuleBannerText}>{cashEligibility.msg}</Text>
                                        </View>
                                      )}
                                      <View style={styles.wthInputRow}>
                                        <View
                                          style={[
                                            styles.wthAmountInputGlass,
                                            {
                                              backgroundColor: cardSurfaceBg,
                                              borderColor: glassBorder,
                                              flex: 1,
                                              flexDirection: "row",
                                              alignItems: "center",
                                              paddingHorizontal: 10,
                                            },
                                          ]}
                                        >
                                          <Text style={styles.nairaSign}>{"\u20A6"}</Text>
                                          <TextInput
                                            value={row.withdrawalAmount}
                                            onChangeText={(txt) => handleCashAmountChange(client.id, txt)}
                                            placeholder="Amount"
                                            placeholderTextColor={colors.textMuted}
                                            keyboardType="numeric"
                                            style={[styles.mainInput, { color: colors.text }]}
                                          />
                                        </View>
                                        <Pressable
                                          onPress={() => {
                                            setActivePhotoClientId(client.id);
                                            setPhotoPickerVisible(true);
                                          }}
                                          style={[
                                            styles.photoAttachBtn,
                                            { backgroundColor: row.proofImageUri ? "#10B981" : "#2563EB" },
                                          ]}
                                        >
                                          <Ionicons name={row.proofImageUri ? "checkmark" : "camera"} size={14} color="#fff" />
                                          <Text style={styles.photoAttachText}>{row.proofImageUri ? "Proof OK" : "Proof"}</Text>
                                        </Pressable>
                                      </View>
                                      <View style={styles.cashPresetRow}>
                                        {CASH_QUICK_PRESETS.map((amt) => (
                                          <Pressable
                                            key={amt}
                                            onPress={() => handleQuickAddCash(client.id, amt)}
                                            style={[styles.cashPresetChip, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}
                                          >
                                            <Text style={[styles.cashPresetText, { color: colors.text }]}>
                                              +{amt >= 1000 ? `${amt / 1000}k` : amt}
                                            </Text>
                                          </Pressable>
                                        ))}
                                        <Pressable
                                          onPress={() => handleSetMaxCash(client.id)}
                                          style={[styles.cashPresetChip, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}
                                        >
                                          <Text style={[styles.cashPresetText, { color: "#2563EB" }]}>MAX</Text>
                                        </Pressable>
                                      </View>
                                    </>
                                  )}
                                  {(row.withdrawalType === "withdrawal" || row.withdrawalType === "return") && (
                                    <View
                                      style={[
                                        styles.wthAmountInputGlass,
                                        {
                                          backgroundColor: cardSurfaceBg,
                                          borderColor: glassBorder,
                                          flexDirection: "row",
                                          alignItems: "center",
                                          paddingHorizontal: 10,
                                        },
                                      ]}
                                    >
                                      <Text style={styles.nairaSign}>{"\u20A6"}</Text>
                                      <TextInput
                                        value={row.withdrawalAmount}
                                        onChangeText={(txt) => handleCashAmountChange(client.id, txt)}
                                        placeholder="Withdrawal amount"
                                        placeholderTextColor={colors.textMuted}
                                        keyboardType="numeric"
                                        style={[styles.mainInput, { color: colors.text }]}
                                      />
                                    </View>
                                  )}
                                </View>
                              )}
                            </>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                );
              })
            ) : (
              /* ================= 2. TABLE VIEW ================= */
              <View style={[styles.tableContainer, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                <ScrollView horizontal showsHorizontalScrollIndicator={true} contentContainerStyle={{ flexDirection: "column" }}>
                  {/* Table Header Row */}
                  <View style={[styles.tableHeaderRow, { borderBottomColor: glassBorder }]}>
                    <View style={[styles.thCell, { width: 140 }]}>
                      <Text style={[styles.thText, { color: colors.textMuted }]}>CLIENT</Text>
                    </View>
                    <View style={[styles.thCell, { width: 110 }]}>
                      <Text style={[styles.thText, { color: colors.textMuted }]}>BALANCES</Text>
                    </View>
                    <View style={[styles.thCell, { width: 180 }]}>
                      <Text style={[styles.thText, { color: "#7C3AED" }]}>LOAN INST.</Text>
                    </View>
                    <View style={[styles.thCell, { width: 130 }]}>
                      <Text style={[styles.thText, { color: "#10B981" }]}>SAVINGS DEPOSIT</Text>
                    </View>
                    <View style={[styles.thCell, { width: 140 }]}>
                      <Text style={[styles.thText, { color: "#EF4444" }]}>WITHDRAWAL</Text>
                    </View>
                    <View style={[styles.thCell, { width: 80, alignItems: "center" }]}>
                      <Text style={[styles.thText, { color: colors.textMuted }]}>STATUS</Text>
                    </View>
                  </View>

                  {/* Table Body Rows */}
                  {filteredClients.map((client, idx) => {
                    const row = rowStates[client.id] || {
                      loanInstallments: "",
                      loanAmount: 0,
                      savingsAmount: "",
                      withdrawalType: "",
                      withdrawalAmount: "",
                      proofImageUri: null,
                      proofBase64: null,
                      status: "idle",
                    };
                    const loan = activeLoansMap.get(client.id) || activeLoansMap.get(String(client.id));
                    const curCash = Number(row.withdrawalAmount) || 0;
                    const dynamicRem = loan
                      ? (() => {
                          const base = Number(loan.remaining_balance) || 0;
                          const rowAmt = row.loanAmount || 0;
                          return Math.max(0, base - rowAmt);
                        })()
                      : 0;
                    const dynamicSav = (client.savings_balance || 0) + (Number(row.savingsAmount) || 0) - curCash;
                    const isLoanLocked = isColBlocked;
                    const isEven = idx % 2 === 0;

                    return (
                      <View
                        key={String(client.id)}
                        style={[
                          styles.tableRow,
                          {
                            backgroundColor: isEven ? "transparent" : isDark ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.015)",
                            borderBottomColor: glassBorder,
                          },
                        ]}
                      >
                        {/* 1. Client Col */}
                        <View style={[styles.tdCell, { width: 140 }]}>
                          <Text style={[styles.tableClientName, { color: colors.text }]} numberOfLines={1}>
                            {client.name}
                          </Text>
                          <Text style={[styles.tableClientMeta, { color: colors.textMuted }]} numberOfLines={1}>
                            {client.union || "General"}
                          </Text>
                        </View>

                        {/* 2. Balances Col */}
                        <View style={[styles.tdCell, { width: 110, gap: 2 }]}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Text style={styles.tableBalMiniLabel}>L:</Text>
                            <Text style={[styles.tableBalMiniVal, { color: "#7C3AED" }]}>{formatNaira(dynamicRem)}</Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                            <Text style={styles.tableBalMiniLabel}>S:</Text>
                            <Text style={[styles.tableBalMiniVal, { color: "#10B981" }]}>{formatNaira(dynamicSav)}</Text>
                          </View>
                        </View>

                        {/* 3. Loan Inst Col */}
                        <View style={[styles.tdCell, { width: 180, flexDirection: "row", gap: 4, alignItems: "center" }]}>
                          {loan ? (
                            <>
                              <Pressable
                                disabled={isLoanLocked}
                                onPress={() => handleLoanChange(client.id, "")}
                                style={[
                                  styles.tableInstBtn,
                                  {
                                    backgroundColor: row.loanInstallments === "" ? "#7C3AED" : "transparent",
                                    borderColor: row.loanInstallments === "" ? "#7C3AED" : glassBorder,
                                  },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.tableInstBtnText,
                                    { color: row.loanInstallments === "" ? "#fff" : colors.textMuted },
                                  ]}
                                >
                                  0
                                </Text>
                              </Pressable>
                              {(() => {
                                const metrics = getLoanMetrics(loan);
                                const maxAllowedFinal = metrics?.maxAllowed ?? 2;
                                const effectiveMax = colSettingsReady ? maxAllowedFinal : Math.min(maxAllowedFinal, 2);
                                const maxPills = Math.min(effectiveMax, Math.max(1, effectiveMax));
                                return Array.from({ length: maxPills }, (_, i) => String(i + 1)).map((val) => {
                                  const count = Number(val);
                                  const check = checkInstallmentOption(loan, count);
                                  const isSelected = row.loanInstallments === val;
                                  const isOptionDisabled = isLoanLocked || !check.enabled;
                                  return (
                                    <Pressable
                                      key={val}
                                      disabled={isOptionDisabled}
                                      onPress={() => handleLoanChange(client.id, isSelected ? "" : val)}
                                      style={[
                                        styles.tableInstBtn,
                                        {
                                          backgroundColor: isSelected ? "#7C3AED" : cardSurfaceBg,
                                          borderColor: isSelected ? "#7C3AED" : glassBorder,
                                          opacity: isOptionDisabled ? 0.35 : 1,
                                        },
                                      ]}
                                    >
                                      <Text style={[styles.tableInstBtnText, { color: isSelected ? "#fff" : colors.text }]}>
                                        {val}x
                                      </Text>
                                    </Pressable>
                                  );
                                });
                              })()}
                              {row.loanAmount > 0 && (
                                <Text style={[styles.tableAmtTag, { color: "#7C3AED" }]}>{formatNaira(row.loanAmount)}</Text>
                              )}
                            </>
                          ) : (
                            <Text style={[styles.tableBalMiniLabel, { color: colors.textMuted, fontStyle: "italic" }]}>No Loan</Text>
                          )}
                        </View>

                        {/* 4. Savings Deposit Col */}
                        <View style={[styles.tdCell, { width: 130, justifyContent: "center" }]}>
                          <View
                            style={[
                              styles.tableInputWrap,
                              { backgroundColor: cardSurfaceBg, borderColor: glassBorder, opacity: isColBlocked ? 0.4 : 1 },
                            ]}
                          >
                            <Text style={styles.tableNairaMini}>{"\u20A6"}</Text>
                            <TextInput
                              value={row.savingsAmount}
                              onChangeText={(txt) => handleSavingsChange(client.id, txt)}
                              placeholder="0"
                              placeholderTextColor={colors.textMuted}
                              keyboardType="numeric"
                              editable={!isColBlocked}
                              style={[styles.tableInput, { color: colors.text }]}
                            />
                            {row.savingsAmount.length > 0 && (
                              <Pressable onPress={() => handleSavingsChange(client.id, "")} hitSlop={6}>
                                <Ionicons name="close-circle" size={14} color={colors.textMuted} />
                              </Pressable>
                            )}
                          </View>
                        </View>

                        {/* 5. Withdrawal Col */}
                        <View style={[styles.tdCell, { width: 140, justifyContent: "center" }]}>
                          <Pressable
                            onPress={() => {
                              if (!canOpenWithdrawalOptions) {
                                Alert.alert(
                                  "Withdrawal Options Unavailable",
                                  "Connect to the server or load cached admin withdrawal settings before selecting a withdrawal."
                                );
                                return;
                              }
                              setTableWithdrawalClientId(client.id);
                            }}
                            style={[
                              styles.tableWthActionBtn,
                              {
                                backgroundColor: !canOpenWithdrawalOptions ? "rgba(239,68,68,0.06)" : row.withdrawalType ? "rgba(239,68,68,0.12)" : "transparent",
                                borderColor: !canOpenWithdrawalOptions ? "rgba(239,68,68,0.2)" : row.withdrawalType ? "#EF4444" : glassBorder,
                              },
                            ]}
                          >
                            <Ionicons
                              name={!canOpenWithdrawalOptions ? "lock-closed" : row.withdrawalType ? "wallet" : "add-circle-outline"}
                              size={13}
                              color={!canOpenWithdrawalOptions ? "#EF4444" : row.withdrawalType ? "#EF4444" : colors.textMuted}
                            />
                            <Text
                              style={[
                                styles.tableWthActionText,
                                { color: !canOpenWithdrawalOptions ? "#EF4444" : row.withdrawalType ? "#EF4444" : colors.textMuted },
                              ]}
                              numberOfLines={1}
                            >
                              {!canOpenWithdrawalOptions
                                ? "Locked"
                                : deviceOffline && row.withdrawalType
                                ? `OFFLINE: ${row.withdrawalType.toUpperCase()}`
                                : deviceOffline
                                ? "Offline"
                                : row.withdrawalType
                                ? `${row.withdrawalType.toUpperCase()}: ${formatNaira(row.withdrawalAmount || 0)}`
                                : "Option"}
                            </Text>
                          </Pressable>
                        </View>

                        {/* 6. Status / Reset Col */}
                        <View style={[styles.tdCell, { width: 80, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }]}>
                          {row.status === "saving" && <ActivityIndicator size="small" color={colors.primary} />}
                          {row.status === "saved" && <Ionicons name="checkmark-circle" size={16} color="#10B981" />}
                          {row.status === "pending" && <Ionicons name="time" size={15} color="#D97706" />}
                          {row.status === "waiting_image" && <Ionicons name="camera" size={15} color="#EF4444" />}
                          <Pressable onPress={() => handleClearRow(client.id)} hitSlop={6}>
                            <Ionicons name="refresh-outline" size={15} color={colors.textMuted} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            )}

            {/* Daily Transactions Log */}
            <View style={styles.dailyTransactionsSection}>
              <View style={styles.dailyTransHeaderRow}>
                <View>
                  <Text style={[styles.dailyTransTitle, { color: colors.text }]}>Today's Transactions Log</Text>
                  <Text style={[styles.dailyTransSub, { color: colors.textMuted }]}>{dailyTransactionsList.length} records aggregated</Text>
                </View>
                <Pressable
                  onPress={() => setShowSummarySheet(true)}
                  style={[styles.transLogBadge, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}
                >
                  <Text style={[styles.transLogBadgeText, { color: colors.textMuted }]}>VIEW ALL</Text>
                </Pressable>
              </View>

              {dailyTransactionsList.length === 0 ? (
                <View style={[styles.emptyTransCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                    <Ionicons name="receipt-outline" size={20} color={colors.textMuted} />
                  </View>
                  <Text style={[styles.emptyTransText, { color: colors.textMuted }]}>
                    No collections recorded yet - entries appear here instantly
                  </Text>
                </View>
              ) : (
                dailyTransactionsList.map((tr, idx) => (
                  <Pressable
                    key={idx}
                    onPress={() => setSelectedReceipt(tr)}
                    style={[styles.transCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}
                  >
                    <View style={styles.transLeftIcon}>
                      <Ionicons name="person" size={16} color="#10B981" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.transClientName, { color: colors.text }]}>{tr.client_name}</Text>
                      <Text style={[styles.transUnionMeta, { color: colors.textMuted }]}>
                        {tr.union} | {tr.time}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 2 }}>
                      {tr.loan_amount > 0 && <Text style={[styles.transAmtLoan, { color: "#7C3AED" }]}>+{formatNaira(tr.loan_amount)}</Text>}
                      {tr.savings_amount > 0 && <Text style={[styles.transAmtSav, { color: "#10B981" }]}>+{formatNaira(tr.savings_amount)}</Text>}
                      {tr.withdrawal_amount > 0 && <Text style={[styles.transAmtWth, { color: "#EF4444" }]}>-{formatNaira(tr.withdrawal_amount)}</Text>}
                    </View>
                  </Pressable>
                ))
              )}
            </View>
          </View>
        </Animated.ScrollView>

        {/* Footer Summary */}
        <LinearGradient
          colors={isDark ? ["rgba(30,41,59,0.97)", "rgba(15,23,42,1)"] : ["rgba(255,255,255,0.98)", "rgba(248,250,252,1)"]}
          style={[styles.stickyFooterBar, { borderColor: glassBorder }]}
        >
          <View style={styles.footerSingleRow}>
            <View style={styles.footerSingleRowLeft}>
              <View
                style={[
                  styles.footerNetIcon,
                  { backgroundColor: totals.net >= 0 ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)" },
                ]}
              >
                <Ionicons
                  name={totals.net >= 0 ? "wallet" : "trending-down"}
                  size={12}
                  color={totals.net >= 0 ? "#10B981" : "#EF4444"}
                />
              </View>
              <Text style={[styles.footerTitle, { color: colors.textMuted }]} numberOfLines={1}>
                NET CASH
              </Text>
              <Text style={[styles.footerNetVal, { color: colors.text }]} numberOfLines={1}>
                {formatNaira(totals.net)}
              </Text>
              <View style={styles.footerDotSep} />
              <Text style={[styles.footerMiniVal, { color: "#7C3AED" }]} numberOfLines={1}>
                {formatNaira(totals.loanTotal)}
              </Text>
              <Text style={styles.footerMiniPlus}>+</Text>
              <Text style={[styles.footerMiniVal, { color: "#10B981" }]} numberOfLines={1}>
                {formatNaira(totals.savingsTotal)}
              </Text>
              {totals.withdrawalTotal > 0 && (
                <>
                  <Text style={styles.footerMiniPlus}>-</Text>
                  <Text style={[styles.footerMiniVal, { color: "#EF4444" }]} numberOfLines={1}>
                    {formatNaira(totals.withdrawalTotal)}
                  </Text>
                </>
              )}
            </View>
            <Pressable onPress={() => setShowSummarySheet(true)} style={[styles.footerReconcileChip, { backgroundColor: colors.primary }]}>
              <Ionicons name="receipt-outline" size={11} color="#fff" />
              <Text style={styles.footerReconcileText}>View</Text>
            </Pressable>
          </View>
        </LinearGradient>

        {/* Quick Withdrawal Modal for Table View */}
        <Modal
          visible={Boolean(tableWithdrawalClientId)}
          transparent
          animationType="slide"
          onRequestClose={() => setTableWithdrawalClientId(null)}
        >
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setTableWithdrawalClientId(null)} />
            {(() => {
              if (!tableWithdrawalClientId) return null;
              const client = clients.find((c) => String(c.id) === String(tableWithdrawalClientId));
              if (!client) return null;
              const row = rowStates[client.id] || {
                loanInstallments: "",
                loanAmount: 0,
                savingsAmount: "",
                withdrawalType: "",
                withdrawalAmount: "",
                proofImageUri: null,
                proofBase64: null,
                status: "idle",
              };
              const loan = activeLoansMap.get(client.id) || activeLoansMap.get(String(client.id));
              const cashEligibility = validateCashWithdrawalRule(client, 0, true);
              const hasNoSavings =
                Number(client.savings_balance || 0) + (Number(row.savingsAmount) || 0) <= 0;

              return (
                <LinearGradient
                  colors={isDark ? ["rgba(30,41,59,0.96)", "rgba(15,23,42,1)"] : ["#FFFFFF", "#F8FAFC"]}
                  style={[styles.summarySheetCard, { borderColor: glassBorder }]}
                >
                  <View style={styles.sheetHandle} />
                  <Text style={[styles.summarySheetTitle, { color: colors.text }]}>Withdrawal Options</Text>
                  <Text style={[styles.summarySheetSub, { color: colors.textMuted }]}>
                    {client.name} | Total Savings: {formatNaira((client.savings_balance || 0) + (Number(row.savingsAmount) || 0))}
                  </Text>

                  <View style={{ gap: 12, marginTop: 4 }}>
                    <View style={styles.wthTypeRow}>
                      {(["", "cash", "withdrawal", "return"] as WithdrawalType[]).map((t) => {
                        const isSelected = row.withdrawalType === t;
                        const isBlocked =
                          t !== "" &&
                          (hasNoSavings ||
                            !canUseWithdrawalType(t) ||
                            isWthBlocked ||
                            ((t === "withdrawal" || t === "return") && !loan) ||
                            (t === "cash" && !cashEligibility.ok));
                        return (
                          <Pressable
                            key={t}
                            onPress={() => handleWithdrawalTypeChange(client.id, isSelected ? "" : t)}
                            accessibilityRole="button"
                            accessibilityHint={isBlocked ? "Tap to see why this withdrawal option is unavailable." : undefined}
                            style={[
                              styles.wthTypeChip,
                              {
                                backgroundColor: isSelected ? "#EF4444" : cardSurfaceBg,
                                borderColor: isSelected ? "#EF4444" : glassBorder,
                                opacity: isBlocked ? 0.35 : 1,
                              },
                            ]}
                          >
                            {isBlocked && <Ionicons name="lock-closed" size={11} color={colors.textMuted} />}
                            <Text style={[styles.wthChipText, { color: isSelected ? "#fff" : colors.text }]}>
                              {t === "" ? "None" : t.charAt(0).toUpperCase() + t.slice(1)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {hasNoSavings && (
                      <View
                        style={[
                          styles.cashRuleBanner,
                          {
                            backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "#FFFBEB",
                            borderColor: isDark ? "rgba(245,158,11,0.28)" : "#FDE68A",
                          },
                        ]}
                      >
                        <Ionicons name="wallet-outline" size={16} color="#D97706" />
                        <Text style={[styles.cashRuleBannerText, { color: isDark ? "#FCD34D" : "#92400E" }]}>
                          No savings are available. Add a savings deposit above before selecting a withdrawal.
                        </Text>
                      </View>
                    )}

                    {row.withdrawalType === "cash" && (
                      <>
                        {!cashEligibility.ok && (
                          <View
                            style={[
                              styles.cashRuleBanner,
                              { backgroundColor: "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.18)" },
                            ]}
                          >
                            <Ionicons name="information-circle" size={14} color="#EF4444" />
                            <Text style={styles.cashRuleBannerText}>{cashEligibility.msg}</Text>
                          </View>
                        )}
                        <View style={styles.wthInputRow}>
                          <View
                            style={[
                              styles.wthAmountInputGlass,
                              {
                                backgroundColor: cardSurfaceBg,
                                borderColor: glassBorder,
                                flex: 1,
                                flexDirection: "row",
                                alignItems: "center",
                                paddingHorizontal: 10,
                              },
                            ]}
                          >
                            <Text style={styles.nairaSign}>{"\u20A6"}</Text>
                            <TextInput
                              value={row.withdrawalAmount}
                              onChangeText={(txt) => handleCashAmountChange(client.id, txt)}
                              placeholder="Amount"
                              placeholderTextColor={colors.textMuted}
                              keyboardType="numeric"
                              style={[styles.mainInput, { color: colors.text }]}
                            />
                          </View>
                          <Pressable
                            onPress={() => {
                              setActivePhotoClientId(client.id);
                              setPhotoPickerVisible(true);
                            }}
                            style={[
                              styles.photoAttachBtn,
                              { backgroundColor: row.proofImageUri ? "#10B981" : "#2563EB" },
                            ]}
                          >
                            <Ionicons name={row.proofImageUri ? "checkmark" : "camera"} size={14} color="#fff" />
                            <Text style={styles.photoAttachText}>{row.proofImageUri ? "Proof OK" : "Proof"}</Text>
                          </Pressable>
                        </View>
                        <View style={styles.cashPresetRow}>
                          {CASH_QUICK_PRESETS.map((amt) => (
                            <Pressable
                              key={amt}
                              onPress={() => handleQuickAddCash(client.id, amt)}
                              style={[styles.cashPresetChip, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}
                            >
                              <Text style={[styles.cashPresetText, { color: colors.text }]}>
                                +{amt >= 1000 ? `${amt / 1000}k` : amt}
                              </Text>
                            </Pressable>
                          ))}
                          <Pressable
                            onPress={() => handleSetMaxCash(client.id)}
                            style={[styles.cashPresetChip, { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE" }]}
                          >
                            <Text style={[styles.cashPresetText, { color: "#2563EB" }]}>MAX</Text>
                          </Pressable>
                        </View>
                      </>
                    )}

                    {(row.withdrawalType === "withdrawal" || row.withdrawalType === "return") && (
                      <View
                        style={[
                          styles.wthAmountInputGlass,
                          {
                            backgroundColor: cardSurfaceBg,
                            borderColor: glassBorder,
                            flexDirection: "row",
                            alignItems: "center",
                            paddingHorizontal: 10,
                          },
                        ]}
                      >
                        <Text style={styles.nairaSign}>{"\u20A6"}</Text>
                        <TextInput
                          value={row.withdrawalAmount}
                          onChangeText={(txt) => handleCashAmountChange(client.id, txt)}
                          placeholder="Withdrawal amount"
                          placeholderTextColor={colors.textMuted}
                          keyboardType="numeric"
                          style={[styles.mainInput, { color: colors.text }]}
                        />
                      </View>
                    )}
                  </View>

                  <Pressable
                    onPress={() => setTableWithdrawalClientId(null)}
                    style={[styles.closeSummaryBtn, { backgroundColor: colors.primary, marginTop: 16 }]}
                  >
                    <Text style={styles.closeSummaryBtnText}>Done</Text>
                  </Pressable>
                </LinearGradient>
              );
            })()}
          </View>
        </Modal>

        {/* Summary Sheet */}
        <Modal visible={showSummarySheet} transparent animationType="slide" onRequestClose={() => setShowSummarySheet(false)}>
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowSummarySheet(false)} />
            <LinearGradient
              colors={isDark ? ["rgba(30,41,59,0.96)", "rgba(15,23,42,1)"] : ["#FFFFFF", "#F8FAFC"]}
              style={[styles.summarySheetCard, { borderColor: glassBorder }]}
            >
              <View style={styles.sheetHandle} />
              <Text style={[styles.summarySheetTitle, { color: colors.text }]}>Daily Reconciliation</Text>
              <Text style={[styles.summarySheetSub, { color: colors.textMuted }]}>
                {formatDateDisplay(activeDate)} | {branchName || "Main Branch"} | {selectedUnion || "All Unions"}
              </Text>

              <View style={[styles.reconciliationTable, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                <View style={styles.reconcileRow}>
                  <Text style={[styles.rLabel, { color: colors.textMuted }]}>Borrowers Count</Text>
                  <Text style={[styles.rVal, { color: colors.text }]}>
                    {totals.collectedCount} of {baseUnionClients.length} clients
                  </Text>
                </View>
                <View style={styles.reconcileRow}>
                  <Text style={[styles.rLabel, { color: colors.textMuted }]}>Total Loan Repayments</Text>
                  <Text style={[styles.rVal, { color: "#7C3AED" }]}>+{formatNaira(totals.loanTotal)}</Text>
                </View>
                <View style={styles.reconcileRow}>
                  <Text style={[styles.rLabel, { color: colors.textMuted }]}>Total Savings In</Text>
                  <Text style={[styles.rVal, { color: "#10B981" }]}>+{formatNaira(totals.savingsTotal)}</Text>
                </View>
                <View style={styles.reconcileRow}>
                  <Text style={[styles.rLabel, { color: colors.textMuted }]}>Total Withdrawals Out</Text>
                  <Text style={[styles.rVal, { color: "#EF4444" }]}>-{formatNaira(totals.withdrawalTotal)}</Text>
                </View>
                <View
                  style={[
                    styles.reconcileRow,
                    { borderTopWidth: 1, borderTopColor: glassBorder, paddingTop: 10, marginTop: 4 },
                  ]}
                >
                  <Text style={[styles.rLabel, { color: colors.text, fontWeight: "700", fontSize: 12 }]}>Net Physical Cash</Text>
                  <Text style={[styles.rVal, { color: "#10B981", fontWeight: "800", fontSize: 14 }]} numberOfLines={1}>
                    {formatNaira(totals.net)}
                  </Text>
                </View>
              </View>

              <Pressable onPress={() => setShowSummarySheet(false)} style={[styles.closeSummaryBtn, { backgroundColor: colors.primary }]}>
                <Text style={styles.closeSummaryBtnText}>Done</Text>
              </Pressable>
            </LinearGradient>
          </View>
        </Modal>

        {/* Receipt Slip Modal */}
        <Modal visible={Boolean(selectedReceipt)} transparent animationType="fade" onRequestClose={() => setSelectedReceipt(null)}>
          <View style={styles.modalOverlay}>
            <LinearGradient
              colors={isDark ? ["rgba(30,41,59,0.96)", "rgba(15,23,42,1)"] : ["#FFFFFF", "#F8FAFC"]}
              style={[styles.receiptCard, { borderColor: glassBorder }]}
            >
              <View style={styles.receiptTopCircle}>
                <Ionicons name="receipt" size={24} color="#2563EB" />
              </View>
              <Text style={[styles.receiptHeading, { color: colors.text }]}>Collection Slip</Text>
              <Text style={[styles.receiptSubHeading, { color: colors.textMuted }]}>{formatDateDisplay(activeDate)}</Text>

              {selectedReceipt && (
                <View style={[styles.receiptSlip, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                  <View style={styles.receiptSlipRow}>
                    <Text style={[styles.rLabel, { color: colors.textMuted }]}>Borrower</Text>
                    <Text style={[styles.rVal, { color: colors.text }]}>{selectedReceipt.client_name}</Text>
                  </View>
                  <View style={styles.receiptSlipRow}>
                    <Text style={[styles.rLabel, { color: colors.textMuted }]}>Union / Center</Text>
                    <Text style={[styles.rVal, { color: colors.text }]}>{selectedReceipt.union}</Text>
                  </View>
                  {selectedReceipt.loan_amount > 0 && (
                    <View style={styles.receiptSlipRow}>
                      <Text style={[styles.rLabel, { color: colors.textMuted }]}>Loan Repayment</Text>
                      <Text style={[styles.rVal, { color: "#7C3AED", fontWeight: "700" }]}>+{formatNaira(selectedReceipt.loan_amount)}</Text>
                    </View>
                  )}
                  {selectedReceipt.savings_amount > 0 && (
                    <View style={styles.receiptSlipRow}>
                      <Text style={[styles.rLabel, { color: colors.textMuted }]}>Savings Deposit</Text>
                      <Text style={[styles.rVal, { color: "#10B981", fontWeight: "700" }]}>+{formatNaira(selectedReceipt.savings_amount)}</Text>
                    </View>
                  )}
                  {selectedReceipt.withdrawal_amount > 0 && (
                    <View style={styles.receiptSlipRow}>
                      <Text style={[styles.rLabel, { color: colors.textMuted }]}>Withdrawal ({selectedReceipt.withdrawal_type.toUpperCase()})</Text>
                      <Text style={[styles.rVal, { color: "#EF4444", fontWeight: "700" }]}>-{formatNaira(selectedReceipt.withdrawal_amount)}</Text>
                    </View>
                  )}
                  <View style={[styles.receiptSlipRow, { borderTopWidth: 1, borderTopColor: glassBorder, paddingTop: 8 }]}>
                    <Text style={[styles.rLabel, { color: colors.text, fontWeight: "700" }]}>Total Inflow</Text>
                    <Text style={[styles.rVal, { color: "#10B981", fontWeight: "800", fontSize: 15 }]}>
                      {formatNaira(selectedReceipt.loan_amount + selectedReceipt.savings_amount - selectedReceipt.withdrawal_amount)}
                    </Text>
                  </View>
                </View>
              )}

              <Pressable
                onPress={() => setSelectedReceipt(null)}
                style={[styles.closeSummaryBtn, { backgroundColor: colors.primary, width: "100%" }]}
              >
                <Text style={styles.closeSummaryBtnText}>Dismiss</Text>
              </Pressable>
            </LinearGradient>
          </View>
        </Modal>

        {/* Photo Picker Modal */}
        <Modal visible={photoPickerVisible} transparent animationType="fade" onRequestClose={() => setPhotoPickerVisible(false)}>
          <Pressable style={styles.modalOverlay} onPress={() => setPhotoPickerVisible(false)}>
            <LinearGradient
              colors={isDark ? ["rgba(30,41,59,0.96)", "rgba(15,23,42,1)"] : ["#FFFFFF", "#F8FAFC"]}
              style={[styles.photoModalCard, { borderColor: glassBorder }]}
            >
              <View style={styles.photoModalHead}>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    backgroundColor: "rgba(37,99,235,0.12)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="camera" size={24} color="#2563EB" />
                </View>
                <Text style={[styles.photoModalTitle, { color: colors.text }]}>Payment Verification</Text>
                <Text style={[styles.photoModalSub, { color: colors.textMuted }]}>Upload disbursement receipt or counterfoil photo</Text>
              </View>

              <View style={{ gap: 10, marginTop: 8 }}>
                <Pressable onPress={() => pickProofPhoto(true)} style={[styles.modalActionBtn, { backgroundColor: colors.primary }]}>
                  <Ionicons name="camera" size={17} color="#fff" />
                  <Text style={styles.modalActionBtnText}>Take Live Photo</Text>
                </Pressable>

                <Pressable
                  onPress={() => pickProofPhoto(false)}
                  style={[styles.modalActionBtn, { backgroundColor: cardSurfaceBg, borderWidth: 1, borderColor: glassBorder }]}
                >
                  <Ionicons name="image-outline" size={17} color={colors.text} />
                  <Text style={[styles.modalActionBtnText, { color: colors.text }]}>Choose From Gallery</Text>
                </Pressable>

                <Pressable onPress={() => setPhotoPickerVisible(false)} style={styles.modalCancelBtn}>
                  <Text style={[styles.modalCancelText, { color: colors.textMuted }]}>Cancel</Text>
                </Pressable>
              </View>
            </LinearGradient>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    marginBottom: 4,
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  heroHeaderBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroTagPill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, gap: 6 },
  statusPulseDot: { width: 6, height: 6, borderRadius: 3 },
  heroTagText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  badgeCountPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 14 },
  syncTimeText: { fontSize: 10.5, fontWeight: "600" },
  heroMainBalanceSection: { marginTop: 14, marginBottom: 12 },
  heroBalanceLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1.0 },
  heroAmountRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  heroMainAmount: { fontSize: 28, fontWeight: "900", letterSpacing: -0.6 },
  heroSubText: { fontSize: 11, marginTop: 4 },
  netPill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  netPillText: { fontSize: 10, fontWeight: "700" },

  heroMetricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: 4 },
  metricGridItem: { width: "48.5%", borderRadius: 16, paddingHorizontal: 12, paddingVertical: 12, borderWidth: 0 },
  metricItemHeader: { flexDirection: "row", alignItems: "center", gap: 6 },
  metricIconCircle: { width: 22, height: 22, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  metricItemLabel: { fontSize: 10, fontWeight: "600" },
  metricItemValue: { fontSize: 14, fontWeight: "800", marginTop: 4 },
  metricItemSub: { fontSize: 9.5, marginTop: 1, fontWeight: "500" },

  heroDateNavRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    padding: 8,
    borderRadius: 14,
    borderWidth: 1,
  },
  heroDateCenter: { fontSize: 12.5, fontWeight: "700" },

  topControlGlassRow: { paddingTop: 12, paddingBottom: 12, paddingHorizontal: 0, backgroundColor: "transparent", zIndex: 10 },
  unionScroll: { paddingHorizontal: 16, gap: 10, alignItems: "center", flexDirection: "row" },
  unionChipGlass: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
  },
  unionChipText: { fontSize: 12, fontWeight: "700" },
  unionCountPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, minWidth: 20, alignItems: "center" },
  unionCountText: { fontSize: 10, fontWeight: "700" },

  warningBanner: {
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  warningBannerText: { fontSize: 12, fontWeight: "600", flex: 1 },
  fridayShortcutBtn: { backgroundColor: "#D97706", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  fridayShortcutText: { color: "#fff", fontSize: 11, fontWeight: "700" },

  progressStatusBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 14,
  },
  progressInfo: { flexDirection: "row", alignItems: "center", gap: 8 },
  progressIconBox: { width: 28, height: 28, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  progressCounter: { fontSize: 13, fontWeight: "800" },
  progressSubLabel: { fontSize: 11.5 },
  progressPill: { backgroundColor: "rgba(16,185,129,0.12)", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  progressPctText: { fontSize: 11, fontWeight: "800", color: "#10B981" },

  viewModeToggleWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 2,
    borderWidth: 1,
  },
  viewModeBtn: {
    width: 28,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  reconcileActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  reconcileActionText: { fontSize: 11, fontWeight: "700" },

  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 11, fontWeight: "700" },

  cardsFeed: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 30, gap: 14 },
  skeletonLine: { borderRadius: 6 },

  emptyBox: { padding: 36, borderRadius: 20, borderWidth: 1, alignItems: "center", gap: 8, marginTop: 8 },
  emptyIconCircle: { width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 15, fontWeight: "800" },
  emptySub: { fontSize: 12, textAlign: "center", lineHeight: 18 },

  /* Card View Styles */
  clientCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 14,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },
  cardAccentLine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 3,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  cardHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  avatarBox: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarText: { fontSize: 14, fontWeight: "800" },
  clientName: { fontSize: 14.5, fontWeight: "800" },
  clientSub: { fontSize: 11.5, marginTop: 1 },
  miniUnionPill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  miniUnionText: { fontSize: 9.5, fontWeight: "700" },

  balancesContainer: { flexDirection: "row", gap: 10 },
  balanceBadge: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  balBadgeLabel: { fontSize: 10.5, fontWeight: "600" },
  balBadgeVal: { fontSize: 12.5, fontWeight: "800" },

  cardRightControls: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  statusText: { fontSize: 10.5, fontWeight: "700" },
  pulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#D97706" },
  clearBtnGlass: { width: 26, height: 26, borderRadius: 10, alignItems: "center", justifyContent: "center" },

  fieldSection: { gap: 8 },
  fieldSectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sectionTitleLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },
  selectedAmtPreview: { fontSize: 12, fontWeight: "800", color: "#7C3AED" },

  instPillSelector: { flexDirection: "row", gap: 8 },
  instPillBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  instPillText: { fontSize: 12.5, fontWeight: "800" },
  instPillCost: { fontSize: 9.5, marginTop: 2, fontWeight: "600" },
  noLoanLabel: { fontSize: 12, fontStyle: "italic", marginTop: 2 },

  savingsFieldWrap: { gap: 10 },
  nairaInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 48,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  nairaSignCircle: { width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", marginRight: 8 },
  nairaSign: { fontSize: 14, fontWeight: "800", color: "#10B981" },
  mainInput: { flex: 1, fontSize: 15, fontWeight: "700", height: "100%" },
  presetChipGrid: { flexDirection: "row", gap: 8 },
  quickPresetChip: { flex: 1, height: 36, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  quickPresetText: { fontSize: 12, fontWeight: "700" },

  withdrawalAccordion: { borderRadius: 16, borderWidth: 1, padding: 12 },
  accordionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 32 },
  accordionIconBox: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  accordionTitle: { fontSize: 12, fontWeight: "700" },
  accordionBody: { marginTop: 12, gap: 12 },
  wthTypeRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  wthTypeChip: { flexDirection: "row", gap: 5, paddingHorizontal: 12, height: 36, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  wthChipText: { fontSize: 11.5, fontWeight: "700" },
  wthInputRow: { flexDirection: "row", gap: 8 },
  wthAmountInputGlass: { height: 44, borderRadius: 12, borderWidth: 1 },
  photoAttachBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, borderRadius: 12, height: 44 },
  photoAttachText: { color: "#fff", fontSize: 12, fontWeight: "700" },

  cashRuleBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  cashRuleBannerText: { fontSize: 11, color: "#EF4444", flex: 1, lineHeight: 14 },

  cashPresetRow: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  cashPresetChip: { paddingHorizontal: 12, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cashPresetText: { fontSize: 11.5, fontWeight: "700" },

  /* ================= TABLE VIEW STYLES ================= */
  tableContainer: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  tableHeaderRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
  },
  thCell: {
    paddingHorizontal: 6,
    justifyContent: "center",
  },
  thText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    minHeight: 52,
  },
  tdCell: {
    paddingHorizontal: 6,
  },
  tableClientName: {
    fontSize: 12.5,
    fontWeight: "800",
  },
  tableClientMeta: {
    fontSize: 10.5,
    marginTop: 1,
  },
  tableBalMiniLabel: {
    fontSize: 10,
    fontWeight: "600",
    color: "#94A3B8",
  },
  tableBalMiniVal: {
    fontSize: 11,
    fontWeight: "800",
  },
  tableInstBtn: {
    minWidth: 26,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
  },
  tableInstBtnText: {
    fontSize: 11,
    fontWeight: "800",
  },
  tableAmtTag: {
    fontSize: 10,
    fontWeight: "800",
    marginLeft: 2,
  },
  tableInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 6,
  },
  tableNairaMini: {
    fontSize: 11,
    fontWeight: "800",
    color: "#10B981",
    marginRight: 4,
  },
  tableInput: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    padding: 0,
    height: "100%",
  },
  tableWthActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 8,
  },
  tableWthActionText: {
    fontSize: 10.5,
    fontWeight: "700",
  },

  /* Transactions Log */
  dailyTransactionsSection: { marginTop: 8, gap: 10 },
  dailyTransHeaderRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dailyTransTitle: { fontSize: 15, fontWeight: "800" },
  dailyTransSub: { fontSize: 11.5, marginTop: 2 },
  transLogBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  transLogBadgeText: { fontSize: 9.5, fontWeight: "700", letterSpacing: 0.5 },
  emptyTransCard: { padding: 24, borderRadius: 16, borderWidth: 1, alignItems: "center", gap: 8 },
  emptyTransText: { fontSize: 12, textAlign: "center" },
  transCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: 16, borderWidth: 1 },
  transLeftIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(16,185,129,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  transClientName: { fontSize: 13.5, fontWeight: "800" },
  transUnionMeta: { fontSize: 11, marginTop: 2 },
  transAmtLoan: { fontSize: 12, fontWeight: "700" },
  transAmtSav: { fontSize: 12, fontWeight: "700" },
  transAmtWth: { fontSize: 12, fontWeight: "700" },

  stickyFooterBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 10,
    paddingBottom: Platform.OS === "ios" ? 20 : 10,
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  footerSingleRow: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  footerSingleRowLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "nowrap" },
  footerNetIcon: { width: 22, height: 22, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  footerTitle: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.7 },
  footerNetVal: { fontSize: 14, fontWeight: "900", letterSpacing: -0.3 },
  footerDotSep: { width: 3, height: 3, borderRadius: 1.5, backgroundColor: "#CBD5E1", marginHorizontal: 2 },
  footerMiniVal: { fontSize: 10, fontWeight: "700" },
  footerMiniPlus: { fontSize: 9, fontWeight: "600", color: "#94A3B8" },
  footerReconcileChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 12,
  },
  footerReconcileText: { color: "#fff", fontSize: 10, fontWeight: "700" },

  toastBox: {
    position: "absolute",
    top: Platform.OS === "ios" ? 54 : 36,
    alignSelf: "center",
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    zIndex: 9999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
  },
  toastText: { fontSize: 13, fontWeight: "700" },

  warningModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 22,
  },
  warningModalCard: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 24,
    elevation: 18,
  },
  warningIconCircle: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: "rgba(245,158,11,0.14)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  warningModalTitle: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  warningModalMessage: { fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 8 },
  warningModalHint: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
  },
  warningModalHintText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: "600" },
  warningModalButton: {
    width: "100%",
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  warningModalButtonText: { color: "#fff", fontSize: 14, fontWeight: "800" },

  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  summarySheetCard: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 14,
    paddingBottom: 32,
    gap: 10,
  },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 10 },
  summarySheetTitle: { fontSize: 18, fontWeight: "800" },
  summarySheetSub: { fontSize: 12, marginBottom: 8 },
  reconciliationTable: { borderRadius: 14, borderWidth: 1, padding: 12, gap: 8 },
  reconcileRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rLabel: { fontSize: 12.5, fontWeight: "500" },
  rVal: { fontSize: 13, fontWeight: "700" },
  closeSummaryBtn: { height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", marginTop: 8 },
  closeSummaryBtnText: { color: "#fff", fontSize: 14, fontWeight: "700" },

  receiptCard: {
    width: "90%",
    alignSelf: "center",
    marginVertical: "auto",
    borderRadius: 24,
    borderWidth: 1,
    padding: 22,
    alignItems: "center",
  },
  receiptTopCircle: {
    width: 52,
    height: 52,
    borderRadius: 16,
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  receiptHeading: { fontSize: 17, fontWeight: "800" },
  receiptSubHeading: { fontSize: 12, textAlign: "center", marginTop: 2 },
  receiptSlip: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 16, gap: 10, marginVertical: 16 },
  receiptSlipRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },

  photoModalCard: { borderRadius: 24, borderWidth: 1, padding: 22, margin: 20, marginBottom: Platform.OS === "ios" ? 40 : 20 },
  photoModalHead: { alignItems: "center", gap: 6, marginBottom: 12 },
  photoModalTitle: { fontSize: 17, fontWeight: "800" },
  photoModalSub: { fontSize: 12, textAlign: "center", lineHeight: 16 },
  modalActionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", height: 48, borderRadius: 14, gap: 8 },
  modalActionBtnText: { color: "#fff", fontSize: 13.5, fontWeight: "700" },
  modalCancelBtn: { height: 40, alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: 13, fontWeight: "600" },

  dayShiftBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, height: 34, borderRadius: 10, borderWidth: 1, gap: 4 },
  dayShiftText: { fontSize: 12, fontWeight: "600" },
  todayBtn: { paddingHorizontal: 14, height: 34, borderRadius: 10, backgroundColor: "#2563EB", justifyContent: "center", alignItems: "center" },
  todayBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
