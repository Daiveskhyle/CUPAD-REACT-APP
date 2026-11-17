/**
 * Compact sync control matching CoHeader icon button style.
 */
import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { getAllPendingCounts, isOnline } from "../../db/database";
import { requestSyncNow, onAutoSyncEvent } from "../../db/autoSync";

type Props = {
  onSynced?: (n: number) => void;
  /** Matches header icon color */
  color?: string;
  size?: number;
};

export default function HeaderSyncButton({
  onSynced,
  color = "#64748B",
  size = 18,
}: Props) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [on, counts] = await Promise.all([
        isOnline().catch(() => true),
        getAllPendingCounts().catch(() => ({ total: 0 })),
      ]);
      setOnline(!!on);
      setPending(Number(counts?.total) || 0);
    } catch {
      setOnline(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 20000);
    const unsub = onAutoSyncEvent((info) => {
      setOnline(info.online);
      setPending(info.pending);
      if (info.synced > 0) onSynced?.(info.synced);
    });
    return () => {
      clearInterval(t);
      unsub();
    };
  }, [refresh, onSynced]);

  const handlePress = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const res = await requestSyncNow({ force: true, hydrate: true });
      setOnline(res.online);
      setPending(res.pending);
      if (res.synced > 0) {
        onSynced?.(res.synced);
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      }
    } finally {
      setSyncing(false);
    }
  };

  const iconColor = !online ? "#EF4444" : pending > 0 ? "#F59E0B" : color;
  const iconName = !online
    ? "cloud-offline-outline"
    : pending > 0
      ? "cloud-upload-outline"
      : "cloud-done-outline";

  const borderColor =
    !online
      ? "rgba(239,68,68,0.28)"
      : pending > 0
        ? "rgba(245,158,11,0.28)"
        : "rgba(0,0,0,0.05)";

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={5}
      accessibilityRole="button"
      accessibilityLabel={
        !online
          ? "Offline – tap to retry sync"
          : pending > 0
            ? `${pending} pending – tap to sync`
            : "Synced – tap to refresh"
      }
      style={({ pressed }) => [
        styles.iconBtn,
        {
          borderColor,
          transform: [{ scale: pressed ? 0.94 : 1 }],
          opacity: pressed ? 0.82 : 1,
        },
      ]}
    >
      {syncing ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <View>
          <Ionicons name={iconName as any} size={size} color={iconColor} />
          {pending > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>
                {pending > 9 ? "9+" : String(pending)}
              </Text>
            </View>
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Match CoHeader iconBtn (38×38, radius 12, border)
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  badgeText: {
    color: "#FFF",
    fontSize: 9,
    fontWeight: "800",
  },
});
