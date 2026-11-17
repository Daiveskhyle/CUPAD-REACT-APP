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
  Linking,
  Alert,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  cacheUnions,
  loadCachedUnions,
} from "../../src/db/database";
import { useTheme } from "../../src/theme/ThemeContext";
import CoScreenWrapper from "../../src/component/co/CoScreenWrapper";
import { router } from "expo-router";
import axios from "axios";

const { width } = Dimensions.get("window");
const API_BASE = "https://cupadapp.name.ng";
const API_UNIONS = `${API_BASE}/api/union_api.php`;

// STORAGE CACHE KEYS
const CACHE_KEY_UNIONS = "cupad_cache_unions_full";
const CACHE_KEY_OFFLINE_QUEUE = "cupad_offline_unions_queue";

type Client = {
  id: string | number;
  name: string;
  phone?: string;
  branch_id?: string | number;
  branch_name?: string;
};

type UnionGroup = {
  uuid: string;
  name: string;
  description: string;
  branch?: string;
  client_count: number;
  clients: Client[];
  isPendingSync?: boolean;
};

type UnionStats = {
  total_groups: number;
  total_clients: number;
  avg_size: number;
};

type OfflineQueueItem = {
  uuid: string;
  name: string;
  description: string;
  branch: string;
  timestamp: number;
};

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

function Skeleton({ style }: { style?: any }) {
  const opacity = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.7, duration: 850, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.3, duration: 850, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return <Animated.View style={[{ backgroundColor: "rgba(148, 163, 184, 0.25)", opacity, borderRadius: 14 }, style]} />;
}

