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
  saveRegistrationOffline,
  getPendingRegistrationsCount,
  processRegistrationsPendingSync,
  checkDuplicateClientOffline,
  cacheUnions,
  loadCachedUnions,
  cacheLoanPlans,
  loadCachedLoanPlans,
  cacheClients,
} from "../../src/db/database";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import { router } from "expo-router";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_UNIONS = `${API_BASE}/api/union_api.php`;
const API_LOAN_PLANS = `${API_BASE}/api/loan_plans_api.php`;
const API_REGISTRATION = `${API_BASE}/api/registration_api.php`;

const CACHE_KEY_PRIVACY = "cupad_cache_privacy_hide_amounts";

const RELATIONSHIPS = ["Spouse", "Sibling", "Parent", "Business Partner", "Union Member", "Other"];

export type LoanPlan = {
  id: string | number;
  duration: number | string;
  unit: string;
  rate: number | string;
  registration_amount: number | string;
  min_amount?: number | string;
  name?: string;
  plan_type?: string;
};

// Default fallback plans if SQLite is empty
const DEFAULT_FALLBACK_PLANS: LoanPlan[] = [
  { id: "daily_23", duration: 23, unit: "Days (Daily)", rate: 0.15, registration_amount: 1000 },
  { id: "daily_30", duration: 30, unit: "Days (Daily)", rate: 0.15, registration_amount: 1000 },
  { id: "1", duration: 3, unit: "Months", rate: 0.20, registration_amount: 1500 },
  { id: "2", duration: 6, unit: "Months", rate: 0.25, registration_amount: 2000 },
];

/**
 * Sorts loan plans with daily plans first and shortest duration ascending.
 */
function prioritizeDailyPlans(plans: LoanPlan[]): LoanPlan[] {
  if (!Array.isArray(plans)) return [];
  return [...plans].sort((a, b) => {
    const isADaily =
      String(a.unit || "").toLowerCase().includes("day") ||
      String(a.name || "").toLowerCase().includes("daily") ||
      String(a.plan_type || "").toLowerCase().includes("daily");

    const isBDaily =
      String(b.unit || "").toLowerCase().includes("day") ||
      String(b.name || "").toLowerCase().includes("daily") ||
      String(b.plan_type || "").toLowerCase().includes("daily");

    if (isADaily && !isBDaily) return -1;
    if (!isADaily && isBDaily) return 1;

    return (Number(a.duration) || 0) - (Number(b.duration) || 0);
  });
}

/**
 * Identifies if a client's status is non-active (eligible for re-enrollment)
 */
function isNonActiveStatus(status?: string | null): boolean {
  if (!status) return false;
  const s = String(status).trim().toLowerCase();
  return (
    s === "inactive" ||
    s === "non-active" ||
    s === "non_active" ||
    s === "closed" ||
    s === "dormant" ||
    s === "deactivated" ||
    s === "exited"
  );
}

type UnionItem = {
  uuid?: string;
  id?: string | number;
  name: string;
  description?: string;
  branch?: string;
  client_count?: number;
};

type RegStats = {
  total_clients: number;
  total_registration_fees: number;
};

type DuplicateStatus = {
  checking: boolean;
  exists: boolean;
  has_funds: boolean;
  is_blocked: boolean;
  message: string;
  type: "clear" | "success" | "warning" | "error";
};

type TelcoInfo = { name: string; bg: string; text: string; border: string };

function detectNigerianTelco(cleanedPhone: string): TelcoInfo | null {
  if (cleanedPhone.length < 4) return null;
  const prefix = cleanedPhone.startsWith("234") ? "0" + cleanedPhone.slice(3, 6) : cleanedPhone.slice(0, 4);

  const mtn = ["0803", "0806", "0703", "0706", "0813", "0816", "0810", "0814", "0903", "0906", "0913", "0916"];
  const glo = ["0805", "0807", "0705", "0815", "0811", "0905", "0915"];
  const airtel = ["0802", "0808", "0708", "0812", "0701", "0902", "0901", "0904", "0907", "0912"];
  const etisalat = ["0809", "0817", "0818", "0909", "0908"];

  if (mtn.includes(prefix)) return { name: "MTN", bg: "rgba(250, 204, 21, 0.15)", text: "#EAB308", border: "rgba(250, 204, 21, 0.4)" };
  if (glo.includes(prefix)) return { name: "GLO", bg: "rgba(34, 197, 94, 0.15)", text: "#22C55E", border: "rgba(34, 197, 94, 0.4)" };
  if (airtel.includes(prefix)) return { name: "AIRTEL", bg: "rgba(239, 68, 68, 0.15)", text: "#EF4444", border: "rgba(239, 68, 68, 0.4)" };
  if (etisalat.includes(prefix)) return { name: "9MOBILE", bg: "rgba(16, 185, 129, 0.15)", text: "#10B981", border: "rgba(16, 185, 129, 0.4)" };
  return null;
}

