import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import axios from "axios";

const API_LOGOUT = "https://cupadapp.name.ng/api/logout.php";

// Keys that MUST survive logout - fingerprint needs these
const KEEP_KEYS = [
  "cupad_remember_user",
  "cupad_remember",
  "cupad_bio_enabled",
  "cupad_biometric_enabled",
  "cupad_biometric_user",
  "cupad_biometric_token",
  "cupad_biometric_username",
  "cupad_biometric_password",
  "cupad_last_login",
  "cupad_last_login_timestamp",
];

export async function terminateSession() {
  try {
    // 1. Try to notify server (fire and forget)
    const token =
      (await SecureStore.getItemAsync("cupad_jwt").catch(() => null)) ||
      (await AsyncStorage.getItem("cupad_token")) ||
      (await AsyncStorage.getItem("auth_token")) ||
      (await AsyncStorage.getItem("cupad_jwt"));

    if (token) {
      await axios.post(API_LOGOUT, { action: "logout" }, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      }).catch(() => {});
    }
  } catch {}

  try {
    // 2. Save what we must keep
    const keepValues: Record<string, string | null> = {};
    for (const k of KEEP_KEYS) {
      keepValues[k] = await AsyncStorage.getItem(k);
    }
    let secureBioPass: string | null = null;
    try { secureBioPass = await SecureStore.getItemAsync("cupad_biometric_password"); } catch {}

    // 3. Only delete session keys, NOT biometric keys
    const SESSION_KEYS = [
      "cupad_jwt","cupad_user","cupad_role","cupad_token",
      "auth_token","auth_user"
    ];
    await AsyncStorage.multiRemove(SESSION_KEYS);

    // 4. Restore kept values
    for (const [k, v] of Object.entries(keepValues)) {
      if (v !== null) await AsyncStorage.setItem(k, v);
    }
    if (secureBioPass) {
      try { await SecureStore.setItemAsync("cupad_biometric_password", secureBioPass); } catch {}
    }

    // 5. Clear SecureStore session only (keep biometric password)
    await SecureStore.deleteItemAsync("cupad_jwt").catch(()=>{});
    await SecureStore.deleteItemAsync("cupad_user").catch(()=>{});
    await SecureStore.deleteItemAsync("auth_token").catch(()=>{});

    // 6. Update local DB is_online = 0
    try {
      const { saveLogout } = await import("../db/database");
      const userStr = keepValues["cupad_biometric_user"] || await AsyncStorage.getItem("cupad_biometric_user");
      if (userStr) {
        const u = JSON.parse(userStr);
        await saveLogout(u.username || u.user_name);
      } else {
        const remUser = keepValues["cupad_remember_user"];
        if (remUser) await saveLogout(remUser);
      }
    } catch {}

    console.log("[terminateSession] Session cleared, biometric kept");
  } catch (e) {
    console.log("terminateSession error", e);
    // Fallback minimal delete
    await AsyncStorage.multiRemove(["cupad_jwt","cupad_user","cupad_role","cupad_token","auth_token","auth_user"]).catch(()=>{});
  }
}

export async function fullWipeSession() {
  // Only call when user wants to disable fingerprint completely
  await AsyncStorage.clear();
  try { 
    await SecureStore.deleteItemAsync("cupad_jwt"); 
    await SecureStore.deleteItemAsync("cupad_user");
    await SecureStore.deleteItemAsync("auth_token");
    await SecureStore.deleteItemAsync("cupad_biometric_password");
  } catch {}
}
