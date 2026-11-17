/**
 * CUPAD Offline Sync Orchestrator
 * --------------------------------
 * Call `runFullSync()` when network returns, on app foreground,
 * or from a pull-to-refresh handler.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  isOnline,
  processAllPendingSync,
  getAllPendingCounts,
  cacheClients,
  cacheUnions,
  cacheDisbursements,
  setMeta,
  getMeta,
} from "./database";
import axios from "axios";

const API_BASE = "https://cupadapp.name.ng";

export type SyncResult = {
  online: boolean;
  pendingBefore: number;
  pendingAfter: number;
  repaymentsSynced: number;
  savingsSynced: number;
  registrationsSynced: number;
  withdrawalsSynced: number;
  disbursementsSynced: number;
  error?: string;
};

/**
 * Full offline → online flush.
 * Safe to call repeatedly; no-ops when offline or queue is empty.
 */
export async function runFullSync(): Promise<SyncResult> {
  const online = await isOnline();
  const before = await getAllPendingCounts();

  if (!online) {
    return {
      online: false,
      pendingBefore: before.total,
      pendingAfter: before.total,
      repaymentsSynced: 0,
      savingsSynced: 0,
      registrationsSynced: 0,
      withdrawalsSynced: 0,
      disbursementsSynced: 0,
      error: "Device is offline",
    };
  }

  try {
    const result = await processAllPendingSync();

    // Re-pull server truth so local cache matches DB (removes deleted rows)
    try {
      const stored = await AsyncStorage.getItem("cupad_user");
      const username = stored ? JSON.parse(stored).username : "";
      if (username) await hydrateOfflineCache(username);
    } catch {}

    const after = await getAllPendingCounts();

    await AsyncStorage.setItem("cupad_last_sync", new Date().toISOString());
    await setMeta("last_full_sync", new Date().toISOString());

    return {
      online: true,
      pendingBefore: before.total,
      pendingAfter: after.total,
      repaymentsSynced: result.repayments.syncedCount,
      savingsSynced: result.savings.syncedCount,
      registrationsSynced: result.registrations.syncedCount,
      withdrawalsSynced: result.withdrawals.syncedCount,
      disbursementsSynced: result.disbursements?.syncedCount || 0,
    };
  } catch (err: any) {
    return {
      online: true,
      pendingBefore: before.total,
      pendingAfter: before.total,
      repaymentsSynced: 0,
      savingsSynced: 0,
      registrationsSynced: 0,
      withdrawalsSynced: 0,
      disbursementsSynced: 0,
      error: err?.message || "Sync failed",
    };
  }
}

/**
 * Pull FULL reference data into SQLite so the officer can work
 * pure offline: clients + loans + savings balances + unions + disbursements.
 * Call on app foreground / after login while online.
 */
export async function hydrateOfflineCache(username: string): Promise<void> {
  if (!username) return;
  const online = await isOnline();
  if (!online) return;

  const u = encodeURIComponent(username);

  try {
    // 1) Full clients list (loan status, balances)
    try {
      const res = await axios.get(
        `${API_BASE}/api/clients_api.php?action=get_clients_data&username=${u}&page=1&limit=500&loan_status=all_active`,
        { timeout: 15000 }
      );
      if (res.data?.success && Array.isArray(res.data.clients)) {
        // Authoritative list – prune deleted clients from local SQLite
        await cacheClients(res.data.clients, username, { replace: true });
      }
    } catch {}

    // 2) Financial summary (richer balances)
    try {
      const res = await axios.get(
        `${API_BASE}/api/client_financial_summary.php?action=get_financial_summary&username=${u}`,
        { timeout: 15000 }
      );
      if (res.data?.success && Array.isArray(res.data.clients)) {
        await cacheClients(res.data.clients, username);
      }
    } catch {}

    // 3) Unions
    try {
      const res = await axios.get(
        `${API_BASE}/api/union_api.php?action=get_unions&username=${u}`,
        { timeout: 12000 }
      );
      if (res.data?.success && Array.isArray(res.data.unions)) {
        await cacheUnions(res.data.unions, username);
      }
    } catch {}

    // 4) Loan collection init (clients + active disbursements/loans)
    try {
      const res = await axios.get(
        `${API_BASE}/api/loan_collection_api.php?action=init&username=${u}`,
        { timeout: 15000 }
      );
      if (res.data?.success) {
        if (Array.isArray(res.data.clients)) await cacheClients(res.data.clients, username);
        if (Array.isArray(res.data.disbursements)) {
          await cacheDisbursements(res.data.disbursements, username);
        }
      }
    } catch {}

    // 5) Savings init (savings balances, today totals)
    try {
      const res = await axios.get(
        `${API_BASE}/api/savings_api.php?action=init&username=${u}`,
        { timeout: 12000 }
      );
      if (res.data?.success && Array.isArray(res.data.clients)) {
        await cacheClients(res.data.clients, username);
      }
    } catch {}

    // 6) Withdrawal init
    try {
      const res = await axios.get(
        `${API_BASE}/api/saving_withdrawal_api.php?action=init&username=${u}`,
        { timeout: 12000 }
      );
      if (res.data?.success && Array.isArray(res.data.clients)) {
        await cacheClients(res.data.clients, username);
      }
    } catch {}

    // 7) Disbursement init (plans + eligible clients)
    try {
      const res = await axios.get(
        `${API_BASE}/api/disbursement_api.php?action=init&username=${u}`,
        { timeout: 12000 }
      );
      if (res.data?.success) {
        if (Array.isArray(res.data.clients)) await cacheClients(res.data.clients, username);
        if (Array.isArray(res.data.disbursements)) {
          await cacheDisbursements(res.data.disbursements, username);
        }
      }
    } catch {}

    await setMeta("last_hydrate", new Date().toISOString());
    try {
      const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
      await AsyncStorage.setItem("cupad_last_sync", new Date().toISOString());
      // Drop screen-level caches so UI matches freshly hydrated SQLite / server
      const keys = await AsyncStorage.getAllKeys();
      const cacheKeys = keys.filter(
        (k) =>
          k.startsWith("cupad_cache_") ||
          k === "cupad_offline_savings_queue" // keep queue; only display caches
      );
      const displayCaches = keys.filter((k) => k.startsWith("cupad_cache_"));
      if (displayCaches.length) await AsyncStorage.multiRemove(displayCaches);
    } catch {}
  } catch {}
}

/**
 * Returns human-readable last sync label for UI badges.
 */
export async function getLastSyncLabel(): Promise<string> {
  const iso =
    (await getMeta("last_full_sync")) ||
    (await AsyncStorage.getItem("cupad_last_sync"));
  if (!iso) return "Never";
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 45) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleDateString("en-NG", {
    month: "short",
    day: "numeric",
  });
}

export default {
  runFullSync,
  hydrateOfflineCache,
  getLastSyncLabel,
};