function formatNaira(amount: number | string, hide = false): string {
  if (hide) return "••••••••";
  const num = Math.abs(Number(amount) || 0);
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function formatPhone(input: string): string {
  const cleaned = input.replace(/\D/g, "");
  if (cleaned.length > 8) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7, 11)}`.trim();
  }
  if (cleaned.length > 4) {
    return `${cleaned.slice(0, 4)} ${cleaned.slice(4, 8)}`.trim();
  }
  return cleaned;
}

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

export default function RegisterClientScreen() {
  const { colors, isDark } = useTheme();

  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.09)";
  const orbColor2 = isDark ? "rgba(14, 165, 233, 0.13)" : "rgba(14, 165, 233, 0.07)";

  // Form Fields
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [selectedUnion, setSelectedUnion] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState<string | number>("");
  const [guarantorName, setGuarantorName] = useState("");
  const [guarantorPhone, setGuarantorPhone] = useState("");
  const [guarantorRelationship, setGuarantorRelationship] = useState("");

  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Field Refs
  const phoneRef = useRef<any>(null);
  const addressRef = useRef<any>(null);
  const guarantorNameRef = useRef<any>(null);
  const guarantorPhoneRef = useRef<any>(null);

  // Metadata
  const [unionList, setUnionList] = useState<UnionItem[]>([]);
  const [unionSearchQuery, setUnionSearchQuery] = useState("");
  const [loadingUnions, setLoadingUnions] = useState(false);

  const [loanPlans, setLoanPlans] = useState<LoanPlan[]>(DEFAULT_FALLBACK_PLANS);
  const [loadingPlans, setLoadingPlans] = useState(false);
  const [stats, setStats] = useState<RegStats>({ total_clients: 0, total_registration_fees: 0 });

  const [branchName, setBranchName] = useState("");
  const [officerUsername, setOfficerUsername] = useState("");
  const [hideBalances, setHideBalances] = useState(false);

  const [offlineQueueCount, setOfflineQueueCount] = useState(0);
  const [syncingOffline, setSyncingOffline] = useState(false);

  const [dupStatus, setDupStatus] = useState<DuplicateStatus>({
    checking: false,
    exists: false,
    has_funds: false,
    is_blocked: false,
    message: "",
    type: "clear",
  });

  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showUnionPicker, setShowUnionPicker] = useState(false);
  const [showPlanPicker, setShowPlanPicker] = useState(false);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [lastRegisteredClient, setLastRegisteredClient] = useState<any>(null);

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
    showToast(`Token #${code} copied to clipboard`);
  };

  const duplicateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const currentPlan = useMemo(() => {
    return loanPlans.find((p) => String(p.id) === String(selectedPlanId)) || null;
  }, [loanPlans, selectedPlanId]);

  const currentFee = useMemo(() => {
    if (currentPlan && currentPlan.registration_amount) {
      return Number(currentPlan.registration_amount);
    }
    return 1000;
  }, [currentPlan]);

  const clientTelco = useMemo(() => detectNigerianTelco(phone.replace(/\D/g, "")), [phone]);
  const guarantorTelco = useMemo(() => detectNigerianTelco(guarantorPhone.replace(/\D/g, "")), [guarantorPhone]);

  const formProgress = useMemo(() => {
    let score = 0;
    if (name.trim().length >= 3) score += 25;
    if (phone.replace(/\D/g, "").length >= 10) score += 20;
    if (selectedUnion) score += 20;
    if (selectedPlanId) score += 15;
    if (address.trim().length >= 4) score += 10;
    if (guarantorName.trim().length >= 2 || guarantorPhone.trim().length >= 10) score += 10;
    return Math.min(score, 100);
  }, [name, phone, selectedUnion, selectedPlanId, address, guarantorName, guarantorPhone]);

  const isFormValid = useMemo(() => {
    return (
      name.trim().length >= 3 &&
      selectedUnion.length > 0 &&
      selectedPlanId !== "" &&
      !dupStatus.is_blocked &&
      !dupStatus.has_funds &&
      !dupStatus.checking &&
      dupStatus.type !== "error"
    );
  }, [name, selectedUnion, selectedPlanId, dupStatus.is_blocked, dupStatus.has_funds, dupStatus.checking, dupStatus.type]);

  const filteredUnions = useMemo(() => {
    if (!unionSearchQuery.trim()) return unionList;
    const q = unionSearchQuery.toLowerCase();
    return unionList.filter((u) => u.name.toLowerCase().includes(q));
  }, [unionList, unionSearchQuery]);

  const toggleHideBalances = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !hideBalances;
    setHideBalances(next);
    await AsyncStorage.setItem(CACHE_KEY_PRIVACY, String(next));
  };

  const checkOfflineQueue = useCallback(async () => {
    try {
      const count = await getPendingRegistrationsCount();
      setOfflineQueueCount(count);
      return count;
    } catch {
      setOfflineQueueCount(0);
      return 0;
    }
  }, []);

  const loadUserSession = useCallback(async () => {
    try {
      const [stored, storedPrivacy] = await Promise.all([
        AsyncStorage.getItem("cupad_user"),
        AsyncStorage.getItem(CACHE_KEY_PRIVACY),
      ]);
      if (storedPrivacy !== null) setHideBalances(storedPrivacy === "true");

      if (stored) {
        const u = JSON.parse(stored);
        const resolvedBranch = u.branch_name || u.branch || "";
        if (resolvedBranch && resolvedBranch !== "Main Branch") {
          setBranchName(resolvedBranch);
        }
        if (u.username) setOfficerUsername(u.username);
        return { username: u.username, branch: resolvedBranch };
      }
    } catch {}
    return { username: "", branch: "" };
  }, []);

  // Load directly from local SQLite database
  const loadSqliteData = useCallback(async () => {
    try {
      const sqlUnions = await loadCachedUnions();
      if (sqlUnions && sqlUnions.length > 0) {
        setUnionList(sqlUnions);
        if (!selectedUnion) setSelectedUnion(sqlUnions[0].name);
      }

      const sqlPlans = await loadCachedLoanPlans();
      if (sqlPlans && sqlPlans.length > 0) {
        const prioritized = prioritizeDailyPlans(sqlPlans);
        setLoanPlans(prioritized);
        if (!selectedPlanId) setSelectedPlanId(prioritized[0].id);
      } else {
        const prioritized = prioritizeDailyPlans(DEFAULT_FALLBACK_PLANS);
        setLoanPlans(prioritized);
        if (!selectedPlanId && prioritized.length > 0) {
          setSelectedPlanId(prioritized[0].id);
        }
      }
    } catch (e) {
      console.log("SQLite load error:", e);
    }
  }, [selectedUnion, selectedPlanId]);

  const fetchLoanPlans = useCallback(
    async (username: string) => {
      if (!username) return;
      setLoadingPlans(true);
      try {
        const res = await axios.get(
          `${API_LOAN_PLANS}?action=get_plans&username=${encodeURIComponent(username)}`,
          { timeout: 5000 }
        );

        if (res.data?.success && Array.isArray(res.data.plans) && res.data.plans.length > 0) {
          const fetchedPlans: LoanPlan[] = prioritizeDailyPlans(res.data.plans);
          setLoanPlans(fetchedPlans);
          if (res.data.stats) setStats(res.data.stats);

          if (!selectedPlanId || !fetchedPlans.some((p) => String(p.id) === String(selectedPlanId))) {
            setSelectedPlanId(fetchedPlans[0].id);
          }

          await cacheLoanPlans(fetchedPlans);
        }
      } catch (err) {
        try {
          const sqlPlans = await loadCachedLoanPlans();
          if (sqlPlans && sqlPlans.length > 0) {
            const prioritized = prioritizeDailyPlans(sqlPlans);
            setLoanPlans(prioritized);
            if (!selectedPlanId) setSelectedPlanId(prioritized[0].id);
          }
        } catch {}
      } finally {
        setLoadingPlans(false);
      }
    },
    [selectedPlanId]
  );

  const fetchUnions = useCallback(
    async (username: string) => {
      if (!username) return;
      setLoadingUnions(true);
      try {
        const res = await axios.get(
          `${API_UNIONS}?action=get_unions&username=${encodeURIComponent(username)}`,
          { timeout: 5000 }
        );
        if (res.data?.success && Array.isArray(res.data.unions)) {
          const fetchedUnions: UnionItem[] = res.data.unions.map((u: any) => ({
            uuid: u.uuid || "",
            name: u.name || "",
            description: u.description || "",
            branch: u.branch || "",
            client_count: u.client_count || 0,
          }));
          setUnionList(fetchedUnions);
          if (fetchedUnions.length > 0 && !selectedUnion) setSelectedUnion(fetchedUnions[0].name);
          if (res.data.branch && res.data.branch !== "Main Branch") setBranchName(res.data.branch);

          await cacheUnions(res.data.unions || [], username);
        }
      } catch (err) {
        try {
          const cached = await loadCachedUnions();
          if (cached && cached.length > 0) {
            setUnionList(cached);
            if (!selectedUnion) setSelectedUnion(cached[0].name);
          }
        } catch {}
      } finally {
        setLoadingUnions(false);
      }
    },
    [selectedUnion]
  );

  /**
   * Core Sync Routine: Can run silently in background or interactively with alerts.
   */
  const handleSyncOffline = useCallback(
    async (silent = false) => {
      if (syncingOffline) return;

      const currentCount = await checkOfflineQueue();
      if (currentCount === 0) return;

      setSyncingOffline(true);
      if (!silent) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      try {
        // Pass username into SQLite sync processor
        const res: any = await processRegistrationsPendingSync(officerUsername);
        const remainingCount = await checkOfflineQueue();

        if (res && res.syncedCount > 0) {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          showToast(`Synced ${res.syncedCount} client registration(s)`);
          
          if (officerUsername) {
            fetchLoanPlans(officerUsername);
            fetchUnions(officerUsername);
          }
        } else if (!silent) {
          const errDetail =
            res?.error ||
            res?.message ||
            "Server did not process offline records. Please verify internet connection.";
          Alert.alert("Sync Incomplete", errDetail);
        }
      } catch (err: any) {
        if (!silent) {
          Alert.alert("Sync Error", err?.message || "Could not complete offline synchronization.");
        }
      } finally {
        setSyncingOffline(false);
      }
    },
    [syncingOffline, officerUsername, checkOfflineQueue, fetchLoanPlans, fetchUnions]
  );

  const loadAllData = useCallback(async () => {
    try {
      const session = await loadUserSession();
      await checkOfflineQueue();
      if (!session.username) return;

      // Fetch live data
      await Promise.all([fetchLoanPlans(session.username), fetchUnions(session.username)]);

      // Auto-sync pending offline registrations in the background when app connects
      await handleSyncOffline(true);
    } catch {
    } finally {
      setRefreshing(false);
    }
  }, [loadUserSession, fetchLoanPlans, fetchUnions, checkOfflineQueue, handleSyncOffline]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    loadUserSession().then(() => {
      loadSqliteData().then(() => loadAllData());
    });
  }, [fadeAnim, loadUserSession, loadSqliteData, loadAllData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    loadAllData().then(() => {
      // Trigger interactive sync check on manual pull down
      handleSyncOffline(false);
    });
  }, [loadAllData, handleSyncOffline]);

  /**
   * OFFLINE SQLITE-FIRST LOGIC:
   * Inspects Client Status, Savings Balance, and Outstanding Loans directly from SQLite.
   */
  const checkDuplicateClient = useCallback(
    async (clientName: string, unionName: string) => {
      const trimmed = clientName.trim();
      if (!trimmed) {
        setDupStatus({ checking: false, exists: false, has_funds: false, is_blocked: false, message: "", type: "clear" });
        return;
      }

      setDupStatus((prev) => ({
        ...prev,
        checking: true,
        message: "Checking client, savings & loan records offline...",
      }));

      // 1. INSTANT LOCAL SQLITE VERIFICATION
      try {
        const localCheck = await checkDuplicateClientOffline(trimmed, unionName);

        if (localCheck && localCheck.exists) {
          const clientData = (localCheck as any).client || (localCheck as any).details || localCheck;

          const existingUnion = String(
            clientData.union || clientData.union_name || localCheck.union || unionName
          ).trim();
          const isSameUnion =
            !existingUnion ||
            existingUnion.toLowerCase() === String(unionName).trim().toLowerCase();

          const rawStatus = String(
            clientData.status || localCheck.status || ((localCheck as any).is_active ? "active" : "")
          ).trim();
          const isNonActive = isNonActiveStatus(rawStatus);

          // Extract savings and loan balances from SQLite
          const savingsBal = Number(
            clientData.savings_balance ??
            clientData.savings ??
            (localCheck as any).savings ??
            0
          );
          const loanBal = Number(
            clientData.outstanding_loan ??
            clientData.loan ??
            clientData.loan_balance ??
            (localCheck as any).loan ??
            0
          );
          const hasFunds = localCheck.has_funds || savingsBal > 0 || loanBal > 0;

          // LOGIC 1: Active savings or loan debt always blocks registration
          if (hasFunds) {
            setDupStatus({
              checking: false,
              exists: true,
              has_funds: true,
              is_blocked: true,
              message: `Blocked: Active balance detected (${formatNaira(savingsBal)} savings, ${formatNaira(loanBal)} loan). Outstanding balance must be settled first.`,
              type: "error",
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
          }

          // LOGIC 2: Active member in the SAME union -> STRICTLY BLOCKED
          if (isSameUnion && !isNonActive) {
            setDupStatus({
              checking: false,
              exists: true,
              has_funds: false,
              is_blocked: true,
              message: `Blocked: An active member named "${trimmed}" already exists in ${unionName}. Member must be moved to non-active before re-registering.`,
              type: "error",
            });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            return;
          }

          // LOGIC 3: Member in SAME union moved to non-active with ZERO balance -> CLEARED FOR RE-ENROLLMENT
          if (isSameUnion && isNonActive) {
            setDupStatus({
              checking: false,
              exists: true,
              has_funds: false,
              is_blocked: false,
              message: `Cleared for Re-enrollment: Previous profile in ${unionName} is non-active with zero savings and loan balance.`,
              type: "warning",
            });
            return;
          }

          // LOGIC 4: Client in DIFFERENT union with zero debt and zero savings
          setDupStatus({
            checking: false,
            exists: true,
            has_funds: false,
            is_blocked: false,
            message: `Client exists in ${existingUnion} with clear balance. Ready for enrollment in ${unionName}.`,
            type: "warning",
          });
          return;
        }

        // Clean in local SQLite
        setDupStatus({
          checking: false,
          exists: false,
          has_funds: false,
          is_blocked: false,
          message: localCheck?.details?.message || localCheck?.client?.message || "Identity verified clear for registration (Offline SQLite).",
          type: "success",
        });
      } catch (e) {
        setDupStatus({
          checking: false,
          exists: false,
          has_funds: false,
          is_blocked: false,
          message: "Identity verified clear for registration.",
          type: "success",
        });
      }

      // 2. NON-BLOCKING ONLINE BACKGROUND VERIFICATION
      axios
        .get(
          `${API_REGISTRATION}?action=check_duplicate&name=${encodeURIComponent(trimmed)}&union=${encodeURIComponent(
            unionName
          )}&username=${encodeURIComponent(officerUsername)}`,
          { timeout: 1800 }
        )
        .then((res) => {
          if (res.data?.success && res.data.exists) {
            const details = res.data.details || {};
            const existingUnion = String(details.union || details.union_name || unionName).trim();
            const isSameUnion =
              !existingUnion ||
              existingUnion.toLowerCase() === String(unionName).trim().toLowerCase();

            const rawStatus = String(details.status || (res.data.is_active ? "active" : "")).trim();
            const isNonActive = isNonActiveStatus(rawStatus);

            const savingsBal = Number(details.savings ?? details.savings_balance ?? 0);
            const loanBal = Number(details.loan ?? details.outstanding_loan ?? 0);
            const hasFunds = res.data.has_funds || savingsBal > 0 || loanBal > 0;

            if (hasFunds) {
              setDupStatus({
                checking: false,
                exists: true,
                has_funds: true,
                is_blocked: true,
                message: `Blocked: Active balance detected (${formatNaira(savingsBal)} savings, ${formatNaira(loanBal)} loan). Outstanding balance must be settled first.`,
                type: "error",
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } else if (isSameUnion && !isNonActive) {
              setDupStatus({
                checking: false,
                exists: true,
                has_funds: false,
                is_blocked: true,
                message: `Blocked: An active member named "${trimmed}" already exists in ${unionName}. Member must be moved to non-active before re-registering.`,
                type: "error",
              });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } else if (isSameUnion && isNonActive) {
              setDupStatus({
                checking: false,
                exists: true,
                has_funds: false,
                is_blocked: false,
                message: `Cleared for Re-enrollment: Previous profile in ${unionName} is non-active with zero balance.`,
                type: "warning",
              });
            } else {
              setDupStatus({
                checking: false,
                exists: true,
                has_funds: false,
                is_blocked: false,
                message: `Client exists in ${existingUnion} with clear balance. Ready for enrollment in ${unionName}.`,
                type: "warning",
              });
            }
          }
        })
        .catch(() => {
          // Silently ignore network failures in offline mode; SQLite check is active
        });
    },
    [officerUsername]
  );

  const handleNameChange = (val: string) => {
    setName(val);
    if (duplicateTimeout.current) clearTimeout(duplicateTimeout.current);

    if (!val.trim()) {
      setDupStatus({ checking: false, exists: false, has_funds: false, is_blocked: false, message: "", type: "clear" });
      return;
    }

    duplicateTimeout.current = setTimeout(() => {
      checkDuplicateClient(val, selectedUnion);
    }, 280);
  };

  const handleUnionSelect = (u: string) => {
    setSelectedUnion(u);
    setShowUnionPicker(false);
    setUnionSearchQuery("");
    Haptics.selectionAsync();
    if (name.trim()) checkDuplicateClient(name, u);
  };

  const handleSubmit = async () => {
    if (!name.trim()) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Legal Name Required", "Please enter the client's full legal name.");
      return;
    }

    if (!selectedUnion) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Union Selection Required", "Please assign the client to an authorized Union.");
      return;
    }

    if (!selectedPlanId) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      Alert.alert("Plan Required", "Please select a Loan Plan for this member.");
      return;
    }

    if (dupStatus.is_blocked || dupStatus.has_funds || dupStatus.type === "error") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(
        "Registration Restricted",
        dupStatus.message || "An active client with this name already exists in this union. Move the existing client to non-active before enrolling again."
      );
      return;
    }

    setSubmitting(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const payload = {
      name: name.trim(),
      phone: phone.replace(/\s/g, ""),
      address: address.trim(),
      union: selectedUnion,
      union_name: selectedUnion,
      plan_id: selectedPlanId,
      branch: branchName || "Branch",
      guarantor_name: guarantorName.trim(),
      guarantor_phone: guarantorPhone.replace(/\s/g, ""),
      guarantor_relationship: guarantorRelationship,
      officer_username: officerUsername,
      timestamp: Date.now(),
    };

    try {
      // 1. ATTEMPT DIRECT ONLINE SUBMISSION
      const res = await axios.post(`${API_REGISTRATION}?action=add_client`, payload, {
        headers: { "Content-Type": "application/json" },
        timeout: 4500,
      });

      if (res.data?.success) {
        const assignedId = res.data.client_id || res.data.id || `CPD-${Math.floor(100000 + Math.random() * 900000)}`;

        await cacheClients(
          [
            {
              id: assignedId,
              ...payload,
              savings_balance: 0,
              outstanding_loan: 0,
              loan_principal: 0,
              status: "active",
            },
          ],
          officerUsername
        );

        setStats((prev) => ({
          total_clients: prev.total_clients + 1,
          total_registration_fees: prev.total_registration_fees + currentFee,
        }));

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setLastRegisteredClient({
          ...payload,
          fee: currentFee,
          plan: currentPlan,
          receipt_id: assignedId,
        });
        setShowSuccessModal(true);
      } else {
        // Explicit rejection by server logic
        Alert.alert("Registration Failed", res.data?.error || "Could not register client.");
      }
    } catch {
      // 2. OFFLINE FALLBACK: STORE SAFELY IN SQLITE DATABASE
      try {
        const tempId = `REG-OFF-${Date.now()}`;
        const offlineRecord = { ...payload, temp_id: tempId };

        // Save into offline registration sync queue
        await saveRegistrationOffline(offlineRecord);

        // Also cache locally into SQLite clients table so local duplicate verification detects this client immediately
        await cacheClients(
          [
            {
              id: tempId,
              ...payload,
              savings_balance: 0,
              outstanding_loan: 0,
              loan_principal: 0,
              status: "active",
            },
          ],
          officerUsername
        );

        await checkOfflineQueue();

        setStats((prev) => ({
          total_clients: prev.total_clients + 1,
          total_registration_fees: prev.total_registration_fees + currentFee,
        }));

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setLastRegisteredClient({
          ...payload,
          fee: currentFee,
          plan: currentPlan,
          receipt_id: tempId,
        });
        setShowSuccessModal(true);
      } catch (sqlErr) {
        console.log("SQLite offline save error:", sqlErr);
        Alert.alert("Offline Save Error", "Unable to store registration locally in SQLite database.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddAnother = () => {
    setName("");
    setPhone("");
    setAddress("");
    setGuarantorName("");
    setGuarantorPhone("");
    setGuarantorRelationship("");
    setDupStatus({ checking: false, exists: false, has_funds: false, is_blocked: false, message: "", type: "clear" });
    setShowSuccessModal(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleShareReceipt = async () => {
    if (!lastRegisteredClient) return;
    try {
      Haptics.selectionAsync();
      await Share.share({
        message: `Cupad Microfinance Member Enrollment\nClient: ${lastRegisteredClient.name}\nUnion: ${lastRegisteredClient.union}\nRegistration Fee: ${formatNaira(
          lastRegisteredClient.fee
        )}\nRef Token: ${lastRegisteredClient.receipt_id}`,
      });
    } catch {}
  };

  const displayBranch = branchName || "Main Branch";

  const getInputStyle = (field: string) => {
    const isFocused = focusedField === field;
    return [
      styles.inputWrap,
      {
        backgroundColor: isFocused
          ? isDark
            ? "rgba(37, 99, 235, 0.12)"
            : "rgba(37, 99, 235, 0.05)"
          : colors.background,
        borderColor: isFocused ? colors.primary : glassBorder,
        borderWidth: 1,
      },
    ];
  };

  return (
    <CoScreenWrapper>
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
          <Ionicons name="checkmark-circle" size={16} color="#10B981" />
          <Text style={[styles.toastText, { color: colors.text }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 14 : 0}
        style={{ flex: 1 }}
      >
        <View style={styles.container}>
          {/* OFFLINE SYNC ALERT BANNER */}
          {offlineQueueCount > 0 && (
            <Pressable
              onPress={() => handleSyncOffline(false)}
              disabled={syncingOffline}
              style={({ pressed }) => [
                styles.syncBanner,
                {
                  backgroundColor: "rgba(245, 158, 11, 0.15)",
                  borderColor: "#F59E0B",
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                <View style={styles.syncIndicatorPulse}>
                  <Ionicons name="cloud-offline" size={14} color="#D97706" />
                </View>
                <Text style={[styles.syncBannerText, { color: isDark ? "#FDE68A" : "#92400E" }]}>
                  {offlineQueueCount} record{offlineQueueCount > 1 ? "s" : ""} saved offline in SQLite (ready to sync)
                </Text>
              </View>
              {syncingOffline ? (
                <ActivityIndicator size="small" color="#D97706" />
              ) : (
                <View style={styles.syncBtnPill}>
                  <Text style={styles.syncBtnPillText}>Sync Now</Text>
                </View>
              )}
            </Pressable>
          )}

          <Animated.ScrollView
            style={{ flex: 1, opacity: fadeAnim }}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
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
              <View style={styles.heroMetaRow}>
                <View
                  style={[
                    styles.heroTagPill,
                    { backgroundColor: offlineQueueCount > 0 ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)" },
                  ]}
                >
                  <View
                    style={[
                      styles.statusPulseDot,
                      { backgroundColor: offlineQueueCount > 0 ? "#F59E0B" : "#10B981" },
                    ]}
                  />
                  <Text
                    style={[
                      styles.heroTagText,
                      { color: offlineQueueCount > 0 ? "#F59E0B" : "#10B981" },
                    ]}
                  >
                    {offlineQueueCount > 0 ? "SQLITE OFFLINE ACTIVE" : "ONLINE CONNECTED"}
                  </Text>
                </View>

                <View style={styles.branchPill}>
                  <Ionicons name="business" size={11} color={colors.primary} />
                  <Text style={[styles.branchPillText, { color: colors.text }]} numberOfLines={1}>
                    {displayBranch}
                  </Text>
                </View>
              </View>

              <View style={styles.heroMainBalanceSection}>
                <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                  GROSS REGISTRATION REVENUE
                </Text>
                <View style={styles.heroAmountRow}>
                  <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                    {formatNaira(stats.total_registration_fees, hideBalances)}
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
                    Dossier Completion: {formProgress}% Ready
                  </Text>
                  <Text style={[styles.ratioLabel, { color: formProgress === 100 ? "#10B981" : colors.textMuted }]}>
                    {formProgress === 100 ? "Ready to submit" : "Incomplete"}
                  </Text>
                </View>
                <View style={styles.ratioTrack}>
                  <View
                    style={[
                      styles.ratioFillBar,
                      {
                        width: `${formProgress}%`,
                        backgroundColor: formProgress === 100 ? "#10B981" : colors.primary,
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
                    <Ionicons name="people" size={11} color={colors.primary} />
                    <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Registered Savers</Text>
                  </View>
                  <Text style={[styles.metricItemValue, { color: colors.text }]}>
                    {stats.total_clients}
                  </Text>
                  <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Portfolio members</Text>
                </View>

                <View
                  style={[
                    styles.metricGridItem,
                    { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                  ]}
                >
                  <View style={styles.metricItemHeader}>
                    <Ionicons name="pricetag" size={11} color="#10B981" />
                    <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Plan Fee Due</Text>
                  </View>
                  <Text style={[styles.metricItemValue, { color: "#10B981" }]}>
                    {formatNaira(currentFee, hideBalances)}
                  </Text>
                  <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>
                    Payable upon enrollment
                  </Text>
                </View>
              </View>
            </LinearGradient>

            {/* FORM CONTAINER */}
            <View style={[styles.formContainer, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              {/* SECTION 1: IDENTITY & UNION */}
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionBadge, { backgroundColor: `${colors.primary}18` }]}>
                  <Ionicons name="person" size={13} color={colors.primary} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>1. Account & Membership</Text>
              </View>

              <View style={styles.formSection}>
                {/* NAME INPUT */}
                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.inputLabel, { color: colors.textMuted }]}>LEGAL FULL NAME</Text>
                    <Text style={styles.requiredAsterisk}>*</Text>
                  </View>
                  <View style={getInputStyle("name")}>
                    <Ionicons name="person-outline" size={17} color={focusedField === "name" ? colors.primary : colors.textMuted} />
                    <TextInput
                      value={name}
                      onChangeText={handleNameChange}
                      onFocus={() => setFocusedField("name")}
                      onBlur={() => setFocusedField(null)}
                      placeholder="e.g. Babatunde Sanusi"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="words"
                      returnKeyType="next"
                      onSubmitEditing={() => phoneRef.current?.focus()}
                      style={[styles.inputField, { color: colors.text }]}
                    />
                    {dupStatus.checking && <ActivityIndicator size="small" color={colors.primary} />}
                    {name.length > 0 && !dupStatus.checking && (
                      <Pressable onPress={() => handleNameChange("")} hitSlop={10}>
                        <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                      </Pressable>
                    )}
                  </View>

                  {/* DUPLICATE STATUS BANNER */}
                  {dupStatus.message ? (
                    <View
                      style={[
                        styles.dupBanner,
                        {
                          backgroundColor:
                            dupStatus.type === "success"
                              ? "rgba(16, 185, 129, 0.12)"
                              : dupStatus.type === "error"
                              ? "rgba(239, 68, 68, 0.12)"
                              : "rgba(245, 158, 11, 0.12)",
                          borderColor:
                            dupStatus.type === "success"
                              ? "rgba(16, 185, 129, 0.3)"
                              : dupStatus.type === "error"
                              ? "rgba(239, 68, 68, 0.3)"
                              : "rgba(245, 158, 11, 0.3)",
                        },
                      ]}
                    >
                      <Ionicons
                        name={
                          dupStatus.type === "success"
                            ? "checkmark-circle"
                            : dupStatus.type === "error"
                            ? "alert-circle"
                            : "information-circle"
                        }
                        size={15}
                        color={
                          dupStatus.type === "success"
                            ? "#10B981"
                            : dupStatus.type === "error"
                            ? "#EF4444"
                            : "#F59E0B"
                        }
                      />
                      <Text
                        style={[
                          styles.dupBannerText,
                          {
                            color:
                              dupStatus.type === "success"
                                ? "#10B981"
                                : dupStatus.type === "error"
                                ? "#EF4444"
                                : "#F59E0B",
                          },
                        ]}
                      >
                        {dupStatus.message}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* PHONE INPUT */}
                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.inputLabel, { color: colors.textMuted }]}>PHONE NUMBER</Text>
                  </View>
                  <View style={getInputStyle("phone")}>
                    <View style={styles.countryCodeBadge}>
                      <Text style={styles.flag}>🇳🇬</Text>
                      <Text style={[styles.countryCode, { color: colors.textMuted }]}>+234</Text>
                    </View>
                    <TextInput
                      ref={phoneRef}
                      value={phone}
                      onChangeText={(val) => setPhone(formatPhone(val))}
                      onFocus={() => setFocusedField("phone")}
                      onBlur={() => setFocusedField(null)}
                      placeholder="0800 000 0000"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="phone-pad"
                      maxLength={14}
                      returnKeyType="next"
                      onSubmitEditing={() => addressRef.current?.focus()}
                      style={[styles.inputField, { color: colors.text }]}
                    />
                    {clientTelco && (
                      <View style={[styles.telcoPill, { backgroundColor: clientTelco.bg, borderColor: clientTelco.border }]}>
                        <Text style={[styles.telcoPillText, { color: clientTelco.text }]}>{clientTelco.name}</Text>
                      </View>
                    )}
                    {phone.length > 0 && (
                      <Pressable onPress={() => setPhone("")} hitSlop={10}>
                        <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                      </Pressable>
                    )}
                  </View>
                </View>

                {/* UNION SELECTION */}
                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.inputLabel, { color: colors.textMuted }]}>ASSIGNED UNION</Text>
                    <Text style={styles.requiredAsterisk}>*</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowUnionPicker(true);
                    }}
                    style={({ pressed }) => [
                      styles.inputWrap,
                      {
                        backgroundColor: colors.background,
                        borderColor: glassBorder,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      },
                    ]}
                  >
                    <Ionicons name="people-outline" size={17} color={selectedUnion ? colors.primary : colors.textMuted} />
                    <View style={{ flex: 1, marginHorizontal: 8 }}>
                      <Text numberOfLines={1} style={[styles.pickerValueText, { color: selectedUnion ? colors.text : colors.textMuted }]}>
                        {selectedUnion || (loadingUnions ? "Loading unions..." : "Select client union...")}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>

                {/* LOAN PLAN SELECTION */}
                <View style={styles.inputGroup}>
                  <View style={styles.labelRow}>
                    <Text style={[styles.inputLabel, { color: colors.textMuted }]}>ENROLLMENT LOAN PLAN</Text>
                    <Text style={styles.requiredAsterisk}>*</Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setShowPlanPicker(true);
                    }}
                    style={({ pressed }) => [
                      styles.inputWrap,
                      {
                        backgroundColor: colors.background,
                        borderColor: glassBorder,
                        transform: [{ scale: pressed ? 0.98 : 1 }],
                      },
                    ]}
                  >
                    <Ionicons
                      name="calendar-outline"
                      size={17}
                      color={currentPlan ? colors.primary : colors.textMuted}
                    />
                    <View style={{ flex: 1, marginHorizontal: 8 }}>
                      <Text numberOfLines={1} style={[styles.pickerValueText, { color: currentPlan ? colors.text : colors.textMuted }]}>
                        {currentPlan
                          ? `${currentPlan.duration} ${currentPlan.unit.toUpperCase()} • Fee: ${formatNaira(currentPlan.registration_amount)}`
                          : loadingPlans
                          ? "Loading plans..."
                          : "Select loan plan..."}
                      </Text>
                    </View>
                    <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
                  </Pressable>
                </View>
              </View>

              {/* SECTION 2: RESIDENTIAL */}
              <View style={[styles.sectionHeader, { borderTopWidth: 1, borderTopColor: glassBorder }]}>
                <View style={[styles.sectionBadge, { backgroundColor: `${colors.primary}18` }]}>
                  <Ionicons name="home" size={13} color={colors.primary} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>2. Residential Information</Text>
              </View>

              <View style={styles.formSection}>
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>HOUSE ADDRESS</Text>
                  <View style={getInputStyle("address")}>
                    <Ionicons name="location-outline" size={17} color={focusedField === "address" ? colors.primary : colors.textMuted} />
                    <TextInput
                      ref={addressRef}
                      value={address}
                      onChangeText={setAddress}
                      onFocus={() => setFocusedField("address")}
                      onBlur={() => setFocusedField(null)}
                      placeholder="e.g. 14 Oja Titun Road, Near Central Mosque"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="sentences"
                      returnKeyType="next"
                      onSubmitEditing={() => guarantorNameRef.current?.focus()}
                      style={[styles.inputField, { color: colors.text }]}
                    />
                  </View>
                </View>
              </View>

              {/* SECTION 3: GUARANTOR */}
              <View style={[styles.sectionHeader, { borderTopWidth: 1, borderTopColor: glassBorder }]}>
                <View style={[styles.sectionBadge, { backgroundColor: `${colors.primary}18` }]}>
                  <Ionicons name="shield-checkmark" size={13} color={colors.primary} />
                </View>
                <Text style={[styles.sectionTitle, { color: colors.text }]}>3. Guarantor / Emergency</Text>
                <Text style={[styles.optionalTag, { color: colors.textMuted }]}>Optional</Text>
              </View>

              <View style={styles.formSection}>
                {/* RELATIONSHIP CHIPS */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>RELATIONSHIP</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsContainer}>
                    {RELATIONSHIPS.map((rel) => {
                      const isSel = guarantorRelationship === rel;
                      return (
                        <Pressable
                          key={rel}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setGuarantorRelationship(isSel ? "" : rel);
                          }}
                          style={({ pressed }) => [
                            styles.chipPill,
                            {
                              backgroundColor: isSel ? colors.primary : colors.background,
                              borderColor: isSel ? colors.primary : glassBorder,
                              transform: [{ scale: pressed ? 0.94 : 1 }],
                            },
                          ]}
                        >
                          <Text style={[styles.chipPillText, { color: isSel ? "#fff" : colors.text }]}>{rel}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                </View>

                {/* GUARANTOR NAME */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>GUARANTOR LEGAL NAME</Text>
                  <View style={getInputStyle("guarantorName")}>
                    <Ionicons name="person-outline" size={17} color={focusedField === "guarantorName" ? colors.primary : colors.textMuted} />
                    <TextInput
                      ref={guarantorNameRef}
                      value={guarantorName}
                      onChangeText={setGuarantorName}
                      onFocus={() => setFocusedField("guarantorName")}
                      onBlur={() => setFocusedField(null)}
                      placeholder="e.g. Folashade Adeleke"
                      placeholderTextColor={colors.textMuted}
                      autoCapitalize="words"
                      returnKeyType="next"
                      onSubmitEditing={() => guarantorPhoneRef.current?.focus()}
                      style={[styles.inputField, { color: colors.text }]}
                    />
                  </View>
                </View>

                {/* GUARANTOR PHONE */}
                <View style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, { color: colors.textMuted }]}>GUARANTOR PHONE</Text>
                  <View style={getInputStyle("guarantorPhone")}>
                    <View style={styles.countryCodeBadge}>
                      <Text style={styles.flag}>🇳🇬</Text>
                      <Text style={[styles.countryCode, { color: colors.textMuted }]}>+234</Text>
                    </View>
                    <TextInput
                      ref={guarantorPhoneRef}
                      value={guarantorPhone}
                      onChangeText={(val) => setGuarantorPhone(formatPhone(val))}
                      onFocus={() => setFocusedField("guarantorPhone")}
                      onBlur={() => setFocusedField(null)}
                      placeholder="0800 000 0000"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="phone-pad"
                      maxLength={14}
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                      style={[styles.inputField, { color: colors.text }]}
                    />
                    {guarantorTelco && (
                      <View style={[styles.telcoPill, { backgroundColor: guarantorTelco.bg, borderColor: guarantorTelco.border }]}>
                        <Text style={[styles.telcoPillText, { color: guarantorTelco.text }]}>{guarantorTelco.name}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </View>
          </Animated.ScrollView>

          {/* FLOATING ACTION DOCK */}
          <View style={[styles.actionDock, { backgroundColor: cardSurfaceBg, borderTopColor: glassBorder }]}>
            <View style={styles.actionFeeBox}>
              <Text style={[styles.actionFeeLabel, { color: colors.textMuted }]}>PLAN REG. FEE</Text>
              <Text style={[styles.actionFeeValue, { color: colors.text }]}>{formatNaira(currentFee, hideBalances)}</Text>
            </View>

            <Pressable
              onPress={handleSubmit}
              disabled={submitting || !isFormValid}
              style={({ pressed }) => [
                styles.actionSubmitBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: submitting || !isFormValid ? 0.5 : 1,
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                },
              ]}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.actionSubmitText}>Complete Registration</Text>
                  <Ionicons name="arrow-forward" size={17} color="#fff" />
                </>
              )}
            </Pressable>
          </View>
        </View>

        {/* UNION PICKER BOTTOM SHEET */}
        <Modal visible={showUnionPicker} transparent animationType="slide" onRequestClose={() => setShowUnionPicker(false)}>
          <View style={styles.sheetOverlay}>
            <View style={[styles.sheetContent, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.sheetHandle} />

              <View style={styles.sheetHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[styles.sectionBadge, { backgroundColor: `${colors.primary}18` }]}>
                    <Ionicons name="people" size={15} color={colors.primary} />
                  </View>
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>Select Union Branch</Text>
                </View>
                <Pressable onPress={() => setShowUnionPicker(false)} hitSlop={12}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <View style={[styles.sheetSearchBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                <Ionicons name="search" size={16} color={colors.textMuted} />
                <TextInput
                  value={unionSearchQuery}
                  onChangeText={setUnionSearchQuery}
                  placeholder="Filter unions..."
                  placeholderTextColor={colors.textMuted}
                  autoCorrect={false}
                  clearButtonMode="while-editing"
                  style={[styles.sheetSearchInput, { color: colors.text }]}
                />
              </View>

              <ScrollView style={{ maxHeight: height * 0.44 }} keyboardShouldPersistTaps="handled">
                {filteredUnions.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="file-tray-outline" size={30} color={colors.textMuted} />
                    <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>No matching unions found</Text>
                  </View>
                ) : (
                  filteredUnions.map((u) => {
                    const isSelected = selectedUnion === u.name;
                    return (
                      <Pressable
                        key={u.uuid || u.name}
                        onPress={() => handleUnionSelect(u.name)}
                        style={({ pressed }) => [
                          styles.sheetItemRow,
                          {
                            backgroundColor: isSelected ? `${colors.primary}12` : "transparent",
                            borderBottomColor: glassBorder,
                            opacity: pressed ? 0.7 : 1,
                          },
                        ]}
                      >
                        <View style={{ flex: 1, paddingRight: 8 }}>
                          <Text style={[styles.sheetItemTitle, { color: isSelected ? colors.primary : colors.text }]}>
                            {u.name}
                          </Text>
                          {u.description ? (
                            <Text style={[styles.sheetItemSub, { color: colors.textMuted }]} numberOfLines={1}>
                              {u.description}
                            </Text>
                          ) : null}
                        </View>
                        {u.client_count !== undefined && (
                          <View style={[styles.countBadge, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                            <Text style={[styles.countBadgeText, { color: colors.textMuted }]}>{u.client_count} members</Text>
                          </View>
                        )}
                        {isSelected && <Ionicons name="checkmark-circle" size={18} color={colors.primary} style={{ marginLeft: 8 }} />}
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* PLAN PICKER BOTTOM SHEET */}
        <Modal visible={showPlanPicker} transparent animationType="slide" onRequestClose={() => setShowPlanPicker(false)}>
          <View style={styles.sheetOverlay}>
            <View style={[styles.sheetContent, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.sheetHandle} />

              <View style={styles.sheetHeader}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <View style={[styles.sectionBadge, { backgroundColor: `${colors.primary}18` }]}>
                    <Ionicons name="calendar" size={15} color={colors.primary} />
                  </View>
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>Choose Loan Plan</Text>
                </View>
                <Pressable onPress={() => setShowPlanPicker(false)} hitSlop={12}>
                  <Ionicons name="close" size={22} color={colors.text} />
                </Pressable>
              </View>

              <ScrollView style={{ maxHeight: height * 0.45 }} showsVerticalScrollIndicator={false}>
                {loanPlans.map((p) => {
                  const isSelected = String(selectedPlanId) === String(p.id);
                  return (
                    <Pressable
                      key={p.id}
                      onPress={() => {
                        setSelectedPlanId(p.id);
                        setShowPlanPicker(false);
                        Haptics.selectionAsync();
                      }}
                      style={({ pressed }) => [
                        styles.planCard,
                        {
                          backgroundColor: isSelected ? `${colors.primary}12` : colors.background,
                          borderColor: isSelected ? colors.primary : glassBorder,
                          transform: [{ scale: pressed ? 0.98 : 1 }],
                        },
                      ]}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                          <Text style={[styles.planDuration, { color: isSelected ? colors.primary : colors.text }]}>
                            {`${p.duration} ${p.unit.toUpperCase()}`}
                          </Text>

                          <View style={[styles.planBadge, { backgroundColor: `${colors.primary}18` }]}>
                            <Text style={[styles.planBadgeText, { color: colors.primary }]}>
                              {`${((Number(p.rate) || 0) * 100).toFixed(0)}% Interest`}
                            </Text>
                          </View>
                        </View>
                        <Text style={[styles.planFeeSub, { color: colors.textMuted }]}>
                          Registration Fee:{" "}
                          <Text style={{ fontWeight: "800", color: colors.text }}>{formatNaira(p.registration_amount)}</Text>
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.planCheckRadio,
                          {
                            borderColor: isSelected ? colors.primary : glassBorder,
                            backgroundColor: isSelected ? colors.primary : "transparent",
                          },
                        ]}
                      >
                        {isSelected && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* DIGITAL RECEIPT & PASS MODAL */}
        <Modal visible={showSuccessModal} transparent animationType="fade" onRequestClose={handleAddAnother}>
          <View style={styles.modalBackdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={handleAddAnother} />
            <View style={[styles.ticketCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.sheetHandle} />

              <View style={[styles.receiptTopCircle, { backgroundColor: "rgba(16, 185, 129, 0.12)" }]}>
                <Ionicons name="checkmark-done" size={28} color="#10B981" />
              </View>

              <Text style={[styles.ticketTitle, { color: colors.text }]}>
                {lastRegisteredClient?.name || name}
              </Text>
              <Text style={[styles.ticketAmountText, { color: "#10B981" }]}>
                {formatNaira(lastRegisteredClient?.fee || currentFee)}
              </Text>

              <View style={styles.statusSuccessPill}>
                <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                <Text style={styles.statusSuccessText}>Member Enrollment Confirmed</Text>
              </View>

              <View style={[styles.modalDetailsGroup, { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(148, 163, 184, 0.08)" }]}>
                <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                  <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Assigned Union</Text>
                  <Text style={[styles.modalDetailVal, { color: colors.text }]}>{lastRegisteredClient?.union || selectedUnion}</Text>
                </View>

                <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                  <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Plan Duration</Text>
                  <Text style={[styles.modalDetailVal, { color: colors.text }]}>
                    {lastRegisteredClient?.plan?.duration
                      ? `${lastRegisteredClient.plan.duration} ${lastRegisteredClient.plan.unit}`
                      : "Standard"}
                  </Text>
                </View>

                <View style={[styles.modalDetailRow, { borderColor: glassBorder, borderBottomWidth: 0 }]}>
                  <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Token Ref</Text>
                  <Pressable
                    onPress={() => copyTxCode(lastRegisteredClient?.receipt_id)}
                    hitSlop={6}
                    style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                  >
                    <Text style={[styles.modalDetailVal, { color: colors.primary, fontFamily: "monospace" }]}>
                      {lastRegisteredClient?.receipt_id || "N/A"}
                    </Text>
                    <Ionicons name="copy-outline" size={12} color={colors.primary} />
                  </Pressable>
                </View>
              </View>

              <View style={styles.modalButtonsRow}>
                <Pressable
                  onPress={handleShareReceipt}
                  style={({ pressed }) => [
                    styles.modalSecondaryBtn,
                    { borderColor: glassBorder, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="share-social-outline" size={17} color={colors.text} />
                  <Text style={[styles.modalSecondaryText, { color: colors.text }]}>Share Receipt</Text>
                </Pressable>

                <Pressable
                  onPress={handleAddAnother}
                  style={({ pressed }) => [
                    styles.modalSecondaryBtn,
                    { borderColor: glassBorder, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Ionicons name="person-add" size={15} color={colors.text} />
                  <Text style={[styles.modalSecondaryText, { color: colors.text }]}>Next</Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    handleAddAnother();
                    router.back();
                  }}
                  style={({ pressed }) => [
                    styles.modalPrimaryBtn,
                    { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
                  ]}
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
  container: { flex: 1 },
  scrollContent: { paddingBottom: 110, paddingTop: 6 },
  syncBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  syncIndicatorPulse: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(217, 119, 6, 0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  syncBannerText: { fontSize: 12, fontWeight: "700" },
  syncBtnPill: {
    backgroundColor: "#D97706",
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 8,
  },
  syncBtnPillText: { color: "#fff", fontSize: 10.5, fontWeight: "800" },
  heroCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
    marginBottom: 14,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
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
  branchPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(37, 99, 235, 0.08)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  branchPillText: { fontSize: 10.5, fontWeight: "700" },
  heroMainBalanceSection: { marginTop: 6, marginBottom: 12 },
  heroBalanceLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  heroAmountRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  heroMainAmount: { fontSize: 27, fontWeight: "900", letterSpacing: -0.6 },
  eyeInlineBtn: { padding: 6, borderRadius: 10 },
  portfolioRatioContainer: { marginBottom: 12 },
  ratioHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  ratioLabel: { fontSize: 9.5, fontWeight: "600" },
  ratioTrack: { height: 5, borderRadius: 3, backgroundColor: "rgba(148, 163, 184, 0.2)", flexDirection: "row", overflow: "hidden" },
  ratioFillBar: { height: "100%" },
  heroMetricsGrid: { flexDirection: "row", gap: 8, paddingTop: 4 },
  metricGridItem: { flex: 1, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10 },
  metricItemHeader: { flexDirection: "row", alignItems: "center", gap: 5 },
  metricItemLabel: { fontSize: 9.5, fontWeight: "600" },
  metricItemValue: { fontSize: 14, fontWeight: "800", marginTop: 3 },
  metricItemSub: { fontSize: 9, marginTop: 1, fontWeight: "500" },
  formContainer: { marginHorizontal: 16, borderRadius: 22, borderWidth: 1, overflow: "hidden" },
  sectionHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  sectionBadge: { width: 24, height: 24, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  sectionTitle: { fontSize: 13, fontWeight: "800", flex: 1, letterSpacing: -0.2 },
  optionalTag: { fontSize: 11, fontWeight: "600" },
  formSection: { paddingHorizontal: 16, paddingBottom: 16, gap: 12 },
  inputGroup: { gap: 5 },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  inputLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.6 },
  requiredAsterisk: { color: "#EF4444", fontSize: 11, fontWeight: "900" },
  inputWrap: { flexDirection: "row", alignItems: "center", borderRadius: 14, paddingHorizontal: 12, height: 48, gap: 8 },
  inputField: { flex: 1, fontSize: 13.5, height: "100%", fontWeight: "600" },
  pickerValueText: { fontSize: 13.5, fontWeight: "600" },
  countryCodeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingRight: 4 },
  flag: { fontSize: 14 },
  countryCode: { fontSize: 12, fontWeight: "800" },
  telcoPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1, marginRight: 4 },
  telcoPillText: { fontSize: 9.5, fontWeight: "900" },
  chipsContainer: { flexDirection: "row", gap: 7, paddingTop: 2 },
  chipPill: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  chipPillText: { fontSize: 11.5, fontWeight: "700" },
  dupBanner: { flexDirection: "row", alignItems: "flex-start", gap: 7, padding: 9, borderRadius: 10, borderWidth: 1, marginTop: 4 },
  dupBannerText: { fontSize: 11.5, fontWeight: "600", flex: 1, lineHeight: 16 },
  actionDock: { position: "absolute", bottom: 0, left: 0, right: 0, borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 12, flexDirection: "row", alignItems: "center", gap: 12 },
  actionFeeBox: { paddingHorizontal: 6, justifyContent: "center" },
  actionFeeLabel: { fontSize: 8.5, fontWeight: "800", letterSpacing: 0.5 },
  actionFeeValue: { fontSize: 15, fontWeight: "900", marginTop: 1 },
  actionSubmitBtn: { flex: 1, height: 46, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  actionSubmitText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  sheetOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  sheetContent: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 16, paddingBottom: Platform.OS === "ios" ? 36 : 18 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 14 },
  sheetHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  sheetTitle: { fontSize: 16, fontWeight: "800" },
  sheetSearchBox: { flexDirection: "row", alignItems: "center", height: 42, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, gap: 8, marginBottom: 10 },
  sheetSearchInput: { flex: 1, fontSize: 13, height: "100%" },
  sheetItemRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 13, paddingHorizontal: 10, borderBottomWidth: 1 },
  sheetItemTitle: { fontSize: 14, fontWeight: "700" },
  sheetItemSub: { fontSize: 11.5, marginTop: 2 },
  countBadge: { paddingHorizontal: 8, paddingVertical: 3.5, borderRadius: 7 },
  countBadgeText: { fontSize: 10.5, fontWeight: "700" },
  emptyState: { padding: 32, alignItems: "center", gap: 6 },
  emptyStateText: { fontSize: 13, fontWeight: "600" },
  planCard: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 14, borderRadius: 14, borderWidth: 1, marginBottom: 9 },
  planDuration: { fontSize: 14, fontWeight: "800" },
  planBadge: { paddingHorizontal: 7, paddingVertical: 2.5, borderRadius: 6 },
  planBadgeText: { fontSize: 9.5, fontWeight: "900" },
  planFeeSub: { fontSize: 12, marginTop: 4 },
  planCheckRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginLeft: 12 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", padding: 20 },
  ticketCard: { width: "100%", borderRadius: 24, borderWidth: 1, paddingHorizontal: 22, paddingTop: 16, paddingBottom: 24, alignItems: "center" },
  receiptTopCircle: { width: 58, height: 58, borderRadius: 18, alignItems: "center", justifyContent: "center", marginBottom: 10 },
  ticketTitle: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  ticketAmountText: { fontSize: 26, fontWeight: "900", marginVertical: 4 },
  statusSuccessPill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(16, 185, 129, 0.12)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginTop: 4, marginBottom: 14 },
  statusSuccessText: { color: "#10B981", fontSize: 11, fontWeight: "700" },
  modalDetailsGroup: { width: "100%", borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 18 },
  modalDetailRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1 },
  modalDetailLabel: { fontSize: 12, fontWeight: "600" },
  modalDetailVal: { fontSize: 12, fontWeight: "700" },
  modalButtonsRow: { flexDirection: "row", gap: 8, width: "100%" },
  modalSecondaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: 13, borderRadius: 14, borderWidth: 1 },
  modalSecondaryText: { fontSize: 12.5, fontWeight: "700" },
  modalPrimaryBtn: { flex: 1, paddingVertical: 13, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  modalCloseText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  toastBox: { position: "absolute", top: Platform.OS === "ios" ? 54 : 36, alignSelf: "center", borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 24, flexDirection: "row", alignItems: "center", gap: 8, zIndex: 9999 },
  toastText: { fontSize: 12, fontWeight: "700" },
});