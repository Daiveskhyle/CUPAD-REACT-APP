import api from "../api/api";
import {
  getPendingSync,
  markSyncing,
  markSynced,
  markSyncFailed,
} from "../db/sync";

let syncing = false;

export async function syncPendingTransactions() {
  if (syncing) {
    return;
  }

  syncing = true;

  try {
    const pending = await getPendingSync();

    for (const item of pending) {
      try {
        await markSyncing(item.id);

        const payload = JSON.parse(item.payload);

        await api.post("/sync", {
          sync_id: item.id,
          entity: item.entity,
          entity_id: item.entity_id,
          operation: item.operation,
          payload,
        });

        await markSynced(item.id);
      } catch (error: any) {
        const message =
          error?.response?.data?.message ||
          error?.message ||
          "Synchronization failed";

        await markSyncFailed(item.id, message);
      }
    }
  } finally {
    syncing = false;
  }
}