/**
 * Web fallback for offline DB - uses AsyncStorage instead of SQLite.
 * expo-sqlite is not available on web; this provides compatible stubs
 * so imports never crash.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const PREFIX = "cupad_webdb_";

async function getJSON<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(PREFIX + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

async function setJSON(key: string, value: any): Promise<void> {
  await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
}

/** Minimal mock that satisfies getDb() consumers on web */
class WebDbStub {
  async getFirstAsync(sql: string, _params?: any[]): Promise<any> {
    if (sql.includes("login_history")) return null;
    if (sql.includes("COUNT")) return { c: 0 };
    if (sql.includes("users")) {
      const users = await getJSON<any[]>("users", []);
      return users[0] || null;
    }
    return null;
  }

  async getAllAsync(sql: string, _params?: any[]): Promise<any[]> {
    if (sql.includes("login_history")) return getJSON("login_history", []);
    if (sql.includes("clients")) return getJSON("clients", []);
    if (sql.includes("FROM loans") || sql.includes("FROM disbursements"))
      return getJSON("disbursements", []);
    if (sql.includes("loan_collections")) return getJSON("loan_collections", []);
    if (sql.includes("savings")) return getJSON("savings", []);
    if (sql.includes("registrations")) return getJSON("registrations", []);
    if (sql.includes("unions")) return getJSON("unions", []);
    if (sql.includes("sync_queue")) return getJSON("sync_queue", []);
    return [];
  }

  async runAsync(sql: string, params?: any[]): Promise<void> {
    // Best-effort append for common writes
    if (sql.includes("INSERT INTO login_history")) {
      const hist = await getJSON<any[]>("login_history", []);
      hist.unshift({
        username: params?.[0],
        login_method: params?.[1],
        login_time: params?.[2],
        device_info: params?.[3],
      });
      await setJSON("login_history", hist.slice(0, 20));
    }
    if (sql.includes("INSERT INTO sync_queue")) {
      const q = await getJSON<any[]>("sync_queue", []);
      q.push({
        type: params?.[0],
        data: params?.[1],
        synced: 0,
        created_at: params?.[2],
      });
      await setJSON("sync_queue", q);
    }
  }

  async execAsync(_sql: string): Promise<void> {}
  async withTransactionAsync(fn: () => Promise<void>): Promise<void> {
    await fn();
  }
}

let _stub: WebDbStub | null = null;

export async function getDb(): Promise<WebDbStub> {
  if (!_stub) _stub = new WebDbStub();
  return _stub;
}

export async function getLoginHistory(username: string, limit = 5): Promise<any[]> {
  const hist = await getJSON<any[]>("login_history", []);
  return hist.filter((h) => h.username === username).slice(0, limit);
}

export async function upsertUser(user: any): Promise<void> {
  if (!user?.username) return;
  const users = await getJSON<any[]>("users", []);
  const idx = users.findIndex((u) => u.username === user.username);
  if (idx >= 0) users[idx] = { ...users[idx], ...user };
  else users.push(user);
  await setJSON("users", users);
}

export async function recordLogin(username: string, method = "password"): Promise<void> {
  const hist = await getJSON<any[]>("login_history", []);
  hist.unshift({
    username,
    login_method: method,
    login_time: new Date().toISOString(),
    device_info: "web",
  });
  await setJSON("login_history", hist.slice(0, 20));
}

export async function cacheClients(clients: any[]): Promise<void> {
  if (Array.isArray(clients)) await setJSON("clients", clients);
}

export async function loadCachedClients(): Promise<any[]> {
  return getJSON("clients", []);
}

export async function cacheUnions(unions: any[]): Promise<void> {
  if (Array.isArray(unions)) await setJSON("unions", unions);
}

export async function loadCachedUnions(): Promise<any[]> {
  return getJSON("unions", []);
}

export async function cacheDisbursements(disbursements: any[]): Promise<void> {
  if (Array.isArray(disbursements)) await setJSON("disbursements", disbursements);
}

export async function loadCachedDisbursements(): Promise<any[]> {
  return getJSON("disbursements", []);
}

