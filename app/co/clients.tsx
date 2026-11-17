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
  Linking,
  TouchableWithoutFeedback,
  Share,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cacheClients,
  loadCachedClients,
  loadOfflineWorkspace,
} from "../../src/db/database";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import axios from "axios";

const { width } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_CLIENTS = `${API_BASE}/api/clients_api.php`;

const CACHE_KEYS = {
  CLIENTS_LIST: "cupad_cache_co_clients_list",
  CLIENTS_STATS: "cupad_cache_co_clients_stats",
  PRIVACY: "cupad_cache_privacy_hide_amounts",
};

type ClientItem = {
  id: string | number;
  name: string;
  phone: string;
  union?: string;
  guarantor_name: string;
  guarantor_phone: string;
  savings: number;
  outstanding_loan: number;
};

type HistoryItem = {
  timestamp: number;
  date_formatted: string;
  type: "savings" | "loan" | "repayment";
  title: string;
  amount: string;
  raw_amount: number;
  description: string;
  icon: any;
  transaction_id: string;
  is_withdrawal?: boolean;
};

type SummaryStats = {
  total_clients: number;
  total_savings: number;
  total_loans: number;
};

function formatNaira(amount: number | string, hide = false): string {
  if (hide) return "••••••••";
  const num = Math.abs(Number(amount) || 0);
  return `₦${num.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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

// Skeleton Placeholder
function SkeletonCard({ cardSurfaceBg, glassBorder }: { cardSurfaceBg: string; glassBorder: string }) {
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

  return (
    <View style={[styles.clientCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Animated.View style={[{ width: 44, height: 44, borderRadius: 14, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity: pulseAnim }]} />
        <View style={{ flex: 1, gap: 6 }}>
          <Animated.View style={{ height: 14, width: "60%", borderRadius: 4, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity: pulseAnim }} />
          <Animated.View style={{ height: 10, width: "35%", borderRadius: 4, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity: pulseAnim }} />
        </View>
      </View>
      <Animated.View style={{ height: 50, borderRadius: 12, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity: pulseAnim, marginTop: 4 }} />
      <Animated.View style={{ height: 38, borderRadius: 10, backgroundColor: "rgba(148, 163, 184, 0.25)", opacity: pulseAnim, marginTop: 4 }} />
    </View>
  );
}

// Memoized Client Card
const ClientCard = React.memo(
  ({
    client,
    colors,
    cardSurfaceBg,
    glassBorder,
    hideBalances,
    onCall,
    onWhatsApp,
    onEdit,
    onHistory,
  }: {
    client: ClientItem;
    colors: any;
    cardSurfaceBg: string;
    glassBorder: string;
    hideBalances: boolean;
    onCall: (phone?: string) => void;
    onWhatsApp: (phone?: string) => void;
    onEdit: (client: ClientItem) => void;
    onHistory: (client: ClientItem) => void;
  }) => {
    const initials = client.name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .substring(0, 2)
      .toUpperCase();

    const hasPhone = Boolean(client.phone && client.phone !== "N/A" && client.phone.trim() !== "");
    const hasGuarantorPhone = Boolean(
      client.guarantor_phone && client.guarantor_phone !== "N/A" && client.guarantor_phone.trim() !== ""
    );

    let statusPill = { label: "Debt Free", color: "#10B981", bg: "rgba(16,185,129,0.12)" };
    if (client.outstanding_loan > 0) {
      if (client.outstanding_loan > client.savings * 1.5) {
        statusPill = { label: "High Exposure", color: "#EF4444", bg: "rgba(239,68,68,0.12)" };
      } else {
        statusPill = { label: "Active Loan", color: "#F59E0B", bg: "rgba(245,158,11,0.12)" };
      }
    }

    return (
      <View style={[styles.clientCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
        {/* HEADER & IDENTITY */}
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
            <View style={[styles.clientAvatar, { backgroundColor: "rgba(59,130,246,0.14)" }]}>
              <Text style={styles.avatarInitials}>{initials}</Text>
            </View>

            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <Text style={[styles.clientName, { color: colors.text }]} numberOfLines={1}>
                  {client.name}
                </Text>
                <View style={[styles.statusBadge, { backgroundColor: statusPill.bg }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusPill.color }]} />
                  <Text style={[styles.statusBadgeText, { color: statusPill.color }]}>{statusPill.label}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                {/* CLIENT ID BADGE */}
                <View style={[styles.idBadge, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                  <Text style={[styles.idBadgeText, { color: colors.textMuted }]}>ID: #{client.id}</Text>
                </View>

                {client.union && (
                  <View style={[styles.unionBadge, { backgroundColor: `${colors.primary}12`, borderColor: `${colors.primary}33` }]}>
                    <Ionicons name="business-outline" size={10} color={colors.primary} />
                    <Text style={[styles.unionBadgeText, { color: colors.primary }]}>{client.union}</Text>
                  </View>
                )}

                <Pressable
                  onPress={() => onCall(client.phone)}
                  disabled={!hasPhone}
                  hitSlop={8}
                  style={[styles.phoneTag, !hasPhone && { opacity: 0.5 }]}
                >
                  <Ionicons name="call-outline" size={11} color={hasPhone ? "#3B82F6" : colors.textMuted} />
                  <Text style={[styles.phoneText, !hasPhone && { color: colors.textMuted }]}>
                    {hasPhone ? client.phone : "No Phone"}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>

          {/* QUICK DIRECT CONTACT ACTIONS */}
          <View style={styles.quickContactGroup}>
            <Pressable
              onPress={() => onWhatsApp(client.phone)}
              disabled={!hasPhone}
              hitSlop={6}
              style={({ pressed }) => [
                styles.contactIconButton,
                {
                  backgroundColor: hasPhone ? "rgba(16,185,129,0.12)" : colors.background,
                  borderColor: glassBorder,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                },
                !hasPhone && { opacity: 0.4 },
              ]}
            >
              <Ionicons name="logo-whatsapp" size={16} color={hasPhone ? "#10B981" : colors.textMuted} />
            </Pressable>

            <Pressable
              onPress={() => onCall(client.phone)}
              disabled={!hasPhone}
              hitSlop={6}
              style={({ pressed }) => [
                styles.contactIconButton,
                {
                  backgroundColor: hasPhone ? "rgba(59,130,246,0.12)" : colors.background,
                  borderColor: glassBorder,
                  transform: [{ scale: pressed ? 0.94 : 1 }],
                },
                !hasPhone && { opacity: 0.4 },
              ]}
            >
              <Ionicons name="call" size={15} color={hasPhone ? "#3B82F6" : colors.textMuted} />
            </Pressable>
          </View>
        </View>

        {/* FINANCIAL SUMMARY BALANCES */}
        <View style={[styles.statsBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
          <View style={styles.balanceCol}>
            <Text style={styles.balanceLabel}>CURRENT SAVINGS</Text>
            <Text style={[styles.balanceValue, { color: "#10B981" }]}>
              {formatNaira(client.savings, hideBalances)}
            </Text>
          </View>
          <View style={[styles.balanceDivider, { backgroundColor: glassBorder }]} />
          <View style={styles.balanceCol}>
            <Text style={styles.balanceLabel}>OUTSTANDING LOAN</Text>
            <Text style={[styles.balanceValue, { color: client.outstanding_loan > 0 ? "#EF4444" : colors.textMuted }]}>
              {formatNaira(client.outstanding_loan, hideBalances)}
            </Text>
          </View>
        </View>

        {/* GUARANTOR ASSURANCE ROW */}
        <View style={[styles.guarantorRow, { backgroundColor: colors.background, borderColor: glassBorder }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}>
            <Ionicons name="shield-checkmark" size={13} color="#3B82F6" />
            <Text style={[styles.guarantorLabel, { color: colors.textMuted }]}>Guarantor:</Text>
            <Text style={[styles.guarantorName, { color: colors.text }]} numberOfLines={1}>
              {client.guarantor_name || "None Listed"}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {hasGuarantorPhone ? (
              <>
                <Pressable onPress={() => onCall(client.guarantor_phone)} hitSlop={6} style={styles.guarantorActionBtn}>
                  <Ionicons name="call-outline" size={11} color="#3B82F6" />
                  <Text style={styles.guarantorPhoneText}>{client.guarantor_phone}</Text>
                </Pressable>
                <Pressable
                  onPress={() => onWhatsApp(client.guarantor_phone)}
                  hitSlop={6}
                  style={[styles.guarantorWaIcon, { backgroundColor: "rgba(16,185,129,0.12)" }]}
                >
                  <Ionicons name="logo-whatsapp" size={12} color="#10B981" />
                </Pressable>
              </>
            ) : (
              <Pressable onPress={() => onEdit(client)} hitSlop={6}>
                <Text style={styles.addGuarantorText}>+ Add Contact</Text>
              </Pressable>
            )}
          </View>
        </View>

        {/* BOTTOM ACTION BUTTONS */}
        <View style={styles.cardActionsRow}>
          <Pressable
            onPress={() => onEdit(client)}
            style={({ pressed }) => [
              styles.btnOutline,
              { borderColor: glassBorder, backgroundColor: colors.background, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <Ionicons name="create-outline" size={14} color={colors.text} />
            <Text style={[styles.btnOutlineText, { color: colors.text }]}>Edit Details</Text>
          </Pressable>
          <Pressable
            onPress={() => onHistory(client)}
            style={({ pressed }) => [
              styles.btnPrimary,
              { backgroundColor: colors.primary, transform: [{ scale: pressed ? 0.98 : 1 }] },
            ]}
          >
            <Ionicons name="receipt-outline" size={14} color="#fff" />
            <Text style={styles.btnPrimaryText}>Audit Ledger</Text>
          </Pressable>
        </View>
      </View>
    );
  }
);

export default function ClientsScreen() {
  const { colors, isDark } = useTheme();

  // Glassmorphic System Colors
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.09)";
  const orbColor2 = isDark ? "rgba(14, 165, 233, 0.13)" : "rgba(14, 165, 233, 0.07)";

  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Officer Session & Privacy
  const [officerUsername, setOfficerUsername] = useState("");
  const [hideBalances, setHideBalances] = useState(false);
  const [isOfflineState, setIsOfflineState] = useState(false);

  const [summary, setSummary] = useState<SummaryStats>({
    total_clients: 0,
    total_savings: 0,
    total_loans: 0,
  });

  // Clients List State
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState("");
  const [loanStatusFilter, setLoanStatusFilter] = useState<"all_active" | "active_loan" | "active_savings" | "inactive">("all_active");
  const [sortParam, setSortParam] = useState<"name_asc" | "savings_desc" | "loan_desc">("name_asc");
  const [selectedUnionTab, setSelectedUnionTab] = useState<string>("all");

  // Edit Modal State
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedClientForEdit, setSelectedClientForEdit] = useState<ClientItem | null>(null);
  const [clientPhoneInput, setClientPhoneInput] = useState("");
  const [guarantorNameInput, setGuarantorNameInput] = useState("");
  const [guarantorPhoneInput, setGuarantorPhoneInput] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);

  // History Timeline Modal State
  const [historyModalVisible, setHistoryModalVisible] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [currentHistoryClient, setCurrentHistoryClient] = useState<ClientItem | null>(null);
  const [historyData, setHistoryData] = useState<HistoryItem[]>([]);
  const [historyFilter, setHistoryFilter] = useState<"all" | "savings" | "loan" | "repayment">("all");
  const [historySummary, setHistorySummary] = useState({ savings: 0, loan: 0 });

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

  const toggleHideBalances = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !hideBalances;
    setHideBalances(next);
    await AsyncStorage.setItem(CACHE_KEYS.PRIVACY, String(next));
  };

  const makeCall = (phone?: string) => {
    if (!phone || phone === "N/A" || phone.trim() === "") {
      Alert.alert("No Phone Number", "This client has no telephone number on record.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`);
  };

  const openWhatsApp = (phone?: string) => {
    if (!phone || phone === "N/A" || phone.trim() === "") {
      Alert.alert("No Phone Number", "This client has no phone number on record.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    let p = phone.replace(/\D/g, "");
    if (p.startsWith("0")) p = "234" + p.substring(1);
    const waUrl = `https://wa.me/${p}`;
    Linking.canOpenURL(waUrl)
      .then((supported) => {
        if (supported) Linking.openURL(waUrl);
        else Alert.alert("WhatsApp Not Found", "WhatsApp is not installed on this device.");
      })
      .catch(() => Alert.alert("Error", "Could not open WhatsApp."));
  };

  const copyTxCode = async (code: string) => {
    await Clipboard.setStringAsync(code);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast(`Copied Ref: #${code}`);
  };

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

  const fetchClients = useCallback(
    async (pageNum = 1, append = false, search = searchQuery, status = loanStatusFilter, sort = sortParam) => {
      if (!officerUsername) return;
      if (!append) setLoading(true);
      else setLoadingMore(true);

      try {
        const res = await axios.get(
          `${API_CLIENTS}?action=get_clients_data&username=${encodeURIComponent(
            officerUsername
          )}&page=${pageNum}&limit=12&search=${encodeURIComponent(search)}&loan_status=${status}&sort=${sort}`,
          { timeout: 10000 }
        );

        if (res.data?.success) {
          setIsOfflineState(false);
          if (append) {
            setClients((prev) => [...prev, ...res.data.clients]);
          } else {
            setClients(res.data.clients || []);
            setSummary(res.data.summary);
            await AsyncStorage.setItem(CACHE_KEYS.CLIENTS_LIST, JSON.stringify(res.data.clients));
            try {
              await cacheClients(res.data.clients || [], officerUsername);
            } catch {}
            await AsyncStorage.setItem(CACHE_KEYS.CLIENTS_STATS, JSON.stringify(res.data.summary));
          }
          setHasMore(Boolean(res.data.pagination?.has_more));
          setPage(pageNum);
        }
      } catch {
        setIsOfflineState(true);
        if (!append) {
          try {
            const ws = await loadOfflineWorkspace(officerUsername);
            const sqlClients = ws.clients.length ? ws.clients : await loadCachedClients(officerUsername);
            if (sqlClients && sqlClients.length > 0) {
              setClients(sqlClients);
            } else {
              const [cList, cStats] = await Promise.all([
                AsyncStorage.getItem(CACHE_KEYS.CLIENTS_LIST),
                AsyncStorage.getItem(CACHE_KEYS.CLIENTS_STATS),
              ]);
              if (cList) setClients(JSON.parse(cList));
              if (cStats) setSummary(JSON.parse(cStats));
            }
          } catch {
            const [cList, cStats] = await Promise.all([
              AsyncStorage.getItem(CACHE_KEYS.CLIENTS_LIST),
              AsyncStorage.getItem(CACHE_KEYS.CLIENTS_STATS),
            ]);
            if (cList) setClients(JSON.parse(cList));
            if (cStats) setSummary(JSON.parse(cStats));
          }
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [officerUsername, searchQuery, loanStatusFilter, sortParam]
  );

  // Search debounce
  useEffect(() => {
    const handler = setTimeout(() => {
      if (officerUsername) {
        fetchClients(1, false, searchQuery, loanStatusFilter, sortParam);
      }
    }, 380);
    return () => clearTimeout(handler);
  }, [searchQuery, loanStatusFilter, sortParam, officerUsername, fetchClients]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (officerUsername) {
      await fetchClients(1, false, searchQuery, loanStatusFilter, sortParam);
    }
    setRefreshing(false);
  }, [officerUsername, searchQuery, loanStatusFilter, sortParam, fetchClients]);

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    loadUser().then((u) => {
      if (u) {
        fetchClients(1, false, "", "all_active", "name_asc");
      }
    });
  }, [fadeAnim, loadUser, fetchClients]);

  // Compute Available Unions with counts dynamically
  const availableUnions = useMemo(() => {
    const counts: Record<string, number> = {};
    clients.forEach((c) => {
      const u = c.union?.trim() || "Unassigned";
      counts[u] = (counts[u] || 0) + 1;
    });

    const unionKeys = Object.keys(counts).sort();
    return [
      { key: "all", name: "All Unions", count: clients.length },
      ...unionKeys.map((k) => ({
        key: k,
        name: k,
        count: counts[k],
      })),
    ];
  }, [clients]);

  // Client-side Union Filtering
  const filteredClients = useMemo(() => {
    if (selectedUnionTab === "all") return clients;
    if (selectedUnionTab === "Unassigned") {
      return clients.filter((c) => !c.union || c.union === "Unassigned");
    }
    return clients.filter((c) => (c.union || "").trim().toLowerCase() === selectedUnionTab.toLowerCase());
  }, [clients, selectedUnionTab]);

  const resetAllFilters = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearchQuery("");
    setLoanStatusFilter("all_active");
    setSortParam("name_asc");
    setSelectedUnionTab("all");
  };

  const openEditModal = (client: ClientItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedClientForEdit(client);
    setClientPhoneInput(client.phone === "N/A" ? "" : client.phone);
    setGuarantorNameInput(client.guarantor_name === "N/A" ? "" : client.guarantor_name);
    setGuarantorPhoneInput(client.guarantor_phone === "N/A" ? "" : client.guarantor_phone);
    setEditModalVisible(true);
  };

  const handleSaveClientDetails = async () => {
    if (!selectedClientForEdit) return;
    if (!clientPhoneInput.trim() || !guarantorNameInput.trim() || !guarantorPhoneInput.trim()) {
      Alert.alert("Missing Details", "Please complete all phone and guarantor fields.");
      return;
    }

    setIsUpdating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const payload = {
        action: "update_client_details",
        username: officerUsername,
        client_id: selectedClientForEdit.id,
        client_phone: clientPhoneInput.trim(),
        guarantor_name: guarantorNameInput.trim(),
        guarantor_phone: guarantorPhoneInput.trim(),
      };

      const res = await axios.post(API_CLIENTS, payload, { timeout: 10000 });
      if (res.data?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast("Client details updated successfully");
        setEditModalVisible(false);

        setClients((prev) =>
          prev.map((c) =>
            c.id === selectedClientForEdit.id
              ? {
                  ...c,
                  phone: clientPhoneInput.trim(),
                  guarantor_name: guarantorNameInput.trim(),
                  guarantor_phone: guarantorPhoneInput.trim(),
                }
              : c
          )
        );
      } else {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert("Update Failed", res.data?.message || "Could not update client.");
      }
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Connection Error", "Please verify internet connection and retry.");
    } finally {
      setIsUpdating(false);
    }
  };

  const openHistoryModal = async (client: ClientItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCurrentHistoryClient(client);
    setHistoryFilter("all");
    setHistoryData([]);
    setHistoryLoading(true);
    setHistoryModalVisible(true);

    try {
      const res = await axios.get(
        `${API_CLIENTS}?action=get_client_history&username=${encodeURIComponent(officerUsername)}&client_id=${client.id}`,
        { timeout: 10000 }
      );
      if (res.data?.success) {
        setHistoryData(res.data.history || []);
        setHistorySummary(res.data.summary || { savings: client.savings, loan: client.outstanding_loan });
      } else {
        Alert.alert("Notice", res.data?.message || "No history records found.");
      }
    } catch {
      Alert.alert("Offline", "Unable to load audit history without connection.");
    } finally {
      setHistoryLoading(false);
    }
  };

  const filteredTimeline = useMemo(() => {
    if (historyFilter === "all") return historyData;
    return historyData.filter((item) => item.type === historyFilter);
  }, [historyData, historyFilter]);

  const totalPortfolioVolume = (summary.total_savings || 0) + (summary.total_loans || 0);
  const savingsRatio = totalPortfolioVolume > 0 ? (summary.total_savings / totalPortfolioVolume) * 100 : 50;

  return (
    <CoScreenWrapper>
      {/* ================= DASHBOARD-MATCHED AMBIENT ORBS ================= */}
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
          <Ionicons name="checkmark-circle" size={17} color="#10B981" />
          <Text style={[styles.toastText, { color: colors.text }]}>{toastMessage}</Text>
        </Animated.View>
      )}

      {/* MAIN SCROLL CONTAINER */}
      <Animated.ScrollView
        style={{ flex: 1, opacity: fadeAnim }}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
      >
        {/* ================= HERO PORTFOLIO CARD (MATCHING DASHBOARD) ================= */}
        <LinearGradient
          colors={
            isDark
              ? ["rgba(30, 41, 59, 0.88)", "rgba(15, 23, 42, 0.92)"]
              : ["#FFFFFF", "rgba(248, 250, 252, 0.95)"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.heroSummaryCard, { borderColor: glassBorder }]}
        >
          <View style={styles.heroTopRow}>
            <View
              style={[
                styles.heroTagPill,
                { backgroundColor: isOfflineState ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)" },
              ]}
            >
              <View
                style={[
                  styles.statusPulseDot,
                  { backgroundColor: isOfflineState ? "#F59E0B" : "#10B981" },
                ]}
              />
              <Text
                style={[
                  styles.heroTagText,
                  { color: isOfflineState ? "#F59E0B" : "#10B981" },
                ]}
              >
                {isOfflineState ? "OFFLINE CACHE" : "LIVE CLIENT DIRECTORY"}
              </Text>
            </View>

            <View
              style={[
                styles.syncTimePill,
                { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)" },
              ]}
            >
              <Ionicons
                name={summary.total_loans > summary.total_savings ? "alert-circle-outline" : "shield-checkmark-outline"}
                size={12}
                color={summary.total_loans > summary.total_savings ? "#F59E0B" : "#10B981"}
              />
              <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>
                {summary.total_loans > summary.total_savings ? "Risk Exposure" : "Balanced Portfolio"}
              </Text>
            </View>
          </View>

          {/* Total Client Vault Balance */}
          <View style={styles.heroMainBalanceSection}>
            <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
              TOTAL CLIENT SAVINGS VAULT
            </Text>
            <View style={styles.heroAmountRow}>
              <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                {formatNaira(summary.total_savings, hideBalances)}
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

          {/* Visual Ratio Health Bar */}
          <View style={styles.portfolioRatioContainer}>
            <View style={styles.ratioHeader}>
              <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                Health Ratio: {Math.round(savingsRatio)}% Savings
              </Text>
              <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                {100 - Math.round(savingsRatio)}% Active Loans
              </Text>
            </View>
            <View style={styles.ratioTrack}>
              <View style={[styles.ratioSavingsBar, { width: `${savingsRatio}%` }]} />
              <View style={[styles.ratioLoansBar, { width: `${100 - savingsRatio}%` }]} />
            </View>
          </View>

          {/* 3 Metrics Grid */}
          <View style={styles.heroMetricsGrid}>
            <View
              style={[
                styles.metricGridItem,
                { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
              ]}
            >
              <View style={styles.metricItemHeader}>
                <Ionicons name="people" size={11} color={colors.primary} />
                <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Total Savers</Text>
              </View>
              <Text style={[styles.metricItemValue, { color: colors.text }]}>
                {summary.total_clients}
              </Text>
              <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Active members</Text>
            </View>

            <View
              style={[
                styles.metricGridItem,
                { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
              ]}
            >
              <View style={styles.metricItemHeader}>
                <Ionicons name="trending-down" size={11} color="#EF4444" />
                <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Total Loans</Text>
              </View>
              <Text style={[styles.metricItemValue, { color: "#EF4444" }]}>
                {formatNaira(summary.total_loans, hideBalances)}
              </Text>
              <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Disbursed balance</Text>
            </View>
          </View>
        </LinearGradient>

        {/* ================= UNION TABS NAVIGATION ================= */}
        <View style={styles.unionTabsSection}>
          <View style={styles.unionHeaderBar}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons name="business" size={13} color={colors.primary} />
              <Text style={[styles.unionHeaderTitle, { color: colors.text }]}>Union Branches</Text>
            </View>
            <Text style={[styles.unionHeaderCount, { color: colors.textMuted }]}>
              {availableUnions.length - 1} Union{availableUnions.length - 1 === 1 ? "" : "s"}
            </Text>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.unionTabsScroll}
          >
            {availableUnions.map((u) => {
              const isSelected = selectedUnionTab.toLowerCase() === u.key.toLowerCase();
              return (
                <Pressable
                  key={u.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedUnionTab(u.key);
                  }}
                  style={({ pressed }) => [
                    styles.unionTabPill,
                    {
                      backgroundColor: isSelected ? colors.primary : cardSurfaceBg,
                      borderColor: isSelected ? colors.primary : glassBorder,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    },
                  ]}
                >
                  <Ionicons
                    name={u.key === "all" ? "grid" : "business"}
                    size={13}
                    color={isSelected ? "#fff" : colors.primary}
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
        </View>

        {/* ================= CONTROLS & SEARCH ================= */}
        <View style={styles.controlsWrap}>
          <View style={[styles.searchBox, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            <Ionicons name="search" size={17} color={colors.textMuted} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search by name, phone or ID..."
              placeholderTextColor={colors.textMuted}
              autoCorrect={false}
              returnKeyType="search"
              style={[styles.searchInput, { color: colors.text }]}
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setSearchQuery("");
                }}
                hitSlop={10}
              >
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {/* STATUS FILTER CHIPS */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterChipRow}>
            {[
              { key: "all_active", label: "All Active" },
              { key: "active_loan", label: "Active Loans" },
              { key: "active_savings", label: "Savings Only" },
              { key: "inactive", label: "Paid Off" },
            ].map((f) => {
              const isSelected = loanStatusFilter === f.key;
              return (
                <Pressable
                  key={f.key}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setLoanStatusFilter(f.key as any);
                  }}
                  style={({ pressed }) => [
                    styles.filterChip,
                    {
                      backgroundColor: isSelected ? colors.primary : cardSurfaceBg,
                      borderColor: isSelected ? colors.primary : glassBorder,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    },
                  ]}
                >
                  <Text style={[styles.filterChipText, { color: isSelected ? "#fff" : colors.text }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* SORTING BAR & RESULTS COUNT */}
          <View style={styles.sortBar}>
            <Text style={[styles.resultCount, { color: colors.textMuted }]}>
              {filteredClients.length > 0 ? `Showing ${filteredClients.length} clients` : "No matches"}
            </Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: "center" }}>
              <Text style={[styles.sortLabel, { color: colors.textMuted }]}>SORT:</Text>
              {[
                { key: "name_asc", label: "A-Z" },
                { key: "savings_desc", label: "Top Savings" },
                { key: "loan_desc", label: "Top Loan" },
              ].map((s) => {
                const isSel = sortParam === s.key;
                return (
                  <Pressable
                    key={s.key}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSortParam(s.key as any);
                    }}
                    style={({ pressed }) => [
                      styles.sortChip,
                      {
                        backgroundColor: isSel ? (isDark ? "rgba(255,255,255,0.08)" : "#E2E8F0") : "transparent",
                        borderColor: isSel ? colors.primary : glassBorder,
                        transform: [{ scale: pressed ? 0.94 : 1 }],
                      },
                    ]}
                  >
                    <Text style={[styles.sortChipText, { color: isSel ? colors.primary : colors.textMuted }]}>{s.label}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>

        {/* ================= CLIENT CARDS LIST ================= */}
        <View style={styles.listSection}>
          {loading ? (
            <View style={{ gap: 12 }}>
              <SkeletonCard cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
              <SkeletonCard cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
              <SkeletonCard cardSurfaceBg={cardSurfaceBg} glassBorder={glassBorder} />
            </View>
          ) : filteredClients.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                <Ionicons name="search-outline" size={30} color={colors.textMuted} />
              </View>
              <Text style={[styles.emptyTitle, { color: colors.text }]}>No Clients Found</Text>
              <Text style={[styles.emptySub, { color: colors.textMuted }]}>
                No client records match the selected union, search query, or status filter.
              </Text>
              {(searchQuery.length > 0 || loanStatusFilter !== "all_active" || selectedUnionTab !== "all") && (
                <Pressable onPress={resetAllFilters} style={styles.resetFilterBtn}>
                  <Ionicons name="reload-outline" size={13} color={colors.primary} />
                  <Text style={[styles.resetFilterText, { color: colors.primary }]}>Clear All Filters</Text>
                </Pressable>
              )}
            </View>
          ) : (
            filteredClients.map((c) => (
              <ClientCard
                key={c.id}
                client={c}
                colors={colors}
                cardSurfaceBg={cardSurfaceBg}
                glassBorder={glassBorder}
                hideBalances={hideBalances}
                onCall={makeCall}
                onWhatsApp={openWhatsApp}
                onEdit={openEditModal}
                onHistory={openHistoryModal}
              />
            ))
          )}

          {/* PAGINATION / LOAD MORE */}
          {hasMore && (
            <Pressable
              onPress={() => fetchClients(page + 1, true)}
              disabled={loadingMore}
              style={({ pressed }) => [
                styles.loadMoreBtn,
                {
                  backgroundColor: cardSurfaceBg,
                  borderColor: glassBorder,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              {loadingMore ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <>
                  <Text style={[styles.loadMoreText, { color: colors.text }]}>Load More Clients</Text>
                  <Ionicons name="chevron-down" size={15} color={colors.text} />
                </>
              )}
            </Pressable>
          )}

          {!hasMore && filteredClients.length > 0 && (
            <View style={styles.endOfListIndicator}>
              <Text style={[styles.endOfListText, { color: colors.textMuted }]}>All client records up to date</Text>
            </View>
          )}
        </View>
      </Animated.ScrollView>

      {/* ================= EDIT CLIENT DETAILS MODAL ================= */}
      <Modal visible={editModalVisible} transparent animationType="slide" onRequestClose={() => setEditModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBackdrop}>
          <TouchableWithoutFeedback onPress={() => setEditModalVisible(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: glassBorder }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.modalHead}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>Edit Client Details</Text>
                <Text style={[styles.modalSub, { color: colors.textMuted }]}>Update contact numbers & guarantor security info</Text>
              </View>
              <Pressable onPress={() => setEditModalVisible(false)} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14 }}>
              <View style={styles.modalField}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>CLIENT ID & NAME</Text>
                <View style={[styles.disabledInput, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F1F5F9", borderColor: glassBorder }]}>
                  <Text style={[styles.disabledInputText, { color: colors.textMuted }]}>
                    ID #{selectedClientForEdit?.id} — {selectedClientForEdit?.name}
                  </Text>
                </View>
              </View>

              <View style={styles.modalField}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>CLIENT PHONE</Text>
                <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                  <Ionicons name="call-outline" size={16} color={colors.textMuted} />
                  <TextInput
                    value={clientPhoneInput}
                    onChangeText={setClientPhoneInput}
                    keyboardType="phone-pad"
                    placeholder="080XXXXXXXX"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.modalInput, { color: colors.text }]}
                  />
                </View>
              </View>

              <View style={styles.modalField}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>GUARANTOR NAME</Text>
                <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                  <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                  <TextInput
                    value={guarantorNameInput}
                    onChangeText={setGuarantorNameInput}
                    placeholder="Full Name"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.modalInput, { color: colors.text }]}
                  />
                </View>
              </View>

              <View style={styles.modalField}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>GUARANTOR PHONE</Text>
                <View style={[styles.inputBox, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                  <Ionicons name="call-outline" size={16} color={colors.textMuted} />
                  <TextInput
                    value={guarantorPhoneInput}
                    onChangeText={setGuarantorPhoneInput}
                    keyboardType="phone-pad"
                    placeholder="080XXXXXXXX"
                    placeholderTextColor={colors.textMuted}
                    style={[styles.modalInput, { color: colors.text }]}
                  />
                </View>
              </View>

              <View style={styles.modalActionsRow}>
                <Pressable
                  onPress={() => setEditModalVisible(false)}
                  style={({ pressed }) => [
                    styles.modalCancelBtn,
                    { borderColor: glassBorder, opacity: pressed ? 0.7 : 1 },
                  ]}
                >
                  <Text style={[styles.modalCancelText, { color: colors.text }]}>Cancel</Text>
                </Pressable>

                <Pressable
                  onPress={handleSaveClientDetails}
                  disabled={isUpdating}
                  style={({ pressed }) => [
                    styles.modalSubmitBtn,
                    { backgroundColor: colors.primary, opacity: pressed || isUpdating ? 0.75 : 1 },
                  ]}
                >
                  {isUpdating ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-done" size={16} color="#fff" />
                      <Text style={styles.modalSubmitText}>Save Changes</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ================= CLIENT HISTORY TIMELINE MODAL (MATCHING DASHBOARD) ================= */}
      <Modal visible={historyModalVisible} transparent animationType="slide" onRequestClose={() => setHistoryModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <TouchableWithoutFeedback onPress={() => setHistoryModalVisible(false)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>

          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: glassBorder, maxHeight: "90%" }]}>
            <View style={styles.sheetHandle} />

            <View style={styles.modalHead}>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={[styles.modalTitle, { color: colors.text }]} numberOfLines={1}>
                    {currentHistoryClient?.name}
                  </Text>
                  <View style={[styles.idBadge, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                    <Text style={[styles.idBadgeText, { color: colors.textMuted }]}>ID: #{currentHistoryClient?.id}</Text>
                  </View>
                </View>

                <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
                  <View style={styles.historyStatBadgeGreen}>
                    <Ionicons name="wallet" size={12} color="#10B981" />
                    <Text style={styles.historyStatGreenText}>Savings: {formatNaira(historySummary.savings)}</Text>
                  </View>
                  <View style={styles.historyStatBadgeRed}>
                    <Ionicons name="trending-down" size={12} color="#EF4444" />
                    <Text style={styles.historyStatRedText}>Loan: {formatNaira(historySummary.loan)}</Text>
                  </View>
                </View>
              </View>
              <Pressable onPress={() => setHistoryModalVisible(false)} hitSlop={10} style={styles.closeBtn}>
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>

            <View style={[styles.historyTabsRow, { borderBottomColor: glassBorder }]}>
              {(["all", "savings", "loan", "repayment"] as const).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setHistoryFilter(t);
                  }}
                  style={[styles.historyTabBtn, { borderBottomColor: historyFilter === t ? colors.primary : "transparent" }]}
                >
                  <Text style={[styles.historyTabText, { color: historyFilter === t ? colors.primary : colors.textMuted }]}>
                    {t === "all" ? "All" : t === "savings" ? "Savings" : t === "loan" ? "Disbursed" : "Repaid"}
                  </Text>
                </Pressable>
              ))}
            </View>

            {historyLoading ? (
              <View style={{ padding: 40, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={{ marginTop: 10, fontSize: 12, color: colors.textMuted }}>Loading audit records...</Text>
              </View>
            ) : filteredTimeline.length === 0 ? (
              <View style={{ padding: 40, alignItems: "center", justifyContent: "center", gap: 8 }}>
                <Ionicons name="receipt-outline" size={40} color={colors.textMuted} />
                <Text style={{ fontSize: 15, fontWeight: "800", color: colors.text }}>No Activity Recorded</Text>
                <Text style={{ fontSize: 12, color: colors.textMuted, textAlign: "center" }}>
                  Transactions will appear here once booked by an authorized officer.
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredTimeline}
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
                    <View style={[styles.timelineCard, { backgroundColor: colors.background, borderColor: glassBorder }]}>
                      <View style={[styles.timelineIconBox, { backgroundColor: iconBg }]}>
                        <Ionicons name={iconName} size={18} color={iconColor} />
                      </View>
                      <View style={{ flex: 1, marginHorizontal: 10 }}>
                        <Text style={[styles.txTitle, { color: colors.text }]}>{item.title}</Text>
                        <Text style={[styles.txDate, { color: colors.textMuted }]}>{item.date_formatted}</Text>
                        <View style={styles.badgeWrap}>
                          <Text style={[styles.descBadge, { color: iconColor }]}>{item.description}</Text>
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.txAmount, { color: amountColor }]}>
                          {prefix}
                          {item.amount}
                        </Text>
                        <Pressable onPress={() => copyTxCode(item.transaction_id)} hitSlop={6} style={styles.refCodeBadge}>
                          <Ionicons name="copy-outline" size={10} color={colors.textMuted} />
                          <Text style={[styles.refCodeText, { color: colors.textMuted }]}>
                            {item.transaction_id}
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                }}
              />
            )}
          </View>
        </View>
      </Modal>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingBottom: 60, paddingTop: 6 },

  /* ================= HERO CARD (MATCHING DASHBOARD HERO) ================= */
  heroSummaryCard: {
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
  heroTopRow: {
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
    marginTop: 6,
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
  ratioSavingsBar: {
    backgroundColor: "#10B981",
    height: "100%",
  },
  ratioLoansBar: {
    backgroundColor: "#EF4444",
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

  /* UNION TABS */
  unionTabsSection: { marginTop: 14, marginBottom: 12 },
  unionHeaderBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  unionHeaderTitle: { fontSize: 12, fontWeight: "800", letterSpacing: 0.2 },
  unionHeaderCount: { fontSize: 11, fontWeight: "600" },
  unionTabsScroll: { paddingHorizontal: 16, gap: 8, paddingBottom: 4 },
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

  /* CONTROLS & SEARCH */
  controlsWrap: { paddingHorizontal: 16, gap: 10, marginBottom: 14 },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 13, height: "100%" },
  filterChipRow: { gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 11, fontWeight: "700" },
  sortBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  resultCount: { fontSize: 11, fontWeight: "600" },
  sortLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.4 },
  sortChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  sortChipText: { fontSize: 11, fontWeight: "700" },

  /* CLIENT CARDS */
  listSection: { paddingHorizontal: 16, gap: 12 },
  clientCard: { borderRadius: 18, borderWidth: 1, padding: 14, gap: 12 },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  clientAvatar: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  avatarInitials: { fontSize: 15, fontWeight: "800", color: "#3B82F6" },
  clientName: { fontSize: 14.5, fontWeight: "800" },
  statusBadge: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusBadgeText: { fontSize: 10, fontWeight: "800" },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 4, flexWrap: "wrap" },
  idBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  idBadgeText: { fontSize: 9.5, fontWeight: "800", fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  unionBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  unionBadgeText: { fontSize: 9.5, fontWeight: "800" },
  phoneTag: { flexDirection: "row", alignItems: "center", gap: 3 },
  phoneText: { fontSize: 11.5, color: "#3B82F6", fontWeight: "600" },

  quickContactGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  contactIconButton: { width: 36, height: 36, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },

  /* DUAL STATS */
  statsBox: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1 },
  balanceCol: { flex: 1, alignItems: "center" },
  balanceLabel: { fontSize: 8.5, fontWeight: "800", color: "#64748B", letterSpacing: 0.4 },
  balanceValue: { fontSize: 14, fontWeight: "900", marginTop: 2 },
  balanceDivider: { width: 1, height: 24 },

  guarantorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  guarantorLabel: { fontSize: 11, fontWeight: "500" },
  guarantorName: { fontSize: 11.5, fontWeight: "700" },
  guarantorActionBtn: { flexDirection: "row", alignItems: "center", gap: 3 },
  guarantorPhoneText: { fontSize: 11, color: "#3B82F6", fontWeight: "600" },
  guarantorWaIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  addGuarantorText: { fontSize: 11, fontWeight: "700", color: "#3B82F6" },

  cardActionsRow: { flexDirection: "row", gap: 8 },
  btnOutline: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  btnOutlineText: { fontSize: 12.5, fontWeight: "700" },
  btnPrimary: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  btnPrimaryText: { fontSize: 12.5, fontWeight: "700", color: "#fff" },

  loadMoreBtn: {
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    marginTop: 4,
  },
  loadMoreText: { fontSize: 12.5, fontWeight: "700" },
  endOfListIndicator: { paddingVertical: 18, alignItems: "center" },
  endOfListText: { fontSize: 11.5, fontWeight: "500" },

  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 24,
    alignItems: "center",
    gap: 6,
    marginTop: 10,
  },
  emptyIconCircle: { width: 50, height: 50, borderRadius: 25, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: 14, fontWeight: "700" },
  emptySub: { fontSize: 11.5, textAlign: "center", lineHeight: 17 },
  resetFilterBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: "rgba(59,130,246,0.12)",
  },
  resetFilterText: { fontSize: 12, fontWeight: "700" },

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

  /* MODALS COMMON */
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  modalSheet: { borderTopLeftRadius: 26, borderTopRightRadius: 26, borderWidth: 1, padding: 18, maxHeight: "90%" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: "#CBD5E1", alignSelf: "center", marginBottom: 14 },
  modalHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 16 },
  modalTitle: { fontSize: 16, fontWeight: "800" },
  modalSub: { fontSize: 11.5, marginTop: 2 },
  closeBtn: { padding: 4 },

  modalField: { gap: 6 },
  fieldLabel: { fontSize: 9.5, fontWeight: "800", letterSpacing: 0.5 },
  disabledInput: { height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, justifyContent: "center" },
  disabledInputText: { fontSize: 13.5, fontWeight: "700" },
  inputBox: { flexDirection: "row", alignItems: "center", height: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, gap: 10 },
  modalInput: { flex: 1, fontSize: 13.5, fontWeight: "600" },
  modalActionsRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  modalCancelBtn: { flex: 1, height: 46, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  modalCancelText: { fontSize: 13, fontWeight: "700" },
  modalSubmitBtn: { flex: 1.6, height: 46, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  modalSubmitText: { color: "#fff", fontSize: 13, fontWeight: "800" },

  /* HISTORY TIMELINE */
  historyStatBadgeGreen: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(16,185,129,0.12)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  historyStatGreenText: { color: "#10B981", fontSize: 11, fontWeight: "800" },
  historyStatBadgeRed: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(239,68,68,0.12)", paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  historyStatRedText: { color: "#EF4444", fontSize: 11, fontWeight: "800" },

  historyTabsRow: { flexDirection: "row", borderBottomWidth: 1, marginBottom: 8 },
  historyTabBtn: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2 },
  historyTabText: { fontSize: 11.5, fontWeight: "800", textTransform: "uppercase" },

  timelineCard: { flexDirection: "row", alignItems: "center", padding: 12, borderRadius: 14, borderWidth: 1 },
  timelineIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  txTitle: { fontSize: 13, fontWeight: "800" },
  txDate: { fontSize: 10.5, marginTop: 1 },
  badgeWrap: { marginTop: 4 },
  descBadge: { fontSize: 9.5, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.4 },
  txAmount: { fontSize: 13.5, fontWeight: "900" },
  refCodeBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, backgroundColor: "rgba(0,0,0,0.05)", marginTop: 4 },
  refCodeText: { fontSize: 10, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace", fontWeight: "700" },
});