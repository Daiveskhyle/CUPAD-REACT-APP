/**
 * Convenience helpers to wire offline SQLite into existing screens
 * without large refactors. Import these where you currently use
 * AsyncStorage-only offline queues.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import {
  saveRegistrationOffline,
  getPendingRegistrationsCount,
  processRegistrationsPendingSync,
  saveSavingsOffline,
  getPendingSavingsCount,
  processSavingsPendingSync,
  saveWithdrawalOffline,
  getPendingWithdrawalsCount,
  saveRepaymentOffline,
  getPendingRepaymentsCount,
  processRepaymentPendingSync,
  cacheClients,
  loadCachedClients,
  loadOfflineWorkspace,
  cacheUnions,
  loadCachedUnions,
  isOnline,
  getAllPendingCounts,
  clearAllOfflineData,
  clearCacheForAccountSwitch,
} from "./database";
import { runFullSync, hydrateOfflineCache } from "./sync";

const API_BASE = "https://cupadapp.name.ng";
const CACHE_KEY_UNIONS_NAMES = "cupad_cache_union_names";
const CACHE_KEY_UNIONS_FULL = "cupad_cache_unions_full";

/** Officer username from session storage */
export async function getOfficerUsername(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem("cupad_user");
    if (stored) return JSON.parse(stored).username || "";
  } catch {}
  return "";
}

/**
 * Dedicated union fetch used by ALL CO screens.
 * Always hits union_api.php (same as Unions page) so every screen
 * gets a consistent list even when their own init endpoint omits unions.
 */
export async function fetchUnionsForOfficer(username?: string): Promise<{
  names: string[];
  unions: any[];
  fromCache: boolean;
}> {
  const user = username || (await getOfficerUsername());
  if (!user) return { names: [], unions: [], fromCache: true };

  // 1) Network – same endpoint as Unions page
  try {
    const res = await axios.get(
      `${API_BASE}/api/union_api.php?action=get_unions&username=${encodeURIComponent(user)}`,
      { timeout: 12000 }
    );
    if (res.data?.success && Array.isArray(res.data.unions)) {
      const unions = res.data.unions;
      const names = unions
        .map((u: any) => (typeof u === "string" ? u : u?.name))
        .filter(Boolean) as string[];

      try {
        await cacheUnions(unions, user);
        await AsyncStorage.setItem(CACHE_KEY_UNIONS_FULL, JSON.stringify(res.data));
        await AsyncStorage.setItem(CACHE_KEY_UNIONS_NAMES, JSON.stringify(names));
      } catch {}

      return { names, unions, fromCache: false };
    }
  } catch {}

  // 2) SQLite fallback
  try {
    const cached = await loadCachedUnions();
    if (cached && cached.length > 0) {
      const names = cached
        .map((u: any) => (typeof u === "string" ? u : u?.name))
        .filter(Boolean) as string[];
      return { names, unions: cached, fromCache: true };
    }
  } catch {}

  // 3) AsyncStorage fallback
  try {
    const namesRaw = await AsyncStorage.getItem(CACHE_KEY_UNIONS_NAMES);
    if (namesRaw) {
      const names = JSON.parse(namesRaw);
      if (Array.isArray(names) && names.length > 0) {
        return { names, unions: names.map((n: string) => ({ name: n })), fromCache: true };
      }
    }
    const fullRaw = await AsyncStorage.getItem(CACHE_KEY_UNIONS_FULL);
    if (fullRaw) {
      const parsed = JSON.parse(fullRaw);
      const unions = parsed.unions || [];
      const names = unions
        .map((u: any) => (typeof u === "string" ? u : u?.name))
        .filter(Boolean) as string[];
      if (names.length > 0) return { names, unions, fromCache: true };
    }
  } catch {}

  return { names: [], unions: [], fromCache: true };
}

/**
 * Merge union names from multiple sources (init API + dedicated fetch + client-derived).
 */
