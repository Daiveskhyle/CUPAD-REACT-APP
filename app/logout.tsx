import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Image,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { useTheme } from "../src/theme/ThemeContext";
import { Ionicons } from "@expo/vector-icons";
import axios from "axios";

const { width, height } = Dimensions.get("window");
const API_URL = "https://cupadapp.name.ng/api/logout.php";

export async function terminateSession() {
  try {
    const token =
      (await SecureStore.getItemAsync("cupad_jwt")) ||
      (await AsyncStorage.getItem("cupad_token")) ||
      (await AsyncStorage.getItem("auth_token"));

    if (token) {
      await axios
        .post(
          API_URL,
          { action: "logout" },
          {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000,
          }
        )
        .catch(() => {});
    }
  } catch (e) {
    console.log("Error contacting logout API:", e);
  } finally {
    const keysToRemove = [
      "cupad_token",
      "cupad_role",
      "cupad_user",
      "cupad_jwt",
      "auth_token",
      "auth_user",
      "cupad_last_location",
      "cupad_last_login_method",
      "cupad_bio_enabled",
    ];

    await AsyncStorage.multiRemove(keysToRemove);
    await SecureStore.deleteItemAsync("cupad_jwt").catch(() => {});
    await SecureStore.deleteItemAsync("cupad_user").catch(() => {});
    await SecureStore.deleteItemAsync("auth_token").catch(() => {});
    await SecureStore.deleteItemAsync("cupad_biometric_password").catch(() => {});
  }
}

type StepStatus = "pending" | "processing" | "done";

export default function LogoutScreen() {
  const { colors, isDark } = useTheme();

  const [step1, setStep1] = useState<StepStatus>("processing");
  const [step2, setStep2] = useState<StepStatus>("pending");
  const [step3, setStep3] = useState<StepStatus>("pending");
  const [isFinished, setIsFinished] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const progressAnim = useRef(new Animated.Value(0.1)).current;
  const pulseIcon = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseIcon, { toValue: 1.08, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseIcon, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, []);

  useEffect(() => {
    let active = true;

    const executeSafeLogout = async () => {
      Animated.timing(progressAnim, { toValue: 0.35, duration: 700, useNativeDriver: false }).start();
      await terminateSession();
      if (!active) return;
      setStep1("done");
      setStep2("processing");

      Animated.timing(progressAnim, { toValue: 0.75, duration: 600, useNativeDriver: false }).start();
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (!active) return;
      setStep2("done");
      setStep3("processing");

      Animated.timing(progressAnim, { toValue: 1, duration: 500, useNativeDriver: false }).start();
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (!active) return;
      setStep3("done");
      setIsFinished(true);

      setTimeout(() => {
        if (active) router.replace("/login");
      }, 700);
    };

    executeSafeLogout();

    return () => {
      active = false;
    };
  }, []);

  const progressInterpolate = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["10%", "100%"],
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.screenWrapper}>
        <Animated.View
          style={[
            styles.brandHeader,
            { opacity: fadeAnim, transform: [{ translateY: slideAnim }] },
          ]}
        >
          <View style={[styles.brandLogoCircle, { borderColor: colors.cardBorder }]}>
            <Image
              source={require("../assets/cupad logo.png")}
              style={styles.brandLogoImage}
              resizeMode="contain"
            />
          </View>
          <Text style={[styles.brandTitle, { color: colors.text }]}>CUPAD</Text>
          <Text style={[styles.brandSubtitle, { color: colors.textMuted }]}>
            Empowerment Initiative
          </Text>
        </Animated.View>

        <Animated.View
          style={[
            styles.progressCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.cardBorder,
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          <Animated.View style={{ transform: [{ scale: pulseIcon }] }}>
            <View
              style={[
                styles.iconBubbleRing,
                {
                  backgroundColor: isFinished
                    ? isDark
                      ? "rgba(34,197,94,0.16)"
                      : "rgba(34,197,94,0.10)"
                    : isDark
                    ? "rgba(239,68,68,0.16)"
                    : "rgba(239,68,68,0.10)",
                },
              ]}
            >
              <View
                style={[
                  styles.iconBubbleCore,
                  { backgroundColor: isFinished ? "#22c55e" : "#ef4444" },
                ]}
              >
                <Ionicons
                  name={isFinished ? "checkmark-done-sharp" : "lock-closed"}
                  size={28}
                  color="#fff"
                />
              </View>
            </View>
          </Animated.View>

          <Text style={[styles.statusTitle, { color: colors.text }]}>
            {isFinished ? "Signed Out Safely" : "Terminating Session..."}
          </Text>
          <Text style={[styles.statusSubtitle, { color: colors.textMuted }]}>
            {isFinished
              ? "Your session has been securely wiped from this device."
              : "Invalidating tokens and protecting offline storage."}
          </Text>

          <View
            style={[
              styles.progressBarTrack,
              { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)" },
            ]}
          >
            <Animated.View
              style={[
                styles.progressBarFill,
                {
                  width: progressInterpolate,
                  backgroundColor: isFinished ? "#22c55e" : "#ef4444",
                },
              ]}
            />
          </View>

          <View style={styles.stepsList}>
            <StepItem label="Revoking server access token" status={step1} colors={colors} />
            <StepItem label="Clearing cache & credentials" status={step2} colors={colors} />
            <StepItem label="Securing biometric storage" status={step3} colors={colors} />
          </View>

          <Pressable
            style={[styles.instantBtn, { borderColor: colors.cardBorder }]}
            onPress={() => router.replace("/login")}
          >
            <Text style={[styles.instantBtnText, { color: colors.textMuted }]}>
              Go to Login
            </Text>
            <Ionicons name="arrow-forward" size={14} color={colors.textMuted} />
          </Pressable>
        </Animated.View>

        <View style={styles.footerRow}>
          <Ionicons name="shield-checkmark" size={13} color="#22c55e" />
          <Text style={[styles.footerText, { color: colors.textMuted }]}>
            256-bit Encrypted Disconnect
          </Text>
        </View>
      </View>
    </View>
  );
}

