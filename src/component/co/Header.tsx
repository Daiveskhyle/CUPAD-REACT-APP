import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useTheme } from "../../theme/ThemeContext";
import HeaderSyncButton from "./HeaderSyncButton";
import LogoutConfirmModal from "./LogoutConfirmModal";

const API_BASE = "https://cupadapp.name.ng";

function getProfilePicUrl(
  pic?: string,
  picUrl?: string,
): string | null {
  if (picUrl) return picUrl;

  if (!pic || pic.includes("default_avatar")) {
    return null;
  }

  if (pic.startsWith("http")) {
    return pic;
  }

  const clean = pic.replace(/^\/+/, "");

  return `${API_BASE}/${clean}`;
}

type HeaderProps = {
  unreadCount?: number;
  onNotificationPress?: () => void;
  title?: string;
  subtitle?: string;
  showBack?: boolean;
};

export default function CoHeader({
  unreadCount = 0,
  onNotificationPress,
  title,
  subtitle,
  showBack = false,
}: HeaderProps) {
  const {
    colors,
    isDark,
    toggleTheme,
  } = useTheme();

  const insets = useSafeAreaInsets();

  const [user, setUser] = useState<any>(null);
  const [imgError, setImgError] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  /* --------------------------------------------------
   * LOAD USER
   * -------------------------------------------------- */
  useEffect(() => {
    let mounted = true;

    const loadUser = async () => {
      try {
        const stored = await AsyncStorage.getItem("cupad_user");

        if (stored) {
          const parsed = JSON.parse(stored);
          if (mounted) setUser(parsed);
          return;
        }

        const biometric = await AsyncStorage.getItem("cupad_biometric_user");
        if (biometric) {
          const parsed = JSON.parse(biometric);
          if (mounted) setUser(parsed);
        }
      } catch {
        if (mounted) setUser(null);
      }
    };

    loadUser();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    setImgError(false);
  }, [user?.profile_pic, user?.profile_pic_url]);

  /* --------------------------------------------------
   * PROFILE IMAGE & INITIAL
   * -------------------------------------------------- */
  const profilePicUrl = useMemo(
    () => getProfilePicUrl(user?.profile_pic, user?.profile_pic_url),
    [user],
  );

  const showProfileImage = Boolean(profilePicUrl) && !imgError;

  const avatarInitial = useMemo(() => {
    const name = user?.full_name || user?.username || "C";
    return String(name).trim().charAt(0).toUpperCase();
  }, [user]);

  /* --------------------------------------------------
   * LOGOUT TRIGGER (OPENS CUSTOM MODAL)
   * -------------------------------------------------- */
  const handleOpenLogout = () => {
    setShowLogoutModal(true);
  };

  const handleConfirmLogout = () => {
    setShowLogoutModal(false);
    // Directly navigate to /logout where the secure cleanup happens
    router.replace("/logout" as any);
  };

  /* --------------------------------------------------
   * PRESS FEEDBACK
   * -------------------------------------------------- */
  const pressScale = ({ pressed }: { pressed: boolean }) => ({
    transform: [{ scale: pressed ? 0.94 : 1 }],
    opacity: pressed ? 0.82 : 1,
  });

  const headerTitle = title || (showBack ? "CUPAD" : "");
  const translucentBtnBorder = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
  const headerIconColor = isDark ? colors.text : colors.primary;

  return (
    <>
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 6,
          },
        ]}
      >
        {/* -----------------------------------------
            LEFT SIDE
        ----------------------------------------- */}
        <View style={styles.left}>
          {showBack ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              onPress={() => router.back()}
              style={({ pressed }) => [
                styles.iconBtn,
                { borderColor: translucentBtnBorder },
                pressScale({ pressed }),
              ]}
            >
              <Ionicons name="arrow-back" size={20} color={headerIconColor} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open dashboard"
              onPress={() => router.push("/co/dashboard" as any)}
              style={({ pressed }) => [styles.brandButton, pressScale({ pressed })]}
            >
              <View style={[styles.logoContainer, { borderColor: translucentBtnBorder }]}>
                <Image
                  source={require("../../../assets/cupad logo.png")}
                  style={styles.logoImg}
                  resizeMode="contain"
                />
              </View>

              <View style={styles.brandTextWrap}>
                <Text style={[styles.logoText, { color: colors.text }]}>CUPAD</Text>
                <Text style={[styles.brandSubtitle, { color: colors.textMuted }]}>
                  Empowerment Initiative
                </Text>
              </View>
            </Pressable>
          )}

          {showBack && (
            <View style={styles.titleWrap}>
              <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                {headerTitle}
              </Text>

              {subtitle ? (
                <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          )}
        </View>

        {/* -----------------------------------------
            RIGHT SIDE
        ----------------------------------------- */}
        <View style={styles.right}>
          {/* OFFLINE SYNC */}
          <HeaderSyncButton color={headerIconColor} />

          {/* THEME TOGGLE */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
            hitSlop={5}
            onPress={toggleTheme}
            style={({ pressed }) => [
              styles.iconBtn,
              { borderColor: translucentBtnBorder },
              pressScale({ pressed }),
            ]}
          >
            <Ionicons
              name={isDark ? "sunny-outline" : "moon-outline"}
              size={18}
              color={headerIconColor}
            />
          </Pressable>

          {/* NOTIFICATIONS */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"
            }
            hitSlop={5}
            onPress={() => {
              if (onNotificationPress) onNotificationPress();
            }}
            style={({ pressed }) => [
              styles.iconBtn,
              { borderColor: translucentBtnBorder },
              pressScale({ pressed }),
            ]}
          >
            <Ionicons name="notifications-outline" size={19} color={headerIconColor} />

            {unreadCount > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{unreadCount > 9 ? "9+" : unreadCount}</Text>
              </View>
            )}
          </Pressable>

          {/* LOGOUT BUTTON -> OPENS POPUP */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Logout"
            hitSlop={5}
            onPress={handleOpenLogout}
            style={({ pressed }) => [
              styles.logoutBtn,
              { borderColor: "rgba(255,77,79,0.28)" },
              pressScale({ pressed }),
            ]}
          >
            <Ionicons name="log-out-outline" size={17} color="#FF4D4F" />
          </Pressable>

          {/* PROFILE */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            hitSlop={5}
            onPress={() => router.push("/co/profile" as any)}
            style={({ pressed }) => [
              styles.avatarOuter,
              { borderColor: translucentBtnBorder },
              pressScale({ pressed }),
            ]}
          >
            {showProfileImage ? (
              <Image
                source={{ uri: profilePicUrl! }}
                style={styles.avatarImage}
                resizeMode="cover"
                onError={() => setImgError(true)}
              />
            ) : (
              <View
                style={[
                  styles.avatar,
                  { borderColor: colors.primary, borderWidth: 1 },
                ]}
              >
                <Text style={[styles.avatarText, { color: colors.primary }]}>
                  {avatarInitial}
                </Text>
              </View>
            )}

            <View
              style={[
                styles.onlineIndicator,
                {
                  borderColor: isDark ? "rgba(15,23,42,0.9)" : "rgba(255,255,255,0.9)",
                },
              ]}
            />
          </Pressable>
        </View>
      </View>

      {/* ================= LOGOUT CONFIRMATION POPUP MODAL ================= */}
      <LogoutConfirmModal
        visible={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleConfirmLogout}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    width: "100%",
    minHeight: 58,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 15,
    paddingBottom: 9,
    zIndex: 50,
  },
  left: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  logoContainer: {
    width: 37,
    height: 37,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  logoImg: {
    width: 31,
    height: 31,
  },
  brandTextWrap: {
    justifyContent: "center",
  },
  logoText: {
    fontSize: 15,
    fontWeight: "900",
    letterSpacing: 0.7,
    lineHeight: 17,
  },
  brandSubtitle: {
    fontSize: 8,
    fontWeight: "600",
    marginTop: 1,
    letterSpacing: 0.15,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 9,
    fontWeight: "500",
    marginTop: 2,
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginLeft: 8,
  },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  logoutBtn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    paddingHorizontal: 3,
    backgroundColor: "#FF4D4F",
    borderWidth: 1.5,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "900",
    lineHeight: 10,
  },
  avatarOuter: {
    width: 39,
    height: 39,
    borderRadius: 20,
    borderWidth: 1,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 33,
    height: 33,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarImage: {
    width: 33,
    height: 33,
    borderRadius: 17,
  },
  avatarText: {
    fontSize: 13,
    fontWeight: "900",
  },
  onlineIndicator: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#22C55E",
    borderWidth: 2,
  },
});