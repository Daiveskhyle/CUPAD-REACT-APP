/**
 * Global auto-sync when network is available.
 * Started once from app/co/_layout.tsx – covers ALL CO pages.
 *
 * Triggers:
 *  - App launch / layout mount
 *  - AppState → active (returning from background)
 *  - Connectivity restored (NetInfo if installed, else polling)
 *  - Manual startAutoSync() / requestSyncNow()
 */

import { AppState, AppStateStatus, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isOnline, getAllPendingCounts, processAllPendingSync } from "./database";
import { runFullSync, hydrateOfflineCache } from "./sync";

type SyncListener = (info: {
  online: boolean;
  synced: number;
  pending: number;
  error?: string;
}) => void;

let started = false;
let syncing = false;
let lastOnline: boolean | null = null;
let lastSyncAt = 0;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let appStateSub: { remove: () => void } | null = null;
let netInfoUnsub: (() => void) | null = null;
const listeners = new Set<SyncListener>();

const MIN_SYNC_GAP_MS = 8_000; // debounce between automatic runs
const POLL_MS = 20_000; // connectivity poll when NetInfo not available

function emit(info: {
  online: boolean;
  synced: number;
  pending: number;
  error?: string;
}) {
  listeners.forEach((fn) => {
    try {
      fn(info);
    } catch {}
  });
}

export function onAutoSyncEvent(fn: SyncListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function getUsername(): Promise<string> {
  try {
    const stored = await AsyncStorage.getItem("cupad_user");
    if (stored) return JSON.parse(stored).username || "";
  } catch {}
  return "";
}

/**
 * Core flush – safe to call often (debounced).
 */
export async function requestSyncNow(opts?: {
  force?: boolean;
  hydrate?: boolean;
}): Promise<{
  online: boolean;
  synced: number;
  pending: number;
  error?: string;
}> {
  const force = opts?.force === true;
  const doHydrate = opts?.hydrate !== false;

  if (syncing) {
    const pending = (await getAllPendingCounts().catch(() => ({ total: 0 }))).total;
    return { online: lastOnline ?? false, synced: 0, pending };
  }

  const now = Date.now();
  if (!force && now - lastSyncAt < MIN_SYNC_GAP_MS) {
    const pending = (await getAllPendingCounts().catch(() => ({ total: 0 }))).total;
    return { online: lastOnline ?? false, synced: 0, pending };
  }

  syncing = true;
  try {
    const online = await isOnline();
    const wasOffline = lastOnline === false;
    lastOnline = online;

    if (!online) {
      const pending = (await getAllPendingCounts().catch(() => ({ total: 0 }))).total;
      emit({ online: false, synced: 0, pending });
      return { online: false, synced: 0, pending, error: "offline" };
    }

    // Network is up – flush queues
    const before = await getAllPendingCounts().catch(() => ({ total: 0 }));
    const result = await runFullSync();
    // Also direct process in case runFullSync path missed something
    try {
      await processAllPendingSync();
    } catch {}

    const after = await getAllPendingCounts().catch(() => ({ total: 0 }));
    const synced = Math.max(
      0,
      (before.total || 0) - (after.total || 0),
      (result.repaymentsSynced || 0) +
        (result.savingsSynced || 0) +
        (result.registrationsSynced || 0) +
        (result.withdrawalsSynced || 0) +
        ((result as any).disbursementsSynced || 0)
    );

    if (doHydrate) {
      const username = await getUsername();
      if (username) {
        // Don't block UI long – hydrate in background after queue flush
        hydrateOfflineCache(username).catch(() => {});
      }
    }

    lastSyncAt = Date.now();
    const info = {
      online: true,
      synced,
      pending: after.total || 0,
      error: result.error,
    };
    emit(info);

    // Optional toast-friendly flag for screens
    if (synced > 0 || wasOffline) {
      try {
        await AsyncStorage.setItem(
          "cupad_last_auto_sync",
          JSON.stringify({ at: new Date().toISOString(), synced, pending: after.total })
        );
      } catch {}
    }

    return info;
  } catch (e: any) {
    const pending = (await getAllPendingCounts().catch(() => ({ total: 0 }))).total;
    const info = {
      online: lastOnline ?? false,
      synced: 0,
      pending,
      error: e?.message || "sync failed",
    };
    emit(info);
    return info;
  } finally {
    syncing = false;
  }
}

async function onConnectivityChange(online: boolean) {
  const prev = lastOnline;
  lastOnline = online;
  // Only auto-flush when we regain network
  if (online && prev === false) {
    await requestSyncNow({ force: true, hydrate: true });
  } else if (online && prev === null) {
    // First reading while online
    await requestSyncNow({ force: false, hydrate: true });
  }
}

/**
 * Start global listeners. Idempotent – call from CO layout once.
 */
export function startAutoSync(): void {
  if (started) {
    // Still kick a sync attempt
    requestSyncNow({ force: false, hydrate: true }).catch(() => {});
    return;
  }
  started = true;

  // 1) Immediate
  requestSyncNow({ force: true, hydrate: true }).catch(() => {});

  // 2) App foreground
  appStateSub = AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "active") {
      requestSyncNow({ force: false, hydrate: true }).catch(() => {});
    }
  });

  // 3) NetInfo if the package is installed (optional peer)
  try {
    // Dynamic require so projects without netinfo still work
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require("@react-native-community/netinfo");
    if (NetInfo?.addEventListener) {
      netInfoUnsub = NetInfo.addEventListener((state: any) => {
        const online = !!(state?.isConnected && state?.isInternetReachable !== false);
        onConnectivityChange(online).catch(() => {});
      });
    }
  } catch {
    // NetInfo not installed – fall back to polling
  }

  // 4) Polling fallback (also helps when NetInfo reports null isInternetReachable)
  if (Platform.OS !== "web") {
    pollTimer = setInterval(() => {
      requestSyncNow({ force: false, hydrate: false }).catch(() => {});
    }, POLL_MS);
  } else {
    // Web: also listen to browser online/offline
    try {
      const onOnline = () => {
        onConnectivityChange(true).catch(() => {});
      };
      const onOffline = () => {
        lastOnline = false;
        emit({ online: false, synced: 0, pending: 0 });
      };
      if (typeof window !== "undefined") {
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        netInfoUnsub = () => {
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
        };
      }
    } catch {}
    pollTimer = setInterval(() => {
      requestSyncNow({ force: false, hydrate: false }).catch(() => {});
    }, POLL_MS);
  }
}

export function stopAutoSync(): void {
  started = false;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (appStateSub) {
    appStateSub.remove();
    appStateSub = null;
  }
  if (netInfoUnsub) {
    netInfoUnsub();
    netInfoUnsub = null;
  }
}

export function isAutoSyncRunning(): boolean {
  return started;
}

export default {
  startAutoSync,
  stopAutoSync,
  requestSyncNow,
  onAutoSyncEvent,
  isAutoSyncRunning,
};
