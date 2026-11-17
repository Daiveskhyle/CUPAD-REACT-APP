// app/co/reports.tsx - Premium Executive Edition (Clean Filter UX + Offline SQLite Analytics)
import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  Linking,
  Image,
  Dimensions,
  Animated,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getDb,
  isOnline,
  loadCachedClients,
  loadCachedUnions,
  cacheClients,
  loadOfflineWorkspace,
} from "../../src/db/database";
import {
  fetchUnionsForOfficer,
  bootstrapCoScreenData,
  buildUnionReportsFromClients,
  mergeUnionNames,
} from "../../src/db/offlineHelpers";
import { hydrateOfflineCache } from "../../src/db/sync";
import axios from "axios";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";

const { width } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_REPORTS = `${API_BASE}/api/reports_api.php`;
const CACHE_KEY_REPORTS = "cupad_cache_co_reports";
const CACHE_KEY_PRIVACY = "cupad_cache_privacy_hide_amounts";
const CACHE_KEY_OFFICER_NAME = "cupad_cache_officer_full_name";

type PresetType = "today" | "week" | "month" | "last_month" | "custom";
type ClientFilterStatus = "all" | "overdue" | "active_loan" | "paid_off" | "closed";
type SortField =
  | "name"
  | "clients"
  | "total_savings"
  | "withdrawals"
  | "cash_payouts"
  | "net_savings"
  | "disbursements"
  | "collections"
  | "registrations"
  | "paid_off"
  | "overdue_count";

type ReportMetrics = {
  total_clients: number;
  total_savings: number;
  total_withdrawals: number;
  total_cash: number;
  net_savings: number;
  total_disbursements: number;
  total_collections: number;
  collection_rate: number;
  par_ratio: number;
  active_loans: number;
  total_outstanding: number;
  total_overdue: number;
  total_service_charges: number;
  total_registrations: number;
  total_reg_fees: number;
};

type UnionReportRow = {
  name: string;
  clients: number;
  total_savings: number;
  withdrawals: number;
  cash_payouts: number;
  net_savings: number;
  disbursements: number;
  collections: number;
  registrations: number;
  registrations_amount: number;
  paid_off: number;
  overdue_count: number;
  activity_badge: "High" | "Med" | "Low";
};

type TotalsSummary = {
  clients: number;
  deposits: number;
  withdrawals: number;
  cash_payouts: number;
  net_savings: number;
  disbursements: number;
  collections: number;
  registrations: number;
  paid_off: number;
  overdue: number;
};

type ClientDrilldownItem = {
  id: string | number;
  name: string;
  phone?: string;
  status: string;
  savings_balance: number;
  loan_outstanding: number;
  is_fully_paid: boolean;
  days_overdue: number;
  range_savings: number;
  range_withdrawals: number;
  range_cash: number;
  range_collected: number;
  range_disbursed: number;
};

type RegistrationItem = {
  client_id: string | number;
  client_name: string;
  union: string;
  amount: number;
  date: string;
};

