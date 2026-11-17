import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Easing,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from 'expo-secure-store';
import * as Location from 'expo-location';
import axios from "axios";
import { router } from "expo-router";
import { useTheme } from "../src/theme/ThemeContext";
import { getDb, saveLastLogin } from "../src/db/database";

function normalizeRole(role?: string) {
  return String(role || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}
function getRoleRoute(role?: string) {
  const normalized = normalizeRole(role);
  switch (normalized) {
    case "admin": return "/admin/dashboard";
    case "tm": return "/tm/dashboard";
    case "am": return "/am/dashboard";
    case "bm": return "/bm/dashboard";
    case "co":
    case "collectionofficer":
    case "collectionofficerofficer":
      return "/co/dashboard";
    case "dzm": return "/dzm/dashboard";
    case "zm": return "/zm/dashboard";
    case "client": return "/client/dashboard";
    default: return null;
  }
}

const { width, height } = Dimensions.get("window");
const API_URL = "https://cupadapp.name.ng/api/login.php";

const BIO_ENABLED_KEY = "cupad_biometric_enabled";
const BIO_USER_KEY = "cupad_biometric_user";
const BIO_TOKEN_KEY = "cupad_biometric_token";
const BIO_USERNAME_KEY = "cupad_biometric_username";
const BIO_PASSWORD_KEY = "cupad_biometric_password";

type LocationData = {
  latitude: number;
  longitude: number;
  address: string;
  city?: string;
  region?: string;
};

function Orb({ size, color, left, top, delay = 0 }: { size: number; color: string; left: number; top: number; delay?: number }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(translateY, { toValue: -20, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1.15, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(translateY, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(scale, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);
  return <Animated.View style={{ position: "absolute", left, top, width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.5, transform: [{ translateY }, { scale }] }} />;
}
type ParticleConfig = { x: number; y: number; size: number; opacity: number; duration: number; delay: number; };
const PARTICLES: ParticleConfig[] = Array.from({ length: 22 }, () => ({
  x: Math.random() * width,
  y: Math.random() * height,
  size: Math.random() * 4 + 2,
  opacity: Math.random() * 0.4 + 0.15,
  duration: Math.random() * 4000 + 4000,
  delay: Math.random() * 2000,
}));
function Particle({ particle, isDark }: { particle: ParticleConfig; isDark: boolean }) {
  const translateY = useRef(new Animated.Value(0)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(particle.opacity)).current;
  useEffect(() => {
    const v = Animated.loop(Animated.sequence([Animated.delay(particle.delay), Animated.timing(translateY, { toValue: -60, duration: particle.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(translateY, { toValue: 0, duration: particle.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]));
    const h = Animated.loop(Animated.sequence([Animated.timing(translateX, { toValue: 25, duration: particle.duration * 0.9, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(translateX, { toValue: -25, duration: particle.duration * 0.9, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]));
    const p = Animated.loop(Animated.sequence([Animated.timing(scale, { toValue: 1.6, duration: particle.duration * 0.5, useNativeDriver: true }), Animated.timing(scale, { toValue: 0.8, duration: particle.duration * 0.5, useNativeDriver: true })]));
    const f = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: particle.opacity * 1.6, duration: particle.duration * 0.5, useNativeDriver: true }), Animated.timing(opacity, { toValue: particle.opacity * 0.4, duration: particle.duration * 0.5, useNativeDriver: true })]));
    v.start(); h.start(); p.start(); f.start();
    return () => { v.stop(); h.stop(); p.stop(); f.stop(); };
  }, []);
  return <Animated.View style={{ position: "absolute", left: particle.x, top: particle.y, width: particle.size, height: particle.size, borderRadius: particle.size / 2, backgroundColor: isDark ? "#76B7FF" : "#1677FF", opacity, transform: [{ translateX }, { translateY }, { scale }], shadowColor: "#1677FF", shadowOpacity: 0.6, shadowRadius: 4 }} />;
}

export default function LoginScreen() {
  const { colors, isDark, toggleTheme } = useTheme();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [focused, setFocused] = useState<"user" | "pass" | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [bioLoading, setBioLoading] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioType, setBioType] = useState("Biometric");
  const [bioEnabled, setBioEnabled] = useState(false);
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const buttonScale = useRef(new Animated.Value(1)).current;
  const bioScale = useRef(new Animated.Value(1)).current;
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
    ]).start();
  }, []);

  // Request location on mount
  const requestLocation = async () => {
    try {
      setLocationLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationPermission(false);
        console.log("Location permission denied");
        setLocationLoading(false);
        return null;
      }
      setLocationPermission(true);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let address = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      let city, region;
      try {
        const rev = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        if (rev[0]) {
          city = rev[0].city || rev[0].subregion || "";
          region = rev[0].region || "";
          address = [rev[0].name, rev[0].street, city, region, rev[0].country].filter(Boolean).join(", ");
        }
      } catch {}
      const loc: LocationData = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, address, city, region };
      setLocationData(loc);
      await AsyncStorage.setItem("cupad_last_location", JSON.stringify(loc));
      return loc;
    } catch (e) {
      console.log("Location error", e);
      return null;
    } finally {
      setLocationLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await getDb();
        const savedUser = await AsyncStorage.getItem("cupad_remember_user");
        if (savedUser) setUsername(savedUser);
        const bioEnabledSaved = await AsyncStorage.getItem(BIO_ENABLED_KEY) || await AsyncStorage.getItem("cupad_bio_enabled");
        if (bioEnabledSaved === "true") setBioEnabled(true);
        const bioUser = await AsyncStorage.getItem(BIO_USER_KEY);
        if (bioUser) {
          const u = JSON.parse(bioUser);
          if (u?.username && !savedUser) setUsername(u.username);
        }
        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (compatible && enrolled) {
          setBioAvailable(true);
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) setBioType("Face ID");
          else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) setBioType("Fingerprint");
          else setBioType("Biometric");
        }
        // Pre-fetch location in background
        requestLocation();
      } finally { setCheckingAuth(false); }
    })();
  }, []);

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const saveSessionWithLastLogin = async (user: any, token: string, method: string, pass?: string, loc?: LocationData | null) => {
    const currentLoc = loc || locationData;
    if (rememberMe) await AsyncStorage.setItem("cupad_remember_user", user.username || username.trim());
    await AsyncStorage.setItem("auth_token", token);
    await AsyncStorage.setItem("auth_user", JSON.stringify(user));
    await AsyncStorage.setItem("cupad_jwt", token);
    await AsyncStorage.setItem("cupad_user", JSON.stringify(user));
    if (user?.role) await AsyncStorage.setItem("cupad_role", user.role);
    if (currentLoc) await AsyncStorage.setItem("cupad_last_location", JSON.stringify(currentLoc));

    await AsyncStorage.setItem(BIO_ENABLED_KEY, "true");
    await AsyncStorage.setItem("cupad_bio_enabled", "true");
    await AsyncStorage.setItem(BIO_USER_KEY, JSON.stringify(user));
    await AsyncStorage.setItem(BIO_TOKEN_KEY, token);
    await AsyncStorage.setItem(BIO_USERNAME_KEY, user.username);
    setBioEnabled(true);
    try {
      const pwdToSave = pass || password;
      if (pwdToSave) await SecureStore.setItemAsync(BIO_PASSWORD_KEY, pwdToSave);
    } catch {
      try {
        const pwdToSave = pass || password;
        if (pwdToSave) await AsyncStorage.setItem(BIO_PASSWORD_KEY, pwdToSave);
      } catch {}
    }
    try {
      const res = await saveLastLogin({
        id: user.id,
        user_id: String(user.id),
        username: user.username,
        role: user.role,
        name: user.name,
        full_name: user.full_name,
        email: user.email,
        token,
        method,
        branch_id: user.branch_id ? String(user.branch_id) : undefined,
        area_id: user.area_id ? String(user.area_id) : undefined,
        zone_id: user.zone_id ? String(user.zone_id) : undefined,
        latitude: currentLoc?.latitude,
        longitude: currentLoc?.longitude,
        location_address: currentLoc?.address,
      } as any);
      await AsyncStorage.setItem("cupad_last_login", res.last_login);
    } catch (e) { console.log("DB save error", e); }
  };

  const handleLogin = async () => {
    if (!username.trim()) { setError("Please enter your username"); triggerShake(); return; }
    if (!password.trim()) { setError("Please enter your password"); triggerShake(); return; }
    setError(""); setLoading(true);
    Animated.spring(buttonScale, { toValue: 0.96, useNativeDriver: true }).start();
    try {
      let loc = locationData;
      if (!loc) loc = await requestLocation();
      
      const res = await axios.post(API_URL, { 
        username: username.trim(), 
        password, 
        action: "login",
        login_method: "password",
        latitude: loc?.latitude,
        longitude: loc?.longitude,
        location_address: loc?.address,
        city: loc?.city,
        region: loc?.region,
      }, { headers: { "Content-Type": "application/json" }, timeout: 15000 });
      const token = res.data.token || res.data.data?.token;
      const user = res.data.user || res.data.data?.user;
      if (res.data.success && token && user) {
        await saveSessionWithLastLogin(user, token, "password", password, loc);
        const route = getRoleRoute(user?.role);
        router.replace((route as any) || "/(tabs)" as any);
      } else { setError(res.data.message || "Invalid credentials"); triggerShake(); }
    } catch (err: any) {
      setError(err.response?.data?.message || "Unable to connect. Check internet.");
      triggerShake();
    } finally { setLoading(false); Animated.spring(buttonScale, { toValue: 1, friction: 5, useNativeDriver: true }).start(); }
  };

  const handleBiometricLogin = async () => {
    try {
      setBioLoading(true); setError("");
      Animated.spring(bioScale, { toValue: 0.96, useNativeDriver: true }).start();
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) { setError("Biometric hardware not available"); triggerShake(); return; }
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) { setError("No biometrics enrolled. Please set up in device settings"); triggerShake(); return; }
      const result = await LocalAuthentication.authenticateAsync({ 
        promptMessage: `Login with ${bioType}`, 
        cancelLabel: "Cancel", 
        disableDeviceFallback: true 
      });
      if (!result.success) { 
        if (result.error !== "user_cancel") { setError("Biometric authentication failed"); triggerShake(); } 
        return; 
      }
      let token = await AsyncStorage.getItem(BIO_TOKEN_KEY) || (await AsyncStorage.getItem("cupad_jwt")) || (await AsyncStorage.getItem("auth_token"));
      let userJson = await AsyncStorage.getItem(BIO_USER_KEY) || (await AsyncStorage.getItem("cupad_user")) || (await AsyncStorage.getItem("auth_user"));
      let savedUsername = await AsyncStorage.getItem(BIO_USERNAME_KEY);
      let savedPassword: string | null = null;
      try { savedPassword = await SecureStore.getItemAsync(BIO_PASSWORD_KEY); } catch {}
      if (!savedPassword) savedPassword = await AsyncStorage.getItem(BIO_PASSWORD_KEY);
      if (!userJson || !savedUsername) {
        setError("No saved biometric session. Please login with password once to enable fingerprint");
        triggerShake();
        return;
      }
      let user: any; 
      try { user = JSON.parse(userJson); } catch { user = null; }
      if (!user) { setError("Invalid saved session. Please login again"); triggerShake(); return; }
      const method = bioType === "Face ID" ? "face_id" : bioType === "Fingerprint" ? "fingerprint" : "biometric";
      let loc = locationData;
      if (!loc) loc = await requestLocation();
      if (savedPassword && savedUsername) {
        try {
          const res = await axios.post(API_URL, {
            username: savedUsername,
            password: savedPassword,
            action: "login",
            login_method: method,
            latitude: loc?.latitude,
            longitude: loc?.longitude,
            location_address: loc?.address,
            city: loc?.city,
            region: loc?.region,
          }, { timeout: 10000 });
          const newToken = res.data.token || res.data.data?.token;
          const newUser = res.data.user || res.data.data?.user;
          if (res.data.success && newToken && newUser) {
            await saveSessionWithLastLogin(newUser, newToken, method, savedPassword, loc);
            const route = getRoleRoute(newUser?.role);
            router.replace((route as any) || "/(tabs)" as any);
            return;
          }
        } catch (e) {
          console.log("Biometric API re-login failed, using cached token", e);
        }
      }
      if (token && user) {
        await saveSessionWithLastLogin(user, token, method, savedPassword || undefined, loc);
        const role = user?.role || (await AsyncStorage.getItem("cupad_role"));
        const route = getRoleRoute(role);
        if (route) router.replace(route as any); else router.replace("/(tabs)" as any);
        return;
      }
      setError("Biometric login failed. Please login with password");
      triggerShake();
    } catch (e: any) {
      console.log(e);
      setError("Biometric login failed"); triggerShake();
    } finally { setBioLoading(false); Animated.spring(bioScale, { toValue: 1, friction: 5, useNativeDriver: true }).start(); }
  };

  if (checkingAuth) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="small" color={colors.primary} /></View>;
  }

  const orb1 = isDark ? "rgba(22,119,255,0.18)" : "rgba(22,119,255,0.12)";
  const orb2 = isDark ? "rgba(118,183,255,0.15)" : "rgba(118,183,255,0.10)";
  const orb3 = isDark ? "rgba(22,119,255,0.10)" : "rgba(22,119,255,0.08)";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Orb size={220} color={orb1} left={-60} top={-40} delay={0} />
        <Orb size={180} color={orb2} left={width - 120} top={120} delay={800} />
        <Orb size={260} color={orb3} left={width * 0.3} top={height * 0.45} delay={1600} />
        {PARTICLES.map((p, i) => <Particle key={i} particle={p} isDark={isDark} />)}
      </View>

      <Pressable onPress={toggleTheme} style={[styles.themeButtonAbsolute, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <Ionicons name={isDark ? "sunny" : "moon"} size={18} color={colors.text} />
      </Pressable>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.centeredWrapper}>
            <Animated.View style={[styles.mainContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              <View style={styles.secureBadgeRow}>
                <View style={[styles.secureBadge, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={[styles.dot, { backgroundColor: "#22c55e" }]} />
                  <Text style={[styles.secureText, { color: colors.textMuted }]}>Secure & Encrypted</Text>
                  {locationPermission && locationData && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 6 }}>
                      <Ionicons name="location" size={10} color="#22c55e" />
                      <Text style={[styles.secureText, { color: "#22c55e", fontSize: 10 }]} numberOfLines={1}>{locationData.city || "Location On"}</Text>
                    </View>
                  )}
                </View>
              </View>

              <Animated.View style={[styles.logoSection, { transform: [{ scale: logoScale }] }]}>
                <View style={styles.logoWrapper}>
                  <View style={[styles.logoRing, { borderColor: isDark ? "rgba(22,119,255,0.15)" : "rgba(22,119,255,0.10)" }]} />
                  <View style={[styles.logoRing2, { borderColor: isDark ? "rgba(22,119,255,0.08)" : "rgba(22,119,255,0.06)" }]} />
                  <Image source={require("../assets/cupad logo.png")} style={styles.logoImage} resizeMode="contain" />
                </View>
                <Text style={[styles.brand, { color: colors.text }]}>CUPAD</Text>
                <Text style={[styles.brandSub, { color: colors.textMuted }]}>Empowerment Initiative</Text>
              </Animated.View>

              <Animated.View style={[{ transform: [{ translateX: shakeAnim }] }]}>
                <View style={styles.welcomeHeader}>
                  <Text style={[styles.title, { color: colors.text }]}>Welcome back</Text>
                  <Text style={[styles.subtitle, { color: colors.textMuted }]}>Enter your credentials to access your account</Text>
                  {locationData && (
                    <Pressable onPress={requestLocation} style={[styles.locationBadge, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                      <Ionicons name={locationLoading ? "sync" : "location-outline"} size={12} color={colors.primary} />
                      <Text style={[styles.locationText, { color: colors.textMuted }]} numberOfLines={1}>{locationLoading ? "Updating location..." : locationData.address.slice(0, 50)}</Text>
                    </Pressable>
                  )}
                </View>

                {error ? (
                  <View style={[styles.errorBox, { backgroundColor: isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }]}>
                    <View style={[styles.errorIcon, { backgroundColor: "#ef4444" }]}><Ionicons name="alert" size={12} color="#fff" /></View>
                    <Text style={[styles.errorText, { color: "#ef4444" }]}>{error}</Text>
                    <Pressable onPress={() => setError("")}><Ionicons name="close" size={16} color="#ef4444" /></Pressable>
                  </View>
                ) : null}

                <View style={styles.form}>
                  <View style={styles.field}>
                    <Text style={[styles.label, { color: colors.textMuted }]}>Username</Text>
                    <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: focused === "user" ? colors.primary : colors.cardBorder }, focused === "user" && { borderWidth: 1.5 }]}>
                      <Ionicons name="person" size={18} color={focused === "user" ? colors.primary : colors.textMuted} />
                      <TextInput style={[styles.input, { color: colors.text }]} placeholder="e.g. john.doe" placeholderTextColor={colors.textMuted} value={username} onChangeText={(t) => { setUsername(t); if (error) setError(""); }} autoCapitalize="none" returnKeyType="next" onSubmitEditing={() => passwordRef.current?.focus()} onFocus={() => setFocused("user")} onBlur={() => setFocused(null)} />
                    </View>
                  </View>

                  <View style={styles.field}>
                    <View style={styles.labelRow}><Text style={[styles.label, { color: colors.textMuted }]}>Password</Text><Pressable onPress={() => router.push("/forgot-password" as any)}><Text style={[styles.forgotText, { color: colors.primary }]}>Forgot?</Text></Pressable></View>
                    <View style={[styles.inputWrap, { backgroundColor: colors.card, borderColor: focused === "pass" ? colors.primary : colors.cardBorder }, focused === "pass" && { borderWidth: 1.5 }]}>
                      <Ionicons name="lock-closed" size={18} color={focused === "pass" ? colors.primary : colors.textMuted} />
                      <TextInput ref={passwordRef} style={[styles.input, { color: colors.text }]} placeholder="••••••••••••" placeholderTextColor={colors.textMuted} value={password} onChangeText={(t) => { setPassword(t); if (error) setError(""); }} secureTextEntry={!showPassword} returnKeyType="done" onSubmitEditing={handleLogin} onFocus={() => setFocused("pass")} onBlur={() => setFocused(null)} />
                      <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10} style={styles.eyeBtn}><Ionicons name={showPassword ? "eye-off" : "eye"} size={18} color={colors.textMuted} /></Pressable>
                    </View>
                  </View>

                  <Pressable style={styles.rememberRow} onPress={() => setRememberMe(!rememberMe)}>
                    <View style={[styles.checkbox, { borderColor: rememberMe ? colors.primary : colors.cardBorder, backgroundColor: rememberMe ? colors.primary : "transparent" }]}>{rememberMe ? <Ionicons name="checkmark" size={12} color="#fff" /> : null}</View>
                    <Text style={[styles.rememberText, { color: colors.textMuted }]}>Remember me & enable fingerprint</Text>
                  </Pressable>

                  <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
                    <Pressable style={[styles.loginBtn, { backgroundColor: colors.primary, opacity: loading ? 0.85 : 1 }]} onPress={handleLogin} disabled={loading}>
                      {loading ? <ActivityIndicator color="#fff" /> : <><Text style={styles.loginBtnText}>Sign in</Text><View style={styles.loginBtnIcon}><Ionicons name="arrow-forward" size={18} color="#fff" /></View></>}
                    </Pressable>
                  </Animated.View>

                  <View style={styles.dividerRow}><View style={[styles.divider, { backgroundColor: colors.cardBorder }]} /><Text style={[styles.dividerText, { color: colors.textMuted }]}>or continue with</Text><View style={[styles.divider, { backgroundColor: colors.cardBorder }]} /></View>

                  <Animated.View style={{ transform: [{ scale: bioScale }] }}>
                    <Pressable style={[styles.bioBtn, { backgroundColor: colors.card, borderColor: bioEnabled ? colors.primary : colors.cardBorder, borderWidth: bioEnabled ? 1.5 : 1, opacity: bioLoading ? 0.8 : 1 }]} onPress={handleBiometricLogin} disabled={bioLoading}>
                      <View style={[styles.bioIconWrap, { backgroundColor: isDark ? "rgba(22,119,255,0.15)" : "rgba(22,119,255,0.10)" }]}>
                        {bioLoading ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name={bioType === "Face ID" ? "scan" : "finger-print"} size={22} color={colors.primary} />}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.bioTitle, { color: colors.text }]}>{bioType} Login {bioEnabled ? "✓" : ""}</Text>
                        <Text style={[styles.bioSub, { color: colors.textMuted }]}>{!bioEnabled ? "Login once to enable" : `Use ${bioType} to login`}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                    </Pressable>
                  </Animated.View>
                </View>
              </Animated.View>
            </Animated.View>
          </View>

          <View style={styles.bottomFooter}>
            <View style={styles.trustRow}>
              <View style={styles.trustItem}><Ionicons name="shield-checkmark" size={14} color="#22c55e" /><Text style={[styles.trustText, { color: colors.textMuted }]}>256-bit SSL</Text></View>
              <View style={styles.trustItem}><Ionicons name="lock-closed" size={14} color={colors.textMuted} /><Text style={[styles.trustText, { color: colors.textMuted }]}>NDPR Compliant</Text></View>
              <View style={styles.trustItem}><Ionicons name="location" size={14} color={colors.primary} /><Text style={[styles.trustText, { color: colors.textMuted }]}>{locationPermission ? "Location Active" : "Location Off"}</Text></View>
            </View>
            <Text style={[styles.version, { color: colors.textMuted }]}>CUPAD v2.0.0 • {isDark ? "Dark" : "Light"} Mode</Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 90, paddingBottom: 0, minHeight: height, justifyContent: "space-between" },
  centeredWrapper: { flex: 1, justifyContent: "center", alignItems: "center", width: "100%" },
  mainContent: { width: "100%", maxWidth: 400, justifyContent: "center", alignSelf: "center" },
  bottomFooter: { paddingTop: 32, paddingBottom: Platform.OS === "ios" ? 34 : 24, alignItems: "center", marginTop: 32, width: "100%" },
  themeButtonAbsolute: { position: "absolute", top: Platform.OS === "ios" ? 85 : 50, right: 20, width: 42, height: 42, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", zIndex: 100 },
  secureBadgeRow: { alignItems: "center", marginBottom: 24 },
  secureBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  secureText: { fontSize: 11, fontWeight: "600", letterSpacing: 0.3 },
  logoSection: { alignItems: "center", marginBottom: 16 },
  logoWrapper: { width: 130, height: 130, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  logoImage: { width: 110, height: 110, borderRadius: 20 },
  logoRing: { position: "absolute", width: 115, height: 115, borderRadius: 57.5, borderWidth: 1 },
  logoRing2: { position: "absolute", width: 135, height: 135, borderRadius: 67.5, borderWidth: 1 },
  brand: { fontSize: 28, fontWeight: "900", letterSpacing: 5 },
  brandSub: { fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginTop: 4, textTransform: "uppercase" },
  welcomeHeader: { marginBottom: 24, marginTop: 4, alignItems: "center", width: "100%" },
  title: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5, textAlign: "center" },
  subtitle: { fontSize: 14, marginTop: 6, lineHeight: 19, fontWeight: "500", textAlign: "center" },
  locationBadge: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderWidth: 1, maxWidth: "100%" },
  locationText: { fontSize: 10, fontWeight: "500", flexShrink: 1 },
  errorBox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10, marginBottom: 18 },
  errorIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  errorText: { flex: 1, fontSize: 12.5, fontWeight: "600", lineHeight: 16 },
  form: { gap: 16 },
  field: { gap: 8 },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  label: { fontSize: 12.5, fontWeight: "700", letterSpacing: 0.3 },
  forgotText: { fontSize: 12.5, fontWeight: "600" },
  inputWrap: { height: 52, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14 },
  input: { flex: 1, fontSize: 15, height: "100%", marginLeft: 10, ...Platform.select({ web: { outlineStyle: "none" } as any }) },
  eyeBtn: { padding: 6, marginLeft: 6 },
  rememberRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2 },
  checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  rememberText: { fontSize: 13, fontWeight: "500" },
  loginBtn: { height: 54, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 6 },
  loginBtnText: { color: "#fff", fontSize: 15.5, fontWeight: "800", letterSpacing: 0.2 },
  loginBtnIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.22)", alignItems: "center", justifyContent: "center" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginVertical: 4 },
  divider: { flex: 1, height: 1 },
  dividerText: { fontSize: 11.5, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  bioBtn: { height: 68, borderRadius: 14, borderWidth: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 14, gap: 12 },
  bioIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bioTitle: { fontSize: 13.5, fontWeight: "700" },
  bioSub: { fontSize: 11.5, marginTop: 2 },
  trustRow: { flexDirection: "row", justifyContent: "center", gap: 18, flexWrap: "wrap" },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  trustText: { fontSize: 11, fontWeight: "500" },
  version: { textAlign: "center", marginTop: 14, fontSize: 10, fontWeight: "500", letterSpacing: 0.5 },
});