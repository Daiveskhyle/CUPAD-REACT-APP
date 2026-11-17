import { useCallback, useEffect, useState } from "react";
import { getAllPendingCounts, isOnline } from "../../db/database";
import { onAutoSyncEvent, requestSyncNow } from "../../db/autoSync";

export function useOfflineStatus(pollMs = 15000) {
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [on, counts] = await Promise.all([
        isOnline().catch(() => false),
        getAllPendingCounts().catch(() => ({ total: 0 })),
      ]);
      setOnline(!!on);
      setPending(counts.total || 0);
    } catch {}
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, pollMs);
    const unsub = onAutoSyncEvent((info) => {
      setOnline(info.online);
      setPending(info.pending);
    });
    return () => {
      clearInterval(t);
      unsub();
    };
  }, [refresh, pollMs]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await requestSyncNow({ force: true, hydrate: true });
      setOnline(res.online);
      setPending(res.pending);
      return res;
    } finally {
      setSyncing(false);
    }
  }, []);

  return { online, pending, syncing, refresh, syncNow };
}
