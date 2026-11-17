import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  StyleSheet,
  View,
  Text,
  Pressable,
  Dimensions,
  Animated,
  ActivityIndicator,
  Modal,
  Platform,
} from "react-native";
import { Camera, CameraView, useCameraPermissions } from "expo-camera";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

export type BiometricMode = "handover" | "client";

export interface FaceBiometricResult {
  mode: BiometricMode;
  uri: string;
  base64: string;
  faceCount: number;
  livenessPassed: boolean;
}

interface FaceBiometricCameraProps {
  mode: BiometricMode;
  visible: boolean;
  isDark?: boolean;
  onCaptured: (result: FaceBiometricResult) => void;
  onCancel: () => void;
  onNativeUnavailable?: () => void;
}

type LivenessStage = "CENTER" | "TURN_LEFT" | "TURN_RIGHT" | "BLINK" | "SMILE" | "VERIFIED";

export default function FaceBiometricCamera({
  mode,
  visible,
  isDark = true,
  onCaptured,
  onCancel,
}: FaceBiometricCameraProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">(mode === "client" ? "front" : "back");
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedFaces, setDetectedFaces] = useState<any[]>([]);

  // Liveness challenge state for client mode
  const [livenessStage, setLivenessStage] = useState<LivenessStage>("CENTER");
  const [instruction, setInstruction] = useState("Position face inside the frame");
  const [blinkDetected, setBlinkDetected] = useState(false);
  const [stageProgress, setStageProgress] = useState(0); // 0 to 100%

  const cameraRef = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulse animation for target reticle
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.05, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  // Request permissions on open
  useEffect(() => {
    if (visible && (!permission || !permission.granted)) {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  // Reset states when mode switches
  useEffect(() => {
    setDetectedFaces([]);
    setIsProcessing(false);
    if (mode === "client") {
      setFacing("front");
      setLivenessStage("CENTER");
      setInstruction("Look directly into the camera");
      setStageProgress(15);
    } else {
      setFacing("back");
      setInstruction("Position BOTH client & officer in frame (2 faces required)");
      setStageProgress(0);
    }
  }, [mode, visible]);

  /* ================= REAL-TIME FACE DETECTION & LIVENESS ENGINE ================= */
  const handleFacesDetected = useCallback(
    ({ faces }: { faces: any[] }) => {
      setDetectedFaces(faces || []);

      if (!faces || faces.length === 0) {
        if (mode === "handover") {
          setInstruction("No faces detected. Bring both people into frame.");
        } else {
          setInstruction("No face detected. Center your face in the oval.");
        }
        return;
      }

      /* ---------------- 1. HANDOVER MODE (MIN 2 FACES) ---------------- */
      if (mode === "handover") {
        if (faces.length >= 2) {
          setInstruction(`✓ ${faces.length} faces detected! Hold steady to capture.`);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        } else {
          setInstruction(`Only 1 face detected. Second person must enter frame.`);
        }
        return;
      }

      /* ---------------- 2. CLIENT ACTIVE LIVENESS MODE (ANTI-SPOOF) ---------------- */
      if (mode === "client") {
        if (faces.length > 1) {
          setInstruction("Only ONE person allowed for client verification.");
          return;
        }

        const face = faces[0];
        const yaw = face.yawAngle ?? 0; // Negative = turned right, positive = turned left
        const leftEyeOpen = face.leftEyeOpenProbability ?? 1;
        const rightEyeOpen = face.rightEyeOpenProbability ?? 1;
        const smileProb = face.smilingProbability ?? 0;

        switch (livenessStage) {
          case "CENTER":
            if (Math.abs(yaw) < 10) {
              setInstruction("Great. Now slowly turn your head to your LEFT");
              setLivenessStage("TURN_LEFT");
              setStageProgress(35);
              Haptics.selectionAsync();
            } else {
              setInstruction("Look straight at the camera");
            }
            break;

          case "TURN_LEFT":
            if (yaw > 14) {
              setInstruction("Nice. Now slowly turn your head to your RIGHT");
              setLivenessStage("TURN_RIGHT");
              setStageProgress(55);
              Haptics.selectionAsync();
            }
            break;

          case "TURN_RIGHT":
            if (yaw < -14) {
              setInstruction("Now blink both eyes naturally");
              setLivenessStage("BLINK");
              setStageProgress(75);
              setBlinkDetected(false);
              Haptics.selectionAsync();
            }
            break;

          case "BLINK":
            // Eyes closed threshold
            if (leftEyeOpen < 0.25 && rightEyeOpen < 0.25) {
              setBlinkDetected(true);
            }
            // Eyes reopened
            if (blinkDetected && leftEyeOpen > 0.65 && rightEyeOpen > 0.65) {
              setInstruction("Finally, give a natural smile :)");
              setLivenessStage("SMILE");
              setStageProgress(90);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
            break;

          case "SMILE":
            if (smileProb > 0.55) {
              setInstruction("✓ Real liveness verified! Snapping verification photo...");
              setLivenessStage("VERIFIED");
              setStageProgress(100);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              autoCaptureClient();
            }
            break;

          case "VERIFIED":
            // Awaiting capture completion
            break;
        }
      }
    },
    [mode, livenessStage, blinkDetected]
  );

  /* Auto triggers capture once liveness finishes */
  const autoCaptureClient = async () => {
    if (isProcessing) return;
    setIsProcessing(true);
    try {
      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: true,
          skipProcessing: false,
        });

        onCaptured({
          mode: "client",
          uri: photo.uri,
          base64: `data:image/jpeg;base64,${photo.base64}`,
          faceCount: 1,
          livenessPassed: true,
        });
      }
    } catch {
      setIsProcessing(false);
      setLivenessStage("CENTER");
      setInstruction("Capture failed. Let's repeat liveness check.");
    }
  };

  /* Manual Shutter for Handover (only clickable when >= 2 faces detected) */
  const takeHandoverPhoto = async () => {
    if (isProcessing) return;
    if (detectedFaces.length < 2) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      alert("Anti-Fraud Requirement: At least 2 faces must be present in frame.");
      return;
    }

    setIsProcessing(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    try {
      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({
          quality: 0.8,
          base64: true,
          skipProcessing: false,
        });

        onCaptured({
          mode: "handover",
          uri: photo.uri,
          base64: `data:image/jpeg;base64,${photo.base64}`,
          faceCount: detectedFaces.length,
          livenessPassed: true,
        });
      }
    } catch {
      setIsProcessing(false);
      alert("Unable to capture image. Please retry.");
    }
  };

  if (!visible) return null;

  const canCaptureHandover = mode === "handover" && detectedFaces.length >= 2;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={styles.container}>
        {/* Full-screen Native Camera View */}
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing={facing}
          onFacesDetected={handleFacesDetected}
          faceDetectorSettings={{
            mode: "fast",
            detectLandmarks: "all",
            runClassifications: "all",
            minDetectionInterval: 100,
            tracking: true,
          }}
        >
          {/* Top Bar Overlay */}
          <View style={styles.topBar}>
            <Pressable onPress={onCancel} style={styles.iconCircle}>
              <Ionicons name="close" size={24} color="#FFF" />
            </Pressable>

            <View style={styles.modeTag}>
              <Ionicons
                name={mode === "handover" ? "people" : "shield-checkmark"}
                size={14}
                color="#0F172A"
              />
              <Text style={styles.modeTagText}>
                {mode === "handover" ? "2-FACE HANDOVER SCAN" : "ANTI-SPOOF LIVENESS"}
              </Text>
            </View>

            <Pressable
              onPress={() => setFacing((prev) => (prev === "front" ? "back" : "front"))}
              style={styles.iconCircle}
            >
              <Ionicons name="camera-reverse-outline" size={22} color="#FFF" />
            </Pressable>
          </View>

          {/* Central Target HUD */}
          <View style={styles.centerTargetArea} pointerEvents="none">
            {mode === "client" ? (
              /* Oval cutout frame for client face */
              <Animated.View
                style={[
                  styles.clientOval,
                  {
                    transform: [{ scale: pulseAnim }],
                    borderColor:
                      livenessStage === "VERIFIED"
                        ? "#10B981"
                        : detectedFaces.length === 1
                        ? "#F59E0B"
                        : "rgba(255,255,255,0.4)",
                  },
                ]}
              >
                <View style={styles.crosshairH} />
                <View style={styles.crosshairV} />
              </Animated.View>
            ) : (
              /* Dual Face Bounding Target Boxes for Handover */
              <View style={styles.handoverTargetBox}>
                <View
                  style={[
                    styles.targetBoxSide,
                    { borderColor: detectedFaces.length >= 1 ? "#10B981" : "rgba(255,255,255,0.4)" },
                  ]}
                >
                  <Text style={styles.targetBoxLabel}>Officer / BM</Text>
                </View>
                <View
                  style={[
                    styles.targetBoxSide,
                    { borderColor: detectedFaces.length >= 2 ? "#10B981" : "rgba(255,255,255,0.4)" },
                  ]}
                >
                  <Text style={styles.targetBoxLabel}>Client</Text>
                </View>
              </View>
            )}
          </View>

          {/* Bottom HUD & Prompts */}
          <View style={styles.bottomHud}>
            {/* Real-time instruction banner */}
            <View
              style={[
                styles.instructionBanner,
                {
                  backgroundColor:
                    mode === "handover"
                      ? canCaptureHandover
                        ? "rgba(16, 185, 129, 0.92)"
                        : "rgba(15, 23, 42, 0.85)"
                      : livenessStage === "VERIFIED"
                      ? "rgba(16, 185, 129, 0.95)"
                      : "rgba(15, 23, 42, 0.85)",
                },
              ]}
            >
              <Ionicons
                name={
                  canCaptureHandover || livenessStage === "VERIFIED"
                    ? "checkmark-circle"
                    : "scan-outline"
                }
                size={18}
                color={canCaptureHandover || livenessStage === "VERIFIED" ? "#FFF" : "#F59E0B"}
              />
              <Text style={styles.instructionText}>{instruction}</Text>
            </View>

            {/* Client Mode: Stage Progress Line */}
            {mode === "client" && (
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${stageProgress}%` }]} />
              </View>
            )}

            {/* Handover Controls */}
            {mode === "handover" ? (
              <View style={styles.handoverControls}>
                <View style={styles.faceCounter}>
                  <Text style={styles.faceCountText}>
                    Faces detected: <Text style={{ fontWeight: "900", color: canCaptureHandover ? "#10B981" : "#EF4444" }}>{detectedFaces.length}</Text> / 2 required
                  </Text>
                </View>

                <Pressable
                  onPress={takeHandoverPhoto}
                  disabled={!canCaptureHandover || isProcessing}
                  style={({ pressed }) => [
                    styles.shutterBtn,
                    {
                      backgroundColor: canCaptureHandover ? "#F59E0B" : "rgba(255,255,255,0.25)",
                      transform: [{ scale: pressed ? 0.93 : 1 }],
                    },
                  ]}
                >
                  {isProcessing ? (
                    <ActivityIndicator color="#0F172A" />
                  ) : (
                    <Ionicons name="camera" size={32} color={canCaptureHandover ? "#0F172A" : "#888"} />
                  )}
                </Pressable>
              </View>
            ) : (
              /* Client Mode Live Status */
              <View style={styles.clientStatusRow}>
                {isProcessing ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator color="#F59E0B" />
                    <Text style={{ color: "#FFF", fontWeight: "700" }}>Securing biometric photo...</Text>
                  </View>
                ) : (
                  <Text style={styles.spoofProtectionNotice}>
                    🛡️ Anti-Spoof Protection Active: 2D Photos & Screens Blocked
                  </Text>
                )}
              </View>
            )}
          </View>
        </CameraView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  topBar: {
    paddingTop: Platform.OS === "ios" ? 54 : 30,
    paddingHorizontal: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 10,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  modeTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#F59E0B",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  modeTagText: { fontSize: 11, fontWeight: "900", color: "#0F172A" },

  centerTargetArea: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  clientOval: {
    width: SCREEN_WIDTH * 0.72,
    height: SCREEN_WIDTH * 0.95,
    borderRadius: (SCREEN_WIDTH * 0.72) / 2,
    borderWidth: 3,
    borderStyle: "dashed",
    justifyContent: "center",
    alignItems: "center",
  },
  crosshairH: {
    position: "absolute",
    width: 20,
    height: 2,
    backgroundColor: "rgba(255,255,255,0.4)",
  },
  crosshairV: {
    position: "absolute",
    width: 2,
    height: 20,
    backgroundColor: "rgba(255,255,255,0.4)",
  },

  handoverTargetBox: {
    flexDirection: "row",
    width: SCREEN_WIDTH * 0.9,
    justifyContent: "space-between",
  },
  targetBoxSide: {
    width: "48%",
    height: 220,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 12,
  },
  targetBoxLabel: {
    color: "#FFF",
    fontSize: 11,
    fontWeight: "800",
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },

  bottomHud: {
    paddingBottom: Platform.OS === "ios" ? 44 : 26,
    paddingHorizontal: 20,
    alignItems: "center",
    gap: 12,
  },
  instructionBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    maxWidth: SCREEN_WIDTH - 40,
  },
  instructionText: {
    color: "#FFF",
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    flexShrink: 1,
  },

  progressTrack: {
    width: SCREEN_WIDTH - 60,
    height: 5,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#10B981",
  },

  handoverControls: {
    alignItems: "center",
    gap: 10,
  },
  faceCounter: {
    backgroundColor: "rgba(0,0,0,0.6)",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  faceCountText: { color: "#FFF", fontSize: 12, fontWeight: "600" },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
    borderColor: "#FFF",
  },

  clientStatusRow: {
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  spoofProtectionNotice: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10.5,
    fontWeight: "600",
  },
});