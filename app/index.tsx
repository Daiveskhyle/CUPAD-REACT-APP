import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Image, StyleSheet, Text, View, Easing, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { router } from "expo-router";
import { useTheme } from "../src/theme/ThemeContext";
import { Ionicons } from "@expo/vector-icons";

const { width, height } = Dimensions.get("window");

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
    default: return "/login";
  }
}

function Orb({ size, color, left, top, delay = 0 }: any) {
  const translateY = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(Animated.sequence([Animated.delay(delay), Animated.parallel([Animated.timing(translateY, { toValue: -20, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(scale, { toValue: 1.15, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true })]), Animated.parallel([Animated.timing(translateY, { toValue: 0, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(scale, { toValue: 1, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: true })])]));
    anim.start(); return () => anim.stop();
  }, []);
  return <Animated.View style={{ position: "absolute", left, top, width: size, height: size, borderRadius: size / 2, backgroundColor: color, opacity: 0.5, transform: [{ translateY }, { scale }] }} />;
}

const PARTICLES = Array.from({ length: 18 }, () => ({ x: Math.random()*width, y: Math.random()*height, size: Math.random()*4+2, opacity: Math.random()*0.4+0.15, duration: Math.random()*4000+4000, delay: Math.random()*2000 }));
function Particle({ particle, isDark }: any) {
  const translateY = useRef(new Animated.Value(0)).current; const translateX = useRef(new Animated.Value(0)).current; const scale = useRef(new Animated.Value(1)).current; const opacity = useRef(new Animated.Value(particle.opacity)).current;
  useEffect(() => { const v = Animated.loop(Animated.sequence([Animated.delay(particle.delay), Animated.timing(translateY, { toValue: -60, duration: particle.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(translateY, { toValue: 0, duration: particle.duration, easing: Easing.inOut(Easing.sin), useNativeDriver: true })])); const h = Animated.loop(Animated.sequence([Animated.timing(translateX, { toValue: 25, duration: particle.duration*0.9, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(translateX, { toValue: -25, duration: particle.duration*0.9, easing: Easing.inOut(Easing.sin), useNativeDriver: true })])); const p = Animated.loop(Animated.sequence([Animated.timing(scale, { toValue: 1.6, duration: particle.duration*0.5, useNativeDriver: true }), Animated.timing(scale, { toValue: 0.8, duration: particle.duration*0.5, useNativeDriver: true })])); const f = Animated.loop(Animated.sequence([Animated.timing(opacity, { toValue: particle.opacity*1.6, duration: particle.duration*0.5, useNativeDriver: true }), Animated.timing(opacity, { toValue: particle.opacity*0.4, duration: particle.duration*0.5, useNativeDriver: true })])); v.start(); h.start(); p.start(); f.start(); return () => { v.stop(); h.stop(); p.stop(); f.stop(); }; }, []);
  return <Animated.View style={{ position: "absolute", left: particle.x, top: particle.y, width: particle.size, height: particle.size, borderRadius: particle.size/2, backgroundColor: isDark?"#76B7FF":"#1677FF", opacity, transform: [{ translateX }, { translateY }, { scale }] }} />;
}

export default function Index() {
  const { colors, isDark } = useTheme();
  const [status, setStatus] = useState<"checking"|"welcome"|"redirecting">("checking");
  const [userName, setUserName] = useState("");
  const [isRouteReady, setIsRouteReady] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current; const slideAnim = useRef(new Animated.Value(30)).current; const logoScale = useRef(new Animated.Value(0.8)).current; const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([Animated.timing(fadeAnim, { toValue: 1, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }), Animated.timing(slideAnim, { toValue: 0, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: true }), Animated.spring(logoScale, { toValue: 1, friction: 6, tension: 80, useNativeDriver: true })]).start();
    Animated.loop(Animated.sequence([Animated.timing(pulseAnim, { toValue: 1.2, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }), Animated.timing(pulseAnim, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.sin), useNativeDriver: true })])).start();
  }, []);

  useEffect(() => {
    let mounted = true;
    const checkAuth = async () => {
      try {
        const token = (await SecureStore.getItemAsync("cupad_jwt")) || (await AsyncStorage.getItem("auth_token")) || (await AsyncStorage.getItem("cupad_token")) || (await AsyncStorage.getItem("cupad_jwt"));
        const userJson = (await SecureStore.getItemAsync("cupad_user")) || (await AsyncStorage.getItem("auth_user")) || (await AsyncStorage.getItem("cupad_user"));
        let role = normalizeRole(await AsyncStorage.getItem("cupad_role"));
        let parsedUser: any = null;
        if (userJson) {
          try {
            parsedUser = JSON.parse(userJson);
            if (!role) role = normalizeRole(parsedUser.role || parsedUser.user_role || "");
            if (mounted) setUserName(parsedUser.full_name?.split(" ")[0] || "");
          } catch {}
        }
        if (mounted) {
          if (token && (role || parsedUser)) {
            const nextRoute = getRoleRoute(role || parsedUser?.role);
            if (nextRoute && nextRoute !== "/login") {
              setIsRouteReady(true);
              router.replace(nextRoute as any);
              return;
            }
            setStatus("welcome");
          } else {
            setStatus("redirecting");
            setTimeout(() => { if (mounted) router.replace("/login" as any); }, 200);
          }
        }
      } catch { if (mounted) { setStatus("redirecting"); setTimeout(() => { if (mounted) router.replace("/login" as any); }, 800); } }
    };
    checkAuth(); return () => { mounted = false; };
  }, []);

  if (isRouteReady) return null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}><Orb size={280} color={isDark?"rgba(22,119,255,0.18)":"rgba(22,119,255,0.12)"} left={-80} top={-60} /><Orb size={220} color={isDark?"rgba(76,217,100,0.12)":"rgba(76,217,100,0.10)"} left={width-120} top={height*0.15} delay={800} /><Orb size={180} color={isDark?"rgba(255,204,0,0.08)":"rgba(255,204,0,0.08)"} left={width*0.3} top={height-180} delay={1500} />{PARTICLES.map((p,i)=><Particle key={`p-${i}`} particle={p} isDark={isDark} />)}</View>
      <View style={styles.content}>
        <Animated.View style={[styles.logoSection, { opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale: logoScale }] }]}><View style={styles.logoWrapper}><View style={[styles.logoRing, { borderColor: isDark?"rgba(22,119,255,0.15)":"rgba(22,119,255,0.12)" }]} /><View style={[styles.logoRing2, { borderColor: isDark?"rgba(22,119,255,0.08)":"rgba(22,119,255,0.06)" }]} /><Image source={require("../assets/cupad logo.png")} style={styles.logoImage} resizeMode="contain" /></View><Text style={[styles.brand, { color: colors.brand }]}>CUPAD</Text><Text style={[styles.brandSub, { color: colors.brandSub }]}>Empowerment Initiative</Text></Animated.View>
        <Animated.View style={[styles.welcomeCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
          {status==="checking" && <><View style={[styles.iconCircle, { backgroundColor: isDark?"rgba(22,119,255,0.15)":"rgba(22,119,255,0.10)" }]}><Animated.View style={{ transform: [{ scale: pulseAnim }] }}><Ionicons name="shield-checkmark" size={32} color={colors.primary} /></Animated.View></View><Text style={[styles.welcomeTitle, { color: colors.text }]}>Checking session</Text><Text style={[styles.welcomeSub, { color: colors.textSecondary }]}>Please wait</Text></>}
          {status==="welcome" && <><View style={[styles.iconCircle, { backgroundColor: isDark?"rgba(76,217,100,0.15)":"rgba(76,217,100,0.12)" }]}><Ionicons name="checkmark-circle" size={36} color={colors.successText} /></View><Text style={[styles.welcomeTitle, { color: colors.text }]}>Welcome back{userName?`, ${userName}`:""}!</Text><Text style={[styles.welcomeSub, { color: colors.textSecondary }]}>Redirecting to dashboard</Text></>}
          {status==="redirecting" && <><View style={[styles.iconCircle, { backgroundColor: isDark?"rgba(22,119,255,0.15)":"rgba(22,119,255,0.10)" }]}><Ionicons name="log-in-outline" size={32} color={colors.primary} /></View><Text style={[styles.welcomeTitle, { color: colors.text }]}>Session expired</Text><Text style={[styles.welcomeSub, { color: colors.textSecondary }]}>Taking you to login</Text></>}
        </Animated.View>
        <Animated.View style={[styles.bottomFooter, { opacity: fadeAnim }]}><Text style={[styles.version, { color: colors.textMuted }]}>CUPAD v2.0.0 • {isDark?"Dark":"Light"} Mode</Text></Animated.View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1 }, content: { flex: 1, paddingHorizontal: 20, paddingTop: 60, justifyContent: "space-between" }, logoSection: { alignItems: "center", marginTop: 40, marginBottom: 16 }, logoWrapper: { width: 110, height: 110, alignItems: "center", justifyContent: "center", marginBottom: 14 }, logoImage: { width: 88, height: 88, borderRadius: 20 }, logoRing: { position: "absolute", width: 100, height: 100, borderRadius: 50, borderWidth: 1 }, logoRing2: { position: "absolute", width: 120, height: 120, borderRadius: 60, borderWidth: 1 }, brand: { fontSize: 28, fontWeight: "900", letterSpacing: 5 }, brandSub: { fontSize: 12, fontWeight: "700", letterSpacing: 1.5, marginTop: 4, textTransform: "uppercase" }, welcomeCard: { alignItems: "center", paddingVertical: 30, paddingHorizontal: 20, gap: 8 }, iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", marginBottom: 16 }, welcomeTitle: { fontSize: 22, fontWeight: "800", textAlign: "center" }, welcomeSub: { fontSize: 14, fontWeight: "500", textAlign: "center", marginTop: 4 }, bottomFooter: { paddingTop: 24, paddingBottom: Platform.OS==="ios"?34:20, alignItems: "center", marginTop: 20 }, version: { textAlign: "center", marginTop: 14, fontSize: 10, fontWeight: "500" },
});