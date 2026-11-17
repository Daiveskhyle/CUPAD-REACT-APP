// src/utils/logout.ts - FIXED LOGOUT THAT KEEPS BIOMETRIC
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from 'expo-secure-store';
import axios from "axios";

const API_LOGOUT = "https://cupadapp.name.ng/api/logout.php";

// Keys that SHOULD BE KEPT after logout for biometric to work
const KEEP_AFTER_LOGOUT = [
  "cupad_remember_user",
  "cupad_biometric_enabled",
  "cupad_biometric_user",
  "cupad_biometric_token",
  "cupad_biometric_username",
  "cupad_last_login",
  "cupad_biometric_password", // fallback if SecureStore fails
];

export const logout = async (userId?: string | number) => {
  // 1. Tell server we are offline
  try {
    if (userId) {
      await axios.post(API_LOGOUT, { user_id: userId, action: "logout" }, { timeout: 3000 });
    }
  } catch {}

  // 2. Get values to keep
  const keepValues: Record<string, string | null> = {};
  for (const key of KEEP_AFTER_LOGOUT) {
    keepValues[key] = await AsyncStorage.getItem(key);
  }

  // 3. Get all keys and delete everything EXCEPT keep list
  const allKeys = await AsyncStorage.getAllKeys();
  const keysToDelete = allKeys.filter(k => !KEEP_AFTER_LOGOUT.includes(k) && !k.startsWith("cupad_biometric_") && !k.startsWith("cupad_last_") && k !== "cupad_remember_user");
  // Also include common auth keys explicitly
  const authKeys = ["auth_token", "auth_user", "cupad_jwt", "cupad_user", "cupad_role", "cupad_token"];
  const finalDelete = [...new Set([...keysToDelete, ...authKeys])];

  await AsyncStorage.multiRemove(finalDelete);

  // 4. Restore kept values (in case multiRemove removed them)
  for (const [k, v] of Object.entries(keepValues)) {
    if (v !== null) await AsyncStorage.setItem(k, v);
  }

  // 5. Update local SQLite is_online = 0, last_logout = now
  try {
    const { saveLogout } = await import("../db/database");
    const bioUser = await AsyncStorage.getItem("cupad_biometric_user");
    if (bioUser) {
      const u = JSON.parse(bioUser);
      await saveLogout(u.username);
    }
  } catch {}

  console.log("[Logout] Done, biometric data kept");
};

export const fullLogoutAndClearBiometric = async () => {
  // Use this only if user explicitly says "Logout and forget fingerprint"
  await AsyncStorage.clear();
  try { await SecureStore.deleteItemAsync("cupad_biometric_password"); } catch {}
  try {
    const { getDb } = await import("../db/database");
    const db = await getDb();
    await db.runAsync(`UPDATE users SET is_online = 0, last_logout = ?, updated_at = ?`, [new Date().toISOString(), new Date().toISOString()]);
  } catch {}
};