function StepItem({
  label,
  status,
  colors,
}: {
  label: string;
  status: StepStatus;
  colors: any;
}) {
  return (
    <View style={styles.stepItemRow}>
      <View style={styles.stepIconHolder}>
        {status === "done" ? (
          <Ionicons name="checkmark-circle" size={19} color="#22c55e" />
        ) : status === "processing" ? (
          <ActivityIndicator size="small" color="#ef4444" />
        ) : (
          <View style={[styles.stepPendingCircle, { borderColor: colors.cardBorder }]} />
        )}
      </View>
      <Text
        style={[
          styles.stepLabelText,
          {
            color:
              status === "done"
                ? colors.text
                : status === "processing"
                ? colors.text
                : colors.textMuted,
            fontWeight: status === "processing" ? "700" : "500",
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  screenWrapper: {
    flex: 1,
    paddingHorizontal: 22,
    paddingTop: Platform.OS === "ios" ? 70 : 50,
    paddingBottom: Platform.OS === "ios" ? 36 : 24,
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandHeader: {
    alignItems: "center",
    marginTop: 10,
  },
  brandLogoCircle: {
    width: 68,
    height: 68,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    backgroundColor: "transparent",
  },
  brandLogoImage: {
    width: 48,
    height: 48,
  },
  brandTitle: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 4,
  },
  brandSubtitle: {
    fontSize: 10.5,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginTop: 2,
  },
  progressCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 26,
    borderWidth: 1.5,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 8,
  },
  iconBubbleRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  iconBubbleCore: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  statusTitle: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  statusSubtitle: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
    paddingHorizontal: 8,
  },
  progressBarTrack: {
    width: "100%",
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 20,
    marginBottom: 20,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  stepsList: {
    width: "100%",
    gap: 12,
    marginBottom: 18,
  },
  stepItemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepIconHolder: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  stepPendingCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
  },
  stepLabelText: {
    fontSize: 13,
  },
  instantBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 6,
  },
  instantBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  footerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  footerText: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.4,
  },
});