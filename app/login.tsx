import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Easing,
  useColorScheme,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import * as Location from "expo-location";
import axios from "axios";
import { router } from "expo-router";
import { useTheme } from "../src/theme/ThemeContext";
import { getDb, saveLastLogin } from "../src/db/database";

const WEB_PORTAL_URL = "https://cupadapp.name.ng";

function normalizeRole(role?: string) {
  return String(role || "").trim().toLowerCase().replace(/[^a-z]/g, "");
}

// Checks if the user is a Collection Officer (CO)
function isCORole(role?: string) {
  const normalized = normalizeRole(role);
  return (
    normalized === "co" ||
    normalized === "collectionofficer" ||
    normalized === "collectionofficerofficer"
  );
}

function getRoleRoute(role?: string) {
  if (isCORole(role)) {
    return "/co/dashboard";
  }
  return null;
}

function getRoleMeta(role?: string): { name: string; tag: string; icon: keyof typeof Ionicons.glyphMap } {
  const norm = normalizeRole(role);
  switch (norm) {
    case "admin": return { name: "System Administrator", tag: "ADMIN", icon: "shield-checkmark" };
    case "bm": return { name: "Branch Manager", tag: "BM", icon: "business" };
    case "am": return { name: "Area Manager", tag: "AM", icon: "briefcase" };
    case "tm": return { name: "Team Manager", tag: "TM", icon: "people" };
    case "zm": return { name: "Zonal Manager", tag: "ZM", icon: "map" };
    case "dzm": return { name: "Deputy Zonal Manager", tag: "DZM", icon: "navigate" };
    case "client": return { name: "Client Portal", tag: "CLIENT", icon: "person" };
    default: return { name: role?.toUpperCase() || "Staff Member", tag: role?.toUpperCase() || "STAFF", icon: "person-circle" };
  }
}

const { width, height } = Dimensions.get("window");
const API_URL = "https://cupadapp.name.ng/api/login.php";

const BIO_ENABLED_KEY = "cupad_biometric_enabled";
const BIO_USER_KEY = "cupad_biometric_user";
const BIO_TOKEN_KEY = "cupad_biometric_token";
const BIO_USERNAME_KEY = "cupad_biometric_username";
const BIO_PASSWORD_KEY = "cupad_biometric_password";
const BIO_TYPE_KEY = "cupad_biometric_type";
const LAST_PASSWORD_LOGIN_KEY = "cupad_last_password_login_at";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

type LocationData = {
  latitude: number;
  longitude: number;
  address: string;
  city?: string;
  region?: string;
};