export async function loadOfflineWorkspace(_username?: string): Promise<{
  clients: any[];
  unions: any[];
  unionNames: string[];
  disbursements: any[];
  loans: any[];
}> {
  const clients = await loadCachedClients();
  const unions = await loadCachedUnions();
  const disbursements = await loadCachedDisbursements();
  const unionNames = Array.from(
    new Set([
      ...unions.map((u: any) => (typeof u === "string" ? u : u?.name)).filter(Boolean),
      ...clients.map((c: any) => c.union || c.union_name).filter(Boolean),
    ])
  ) as string[];
  return { clients, unions, unionNames, disbursements, loans: disbursements };
}


export async function cacheRepaymentDataLocally(
  clients: any[],
  disbursements: any[]
): Promise<void> {
  await cacheClients(clients);
  await cacheDisbursements(disbursements);
}

export async function loadCachedRepayments(): Promise<{
  clients: any[];
  disbursements: any[];
}> {
  return {
    clients: await loadCachedClients(),
    disbursements: await loadCachedDisbursements(),
  };
}

export async function saveRepaymentOffline(payload: any): Promise<void> {
  const list = await getJSON<any[]>("loan_collections", []);
  list.push({ ...payload, synced: 0, created_at: new Date().toISOString() });
  await setJSON("loan_collections", list);
}

export async function getPendingRepaymentsCount(): Promise<number> {
  const list = await getJSON<any[]>("loan_collections", []);
  return list.filter((i) => !i.synced).length;
}

export async function processRepaymentPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  // On web we rely on network; clear queue optimistically if online attempt fails silently
  return { syncedCount: 0, failedCount: 0 };
}

export async function clearStuckPendingRepayments(): Promise<void> {
  const list = await getJSON<any[]>("loan_collections", []);
  await setJSON(
    "loan_collections",
    list.filter((i) => i.synced || (i.attempts || 0) < 10)
  );
}

export async function saveSavingsOffline(payload: any): Promise<void> {
  const list = await getJSON<any[]>("savings", []);
  list.push({ ...payload, synced: 0, is_offline: 1 });
  await setJSON("savings", list);
}

export async function getPendingSavingsCount(): Promise<number> {
  const list = await getJSON<any[]>("savings", []);
  return list.filter((i) => !i.synced).length;
}

export async function processSavingsPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  return { syncedCount: 0, failedCount: 0 };
}

export async function saveRegistrationOffline(payload: any): Promise<string> {
  const tempId = payload.temp_id || `REG-OFF-${Date.now()}`;
  const list = await getJSON<any[]>("registrations", []);
  list.push({ ...payload, temp_id: tempId, synced: 0 });
  await setJSON("registrations", list);
  return tempId;
}

export async function getPendingRegistrationsCount(): Promise<number> {
  const list = await getJSON<any[]>("registrations", []);
  return list.filter((i) => !i.synced).length;
}

export async function processRegistrationsPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  return { syncedCount: 0, failedCount: 0 };
}

export async function saveWithdrawalOffline(payload: any): Promise<void> {
  const list = await getJSON<any[]>("withdrawals", []);
  list.push({ ...payload, synced: 0 });
  await setJSON("withdrawals", list);
}

export async function cancelPendingOfflineTransaction(
  type: "repayment" | "savings" | "withdrawal",
  transactionId: string
): Promise<void> {
  const key = type === "repayment" ? "loan_collections" : type;
  const list = await getJSON<any[]>(key, []);
  await setJSON(
    key,
    list.filter(
      (item) =>
        item.synced ||
        !String(item.tempTxId || item.tempId || item.temp_tx_id || item.transaction_id || "").startsWith(transactionId)
    )
  );
}

export async function getPendingWithdrawalsCount(): Promise<number> {
  const list = await getJSON<any[]>("withdrawals", []);
  return list.filter((i) => !i.synced).length;
}

export async function processWithdrawalsPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  return { syncedCount: 0, failedCount: 0 };
}

export async function enqueueSync(type: string, data: any): Promise<void> {
  const q = await getJSON<any[]>("sync_queue", []);
  q.push({ type, data: JSON.stringify(data), synced: 0, created_at: new Date().toISOString() });
  await setJSON("sync_queue", q);
}

export async function getPendingSyncCount(): Promise<number> {
  const q = await getJSON<any[]>("sync_queue", []);
  return q.filter((i) => !i.synced).length;
}