/** Robust numeric parser handling formatted strings like "₦25,000.00" or "15,000" */
function parseNumeric(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  if (typeof val === "string") {
    const cleaned = val.replace(/[^0-9.-]/g, "");
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function formatNaira(amount: number | string, hide = false): string {
  if (hide) return "••••••••";
  const num = parseNumeric(amount);
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function getProfilePicUrl(pic?: string, picUrl?: string): string | null {
  if (picUrl) return picUrl;
  if (!pic || pic.includes("default_avatar")) return null;
  if (pic.startsWith("http")) return pic;
  const clean = pic.replace(/^\/+/, "");
  return `${API_BASE}/${clean}`;
}

function isGenericOfficerString(val?: string | null): boolean {
  if (!val) return true;
  const lower = val.trim().toLowerCase();
  return (
    lower === "credit officer" ||
    lower === "credit_officer" ||
    lower === "officer" ||
    lower === "null" ||
    lower === "undefined" ||
    lower === "co" ||
    lower === "admin"
  );
}

/** Comprehensive mapper converting backend union breakdown data to normalized format */
function normalizeUnionRow(u: any): UnionReportRow {
  const name = String(
    u.name ||
    u.union ||
    u.union_name ||
    u.unionName ||
    u.title ||
    u.group_name ||
    "Unnamed Union"
  ).trim();

  const clients = parseNumeric(
    u.clients ??
    u.clients_count ??
    u.client_count ??
    u.total_clients ??
    u.members ??
    u.total_members ??
    u.members_count
  );

  const total_savings = parseNumeric(
    u.total_savings ??
    u.deposits ??
    u.deposit ??
    u.total_deposits ??
    u.total_deposit ??
    u.savings ??
    u.savings_amount ??
    u.savings_collected ??
    u.range_savings ??
    u.total_saved
  );

  const withdrawals = parseNumeric(
    u.withdrawals ??
    u.deductions ??
    u.reductions ??
    u.reduction ??
    u.total_withdrawals ??
    u.total_deductions ??
    u.total_reductions ??
    u.deduction ??
    u.withdrawal ??
    u.range_withdrawals ??
    u.total_reduced
  );

  const cash_payouts = parseNumeric(
    u.cash_payouts ??
    u.cash_out ??
    u.cash ??
    u.total_cash ??
    u.cash_payout ??
    u.cash_withdrawals ??
    u.payouts ??
    u.range_cash ??
    u.total_cash_out
  );

  let net_savings = parseNumeric(u.net_savings ?? u.net ?? u.net_deposit ?? u.net_balance);
  if (net_savings === 0 && (total_savings !== 0 || withdrawals !== 0 || cash_payouts !== 0)) {
    net_savings = total_savings - (withdrawals + cash_payouts);
  }

  const disbursements = parseNumeric(
    u.disbursements ??
    u.disbursed ??
    u.total_disbursements ??
    u.total_disbursed ??
    u.disbursement ??
    u.loans_disbursed ??
    u.total_loan_disbursed ??
    u.principal ??
    u.principal_amount ??
    u.range_disbursed
  );

  const collections = parseNumeric(
    u.collections ??
    u.collected ??
    u.total_collections ??
    u.total_collected ??
    u.repayments ??
    u.total_repayments ??
    u.repayment ??
    u.loan_collections ??
    u.loan_repayments ??
    u.range_collected
  );

  const registrations = parseNumeric(
    u.registrations ??
    u.registrations_count ??
    u.reg_count ??
    u.regs ??
    u.total_registrations ??
    u.enrolled ??
    u.new_clients
  );

  const registrations_amount = parseNumeric(
    u.registrations_amount ??
    u.registrations_total ??
    u.reg_fees ??
    u.total_reg_fees ??
    u.reg_fee ??
    u.registration_amount
  );

  const paid_off = parseNumeric(
    u.paid_off ??
    u.paid_off_count ??
    u.paid_loans ??
    u.fully_paid ??
    u.cleared
  );

  const overdue_count = parseNumeric(
    u.overdue_count ??
    u.overdue ??
    u.total_overdue ??
    u.overdue_clients ??
    u.overdues
  );

  let activity_badge: "High" | "Med" | "Low" = "Low";
  if (u.activity_badge === "High" || u.activity_badge === "Med" || u.activity_badge === "Low") {
    activity_badge = u.activity_badge;
  } else {
    const totalActivity = collections + total_savings;
    if (totalActivity > 50000) activity_badge = "High";
    else if (totalActivity > 10000) activity_badge = "Med";
  }

  return {
    name,
    clients,
    total_savings,
    withdrawals,
    cash_payouts,
    net_savings,
    disbursements,
    collections,
    registrations,
    registrations_amount,
    paid_off,
    overdue_count,
    activity_badge,
  };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];
const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function getDateBounds(preset: PresetType, customFrom = "", customTo = ""): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const toYMD = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();

  if (preset === "today") {
    const today = toYMD(now);
    return { from: today, to: today };
  }
  if (preset === "week") {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    return { from: toYMD(monday), to: toYMD(new Date()) };
  }
  if (preset === "last_month") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: toYMD(first), to: toYMD(last) };
  }
  if (preset === "custom" && customFrom && customTo) {
    return { from: customFrom, to: customTo };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toYMD(first), to: toYMD(now) };
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

// --- RANGE DATE PICKER MODAL ---
function DateRangePickerModal({
  visible,
  fromDate,
  toDate,
  onClose,
  onApplyRange,
}: {
  visible: boolean;
  fromDate: string;
  toDate: string;
  onClose: () => void;
  onApplyRange: (from: string, to: string) => void;
}) {
  const { colors, isDark } = useTheme();

  const parseToDateObj = (str: string) => {
    if (str && /^\d{4}-\d{2}-\d{2}$/.test(str)) {
      const [y, m, d] = str.split("-").map(Number);
      return new Date(y, m - 1, d);
    }
    return new Date();
  };

  const [activeStep, setActiveStep] = useState<"from" | "to">("from");
  const [tempFrom, setTempFrom] = useState(fromDate);
  const [tempTo, setTempTo] = useState(toDate);

  const initialViewDate = useMemo(() => parseToDateObj(fromDate || toDate), [fromDate, toDate]);
  const [viewYear, setViewYear] = useState(initialViewDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(initialViewDate.getMonth());

  useEffect(() => {
    setTempFrom(fromDate);
    setTempTo(toDate);
    const d = parseToDateObj(fromDate || toDate);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  }, [fromDate, toDate, visible]);

  const daysInMonth = useMemo(() => new Date(viewYear, viewMonth + 1, 0).getDate(), [viewYear, viewMonth]);
  const firstDayOfWeek = useMemo(() => new Date(viewYear, viewMonth, 1).getDay(), [viewYear, viewMonth]);

  const handlePrevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const formatYMD = (y: number, m: number, d: number) => {
    const mm = String(m + 1).padStart(2, "0");
    const dd = String(d).padStart(2, "0");
    return `${y}-${mm}-${dd}`;
  };

  const handleDayPress = (day: number) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    const dateStr = formatYMD(viewYear, viewMonth, day);

    if (activeStep === "from") {
      setTempFrom(dateStr);
      if (tempTo && dateStr > tempTo) {
        setTempTo(dateStr);
      }
      setActiveStep("to");
    } else {
      if (tempFrom && dateStr < tempFrom) {
        setTempFrom(dateStr);
        setTempTo(tempFrom);
      } else {
        setTempTo(dateStr);
      }
      setActiveStep("from");
    }
  };

  const handlePresetSelect = (preset: "today" | "week" | "month" | "last_month") => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const bounds = getDateBounds(preset);
    setTempFrom(bounds.from);
    setTempTo(bounds.to);
    const d = parseToDateObj(bounds.from);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const handleConfirm = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onApplyRange(tempFrom, tempTo);
    onClose();
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.calCardSheet, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.calModalHead}>
            <View>
              <Text style={[styles.calModalTitle, { color: colors.text }]}>Filter Date Range</Text>
              <Text style={[styles.calModalSub, { color: colors.textMuted }]}>
                Select start & end date to filter reports
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.calCloseBtn}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={[styles.rangeTabsBox, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F1F5F9", borderColor: colors.cardBorder }]}>
            <Pressable
              onPress={() => setActiveStep("from")}
              style={[styles.rangeTabItem, activeStep === "from" && { backgroundColor: "#3B82F6" }]}
            >
              <Text style={[styles.rangeTabLabel, { color: activeStep === "from" ? "#BFDBFE" : colors.textMuted }]}>FROM</Text>
              <Text style={[styles.rangeTabValue, { color: activeStep === "from" ? "#fff" : colors.text }]}>
                {tempFrom || "Start Date"}
              </Text>
            </Pressable>

            <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />

            <Pressable
              onPress={() => setActiveStep("to")}
              style={[styles.rangeTabItem, activeStep === "to" && { backgroundColor: "#3B82F6" }]}
            >
              <Text style={[styles.rangeTabLabel, { color: activeStep === "to" ? "#BFDBFE" : colors.textMuted }]}>TO</Text>
              <Text style={[styles.rangeTabValue, { color: activeStep === "to" ? "#fff" : colors.text }]}>
                {tempTo || "End Date"}
              </Text>
            </Pressable>
          </View>

          <View style={styles.presetQuickRow}>
            {(["today", "week", "month", "last_month"] as const).map((p) => {
              const label = p === "today" ? "Today" : p === "week" ? "This Week" : p === "month" ? "This Month" : "Last Month";
              return (
                <Pressable
                  key={p}
                  onPress={() => handlePresetSelect(p)}
                  style={[styles.quickPresetChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F8FAFC", borderColor: colors.cardBorder }]}
                >
                  <Text style={[styles.quickPresetText, { color: colors.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.calNavRow}>
            <Pressable onPress={handlePrevMonth} style={styles.calNavBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={18} color={colors.text} />
            </Pressable>
            <Text style={[styles.calNavMonthText, { color: colors.text }]}>
              {MONTH_NAMES[viewMonth]} {viewYear}
            </Text>
            <Pressable onPress={handleNextMonth} style={styles.calNavBtn} hitSlop={8}>
              <Ionicons name="chevron-forward" size={18} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.calWeekRow}>
            {DAY_LABELS.map((d, i) => (
              <Text key={`weekday-${i}`} style={[styles.calWeekText, { color: colors.textMuted }]}>{d}</Text>
            ))}
          </View>

          <View style={styles.calGrid}>
            {Array.from({ length: firstDayOfWeek }).map((_, i) => (
              <View key={`empty-${i}`} style={styles.calDayBox} />
            ))}
            {Array.from({ length: daysInMonth }).map((_, i) => {
              const day = i + 1;
              const dateStr = formatYMD(viewYear, viewMonth, day);
              const isFrom = dateStr === tempFrom;
              const isTo = dateStr === tempTo;
              const isInRange = tempFrom && tempTo && dateStr > tempFrom && dateStr < tempTo;

              return (
                <View
                  key={`day-wrap-${day}`}
                  style={[
                    styles.calDayBox,
                    isInRange && { backgroundColor: isDark ? "#1E3A8A33" : "#DBEAFE" },
                    isFrom && tempTo && tempFrom !== tempTo && styles.calRangeStartTrack,
                    isTo && tempFrom && tempFrom !== tempTo && styles.calRangeEndTrack,
                  ]}
                >
                  <Pressable
                    onPress={() => handleDayPress(day)}
                    style={[styles.calDayCircle, (isFrom || isTo) && { backgroundColor: "#3B82F6" }]}
                  >
                    <Text
                      style={[
                        styles.calDayText,
                        { color: (isFrom || isTo) ? "#fff" : colors.text },
                        (isFrom || isTo) && { fontWeight: "900" },
                      ]}
                    >
                      {day}
                    </Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <Pressable onPress={handleConfirm} style={styles.calApplyBtn}>
            <LinearGradient
              colors={["#3B82F6", "#2563EB"]}
              style={styles.calApplyGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="checkmark-done" size={16} color="#fff" />
              <Text style={styles.calApplyBtnText}>Apply Filter Range</Text>
            </LinearGradient>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export default function ReportsScreen() {
  const { colors, isDark } = useTheme();

  // Glassmorphic System Colors
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.09)";
  const orbColor2 = isDark ? "rgba(14, 165, 233, 0.13)" : "rgba(14, 165, 233, 0.07)";

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Officer Profile Credentials
  const [officerUsername, setOfficerUsername] = useState("");
  const [officerFullName, setOfficerFullName] = useState("");
  const [branchName, setBranchName] = useState("My Branch");
  const [profilePicUrl, setProfilePicUrl] = useState<string | null>(null);
  const [hideBalances, setHideBalances] = useState(false);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Range and filter controls
  const [preset, setPreset] = useState<PresetType>("month");
  const [dateRange, setDateRange] = useState({ from: "", to: "" });
  const [rangePickerVisible, setRangePickerVisible] = useState(false);

  // Sorting
  const [sortField, setSortField] = useState<SortField>("net_savings");
  const [sortAsc, setSortAsc] = useState(false);

  // Union Filtering: Default to hiding unions with 0 records
  const [hideEmptyUnions, setHideEmptyUnions] = useState(true);

  const [metrics, setMetrics] = useState<ReportMetrics>({
    total_clients: 0,
    total_savings: 0,
    total_withdrawals: 0,
    total_cash: 0,
    net_savings: 0,
    total_disbursements: 0,
    total_collections: 0,
    collection_rate: 0,
    par_ratio: 0,
    active_loans: 0,
    total_outstanding: 0,
    total_overdue: 0,
    total_service_charges: 0,
    total_registrations: 0,
    total_reg_fees: 0,
  });

  const [portfolioMix, setPortfolioMix] = useState({ savings: 0, disbursements: 0, collections: 0 });
  const [unionReports, setUnionReports] = useState<UnionReportRow[]>([]);
  const [totalsSummary, setTotalsSummary] = useState<TotalsSummary | null>(null);
  const [unionSearch, setUnionSearch] = useState("");

  // Drilldown states
  const [drilldownVisible, setDrilldownVisible] = useState(false);
  const [selectedUnionName, setSelectedUnionName] = useState("");
  const [drilldownClients, setDrilldownClients] = useState<ClientDrilldownItem[]>([]);
  const [drilldownSearch, setDrilldownSearch] = useState("");
  const [clientFilterStatus, setClientFilterStatus] = useState<ClientFilterStatus>("all");
  const [drilldownLoading, setDrilldownLoading] = useState(false);

  // Single Client Action State
  const [selectedClientDetail, setSelectedClientDetail] = useState<ClientDrilldownItem | null>(null);

  // Registrations Modal State
  const [regModalVisible, setRegModalVisible] = useState(false);
  const [regModalTitle, setRegModalTitle] = useState("All Registrations");
  const [regModalList, setRegModalList] = useState<RegistrationItem[]>([]);
  const [regModalLoading, setRegModalLoading] = useState(false);

  const triggerHaptic = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
    if (Platform.OS !== "web") Haptics.impactAsync(style);
  };

  const toggleHideBalances = async () => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    const next = !hideBalances;
    setHideBalances(next);
    await AsyncStorage.setItem(CACHE_KEY_PRIVACY, String(next));
  };

  // Helper to determine if a union has actual records/activity
  const unionHasRecords = useCallback((u: UnionReportRow): boolean => {
    const hasActivity =
      Math.abs(u.total_savings) > 0 ||
      Math.abs(u.withdrawals) > 0 ||
      Math.abs(u.cash_payouts) > 0 ||
      Math.abs(u.disbursements) > 0 ||
      Math.abs(u.collections) > 0 ||
      Math.abs(u.registrations) > 0 ||
      Math.abs(u.registrations_amount) > 0 ||
      (u.overdue_count || 0) > 0 ||
      (u.paid_off || 0) > 0;

    return hasActivity || u.clients > 0;
  }, []);

  /**
   * COMPUTE ANALYTICS DIRECTLY FROM LOCAL SQLITE TABLES IN OFFLINE MODE
   */
  const computeAnalyticsFromSqlite = useCallback(
    async (activeUser: string, fromDate: string, toDate: string) => {
      try {
        const db = await getDb();
        const boot = await bootstrapCoScreenData(activeUser);
        const clientsList = boot?.clients || [];

        const clientUnionMap = new Map<string | number, string>();
        clientsList.forEach((c: any) => {
          const id = c.id || c.client_id;
          const u = c.union || c.union_name || "Unassigned";
          clientUnionMap.set(String(id), u);
        });

        // 1. Fetch Savings Transactions from SQLite
        let rawSavings: any[] = [];
        try {
          rawSavings = await db.getAllAsync(
            `SELECT * FROM savings WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [fromDate, toDate]
          );
        } catch {
          try {
            rawSavings = await db.getAllAsync(
              `SELECT * FROM savings_collections WHERE substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ?`,
              [fromDate, toDate]
            );
          } catch {}
        }

        // 2. Fetch Collections / Repayments from SQLite
        let rawCollections: any[] = [];
        try {
          rawCollections = await db.getAllAsync(
            `SELECT * FROM collections WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [fromDate, toDate]
          );
        } catch {
          try {
            rawCollections = await db.getAllAsync(
              `SELECT * FROM loan_collections WHERE substr(date, 1, 10) >= ? AND substr(date, 1, 10) <= ?`,
              [fromDate, toDate]
            );
          } catch {}
        }

        // 3. Fetch Withdrawals from SQLite
        let rawWithdrawals: any[] = [];
        try {
          rawWithdrawals = await db.getAllAsync(
            `SELECT * FROM withdrawals WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [fromDate, toDate]
          );
        } catch {}

        // 4. Fetch Disbursements from SQLite
        let rawDisbursements: any[] = [];
        try {
          rawDisbursements = await db.getAllAsync(
            `SELECT * FROM disbursements WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [fromDate, toDate]
          );
        } catch {}

        // 5. Read Pending Queue for freshly created offline items
        try {
          const pendingItems: any[] = await db.getAllAsync(
            `SELECT type, data, created_at FROM sync_queue WHERE synced = 0`
          );
          pendingItems.forEach((row) => {
            try {
              const d = JSON.parse(row.data);
              const txDate = (row.created_at || d.date || "").slice(0, 10);
              if (txDate && txDate >= fromDate && txDate <= toDate) {
                if (row.type === "savings") rawSavings.push(d);
                else if (row.type === "repayment") rawCollections.push(d);
                else if (row.type === "withdrawal") rawWithdrawals.push(d);
                else if (row.type === "disbursement") rawDisbursements.push(d);
              }
            } catch {}
          });
        } catch {}

        // If no transaction records found, build directly from clients using offline helper
        if (rawSavings.length === 0 && rawCollections.length === 0 && clientsList.length > 0) {
          try {
            const built = buildUnionReportsFromClients(clientsList);
            if (Array.isArray(built) && built.length > 0) {
              setUnionReports(built.map(normalizeUnionRow));
              return;
            }
          } catch {}
        }

        type UnionStatsAcc = {
          clients: Set<string | number>;
          deposits: number;
          withdrawals: number;
          cash_payouts: number;
          disbursements: number;
          collections: number;
          registrations: number;
          paid_off: number;
          overdue: number;
        };
        const unionStatsMap = new Map<string, UnionStatsAcc>();

        const getUnionAcc = (uName: string): UnionStatsAcc => {
          const key = uName.trim() || "Unassigned";
          if (!unionStatsMap.has(key)) {
            unionStatsMap.set(key, {
              clients: new Set(),
              deposits: 0,
              withdrawals: 0,
              cash_payouts: 0,
              disbursements: 0,
              collections: 0,
              registrations: 0,
              paid_off: 0,
              overdue: 0,
            });
          }
          return unionStatsMap.get(key)!;
        };

        clientsList.forEach((c: any) => {
          const cid = c.id || c.client_id;
          const u = c.union || c.union_name || "Unassigned";
          const acc = getUnionAcc(u);
          acc.clients.add(cid);

          const loanBal = parseNumeric(c.outstanding_loan ?? c.loan_balance);
          if (c.is_fully_paid || (c.has_had_loan && loanBal <= 0.01)) {
            acc.paid_off += 1;
          }
          if (c.days_overdue > 0 || c.is_overdue) {
            acc.overdue += 1;
          }
        });

        let totalSavings = 0;
        rawSavings.forEach((s: any) => {
          const amt = parseNumeric(s.amount ?? s.amount_collected);
          const cid = s.client_id || s.clientId;
          const u = s.union || clientUnionMap.get(String(cid)) || "Unassigned";
          getUnionAcc(u).deposits += amt;
          totalSavings += amt;
        });

        let totalWithdrawals = 0;
        let totalCash = 0;
        rawWithdrawals.forEach((w: any) => {
          const amt = parseNumeric(w.amount);
          const cid = w.client_id || w.clientId;
          const u = w.union || clientUnionMap.get(String(cid)) || "Unassigned";
          const acc = getUnionAcc(u);
          if (w.type === "cash") {
            acc.cash_payouts += amt;
            totalCash += amt;
          } else {
            acc.withdrawals += amt;
            totalWithdrawals += amt;
          }
        });

        let totalCollections = 0;
        rawCollections.forEach((col: any) => {
          const amt = parseNumeric(col.amount ?? col.amount_collected);
          const cid = col.client_id || col.clientId;
          const u = col.union || clientUnionMap.get(String(cid)) || "Unassigned";
          getUnionAcc(u).collections += amt;
          totalCollections += amt;
        });

        let totalDisbursements = 0;
        rawDisbursements.forEach((disb: any) => {
          const amt = parseNumeric(disb.principal_amount ?? disb.principal ?? disb.amount);
          const cid = disb.client_id || disb.clientId;
          const u = disb.union || clientUnionMap.get(String(cid)) || "Unassigned";
          getUnionAcc(u).disbursements += amt;
          totalDisbursements += amt;
        });

        let totalOutstanding = 0;
        let activeLoansCount = 0;
        let overdueCount = 0;
        clientsList.forEach((c: any) => {
          const l = parseNumeric(c.outstanding_loan ?? c.loan_balance);
          if (l > 0.01) {
            totalOutstanding += l;
            activeLoansCount++;
          }
          if (c.days_overdue > 0) overdueCount++;
        });

        const netSavings = totalSavings - (totalWithdrawals + totalCash);
        const collectionRate = totalDisbursements > 0
          ? Math.min(100, Math.round((totalCollections / totalDisbursements) * 100))
          : totalCollections > 0 ? 100 : 0;
        const parRatio = totalOutstanding > 0
          ? Number(((overdueCount / Math.max(1, activeLoansCount)) * 100).toFixed(1))
          : 0;

        const normalizedUnions: UnionReportRow[] = Array.from(unionStatsMap.entries()).map(([uName, acc]) => {
          const net = acc.deposits - (acc.withdrawals + acc.cash_payouts);
          const activityBadge: "High" | "Med" | "Low" =
            acc.collections + acc.deposits > 50000 ? "High" : acc.collections + acc.deposits > 10000 ? "Med" : "Low";
          return {
            name: uName,
            clients: acc.clients.size,
            total_savings: acc.deposits,
            withdrawals: acc.withdrawals,
            cash_payouts: acc.cash_payouts,
            net_savings: net,
            disbursements: acc.disbursements,
            collections: acc.collections,
            registrations: acc.registrations,
            registrations_amount: 0,
            paid_off: acc.paid_off,
            overdue_count: acc.overdue,
            activity_badge: activityBadge,
          };
        });

        setUnionReports(normalizedUnions);

        setMetrics({
          total_clients: clientsList.length,
          total_savings: totalSavings,
          total_withdrawals: totalWithdrawals,
          total_cash: totalCash,
          net_savings: netSavings,
          total_disbursements: totalDisbursements,
          total_collections: totalCollections,
          collection_rate: collectionRate,
          par_ratio: parRatio,
          active_loans: activeLoansCount,
          total_outstanding: totalOutstanding,
          total_overdue: overdueCount,
          total_service_charges: Math.round(totalDisbursements * 0.15),
          total_registrations: 0,
          total_reg_fees: 0,
        });

        setPortfolioMix({
          savings: Math.max(0, totalSavings),
          disbursements: totalDisbursements,
          collections: totalCollections,
        });

        setTotalsSummary({
          clients: clientsList.length,
          deposits: totalSavings,
          withdrawals: totalWithdrawals,
          cash_payouts: totalCash,
          net_savings: netSavings,
          disbursements: totalDisbursements,
          collections: totalCollections,
          registrations: 0,
          paid_off: 0,
          overdue: overdueCount,
        });
      } catch (e) {
        console.log("Offline SQLite analytics computation notice:", e);
      }
    },
    []
  );

  const fetchReportData = useCallback(
    async (
      selectedPreset: PresetType = preset,
      isRefresh = false,
      usernameOverride?: string,
      customRangeOverride?: { from: string; to: string }
    ) => {
      const activeUser = usernameOverride || officerUsername;
      if (!activeUser) return;
      if (!isRefresh) setLoading(true);

      const bounds = customRangeOverride || getDateBounds(selectedPreset, dateRange.from, dateRange.to);
      setDateRange(bounds);

      const online = await isOnline().catch(() => false);
      if (!online) {
        await computeAnalyticsFromSqlite(activeUser, bounds.from, bounds.to);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const customQuery = `&date_from=${encodeURIComponent(bounds.from)}&date_to=${encodeURIComponent(bounds.to)}`;

      try {
        const res = await axios.get(
          `${API_REPORTS}?action=summary&username=${encodeURIComponent(activeUser)}&preset=${selectedPreset}${customQuery}`,
          { timeout: 12000 }
        );

        if (res.data?.success) {
          if (res.data.branch_name && typeof res.data.branch_name === "string" && res.data.branch_name.trim()) {
            setBranchName(res.data.branch_name);
          }

          const apiOfficerName = (
            res.data.officer_full_name ||
            res.data.officer_name ||
            res.data.full_name ||
            res.data.name ||
            ""
          ).trim();

          if (apiOfficerName && !isGenericOfficerString(apiOfficerName)) {
            setOfficerFullName(apiOfficerName);
            AsyncStorage.setItem(CACHE_KEY_OFFICER_NAME, apiOfficerName).catch(() => {});
          }

          if (res.data.metrics) {
            setMetrics({
              total_clients: parseNumeric(res.data.metrics.total_clients),
              total_savings: parseNumeric(res.data.metrics.total_savings ?? res.data.metrics.deposits),
              total_withdrawals: parseNumeric(res.data.metrics.total_withdrawals ?? res.data.metrics.deductions),
              total_cash: parseNumeric(res.data.metrics.total_cash ?? res.data.metrics.cash_out),
              net_savings: parseNumeric(res.data.metrics.net_savings),
              total_disbursements: parseNumeric(res.data.metrics.total_disbursements ?? res.data.metrics.disbursed),
              total_collections: parseNumeric(res.data.metrics.total_collections ?? res.data.metrics.collected),
              collection_rate: parseNumeric(res.data.metrics.collection_rate),
              par_ratio: parseNumeric(res.data.metrics.par_ratio),
              active_loans: parseNumeric(res.data.metrics.active_loans),
              total_outstanding: parseNumeric(res.data.metrics.total_outstanding),
              total_overdue: parseNumeric(res.data.metrics.total_overdue),
              total_service_charges: parseNumeric(res.data.metrics.total_service_charges),
              total_registrations: parseNumeric(res.data.metrics.total_registrations),
              total_reg_fees: parseNumeric(res.data.metrics.total_reg_fees),
            });
          }

          if (res.data.portfolio_mix) {
            setPortfolioMix({
              savings: parseNumeric(res.data.portfolio_mix.savings),
              disbursements: parseNumeric(res.data.portfolio_mix.disbursements),
              collections: parseNumeric(res.data.portfolio_mix.collections),
            });
          }

          // Inspect every conceivable union breakdown key from backend
          const rawUnionsData =
            res.data.union_breakdown ||
            res.data.union_breakdowns ||
            res.data.union_table ||
            res.data.unions ||
            res.data.union_reports ||
            res.data.unions_data ||
            res.data.unions_summary ||
            res.data.breakdown ||
            res.data.data?.union_breakdown ||
            res.data.data?.union_breakdowns ||
            res.data.data?.union_table ||
            res.data.data?.unions ||
            res.data.data?.breakdown ||
            [];

          let rawUnionsList: any[] = [];
          if (Array.isArray(rawUnionsData)) {
            rawUnionsList = rawUnionsData;
          } else if (rawUnionsData && typeof rawUnionsData === "object") {
            rawUnionsList = Object.entries(rawUnionsData).map(([key, val]: [string, any]) => {
              if (typeof val === "object" && val !== null) {
                return { union_name: key, ...val };
              }
              return { union_name: key };
            });
          }

          // If union breakdown is empty but clients are returned, build directly from clients
          if (rawUnionsList.length === 0 && Array.isArray(res.data.clients) && res.data.clients.length > 0) {
            try {
              const built = buildUnionReportsFromClients(res.data.clients);
              if (Array.isArray(built) && built.length > 0) {
                rawUnionsList = built;
              }
            } catch {}
          }

          const normalizedUnions: UnionReportRow[] = rawUnionsList.map(normalizeUnionRow);
          setUnionReports(normalizedUnions);

          if (res.data.totals_summary) {
            setTotalsSummary({
              clients: parseNumeric(res.data.totals_summary.clients),
              deposits: parseNumeric(res.data.totals_summary.deposits ?? res.data.totals_summary.total_savings),
              withdrawals: parseNumeric(res.data.totals_summary.withdrawals ?? res.data.totals_summary.deductions),
              cash_payouts: parseNumeric(res.data.totals_summary.cash_payouts ?? res.data.totals_summary.cash_out),
              net_savings: parseNumeric(res.data.totals_summary.net_savings),
              disbursements: parseNumeric(res.data.totals_summary.disbursements ?? res.data.totals_summary.disbursed),
              collections: parseNumeric(res.data.totals_summary.collections ?? res.data.totals_summary.collected),
              registrations: parseNumeric(res.data.totals_summary.registrations),
              paid_off: parseNumeric(res.data.totals_summary.paid_off),
              overdue: parseNumeric(res.data.totals_summary.overdue ?? res.data.totals_summary.overdue_count),
            });
          } else {
            setTotalsSummary(null);
          }

          await AsyncStorage.setItem(CACHE_KEY_REPORTS, JSON.stringify(res.data));
          if (Array.isArray(res.data.clients)) {
            try { await cacheClients(res.data.clients, activeUser); } catch {}
          }
          try { hydrateOfflineCache(activeUser); } catch {}
        } else {
          await computeAnalyticsFromSqlite(activeUser, bounds.from, bounds.to);
        }
      } catch {
        await computeAnalyticsFromSqlite(activeUser, bounds.from, bounds.to);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [officerUsername, preset, dateRange, computeAnalyticsFromSqlite]
  );

  // LOAD USER PROFILE & CREDENTIALS
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const [
          storedUser,
          storedBio,
          storedProfile,
          cachedOfficerName,
          storedPrivacy,
        ] = await Promise.all([
          AsyncStorage.getItem("cupad_user"),
          AsyncStorage.getItem("cupad_biometric_user"),
          AsyncStorage.getItem("cupad_profile"),
          AsyncStorage.getItem(CACHE_KEY_OFFICER_NAME),
          AsyncStorage.getItem(CACHE_KEY_PRIVACY),
        ]);

        if (storedPrivacy !== null && isMounted) setHideBalances(storedPrivacy === "true");

        const mergedUser: any = {};
        if (storedBio) {
          try { Object.assign(mergedUser, JSON.parse(storedBio)); } catch {}
        }
        if (storedUser) {
          try { Object.assign(mergedUser, JSON.parse(storedUser)); } catch {}
        }
        if (storedProfile) {
          try { Object.assign(mergedUser, JSON.parse(storedProfile)); } catch {}
        }

        if (isMounted) {
          const uname = (
            mergedUser.username ||
            mergedUser.user ||
            mergedUser.officer_username ||
            ""
          ).trim();

          let resolvedName = (
            cachedOfficerName ||
            mergedUser.full_name ||
            mergedUser.fullname ||
            mergedUser.name ||
            mergedUser.officer_name ||
            (mergedUser.first_name ? `${mergedUser.first_name} ${mergedUser.last_name || ""}`.trim() : "") ||
            ""
          ).trim();

          if (isGenericOfficerString(resolvedName)) {
            resolvedName = "";
          }

          if (!resolvedName && uname) {
            try {
              const db = await getDb();
              const dbUser: any = await db.getFirstAsync(
                `SELECT full_name, name FROM users WHERE username = ? OR id = ? LIMIT 1`,
                [uname, uname]
              ).catch(() => null);
              if (dbUser?.full_name || dbUser?.name) {
                const candidate = (dbUser.full_name || dbUser.name).trim();
                if (!isGenericOfficerString(candidate)) resolvedName = candidate;
              }
            } catch {}
          }

          if (!resolvedName) {
            try {
              const db = await getDb();
              const clientRow: any = await db.getFirstAsync(
                `SELECT officer_name, co_name FROM clients WHERE officer_name IS NOT NULL AND officer_name != '' LIMIT 1`
              ).catch(() => null);
              if (clientRow?.officer_name || clientRow?.co_name) {
                const candidate = (clientRow.officer_name || clientRow.co_name).trim();
                if (!isGenericOfficerString(candidate)) resolvedName = candidate;
              }
            } catch {}
          }

          if (uname) setOfficerUsername(uname);

          if (resolvedName) {
            setOfficerFullName(resolvedName);
            await AsyncStorage.setItem(CACHE_KEY_OFFICER_NAME, resolvedName).catch(() => {});
          }

          const bname = mergedUser.branch_name || mergedUser.branch || mergedUser.branch_id || "My Branch";
          setBranchName(bname);

          const pUrl = getProfilePicUrl(mergedUser.profile_pic, mergedUser.profile_pic_url);
          if (pUrl) setProfilePicUrl(pUrl);

          if (uname) {
            fetchReportData("month", false, uname);
          } else {
            setLoading(false);
          }
        }
      } catch {
        if (isMounted) setLoading(false);
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 380, useNativeDriver: true }).start();
  }, [fadeAnim]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    triggerHaptic();
    fetchReportData(preset, true);
  }, [fetchReportData, preset]);

  const handleApplyCustomRange = (from: string, to: string) => {
    setDateRange({ from, to });
    setPreset("custom");
    fetchReportData("custom", false, undefined, { from, to });
  };

  const handleSort = (field: SortField) => {
    triggerHaptic();
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const displayOfficerName = useMemo(() => {
    if (officerFullName && !isGenericOfficerString(officerFullName)) {
      return officerFullName.trim();
    }
    if (officerUsername && !isGenericOfficerString(officerUsername)) {
      return officerUsername.charAt(0).toUpperCase() + officerUsername.slice(1);
    }
    return "Credit Officer";
  }, [officerFullName, officerUsername]);

  const officerInitials = useMemo(() => {
    const nameToUse = displayOfficerName === "Credit Officer" ? (officerUsername || "CO") : displayOfficerName;
    return nameToUse
      .split(" ")
      .filter(Boolean)
      .map((s: string) => s[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }, [displayOfficerName, officerUsername]);

  const hiddenUnionsCount = useMemo(() => {
    return unionReports.filter((u) => !unionHasRecords(u)).length;
  }, [unionReports, unionHasRecords]);

  const sortedAndFilteredUnions = useMemo(() => {
    let list = [...unionReports];

    if (hideEmptyUnions) {
      list = list.filter((u) => unionHasRecords(u));
    }

    if (unionSearch.trim()) {
      const q = unionSearch.toLowerCase();
      list = list.filter((u) => (u.name || "").toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      let vA: any = a[sortField];
      let vB: any = b[sortField];
      if (typeof vA === "string") vA = vA.toLowerCase();
      if (typeof vB === "string") vB = vB.toLowerCase();
      if (vA < vB) return sortAsc ? -1 : 1;
      if (vA > vB) return sortAsc ? 1 : -1;
      return 0;
    });

    return list;
  }, [unionReports, hideEmptyUnions, unionHasRecords, unionSearch, sortField, sortAsc]);

  const displayTotals = useMemo(() => {
    if (sortedAndFilteredUnions.length === 0) return null;
    return sortedAndFilteredUnions.reduce(
      (acc, u) => ({
        clients: acc.clients + (u.clients || 0),
        deposits: acc.deposits + (u.total_savings || 0),
        withdrawals: acc.withdrawals + (u.withdrawals || 0),
        cash_payouts: acc.cash_payouts + (u.cash_payouts || 0),
        net_savings: acc.net_savings + (u.net_savings || 0),
        disbursements: acc.disbursements + (u.disbursements || 0),
        collections: acc.collections + (u.collections || 0),
        registrations: acc.registrations + (u.registrations || 0),
        paid_off: acc.paid_off + (u.paid_off || 0),
        overdue: acc.overdue + (u.overdue_count || 0),
      }),
      {
        clients: 0,
        deposits: 0,
        withdrawals: 0,
        cash_payouts: 0,
        net_savings: 0,
        disbursements: 0,
        collections: 0,
        registrations: 0,
        paid_off: 0,
        overdue: 0,
      }
    );
  }, [sortedAndFilteredUnions]);

  /**
   * OPEN UNION DRILLDOWN (Supports Online API + Local SQLite fallback)
   */
  const handleOpenUnionDrilldown = async (unionName: string) => {
    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedUnionName(unionName);
    setDrilldownVisible(true);
    setDrilldownLoading(true);
    setDrilldownSearch("");
    setClientFilterStatus("all");

    const bounds = dateRange.from ? dateRange : getDateBounds(preset);

    const online = await isOnline().catch(() => false);
    if (online) {
      try {
        const res = await axios.get(API_REPORTS, {
          params: {
            action: 'union_client_drilldown',
            username: officerUsername,
            union_name: unionName,
            date_from: bounds.from,
            date_to: bounds.to,
            q: drilldownSearch || '',
          },
          timeout: 10000,
        });

        const rawList = res.data?.clients || res.data?.data?.clients || [];
        if (Array.isArray(rawList)) {
          setDrilldownClients(
            rawList.map((c: any) => ({
              id: c.id || c.client_id || "",
              name: c.name || c.client_name || "Client",
              phone: c.phone || c.phone_number || "",
              status: c.status || (parseNumeric(c.loan_outstanding ?? c.loan_balance) > 0 ? "active" : "good"),
              savings_balance: parseNumeric(c.savings_balance ?? c.savings),
              loan_outstanding: parseNumeric(c.loan_outstanding ?? c.loan_balance),
              is_fully_paid: Boolean(c.is_fully_paid || parseNumeric(c.loan_outstanding ?? c.loan_balance) <= 0.01),
              days_overdue: parseNumeric(c.days_overdue),
              range_savings: parseNumeric(c.range_savings ?? c.savings ?? c.deposits ?? c.deposit),
              range_withdrawals: parseNumeric(c.range_withdrawals ?? c.withdrawals ?? c.deductions ?? c.reduction),
              range_cash: parseNumeric(c.range_cash ?? c.cash_payouts ?? c.cash_out),
              range_collected: parseNumeric(c.range_collected ?? c.collected ?? c.collections ?? c.repayments),
              range_disbursed: parseNumeric(c.range_disbursed ?? c.disbursed ?? c.disbursements),
            }))
          );
          setDrilldownLoading(false);
          return;
        }
      } catch {}
    }

    try {
      const db = await getDb();
      const boot = await bootstrapCoScreenData(officerUsername);
      const matched = (boot?.clients || []).filter(
        (c: any) => (c.union || c.union_name || "").toLowerCase() === unionName.toLowerCase()
      );

      const items: ClientDrilldownItem[] = [];

      for (const c of matched) {
        const cid = c.id || c.client_id;

        let savTotal = 0;
        let wthTotal = 0;
        let cashTotal = 0;
        let colTotal = 0;
        let disbTotal = 0;

        try {
          const sRes: any = await db.getFirstAsync(
            `SELECT SUM(amount) as total FROM savings WHERE (client_id = ? OR client_id = ?) AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [cid, String(cid), bounds.from, bounds.to]
          );
          savTotal = parseNumeric(sRes?.total);
        } catch {}

        try {
          const wRes: any = await db.getAllAsync(
            `SELECT type, amount FROM withdrawals WHERE (client_id = ? OR client_id = ?) AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [cid, String(cid), bounds.from, bounds.to]
          );
          (wRes || []).forEach((row: any) => {
            const amt = parseNumeric(row.amount);
            if (row.type === "cash") cashTotal += amt;
            else wthTotal += amt;
          });
        } catch {}

        try {
          const cRes: any = await db.getFirstAsync(
            `SELECT SUM(amount) as total FROM collections WHERE (client_id = ? OR client_id = ?) AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [cid, String(cid), bounds.from, bounds.to]
          );
          colTotal = parseNumeric(cRes?.total);
        } catch {}

        try {
          const dRes: any = await db.getFirstAsync(
            `SELECT SUM(principal_amount) as total FROM disbursements WHERE (client_id = ? OR client_id = ?) AND substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`,
            [cid, String(cid), bounds.from, bounds.to]
          );
          disbTotal = parseNumeric(dRes?.total);
        } catch {}

        const sBal = parseNumeric(c.savings_balance ?? c.savings);
        const lBal = parseNumeric(c.outstanding_loan ?? c.loan_balance);

        items.push({
          id: cid,
          name: c.name || c.client_name || "Client",
          phone: c.phone || c.phone_number || "",
          status: c.status || (lBal > 0 ? "active" : "good"),
          savings_balance: sBal,
          loan_outstanding: lBal,
          is_fully_paid: Boolean(c.is_fully_paid || lBal <= 0.01),
          days_overdue: parseNumeric(c.days_overdue),
          range_savings: savTotal,
          range_withdrawals: wthTotal,
          range_cash: cashTotal,
          range_collected: colTotal,
          range_disbursed: disbTotal,
        });
      }

      setDrilldownClients(items);
    } catch (err) {
      console.log("Local SQLite drilldown notice:", err);
      setDrilldownClients([]);
    } finally {
      setDrilldownLoading(false);
    }
  };

  /**
   * OPEN REGISTRATIONS DRILLDOWN
   */
  const handleOpenRegistrations = async (targetUnion = "", e?: any) => {
    if (e && e.stopPropagation) e.stopPropagation();
    triggerHaptic();
    setRegModalTitle(targetUnion ? `Registrations: ${targetUnion}` : "All Registrations");
    setRegModalVisible(true);
    setRegModalLoading(true);

    const bounds = dateRange.from ? dateRange : getDateBounds(preset);
    const online = await isOnline().catch(() => false);

    if (online) {
      try {
        const unionParam = targetUnion ? `&union_name=${encodeURIComponent(targetUnion)}` : "";
        const res = await axios.get(
          `${API_REPORTS}?action=registrations_drilldown&username=${encodeURIComponent(
            officerUsername
          )}${unionParam}&date_from=${bounds.from}&date_to=${bounds.to}`,
          { timeout: 10000 }
        );
        if (res.data?.success && Array.isArray(res.data.registrations)) {
          setRegModalList(
            res.data.registrations.map((r: any) => ({
              client_id: r.client_id,
              client_name: r.client_name,
              union: r.union,
              amount: parseNumeric(r.amount),
              date: r.date,
            }))
          );
          setRegModalLoading(false);
          return;
        }
      } catch {}
    }

    try {
      const db = await getDb();
      let query = `SELECT id, name, union_name, branch, created_at FROM clients WHERE substr(created_at, 1, 10) >= ? AND substr(created_at, 1, 10) <= ?`;
      const params: any[] = [bounds.from, bounds.to];
      if (targetUnion) {
        query += ` AND union_name = ?`;
        params.push(targetUnion);
      }
      const rows: any[] = await db.getAllAsync(query, params);
      setRegModalList(
        rows.map((r) => ({
          client_id: r.id,
          client_name: r.name,
          union: r.union_name || targetUnion || "Union",
          amount: 1000,
          date: (r.created_at || "").slice(0, 10),
        }))
      );
    } catch {
      setRegModalList([]);
    } finally {
      setRegModalLoading(false);
    }
  };

  const handleSendText = (client: ClientDrilldownItem) => {
    triggerHaptic();
    if (!client.phone) {
      Alert.alert("Missing Phone", "No phone number registered for this client.");
      return;
    }

    let message = `Hello ${client.name},\n`;
    if (client.days_overdue > 0) {
      message += `Your Cupad loan is overdue by ${client.days_overdue} days (${formatNaira(
        client.loan_outstanding
      )}). Please settle immediately.`;
    } else if (client.loan_outstanding > 0) {
      message += `Your active Cupad loan outstanding balance is ${formatNaira(client.loan_outstanding)}.`;
    } else {
      message += `Your total savings balance with Cupad is ${formatNaira(client.savings_balance)}.`;
    }

    const separator = Platform.OS === "ios" ? "&" : "?";
    Linking.openURL(`sms:${client.phone}${separator}body=${encodeURIComponent(message)}`).catch(() => {
      Alert.alert("Error", "Could not launch messaging application.");
    });
  };

  const handleMakeCall = (phone?: string) => {
    triggerHaptic();
    if (!phone) {
      Alert.alert("Missing Phone", "No phone number registered for this client.");
      return;
    }
    Linking.openURL(`tel:${phone}`).catch(() => {
      Alert.alert("Error", "Could not start phone call.");
    });
  };

  const filteredDrilldownClients = useMemo(() => {
    let list = [...drilldownClients];
    if (clientFilterStatus === "overdue") {
      list = list.filter((c) => c.days_overdue > 0);
    } else if (clientFilterStatus === "active_loan") {
      list = list.filter((c) => c.loan_outstanding > 0 && c.days_overdue === 0);
    } else if (clientFilterStatus === "paid_off") {
      list = list.filter((c) => c.is_fully_paid);
    } else if (clientFilterStatus === "closed") {
      list = list.filter((c) => c.status === "inactive" || c.status === "closed");
    }

    if (drilldownSearch.trim()) {
      const q = drilldownSearch.toLowerCase();
      list = list.filter(
        (c) => (c.name || "").toLowerCase().includes(q) || String(c.id).toLowerCase().includes(q)
      );
    }
    return list;
  }, [drilldownClients, drilldownSearch, clientFilterStatus]);

  const mixTotal = portfolioMix.savings + portfolioMix.disbursements + portfolioMix.collections || 1;
  const savPercent = Math.round((portfolioMix.savings / mixTotal) * 100);
  const disbPercent = Math.round((portfolioMix.disbursements / mixTotal) * 100);
  const collPercent = Math.round((portfolioMix.collections / mixTotal) * 100);

  return (
    <CoScreenWrapper>
      {/* ================= DASHBOARD-MATCHED AMBIENT ORBS ================= */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={270} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={420} delay={2000} />
      </View>

      <View style={styles.container}>
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
          {/* =========================================================================
              EXECUTIVE IDENTITY & COMMAND BAR
              ========================================================================= */}
          <View style={[styles.commandHeaderCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            <View style={styles.commandTopRow}>
              <View style={styles.avatarContainer}>
                {profilePicUrl ? (
                  <Image source={{ uri: profilePicUrl }} style={styles.avatarImg} />
                ) : (
                  <LinearGradient colors={["#3B82F6", "#1D4ED8"]} style={styles.avatarFallback}>
                    <Text style={styles.avatarFallbackText}>{officerInitials}</Text>
                  </LinearGradient>
                )}
                <View style={styles.onlineBadgeRing} />
              </View>

              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.officerNameText, { color: colors.text }]} numberOfLines={1}>
                    {displayOfficerName}
                  </Text>
                  <Ionicons name="checkmark-circle" size={15} color="#3B82F6" />
                </View>

                <View style={styles.officerMetaRow}>
                  <Text style={[styles.officerUsernameText, { color: colors.textMuted }]}>
                    @{officerUsername && !isGenericOfficerString(officerUsername) ? officerUsername : "officer"}
                  </Text>
                  <View style={styles.metaDot} />
                  <View style={styles.branchPill}>
                    <Ionicons name="business" size={10} color={colors.textMuted} />
                    <Text style={[styles.branchPillText, { color: colors.textMuted }]}>{branchName}</Text>
                  </View>
                </View>
              </View>

              <Pressable
                onPress={() => {
                  triggerHaptic();
                  setRangePickerVisible(true);
                }}
                style={({ pressed }) => [
                  styles.calTriggerBtn,
                  {
                    backgroundColor: preset === "custom" ? "rgba(59,130,246,0.12)" : "transparent",
                    borderColor: preset === "custom" ? "#3B82F6" : glassBorder,
                    transform: [{ scale: pressed ? 0.96 : 1 }],
                  },
                ]}
              >
                <Ionicons name="calendar-outline" size={14} color="#3B82F6" />
                <Text style={styles.calTriggerBtnText}>
                  {preset === "custom" ? "Custom Filter" : "Filter"}
                </Text>
              </Pressable>
            </View>

            <View style={[styles.activeRangeBar, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
              <View style={styles.livePulseDot} />
              <Text style={[styles.activeRangeText, { color: colors.textMuted }]}>
                {dateRange.from ? `${dateRange.from}  —  ${dateRange.to}` : "Aggregated Portfolio Overview"}
              </Text>
            </View>
          </View>

          {/* =========================================================================
              CLEAN 4-PRESET TABS ROW
              ========================================================================= */}
          <View style={styles.presetTabsRow}>
            {(["today", "week", "month", "last_month"] as const).map((p) => {
              const active = preset === p;
              const label =
                p === "today"
                  ? "Today"
                  : p === "week"
                  ? "This Week"
                  : p === "month"
                  ? "This Month"
                  : "Last Month";

              return (
                <Pressable
                  key={p}
                  onPress={() => {
                    triggerHaptic();
                    setPreset(p);
                    fetchReportData(p);
                  }}
                  style={({ pressed }) => [
                    styles.presetBtn,
                    {
                      backgroundColor: active ? colors.primary : cardSurfaceBg,
                      borderColor: active ? colors.primary : glassBorder,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    },
                  ]}
                >
                  <Text style={[styles.presetText, { color: active ? "#fff" : colors.text }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>

          {loading && !refreshing ? (
            <View style={{ paddingVertical: 48, alignItems: "center" }}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={{ marginTop: 12, color: colors.textMuted, fontSize: 13, fontWeight: "600" }}>
                Synchronizing live reports...
              </Text>
            </View>
          ) : (
            <>
              {/* =========================================================================
                  CONSOLIDATED MASTER EXECUTIVE KPI HUB
                  ========================================================================= */}
              <View style={[styles.masterHubCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                <LinearGradient
                  colors={isDark ? ["#1E3A8A", "#0F172A"] : ["#2563EB", "#1D4ED8"]}
                  style={styles.heroGradientBanner}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={styles.heroTopRow}>
                    <View style={styles.heroTagPill}>
                      <Ionicons name="shield-checkmark" size={12} color="#93C5FD" />
                      <Text style={styles.heroTagText}>PORTFOLIO NET SAVINGS</Text>
                    </View>
                    <View style={styles.heroClientsPill}>
                      <Ionicons name="people" size={11} color="#fff" />
                      <Text style={styles.heroClientsText}>{metrics.total_clients.toLocaleString()} Clients</Text>
                    </View>
                  </View>

                  <View style={styles.heroAmountRow}>
                    <Text style={styles.heroNetSavingsValue}>{formatNaira(metrics.net_savings, hideBalances)}</Text>
                    <Pressable
                      onPress={toggleHideBalances}
                      hitSlop={12}
                      style={styles.eyeInlineBtn}
                    >
                      <Ionicons
                        name={hideBalances ? "eye-off" : "eye"}
                        size={17}
                        color="rgba(255,255,255,0.85)"
                      />
                    </Pressable>
                  </View>

                  <View style={styles.heroBreakdownRow}>
                    <View style={styles.heroChipGreen}>
                      <Ionicons name="arrow-up" size={10} color="#86EFAC" />
                      <Text style={styles.heroChipTextGreen}>Dep: {formatNaira(metrics.total_savings, hideBalances)}</Text>
                    </View>
                    <View style={styles.heroChipPurple}>
                      <Ionicons name="document-text" size={10} color="#E9D5FF" />
                      <Text style={styles.heroChipTextPurple}>Ded: {formatNaira(metrics.total_withdrawals, hideBalances)}</Text>
                    </View>
                    <View style={styles.heroChipRed}>
                      <Ionicons name="cash" size={10} color="#FCA5A5" />
                      <Text style={styles.heroChipTextRed}>Cash: {formatNaira(metrics.total_cash, hideBalances)}</Text>
                    </View>
                  </View>
                </LinearGradient>

                <View style={styles.kpiMatrixGrid}>
                  <View style={[styles.kpiCell, { borderRightWidth: 1, borderBottomWidth: 1, borderColor: glassBorder }]}>
                    <View style={styles.kpiCellTitleRow}>
                      <Ionicons name="checkmark-done-circle" size={14} color="#10B981" />
                      <Text style={[styles.kpiCellTitle, { color: colors.textMuted }]}>Collections</Text>
                    </View>
                    <Text style={[styles.kpiCellValue, { color: colors.text }]}>{formatNaira(metrics.total_collections, hideBalances)}</Text>
                    <View style={styles.kpiBadgeGreen}>
                      <Text style={styles.kpiBadgeGreenText}>{metrics.collection_rate}% Rate</Text>
                    </View>
                  </View>

                  <View style={[styles.kpiCell, { borderBottomWidth: 1, borderColor: glassBorder }]}>
                    <View style={styles.kpiCellTitleRow}>
                      <Ionicons name="paper-plane" size={14} color="#F59E0B" />
                      <Text style={[styles.kpiCellTitle, { color: colors.textMuted }]}>Disbursements</Text>
                    </View>
                    <Text style={[styles.kpiCellValue, { color: colors.text }]}>{formatNaira(metrics.total_disbursements, hideBalances)}</Text>
                    <Text style={[styles.kpiCellSubText, { color: "#D97706" }]}>
                      Income: {formatNaira(metrics.total_service_charges, hideBalances)}
                    </Text>
                  </View>

                  <View style={[styles.kpiCell, { borderRightWidth: 1, borderColor: glassBorder }]}>
                    <View style={styles.kpiCellTitleRow}>
                      <Ionicons name="pulse" size={14} color="#EF4444" />
                      <Text style={[styles.kpiCellTitle, { color: colors.textMuted }]}>Outstanding</Text>
                    </View>
                    <Text style={[styles.kpiCellValue, { color: "#EF4444" }]}>{formatNaira(metrics.total_outstanding, hideBalances)}</Text>
                    <Text style={[styles.kpiCellSubText, { color: metrics.par_ratio > 5 ? "#EF4444" : "#10B981" }]}>
                      PAR: {metrics.par_ratio}% ({metrics.active_loans} loans)
                    </Text>
                  </View>

                  <Pressable onPress={() => handleOpenRegistrations()} style={styles.kpiCell}>
                    <View style={styles.kpiCellTitleRow}>
                      <Ionicons name="person-add" size={14} color="#3B82F6" />
                      <Text style={[styles.kpiCellTitle, { color: colors.textMuted }]}>Registrations</Text>
                    </View>
                    <Text style={[styles.kpiCellValue, { color: "#3B82F6" }]}>{metrics.total_registrations} Enrolled</Text>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                      <Text style={[styles.kpiCellSubText, { color: "#3B82F6", fontWeight: "700" }]}>
                        Fees: {formatNaira(metrics.total_reg_fees, hideBalances)}
                      </Text>
                      <Ionicons name="chevron-forward" size={11} color="#3B82F6" />
                    </View>
                  </Pressable>
                </View>

                <View style={[styles.volumeMixSection, { borderTopWidth: 1, borderTopColor: glassBorder }]}>
                  <View style={styles.volumeMixHeader}>
                    <Text style={[styles.volumeMixTitle, { color: colors.textMuted }]}>PORTFOLIO VOLUME DISTRIBUTION</Text>
                    <Text style={[styles.volumeMixTotal, { color: colors.text }]}>{formatNaira(mixTotal, hideBalances)}</Text>
                  </View>
                  <View style={styles.volumeMixBarTrack}>
                    <View style={[styles.volumeMixBarSeg, { backgroundColor: "#22C55E", width: `${savPercent}%` }]} />
                    <View style={[styles.volumeMixBarSeg, { backgroundColor: "#F59E0B", width: `${disbPercent}%` }]} />
                    <View style={[styles.volumeMixBarSeg, { backgroundColor: "#8B5CF6", width: `${collPercent}%` }]} />
                  </View>
                  <View style={styles.volumeMixLegendRow}>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: "#22C55E" }]} />
                      <Text style={[styles.legendLabel, { color: colors.textMuted }]}>Savings {savPercent}%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: "#F59E0B" }]} />
                      <Text style={[styles.legendLabel, { color: colors.textMuted }]}>Disbursed {disbPercent}%</Text>
                    </View>
                    <View style={styles.legendItem}>
                      <View style={[styles.legendDot, { backgroundColor: "#8B5CF6" }]} />
                      <Text style={[styles.legendLabel, { color: colors.textMuted }]}>Collected {collPercent}%</Text>
                    </View>
                  </View>
                </View>
              </View>

              {/* =========================================================================
                  UNION PERFORMANCE HEADER, FILTER TOGGLE & SEARCH
                  ========================================================================= */}
              <View style={styles.unionHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sectionTitle, { color: colors.text }]}>Performance by Union</Text>
                  <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>
                    Tap union row to view client audit details
                  </Text>
                </View>

                {/* Filter Toggle: Hide Unions with no records */}
                <Pressable
                  onPress={() => {
                    triggerHaptic();
                    setHideEmptyUnions(!hideEmptyUnions);
                  }}
                  style={[
                    styles.hideEmptyToggleBtn,
                    {
                      backgroundColor: hideEmptyUnions
                        ? (isDark ? "rgba(59,130,246,0.18)" : "#EFF6FF")
                        : (isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9"),
                      borderColor: hideEmptyUnions ? "#3B82F6" : glassBorder,
                    },
                  ]}
                >
                  <Ionicons
                    name={hideEmptyUnions ? "filter" : "filter-outline"}
                    size={12}
                    color={hideEmptyUnions ? "#3B82F6" : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.hideEmptyToggleText,
                      { color: hideEmptyUnions ? "#3B82F6" : colors.textMuted },
                    ]}
                  >
                    {hideEmptyUnions ? "Active Only" : "Show All"}
                  </Text>
                  {hiddenUnionsCount > 0 && hideEmptyUnions && (
                    <View style={styles.hiddenCountBadge}>
                      <Text style={styles.hiddenCountText}>{hiddenUnionsCount}</Text>
                    </View>
                  )}
                </Pressable>
              </View>

              <View style={[styles.searchBarBox, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                <Ionicons name="search" size={15} color={colors.textMuted} />
                <TextInput
                  value={unionSearch}
                  onChangeText={setUnionSearch}
                  placeholder="Search assigned unions..."
                  placeholderTextColor={colors.textMuted}
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {unionSearch.length > 0 && (
                  <Pressable onPress={() => setUnionSearch("")} hitSlop={8}>
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>

              {/* =========================================================================
                  FROZEN DATA TABLE
                  ========================================================================= */}
              <View style={[styles.tableContainerCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
                {sortedAndFilteredUnions.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="file-tray-outline" size={36} color={colors.textMuted} />
                    <Text style={[styles.emptyTitle, { color: colors.text }]}>No Unions Found</Text>
                    <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                      {unionReports.length === 0
                        ? "No client transactions recorded for this period."
                        : hideEmptyUnions && hiddenUnionsCount > 0
                        ? `${hiddenUnionsCount} union${hiddenUnionsCount > 1 ? "s" : ""} with no records are hidden.`
                        : `No unions matched "${unionSearch}".`}
                    </Text>
                    {hideEmptyUnions && hiddenUnionsCount > 0 && (
                      <Pressable
                        onPress={() => {
                          triggerHaptic();
                          setHideEmptyUnions(false);
                        }}
                        style={[styles.unhideBtn, { borderColor: glassBorder }]}
                      >
                        <Text style={{ fontSize: 12, fontWeight: "700", color: "#3B82F6" }}>
                          Show All ({hiddenUnionsCount} Empty)
                        </Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <View style={styles.frozenTableFlex}>
                    {/* Left Frozen Column */}
                    <View style={[styles.frozenLeftColumn, { borderColor: glassBorder }]}>
                      <Pressable
                        onPress={() => handleSort("name")}
                        style={[styles.frozenThCell, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC" }]}
                      >
                        <Text style={styles.uThText}>UNION NAME</Text>
                        <Ionicons
                          name={sortField === "name" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"}
                          size={11}
                          color={sortField === "name" ? "#3B82F6" : "#94A3B8"}
                        />
                      </Pressable>

                      {sortedAndFilteredUnions.map((u, index) => {
                        const rowBg = index % 2 === 0
                          ? (isDark ? "transparent" : "#FFFFFF")
                          : (isDark ? "rgba(255,255,255,0.02)" : "#F8FAFC");
                        return (
                          <Pressable
                            key={`frozen-${u.name}`}
                            onPress={() => handleOpenUnionDrilldown(u.name)}
                            style={({ pressed }) => [
                              styles.frozenTdCell,
                              { backgroundColor: rowBg, borderColor: glassBorder, opacity: pressed ? 0.7 : 1 },
                            ]}
                          >
                            <Text style={[styles.uTdNameText, { color: colors.text }]} numberOfLines={1}>
                              {u.name}
                            </Text>
                          </Pressable>
                        );
                      })}

                      {displayTotals && (
                        <View style={[styles.frozenTfCell, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9", borderColor: glassBorder }]}>
                          <Text style={[styles.uTfText, { fontWeight: "900", color: colors.text }]}>TOTALS</Text>
                        </View>
                      )}
                    </View>

                    {/* Scrollable Right Columns */}
                    <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ flex: 1 }}>
                      <View style={{ minWidth: 970 }}>
                        <View style={[styles.uHeaderRow, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC" }]}>
                          <Pressable onPress={() => handleSort("clients")} style={[styles.sortableTh, { width: 70, justifyContent: "center" }]}>
                            <Text style={styles.uThText}>CLIENTS</Text>
                            <Ionicons name={sortField === "clients" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#94A3B8" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("total_savings")} style={[styles.sortableTh, { width: 95 }]}>
                            <Text style={[styles.uThText, { color: "#16A34A" }]}>DEPOSITS</Text>
                            <Ionicons name={sortField === "total_savings" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#16A34A" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("withdrawals")} style={[styles.sortableTh, { width: 95 }]}>
                            <Text style={[styles.uThText, { color: "#8B5CF6" }]}>DEDUCTIONS</Text>
                            <Ionicons name={sortField === "withdrawals" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#8B5CF6" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("cash_payouts")} style={[styles.sortableTh, { width: 90 }]}>
                            <Text style={[styles.uThText, { color: "#DC2626" }]}>CASH OUT</Text>
                            <Ionicons name={sortField === "cash_payouts" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#DC2626" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("net_savings")} style={[styles.sortableTh, { width: 105 }]}>
                            <Text style={[styles.uThText, { color: "#2563EB" }]}>NET SAVINGS</Text>
                            <Ionicons name={sortField === "net_savings" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#2563EB" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("disbursements")} style={[styles.sortableTh, { width: 100 }]}>
                            <Text style={[styles.uThText, { color: "#D97706" }]}>DISBURSED</Text>
                            <Ionicons name={sortField === "disbursements" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#D97706" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("collections")} style={[styles.sortableTh, { width: 100 }]}>
                            <Text style={styles.uThText}>COLLECTED</Text>
                            <Ionicons name={sortField === "collections" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#94A3B8" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("registrations")} style={[styles.sortableTh, { width: 85, justifyContent: "center" }]}>
                            <Text style={[styles.uThText, { color: "#2563EB" }]}>REGISTRATIONS</Text>
                            <Ionicons name={sortField === "registrations" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#2563EB" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("paid_off")} style={[styles.sortableTh, { width: 75, justifyContent: "center" }]}>
                            <Text style={[styles.uThText, { color: "#16A34A" }]}>PAID OFF</Text>
                            <Ionicons name={sortField === "paid_off" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#16A34A" />
                          </Pressable>
                          <Pressable onPress={() => handleSort("overdue_count")} style={[styles.sortableTh, { width: 75, justifyContent: "center" }]}>
                            <Text style={[styles.uThText, { color: "#DC2626" }]}>OVERDUE</Text>
                            <Ionicons name={sortField === "overdue_count" ? (sortAsc ? "arrow-up" : "arrow-down") : "swap-vertical"} size={10} color="#DC2626" />
                          </Pressable>
                          <Text style={[styles.uThText, { width: 70, textAlign: "center" }]}>STATUS</Text>
                        </View>

                        {sortedAndFilteredUnions.map((u, index) => {
                          const badgeColor =
                            u.activity_badge === "High" ? "#10B981" : u.activity_badge === "Med" ? "#3B82F6" : "#6B7280";
                          const badgeBg =
                            u.activity_badge === "High" ? "rgba(16,185,129,0.12)" : u.activity_badge === "Med" ? "rgba(59,130,246,0.12)" : "rgba(148,163,184,0.12)";
                          const rowBg = index % 2 === 0
                            ? (isDark ? "transparent" : "#FFFFFF")
                            : (isDark ? "rgba(255,255,255,0.02)" : "#F8FAFC");

                          return (
                            <Pressable
                              key={`scroll-${u.name}`}
                              onPress={() => handleOpenUnionDrilldown(u.name)}
                              style={({ pressed }) => [
                                styles.uBodyRow,
                                { backgroundColor: rowBg, borderColor: glassBorder, opacity: pressed ? 0.7 : 1 },
                              ]}
                            >
                              <Text style={[styles.uTdText, { width: 70, textAlign: "center", color: colors.textMuted }]}>
                                {u.clients}
                              </Text>
                              <Text style={[styles.uTdText, { width: 95, textAlign: "right", color: "#16A34A" }]}>
                                {formatNaira(u.total_savings, hideBalances)}
                              </Text>
                              <Text style={[styles.uTdText, { width: 95, textAlign: "right", color: "#8B5CF6" }]}>
                                {formatNaira(u.withdrawals, hideBalances)}
                              </Text>
                              <Text style={[styles.uTdText, { width: 90, textAlign: "right", color: "#DC2626" }]}>
                                {formatNaira(u.cash_payouts, hideBalances)}
                              </Text>
                              <Text style={[styles.uTdText, { width: 105, textAlign: "right", color: "#2563EB", fontWeight: "900" }]}>
                                {formatNaira(u.net_savings, hideBalances)}
                              </Text>
                              <Text style={[styles.uTdText, { width: 100, textAlign: "right", color: "#D97706" }]}>
                                {formatNaira(u.disbursements, hideBalances)}
                              </Text>
                              <Text style={[styles.uTdText, { width: 100, textAlign: "right", color: colors.text }]}>
                                {formatNaira(u.collections, hideBalances)}
                              </Text>
                              <Pressable
                                onPress={(e) => handleOpenRegistrations(u.name, e)}
                                style={{ width: 85, justifyContent: "center", alignItems: "center" }}
                              >
                                <Text style={[styles.uTdText, { color: "#2563EB", fontWeight: "800", textDecorationLine: "underline" }]}>
                                  {u.registrations}
                                </Text>
                              </Pressable>
                              <View style={{ width: 75, alignItems: "center", justifyContent: "center" }}>
                                <View style={styles.uPaidOffBadge}>
                                  <Text style={styles.uPaidOffText}>{u.paid_off}</Text>
                                </View>
                              </View>
                              <View style={{ width: 75, alignItems: "center", justifyContent: "center" }}>
                                {u.overdue_count > 0 ? (
                                  <View style={styles.uOverdueBadge}>
                                    <Text style={styles.uOverdueText}>{u.overdue_count}</Text>
                                  </View>
                                ) : (
                                  <Text style={{ color: colors.textMuted }}>-</Text>
                                )}
                              </View>
                              <View style={{ width: 70, alignItems: "center", justifyContent: "center" }}>
                                <View style={[styles.uActivityBadge, { backgroundColor: badgeBg }]}>
                                  <Text style={[styles.uActivityText, { color: badgeColor }]}>{u.activity_badge}</Text>
                                </View>
                              </View>
                            </Pressable>
                          );
                        })}

                        {displayTotals && (
                          <View style={[styles.uFooterRow, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F8FAFC", borderColor: glassBorder }]}>
                            <Text style={[styles.uTfText, { width: 70, textAlign: "center", color: colors.text }]}>{displayTotals.clients.toLocaleString()}</Text>
                            <Text style={[styles.uTfText, { width: 95, textAlign: "right", color: "#16A34A" }]}>{formatNaira(displayTotals.deposits, hideBalances)}</Text>
                            <Text style={[styles.uTfText, { width: 95, textAlign: "right", color: "#8B5CF6" }]}>{formatNaira(displayTotals.withdrawals, hideBalances)}</Text>
                            <Text style={[styles.uTfText, { width: 90, textAlign: "right", color: "#DC2626" }]}>{formatNaira(displayTotals.cash_payouts, hideBalances)}</Text>
                            <Text style={[styles.uTfText, { width: 105, textAlign: "right", color: "#2563EB", fontWeight: "900" }]}>{formatNaira(displayTotals.net_savings, hideBalances)}</Text>
                            <Text style={[styles.uTfText, { width: 100, textAlign: "right", color: "#D97706" }]}>{formatNaira(displayTotals.disbursements, hideBalances)}</Text>
                            <Text style={[styles.uTfText, { width: 100, textAlign: "right", color: colors.text }]}>{formatNaira(displayTotals.collections, hideBalances)}</Text>
                            <Text style={[styles.uTfText, { width: 85, textAlign: "center", color: "#2563EB" }]}>{displayTotals.registrations}</Text>
                            <Text style={[styles.uTfText, { width: 75, textAlign: "center", color: "#16A34A" }]}>{displayTotals.paid_off}</Text>
                            <Text style={[styles.uTfText, { width: 75, textAlign: "center", color: "#DC2626" }]}>{displayTotals.overdue}</Text>
                            <Text style={[styles.uTfText, { width: 70 }]}></Text>
                          </View>
                        )}
                      </View>
                    </ScrollView>
                  </View>
                )}
              </View>
            </>
          )}
        </Animated.ScrollView>

        {/* =========================================================================
            MODAL 1: CLIENT DRILLDOWN TABLE
            ========================================================================= */}
        <Modal
          visible={drilldownVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setDrilldownVisible(false)}
        >
          <View style={styles.sheetModalOverlay}>
            <View style={[styles.sheetModalCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.sheetHandleWrap}>
                <View style={[styles.sheetHandle, { backgroundColor: "#CBD5E1" }]} />
              </View>

              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>{selectedUnionName}</Text>
                  <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]}>
                    Client Activity Audit ({dateRange.from || "Start"} — {dateRange.to || "Today"})
                  </Text>
                </View>

                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[styles.modalSearchInputBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                    <Ionicons name="search" size={13} color={colors.textMuted} />
                    <TextInput
                      value={drilldownSearch}
                      onChangeText={setDrilldownSearch}
                      placeholder="Search name/ID..."
                      placeholderTextColor={colors.textMuted}
                      style={[styles.modalSearchInput, { color: colors.text }]}
                    />
                  </View>

                  <Pressable onPress={() => setDrilldownVisible(false)} hitSlop={10}>
                    <Ionicons name="close" size={22} color={colors.textMuted} />
                  </Pressable>
                </View>
              </View>

              <View style={{ marginVertical: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statusChipsContent}>
                  {[
                    { key: "all", label: `All (${drilldownClients.length})` },
                    { key: "overdue", label: `Overdue (${drilldownClients.filter((c) => c.days_overdue > 0).length})` },
                    {
                      key: "active_loan",
                      label: `Active Loans (${drilldownClients.filter((c) => c.loan_outstanding > 0 && c.days_overdue === 0).length})`,
                    },
                    { key: "paid_off", label: `Paid Off (${drilldownClients.filter((c) => c.is_fully_paid).length})` },
                    {
                      key: "closed",
                      label: `Closed (${drilldownClients.filter((c) => c.status === "inactive" || c.status === "closed").length})`,
                    },
                  ].map((filter) => {
                    const active = clientFilterStatus === filter.key;
                    return (
                      <Pressable
                        key={filter.key}
                        onPress={() => {
                          triggerHaptic();
                          setClientFilterStatus(filter.key as ClientFilterStatus);
                        }}
                        style={[
                          styles.statusChip,
                          {
                            backgroundColor: active ? (filter.key === "overdue" ? "#EF4444" : "#3B82F6") : colors.background,
                            borderColor: active ? "transparent" : glassBorder,
                          },
                        ]}
                      >
                        <Text style={[styles.statusChipText, { color: active ? "#fff" : colors.text }]}>
                          {filter.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.sheetTableFlex}>
                {drilldownLoading ? (
                  <View style={styles.loadingCenter}>
                    <ActivityIndicator size="large" color="#3B82F6" />
                    <Text style={{ marginTop: 10, fontSize: 13, color: colors.textMuted }}>Loading clients...</Text>
                  </View>
                ) : filteredDrilldownClients.length === 0 ? (
                  <View style={styles.loadingCenter}>
                    <Ionicons name="people-outline" size={38} color={colors.textMuted} />
                    <Text style={{ textAlign: "center", color: colors.textMuted, marginTop: 8, fontSize: 13 }}>
                      No matching clients found in this union.
                    </Text>
                  </View>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={true} style={{ flex: 1 }}>
                    <View style={{ minWidth: 860 }}>
                      <View style={[styles.sheetTableHeadRow, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC" }]}>
                        <Text style={[styles.thCellText, { width: 140 }]}>CLIENT</Text>
                        <Text style={[styles.thCellText, styles.thSavedTint, { width: 95, textAlign: "right" }]}>SAVED</Text>
                        <Text style={[styles.thCellText, styles.thCashTint, { width: 95, textAlign: "right" }]}>CASH OUT</Text>
                        <Text style={[styles.thCellText, styles.thDedTint, { width: 95, textAlign: "right" }]}>DEDUCTED</Text>
                        <Text style={[styles.thCellText, styles.thDedTint, { width: 105, textAlign: "right" }]}>LOAN COLLECTED</Text>
                        <Text style={[styles.thCellText, styles.thDisbTint, { width: 100, textAlign: "right" }]}>DISBURSED</Text>
                        <Text style={[styles.thCellText, { width: 130, textAlign: "right" }]}>CURRENT BALANCE</Text>
                        <Text style={[styles.thCellText, { width: 100, textAlign: "center" }]}>STATUS</Text>
                      </View>

                      <ScrollView
                        nestedScrollEnabled={true}
                        style={{ flex: 1 }}
                        contentContainerStyle={{ paddingBottom: 24 }}
                        showsVerticalScrollIndicator={true}
                      >
                        {filteredDrilldownClients.map((c, index) => {
                          const isClosed = c.status === "inactive" || c.status === "closed";
                          const rowBg = index % 2 === 0
                            ? (isDark ? "transparent" : "#FFFFFF")
                            : (isDark ? "rgba(255,255,255,0.02)" : "#F8FAFC");

                          return (
                            <Pressable
                              key={`client-row-${c.id}`}
                              onPress={() => {
                                triggerHaptic();
                                setSelectedClientDetail(c);
                              }}
                              style={({ pressed }) => [
                                styles.sheetTableBodyRow,
                                {
                                  backgroundColor: rowBg,
                                  borderColor: glassBorder,
                                  opacity: pressed ? 0.7 : isClosed ? 0.6 : 1,
                                },
                              ]}
                            >
                              <View style={{ width: 140, justifyContent: "center" }}>
                                <Text style={[styles.clientNameText, { color: colors.text }]} numberOfLines={1}>
                                  {c.name}
                                </Text>
                                <Text style={[styles.clientIdText, { color: colors.textMuted }]}>{c.id}</Text>
                              </View>

                              <Text style={[styles.clientAmountText, { width: 95, textAlign: "right", color: c.range_savings > 0 ? "#2563EB" : colors.textMuted }]}>
                                {c.range_savings > 0 ? formatNaira(c.range_savings, hideBalances) : "-"}
                              </Text>

                              <Text style={[styles.clientAmountText, { width: 95, textAlign: "right", color: c.range_cash > 0 ? "#DC2626" : colors.textMuted }]}>
                                {c.range_cash > 0 ? formatNaira(c.range_cash, hideBalances) : "-"}
                              </Text>

                              <Text style={[styles.clientAmountText, { width: 95, textAlign: "right", color: c.range_withdrawals > 0 ? "#8B5CF6" : colors.textMuted }]}>
                                {c.range_withdrawals > 0 ? formatNaira(c.range_withdrawals, hideBalances) : "-"}
                              </Text>

                              <Text style={[styles.clientAmountText, { width: 105, textAlign: "right", color: c.range_collected > 0 ? "#8B5CF6" : colors.textMuted }]}>
                                {c.range_collected > 0 ? formatNaira(c.range_collected, hideBalances) : "-"}
                              </Text>

                              <Text style={[styles.clientAmountText, { width: 100, textAlign: "right", color: c.range_disbursed > 0 ? "#D97706" : colors.textMuted }]}>
                                {c.range_disbursed > 0 ? formatNaira(c.range_disbursed, hideBalances) : "-"}
                              </Text>

                              <View style={{ width: 130, justifyContent: "center", alignItems: "flex-end" }}>
                                <Text style={[styles.clientBalSub, { color: colors.textMuted }]}>
                                  Sav: {formatNaira(c.savings_balance, hideBalances)}
                                </Text>
                                {c.loan_outstanding > 0 ? (
                                  <Text style={[styles.clientBalSub, { color: "#EF4444" }]}>
                                    Loan: {formatNaira(c.loan_outstanding, hideBalances)}
                                  </Text>
                                ) : null}
                              </View>

                              <View style={{ width: 100, alignItems: "center", justifyContent: "center" }}>
                                {isClosed ? (
                                  <View style={styles.badgeClosed}>
                                    <Text style={styles.badgeClosedText}>CLOSED</Text>
                                  </View>
                                ) : c.days_overdue > 0 ? (
                                  <View style={styles.badgeOverdue}>
                                    <Text style={styles.badgeOverdueText}>{c.days_overdue}D OVERDUE</Text>
                                  </View>
                                ) : c.loan_outstanding > 0 ? (
                                  <View style={styles.badgeActiveLoan}>
                                    <Text style={styles.badgeActiveLoanText}>ACTIVE LOAN</Text>
                                  </View>
                                ) : c.is_fully_paid ? (
                                  <View style={styles.badgePaidOff}>
                                    <Text style={styles.badgePaidOffText}>PAID OFF</Text>
                                  </View>
                                ) : (
                                  <Text style={{ color: colors.textMuted }}>-</Text>
                                )}
                              </View>
                            </Pressable>
                          );
                        })}
                      </ScrollView>
                    </View>
                  </ScrollView>
                )}
              </View>
            </View>
          </View>
        </Modal>

        {/* =========================================================================
            MODAL 1B: SINGLE CLIENT QUICK ACTION DIALOG
            ========================================================================= */}
        <Modal
          visible={!!selectedClientDetail}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedClientDetail(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={[styles.clientQuickCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              {selectedClientDetail && (
                <>
                  <View style={styles.calModalHead}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.calModalTitle, { color: colors.text }]}>{selectedClientDetail.name}</Text>
                      <Text style={[styles.calModalSub, { color: colors.textMuted }]}>
                        Client ID #{selectedClientDetail.id} • {selectedUnionName}
                      </Text>
                    </View>
                    <Pressable onPress={() => setSelectedClientDetail(null)} hitSlop={10}>
                      <Ionicons name="close" size={22} color={colors.textMuted} />
                    </Pressable>
                  </View>

                  <View style={styles.clientQuickMetaRow}>
                    <View style={styles.clientMetaBox}>
                      <Text style={[styles.clientMetaLabel, { color: colors.textMuted }]}>Total Savings</Text>
                      <Text style={[styles.clientMetaValue, { color: "#10B981" }]}>
                        {formatNaira(selectedClientDetail.savings_balance, hideBalances)}
                      </Text>
                    </View>
                    <View style={styles.clientMetaBox}>
                      <Text style={[styles.clientMetaLabel, { color: colors.textMuted }]}>Loan Outstanding</Text>
                      <Text style={[styles.clientMetaValue, { color: selectedClientDetail.loan_outstanding > 0 ? "#EF4444" : colors.textMuted }]}>
                        {formatNaira(selectedClientDetail.loan_outstanding, hideBalances)}
                      </Text>
                    </View>
                  </View>

                  {!!selectedClientDetail.phone && (
                    <View style={styles.clientQuickActionsRow}>
                      <Pressable
                        onPress={() => handleMakeCall(selectedClientDetail.phone)}
                        style={({ pressed }) => [
                          styles.clientActionPill,
                          { backgroundColor: "#10B981", opacity: pressed ? 0.8 : 1 },
                        ]}
                      >
                        <Ionicons name="call" size={15} color="#fff" />
                        <Text style={styles.clientActionPillText}>Call Client</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => handleSendText(selectedClientDetail)}
                        style={({ pressed }) => [
                          styles.clientActionPill,
                          { backgroundColor: "#3B82F6", opacity: pressed ? 0.8 : 1 },
                        ]}
                      >
                        <Ionicons name="chatbubble" size={15} color="#fff" />
                        <Text style={styles.clientActionPillText}>Send SMS</Text>
                      </Pressable>
                    </View>
                  )}
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* =========================================================================
            MODAL 2: REGISTRATIONS BREAKDOWN TABLE
            ========================================================================= */}
        <Modal
          visible={regModalVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setRegModalVisible(false)}
        >
          <View style={styles.sheetModalOverlay}>
            <View style={[styles.sheetModalCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.sheetHandleWrap}>
                <View style={[styles.sheetHandle, { backgroundColor: "#CBD5E1" }]} />
              </View>

              <View style={styles.sheetHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>{regModalTitle}</Text>
                  <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]}>
                    Registration Fee Audit ({dateRange.from || "Start"} — {dateRange.to || "Today"})
                  </Text>
                </View>
                <Pressable onPress={() => setRegModalVisible(false)} hitSlop={10}>
                  <Ionicons name="close" size={22} color={colors.textMuted} />
                </Pressable>
              </View>

              {regModalLoading ? (
                <View style={styles.loadingCenter}>
                  <ActivityIndicator size="small" color="#3B82F6" />
                </View>
              ) : (
                <View style={{ flex: 1 }}>
                  <View style={[styles.regHeadRow, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC" }]}>
                    <Text style={[styles.thCellText, { flex: 1.5 }]}>CLIENT</Text>
                    <Text style={[styles.thCellText, { flex: 1.2 }]}>UNION</Text>
                    <Text style={[styles.thCellText, { flex: 1, textAlign: "right" }]}>DATE</Text>
                    <Text style={[styles.thCellText, { flex: 1, textAlign: "right", color: "#3B82F6" }]}>FEE</Text>
                  </View>

                  <ScrollView
                    style={{ flexShrink: 1 }}
                    contentContainerStyle={{ paddingBottom: 24 }}
                    showsVerticalScrollIndicator={false}
                  >
                    {regModalList.length === 0 ? (
                      <Text style={{ textAlign: "center", color: colors.textMuted, marginVertical: 36, fontSize: 13 }}>
                        No registrations recorded for this period.
                      </Text>
                    ) : (
                      regModalList.map((r, i) => (
                        <View
                          key={`${r.client_id}-${i}`}
                          style={[styles.regDataRow, { borderColor: glassBorder }]}
                        >
                          <View style={{ flex: 1.5, justifyContent: "center" }}>
                            <Text style={[styles.regClientName, { color: colors.text }]}>{r.client_name}</Text>
                            <Text style={[styles.clientIdText, { color: colors.textMuted }]}>{r.client_id}</Text>
                          </View>
                          <Text style={[styles.regUnionText, { flex: 1.2, color: colors.textMuted }]} numberOfLines={1}>
                            {r.union}
                          </Text>
                          <Text style={[styles.regDateText, { flex: 1, textAlign: "right", color: colors.textMuted }]}>
                            {r.date}
                          </Text>
                          <Text style={[styles.regFeeText, { flex: 1, textAlign: "right", color: "#3B82F6" }]}>
                            {formatNaira(r.amount, hideBalances)}
                          </Text>
                        </View>
                      ))
                    )}
                  </ScrollView>
                </View>
              )}
            </View>
          </View>
        </Modal>

        {/* ULTRA-PREMIUM RANGE PICKER MODAL */}
        <DateRangePickerModal
          visible={rangePickerVisible}
          fromDate={dateRange.from}
          toDate={dateRange.to}
          onClose={() => setRangePickerVisible(false)}
          onApplyRange={handleApplyCustomRange}
        />
      </View>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 40 },

  // COMMAND HEADER & OFFICER IDENTITY
  commandHeaderCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  commandTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatarContainer: { position: "relative" },
  avatarImg: { width: 44, height: 44, borderRadius: 22 },
  avatarFallback: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  avatarFallbackText: { color: "#fff", fontSize: 16, fontWeight: "900" },
  onlineBadgeRing: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#10B981",
    borderWidth: 2,
    borderColor: "#fff",
  },
  officerNameText: { fontSize: 16, fontWeight: "900", letterSpacing: -0.3 },
  officerMetaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  officerUsernameText: { fontSize: 11, fontWeight: "700" },
  metaDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: "#94A3B8" },
  branchPill: { flexDirection: "row", alignItems: "center", gap: 4 },
  branchPillText: { fontSize: 10.5, fontWeight: "700" },
  calTriggerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  calTriggerBtnText: { fontSize: 11, fontWeight: "800", color: "#3B82F6" },
  activeRangeBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  livePulseDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#10B981" },
  activeRangeText: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },

  // CLEAN 4-PRESET TABS
  presetTabsRow: { flexDirection: "row", gap: 6, marginBottom: 12 },
  presetBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  presetText: { fontSize: 11, fontWeight: "700" },

  // MASTER EXECUTIVE HUB
  masterHubCard: {
    borderRadius: 24,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  heroGradientBanner: { padding: 18, borderTopLeftRadius: 23, borderTopRightRadius: 23 },
  heroTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroTagPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  heroTagText: { fontSize: 9.5, fontWeight: "900", color: "#DBEAFE", letterSpacing: 0.5 },
  heroClientsPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.22)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  heroClientsText: { fontSize: 10.5, fontWeight: "800", color: "#fff" },
  heroAmountRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginVertical: 8,
  },
  heroNetSavingsValue: { fontSize: 32, fontWeight: "900", color: "#fff", letterSpacing: -0.6 },
  eyeInlineBtn: { padding: 6, borderRadius: 8 },
  heroBreakdownRow: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 },
  heroChipGreen: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(34,197,94,0.18)",
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  heroChipTextGreen: { fontSize: 9.5, fontWeight: "800", color: "#86EFAC" },
  heroChipPurple: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(168,85,247,0.18)",
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  heroChipTextPurple: { fontSize: 9.5, fontWeight: "800", color: "#E9D5FF" },
  heroChipRed: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(239,68,68,0.18)",
    paddingHorizontal: 7,
    paddingVertical: 3.5,
    borderRadius: 6,
  },
  heroChipTextRed: { fontSize: 9.5, fontWeight: "800", color: "#FCA5A5" },

  // KPI MATRIX
  kpiMatrixGrid: { flexDirection: "row", flexWrap: "wrap" },
  kpiCell: { width: "50%", padding: 13 },
  kpiCellTitleRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  kpiCellTitle: { fontSize: 10.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  kpiCellValue: { fontSize: 15.5, fontWeight: "900", marginBottom: 2 },
  kpiCellSubText: { fontSize: 10, fontWeight: "700" },
  kpiBadgeGreen: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  kpiBadgeGreenText: { color: "#10B981", fontSize: 9.5, fontWeight: "800" },

  // VOLUME MIX
  volumeMixSection: { padding: 14 },
  volumeMixHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  volumeMixTitle: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  volumeMixTotal: { fontSize: 11, fontWeight: "800" },
  volumeMixBarTrack: { height: 6, flexDirection: "row", borderRadius: 3, overflow: "hidden", backgroundColor: "rgba(100,116,139,0.12)" },
  volumeMixBarSeg: { height: "100%" },
  volumeMixLegendRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 7 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendDot: { width: 6, height: 6, borderRadius: 3 },
  legendLabel: { fontSize: 9.5, fontWeight: "700" },

  // UNION SECTION
  unionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitle: { fontSize: 15, fontWeight: "800" },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  hideEmptyToggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
  },
  hideEmptyToggleText: { fontSize: 11, fontWeight: "800" },
  hiddenCountBadge: {
    backgroundColor: "#3B82F6",
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 2,
  },
  hiddenCountText: { color: "#fff", fontSize: 9.5, fontWeight: "800" },

  searchBarBox: {
    flexDirection: "row",
    alignItems: "center",
    height: 42,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 13 },

  // TABLES
  tableContainerCard: { borderRadius: 16, borderWidth: 1, padding: 2, overflow: "hidden" },
  frozenTableFlex: { flexDirection: "row", overflow: "hidden" },
  frozenLeftColumn: { width: 140, borderRightWidth: 1.5, zIndex: 10 },
  frozenThCell: { height: 42, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8, borderTopLeftRadius: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  frozenTdCell: { height: 46, justifyContent: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  frozenTfCell: { height: 44, justifyContent: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },

  sortableTh: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 3 },
  uHeaderRow: { height: 42, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  uThText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3, color: "#64748B" },
  uBodyRow: { height: 46, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  uTdNameText: { fontSize: 12.5, fontWeight: "700" },
  uTdText: { fontSize: 11.5, fontVariant: ["tabular-nums"], paddingHorizontal: 4 },
  uFooterRow: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  uTfText: { fontSize: 11, fontVariant: ["tabular-nums"], paddingHorizontal: 4, fontWeight: "800" },

  uActivityBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12 },
  uActivityText: { fontSize: 9.5, fontWeight: "800" },
  uPaidOffBadge: { backgroundColor: "rgba(34, 197, 94, 0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  uPaidOffText: { color: "#16A34A", fontSize: 11, fontWeight: "800" },
  uOverdueBadge: { backgroundColor: "rgba(239, 68, 68, 0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 12 },
  uOverdueText: { color: "#DC2626", fontSize: 9.5, fontWeight: "800" },

  emptyContainer: { padding: 36, alignItems: "center", gap: 6 },
  emptyTitle: { fontSize: 14, fontWeight: "800", marginTop: 4 },
  emptySub: { fontSize: 11.5, textAlign: "center", maxWidth: "80%" },
  unhideBtn: {
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },

  // BOTTOM SHEET MODAL
  sheetModalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheetModalCard: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 18, height: "92%" },
  sheetHandleWrap: { alignItems: "center", marginBottom: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  sheetTitle: { fontSize: 17, fontWeight: "900" },
  sheetSubtitle: { fontSize: 11, marginTop: 1 },
  modalSearchInputBox: { flexDirection: "row", alignItems: "center", height: 34, borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, gap: 4, width: 130 },
  modalSearchInput: { flex: 1, fontSize: 11.5 },
  statusChipsContent: { gap: 6, paddingVertical: 2 },
  statusChip: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 12, borderWidth: 1 },
  statusChipText: { fontSize: 10.5, fontWeight: "700" },
  sheetTableFlex: { flex: 1, overflow: "hidden" },
  loadingCenter: { flex: 1, justifyContent: "center", alignItems: "center" },

  sheetTableHeadRow: { height: 38, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  thCellText: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.3, color: "#64748B" },
  thSavedTint: { color: "#2563EB", backgroundColor: "rgba(59, 130, 246, 0.08)", paddingHorizontal: 4, borderRadius: 4 },
  thCashTint: { color: "#DC2626", backgroundColor: "rgba(239, 68, 68, 0.08)", paddingHorizontal: 4, borderRadius: 4 },
  thDedTint: { color: "#8B5CF6", backgroundColor: "rgba(139, 92, 246, 0.08)", paddingHorizontal: 4, borderRadius: 4 },
  thDisbTint: { color: "#D97706", backgroundColor: "rgba(245, 158, 11, 0.08)", paddingHorizontal: 4, borderRadius: 4 },

  sheetTableBodyRow: { height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  clientNameText: { fontSize: 12, fontWeight: "700" },
  clientIdText: { fontSize: 9.5, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  clientAmountText: { fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"], paddingHorizontal: 4 },
  clientBalSub: { fontSize: 9.5, fontVariant: ["tabular-nums"] },

  badgeClosed: { backgroundColor: "rgba(148, 163, 184, 0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeClosedText: { color: "#64748B", fontSize: 8, fontWeight: "800" },
  badgeOverdue: { backgroundColor: "rgba(239, 68, 68, 0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeOverdueText: { color: "#DC2626", fontSize: 8, fontWeight: "800" },
  badgePaidOff: { backgroundColor: "rgba(16, 185, 129, 0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgePaidOffText: { color: "#16A34A", fontSize: 8, fontWeight: "800" },
  badgeActiveLoan: { backgroundColor: "rgba(245, 158, 11, 0.12)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  badgeActiveLoanText: { color: "#D97706", fontSize: 8, fontWeight: "800" },

  // SINGLE CLIENT QUICK ACTION
  clientQuickCard: { width: "100%", maxWidth: 360, borderRadius: 24, borderWidth: 1, padding: 18, gap: 12 },
  clientQuickMetaRow: { flexDirection: "row", gap: 10 },
  clientMetaBox: { flex: 1, padding: 10, borderRadius: 12, backgroundColor: "rgba(100,116,139,0.06)" },
  clientMetaLabel: { fontSize: 10, fontWeight: "600" },
  clientMetaValue: { fontSize: 14, fontWeight: "900", marginTop: 2 },
  clientQuickActionsRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  clientActionPill: { flex: 1, flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 12, borderRadius: 12 },
  clientActionPillText: { color: "#fff", fontSize: 12, fontWeight: "800" },

  // REGISTRATIONS TABLE
  regHeadRow: { height: 38, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  regDataRow: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  regClientName: { fontSize: 12, fontWeight: "700" },
  regUnionText: { fontSize: 11 },
  regDateText: { fontSize: 11 },
  regFeeText: { fontSize: 12, fontWeight: "800", fontVariant: ["tabular-nums"] },

  // CALENDAR RANGE MODAL
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", alignItems: "center", padding: 18 },
  calCardSheet: { width: "100%", maxWidth: 360, borderRadius: 24, borderWidth: 1, padding: 18, gap: 10 },
  calModalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  calModalTitle: { fontSize: 16, fontWeight: "900" },
  calModalSub: { fontSize: 11, marginTop: 1 },
  calCloseBtn: { padding: 2 },

  rangeTabsBox: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 14, borderWidth: 1, padding: 6, marginVertical: 4 },
  rangeTabItem: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10, alignItems: "center" },
  rangeTabLabel: { fontSize: 9, fontWeight: "900", letterSpacing: 0.5 },
  rangeTabValue: { fontSize: 12, fontWeight: "800", marginTop: 1 },

  presetQuickRow: { flexDirection: "row", gap: 5, justifyContent: "space-between" },
  quickPresetChip: { flex: 1, paddingVertical: 6, borderRadius: 10, borderWidth: 1, alignItems: "center" },
  quickPresetText: { fontSize: 10, fontWeight: "700" },

  calNavRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 4 },
  calNavBtn: { padding: 4 },
  calNavMonthText: { fontSize: 14, fontWeight: "800" },
  calWeekRow: { flexDirection: "row", justifyContent: "space-around", marginVertical: 2 },
  calWeekText: { width: 36, textAlign: "center", fontSize: 11, fontWeight: "700" },

  calGrid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-start" },
  calDayBox: { width: "14.28%", height: 36, alignItems: "center", justifyContent: "center", marginVertical: 1 },
  calRangeStartTrack: { borderTopLeftRadius: 18, borderBottomLeftRadius: 18, backgroundColor: "rgba(59,130,246,0.18)" },
  calRangeEndTrack: { borderTopRightRadius: 18, borderBottomRightRadius: 18, backgroundColor: "rgba(59,130,246,0.18)" },
  calDayCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  calDayText: { fontSize: 12.5, fontWeight: "600" },

  calApplyBtn: { borderRadius: 14, overflow: "hidden", marginTop: 4 },
  calApplyGradient: { paddingVertical: 13, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  calApplyBtnText: { color: "#fff", fontSize: 13, fontWeight: "800" },
});