function mapBioTypeToMethod(type: string): "fingerprint" | "face_id" | "biometric" {
  if (type === "Face ID" || type === "Face Unlock") return "face_id";
  if (type === "Fingerprint" || type === "Touch ID") return "fingerprint";
  return "biometric";
}

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
  const systemScheme = useColorScheme();
  const { colors, isDark, toggleTheme } = useTheme();

  // Auto detect and sync dark/light mode with system setting
  useEffect(() => {
    if (systemScheme) {
      const isSystemDark = systemScheme === "dark";
      if (isSystemDark !== isDark && typeof toggleTheme === "function") {
        toggleTheme();
      }
    }
  }, [systemScheme, isDark]);

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
  const [bioType, setBioType] = useState<"Fingerprint" | "Touch ID" | "Face ID" | "Face Unlock" | "Biometric">("Fingerprint");
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioExpired, setBioExpired] = useState(false);
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationPermission, setLocationPermission] = useState(false);
  const [showSettingsBtn, setShowSettingsBtn] = useState(false);

  // Custom Redirect / Web Access Modal
  const [comingSoonRole, setComingSoonRole] = useState<string | null>(null);
  const modalFadeAnim = useRef(new Animated.Value(0)).current;
  const modalScaleAnim = useRef(new Animated.Value(0.85)).current;

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

  const openComingSoonModal = (role?: string) => {
    setComingSoonRole(role || "Staff");
    modalFadeAnim.setValue(0);
    modalScaleAnim.setValue(0.85);
    Animated.parallel([
      Animated.timing(modalFadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.spring(modalScaleAnim, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true }),
    ]).start();
  };

  const closeComingSoonModal = () => {
    Animated.parallel([
      Animated.timing(modalFadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(modalScaleAnim, { toValue: 0.9, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setComingSoonRole(null);
    });
  };

  const handleOpenWebPortal = async () => {
    try {
      await Linking.openURL(WEB_PORTAL_URL);
    } catch {
      setError("Unable to open browser. Please visit " + WEB_PORTAL_URL);
    }
    closeComingSoonModal();
  };

  const triggerShake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  // STRICT LOCATION CAPTURE & REVERSE GEOCODING
  const ensureLocation = async (silent = false): Promise<LocationData | null> => {
    try {
      setLocationLoading(true);
      setShowSettingsBtn(false);

      let serviceEnabled = true;
      try {
        if (typeof Location.hasServicesEnabledAsync === "function") {
          serviceEnabled = await Location.hasServicesEnabledAsync();
        }
      } catch (svcErr) {
        console.log("Service check error", svcErr);
      }

      if (!serviceEnabled) {
        setLocationPermission(false);
        if (!silent) {
          setError("Your device GPS is turned OFF. Please turn on Location in device quick settings.");
          triggerShake();
        }
        return null;
      }

      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        perm = await Location.requestForegroundPermissionsAsync();
      }

      if (perm.status !== "granted") {
        setLocationPermission(false);
        if (!silent) {
          if (!perm.canAskAgain) {
            setError("Location permission is blocked. Tap below to enable it in App Settings.");
          } else {
            setError("Location access is compulsory for sign in. Please allow location access.");
          }
          setShowSettingsBtn(true);
          triggerShake();
        }
        return null;
      }

      setLocationPermission(true);

      let pos = await Location.getLastKnownPositionAsync({ maxAge: 60000 }).catch(() => null);

      if (!pos || !pos.coords) {
        try {
          const locationPromise = Location.getCurrentPositionAsync({
            accuracy: Platform.OS === "android" ? Location.Accuracy.Balanced : Location.Accuracy.High,
          });
          const timeoutPromise = new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error("GPS_TIMEOUT")), 7000)
          );

          pos = (await Promise.race([locationPromise, timeoutPromise])) as any;
        } catch {
          pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Lowest,
          }).catch(() => null);
        }
      }

      if (!pos || !pos.coords || pos.coords.latitude === undefined || pos.coords.longitude === undefined) {
        if (!silent) {
          setError("Unable to obtain GPS fix. Please ensure you have network/location signal.");
          triggerShake();
        }
        return null;
      }

      let address = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
      let city = "";
      let region = "";

      try {
        const rev = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (rev && rev[0]) {
          city = rev[0].city || rev[0].subregion || "";
          region = rev[0].region || "";
          address = [rev[0].name, rev[0].street, city, region, rev[0].country].filter(Boolean).join(", ");
        }
      } catch (geoErr) {
        console.log("Geocoding fallback:", geoErr);
      }

      const loc: LocationData = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        address,
        city,
        region,
      };

      setLocationData(loc);
      await AsyncStorage.setItem("cupad_last_location", JSON.stringify(loc));
      return loc;
    } catch (e: any) {
      if (!silent) {
        setError("Location error: " + (e?.message || "Please check device GPS."));
        triggerShake();
      }
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
        const bioEnabledSaved = (await AsyncStorage.getItem(BIO_ENABLED_KEY)) || (await AsyncStorage.getItem("cupad_bio_enabled"));
        if (bioEnabledSaved === "true") setBioEnabled(true);
        const bioUser = await AsyncStorage.getItem(BIO_USER_KEY);
        if (bioUser) {
          const u = JSON.parse(bioUser);
          if (u?.username && !savedUser) setUsername(u.username);
        }

        const lastPassLoginStr = await AsyncStorage.getItem(LAST_PASSWORD_LOGIN_KEY);
        if (lastPassLoginStr) {
          const lastPassLogin = parseInt(lastPassLoginStr, 10);
          if (Date.now() - lastPassLogin > FIVE_DAYS_MS) {
            setBioExpired(true);
          } else {
            setBioExpired(false);
          }
        } else if (bioEnabledSaved === "true") {
          setBioExpired(true);
        }

        const compatible = await LocalAuthentication.hasHardwareAsync();
        const enrolled = await LocalAuthentication.isEnrolledAsync();
        if (compatible && enrolled) {
          setBioAvailable(true);
          const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
          
          let detectedType: "Fingerprint" | "Touch ID" | "Face ID" | "Face Unlock" | "Biometric" = "Fingerprint";

          if (Platform.OS === "ios") {
            if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
              detectedType = "Face ID";
            } else if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
              detectedType = "Touch ID";
            } else {
              detectedType = "Biometric";
            }
          } else {
            if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) {
              detectedType = "Fingerprint";
            } else if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) {
              detectedType = "Face Unlock";
            } else {
              detectedType = "Biometric";
            }
          }

          setBioType(detectedType);
          await AsyncStorage.setItem(BIO_TYPE_KEY, detectedType);
        }

        ensureLocation(true);
      } finally {
        setCheckingAuth(false);
      }
    })();
  }, []);

  const openDeviceSettings = async () => {
    try {
      if (Platform.OS === "ios") {
        await Linking.openURL("app-settings:");
      } else {
        await Linking.openSettings();
      }
    } catch {
      setError("Please navigate to your device settings to enable location.");
    }
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
    await AsyncStorage.setItem("cupad_last_login_method", method);
    setBioEnabled(true);

    if (method === "password") {
      await AsyncStorage.setItem(LAST_PASSWORD_LOGIN_KEY, Date.now().toString());
      setBioExpired(false);
    }

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
    } catch (e) {
      console.log("DB save error", e);
    }
  };

  const handleLogin = async () => {
    if (!username.trim()) { setError("Please enter your username"); triggerShake(); return; }
    if (!password.trim()) { setError("Please enter your password"); triggerShake(); return; }
    setError("");

    // COMPULSORY GPS LOCATION CHECK
    let loc = locationData;
    if (!loc || !loc.latitude || !loc.longitude) {
      loc = await ensureLocation(false);
      if (!loc || !loc.latitude || !loc.longitude) {
        setError("GPS verification is compulsory before sign in. Please enable location.");
        triggerShake();
        return;
      }
    }

    setLoading(true);
    Animated.spring(buttonScale, { toValue: 0.96, useNativeDriver: true }).start();
    try {
      const res = await axios.post(
        API_URL,
        {
          username: username.trim(),
          password,
          action: "login",
          login_method: "password",
          location_status: "granted",
          latitude: loc.latitude,
          longitude: loc.longitude,
          location_address: loc.address,
          city: loc.city || "",
          region: loc.region || "",
        },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 }
      );
      const token = res.data.token || res.data.data?.token;
      const user = res.data.user || res.data.data?.user;

      if (res.data.success && token && user) {
        // NON-CO ROLES DIRECTED TO WEB PORTAL
        if (!isCORole(user?.role)) {
          openComingSoonModal(user?.role);
          return;
        }

        await saveSessionWithLastLogin(user, token, "password", password, loc);
        router.replace("/co/dashboard");
      } else {
        setError(res.data.message || "Invalid credentials");
        triggerShake();
      }
    } catch (err: any) {
      setError(err.response?.data?.message || "Unable to connect. Check internet connection.");
      triggerShake();
    } finally {
      setLoading(false);
      Animated.spring(buttonScale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
    }
  };

  const handleBiometricLogin = async () => {
    try {
      setError("");

      const lastPassLoginStr = await AsyncStorage.getItem(LAST_PASSWORD_LOGIN_KEY);
      if (!lastPassLoginStr || Date.now() - parseInt(lastPassLoginStr, 10) > FIVE_DAYS_MS) {
        setBioExpired(true);
        setError("For your security, password login is required every 5 days. Please log in with your password.");
        triggerShake();
        return;
      }

      // COMPULSORY GPS LOCATION CHECK
      let loc = locationData;
      if (!loc || !loc.latitude || !loc.longitude) {
        loc = await ensureLocation(false);
        if (!loc || !loc.latitude || !loc.longitude) {
          setError("GPS verification is compulsory before biometric sign in.");
          triggerShake();
          return;
        }
      }

      setBioLoading(true);
      Animated.spring(bioScale, { toValue: 0.96, useNativeDriver: true }).start();
      const compatible = await LocalAuthentication.hasHardwareAsync();
      if (!compatible) { setError("Biometric hardware not available"); triggerShake(); return; }
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!enrolled) { setError("No biometrics enrolled. Please set up in device settings"); triggerShake(); return; }

      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: `Login with ${bioType}`,
        cancelLabel: "Cancel",
        disableDeviceFallback: true,
      });

      if (!result.success) {
        if (result.error !== "user_cancel") { setError("Biometric authentication failed"); triggerShake(); }
        return;
      }

      let token = (await AsyncStorage.getItem(BIO_TOKEN_KEY)) || (await AsyncStorage.getItem("cupad_jwt")) || (await AsyncStorage.getItem("auth_token"));
      let userJson = (await AsyncStorage.getItem(BIO_USER_KEY)) || (await AsyncStorage.getItem("cupad_user")) || (await AsyncStorage.getItem("auth_user"));
      let savedUsername = await AsyncStorage.getItem(BIO_USERNAME_KEY);
      let savedPassword: string | null = null;
      try { savedPassword = await SecureStore.getItemAsync(BIO_PASSWORD_KEY); } catch {}
      if (!savedPassword) savedPassword = await AsyncStorage.getItem(BIO_PASSWORD_KEY);

      if (!userJson || !savedUsername) {
        setError("No saved biometric session. Please login with password once to enable biometric login.");
        triggerShake();
        return;
      }

      let user: any;
      try { user = JSON.parse(userJson); } catch { user = null; }
      if (!user) { setError("Invalid saved session. Please login again"); triggerShake(); return; }

      const method = mapBioTypeToMethod(bioType);

      if (savedPassword && savedUsername) {
        try {
          const res = await axios.post(
            API_URL,
            {
              username: savedUsername,
              password: savedPassword,
              action: "login",
              login_method: method,
              location_status: "granted",
              latitude: loc.latitude,
              longitude: loc.longitude,
              location_address: loc.address,
              city: loc.city || "",
              region: loc.region || "",
            },
            { timeout: 10000 }
          );
          const newToken = res.data.token || res.data.data?.token;
          const newUser = res.data.user || res.data.data?.user;

          if (res.data.success && newToken && newUser) {
            if (!isCORole(newUser?.role)) {
              openComingSoonModal(newUser?.role);
              return;
            }

            await saveSessionWithLastLogin(newUser, newToken, method, savedPassword, loc);
            router.replace("/co/dashboard");
            return;
          }
        } catch (e) {
          console.log("Biometric API login fallback", e);
        }
      }

      if (token && user) {
        if (!isCORole(user?.role)) {
          openComingSoonModal(user?.role);
          return;
        }

        await saveSessionWithLastLogin(user, token, method, savedPassword || undefined, loc);
        router.replace("/co/dashboard");
        return;
      }

      setError("Biometric session expired. Please login with password.");
      triggerShake();
    } catch (e: any) {
      setError("Biometric login failed");
      triggerShake();
    } finally {
      setBioLoading(false);
      Animated.spring(bioScale, { toValue: 1, friction: 5, useNativeDriver: true }).start();
    }
  };

  if (checkingAuth) {
    return <View style={[styles.center, { backgroundColor: colors.background }]}><ActivityIndicator size="small" color={colors.primary} /></View>;
  }

  const orb1 = isDark ? "rgba(22,119,255,0.18)" : "rgba(22,119,255,0.12)";
  const orb2 = isDark ? "rgba(118,183,255,0.15)" : "rgba(118,183,255,0.10)";
  const orb3 = isDark ? "rgba(22,119,255,0.10)" : "rgba(22,119,255,0.08)";
  const roleMeta = getRoleMeta(comingSoonRole || undefined);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Orb size={220} color={orb1} left={-60} top={-40} delay={0} />
        <Orb size={180} color={orb2} left={width - 120} top={120} delay={800} />
        <Orb size={260} color={orb3} left={width * 0.3} top={height * 0.45} delay={1600} />
        {PARTICLES.map((p, i) => <Particle key={i} particle={p} isDark={isDark} />)}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.centeredWrapper}>
            <Animated.View style={[styles.mainContent, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
              
              <View style={styles.secureBadgeRow}>
                <View style={[styles.secureBadge, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
                  <View style={[styles.dot, { backgroundColor: locationPermission && locationData ? "#22c55e" : "#ef4444" }]} />
                  <Text style={[styles.secureText, { color: colors.textMuted }]}>
                    {locationPermission && locationData ? "GPS Verified" : "Location Compulsory"}
                  </Text>
                  {locationPermission && locationData && (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 6 }}>
                      <Ionicons name="location" size={10} color="#22c55e" />
                      <Text style={[styles.secureText, { color: "#22c55e", fontSize: 10 }]} numberOfLines={1}>{locationData.city || "Active"}</Text>
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
                  
                  <Pressable 
                    onPress={() => ensureLocation(false)} 
                    style={[
                      styles.locationBadge, 
                      { 
                        backgroundColor: colors.card, 
                        borderColor: locationPermission && locationData ? colors.cardBorder : "#ef4444" 
                      }
                    ]}
                  >
                    <Ionicons 
                      name={locationLoading ? "sync" : locationPermission && locationData ? "location" : "alert-circle"} 
                      size={13} 
                      color={locationPermission && locationData ? colors.primary : "#ef4444"} 
                    />
                    <Text style={[styles.locationText, { color: locationPermission && locationData ? colors.textMuted : "#ef4444" }]} numberOfLines={1}>
                      {locationLoading 
                        ? "Verifying GPS location..." 
                        : locationData?.address 
                          ? locationData.address.slice(0, 45) 
                          : "Location required. Tap to enable GPS"}
                    </Text>
                  </Pressable>
                </View>

                {error ? (
                  <View style={[styles.errorBox, { backgroundColor: isDark ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.08)", borderColor: "rgba(239,68,68,0.25)" }]}>
                    <View style={[styles.errorIcon, { backgroundColor: "#ef4444" }]}><Ionicons name="alert" size={12} color="#fff" /></View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[styles.errorText, { color: "#ef4444" }]}>{error}</Text>
                      {showSettingsBtn && (
                        <Pressable onPress={openDeviceSettings} style={styles.settingsActionBtn}>
                          <Text style={styles.settingsActionText}>Open Device Settings</Text>
                          <Ionicons name="open-outline" size={13} color="#ef4444" />
                        </Pressable>
                      )}
                    </View>
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
                    <Text style={[styles.rememberText, { color: colors.textMuted }]}>Remember me & enable biometric login</Text>
                  </Pressable>

                  <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
                    <Pressable style={[styles.loginBtn, { backgroundColor: colors.primary, opacity: (loading || locationLoading) ? 0.85 : 1 }]} onPress={handleLogin} disabled={loading || locationLoading}>
                      {loading || locationLoading ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Text style={styles.loginBtnText}>Sign in</Text>
                          <View style={styles.loginBtnIcon}>
                            <Ionicons name="arrow-forward" size={18} color="#fff" />
                          </View>
                        </>
                      )}
                    </Pressable>
                  </Animated.View>

                  <View style={styles.dividerRow}><View style={[styles.divider, { backgroundColor: colors.cardBorder }]} /><Text style={[styles.dividerText, { color: colors.textMuted }]}>or continue with</Text><View style={[styles.divider, { backgroundColor: colors.cardBorder }]} /></View>

                  <Animated.View style={{ transform: [{ scale: bioScale }] }}>
                    <Pressable 
                      style={[
                        styles.bioBtn, 
                        { 
                          backgroundColor: colors.card, 
                          borderColor: bioEnabled && !bioExpired ? colors.primary : colors.cardBorder, 
                          borderWidth: bioEnabled && !bioExpired ? 1.5 : 1, 
                          opacity: bioLoading ? 0.8 : bioExpired ? 0.65 : 1 
                        }
                      ]} 
                      onPress={handleBiometricLogin} 
                      disabled={bioLoading || locationLoading}
                    >
                      <View style={[styles.bioIconWrap, { backgroundColor: isDark ? "rgba(22,119,255,0.15)" : "rgba(22,119,255,0.10)" }]}>
                        {bioLoading ? (
                          <ActivityIndicator size="small" color={colors.primary} />
                        ) : (
                          <Ionicons 
                            name={bioType === "Face ID" || bioType === "Face Unlock" ? "scan" : "finger-print"} 
                            size={22} 
                            color={bioExpired ? "#ef4444" : colors.primary} 
                          />
                        )}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.bioTitle, { color: colors.text }]}>
                          {bioType} Login {bioEnabled && !bioExpired ? "✓" : ""}
                        </Text>
                        <Text style={[styles.bioSub, { color: bioExpired ? "#ef4444" : colors.textMuted }]}>
                          {bioExpired
                            ? "Expired: Password login required every 5 days"
                            : !bioEnabled
                              ? "Login once with password to enable"
                              : `Use ${bioType} to login (GPS Required)`}
                        </Text>
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
              <View style={styles.trustItem}>
                <Ionicons name="location" size={14} color={locationPermission && locationData ? "#22c55e" : "#ef4444"} />
                <Text style={[styles.trustText, { color: locationPermission && locationData ? "#22c55e" : "#ef4444" }]}>
                  {locationPermission && locationData ? "GPS Verified" : "GPS Compulsory"}
                </Text>
              </View>
            </View>
            <Text style={[styles.version, { color: colors.textMuted }]}>CUPAD v2.0.0 • Auto Detection Mode</Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>

      {/* WEB REDIRECT / ROLE RESTRICTION MODAL */}
      <Modal
        visible={!!comingSoonRole}
        transparent={true}
        animationType="none"
        onRequestClose={closeComingSoonModal}
      >
        <Animated.View style={[styles.modalOverlay, { opacity: modalFadeAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeComingSoonModal} />
          
          <Animated.View 
            style={[
              styles.modalCard, 
              { 
                backgroundColor: colors.card, 
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(22,119,255,0.15)",
                transform: [{ scale: modalScaleAnim }] 
              }
            ]}
          >
            <Pressable onPress={closeComingSoonModal} hitSlop={10} style={styles.modalCloseBtn}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>

            <View style={styles.modalIconCenter}>
              <View style={[styles.modalIconOuter, { backgroundColor: isDark ? "rgba(22,119,255,0.15)" : "rgba(22,119,255,0.08)" }]}>
                <View style={[styles.modalIconInner, { backgroundColor: colors.primary }]}>
                  <Ionicons name="globe-outline" size={32} color="#fff" />
                </View>
              </View>
            </View>

            <View style={styles.statusPillRow}>
              <View style={[styles.statusPill, { backgroundColor: isDark ? "rgba(22,119,255,0.18)" : "rgba(22,119,255,0.10)" }]}>
                <Ionicons name="open-outline" size={12} color={colors.primary} />
                <Text style={[styles.statusPillText, { color: colors.primary }]}>WEB PORTAL ACCESS ONLY</Text>
              </View>
            </View>

            <Text style={[styles.modalTitle, { color: colors.text }]}>Redirect to Web Portal</Text>

            <View style={styles.roleChipRow}>
              <View style={[styles.roleChip, { backgroundColor: isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)" }]}>
                <Ionicons name={roleMeta.icon} size={15} color={colors.primary} />
                <Text style={[styles.roleChipText, { color: colors.text }]}>
                  {roleMeta.name} <Text style={{ color: colors.primary, fontWeight: "800" }}>({roleMeta.tag})</Text>
                </Text>
              </View>
            </View>

            <Text style={[styles.modalDescription, { color: colors.textMuted }]}>
              The mobile application is currently provisioned exclusively for{" "}
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Collection Officers (CO)</Text>.
              {"\n\n"}
              To access administration, branch operations, and full management tools for your role, please log in via our official web portal.
            </Text>

            <Pressable 
              onPress={handleOpenWebPortal} 
              style={[styles.webUrlPill, { backgroundColor: isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.03)", borderColor: colors.cardBorder }]}
            >
              <Ionicons name="link" size={15} color={colors.primary} />
              <Text style={[styles.webUrlText, { color: colors.primary }]}>cupadapp.name.ng</Text>
              <Ionicons name="open-outline" size={14} color={colors.textMuted} />
            </Pressable>

            <View style={styles.modalActionGroup}>
              <Pressable 
                style={[styles.modalPrimaryBtn, { backgroundColor: colors.primary }]}
                onPress={handleOpenWebPortal}
              >
                <Ionicons name="globe" size={17} color="#fff" />
                <Text style={styles.modalPrimaryBtnText}>Open Web Portal</Text>
              </Pressable>

              <Pressable 
                style={[styles.modalSecondaryBtn, { borderColor: colors.cardBorder }]}
                onPress={closeComingSoonModal}
              >
                <Text style={[styles.modalSecondaryBtnText, { color: colors.textMuted }]}>Back to Login</Text>
              </Pressable>
            </View>

          </Animated.View>
        </Animated.View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 50, paddingBottom: 0, minHeight: height, justifyContent: "space-between" },
  centeredWrapper: { flex: 1, justifyContent: "center", alignItems: "center", width: "100%" },
  mainContent: { width: "100%", maxWidth: 400, justifyContent: "center", alignSelf: "center" },
  bottomFooter: { paddingTop: 24, paddingBottom: Platform.OS === "ios" ? 34 : 24, alignItems: "center", marginTop: 20, width: "100%" },
  secureBadgeRow: { alignItems: "center", marginBottom: 20 },
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
  locationText: { fontSize: 10, fontWeight: "600", flexShrink: 1 },
  errorBox: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, gap: 10, marginBottom: 18 },
  errorIcon: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  errorText: { fontSize: 12.5, fontWeight: "600", lineHeight: 16 },
  settingsActionBtn: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 },
  settingsActionText: { fontSize: 12, fontWeight: "700", color: "#ef4444", textDecorationLine: "underline" },
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

  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 24,
    borderWidth: 1.5,
    padding: 24,
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 12,
  },
  modalCloseBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    padding: 6,
    zIndex: 10,
  },
  modalIconCenter: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    marginBottom: 14,
  },
  modalIconOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  modalIconInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#1677FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  statusPillRow: {
    marginBottom: 10,
  },
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
  },
  statusPillText: {
    fontSize: 10.5,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.3,
  },
  roleChipRow: {
    marginTop: 8,
    marginBottom: 12,
  },
  roleChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
  },
  roleChipText: {
    fontSize: 12.5,
    fontWeight: "600",
  },
  modalDescription: {
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  webUrlPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 20,
  },
  webUrlText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  modalActionGroup: {
    width: "100%",
    gap: 10,
  },
  modalPrimaryBtn: {
    width: "100%",
    height: 50,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    shadowColor: "#1677FF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  modalPrimaryBtnText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "700",
  },
  modalSecondaryBtn: {
    width: "100%",
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSecondaryBtnText: {
    fontSize: 13.5,
    fontWeight: "600",
  },
});