import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  Dimensions,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Animated,
  Easing,
  ActivityIndicator,
  Modal,
  Share,
  Platform,
  Linking,
  Alert,
} from "react-native";
import Constants from "expo-constants";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAllPendingCounts,
  isOnline,
  autoSyncIfOnline,
  cacheClients,
  cacheUnions,
  loadOfflineWorkspace,
} from "../../src/db/database";
import {
  fetchUnionsForOfficer,
  bootstrapCoScreenData,
  buildUnionStatsFromClients,
} from "../../src/db/offlineHelpers";
import { hydrateOfflineCache } from "../../src/db/sync";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import { router } from "expo-router";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_DASHBOARD = `${API_BASE}/api/dashboard_api.php`;
const API_VERSION_CHECK = `${API_BASE}/api/version_check_api.php`;

// Force re-login (password) after this many days
const LAST_PASSWORD_LOGIN_KEY = "cupad_last_password_login_at";
const SESSION_MAX_DAYS = 5;
const SESSION_MAX_MS = SESSION_MAX_DAYS * 24 * 60 * 60 * 1000;
const SNOOZE_UPDATE_KEY = "cupad_update_snoozed_until";

const CACHE_KEYS = {
  STATS: "cupad_cache_dashboard_stats",
  USER: "cupad_cache_dashboard_user",
  ACTIVITIES: "cupad_cache_dashboard_activities",
  UNIONS: "cupad_cache_dashboard_unions",
  LAST_SYNC: "cupad_cache_last_sync",
  PRIVACY: "cupad_cache_privacy_hide_amounts",
};

type Activity = {
  type: string;
  client_name: string;
  amount: number;
  date: string;
  reference?: string;
  union_name?: string;
};

type UnionStat = {
  name: string;
  clients: number;
  savings: number;
  loans: number;
};

type VersionCheckInfo = {
  has_update: boolean;
  is_forced: boolean;
  client_version?: string;
  latest_version: string;
  min_supported_version?: string;
  store_url: string;
  release_notes?: string;
};

