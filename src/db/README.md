# CUPAD Offline SQLite Database

Local persistence so Credit Officers can collect, register clients, record repayments, savings and withdrawals when there is **no network**.

## Install

```bash
npx expo install expo-sqlite
```

## Files

```
src/db/
  database.ts       # Native SQLite (expo-sqlite)
  database.web.ts   # AsyncStorage fallback for web
  index.ts          # Re-exports
  sync.ts           # Full sync + cache hydration
  offlineHelpers.ts # Drop-in helpers for screens
```

## What is stored

| Table | Purpose |
|-------|---------|
| `clients` | Cached client list + balances |
| `unions` | Union groups |
| `loans` / `disbursements` | Active loan schedules |
| `loan_collections` | Offline repayments queue |
| `savings` | Offline savings deposits |
| `registrations` | Offline new-client registrations |
| `withdrawals` | Offline withdrawal queue |
| `sync_queue` | Generic pending items |
| `users` / `login_history` | Officer session + audit |

## Key APIs

```ts
// Cache (call after successful API response)
await cacheClients(clients, username);
await cacheUnions(unions, username);
await cacheDisbursements(disbursements, username);

// Load offline
const clients = await loadCachedClients(username);
const unions = await loadCachedUnions();

// Queue writes offline
await saveRegistrationOffline(payload);
await saveSavingsOffline({ tempId, clientId, amount, date, officer, ... });
await saveRepaymentOffline({ ... });
await saveWithdrawalOffline({ tempTxId, clientId, amount, type, date, officer, ... });

// Pending counts
await getPendingRegistrationsCount();
await getPendingSavingsCount();
await getPendingRepaymentsCount();
await getPendingWithdrawalsCount();
await getAllPendingCounts();

// Flush when online
await processRegistrationsPendingSync();
await processSavingsPendingSync();
await processRepaymentPendingSync();
await processWithdrawalsPendingSync();
await processAllPendingSync();
await runFullSync();           // from sync.ts
await hydrateOfflineCache(username);
```

## Auto-sync (already in updated `_layout.tsx`)

On app mount and when AppState becomes `active`, the layout calls `runFullSync()` + `hydrateOfflineCache()`.


## Pure offline workspace

When online, `hydrateOfflineCache(username)` (called from `_layout` on focus) pulls:

- clients (loans + savings balances)
- unions
- active disbursements/loans
- savings / withdrawal / collection inits

When offline, any screen can call:

```ts
import { loadOfflineWorkspace } from "../../src/db/database";

const { clients, unionNames, disbursements } = await loadOfflineWorkspace(username);
```

Writes (savings, repayment, withdrawal, registration) queue in SQLite and sync when network returns.