export async function getAllPendingCounts() {
  const [repayments, savings, registrations, withdrawals, disbursements] = await Promise.all([
    getPendingRepaymentsCount(),
    getPendingSavingsCount(),
    getPendingRegistrationsCount(),
    getPendingWithdrawalsCount(),
    getPendingDisbursementsCount(),
  ]);
  return {
    repayments,
    savings,
    registrations,
    withdrawals,
    disbursements,
    total: repayments + savings + registrations + withdrawals + disbursements,
  };
}

export async function processAllPendingSync() {
  return {
    repayments: { syncedCount: 0, failedCount: 0 },
    savings: { syncedCount: 0, failedCount: 0 },
    registrations: { syncedCount: 0, failedCount: 0 },
    withdrawals: { syncedCount: 0, failedCount: 0 },
    disbursements: { syncedCount: 0, failedCount: 0 },
  };
}

export async function getOfflineStats() {
  const clients = await loadCachedClients();
  const counts = await getAllPendingCounts();
  return {
    clients: clients.length,
    savings: 0,
    loans: 0,
    collections: 0,
    pendingSync: counts.total,
    lastSync: null,
    dbSize: `${clients.length} items`,
  };
}

export async function isOnline(): Promise<boolean> {
  return typeof navigator !== "undefined" ? navigator.onLine : true;
}

export async function autoSyncIfOnline(): Promise<boolean> {
  return false;
}

export async function clearAllOfflineData(): Promise<void> {
  const keys = [
    "users",
    "login_history",
    "clients",
    "unions",
    "disbursements",
    "loan_collections",
    "savings",
    "registrations",
    "withdrawals",
    "sync_queue",
  ];
  await Promise.all(keys.map((k) => AsyncStorage.removeItem(PREFIX + k)));
  // Also wipe screen-level caches
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const extra = allKeys.filter(
      (k) =>
        k.startsWith("cupad_cache_") ||
        k.startsWith("cupad_offline_") ||
        k.startsWith(PREFIX)
    );
    if (extra.length) await AsyncStorage.multiRemove(extra);
  } catch {}
}

export async function clearCacheForAccountSwitch(): Promise<{ pendingDiscarded: number }> {
  let pending = 0;
  try {
    const counts = await getAllPendingCounts();
    pending = counts.total || 0;
  } catch {}
  await clearAllOfflineData();
  return { pendingDiscarded: pending };
}

export async function setMeta(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(PREFIX + "meta_" + key, value);
}

export async function getMeta(key: string): Promise<string | null> {
  return AsyncStorage.getItem(PREFIX + "meta_" + key);
}


export async function saveDisbursementOffline(payload: any): Promise<string> {
  const list = await getJSON<any[]>("disbursements", []);
  const id = payload.tempTxId || `DISB-OFF-${Date.now()}`;
  list.push({ ...payload, id, synced: 0 });
  await setJSON("disbursements", list);
  return id;
}
export async function getPendingDisbursementsCount(): Promise<number> {
  const list = await getJSON<any[]>("disbursements", []);
  return list.filter((i) => !i.synced).length;
}
export async function processDisbursementsPendingSync(): Promise<{ syncedCount: number; failedCount: number }> {
  return { syncedCount: 0, failedCount: 0 };
}

export default {
  getDb,
  getLoginHistory,
  upsertUser,
  recordLogin,
  cacheClients,
  loadCachedClients,
  loadOfflineWorkspace,
  cacheUnions,
  loadCachedUnions,
  cacheDisbursements,
  loadCachedDisbursements,
  cacheRepaymentDataLocally,
  loadCachedRepayments,
  saveRepaymentOffline,
  getPendingRepaymentsCount,
  processRepaymentPendingSync,
  clearStuckPendingRepayments,
  saveSavingsOffline,
  getPendingSavingsCount,
  processSavingsPendingSync,
  saveRegistrationOffline,
  getPendingRegistrationsCount,
  processRegistrationsPendingSync,
  saveWithdrawalOffline,
  getPendingWithdrawalsCount,
  processWithdrawalsPendingSync,
  saveDisbursementOffline,
  getPendingDisbursementsCount,
  processDisbursementsPendingSync,
  enqueueSync,
  getPendingSyncCount,
  getAllPendingCounts,
  processAllPendingSync,
  getOfflineStats,
  isOnline,
  autoSyncIfOnline,
  clearAllOfflineData,
  clearCacheForAccountSwitch,
  setMeta,
  getMeta,
};