export default function UnionsScreen() {
  const { colors, isDark } = useTheme();

  // Glassmorphic System Colors
  const cardSurfaceBg = isDark ? "rgba(30, 41, 59, 0.65)" : "rgba(255, 255, 255, 0.88)";
  const glassBorder = isDark ? "rgba(255, 255, 255, 0.08)" : "rgba(226, 232, 240, 0.85)";
  const orbColor1 = isDark ? "rgba(37, 99, 235, 0.16)" : "rgba(37, 99, 235, 0.09)";
  const orbColor2 = isDark ? "rgba(14, 165, 233, 0.13)" : "rgba(14, 165, 233, 0.07)";

  const [unions, setUnions] = useState<UnionGroup[]>([]);
  const [stats, setStats] = useState<UnionStats>({ total_groups: 0, total_clients: 0, avg_size: 0 });
  const [selectedUnionIndex, setSelectedUnionIndex] = useState(0);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [officerInfo, setOfficerInfo] = useState({ username: "", branch: "" });

  // Offline Sync State
  const [pendingQueue, setPendingQueue] = useState<OfflineQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  // Modal State
  const [modalVisible, setModalVisible] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [translating, setTranslating] = useState(false);

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

  const fadeAnim = useRef(new Animated.Value(0)).current;

  const loadOfflineQueue = useCallback(async (): Promise<OfflineQueueItem[]> => {
    try {
      const q = await AsyncStorage.getItem(CACHE_KEY_OFFLINE_QUEUE);
      const items: OfflineQueueItem[] = q ? JSON.parse(q) : [];
      setPendingQueue(items);
      return items;
    } catch {
      return [];
    }
  }, []);

  const saveOfflineQueue = async (queue: OfflineQueueItem[]) => {
    setPendingQueue(queue);
    await AsyncStorage.setItem(CACHE_KEY_OFFLINE_QUEUE, JSON.stringify(queue));
  };

  const initUserFromStorage = useCallback(async () => {
    try {
      const stored = await AsyncStorage.getItem("cupad_user");
      if (stored) {
        const u = JSON.parse(stored);
        const resolvedBranch = u.branch_name || u.branch || "";
        if (u.username) {
          setOfficerInfo({ username: u.username, branch: resolvedBranch });
        }
      }
    } catch {}
  }, []);

  const loadCache = useCallback(async () => {
    try {
      const [cached, queue] = await Promise.all([
        AsyncStorage.getItem(CACHE_KEY_UNIONS),
        loadOfflineQueue(),
      ]);

      let cachedUnions: UnionGroup[] = [];
      let cachedStats: UnionStats = { total_groups: 0, total_clients: 0, avg_size: 0 };

      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.unions && Array.isArray(parsed.unions)) cachedUnions = parsed.unions;
        if (parsed.stats) cachedStats = parsed.stats;
        if (parsed.branch) {
          setOfficerInfo((prev) => ({
            username: parsed.officer || prev.username,
            branch: prev.branch || parsed.branch,
          }));
        }
      }

      if (queue.length > 0) {
        const pendingUnions: UnionGroup[] = queue.map((q) => ({
          uuid: q.uuid,
          name: q.name,
          description: q.description,
          branch: q.branch,
          client_count: 0,
          clients: [],
          isPendingSync: true,
        }));

        const existingNames = new Set(cachedUnions.map((u) => u.name.toLowerCase()));
        const uniquePending = pendingUnions.filter((p) => !existingNames.has(p.name.toLowerCase()));

        cachedUnions = [...uniquePending, ...cachedUnions];
        cachedStats.total_groups = cachedUnions.length;
      }

      setUnions(cachedUnions);
      setStats(cachedStats);
      try {
        if (cachedUnions.length > 0) {
          const stored = await AsyncStorage.getItem("cupad_user");
          const username = stored ? JSON.parse(stored).username : "";
          await cacheUnions(cachedUnions, username);
        }
      } catch {}
    } catch {}
  }, [loadOfflineQueue]);

  const processOfflineQueue = useCallback(async () => {
    const queue = await loadOfflineQueue();
    if (queue.length === 0 || isSyncing) return;

    setIsSyncing(true);
    try {
      const stored = await AsyncStorage.getItem("cupad_user");
      let username = officerInfo.username;
      if (stored) {
        username = JSON.parse(stored).username || username;
      }

      const res = await axios.post(
        `${API_UNIONS}?action=sync_unions`,
        {
          username,
          items: queue,
        },
        { timeout: 15000 }
      );

      if (res.data?.success) {
        await saveOfflineQueue([]);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast("Synchronized offline groups with server");
      }
    } catch (e) {
      console.log("Offline sync failed, will retry next time:", e);
    } finally {
      setIsSyncing(false);
    }
  }, [officerInfo.username, isSyncing, loadOfflineQueue]);

  const fetchUnions = useCallback(
    async (showLoading = true) => {
      try {
        if (showLoading) setLoading(true);

        let username = "";
        let localBranch = "";
        const stored = await AsyncStorage.getItem("cupad_user");
        if (stored) {
          const parsed = JSON.parse(stored);
          username = parsed.username;
          localBranch = parsed.branch_name || parsed.branch || "";
        } else {
          const bio = await AsyncStorage.getItem("cupad_biometric_user");
          if (bio) {
            const parsed = JSON.parse(bio);
            username = parsed.username;
            localBranch = parsed.branch_name || parsed.branch || "";
          }
        }

        if (!username) {
          setLoading(false);
          return;
        }

        await processOfflineQueue();

        const res = await axios.get(
          `${API_UNIONS}?action=get_unions&username=${encodeURIComponent(username)}`,
          { timeout: 12000 }
        );

        if (res.data?.success) {
          let serverUnions: UnionGroup[] = res.data.unions || [];
          const serverStats: UnionStats = res.data.stats || { total_groups: 0, total_clients: 0, avg_size: 0 };
          const finalBranch = localBranch || res.data.branch || "Branch";

          const currentQueue = await loadOfflineQueue();
          if (currentQueue.length > 0) {
            const pendingUnions: UnionGroup[] = currentQueue.map((q) => ({
              uuid: q.uuid,
              name: q.name,
              description: q.description,
              branch: q.branch,
              client_count: 0,
              clients: [],
              isPendingSync: true,
            }));
            const serverNames = new Set(serverUnions.map((u) => u.name.toLowerCase()));
            const remainingPending = pendingUnions.filter((p) => !serverNames.has(p.name.toLowerCase()));
            serverUnions = [...remainingPending, ...serverUnions];
            serverStats.total_groups = serverUnions.length;
          }

          setUnions(serverUnions);
          setStats(serverStats);
          setOfficerInfo({
            username: res.data.officer || username,
            branch: finalBranch,
          });
          setIsOffline(false);

          await AsyncStorage.setItem(CACHE_KEY_UNIONS, JSON.stringify(res.data));
          try {
            await cacheUnions(serverUnions, username);
          } catch {}
        } else {
          setIsOffline(true);
        }
      } catch {
        setIsOffline(true);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [processOfflineQueue, loadOfflineQueue]
  );

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 380, useNativeDriver: true }).start();
    initUserFromStorage().then(() => {
      loadCache().then(() => fetchUnions(true));
    });
  }, [initUserFromStorage, loadCache, fetchUnions, fadeAnim]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fetchUnions(false);
  }, [fetchUnions]);

  const makeCall = (phone?: string) => {
    if (!phone || phone === "N/A" || !phone.trim()) {
      Alert.alert("No Phone Number", "This client has no telephone number on record.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Linking.openURL(`tel:${phone.replace(/\s+/g, "")}`);
  };

  const openWhatsApp = (phone?: string) => {
    if (!phone || phone === "N/A" || !phone.trim()) {
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

  const handleTranslate = async () => {
    if (!newName.trim()) {
      Alert.alert("Note", "Please type a Group Name first.");
      return;
    }
    setTranslating(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const prompt = `Translate the following Yoruba name or phrase into English. Only return the translated text without extra explanation: "${newName.trim()}"`;
      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaSyC7KpTuaEFPMsSr6gBcdplhZjTwfHjsGUE`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { headers: { "Content-Type": "application/json" }, timeout: 8000 }
      );

      const translated = res.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      if (translated) {
        setNewDesc(translated);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        showToast("Translated Yoruba name with AI");
      }
    } catch {
      Alert.alert("Notice", "Unable to auto-translate right now. You can input description manually.");
    } finally {
      setTranslating(false);
    }
  };

  const handleCreateUnion = async () => {
    if (!newName.trim()) {
      Alert.alert("Required", "Please provide a name for this group.");
      return;
    }

    setCreating(true);
    const stored = await AsyncStorage.getItem("cupad_user");
    let username = officerInfo.username;
    let branch = officerInfo.branch;

    if (stored) {
      const u = JSON.parse(stored);
      username = u.username || username;
      branch = u.branch_name || u.branch || branch;
    }

    const tempUuid = "offline-" + Date.now();
    const newGroupPayload = {
      uuid: tempUuid,
      name: newName.trim(),
      description: newDesc.trim(),
      branch: branch || "Main Branch",
      timestamp: Date.now(),
    };

    try {
      const res = await axios.post(
        `${API_UNIONS}?action=create_union`,
        {
          username,
          name: newGroupPayload.name,
          description: newGroupPayload.description,
          branch: newGroupPayload.branch,
          uuid: newGroupPayload.uuid,
        },
        { timeout: 8000 }
      );

      if (res.data?.success) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setModalVisible(false);
        setNewName("");
        setNewDesc("");
        showToast(`Created union "${newGroupPayload.name}"`);
        fetchUnions(false);
        return;
      }
      throw new Error(res.data?.message || "Server rejected union creation");
    } catch {
      const existingQueue = await loadOfflineQueue();
      const updatedQueue = [newGroupPayload, ...existingQueue];
      await saveOfflineQueue(updatedQueue);

      const optimisticUnion: UnionGroup = {
        uuid: tempUuid,
        name: newGroupPayload.name,
        description: newGroupPayload.description,
        branch: newGroupPayload.branch,
        client_count: 0,
        clients: [],
        isPendingSync: true,
      };

      setUnions((prev) => [optimisticUnion, ...prev]);
      setStats((prev) => ({ ...prev, total_groups: prev.total_groups + 1 }));
      setIsOffline(true);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setModalVisible(false);
      setNewName("");
      setNewDesc("");

      Alert.alert(
        "Saved Offline",
        `"${newGroupPayload.name}" was saved locally. It will automatically sync as soon as network returns.`
      );
    } finally {
      setCreating(false);
    }
  };

  const selectedUnion = unions[selectedUnionIndex] || null;

  const filteredClients = useMemo(() => {
    if (!selectedUnion) return [];
    if (!search.trim()) return selectedUnion.clients;
    const q = search.toLowerCase();
    return selectedUnion.clients.filter(
      (c) => c.name.toLowerCase().includes(q) || (c.phone && c.phone.includes(q))
    );
  }, [selectedUnion, search]);

  const capacityRatio = Math.min(100, Math.round((stats.avg_size / 30) * 100));

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

      <View style={styles.container}>
        {/* ================= EXECUTIVE HEADER ================= */}
        <View style={styles.header}>
          <View style={styles.headerTextGroup}>
            <Text style={[styles.headerPreTitle, { color: colors.primary }]}>FIELD OPERATIONS</Text>
            <Text style={[styles.headerTitle, { color: colors.text }]}>Union Groups</Text>
          </View>

          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setModalVisible(true);
            }}
            style={({ pressed }) => [
              styles.createBtn,
              { backgroundColor: colors.primary, transform: [{ scale: pressed ? 0.96 : 1 }] },
            ]}
          >
            <Ionicons name="add" size={17} color="#fff" />
            <Text style={styles.createBtnText}>New Group</Text>
          </Pressable>
        </View>

        {/* PENDING SYNC BANNER */}
        {pendingQueue.length > 0 && (
          <Pressable
            onPress={processOfflineQueue}
            disabled={isSyncing}
            style={({ pressed }) => [
              styles.syncBanner,
              {
                backgroundColor: "rgba(245, 158, 11, 0.15)",
                borderColor: "#F59E0B",
                transform: [{ scale: pressed ? 0.98 : 1 }],
              },
            ]}
          >
            <View style={styles.syncBannerLeft}>
              <View style={[styles.syncIconWrap, { backgroundColor: "#F59E0B" }]}>
                <Ionicons name="cloud-upload-outline" size={14} color="#0F172A" />
              </View>
              <Text style={[styles.syncBannerText, { color: isDark ? "#FDE68A" : "#92400E" }]}>
                {pendingQueue.length} offline group{pendingQueue.length > 1 ? "s" : ""} awaiting server sync
              </Text>
            </View>
            {isSyncing ? (
              <ActivityIndicator size="small" color="#D97706" />
            ) : (
              <View style={[styles.syncActionBtn, { backgroundColor: "#D97706" }]}>
                <Text style={styles.syncActionBtnText}>Sync Now</Text>
              </View>
            )}
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
          {/* ================= HERO PORTFOLIO CARD (MATCHING DASHBOARD) ================= */}
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
            <View style={styles.heroTopRow}>
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
                  {isOffline ? "OFFLINE CACHE" : "LIVE UNION DIRECTORY"}
                </Text>
              </View>

              <View
                style={[
                  styles.syncTimePill,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.06)" : "rgba(0, 0, 0, 0.04)" },
                ]}
              >
                <Ionicons name="location-outline" size={12} color={colors.textMuted} />
                <Text style={[styles.syncTimeText, { color: colors.textMuted }]}>
                  {officerInfo.branch || "Branch Territory"}
                </Text>
              </View>
            </View>

            {/* Total Managed Members */}
            <View style={styles.heroMainBalanceSection}>
              <Text style={[styles.heroBalanceLabel, { color: colors.textMuted }]}>
                TOTAL REGISTERED SAVERS
              </Text>
              <View style={styles.heroAmountRow}>
                <Text style={[styles.heroMainAmount, { color: colors.text }]}>
                  {stats.total_clients.toLocaleString()}
                </Text>
                <View style={[styles.memberBadge, { backgroundColor: `${colors.primary}12` }]}>
                  <Text style={[styles.memberBadgeText, { color: colors.primary }]}>Active Members</Text>
                </View>
              </View>
            </View>

            {/* Visual Ratio Health Bar */}
            <View style={styles.portfolioRatioContainer}>
              <View style={styles.ratioHeader}>
                <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                  Average Group Size: {stats.avg_size} members / union
                </Text>
                <Text style={[styles.ratioLabel, { color: colors.textMuted }]}>
                  {capacityRatio}% Optimal
                </Text>
              </View>
              <View style={styles.ratioTrack}>
                <View style={[styles.ratioFillBar, { width: `${capacityRatio}%`, backgroundColor: colors.primary }]} />
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
                  <Ionicons name="layers" size={11} color={colors.primary} />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Portfolios</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: colors.text }]}>
                  {stats.total_groups}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Active groups</Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="people" size={11} color="#10B981" />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Total Savers</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: "#10B981" }]}>
                  {stats.total_clients}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Verified clients</Text>
              </View>

              <View
                style={[
                  styles.metricGridItem,
                  { backgroundColor: isDark ? "rgba(255, 255, 255, 0.04)" : "rgba(241, 245, 249, 0.65)" },
                ]}
              >
                <View style={styles.metricItemHeader}>
                  <Ionicons name="pie-chart" size={11} color="#F59E0B" />
                  <Text style={[styles.metricItemLabel, { color: colors.textMuted }]}>Avg Size</Text>
                </View>
                <Text style={[styles.metricItemValue, { color: "#F59E0B" }]}>
                  {stats.avg_size}
                </Text>
                <Text style={[styles.metricItemSub, { color: colors.textMuted }]}>Per center</Text>
              </View>
            </View>
          </LinearGradient>

          {/* ================= HORIZONTAL UNION PILLS ================= */}
          <View style={styles.tabSection}>
            <View style={styles.sectionHeaderRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="business" size={13} color={colors.primary} />
                <Text style={[styles.sectionTitle, { color: colors.text }]}>Union Branches</Text>
              </View>
              <Text style={[styles.sectionCounter, { color: colors.textMuted }]}>
                {unions.length} Total
              </Text>
            </View>

            {loading && unions.length === 0 ? (
              <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, marginTop: 4 }}>
                <Skeleton style={{ width: 120, height: 38, borderRadius: 14 }} />
                <Skeleton style={{ width: 120, height: 38, borderRadius: 14 }} />
                <Skeleton style={{ width: 120, height: 38, borderRadius: 14 }} />
              </View>
            ) : unions.length === 0 ? (
              <View
                style={[
                  styles.emptyStateCard,
                  { backgroundColor: cardSurfaceBg, borderColor: glassBorder },
                ]}
              >
                <Ionicons name="folder-open-outline" size={30} color={colors.textMuted} />
                <Text style={[styles.emptyStateText, { color: colors.textMuted }]}>
                  No union groups found. Tap "+ New Group" above to start one.
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.horizontalPillsScroll}
              >
                {unions.map((u, i) => {
                  const isActive = selectedUnionIndex === i;
                  return (
                    <Pressable
                      key={u.uuid || i}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setSelectedUnionIndex(i);
                      }}
                      style={({ pressed }) => [
                        styles.unionPill,
                        {
                          backgroundColor: isActive ? colors.primary : cardSurfaceBg,
                          borderColor: u.isPendingSync
                            ? "#EA580C"
                            : isActive
                            ? colors.primary
                            : glassBorder,
                          transform: [{ scale: pressed ? 0.96 : 1 }],
                        },
                      ]}
                    >
                      <Ionicons
                        name={u.isPendingSync ? "cloud-upload" : "business"}
                        size={13}
                        color={isActive ? "#fff" : u.isPendingSync ? "#EA580C" : colors.primary}
                      />

                      <Text
                        style={[
                          styles.unionPillText,
                          { color: isActive ? "#fff" : colors.text },
                        ]}
                      >
                        {u.name}
                      </Text>

                      <View
                        style={[
                          styles.pillBadge,
                          {
                            backgroundColor: isActive
                              ? "rgba(255,255,255,0.24)"
                              : isDark
                              ? "rgba(255,255,255,0.08)"
                              : "#E2E8F0",
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.pillBadgeText,
                            { color: isActive ? "#fff" : colors.textMuted },
                          ]}
                        >
                          {u.client_count}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* ================= SELECTED UNION OVERVIEW & SEARCH ================= */}
          {selectedUnion && (
            <View
              style={[
                styles.overviewCard,
                { backgroundColor: cardSurfaceBg, borderColor: glassBorder },
              ]}
            >
              <View style={styles.overviewHeader}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Text style={[styles.overviewTitle, { color: colors.text }]} numberOfLines={1}>
                      {selectedUnion.name}
                    </Text>
                    {selectedUnion.isPendingSync && (
                      <View style={styles.badgePending}>
                        <Text style={styles.badgePendingText}>Sync Pending</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.overviewDesc, { color: colors.textMuted }]} numberOfLines={2}>
                    {selectedUnion.description || `Registered in ${selectedUnion.branch || officerInfo.branch || "Branch"}`}
                  </Text>
                </View>

                <View style={[styles.memberCountTag, { backgroundColor: `${colors.primary}12` }]}>
                  <Ionicons name="people" size={13} color={colors.primary} />
                  <Text style={[styles.memberCountText, { color: colors.primary }]}>
                    {selectedUnion.client_count}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  styles.searchField,
                  { backgroundColor: colors.background, borderColor: glassBorder },
                ]}
              >
                <Ionicons name="search" size={16} color={colors.textMuted} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={`Search ${selectedUnion.name} members...`}
                  placeholderTextColor={colors.textMuted}
                  style={[styles.searchInput, { color: colors.text }]}
                />
                {search.length > 0 && (
                  <Pressable
                    onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setSearch("");
                    }}
                    hitSlop={6}
                  >
                    <Ionicons name="close-circle" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* ================= CLIENT CARDS IN UNION ================= */}
          <View style={styles.clientSection}>
            {loading && unions.length === 0 ? (
              <View style={{ gap: 10 }}>
                <Skeleton style={{ height: 68, borderRadius: 16 }} />
                <Skeleton style={{ height: 68, borderRadius: 16 }} />
              </View>
            ) : !selectedUnion || filteredClients.length === 0 ? (
              <View
                style={[
                  styles.emptyClientBox,
                  { backgroundColor: cardSurfaceBg, borderColor: glassBorder },
                ]}
              >
                <View style={[styles.emptyIconCircle, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" }]}>
                  <Ionicons name="people-outline" size={28} color={colors.textMuted} />
                </View>
                <Text style={[styles.emptyClientsTitle, { color: colors.text }]}>
                  No Clients in this Union
                </Text>
                <Text style={[styles.emptyClientsSubtitle, { color: colors.textMuted }]}>
                  {selectedUnion?.isPendingSync
                    ? "This union is saved on device. Reconnect to internet to sync and register clients."
                    : "Clients registered under this union group will appear here."}
                </Text>
                <Pressable
                  onPress={() => router.push("/co/add-client" as any)}
                  style={({ pressed }) => [
                    styles.registerNewBtn,
                    { backgroundColor: colors.primary, transform: [{ scale: pressed ? 0.96 : 1 }] },
                  ]}
                >
                  <Ionicons name="person-add" size={14} color="#fff" />
                  <Text style={styles.registerNewBtnText}>Register New Client</Text>
                </Pressable>
              </View>
            ) : (
              filteredClients.map((c) => (
                <View
                  key={c.id}
                  style={[
                    styles.clientCard,
                    { backgroundColor: cardSurfaceBg, borderColor: glassBorder },
                  ]}
                >
                  <View style={[styles.avatarBox, { backgroundColor: `${colors.primary}14` }]}>
                    <Text style={[styles.avatarLetter, { color: colors.primary }]}>
                      {c.name.charAt(0).toUpperCase()}
                    </Text>
                  </View>

                  <View style={{ flex: 1, paddingRight: 6 }}>
                    <Text style={[styles.clientFullName, { color: colors.text }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <View style={styles.metaBadgeRow}>
                      <View
                        style={[
                          styles.branchBadge,
                          { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "#F1F5F9" },
                        ]}
                      >
                        <Ionicons name="business-outline" size={10} color={colors.textMuted} />
                        <Text style={[styles.branchBadgeText, { color: colors.textMuted }]} numberOfLines={1}>
                          {c.branch_name || officerInfo.branch || "Branch"}
                        </Text>
                      </View>
                      {c.phone ? (
                        <Text style={[styles.phoneText, { color: colors.textMuted }]}>• {c.phone}</Text>
                      ) : null}
                    </View>
                  </View>

                  {/* DIRECT CONTACT ACTIONS */}
                  <View style={styles.contactActionsRow}>
                    {c.phone ? (
                      <>
                        <Pressable
                          onPress={() => openWhatsApp(c.phone)}
                          style={({ pressed }) => [
                            styles.waActionBtn,
                            { transform: [{ scale: pressed ? 0.92 : 1 }] },
                          ]}
                        >
                          <Ionicons name="logo-whatsapp" size={15} color="#10B981" />
                        </Pressable>
                        <Pressable
                          onPress={() => makeCall(c.phone)}
                          style={({ pressed }) => [
                            styles.phoneDialBtn,
                            { transform: [{ scale: pressed ? 0.92 : 1 }] },
                          ]}
                        >
                          <Ionicons name="call" size={14} color="#3B82F6" />
                        </Pressable>
                      </>
                    ) : null}
                  </View>
                </View>
              ))
            )}
          </View>
        </Animated.ScrollView>
      </View>

      {/* ================= CREATE UNION BOTTOM SHEET MODAL ================= */}
      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.sheetOverlay}>
          <Pressable style={styles.sheetDismiss} onPress={() => setModalVisible(false)} />
          <View
            style={[
              styles.sheetContainer,
              { backgroundColor: colors.card, borderColor: glassBorder },
            ]}
          >
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <View style={[styles.sheetIconCircle, { backgroundColor: `${colors.primary}15` }]}>
                  <Ionicons name="add-circle" size={20} color={colors.primary} />
                </View>
                <View>
                  <Text style={[styles.sheetTitle, { color: colors.text }]}>New Union Group</Text>
                  <Text style={[styles.sheetSubtitle, { color: colors.textMuted }]}>
                    Organize clients under a collective union
                  </Text>
                </View>
              </View>
              <Pressable
                onPress={() => setModalVisible(false)}
                style={styles.sheetCloseBtn}
              >
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              <Text style={[styles.fieldLabel, { color: colors.textMuted }]}>GROUP NAME *</Text>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="e.g. Oja Titun Traders A"
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.sheetInput,
                  { backgroundColor: colors.background, color: colors.text, borderColor: glassBorder },
                ]}
              />

              <View style={styles.fieldLabelRow}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted, marginBottom: 0 }]}>
                  DESCRIPTION / MEANING
                </Text>
                <Pressable
                  onPress={handleTranslate}
                  disabled={translating}
                  style={({ pressed }) => [
                    styles.aiTranslateBtn,
                    {
                      borderColor: `${colors.primary}35`,
                      backgroundColor: isDark ? "rgba(37,99,235,0.08)" : "rgba(37,99,235,0.05)",
                      opacity: pressed ? 0.75 : 1,
                    },
                  ]}
                >
                  {translating ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={12} color={colors.primary} />
                      <Text style={[styles.aiTranslateText, { color: colors.primary }]}>
                        AI Translate Yoruba
                      </Text>
                    </>
                  )}
                </Pressable>
              </View>

              <TextInput
                value={newDesc}
                onChangeText={setNewDesc}
                placeholder="English meaning or group trade category..."
                placeholderTextColor={colors.textMuted}
                style={[
                  styles.sheetInput,
                  { backgroundColor: colors.background, color: colors.text, borderColor: glassBorder },
                ]}
              />

              {/* BRANCH & OFFICER ALLOCATION */}
              <View
                style={[
                  styles.readOnlyGrid,
                  { backgroundColor: colors.background, borderColor: glassBorder },
                ]}
              >
                <View style={styles.readOnlyCol}>
                  <Text style={[styles.readOnlyLabel, { color: colors.textMuted }]}>BRANCH ALLOCATION</Text>
                  <Text style={[styles.readOnlyVal, { color: colors.primary }]} numberOfLines={1}>
                    {officerInfo.branch || "Assigned Branch"}
                  </Text>
                </View>
                <View style={[styles.readOnlyDivider, { backgroundColor: glassBorder }]} />
                <View style={styles.readOnlyCol}>
                  <Text style={[styles.readOnlyLabel, { color: colors.textMuted }]}>CREDIT OFFICER</Text>
                  <Text style={[styles.readOnlyVal, { color: colors.text }]} numberOfLines={1}>
                    {officerInfo.username || "You"}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={handleCreateUnion}
                disabled={creating}
                style={({ pressed }) => [
                  styles.submitBtn,
                  {
                    backgroundColor: colors.primary,
                    opacity: creating ? 0.6 : 1,
                    transform: [{ scale: pressed ? 0.98 : 1 }],
                  },
                ]}
              >
                {creating ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={styles.submitBtnText}>Confirm & Create</Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </CoScreenWrapper>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  /* EXECUTIVE HEADER */
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
  },
  headerTextGroup: {
    flex: 1,
  },
  headerPreTitle: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  createBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    gap: 5,
  },
  createBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  /* SYNC & OFFLINE ALERTS */
  syncBanner: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  syncBannerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flex: 1,
  },
  syncIconWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  syncBannerText: {
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },
  syncActionBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4.5,
    borderRadius: 8,
  },
  syncActionBtnText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },

  scrollContent: {
    paddingBottom: 60,
    paddingTop: 4,
  },

  /* EXECUTIVE HERO CARD (MATCHING DASHBOARD HERO) */
  heroCard: {
    marginHorizontal: 16,
    marginBottom: 14,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
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
    marginTop: 10,
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
  memberBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  memberBadgeText: {
    fontSize: 10.5,
    fontWeight: "800",
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
  ratioFillBar: {
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
    paddingHorizontal: 10,
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

  /* TAB SECTION */
  tabSection: {
    marginBottom: 12,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 12.5,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  sectionCounter: {
    fontSize: 11,
    fontWeight: "700",
  },
  horizontalPillsScroll: {
    paddingHorizontal: 16,
    gap: 8,
    paddingBottom: 4,
  },
  unionPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 11,
    paddingRight: 8,
    paddingVertical: 7,
    borderRadius: 14,
    borderWidth: 1,
  },
  unionPillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  pillBadge: {
    paddingHorizontal: 6.5,
    paddingVertical: 2,
    borderRadius: 8,
    minWidth: 18,
    alignItems: "center",
  },
  pillBadgeText: {
    fontSize: 10,
    fontWeight: "800",
  },
  emptyStateCard: {
    marginHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 8,
  },
  emptyStateText: {
    fontSize: 12,
    fontWeight: "600",
    textAlign: "center",
  },

  /* OVERVIEW CARD */
  overviewCard: {
    marginHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    padding: 14,
    marginBottom: 12,
  },
  overviewHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  overviewTitle: {
    fontSize: 15,
    fontWeight: "800",
  },
  badgePending: {
    backgroundColor: "rgba(234, 88, 12, 0.12)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "rgba(234, 88, 12, 0.3)",
  },
  badgePendingText: {
    fontSize: 9,
    fontWeight: "800",
    color: "#EA580C",
  },
  overviewDesc: {
    fontSize: 11.5,
    fontWeight: "500",
    marginTop: 2,
    lineHeight: 16,
  },
  memberCountTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
  },
  memberCountText: {
    fontSize: 11,
    fontWeight: "800",
  },
  searchField: {
    flexDirection: "row",
    alignItems: "center",
    height: 42,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
  },

  /* CLIENT SECTION */
  clientSection: {
    paddingHorizontal: 16,
    gap: 8,
  },
  clientCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
  },
  avatarBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: {
    fontSize: 15,
    fontWeight: "800",
  },
  clientFullName: {
    fontSize: 13.5,
    fontWeight: "700",
  },
  metaBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 3,
  },
  branchBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  branchBadgeText: {
    fontSize: 9.5,
    fontWeight: "600",
  },
  phoneText: {
    fontSize: 10.5,
    fontWeight: "500",
  },
  contactActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  waActionBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(16, 185, 129, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  phoneDialBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(59, 130, 246, 0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  emptyClientBox: {
    borderRadius: 18,
    borderWidth: 1,
    borderStyle: "dashed",
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
  emptyClientsTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  emptyClientsSubtitle: {
    fontSize: 11.5,
    textAlign: "center",
    lineHeight: 16,
  },
  registerNewBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    marginTop: 6,
  },
  registerNewBtnText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },

  /* BOTTOM SHEET MODAL */
  sheetOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheetDismiss: {
    flex: 1,
  },
  sheetContainer: {
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderTopWidth: 1,
    padding: 20,
    maxHeight: "88%",
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#CBD5E1",
    alignSelf: "center",
    marginBottom: 14,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sheetIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  sheetSubtitle: {
    fontSize: 11.5,
    fontWeight: "500",
    marginTop: 1,
  },
  sheetCloseBtn: {
    padding: 4,
  },
  fieldLabel: {
    fontSize: 9.5,
    fontWeight: "800",
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 14,
    marginBottom: 6,
  },
  aiTranslateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3.5,
    borderRadius: 8,
    borderWidth: 1,
  },
  aiTranslateText: {
    fontSize: 10.5,
    fontWeight: "700",
  },
  sheetInput: {
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 13.5,
  },
  readOnlyGrid: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    marginTop: 16,
  },
  readOnlyCol: {
    flex: 1,
  },
  readOnlyLabel: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  readOnlyVal: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  readOnlyDivider: {
    width: 1,
    marginHorizontal: 12,
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    height: 48,
    borderRadius: 14,
    marginTop: 20,
  },
  submitBtnText: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "800",
  },

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