function formatNaira(amount: number | string, hide = false): string {
  if (hide) return "••••••••";
  const num = Math.abs(Number(amount) || 0);
  return `₦${num.toLocaleString("en-NG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

function formatSyncTime(isoString: string | null): string {
  if (!isoString) return "Never";
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 45) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(isoString).toLocaleDateString("en-NG", { month: "short", day: "numeric" });
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

export default function CoDashboardScreen() {
  const { colors, isDark } = useTheme();
  const [user, setUser] = useState<any>(null);
  const [stats, setStats] = useState<any>({
    total_clients: 0,
    monthly_savings: 0,
    monthly_disbursed: 0,
    active_loans: 0,
    grand_savings: 0,
    grand_loans: 0,
    grand_net: 0,
    today_savings: 0,
    today_loans: 0,
  });
  const [unionStats, setUnionStats] = useState<UnionStat[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [activityLoading, setActivityLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [activityError, setActivityError] = useState<string | null>(null);
  const [hideBalances, setHideBalances] = useState(false);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [pendingOffline, setPendingOffline] = useState(0);

  // Version Check State
  const [updateInfo, setUpdateInfo] = useState<VersionCheckInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isOpeningStore, setIsOpeningStore] = useState(false);

  const isInitialMount = useRef(true);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const sessionChecked = useRef(false);

  const currentAppVersion = Constants.expoConfig?.version || "1.0.1";

  const orbColor1 = isDark ? "rgba(37,99,235,0.18)" : "rgba(37,99,235,0.10)";
  const orbColor2 = isDark ? "rgba(14,165,233,0.14)" : "rgba(14,165,233,0.08)";
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";

  const forceLogoutAndRedirect = async () => {
    try {
      const keysToRemove = [
        "auth_token",
        "auth_user",
        "cupad_jwt",
        "cupad_user",
        "cupad_role",
        "cupad_biometric_enabled",
        "cupad_bio_enabled",
        "cupad_biometric_user",
        "cupad_biometric_token",
        "cupad_biometric_username",
        "cupad_last_login_method",
      ];
      await AsyncStorage.multiRemove(keysToRemove);
    } catch (e) {
      console.log("Logout clear error:", e);
    }
    router.replace("/login");
  };

  const checkSessionExpiry = useCallback(async (): Promise<boolean> => {
    if (sessionChecked.current) return true;
    sessionChecked.current = true;

    try {
      const lastPassLoginStr = await AsyncStorage.getItem(LAST_PASSWORD_LOGIN_KEY);
      if (!lastPassLoginStr) {
        await forceLogoutAndRedirect();
        return false;
      }

      const lastPassLogin = parseInt(lastPassLoginStr, 10);
      if (isNaN(lastPassLogin) || Date.now() - lastPassLogin > SESSION_MAX_MS) {
        await forceLogoutAndRedirect();
        return false;
      }

      return true;
    } catch (e) {
      console.log("Session expiry check error:", e);
      return true;
    }
  }, []);

  const checkPendingCounts = useCallback(async () => {
    try {
      const counts = await getAllPendingCounts();
      setPendingOffline(counts.total || 0);
    } catch {
      setPendingOffline(0);
    }
  }, []);

  // Dedicated Version Check Helper with Snooze respect
  const checkAppVersion = useCallback(async (isManualTrigger = false) => {
    try {
      const online = await isOnline().catch(() => false);
      if (!online) return;

      const res = await axios.get(
        `${API_VERSION_CHECK}?app_version=${encodeURIComponent(currentAppVersion)}&platform=${Platform.OS}`,
        { timeout: 7000 }
      );

      if (res.data?.success && res.data.has_update) {
        const updateData: VersionCheckInfo = {
          has_update: true,
          is_forced: Boolean(res.data.is_forced),
          client_version: res.data.client_version || currentAppVersion,
          latest_version: res.data.latest_version,
          store_url: res.data.store_url,
          release_notes: res.data.release_notes,
        };

        setUpdateInfo(updateData);

        if (updateData.is_forced) {
          setShowUpdateModal(true);
          return;
        }

        // Check if optional update was snoozed in the last 24 hours
        if (!isManualTrigger) {
          const snoozedUntil = await AsyncStorage.getItem(SNOOZE_UPDATE_KEY);
          if (snoozedUntil && Date.now() < parseInt(snoozedUntil, 10)) {
            // Keep updateInfo so the top banner stays accessible, but don't disrupt with modal
            return;
          }
        }

        setShowUpdateModal(true);
      } else {
        setUpdateInfo(null);
      }
    } catch (e) {
      // Non-blocking error
    }
  }, [currentAppVersion]);

  // Snooze handler
  const handleDismissUpdate = async () => {
    setShowUpdateModal(false);
    try {
      // Snooze modal popup for 24 hours
      const nextSnooze = Date.now() + 24 * 60 * 60 * 1000;
      await AsyncStorage.setItem(SNOOZE_UPDATE_KEY, String(nextSnooze));
    } catch {}
  };

  // 1. FAST SQLITE CACHE FIRST HYDRATION
  const hydrateFromSqlite = useCallback(async (username?: string) => {
    try {
      const boot = await bootstrapCoScreenData(username);
      if (boot.clients && boot.clients.length > 0) {
        const derivedUnions = buildUnionStatsFromClients(boot.clients);
        if (derivedUnions.length) setUnionStats(derivedUnions);

        const totalClients = boot.clients.length;
        let totalSav = 0;
        let totalLoan = 0;
        let activeLoansCount = 0;

        boot.clients.forEach((c: any) => {
          const s = Number(c.savings_balance ?? c.savings ?? c.total_savings ?? 0);
          const l = Number(c.outstanding_loan ?? c.loan_balance ?? c.loan ?? 0);
          totalSav += s;
          totalLoan += l;
          if (l > 0.01) activeLoansCount++;
        });

        setStats((prev: any) => ({
          ...prev,
          total_clients: totalClients,
          grand_savings: totalSav,
          grand_loans: totalLoan,
          grand_net: totalSav - totalLoan,
          active_loans: activeLoansCount,
        }));
        setLoading(false);
      } else if (boot.unionNames && boot.unionNames.length > 0) {
        setUnionStats(boot.unionNames.map((name) => ({ name, clients: 0, savings: 0, loans: 0 })));
      }
    } catch (e) {
      console.log("SQLite instant hydration note:", e);
    }
  }, []);

  const loadCache = useCallback(async () => {
    try {
      const [cachedStats, cachedUser, cachedActivities, cachedUnions, cachedSync, cachedPrivacy] =
        await Promise.all([
          AsyncStorage.getItem(CACHE_KEYS.STATS),
          AsyncStorage.getItem(CACHE_KEYS.USER),
          AsyncStorage.getItem(CACHE_KEYS.ACTIVITIES),
          AsyncStorage.getItem(CACHE_KEYS.UNIONS),
          AsyncStorage.getItem(CACHE_KEYS.LAST_SYNC),
          AsyncStorage.getItem(CACHE_KEYS.PRIVACY),
        ]);

      let hasData = false;
      let uname = "";
      if (cachedUser) {
        const u = JSON.parse(cachedUser);
        setUser(u);
        uname = u.username || "";
      }
      if (cachedStats) {
        setStats(JSON.parse(cachedStats));
        hasData = true;
      }
      if (cachedActivities) setActivities(JSON.parse(cachedActivities));
      if (cachedUnions) setUnionStats(JSON.parse(cachedUnions));
      if (cachedSync) setLastSync(cachedSync);
      if (cachedPrivacy !== null) setHideBalances(cachedPrivacy === "true");

      await hydrateFromSqlite(uname);
      await checkPendingCounts();

      if (hasData) setLoading(false);
    } catch {}
  }, [hydrateFromSqlite, checkPendingCounts]);

  const toggleHideBalances = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const next = !hideBalances;
    setHideBalances(next);
    await AsyncStorage.setItem(CACHE_KEYS.PRIVACY, String(next));
  };

  // 2. BACKGROUND SERVER RECONCILIATION
  const fetchDashboard = useCallback(
    async (showLoading = false) => {
      try {
        if (showLoading) setLoading(true);
        setSyncing(true);

        const stored = await AsyncStorage.getItem("cupad_user");
        let username = "";
        if (stored) {
          const p = JSON.parse(stored);
          setUser(p);
          username = p.username;
        } else {
          const bio = await AsyncStorage.getItem("cupad_biometric_user");
          if (bio) {
            const p = JSON.parse(bio);
            setUser(p);
            username = p.username;
          }
        }
        if (!username) return;

        const online = await isOnline().catch(() => false);
        if (!online) {
          setIsOffline(true);
          await hydrateFromSqlite(username);
          await checkPendingCounts();
          setLoading(false);
          setSyncing(false);
          setRefreshing(false);
          return;
        }

        const res = await axios.get(
          `${API_DASHBOARD}?action=dashboard&username=${encodeURIComponent(
            username
          )}&app_version=${encodeURIComponent(currentAppVersion)}&platform=${Platform.OS}`,
          { timeout: 9000 }
        );

        if (res.data?.success) {
          if (res.data.version_check && res.data.version_check.has_update) {
            setUpdateInfo(res.data.version_check);
            if (res.data.version_check.is_forced) {
              setShowUpdateModal(true);
            }
          }

          setStats(res.data.stats);
          let uStats = res.data.union_stats || [];

          if (!uStats.length) {
            try {
              const uf = await fetchUnionsForOfficer(username);
              uStats = (uf.names || []).map((name: string) => ({
                name,
                clients: 0,
                savings: 0,
                loans: 0,
              }));
            } catch {}
          }

          if (uStats.length) {
            setUnionStats(uStats);
            await AsyncStorage.setItem(CACHE_KEYS.UNIONS, JSON.stringify(uStats));
            try {
              await cacheUnions(uStats, username);
            } catch {}
          }

          if (Array.isArray(res.data.clients) && res.data.clients.length) {
            try {
              await cacheClients(res.data.clients, username);
            } catch {}
          }

          try {
            hydrateOfflineCache(username);
          } catch {}

          setIsOffline(false);
          const now = new Date().toISOString();
          setLastSync(now);
          await AsyncStorage.setItem(CACHE_KEYS.LAST_SYNC, now);
          await AsyncStorage.setItem(CACHE_KEYS.STATS, JSON.stringify(res.data.stats));

          if (res.data.user) {
            const updated = { ...JSON.parse(stored || "{}"), ...res.data.user };
            setUser(updated);
            await AsyncStorage.setItem("cupad_user", JSON.stringify(updated));
          }
        }
      } catch {
        setIsOffline(true);
        if (user?.username) {
          await hydrateFromSqlite(user.username);
        }
      } finally {
        await checkPendingCounts();
        setLoading(false);
        setSyncing(false);
        setRefreshing(false);
      }
    },
    [hydrateFromSqlite, checkPendingCounts, user?.username, currentAppVersion]
  );

  const fetchActivities = useCallback(async (pageNum = 1, reset = false) => {
    try {
      setActivityError(null);
      if (pageNum === 1) setActivityLoading(true);
      else setLoadingMore(true);

      const stored = await AsyncStorage.getItem("cupad_user");
      if (!stored) return;
      const { username } = JSON.parse(stored);

      const online = await isOnline().catch(() => false);
      if (!online) {
        const cached = await AsyncStorage.getItem(CACHE_KEYS.ACTIVITIES);
        if (cached) setActivities(JSON.parse(cached));
        setActivityLoading(false);
        setLoadingMore(false);
        return;
      }

      const res = await axios.get(
        `${API_DASHBOARD}?action=load_activities&username=${encodeURIComponent(username)}&page=${pageNum}&limit=15`,
        { timeout: 9000 }
      );
      if (res.data?.success) {
        const newActivities = res.data.activities || [];
        if (reset || pageNum === 1) {
          setActivities(newActivities);
          await AsyncStorage.setItem(CACHE_KEYS.ACTIVITIES, JSON.stringify(newActivities));
        } else {
          setActivities((prev) => {
            const merged = [...prev, ...newActivities];
            AsyncStorage.setItem(CACHE_KEYS.ACTIVITIES, JSON.stringify(merged));
            return merged;
          });
        }
        setHasMore(res.data.has_more ?? newActivities.length >= 15);
        setPage(pageNum);
      }
    } catch {
      setIsOffline(true);
      if (pageNum === 1) {
        const cached = await AsyncStorage.getItem(CACHE_KEYS.ACTIVITIES);
        if (cached) setActivities(JSON.parse(cached));
        else setActivityError("Offline mode: viewing local transaction cache.");
      }
    } finally {
      setLoadingMore(false);
      setActivityLoading(false);
    }
  }, []);

  const searchActivities = useCallback(
    async (query: string) => {
      if (!query.trim()) {
        fetchActivities(1, true);
        return;
      }
      try {
        setActivityLoading(true);
        const stored = await AsyncStorage.getItem("cupad_user");
        if (!stored) return;
        const { username } = JSON.parse(stored);
        const res = await axios.get(
          `${API_DASHBOARD}?action=search_activities&username=${encodeURIComponent(username)}&q=${encodeURIComponent(query)}`,
          { timeout: 8000 }
        );
        if (res.data?.success && Array.isArray(res.data.activities)) {
          setActivities(res.data.activities);
        }
      } catch {
      } finally {
        setActivityLoading(false);
      }
    },
    [fetchActivities]
  );

  const handleManualSync = async () => {
    if (syncing) return;
    setSyncing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await autoSyncIfOnline();
      await fetchDashboard(false);
      await checkPendingCounts();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 380,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    checkSessionExpiry().then((stillValid) => {
      if (!stillValid) return;
      loadCache().then(() => {
        checkAppVersion(false);
        fetchDashboard(false);
        fetchActivities(1, true);
      });
    });
  }, [loadCache, fetchDashboard, fetchActivities, fadeAnim, checkSessionExpiry, checkAppVersion]);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const d = setTimeout(() => {
      searchActivities(search);
    }, 320);
    return () => clearTimeout(d);
  }, [search, searchActivities]);

  const onRefresh = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    await Promise.all([
      checkAppVersion(false),
      fetchDashboard(false),
      fetchActivities(1, true),
      checkPendingCounts(),
    ]);
  }, [fetchDashboard, fetchActivities, checkPendingCounts, checkAppVersion]);

  const filteredActivities = useMemo(() => {
    return activities.filter((a) => {
      if (filter === "All") return true;
      const type = (a.type || "").toLowerCase();
      if (filter === "Saving") return type.includes("saving");
      if (filter === "Payment") return type.includes("payment") || type.includes("repay");
      if (filter === "Disbursement") return type.includes("disburse") || type.includes("loan");
      if (filter === "Withdrawal") return type.includes("withdraw");
      return true;
    });
  }, [activities, filter]);

  const QUICK_ACTIONS = [
    { title: "Collect", route: "/co/combined", icon: "flash", color: "#10B981" },
    { title: "Savings", route: "/co/savings", icon: "wallet", color: "#2563EB" },
    { title: "Repayment", route: "/co/repayment", icon: "cash", color: "#8B5CF6" },
    { title: "Disburse", route: "/co/disbursement", icon: "paper-plane", color: "#0284C7" },
    { title: "Register", route: "/co/add-client", icon: "person-add", color: "#4F46E5" },
    { title: "Clients", route: "/co/clients", icon: "people", color: "#0D9488" },
    { title: "Withdraw", route: "/co/withdrawal", icon: "arrow-down-circle", color: "#EF4444" },
    { title: "Unions", route: "/co/unions", icon: "business", color: "#D97706" },
    { title: "Analytics", route: "/co/reports", icon: "bar-chart", color: "#EA580C" },
    { title: "History", route: "/co/history", icon: "time", color: "#059669" },
    { title: "Summary", route: "/co/client_summary", icon: "document-text", color: "#64748B" },
    { title: "Close Acc", route: "/co/close", icon: "person-remove", color: "#E11D48" },
  ];

  const totalVolume = (Number(stats.grand_savings) || 0) + (Number(stats.grand_loans) || 0);
  const savingsRatio = totalVolume > 0 ? ((Number(stats.grand_savings) || 0) / totalVolume) * 100 : 50;

  const handleShareReceipt = async (item: Activity) => {
    try {
      Haptics.selectionAsync();
      await Share.share({
        message: `Transaction Record\nClient: ${item.client_name}\nType: ${item.type}\nAmount: ₦${Number(item.amount).toLocaleString()}\nDate: ${new Date(item.date).toLocaleString()}`,
      });
    } catch {}
  };

  const handleOpenStore = async () => {
    if (!updateInfo?.store_url) {
      Alert.alert("Store Link Unavailable", "Please contact administrative support for the update APK.");
      return;
    }
    try {
      setIsOpeningStore(true);
      Haptics.selectionAsync();
      const supported = await Linking.canOpenURL(updateInfo.store_url);
      if (supported) {
        await Linking.openURL(updateInfo.store_url);
      } else {
        Alert.alert("Notice", `Unable to launch download URL: ${updateInfo.store_url}`);
      }
    } catch (e) {
      Alert.alert("Error", "Could not open update package link.");
    } finally {
      setIsOpeningStore(false);
    }
  };

  // Helper to format release notes into clean bullet lines
  const parsedReleaseNotes = useMemo(() => {
    if (!updateInfo?.release_notes) return [];
    return updateInfo.release_notes
      .split(/[\r\n]+/)
      .map((line) => line.replace(/^[-*•\s]+/, "").trim())
      .filter((line) => line.length > 0);
  }, [updateInfo?.release_notes]);

  const storePlatformLabel = useMemo(() => {
    if (updateInfo?.store_url?.endsWith(".apk")) return "Direct APK Download";
    return Platform.OS === "ios" ? "Apple App Store" : "Google Play Store";
  }, [updateInfo?.store_url]);

  return (
    <CoScreenWrapper>
      {/* Background Soft Orbs */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]} pointerEvents="none">
        <Orb size={260} color={orbColor1} left={-60} top={-40} delay={0} />
        <Orb size={220} color={orbColor2} left={width - 130} top={140} delay={1000} />
        <Orb size={280} color={orbColor1} left={width * 0.25} top={height * 0.45} delay={2000} />
      </View>

      <View style={styles.container}>
        {/* Persistent Non-Intrusive Update Ribbon (When Update Available but Modal is Snoozed) */}
        {updateInfo?.has_update && !updateInfo.is_forced && !showUpdateModal && (
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowUpdateModal(true);
            }}
            style={({ pressed }) => [
              styles.updateNotificationRibbon,
              { opacity: pressed ? 0.85 : 1 },
            ]}
          >
            <View style={styles.ribbonLeft}>
              <View style={styles.ribbonPulse}>
                <Ionicons name="sparkles" size={13} color="#FFF" />
              </View>
              <Text style={styles.ribbonText}>
                New update <Text style={{ fontWeight: "800" }}>v{updateInfo.latest_version}</Text> ready
              </Text>
            </View>
            <View style={styles.ribbonActionBtn}>
              <Text style={styles.ribbonActionText}>Review</Text>
              <Ionicons name="chevron-forward" size={12} color="#FFF" />
            </View>
          </Pressable>
        )}

        {/* Offline Pending Sync Banner */}
        {pendingOffline > 0 && (
          <Pressable
            onPress={handleManualSync}
            disabled={syncing}
            style={({ pressed }) => [
              styles.offlineFloatingBadge,
              { opacity: pressed || syncing ? 0.8 : 1 },
            ]}
          >
            <View style={styles.offlineDot} />
            <Text style={styles.offlineBadgeText}>
              {pendingOffline} offline record{pendingOffline > 1 ? "s" : ""} pending server sync
            </Text>
            <View style={styles.offlineActionBtn}>
              {syncing ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Text style={styles.offlineActionText}>Sync Now</Text>
                  <Ionicons name="sync" size={12} color="#FFF" />
                </>
              )}
            </View>
          </Pressable>
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
          {/* TERRITORY PILLS */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.territoryRow}
          >
            <View style={[styles.territoryPill, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Ionicons name="globe-outline" size={12} color="#8B5CF6" />
              <Text style={[styles.territoryText, { color: colors.text }]}>
                {user?.zone_name || user?.zone || "All Zones"}
              </Text>
            </View>
            <View style={[styles.territoryPill, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Ionicons name="location-outline" size={12} color="#06B6D4" />
              <Text style={[styles.territoryText, { color: colors.text }]}>
                {user?.area_name || user?.area || "All Areas"}
              </Text>
            </View>
            <View style={[styles.territoryPill, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Ionicons name="business-outline" size={12} color="#F97316" />
              <Text style={[styles.territoryText, { color: colors.text }]}>
                {user?.branch_name || user?.branch || "Main Branch"}
              </Text>
            </View>
          </ScrollView>

          {/* ================= HERO PORTFOLIO CARD ================= */}
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
            {/* Status & Sync Time Pill */}
            <View style={styles.heroHeaderBar}>
              <View
                style={[
                  styles.heroTagPill,
                  { backgroundColor: isOffline ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)" },
                ]}
              >
                <View
                  style={[styles.statusPulseDot, { backgroundColor: isOffline ? "#F59E0B" : "#10B981" }]}
                />
                <Text
                  style={[
                    styles.heroTagText,
                    { color: isOffline ? "#F59E0B" : "#10B981" },
                  ]}
                >
                  {isOffline ? "OFFLINE CACHE ACTIVE" : "LIVE PORTFOLIO"}
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
                  name={isOffline ? "cloud-offline-outline" : "checkmark-circle-outline"}
                  size={12}
                  color={colors.textMuted}
                />
                <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>
                  {formatSyncTime(lastSync)}
                </Text>
              </Pressable>
            </View>

            {/* Total Balance */}
            <View style={styles.heroMainBalanceSection}>
              <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                TOTAL SAVINGS PORTFOLIO
              </Text>
              <View style={styles.heroAmountRow}>
                <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                  {formatNaira(stats.grand_savings, hideBalances)}
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
                  Portfolio Health: {Math.round(savingsRatio)}% Savings
                </Text>
                <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                  {100 - Math.round(savingsRatio)}% Loans
                </Text>
              </View>
              <View style={styles.ratioTrack}>
                <View style={[styles.ratioSavingsBar, { width: `${savingsRatio}%` }]} />
                <View style={[styles.ratioLoansBar, { width: `${100 - savingsRatio}%` }]} />
              </View>
            </View>

            {/* Metrics 4-Grid */}
            <View style={styles.heroMetricsGrid}>
              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="sparkles" size={11} color="#10B981" />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Today's Savings</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: "#10B981" }]}>
                  {formatNaira(stats.today_savings, hideBalances)}
                </Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="paper-plane" size={11} color="#3B82F6" />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Loans Disbursed</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>
                  {formatNaira(stats.grand_loans, hideBalances)}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>
                  {stats.active_loans || 0} active loans
                </Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons
                    name={(Number(stats.grand_net) || 0) >= 0 ? "trending-up" : "trending-down"}
                    size={12}
                    color={(Number(stats.grand_net) || 0) >= 0 ? "#10B981" : "#EF4444"}
                  />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Net Position</Text>
                </View>
                <Text
                  style={[
                    styles.metricItemValue,
                    { color: (Number(stats.grand_net) || 0) >= 0 ? "#10B981" : "#EF4444" },
                  ]}
                >
                  {formatNaira(stats.grand_net, hideBalances)}
                </Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="people" size={12} color={colors.primary} />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Total Clients</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>
                  {Number(stats.total_clients || 0).toLocaleString()}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>across all groups</Text>
              </View>
            </View>
          </LinearGradient>

          {/* QUICK ACTIONS SECTION */}
          <View style={styles.sectionHeader}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Actions</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Daily field operations</Text>
            </View>
            <View style={[styles.badgeCount, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <Text style={[styles.badgeCountText, { color: colors.textMuted }]}>
                {QUICK_ACTIONS.length}
              </Text>
            </View>
          </View>

          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={QUICK_ACTIONS}
            contentContainerStyle={styles.horizontalActionsContainer}
            keyExtractor={(_, i) => String(i)}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  Haptics.selectionAsync();
                  router.push(item.route as any);
                }}
                style={({ pressed }) => [
                  styles.actionScrollCard,
                  {
                    backgroundColor: cardSurfaceBg,
                    borderColor: glassBorder,
                    transform: [{ scale: pressed ? 0.94 : 1 }],
                  },
                ]}
              >
                <View style={[styles.actionIconCircle, { backgroundColor: `${item.color}15` }]}>
                  <Ionicons name={item.icon as any} size={22} color={item.color} />
                </View>
                <Text style={[styles.actionScrollText, { color: colors.text }]} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
            )}
          />

          {/* UNION BREAKDOWN */}
          <View style={[styles.sectionHeader, { marginTop: 22 }]}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Union Breakdown</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Active assigned groups</Text>
            </View>
            <Pressable
              onPress={() => router.push("/co/unions" as any)}
              style={({ pressed }) => [
                styles.seeAllBtn,
                { opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Text style={[styles.seeAllText, { color: colors.primary }]}>Manage</Text>
              <Ionicons name="chevron-forward" size={14} color={colors.primary} />
            </Pressable>
          </View>

          {loading && unionStats.length === 0 ? (
            <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16 }}>
              <Skeleton style={{ width: 220, height: 110 }} />
              <Skeleton style={{ width: 220, height: 110 }} />
            </View>
          ) : unionStats.length === 0 ? (
            <View style={[styles.emptyBox, { borderColor: glassBorder, backgroundColor: cardSurfaceBg }]}>
              <Ionicons name="folder-open-outline" size={26} color={colors.textMuted} />
              <Text style={[styles.emptyBoxText, { color: colors.textMuted }]}>No union groups assigned yet</Text>
            </View>
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={unionStats}
              contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
              keyExtractor={(item) => item.name}
              renderItem={({ item }) => {
                const unionTotal = (item.savings || 0) + (item.loans || 0);
                const unionRatio = unionTotal > 0 ? ((item.savings || 0) / unionTotal) * 100 : 50;

                return (
                  <Pressable
                    onPress={() => {
                      Haptics.selectionAsync();
                      router.push(`/co/unions?name=${encodeURIComponent(item.name)}` as any);
                    }}
                    style={({ pressed }) => [
                      styles.unionCard,
                      {
                        backgroundColor: cardSurfaceBg,
                        borderColor: glassBorder,
                        transform: [{ scale: pressed ? 0.97 : 1 }],
                      },
                    ]}
                  >
                    <View style={styles.unionCardTop}>
                      <Text style={[styles.unionCardName, { color: colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <View style={[styles.unionClientBadgePill, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                        <Text style={[styles.unionClientBadge, { color: colors.textMuted }]}>
                          {item.clients} clients
                        </Text>
                      </View>
                    </View>

                    <View style={styles.unionAmountRow}>
                      <View>
                        <Text style={[styles.unionLabel, { color: colors.textMuted }]}>Savings</Text>
                        <Text style={[styles.unionValue, { color: "#10B981" }]}>
                          {formatNaira(item.savings, hideBalances)}
                        </Text>
                      </View>
                      <View style={{ alignItems: "flex-end" }}>
                        <Text style={[styles.unionLabel, { color: colors.textMuted }]}>Loans</Text>
                        <Text style={[styles.unionValue, { color: "#EF4444" }]}>
                          {formatNaira(item.loans, hideBalances)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.unionMicroBar}>
                      <View style={[styles.unionMicroSavings, { width: `${unionRatio}%` }]} />
                    </View>
                  </Pressable>
                );
              }}
            />
          )}

          {/* SEARCH & RECENT ACTIVITIES */}
          <View style={[styles.sectionHeader, { marginTop: 24 }]}>
            <View>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>Recent Activities</Text>
              <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>Real-time activity audit</Text>
            </View>
            {activityLoading && <ActivityIndicator size="small" color={colors.primary} />}
          </View>

          {/* Search Box */}
          <View style={[styles.searchContainer, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
            <Ionicons name="search" size={18} color={colors.textMuted} />
            <TextInput
              placeholder="Search by client or reference..."
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
              style={[styles.searchInput, { color: colors.text }]}
              autoCapitalize="none"
              returnKeyType="search"
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch("")} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </Pressable>
            )}
          </View>

          {/* Category Filter Chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterBarContainer}
          >
            {["All", "Saving", "Payment", "Disbursement", "Withdrawal"].map((tab) => {
              const active = filter === tab;
              return (
                <Pressable
                  key={tab}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setFilter(tab);
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
                    {tab}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Error Callout */}
          {activityError && (
            <View style={styles.errorBox}>
              <Ionicons name="cloud-offline-outline" size={18} color="#EF4444" />
              <Text style={styles.errorBoxText}>{activityError}</Text>
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  fetchActivities(1, true);
                }}
                style={styles.errorRetry}
              >
                <Text style={styles.errorRetryText}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* Activity List */}
          {loading && activities.length === 0 ? (
            <View style={{ paddingHorizontal: 16, gap: 10 }}>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} style={{ height: 68, borderRadius: 16 }} />
              ))}
            </View>
          ) : filteredActivities.length === 0 ? (
            <View style={[styles.emptyActivityCard, { backgroundColor: cardSurfaceBg, borderColor: glassBorder }]}>
              <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                <Ionicons name="receipt-outline" size={28} color={colors.textMuted} />
              </View>
              <Text style={[styles.emptyActivityTitle, { color: colors.text }]}>No transactions found</Text>
              <Text style={[styles.emptyActivitySub, { color: colors.textMuted }]}>
                {search ? "No records match your criteria." : "Field transactions and repayments will show here."}
              </Text>
            </View>
          ) : (
            filteredActivities.map((item, idx) => {
              const meta = getActivityMeta(item.type);
              return (
                <Pressable
                  key={idx}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setSelectedActivity(item);
                  }}
                  style={({ pressed }) => [
                    styles.activityItemCard,
                    {
                      backgroundColor: cardSurfaceBg,
                      borderColor: glassBorder,
                      transform: [{ scale: pressed ? 0.98 : 1 }],
                    },
                  ]}
                >
                  <View style={[styles.activityIconCircle, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={20} color={meta.color} />
                  </View>
                  <View style={{ flex: 1, marginRight: 8 }}>
                    <Text style={[styles.activityClient, { color: colors.text }]} numberOfLines={1}>
                      {item.client_name}
                    </Text>
                    <View style={styles.activityMetaRow}>
                      <Text style={[styles.activityTypeBadge, { color: meta.color }]}>{meta.label}</Text>
                      <Text style={[styles.dotSeparator, { color: colors.textMuted }]}>•</Text>
                      <Text style={[styles.activityDate, { color: colors.textMuted }]}>
                        {new Date(item.date).toLocaleDateString("en-NG", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </Text>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={[styles.activityAmount, { color: meta.color }]}>
                      {meta.sign}
                      {formatNaira(item.amount, hideBalances)}
                    </Text>
                    <Ionicons name="chevron-forward" size={13} color={colors.textMuted} style={{ marginTop: 3 }} />
                  </View>
                </Pressable>
              );
            })
          )}

          {hasMore && filteredActivities.length > 0 && (
            <Pressable
              onPress={() => fetchActivities(page + 1, false)}
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
                  <Text style={[styles.loadMoreText, { color: colors.primary }]}>Load More Activities</Text>
                  <Ionicons name="chevron-down" size={15} color={colors.primary} />
                </>
              )}
            </Pressable>
          )}
        </Animated.ScrollView>

        {/* ================= TRANSACTION DETAIL MODAL ================= */}
        <Modal visible={!!selectedActivity} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedActivity(null)} />
            <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              <View style={styles.modalHandle} />
              {selectedActivity && (
                <>
                  <View style={[styles.modalIconCircle, { backgroundColor: getActivityMeta(selectedActivity.type).bg }]}>
                    <Ionicons
                      name={getActivityMeta(selectedActivity.type).icon}
                      size={28}
                      color={getActivityMeta(selectedActivity.type).color}
                    />
                  </View>
                  <Text style={[styles.modalClient, { color: colors.text }]}>{selectedActivity.client_name}</Text>
                  <Text style={[styles.modalAmount, { color: getActivityMeta(selectedActivity.type).color }]}>
                    {getActivityMeta(selectedActivity.type).sign}
                    {formatNaira(selectedActivity.amount)}
                  </Text>

                  <View style={styles.statusSuccessPill}>
                    <Ionicons name="checkmark-circle" size={13} color="#10B981" />
                    <Text style={styles.statusSuccessText}>Transaction Completed</Text>
                  </View>

                  <View style={styles.modalDetailsGroup}>
                    <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                      <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Type</Text>
                      <Text style={[styles.modalDetailVal, { color: colors.text }]}>{selectedActivity.type}</Text>
                    </View>

                    {selectedActivity.reference && (
                      <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                        <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Reference</Text>
                        <Text style={[styles.modalDetailVal, { color: colors.text, fontFamily: "monospace" }]}>
                          {selectedActivity.reference}
                        </Text>
                      </View>
                    )}

                    <View style={[styles.modalDetailRow, { borderColor: glassBorder }]}>
                      <Text style={[styles.modalDetailLabel, { color: colors.textMuted }]}>Timestamp</Text>
                      <Text style={[styles.modalDetailVal, { color: colors.text }]}>
                        {new Date(selectedActivity.date).toLocaleString("en-NG", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.modalButtonsRow}>
                    <Pressable
                      onPress={() => handleShareReceipt(selectedActivity)}
                      style={[styles.modalSecondaryBtn, { borderColor: glassBorder }]}
                    >
                      <Ionicons name="share-social-outline" size={17} color={colors.text} />
                      <Text style={[styles.modalSecondaryText, { color: colors.text }]}>Share Receipt</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => setSelectedActivity(null)}
                      style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}
                    >
                      <Text style={styles.modalCloseText}>Done</Text>
                    </Pressable>
                  </View>
                </>
              )}
            </View>
          </View>
        </Modal>

        {/* ================= HIGH-CONVERSION VERSION UPDATE MODAL ================= */}
        <Modal
          visible={showUpdateModal && !!updateInfo}
          transparent
          animationType="slide"
          onRequestClose={() => {
            if (!updateInfo?.is_forced) {
              handleDismissUpdate();
            } else {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            }
          }}
        >
          <View style={styles.modalOverlay}>
            {!updateInfo?.is_forced && (
              <Pressable style={StyleSheet.absoluteFill} onPress={handleDismissUpdate} />
            )}

            <View style={[styles.updateModalCard, { backgroundColor: colors.card, borderColor: glassBorder }]}>
              {/* Optional Drag Handle */}
              {!updateInfo?.is_forced && <View style={styles.modalHandle} />}

              {/* Header Badge */}
              <View
                style={[
                  styles.updateBadgeType,
                  {
                    backgroundColor: updateInfo?.is_forced
                      ? "rgba(239, 68, 68, 0.14)"
                      : "rgba(16, 185, 129, 0.14)",
                    borderColor: updateInfo?.is_forced
                      ? "rgba(239, 68, 68, 0.3)"
                      : "rgba(16, 185, 129, 0.3)",
                  },
                ]}
              >
                <View
                  style={[
                    styles.statusPulseDot,
                    { backgroundColor: updateInfo?.is_forced ? "#EF4444" : "#10B981" },
                  ]}
                />
                <Text
                  style={[
                    styles.updateBadgeTypeText,
                    { color: updateInfo?.is_forced ? "#EF4444" : "#10B981" },
                  ]}
                >
                  {updateInfo?.is_forced ? "MANDATORY SECURITY UPDATE" : "RECOMMENDED ENHANCEMENT"}
                </Text>
              </View>

              {/* Title & App Identity */}
              <Text style={[styles.updateHeaderTitle, { color: colors.text }]}>
                {updateInfo?.is_forced ? "Update Required to Proceed" : "New Version Available"}
              </Text>

              {/* Version Comparison Component */}
              <View style={[styles.versionComparisonBar, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "#F8FAFC", borderColor: glassBorder }]}>
                <View style={styles.versionCol}>
                  <Text style={[styles.versionColLabel, { color: colors.textMuted }]}>CURRENT</Text>
                  <Text style={[styles.versionColVal, { color: colors.textMuted }]}>v{currentAppVersion}</Text>
                </View>
                <View style={styles.versionArrowCircle}>
                  <Ionicons name="arrow-forward" size={14} color="#6366F1" />
                </View>
                <View style={styles.versionCol}>
                  <Text style={[styles.versionColLabel, { color: "#10B981" }]}>LATEST</Text>
                  <Text style={[styles.versionColVal, { color: "#10B981", fontWeight: "900" }]}>
                    v{updateInfo?.latest_version}
                  </Text>
                </View>
              </View>

              {/* Description */}
              <Text style={[styles.versionDescription, { color: colors.textMuted }]}>
                {updateInfo?.is_forced
                  ? "This build includes required protocol updates for secure client records and ledger reconciliation. Older builds cannot sync with the server."
                  : "Upgrade now to experience increased offline responsiveness and transaction stability."}
              </Text>

              {/* Release Notes Highlights List */}
              {parsedReleaseNotes.length > 0 && (
                <View style={[styles.changelogCard, { backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "#F8FAFC", borderColor: glassBorder }]}>
                  <Text style={[styles.changelogTitle, { color: colors.textMuted }]}>HIGHLIGHTS IN THIS RELEASE</Text>
                  <ScrollView style={{ maxHeight: 110 }} showsVerticalScrollIndicator={false}>
                    {parsedReleaseNotes.map((note, idx) => (
                      <View key={idx} style={styles.bulletRow}>
                        <Ionicons name="checkmark-circle" size={15} color="#10B981" style={{ marginTop: 2 }} />
                        <Text style={[styles.bulletText, { color: colors.text }]}>{note}</Text>
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Store & Platform Footer Pill */}
              <View style={styles.sourcePill}>
                <Ionicons
                  name={Platform.OS === "ios" ? "logo-apple" : "logo-google-playstore"}
                  size={13}
                  color={colors.textMuted}
                />
                <Text style={[styles.sourcePillText, { color: colors.textMuted }]}>
                  Verified distribution via {storePlatformLabel}
                </Text>
              </View>

              {/* Action Buttons */}
              <View style={styles.modalButtonsRow}>
                {!updateInfo?.is_forced && (
                  <Pressable
                    onPress={handleDismissUpdate}
                    style={({ pressed }) => [
                      styles.modalSecondaryBtn,
                      { borderColor: glassBorder, opacity: pressed ? 0.7 : 1 },
                    ]}
                  >
                    <Text style={[styles.modalSecondaryText, { color: colors.textMuted }]}>
                      Remind Me Later
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={handleOpenStore}
                  disabled={isOpeningStore}
                  style={({ pressed }) => [
                    styles.modalPrimaryBtn,
                    {
                      backgroundColor: updateInfo?.is_forced ? "#EF4444" : colors.primary,
                      opacity: pressed || isOpeningStore ? 0.85 : 1,
                    },
                  ]}
                >
                  {isOpeningStore ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                      <Text style={styles.modalCloseText}>Install Update</Text>
                      <Ionicons name="download-outline" size={17} color="#FFF" />
                    </View>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 60, paddingTop: 6 },

  /* Update Notification Ribbon */
  updateNotificationRibbon: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#4F46E5",
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    shadowColor: "#4F46E5",
    shadowOpacity: 0.28,
    shadowRadius: 6,
    elevation: 3,
  },
  ribbonLeft: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  ribbonPulse: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(255, 255, 255, 0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  ribbonText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
  ribbonActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255, 255, 255, 0.22)",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  ribbonActionText: { color: "#FFF", fontSize: 11, fontWeight: "700" },

  offlineFloatingBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(217, 119, 6, 0.94)",
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    shadowColor: "#D97706",
    shadowOpacity: 0.25,
    shadowRadius: 5,
    elevation: 3,
  },
  offlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FEF3C7", marginRight: 8 },
  offlineBadgeText: { color: "#FFF", fontSize: 11, fontWeight: "600", flex: 1 },
  offlineActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
  },
  offlineActionText: { color: "#FFF", fontSize: 10.5, fontWeight: "700" },

  territoryRow: {
    paddingHorizontal: 16,
    gap: 8,
    marginBottom: 14,
  },
  territoryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  territoryText: { fontSize: 11, fontWeight: "600" },

  /* ================= HERO CARD ================= */
  heroCard: {
    marginHorizontal: 16,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
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
  ratioSavingsBar: {
    backgroundColor: "#10B981",
    height: "100%",
  },
  ratioLoansBar: {
    backgroundColor: "#3B82F6",
    height: "100%",
  },

  heroMetricsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingTop: 4,
  },
  metricGridItem: {
    width: "48.5%",
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
    fontSize: 13.5,
    fontWeight: "800",
    marginTop: 3,
  },
  metricItemSub: {
    fontSize: 9,
    marginTop: 1,
    fontWeight: "500",
  },

  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 16, fontWeight: "800", letterSpacing: -0.2 },
  sectionSubtitle: { fontSize: 11, fontWeight: "500", marginTop: 1 },
  seeAllBtn: { flexDirection: "row", alignItems: "center", gap: 2 },
  seeAllText: { fontSize: 12, fontWeight: "700" },
  badgeCount: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, borderWidth: 1 },
  badgeCountText: { fontSize: 11, fontWeight: "700" },

  horizontalActionsContainer: {
    paddingHorizontal: 16,
    gap: 10,
    paddingVertical: 4,
  },
  actionScrollCard: {
    width: 82,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  actionIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  actionScrollText: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },

  unionCard: {
    width: 220,
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  unionCardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  unionCardName: { fontSize: 13, fontWeight: "800", flex: 1, marginRight: 6 },
  unionClientBadgePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  unionClientBadge: { fontSize: 9.5, fontWeight: "700" },
  unionAmountRow: { flexDirection: "row", justifyContent: "space-between" },
  unionLabel: { fontSize: 9, fontWeight: "600" },
  unionValue: { fontSize: 12, fontWeight: "800", marginTop: 2 },
  unionMicroBar: {
    height: 3,
    backgroundColor: "rgba(239, 68, 68, 0.4)",
    borderRadius: 2,
    marginTop: 8,
    overflow: "hidden",
  },
  unionMicroSavings: {
    height: "100%",
    backgroundColor: "#10B981",
  },
  emptyBox: {
    marginHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    padding: 20,
    alignItems: "center",
    gap: 6,
  },
  emptyBoxText: { fontSize: 12, fontWeight: "500" },

  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
  },
  searchInput: { flex: 1, fontSize: 13, height: "100%" },
  filterBarContainer: { paddingHorizontal: 16, gap: 8, marginTop: 10, marginBottom: 12 },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  filterChipText: { fontSize: 11, fontWeight: "700" },

  activityItemCard: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
  },
  activityIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  activityClient: { fontSize: 13, fontWeight: "700" },
  activityMetaRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  dotSeparator: { fontSize: 10 },
  activityTypeBadge: { fontSize: 10, fontWeight: "700" },
  activityDate: { fontSize: 10, fontWeight: "500" },
  activityAmount: { fontSize: 13.5, fontWeight: "800" },

  emptyActivityCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 6,
  },
  emptyIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  emptyActivityTitle: { fontSize: 14, fontWeight: "700" },
  emptyActivitySub: { fontSize: 11.5, textAlign: "center" },

  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    backgroundColor: "rgba(254, 242, 242, 0.85)",
    borderColor: "#FCA5A5",
  },
  errorBoxText: { flex: 1, color: "#EF4444", fontSize: 11, fontWeight: "600" },
  errorRetry: { backgroundColor: "#EF4444", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  errorRetryText: { color: "#FFF", fontSize: 10, fontWeight: "700" },

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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.72)",
    justifyContent: "flex-end",
  },
  modalCard: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 32,
    alignItems: "center",
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    marginBottom: 16,
    alignSelf: "center",
  },
  modalIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  modalClient: { fontSize: 17, fontWeight: "800", textAlign: "center" },
  modalAmount: { fontSize: 26, fontWeight: "900", marginVertical: 4 },
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
  statusSuccessText: {
    color: "#10B981",
    fontSize: 11,
    fontWeight: "700",
  },
  modalDetailsGroup: {
    width: "100%",
    backgroundColor: "rgba(148, 163, 184, 0.08)",
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
    marginTop: 6,
  },
  modalSecondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 15,
    borderWidth: 1,
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: "700",
  },
  modalPrimaryBtn: {
    flex: 1.25,
    paddingVertical: 14,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseText: { color: "#FFF", fontSize: 13.5, fontWeight: "800" },

  /* ================= UPGRADED VERSION UPDATE MODAL ================= */
  updateModalCard: {
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
    alignItems: "center",
  },
  updateBadgeType: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 12,
  },
  updateBadgeTypeText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  updateHeaderTitle: {
    fontSize: 19,
    fontWeight: "900",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  versionComparisonBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-evenly",
    width: "100%",
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
    marginVertical: 12,
  },
  versionCol: {
    alignItems: "center",
    gap: 2,
  },
  versionColLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  versionColVal: {
    fontSize: 14,
    fontWeight: "700",
  },
  versionArrowCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(99, 102, 241, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  versionDescription: {
    fontSize: 12,
    textAlign: "center",
    lineHeight: 18,
    paddingHorizontal: 8,
    marginBottom: 12,
    fontWeight: "500",
  },
  changelogCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  changelogTitle: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 6,
  },
  bulletText: {
    fontSize: 11.5,
    fontWeight: "600",
    flex: 1,
    lineHeight: 16,
  },
  sourcePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginBottom: 14,
  },
  sourcePillText: {
    fontSize: 10.5,
    fontWeight: "600",
  },
});