export function mergeUnionNames(
  ...sources: (string[] | undefined | null)[]
): string[] {
  const set = new Set<string>();
  for (const src of sources) {
    if (!Array.isArray(src)) continue;
    for (const u of src) {
      const name = typeof u === "string" ? u : (u as any)?.name;
      if (name && String(name).trim()) set.add(String(name).trim());
    }
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

/**
 * Try network first; on failure save registration offline and return offline receipt.
 */
export async function registerClientWithOfflineFallback(
  payload: any,
  postFn: (p: any) => Promise<any>
): Promise<{ success: boolean; offline: boolean; data?: any; tempId?: string; error?: string }> {
  try {
    const res = await postFn(payload);
    if (res?.data?.success) {
      return { success: true, offline: false, data: res.data };
    }
    return { success: false, offline: false, error: res?.data?.message || "Registration failed" };
  } catch {
    const tempId = await saveRegistrationOffline(payload);
    return {
      success: true,
      offline: true,
      tempId,
      data: { receipt_id: tempId, offline: true },
    };
  }
}

/**
 * Collect savings with offline fallback.
 */
export async function collectSavingsWithOfflineFallback(opts: {
  clientId: string | number;
  clientName?: string;
  amount: number;
  officer: string;
  union?: string;
  balanceAfter?: number;
  postFn: () => Promise<any>;
}): Promise<{ success: boolean; offline: boolean; tempId?: string; data?: any }> {
  try {
    const res = await opts.postFn();
    if (res?.data?.success) {
      return { success: true, offline: false, data: res.data };
    }
    return { success: false, offline: false };
  } catch {
    const tempId = `SAV-OFF-${Date.now()}`;
    await saveSavingsOffline({
      tempId,
      clientId: opts.clientId,
      clientName: opts.clientName,
      amount: opts.amount,
      date: new Date().toISOString().slice(0, 19).replace("T", " "),
      officer: opts.officer,
      union: opts.union,
      balanceAfter: opts.balanceAfter,
    });
    return { success: true, offline: true, tempId };
  }
}

/**
 * Unified "sync now" used by banners across screens.
 */
export async function syncAllOfflineQueues(): Promise<{
  totalSynced: number;
  totalFailed: number;
  online: boolean;
}> {
  const result = await runFullSync();
  const totalSynced =
    result.repaymentsSynced +
    result.savingsSynced +
    result.registrationsSynced +
    (result.withdrawalsSynced || 0);
  const totalFailed = result.pendingAfter;
  return {
    totalSynced,
    totalFailed: result.online ? totalFailed : 0,
    online: result.online,
  };
}

/**
 * Load clients from SQLite cache (pure offline path).
 */
export async function loadClientsSmart(username: string): Promise<{
  clients: any[];
  fromCache: boolean;
}> {
  try {
    const clients = await loadCachedClients(username);
    return { clients, fromCache: true };
  } catch {
    return { clients: [], fromCache: true };
  }
}

/**
 * After a successful online clients fetch, write to SQLite.
 */
export async function persistClientsCache(
  clients: any[],
  username?: string
): Promise<void> {
  await cacheClients(clients, username);
}



/**
 * Shared bootstrap for every CO screen (including analytics).
 * - Fetches unions from union_api (or cache)
 * - Loads full offline workspace (clients + loans + savings)
 * - Returns normalized data ready for UI
 */
export async function bootstrapCoScreenData(username?: string): Promise<{
  username: string;
  clients: any[];
  unionNames: string[];
  unions: any[];
  disbursements: any[];
  fromCache: boolean;
}> {
  const user = username || (await getOfficerUsername());
  if (!user) {
    return { username: "", clients: [], unionNames: [], unions: [], disbursements: [], fromCache: true };
  }

  let fromCache = true;
  let unionNames: string[] = [];
  let unions: any[] = [];

  // Always try dedicated union fetch
  try {
    const uf = await fetchUnionsForOfficer(user);
    unionNames = uf.names || [];
    unions = uf.unions || [];
    fromCache = uf.fromCache;
  } catch {}

  // Full offline workspace (clients with loan + savings fields)
  let clients: any[] = [];
  let disbursements: any[] = [];
  try {
    const ws = await loadOfflineWorkspace(user);
    clients = ws.clients || [];
    disbursements = ws.disbursements || [];
    if (!unionNames.length && ws.unionNames?.length) {
      unionNames = ws.unionNames;
    }
  } catch {}

  // Derive union names from clients if still empty
  if (!unionNames.length && clients.length) {
    unionNames = Array.from(
      new Set(clients.map((c) => c.union || c.union_name).filter(Boolean))
    ) as string[];
  }

  return {
    username: user,
    clients,
    unionNames: unionNames.sort((a, b) => a.localeCompare(b)),
    unions,
    disbursements,
    fromCache,
  };
}

/**
 * Build simple per-union analytics from cached clients (for offline dashboard/reports).
 */
export function buildUnionStatsFromClients(clients: any[]): {
  name: string;
  clients: number;
  savings: number;
  loans: number;
}[] {
  const map = new Map<string, { clients: number; savings: number; loans: number }>();
  for (const c of clients || []) {
    const name = String(c.union || c.union_name || "Unassigned").trim() || "Unassigned";
    const cur = map.get(name) || { clients: 0, savings: 0, loans: 0 };
    cur.clients += 1;
    cur.savings += Number(c.savings_balance ?? c.savings ?? c.total_savings ?? 0);
    cur.loans += Number(c.outstanding_loan ?? c.loan_balance ?? c.loan ?? 0);
    map.set(name, cur);
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Build offline report rows from cached clients.
 */
export function buildUnionReportsFromClients(clients: any[]): any[] {
  return buildUnionStatsFromClients(clients).map((u) => ({
    name: u.name,
    clients: u.clients,
    total_savings: u.savings,
    withdrawals: 0,
    cash_payouts: 0,
    net_savings: u.savings,
    disbursements: 0,
    collections: 0,
    registrations: 0,
    registrations_amount: 0,
    paid_off: 0,
    overdue_count: 0,
    activity_badge: "Low",
  }));
}

// Re-export selected DB / sync helpers for convenient single-import usage.
// Do NOT re-export functions that are already exported above in this file
// (fetchUnionsForOfficer, mergeUnionNames, etc.) — that causes:
// "Cannot assign to property which has only a getter"
export {
  clearAllOfflineData,
  clearCacheForAccountSwitch,
  getPendingRegistrationsCount,
  processRegistrationsPendingSync,
  getPendingSavingsCount,
  processSavingsPendingSync,
  getPendingWithdrawalsCount,
  getPendingRepaymentsCount,
  processRepaymentPendingSync,
  saveRegistrationOffline,
  saveSavingsOffline,
  saveWithdrawalOffline,
  saveRepaymentOffline,
  getAllPendingCounts,
  loadOfflineWorkspace,
  isOnline,
  hydrateOfflineCache,
  runFullSync,
};
