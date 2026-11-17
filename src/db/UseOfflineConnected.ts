
import { useEffect, useState, useCallback } from "react";
import { getOfficerUsername, bootstrapCoScreenData } from "../db/offlineHelpers";
import { isOnline, getAllPendingCounts, runBackgroundSync, hydrateOfflineCache, getMeta } from "../db/database";

export function useOfflineConnected() {
  const [officer, setOfficer] = useState<string>("");
  const [clients, setClients] = useState<any[]>([]);
  const [unions, setUnions] = useState<any[]>([]);
  const [pending, setPending] = useState<Record<string, number>>({});
  const [online, setOnline] = useState(true);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const username = await getOfficerUsername();
    setOfficer(username);
    const data = await bootstrapCoScreenData(username);
    setClients(data.clients);
    setUnions(data.unions);
    setPending(await getAllPendingCounts(username));
    setOnline(await isOnline());
    setLastSync(await getMeta(`last_sync_${username}`));
    setLoading(false);
  }, []);

  const syncNow = useCallback(async () => {
    if (!officer) return;
    if (await isOnline()) {
      await runBackgroundSync(officer);
      await hydrateOfflineCache(officer);
      await refresh();
    }
  }, [officer, refresh]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    const id = setInterval(syncNow, 60000);
    return () => clearInterval(id);
  }, [syncNow]);

  return { officer, clients, unions, pending, online, lastSync, loading, refresh, syncNow };
}
