import AsyncStorage from "@react-native-async-storage/async-storage";

export interface CupadUser {
  id: number;
  username: string;
  role: string;
  full_name: string;
  branch_id?: number;
  branch_name?: string;
}

export async function saveLoginSession(
  token: string,
  user: CupadUser
) {
  await AsyncStorage.multiSet([
    ["cupad_jwt", token],
    ["cupad_user", JSON.stringify(user)],
    ["cupad_role", user.role],
    ["cupad_last_login", JSON.stringify(user)],
  ]);
}

export async function getLastLoginUser(): Promise<CupadUser | null> {
  const value = await AsyncStorage.getItem("cupad_last_login");

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function getCurrentUser(): Promise<CupadUser | null> {
  const value = await AsyncStorage.getItem("cupad_user");

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function logout() {
  await AsyncStorage.multiRemove([
    "cupad_jwt",
    "cupad_user",
    "cupad_role",
  ]);

  // cupad_last_login intentionally remains.
}

export async function clearLastLogin() {
  await AsyncStorage.removeItem("cupad_last_login");
}