import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../../theme/ThemeContext";

interface LogoutModalProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  subtitle?: string;
}

export default function LogoutConfirmModal({
  visible,
  onClose,
  onConfirm,
  title = "Sign Out of CUPAD?",
  subtitle = "Your active credentials and cached encryption keys will be securely cleared from this device.",
}: LogoutModalProps) {
  const { colors, isDark } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.88)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(scaleAnim, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.modalBackdrop, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <Animated.View
          style={[
            styles.modalPopupCard,
            {
              backgroundColor: colors.card,
              borderColor: isDark ? "rgba(239,68,68,0.22)" : "rgba(239,68,68,0.14)",
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          {/* Close corner button */}
          <Pressable onPress={onClose} hitSlop={10} style={styles.modalCloseIcon}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>

          {/* Glowing Red Icon Ring */}
          <View style={styles.modalIconRingWrapper}>
            <View
              style={[
                styles.modalIconOuterRing,
                { backgroundColor: isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.08)" },
              ]}
            >
              <View style={styles.modalIconInnerRing}>
                <Ionicons name="log-out" size={30} color="#fff" />
              </View>
            </View>
          </View>

          {/* Security Tag */}
          <View
            style={[
              styles.securityPill,
              { backgroundColor: isDark ? "rgba(239,68,68,0.16)" : "rgba(239,68,68,0.08)" },
            ]}
          >
            <View style={styles.redPulseDot} />
            <Text style={styles.securityPillText}>SESSION TERMINATION</Text>
          </View>

          <Text style={[styles.modalHeading, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.modalSubheading, { color: colors.textMuted }]}>{subtitle}</Text>

          {/* Field Data Notice */}
          <View
            style={[
              styles.modalNoticeBox,
              {
                backgroundColor: isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.02)",
                borderColor: colors.cardBorder,
              },
            ]}
          >
            <Ionicons name="shield-checkmark" size={16} color="#22c55e" />
            <Text style={[styles.modalNoticeText, { color: colors.textMuted }]}>
              All synced field collections remain safely stored on the server.
            </Text>
          </View>

          {/* Action Buttons */}
          <View style={styles.modalButtonsStack}>
            <Pressable
              style={[styles.modalDangerBtn, { shadowColor: "#ef4444" }]}
              onPress={onConfirm}
            >
              <Ionicons name="log-out-outline" size={18} color="#fff" />
              <Text style={styles.modalDangerBtnText}>Yes, Sign Out</Text>
            </Pressable>

            <Pressable
              style={[styles.modalCancelBtn, { borderColor: colors.cardBorder }]}
              onPress={onClose}
            >
              <Text style={[styles.modalCancelBtnText, { color: colors.text }]}>
                Stay Signed In
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.68)",
    justifyContent: "center",
    alignItems: "center",
    padding: 22,
    zIndex: 9999,
  },
  modalPopupCard: {
    width: "100%",
    maxWidth: 360,
    borderRadius: 26,
    borderWidth: 1.5,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.28,
    shadowRadius: 22,
    elevation: 12,
  },
  modalCloseIcon: {
    position: "absolute",
    top: 16,
    right: 16,
    padding: 6,
    zIndex: 10,
  },
  modalIconRingWrapper: {
    marginTop: 6,
    marginBottom: 12,
  },
  modalIconOuterRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  modalIconInnerRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#ef4444",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#ef4444",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  securityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginBottom: 10,
  },
  redPulseDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#ef4444",
  },
  securityPillText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#ef4444",
    letterSpacing: 0.8,
  },
  modalHeading: {
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  modalSubheading: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 14,
    paddingHorizontal: 4,
  },
  modalNoticeBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 20,
  },
  modalNoticeText: {
    flex: 1,
    fontSize: 11.5,
    lineHeight: 16,
    fontWeight: "500",
  },
  modalButtonsStack: {
    width: "100%",
    gap: 10,
  },
  modalDangerBtn: {
    width: "100%",
    height: 48,
    backgroundColor: "#ef4444",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 4,
  },
  modalDangerBtnText: {
    color: "#fff",
    fontSize: 14.5,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  modalCancelBtn: {
    width: "100%",
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelBtnText: {
    fontSize: 13.5,
    fontWeight: "600",
  },
});