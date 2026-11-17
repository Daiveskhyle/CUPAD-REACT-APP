/**
 * CUPAD Offline SQLite Database Layer
 * ------------------------------------
 * Provides local persistence when network is unavailable.
 * Uses expo-sqlite (async API). Falls back gracefully on web.
 *
 * Tables:
 *   users, login_history, clients, unions, loans, savings,
 *   savings_collections, loan_collections, withdrawals,
 *   disbursements, registrations, sync_queue
 */

import * as SQLite from "expo-sqlite";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import { Platform } from "react-native";

const API_BASE = "https://cupadapp.name.ng";
const DB_NAME = "cupad_offline.db";

// ─── Singleton DB handle & Transaction Queue ─────────────────────────────────

let _db: SQLite.SQLiteDatabase | null = null;
let _initPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * Promise-chained transaction queue to ensure only ONE transaction runs at a
 * time on the SQLite connection, preventing "cannot start a transaction within a transaction".
 */
let _txQueue: Promise<any> = Promise.resolve();

async function runInTransaction<T>(
  db: SQLite.SQLiteDatabase,
  fn: () => Promise<T>
): Promise<T> {
  const next = _txQueue.then(async () => {
    return await db.withTransactionAsync(fn);
  });
  // Keep the queue operational even if an individual transaction throws
  _txQueue = next.catch(() => {});
  return next;
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    await migrate(db);
    _db = db;
    return db;
  })();

  return _initPromise;
}

// ─── Schema / Migrations ─────────────────────────────────────────────────────

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      full_name TEXT,
      email TEXT,
      phone TEXT,
      role TEXT,
      branch TEXT,
      branch_name TEXT,
      zone_name TEXT,
      area_name TEXT,
      profile_pic TEXT,
      last_login TEXT,
      is_online INTEGER DEFAULT 0,
      raw_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS login_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      login_method TEXT,
      login_time TEXT NOT NULL,
      device_info TEXT
    );

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      union_name TEXT,
      branch TEXT,
      guarantor_name TEXT,
      guarantor_phone TEXT,
      guarantor_relationship TEXT,
      savings_balance REAL DEFAULT 0,
      outstanding_loan REAL DEFAULT 0,
      loan_principal REAL DEFAULT 0,
      plan_id TEXT,
      officer_username TEXT,
      status TEXT DEFAULT 'active',
      raw_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS unions (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      branch TEXT,
      client_count INTEGER DEFAULT 0,
      officer_username TEXT,
      is_pending_sync INTEGER DEFAULT 0,
      raw_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS loans (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      principal REAL DEFAULT 0,
      total_payable REAL DEFAULT 0,
      remaining_balance REAL DEFAULT 0,
      num_installments INTEGER DEFAULT 23,
      interest_rate REAL DEFAULT 0.15,
      status TEXT DEFAULT 'active',
      disbursement_date TEXT,
      payoff_date TEXT,
      plan_type TEXT,
      officer_username TEXT,
      raw_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS savings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_after REAL,
      date TEXT NOT NULL,
      transaction_id TEXT,
      officer_username TEXT,
      union_name TEXT,
      is_offline INTEGER DEFAULT 0,
      synced INTEGER DEFAULT 0,
      raw_json TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS savings_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      transaction_id TEXT,
      officer_username TEXT,
      synced INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS loan_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_tx_id TEXT UNIQUE,
      client_id TEXT NOT NULL,
      client_name TEXT,
      union_name TEXT,
      loan_id TEXT,
      amount REAL NOT NULL,
      remaining_balance REAL,
      num_installments INTEGER DEFAULT 1,
      is_custom INTEGER DEFAULT 0,
      date TEXT NOT NULL,
      officer_username TEXT,
      synced INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_tx_id TEXT UNIQUE,
      client_id TEXT NOT NULL,
      client_name TEXT,
      amount REAL NOT NULL,
      type TEXT,
      balance_after REAL,
      date TEXT NOT NULL,
      officer_username TEXT,
      union_name TEXT,
      notes TEXT,
      synced INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      raw_json TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS disbursements (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      client_name TEXT,
      principal REAL DEFAULT 0,
      total_payable REAL DEFAULT 0,
      remaining_balance REAL DEFAULT 0,
      installments INTEGER DEFAULT 23,
      plan_type TEXT,
      date TEXT,
      payoff_date TEXT,
      union_name TEXT,
      officer_username TEXT,
      synced INTEGER DEFAULT 1,
      raw_json TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS registrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      temp_id TEXT UNIQUE,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      union_name TEXT,
      plan_id TEXT,
      branch TEXT,
      guarantor_name TEXT,
      guarantor_phone TEXT,
      guarantor_relationship TEXT,
      officer_username TEXT,
      payload_json TEXT,
      synced INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending',
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      synced INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      last_error TEXT,
      created_at TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_clients_union ON clients(union_name);
    CREATE INDEX IF NOT EXISTS idx_clients_officer ON clients(officer_username);
    CREATE INDEX IF NOT EXISTS idx_loans_client ON loans(client_id);
    CREATE INDEX IF NOT EXISTS idx_loans_status ON loans(status);
    CREATE INDEX IF NOT EXISTS idx_savings_client ON savings(client_id);
    CREATE INDEX IF NOT EXISTS idx_lc_synced ON loan_collections(synced);
    CREATE INDEX IF NOT EXISTS idx_reg_synced ON registrations(synced);
    CREATE INDEX IF NOT EXISTS idx_sync_queue_synced ON sync_queue(synced);
    CREATE INDEX IF NOT EXISTS idx_login_user ON login_history(username);
  `);
}

// ─── Meta helpers ────────────────────────────────────────────────────────────

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)`,
    [key, value]
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getDb();
  const row = (await db.getFirstAsync(`SELECT value FROM meta WHERE key = ?`, [key])) as any;
  return row?.value ?? null;
}

// ─── Users / Login History ───────────────────────────────────────────────────

export async function upsertUser(user: any): Promise<void> {
  if (!user?.username) return;
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO users (username, full_name, email, phone, role, branch, branch_name, zone_name, area_name, profile_pic, last_login, is_online, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(username) DO UPDATE SET
       full_name=excluded.full_name, email=excluded.email, phone=excluded.phone,
       role=excluded.role, branch=excluded.branch, branch_name=excluded.branch_name,
       zone_name=excluded.zone_name, area_name=excluded.area_name, profile_pic=excluded.profile_pic,
       last_login=excluded.last_login, is_online=excluded.is_online, raw_json=excluded.raw_json,
       updated_at=excluded.updated_at`,
    [
      user.username,
      user.full_name || user.name || null,
      user.email || null,
      user.phone || user.phone_number || null,
      user.role || null,
      user.branch || null,
      user.branch_name || user.branch || null,
      user.zone_name || user.zone || null,
      user.area_name || user.area || null,
      user.profile_pic || null,
      user.last_login || now,
      1,
      JSON.stringify(user),
      now,
    ]
  );
}

export async function recordLogin(
  username: string,
  method: string = "password"
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.runAsync(
    `INSERT INTO login_history (username, login_method, login_time, device_info) VALUES (?, ?, ?, ?)`,
    [username, method, now, Platform.OS]
  );
  await db.runAsync(
    `UPDATE users SET last_login = ?, is_online = 1 WHERE username = ?`,
    [now, username]
  );
  await AsyncStorage.setItem("cupad_last_login", now);
}

export async function getLoginHistory(
  username: string,
  limit = 5
): Promise<any[]> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync(
      `SELECT * FROM login_history WHERE username = ? ORDER BY login_time DESC LIMIT ?`,
      [username, limit]
    );
    return rows || [];
  } catch {
    return [];
  }
}

// ─── Clients ─────────────────────────────────────────────────────────────────

export async function cacheClients(
  clients: any[],
  officerUsername?: string,
  options?: { replace?: boolean }
): Promise<void> {
  if (!Array.isArray(clients) || clients.length === 0) return;
  const db = await getDb();
  const now = new Date().toISOString();
  const replace = options?.replace === true;

  await runInTransaction(db, async () => {
    if (replace && officerUsername) {
      const keepIds = clients
        .map((c) => String(c.id ?? c.client_id ?? ""))
        .filter(Boolean);
      if (keepIds.length > 0) {
        const placeholders = keepIds.map(() => "?").join(",");
        await db.runAsync(
          `DELETE FROM clients WHERE (officer_username = ? OR officer_username IS NULL) AND id NOT IN (${placeholders})`,
          [officerUsername, ...keepIds]
        );
        await db.runAsync(
          `DELETE FROM loans WHERE client_id NOT IN (SELECT id FROM clients)`
        );
        await db.runAsync(
          `DELETE FROM disbursements WHERE client_id NOT IN (SELECT id FROM clients)`
        );
      } else {
        await db.runAsync(
          `DELETE FROM clients WHERE officer_username = ? OR officer_username IS NULL`,
          [officerUsername]
        );
      }
    }

    for (const c of clients) {
      const id = String(c.id ?? c.client_id ?? "");
      if (!id) continue;

      let existing: any = {};
      if (!replace) {
        try {
          const row = (await db.getFirstAsync(
            `SELECT raw_json FROM clients WHERE id = ?`,
            [id]
          )) as any;
          if (row?.raw_json) existing = JSON.parse(row.raw_json);
        } catch {}
      }

      const merged = { ...existing, ...c };
      merged.id = id;
      merged.name = c.name || existing.name || "Unknown";
      merged.phone = c.phone ?? existing.phone ?? null;
      merged.address = c.address ?? existing.address ?? null;
      merged.union = c.union || c.union_name || existing.union || existing.union_name || null;
      merged.union_name = merged.union;
      merged.branch = c.branch || c.branch_name || existing.branch || null;
      merged.guarantor_name = c.guarantor_name ?? existing.guarantor_name ?? null;
      merged.guarantor_phone = c.guarantor_phone ?? existing.guarantor_phone ?? null;
      merged.guarantor_relationship =
        c.guarantor_relationship ?? existing.guarantor_relationship ?? null;
      merged.savings_balance = Number(
        c.savings_balance ?? c.savings ?? c.total_savings ?? existing.savings_balance ?? existing.savings ?? 0
      );
      merged.savings = merged.savings_balance;
      merged.total_savings = Number(
        c.total_savings ?? merged.savings_balance ?? existing.total_savings ?? 0
      );
      merged.outstanding_loan = Number(
        c.outstanding_loan ?? c.loan_balance ?? c.loan ?? existing.outstanding_loan ?? existing.loan_balance ?? 0
      );
      merged.loan_balance = merged.outstanding_loan;
      merged.loan_principal = Number(
        c.loan_principal ?? c.principal ?? existing.loan_principal ?? 0
      );
      merged.plan_id = c.plan_id ?? existing.plan_id ?? null;
      merged.plan_name = c.plan_name ?? existing.plan_name ?? null;
      merged.client_type = c.client_type || existing.client_type || "regular";
      merged.days_registered = Number(c.days_registered ?? existing.days_registered ?? 365);
      merged.today_savings = Number(c.today_savings ?? c.today_deposit ?? c.paid_today ?? existing.today_savings ?? 0);
      merged.today_repayment = Number(c.today_repayment ?? c.paid_today_loan ?? existing.today_repayment ?? 0);
      merged.status = c.status || existing.status || "active";
      merged.officer_username = officerUsername || c.officer_username || existing.officer_username || null;

      await db.runAsync(
        `INSERT INTO clients (id, name, phone, address, union_name, branch, guarantor_name, guarantor_phone, guarantor_relationship, savings_balance, outstanding_loan, loan_principal, plan_id, officer_username, status, raw_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name=excluded.name, phone=excluded.phone, address=excluded.address,
           union_name=excluded.union_name, branch=excluded.branch,
           guarantor_name=excluded.guarantor_name, guarantor_phone=excluded.guarantor_phone,
           guarantor_relationship=excluded.guarantor_relationship,
           savings_balance=excluded.savings_balance, outstanding_loan=excluded.outstanding_loan,
           loan_principal=excluded.loan_principal, plan_id=excluded.plan_id,
           officer_username=excluded.officer_username, status=excluded.status,
           raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
        [
          id,
          merged.name,
          merged.phone,
          merged.address,
          merged.union,
          merged.branch,
          merged.guarantor_name,
          merged.guarantor_phone,
          merged.guarantor_relationship,
          merged.savings_balance,
          merged.outstanding_loan,
          merged.loan_principal,
          merged.plan_id ? String(merged.plan_id) : null,
          merged.officer_username,
          merged.status,
          JSON.stringify(merged),
          now,
        ]
      );
    }
  });
}

export async function loadCachedClients(officerUsername?: string): Promise<any[]> {
  try {
    const db = await getDb();
    let rows: any[];
    if (officerUsername) {
      rows = await db.getAllAsync(
        `SELECT * FROM clients WHERE officer_username = ? OR officer_username IS NULL ORDER BY name`,
        [officerUsername]
      );
    } else {
      rows = await db.getAllAsync(`SELECT * FROM clients ORDER BY name`);
    }
    return (rows || []).map((r) => {
      try {
        const cached = r.raw_json ? JSON.parse(r.raw_json) : {};
        return { ...cached, ...mapClientRow(r) };
      } catch {
        return mapClientRow(r);
      }
    });
  } catch {
    return [];
  }
}

function mapClientRow(r: any) {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    address: r.address,
    union: r.union_name,
    union_name: r.union_name,
    branch: r.branch,
    guarantor_name: r.guarantor_name,
    guarantor_phone: r.guarantor_phone,
    guarantor_relationship: r.guarantor_relationship,
    savings: r.savings_balance,
    savings_balance: r.savings_balance,
    total_savings: r.savings_balance,
    outstanding_loan: r.outstanding_loan,
    loan_balance: r.outstanding_loan,
    loan_principal: r.loan_principal,
    plan_id: r.plan_id,
    status: r.status,
    officer_username: r.officer_username,
  };
}

export async function checkDuplicateClientOffline(
  clientName: string,
  unionName?: string
): Promise<{
  exists: boolean;
  client?: any;
  union?: string | null;
  details?: any;
  status?: string | null;
  has_funds?: boolean;
  is_active?: boolean;
} | null> {
  const trimmed = (clientName ?? "").trim();
  if (!trimmed) {
    return { exists: false, client: null, union: unionName ?? null, details: null, status: null, has_funds: false, is_active: false };
  }

  try {
    const db = await getDb();
    const unionFilter = (unionName ?? "").trim();

    const row = await db.getFirstAsync(
      `SELECT *
       FROM clients
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
         AND (? = '' OR LOWER(TRIM(COALESCE(union_name, ''))) = LOWER(TRIM(?)))
       ORDER BY updated_at DESC
       LIMIT 1`,
      [trimmed, unionFilter, unionFilter]
    );

    if (row) {
      const client = mapClientRow(row);
      const status = String(client.status || row.status || "active");
      const hasFunds = Number(client.savings_balance || 0) > 0 || Number(client.outstanding_loan || 0) > 0;
      return {
        exists: true,
        client,
        union: row.union_name ?? unionName ?? null,
        details: client,
        status,
        has_funds: hasFunds,
        is_active: status.toLowerCase() !== "inactive" && status.toLowerCase() !== "non-active" && status.toLowerCase() !== "closed",
      };
    }

    const registration = await db.getFirstAsync(
      `SELECT *
       FROM registrations
       WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
         AND (? = '' OR LOWER(TRIM(COALESCE(union_name, ''))) = LOWER(TRIM(?)))
       ORDER BY created_at DESC
       LIMIT 1`,
      [trimmed, unionFilter, unionFilter]
    );

    if (registration) {
      return {
        exists: true,
        client: null,
        union: registration.union_name ?? unionName ?? null,
        details: registration,
        status: registration.status || "pending",
        has_funds: false,
        is_active: false,
      };
    }

    return { exists: false, client: null, union: unionName ?? null, details: null, status: null, has_funds: false, is_active: false };
  } catch {
    return { exists: false, client: null, union: unionName ?? null, details: null, status: null, has_funds: false, is_active: false };
  }
}

/**
 * Full offline workspace for any CO screen:
 * clients (with loans + savings), unions, disbursements/loans.
 */
export async function loadOfflineWorkspace(officerUsername?: string): Promise<{
  clients: any[];
  unions: any[];
  unionNames: string[];
  disbursements: any[];
  loans: any[];
}> {
  try {
    const [clients, unions, disbursements] = await Promise.all([
      loadCachedClients(officerUsername),
      loadCachedUnions(),
      loadCachedDisbursements(officerUsername),
    ]);

    const unionNames = Array.from(
      new Set([
        ...unions.map((u: any) => (typeof u === "string" ? u : u?.name)).filter(Boolean),
        ...clients.map((c: any) => c.union || c.union_name).filter(Boolean),
      ])
    ) as string[];

    return {
      clients: attachCachedLoans(clients || [], disbursements || []),
      unions: unions || [],
      unionNames: unionNames.sort((a, b) => a.localeCompare(b)),
      disbursements: disbursements || [],
      loans: disbursements || [],
    };
  } catch (err) {
    console.log("loadOfflineWorkspace error:", err);
    return {
      clients: [],
      unions: [],
      unionNames: [],
      disbursements: [],
      loans: [],
    };
  }
}

// ─── Unions ──────────────────────────────────────────────────────────────────

export async function cacheUnions(unions: any[], officerUsername?: string): Promise<void> {
  if (!Array.isArray(unions) || unions.length === 0) return;
  const db = await getDb();
  const now = new Date().toISOString();

  await runInTransaction(db, async () => {
    for (const u of unions) {
      const uuid = String(u.uuid || u.id || u.name || "");
      if (!uuid) continue;
      await db.runAsync(
        `INSERT INTO unions (uuid, name, description, branch, client_count, officer_username, is_pending_sync, raw_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uuid) DO UPDATE SET
           name=excluded.name, description=excluded.description, branch=excluded.branch,
           client_count=excluded.client_count, officer_username=excluded.officer_username,
           is_pending_sync=excluded.is_pending_sync, raw_json=excluded.raw_json, updated_at=excluded.updated_at`,
        [
          uuid,
          u.name || "",
          u.description || "",
          u.branch || null,
          Number(u.client_count || 0),
          officerUsername || null,
          u.isPendingSync ? 1 : 0,
          JSON.stringify(u),
          now,
        ]
      );
    }
  });
}

export async function loadCachedUnions(): Promise<any[]> {
  try {
    const db = await getDb();
    const rows = await db.getAllAsync(`SELECT * FROM unions ORDER BY name`);
    return (rows || []).map((r: any) => {
      try {
        const parsed = r.raw_json ? JSON.parse(r.raw_json) : null;
        if (parsed) return { ...parsed, isPendingSync: !!r.is_pending_sync };
      } catch {}
      return {
        uuid: r.uuid,
        name: r.name,
        description: r.description,
        branch: r.branch,
        client_count: r.client_count,
        clients: [],
        isPendingSync: !!r.is_pending_sync,
      };
    });
  } catch {
    return [];
  }
}

export async function cacheLoanPlans(plans: any[]): Promise<void> {
  await AsyncStorage.setItem(
    "cupad_cache_loan_plans",
    JSON.stringify(Array.isArray(plans) ? plans : [])
  );
}

export async function loadCachedLoanPlans(): Promise<any[]> {
  try {
    const raw = await AsyncStorage.getItem("cupad_cache_loan_plans");
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

// ─── Loans / Disbursements ───────────────────────────────────────────────────

export async function cacheDisbursements(
  disbursements: any[],
  officerUsername?: string
): Promise<void> {
  if (!Array.isArray(disbursements) || disbursements.length === 0) return;
  const db = await getDb();
  const now = new Date().toISOString();

  await runInTransaction(db, async () => {
    for (const d of disbursements) {
      const id = String(d.id ?? d.loan_id ?? d.transaction_id ?? "");
      if (!id) continue;
      await db.runAsync(
        `INSERT INTO loans (id, client_id, principal, total_payable, remaining_balance, num_installments, interest_rate, status, disbursement_date, payoff_date, plan_type, officer_username, raw_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           principal=excluded.principal, total_payable=excluded.total_payable,
           remaining_balance=excluded.remaining_balance, num_installments=excluded.num_installments,
           status=excluded.status, payoff_date=excluded.payoff_date, raw_json=excluded.raw_json,
           updated_at=excluded.updated_at`,
        [
          id,
          String(d.client_id ?? ""),
          Number(d.principal || 0),
          Number(d.total_payable || 0),
          Number(d.remaining_balance ?? d.total_payable ?? 0),
          Number(d.num_installments || d.installments || 23),
          Number(d.interest_rate || 0.15),
          d.status || "active",
          d.date || d.disbursement_date || null,
          d.payoff_date || null,
          d.plan_type || d.loan_term_type || null,
          officerUsername || null,
          JSON.stringify(d),
          now,
        ]
      );

      // Keep in disbursements table for audit and history screens
      await db.runAsync(
        `INSERT INTO disbursements (id, client_id, client_name, principal, total_payable, remaining_balance, installments, plan_type, date, payoff_date, union_name, officer_username, synced, raw_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           principal=excluded.principal, total_payable=excluded.total_payable,
           remaining_balance=excluded.remaining_balance, updated_at=excluded.updated_at,
           raw_json=excluded.raw_json`,
        [
          id,
          String(d.client_id ?? ""),
          d.client_name || null,
          Number(d.principal || 0),
          Number(d.total_payable || 0),
          Number(d.remaining_balance ?? d.total_payable ?? 0),
          Number(d.num_installments || d.installments || 23),
          d.plan_type || null,
          d.date || null,
          d.payoff_date || null,
          d.union || d.union_name || null,
          officerUsername || null,
          JSON.stringify(d),
          now,
        ]
      );
    }
  });
}

export async function loadCachedDisbursements(officerUsername?: string): Promise<any[]> {
  try {
    const db = await getDb();
    let rows: any[];
    if (officerUsername) {
      rows = await db.getAllAsync(
        `SELECT * FROM disbursements WHERE officer_username = ? OR officer_username IS NULL ORDER BY date DESC LIMIT 100`,
        [officerUsername]
      );
    } else {
      rows = await db.getAllAsync(`SELECT * FROM disbursements ORDER BY date DESC LIMIT 100`);
    }

    return (rows || []).map((r: any) => {
      try {
        if (r.raw_json) {
          const parsed = JSON.parse(r.raw_json);
          return {
            ...parsed,
            transaction_id: r.id,
            id: r.id,
            client_id: r.client_id,
            client_name: r.client_name || parsed.client_name || "Borrower",
            principal: Number(r.principal ?? parsed.principal ?? 0),
            total_payable: Number(r.total_payable ?? parsed.total_payable ?? 0),
            remaining_balance: Number(r.remaining_balance ?? parsed.remaining_balance ?? 0),
            num_installments: Number(r.installments ?? parsed.num_installments ?? 23),
            status:
              Number(r.remaining_balance ?? parsed.remaining_balance ?? 0) <= 0.01
                ? "completed"
                : parsed.status || "active",
            union: r.union_name || parsed.union || parsed.union_name || "",
            offline: r.synced === 0 || !!parsed.offline,
          };
        }
      } catch {}
      return {
        id: r.id,
        transaction_id: r.id,
        client_id: r.client_id,
        client_name: r.client_name || "Borrower",
        principal: Number(r.principal || 0),
        total_payable: Number(r.total_payable || 0),
        remaining_balance: Number(r.remaining_balance || 0),
        installments: Number(r.installments || 23),
        plan_type: r.plan_type || "Standard",
        date: r.date,
        payoff_date: r.payoff_date,
        union: r.union_name || "",
        union_name: r.union_name || "",
        offline: r.synced === 0,
      };
    });
  } catch {
    return [];
  }
}

function attachCachedLoans(clients: any[], disbursements: any[]): any[] {
  const latestLoans = new Map<string, any>();
  for (const disbursement of disbursements) {
    const clientId = String(disbursement?.client_id ?? "");
    if (clientId && !latestLoans.has(clientId)) latestLoans.set(clientId, disbursement);
  }

  return clients.map((client) => {
    const disbursement = latestLoans.get(String(client.id ?? client.client_id ?? ""));
    if (!disbursement) return client;
    const remaining = Number(disbursement.remaining_balance || 0);
    return {
      ...client,
      loan: {
        ...client.loan,
        id: disbursement.id,
        client_id: disbursement.client_id,
        principal: Number(disbursement.principal || 0),
        total_payable: Number(disbursement.total_payable || 0),
        remaining_balance: remaining,
        num_installments: Number(disbursement.num_installments || disbursement.installments || 23),
        inst_amt:
          Number(disbursement.inst_amt) ||
          Math.round(Number(disbursement.total_payable || 0) / Number(disbursement.num_installments || disbursement.installments || 23)),
        status: remaining <= 0.01 ? "completed" : disbursement.status || "active",
      },
    };
  });
}

// ─── Repayment Offline API (used by repayment.tsx & combined.tsx) ────────────

export async function cacheRepaymentDataLocally(
  clients: any[],
  disbursements: any[],
  officerUsername?: string
): Promise<void> {
  // Run sequentially to guarantee no concurrent transaction collisions on SQLite
  await cacheClients(clients, officerUsername);
  await cacheDisbursements(disbursements, officerUsername);
  await setMeta("repay_last_cache", new Date().toISOString());
}

export async function loadCachedRepayments(): Promise<{
  clients: any[];
  disbursements: any[];
}> {
  const [clients, disbursements] = await Promise.all([
    loadCachedClients(),
    loadCachedDisbursements(),
  ]);
  return { clients: attachCachedLoans(clients, disbursements), disbursements };
}

export async function saveRepaymentOffline(payload: {
  tempTxId: string;
  clientId: string | number;
  clientName?: string;
  unionName?: string;
  amount: number;
  date: string;
  remainingBalance: number;
  officer: string;
  numInstallments?: number;
  isCustom?: boolean;
  loanId?: string | number;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = (await db.getFirstAsync(
    `SELECT temp_tx_id, synced FROM loan_collections WHERE temp_tx_id = ? OR temp_tx_id LIKE ? ORDER BY id DESC LIMIT 1`,
    [payload.tempTxId, `${payload.tempTxId}-%`]
  )) as { temp_tx_id: string; synced: number } | null;
  const tempTxId =
    existing && Number(existing.synced) !== 0
      ? `${payload.tempTxId}-${Date.now().toString(36)}`
      : existing?.temp_tx_id || payload.tempTxId;
  const offlinePayload = { ...payload, tempTxId };

  await db.runAsync(
    `INSERT OR REPLACE INTO loan_collections
      (temp_tx_id, client_id, client_name, union_name, loan_id, amount, remaining_balance, num_installments, is_custom, date, officer_username, synced, status, attempts, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', 0, ?)`,
    [
      tempTxId,
      String(payload.clientId),
      payload.clientName || null,
      payload.unionName || null,
      payload.loanId ? String(payload.loanId) : null,
      Number(payload.amount),
      Number(payload.remainingBalance),
      Number(payload.numInstallments || 1),
      payload.isCustom ? 1 : 0,
      payload.date,
      payload.officer,
      now,
    ]
  );

  const cachedLoan = (await db.getFirstAsync(
    `SELECT id FROM loans WHERE id = ? OR client_id = ? ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, disbursement_date DESC LIMIT 1`,
    [String(payload.loanId || ""), String(payload.clientId), String(payload.loanId || "")]
  )) as { id: string } | null;
  if (cachedLoan) {
    await db.runAsync(
      `UPDATE loans SET remaining_balance = ?, status = ?, updated_at = ? WHERE id = ?`,
      [
        Number(payload.remainingBalance),
        Number(payload.remainingBalance) <= 0.01 ? "completed" : "active",
        now,
        cachedLoan.id,
      ]
    );
  }

  const cachedDisbursement = (await db.getFirstAsync(
    `SELECT id FROM disbursements WHERE client_id = ? ORDER BY date DESC LIMIT 1`,
    [String(payload.clientId)]
  )) as { id: string } | null;
  if (cachedDisbursement) {
    await db.runAsync(
      `UPDATE disbursements SET remaining_balance = ?, updated_at = ? WHERE id = ?`,
      [Number(payload.remainingBalance), now, cachedDisbursement.id]
    );
  }
  await db.runAsync(
    `UPDATE clients SET outstanding_loan = ?, updated_at = ? WHERE id = ?`,
    [Number(payload.remainingBalance), now, String(payload.clientId)]
  );

  const syncData = JSON.stringify(offlinePayload);
  const queued = (await db.getFirstAsync(
    `SELECT id FROM sync_queue WHERE type = 'repayment' AND data LIKE ? AND synced = 0 LIMIT 1`,
    [`%${tempTxId}%`]
  )) as { id: number } | null;
  if (queued) {
    await db.runAsync(`UPDATE sync_queue SET data = ?, created_at = ? WHERE id = ?`, [
      syncData,
      now,
      queued.id,
    ]);
  } else {
    await db.runAsync(
      `INSERT INTO sync_queue (type, data, synced, created_at) VALUES (?, ?, 0, ?)`,
      ["repayment", syncData, now]
    );
  }
}

export async function getPendingRepaymentsCount(): Promise<number> {
  try {
    const db = await getDb();
    const row = (await db.getFirstAsync(
      `SELECT COUNT(*) as c FROM loan_collections WHERE synced = 0`
    )) as any;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

export async function processRepaymentPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
  errors?: string[];
}> {
  const db = await getDb();
  let syncedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  const pending = (await db.getAllAsync(
    `SELECT * FROM loan_collections WHERE synced = 0 AND status != 'abandoned' ORDER BY created_at ASC LIMIT 50`
  )) as any[];

  if (!pending?.length) return { syncedCount: 0, failedCount: 0, errors: [] };

  let username = "";
  try {
    const stored = await AsyncStorage.getItem("cupad_user");
    if (stored) username = JSON.parse(stored).username || "";
  } catch {}

  for (const item of pending) {
    const officer = item.officer_username || username;
    const isCustom = Number(item.is_custom) === 1 || item.is_custom === true;
    const numInst = Math.max(1, Number(item.num_installments || 1));
    const payload: any = {
      action: "record_repayment",
      client_id: item.client_id,
      num_installments: isCustom ? 1 : numInst,
      custom_pay_amount: isCustom ? Number(item.amount) : 0,
      officer: officer,
      username: officer,
      date: item.date,
      offline_ref: item.temp_tx_id,
      amount: Number(item.amount),
      is_custom: isCustom ? 1 : 0,
    };
    if (item.loan_id) payload.loan_id = item.loan_id;

    try {
      const res = await axios.post(
        `${API_BASE}/api/loan_collection_api.php`,
        payload,
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );

      if (res.data?.success) {
        await db.runAsync(
          `UPDATE loan_collections SET synced = 1, status = 'synced', last_error = NULL WHERE id = ?`,
          [item.id]
        );
        try {
          await db.runAsync(
            `UPDATE sync_queue SET synced = 1 WHERE type = 'repayment' AND data LIKE ? AND synced = 0`,
            [`%${item.temp_tx_id}%`]
          );
        } catch {}
        syncedCount++;
      } else {
        const msg = res.data?.message || "Server rejected repayment";
        errors.push(`${item.client_name || item.client_id}: ${msg}`);
        await db.runAsync(
          `UPDATE loan_collections SET attempts = attempts + 1, last_error = ? WHERE id = ?`,
          [msg, item.id]
        );
        failedCount++;
      }
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.message ||
        "Network error";
      errors.push(`${item.client_name || item.client_id}: ${msg}`);
      await db.runAsync(
        `UPDATE loan_collections SET attempts = attempts + 1, last_error = ? WHERE id = ?`,
        [String(msg).slice(0, 200), item.id]
      );
      failedCount++;
    }
  }

  return { syncedCount, failedCount, errors };
}

export async function clearStuckPendingRepayments(): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE loan_collections SET synced = 1, status = 'abandoned' WHERE synced = 0 AND attempts >= 10`
  );
}

// ─── Savings Offline ─────────────────────────────────────────────────────────

export async function saveSavingsOffline(payload: {
  tempId: string;
  clientId: string | number;
  clientName?: string;
  amount: number;
  date: string;
  officer: string;
  union?: string;
  balanceAfter?: number;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const amount = Number(payload.amount);
  const existing = (await db.getFirstAsync(
    `SELECT id, amount, synced, transaction_id FROM savings WHERE (transaction_id = ? OR transaction_id LIKE ?) AND is_offline = 1 ORDER BY id DESC LIMIT 1`,
    [payload.tempId, `${payload.tempId}-%`]
  )) as { id: number; amount: number; synced: number; transaction_id: string } | null;
  let transactionId = payload.tempId;
  const canUpdatePending = existing && Number(existing.synced) === 0;

  if (canUpdatePending) {
    transactionId = existing.transaction_id;
    await db.runAsync(
      `UPDATE savings SET amount = ?, balance_after = ?, date = ?, officer_username = ?, union_name = ? WHERE id = ?`,
      [
        amount,
        payload.balanceAfter ?? null,
        payload.date,
        payload.officer,
        payload.union || null,
        existing.id,
      ]
    );
  } else {
    if (existing) transactionId = `${payload.tempId}-${Date.now().toString(36)}`;
    await db.runAsync(
      `INSERT INTO savings (client_id, amount, balance_after, date, transaction_id, officer_username, union_name, is_offline, synced, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, ?)`,
      [
        String(payload.clientId),
        amount,
        payload.balanceAfter ?? null,
        payload.date,
        transactionId,
        payload.officer,
        payload.union || null,
        now,
      ]
    );
  }

  if (payload.balanceAfter != null) {
    await db.runAsync(
      `UPDATE clients SET savings_balance = ?, updated_at = ? WHERE id = ?`,
      [Number(payload.balanceAfter), now, String(payload.clientId)]
    );
  } else {
    await db.runAsync(
      `UPDATE clients SET savings_balance = COALESCE(savings_balance, 0) + ?, updated_at = ? WHERE id = ?`,
      [canUpdatePending ? amount - Number(existing.amount) : amount, now, String(payload.clientId)]
    );
  }

  const syncData = JSON.stringify({ ...payload, tempId: transactionId });
  const queued = await db.getFirstAsync(
    `SELECT id FROM sync_queue WHERE type = 'savings' AND data LIKE ? AND synced = 0 LIMIT 1`,
    [`%${payload.tempId}%`]
  );
  if (queued) {
    await db.runAsync(
      `UPDATE sync_queue SET data = ?, created_at = ? WHERE id = ?`,
      [syncData, now, (queued as { id: number }).id]
    );
  } else {
    await db.runAsync(
      `INSERT INTO sync_queue (type, data, synced, created_at) VALUES (?, ?, 0, ?)`,
      ["savings", syncData, now]
    );
  }
}

export async function getPendingSavingsCount(): Promise<number> {
  try {
    const db = await getDb();
    const row = (await db.getFirstAsync(
      `SELECT COUNT(*) as c FROM savings WHERE synced = 0 AND is_offline = 1`
    )) as any;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

export async function processSavingsPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  const db = await getDb();
  let syncedCount = 0;
  let failedCount = 0;

  const pending = (await db.getAllAsync(
    `SELECT * FROM savings WHERE synced = 0 AND is_offline = 1 ORDER BY created_at ASC LIMIT 50`
  )) as any[];

  if (!pending?.length) return { syncedCount: 0, failedCount: 0 };

  let username = "";
  try {
    const stored = await AsyncStorage.getItem("cupad_user");
    if (stored) username = JSON.parse(stored).username || "";
  } catch {}

  for (const item of pending) {
    try {
      const officer = item.officer_username || username;
      const res = await axios.post(
        `${API_BASE}/api/savings_api.php`,
        {
          action: "record_savings",
          client_id: item.client_id,
          amount: Number(item.amount),
          date: item.date,
          officer: officer,
          username: officer,
          temp_id: item.transaction_id,
          offline_ref: item.transaction_id,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
        }
      );

      if (res.data?.success) {
        await db.runAsync(`UPDATE savings SET synced = 1 WHERE id = ?`, [item.id]);
        try {
          await db.runAsync(
            `UPDATE sync_queue SET synced = 1 WHERE type = 'savings' AND data LIKE ? AND synced = 0`,
            [`%${item.transaction_id}%`]
          );
        } catch {}
        syncedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  return { syncedCount, failedCount };
}

// ─── Client Registration Offline ─────────────────────────────────────────────

export async function saveRegistrationOffline(payload: any): Promise<string> {
  const db = await getDb();
  const tempId = payload.temp_id || `REG-OFF-${Date.now()}`;
  const now = new Date().toISOString();

  await db.runAsync(
    `INSERT INTO registrations
      (temp_id, name, phone, address, union_name, plan_id, branch, guarantor_name, guarantor_phone, guarantor_relationship, officer_username, payload_json, synced, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)`,
    [
      tempId,
      payload.name || "",
      payload.phone || null,
      payload.address || null,
      payload.union || payload.union_name || null,
      payload.plan_id ? String(payload.plan_id) : null,
      payload.branch || null,
      payload.guarantor_name || null,
      payload.guarantor_phone || null,
      payload.guarantor_relationship || null,
      payload.officer_username || null,
      JSON.stringify(payload),
      now,
    ]
  );

  await db.runAsync(
    `INSERT INTO sync_queue (type, data, synced, created_at) VALUES (?, ?, 0, ?)`,
    ["registration", JSON.stringify({ ...payload, temp_id: tempId }), now]
  );

  return tempId;
}

export async function getPendingRegistrationsCount(): Promise<number> {
  try {
    const db = await getDb();
    const row = (await db.getFirstAsync(
      `SELECT COUNT(*) as c FROM registrations WHERE synced = 0`
    )) as any;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

export async function processRegistrationsPendingSync(
  _officerUsername?: string
): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  const db = await getDb();
  let syncedCount = 0;
  let failedCount = 0;

  const pending = (await db.getAllAsync(
    `SELECT * FROM registrations WHERE synced = 0 ORDER BY created_at ASC LIMIT 30`
  )) as any[];

  for (const item of pending) {
    try {
      let payload: any = {};
      try {
        payload = item.payload_json ? JSON.parse(item.payload_json) : {};
      } catch {}

      const res = await axios.post(
        `${API_BASE}/api/registration_api.php?action=add_client`,
        {
          ...payload,
          name: item.name,
          phone: item.phone,
          address: item.address,
          union: item.union_name,
          plan_id: item.plan_id,
          branch: item.branch,
          guarantor_name: item.guarantor_name,
          guarantor_phone: item.guarantor_phone,
          guarantor_relationship: item.guarantor_relationship,
          officer_username: item.officer_username,
          offline_ref: item.temp_id,
        },
        { timeout: 12000 }
      );

      if (res.data?.success) {
        await db.runAsync(
          `UPDATE registrations SET synced = 1, status = 'synced' WHERE id = ?`,
          [item.id]
        );
        syncedCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  return { syncedCount, failedCount };
}

// ─── Withdrawal Offline ──────────────────────────────────────────────────────

export async function saveWithdrawalOffline(payload: {
  tempTxId: string;
  clientId: string | number;
  clientName?: string;
  amount: number;
  type: string;
  balanceAfter?: number;
  date: string;
  officer: string;
  union?: string;
  notes?: string;
}): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  const existing = (await db.getFirstAsync(
    `SELECT temp_tx_id, synced, amount, type FROM withdrawals WHERE temp_tx_id = ? OR temp_tx_id LIKE ? ORDER BY id DESC LIMIT 1`,
    [payload.tempTxId, `${payload.tempTxId}-%`]
  )) as { temp_tx_id: string; synced: number; amount: number; type: string } | null;
  const canUpdatePending = existing && Number(existing.synced) === 0;
  const tempTxId =
    existing && !canUpdatePending
      ? `${payload.tempTxId}-${Date.now().toString(36)}`
      : existing?.temp_tx_id || payload.tempTxId;
  const offlinePayload = { ...payload, tempTxId };

  await db.runAsync(
    `INSERT OR REPLACE INTO withdrawals
      (temp_tx_id, client_id, client_name, amount, type, balance_after, date, officer_username, union_name, notes, synced, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)`,
    [
      tempTxId,
      String(payload.clientId),
      payload.clientName || null,
      Number(payload.amount),
      payload.type,
      payload.balanceAfter ?? null,
      payload.date,
      payload.officer,
      payload.union || null,
      payload.notes || null,
      now,
    ]
  );

  if (payload.balanceAfter != null) {
    await db.runAsync(
      `UPDATE clients SET savings_balance = ?, updated_at = ? WHERE id = ?`,
      [Number(payload.balanceAfter), now, String(payload.clientId)]
    );
  }
  const oldLoanReturn = canUpdatePending && existing?.type === "return" ? Number(existing.amount) : 0;
  const newLoanReturn = payload.type === "return" ? Number(payload.amount) : 0;
  const loanAdjustment = newLoanReturn - oldLoanReturn;
  if (loanAdjustment !== 0) {
    const loanBalanceExpr = `MAX(0, COALESCE(remaining_balance, 0) - (${loanAdjustment}))`;
    await db.runAsync(
      `UPDATE loans SET remaining_balance = ${loanBalanceExpr}, status = CASE WHEN ${loanBalanceExpr} <= 0.01 THEN 'completed' ELSE 'active' END, updated_at = ? WHERE id = (
        SELECT id FROM loans WHERE client_id = ? ORDER BY disbursement_date DESC LIMIT 1
      )`,
      [now, String(payload.clientId)]
    );
    await db.runAsync(
      `UPDATE disbursements SET remaining_balance = ${loanBalanceExpr}, updated_at = ? WHERE id = (
        SELECT id FROM disbursements WHERE client_id = ? ORDER BY date DESC LIMIT 1
      )`,
      [now, String(payload.clientId)]
    );
    await db.runAsync(
      `UPDATE clients SET outstanding_loan = ${loanBalanceExpr}, updated_at = ? WHERE id = ?`,
      [now, String(payload.clientId)]
    );
  }

  const syncData = JSON.stringify(offlinePayload);
  const queued = (await db.getFirstAsync(
    `SELECT id FROM sync_queue WHERE type = 'withdrawal' AND data LIKE ? AND synced = 0 LIMIT 1`,
    [`%${tempTxId}%`]
  )) as { id: number } | null;
  if (queued) {
    await db.runAsync(`UPDATE sync_queue SET data = ?, created_at = ? WHERE id = ?`, [
      syncData,
      now,
      queued.id,
    ]);
  } else {
    await db.runAsync(
      `INSERT INTO sync_queue (type, data, synced, created_at) VALUES (?, ?, 0, ?)`,
      ["withdrawal", syncData, now]
    );
  }
}

export async function cancelPendingOfflineTransaction(
  type: "repayment" | "savings" | "withdrawal",
  transactionId: string
): Promise<void> {
  const db = await getDb();
  const pattern = `${transactionId}-%`;
  const now = new Date().toISOString();

  if (type === "repayment") {
    const row = (await db.getFirstAsync(
      `SELECT * FROM loan_collections WHERE (temp_tx_id = ? OR temp_tx_id LIKE ?) AND synced = 0 ORDER BY id DESC LIMIT 1`,
      [transactionId, pattern]
    )) as any;
    if (!row) return;
    await db.runAsync(`DELETE FROM loan_collections WHERE id = ?`, [row.id]);
    if (row.loan_id) {
      await db.runAsync(
        `UPDATE loans SET remaining_balance = remaining_balance + ?, status = 'active', updated_at = ? WHERE id = ?`,
        [Number(row.amount), now, row.loan_id]
      );
    }
    await db.runAsync(
      `UPDATE disbursements SET remaining_balance = remaining_balance + ?, updated_at = ? WHERE id = (
        SELECT id FROM disbursements WHERE client_id = ? ORDER BY date DESC LIMIT 1
      )`,
      [Number(row.amount), now, row.client_id]
    );
    await db.runAsync(
      `UPDATE clients SET outstanding_loan = outstanding_loan + ?, updated_at = ? WHERE id = ?`,
      [Number(row.amount), now, row.client_id]
    );
    await db.runAsync(
      `DELETE FROM sync_queue WHERE type = 'repayment' AND synced = 0 AND data LIKE ?`,
      [`%${row.temp_tx_id}%`]
    );
    return;
  }

  if (type === "savings") {
    const row = (await db.getFirstAsync(
      `SELECT id, amount, transaction_id, client_id FROM savings WHERE (transaction_id = ? OR transaction_id LIKE ?) AND is_offline = 1 AND synced = 0 ORDER BY id DESC LIMIT 1`,
      [transactionId, pattern]
    )) as any;
    if (!row) return;
    await db.runAsync(`DELETE FROM savings WHERE id = ?`, [row.id]);
    await db.runAsync(
      `UPDATE clients SET savings_balance = MAX(0, COALESCE(savings_balance, 0) - ?), updated_at = ? WHERE id = ?`,
      [Number(row.amount), now, row.client_id]
    );
    await db.runAsync(
      `DELETE FROM sync_queue WHERE type = 'savings' AND synced = 0 AND data LIKE ?`,
      [`%${row.transaction_id}%`]
    );
    return;
  }

  const row = (await db.getFirstAsync(
    `SELECT id, amount, type, temp_tx_id, client_id FROM withdrawals WHERE (temp_tx_id = ? OR temp_tx_id LIKE ?) AND synced = 0 ORDER BY id DESC LIMIT 1`,
    [transactionId, pattern]
  )) as any;
  if (!row) return;
  await db.runAsync(`DELETE FROM withdrawals WHERE id = ?`, [row.id]);
  await db.runAsync(
    `UPDATE clients SET savings_balance = COALESCE(savings_balance, 0) + ?, updated_at = ? WHERE id = ?`,
    [Number(row.amount), now, row.client_id]
  );
  if (row.type === "return") {
    await db.runAsync(
      `UPDATE loans SET remaining_balance = remaining_balance + ?, status = 'active', updated_at = ? WHERE id = (
        SELECT id FROM loans WHERE client_id = ? ORDER BY disbursement_date DESC LIMIT 1
      )`,
      [Number(row.amount), now, row.client_id]
    );
    await db.runAsync(
      `UPDATE disbursements SET remaining_balance = remaining_balance + ?, updated_at = ? WHERE id = (
        SELECT id FROM disbursements WHERE client_id = ? ORDER BY date DESC LIMIT 1
      )`,
      [Number(row.amount), now, row.client_id]
    );
    await db.runAsync(
      `UPDATE clients SET outstanding_loan = outstanding_loan + ?, updated_at = ? WHERE id = ?`,
      [Number(row.amount), now, row.client_id]
    );
  }
  await db.runAsync(
    `DELETE FROM sync_queue WHERE type = 'withdrawal' AND synced = 0 AND data LIKE ?`,
    [`%${row.temp_tx_id}%`]
  );
}

export async function getPendingWithdrawalsCount(): Promise<number> {
  try {
    const db = await getDb();
    const row = (await db.getFirstAsync(
      `SELECT COUNT(*) as c FROM withdrawals WHERE synced = 0`
    )) as any;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

export async function processWithdrawalsPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
}> {
  let syncedCount = 0;
  let failedCount = 0;
  try {
    const db = await getDb();
    const pending = (await db.getAllAsync(
      `SELECT * FROM withdrawals WHERE synced = 0 ORDER BY created_at ASC LIMIT 30`
    )) as any[];

    for (const row of pending) {
      try {
        const payload: any = {
          action: "record_withdrawal",
          client_id: row.client_id,
          type: row.type || "withdrawal",
          amount: Number(row.amount),
          officer: row.officer_username || "",
          username: row.officer_username || "",
          date: row.date,
          offline_tx_id: row.temp_tx_id,
          temp_id: row.temp_tx_id,
        };
        if (row.union_name) payload.union = row.union_name;
        if (row.notes) payload.notes = row.notes;

        const res = await axios.post(
          `${API_BASE}/api/saving_withdrawal_api.php`,
          payload,
          { headers: { "Content-Type": "application/json" }, timeout: 15000 }
        );

        if (res.data?.success) {
          await db.runAsync(
            `UPDATE withdrawals SET synced = 1, status = 'synced' WHERE id = ?`,
            [row.id]
          );
          await db.runAsync(
            `UPDATE sync_queue SET synced = 1 WHERE type = 'withdrawal' AND data LIKE ? AND synced = 0`,
            [`%${row.temp_tx_id}%`]
          );
          syncedCount++;
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
    }
  } catch {}
  return { syncedCount, failedCount };
}

// ─── Disbursement Offline ────────────────────────────────────────────────────

export async function saveDisbursementOffline(payload: {
  tempTxId: string;
  clientId: string | number;
  clientName?: string;
  principal: number;
  totalPayable?: number;
  remainingBalance?: number;
  installments?: number;
  planType?: string;
  date: string;
  payoffDate?: string;
  officer: string;
  union?: string;
  pictureBase64?: string | null;
}): Promise<string> {
  const db = await getDb();
  const now = new Date().toISOString();
  const id = payload.tempTxId || `DISB-OFF-${Date.now()}`;

  const cleanEntry = {
    ...payload,
    id,
    transaction_id: id,
    offline: true,
  };

  await db.runAsync(
    `INSERT OR REPLACE INTO disbursements
      (id, client_id, client_name, principal, total_payable, remaining_balance, installments, plan_type, date, payoff_date, union_name, officer_username, synced, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      String(payload.clientId),
      payload.clientName || null,
      Number(payload.principal),
      Number(payload.totalPayable ?? payload.principal),
      Number(payload.remainingBalance ?? payload.totalPayable ?? payload.principal),
      Number(payload.installments ?? 23),
      payload.planType || null,
      payload.date,
      payload.payoffDate || null,
      payload.union || null,
      payload.officer,
      JSON.stringify(cleanEntry),
      now,
    ]
  );

  // Keep active loans updated for offline repayment flow
  await db.runAsync(
    `INSERT OR REPLACE INTO loans
      (id, client_id, principal, total_payable, remaining_balance, num_installments, interest_rate, status, disbursement_date, payoff_date, plan_type, officer_username, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    [
      id,
      String(payload.clientId),
      Number(payload.principal),
      Number(payload.totalPayable ?? payload.principal),
      Number(payload.remainingBalance ?? payload.totalPayable ?? payload.principal),
      Number(payload.installments ?? 23),
      0.15,
      payload.date,
      payload.payoffDate || null,
      payload.planType || null,
      payload.officer,
      JSON.stringify(cleanEntry),
      now,
    ]
  );

  // Update client's outstanding loan offline
  const loanBal = Number(payload.remainingBalance ?? payload.totalPayable ?? payload.principal);
  const principal = Number(payload.principal);
  try {
    const existing = (await db.getFirstAsync(
      `SELECT raw_json FROM clients WHERE id = ?`,
      [String(payload.clientId)]
    )) as any;
    let merged: any = {};
    try {
      merged = existing?.raw_json ? JSON.parse(existing.raw_json) : {};
    } catch {}
    merged.outstanding_loan = loanBal;
    merged.loan_balance = loanBal;
    merged.loan_principal = principal;
    merged.has_active_loan = true;
    await db.runAsync(
      `UPDATE clients SET outstanding_loan = ?, loan_principal = ?, raw_json = ?, updated_at = ? WHERE id = ?`,
      [loanBal, principal, JSON.stringify(merged), now, String(payload.clientId)]
    );
  } catch {
    await db.runAsync(
      `UPDATE clients SET outstanding_loan = ?, loan_principal = ?, updated_at = ? WHERE id = ?`,
      [loanBal, principal, now, String(payload.clientId)]
    );
  }

  await db.runAsync(
    `INSERT INTO sync_queue (type, data, synced, created_at) VALUES (?, ?, 0, ?)`,
    ["disbursement", JSON.stringify(cleanEntry), now]
  );

  return id;
}

export async function getPendingDisbursementsCount(): Promise<number> {
  try {
    const db = await getDb();
    const row = (await db.getFirstAsync(
      `SELECT COUNT(*) as c FROM disbursements WHERE synced = 0`
    )) as any;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

/**
 * Sync offline disbursements with server.
 * Returns an object that satisfies both `if (synced > 0)` and `synced.syncedCount`.
 */
export async function processDisbursementsPendingSync(): Promise<{
  syncedCount: number;
  failedCount: number;
  valueOf: () => number;
}> {
  let syncedCount = 0;
  let failedCount = 0;
  try {
    const db = await getDb();
    const pending = (await db.getAllAsync(
      `SELECT * FROM disbursements WHERE synced = 0 ORDER BY date ASC LIMIT 20`
    )) as any[];

    for (const row of pending) {
      try {
        let extra: any = {};
        try {
          extra = row.raw_json ? JSON.parse(row.raw_json) : {};
        } catch {}

        const payload = {
          action: "record_disbursement",
          client_id: row.client_id,
          principal_amount: Number(row.principal),
          officer: row.officer_username,
          picture_base64: extra.pictureBase64 || null,
          date: row.date,
          offline_tx_id: row.id,
        };

        const res = await axios.post(
          `${API_BASE}/api/disbursement_api.php`,
          payload,
          { headers: { "Content-Type": "application/json" }, timeout: 20000 }
        );

        if (res.data?.success) {
          await db.runAsync(
            `UPDATE disbursements SET synced = 1 WHERE id = ?`,
            [row.id]
          );
          await db.runAsync(
            `UPDATE sync_queue SET synced = 1 WHERE type = 'disbursement' AND data LIKE ? AND synced = 0`,
            [`%${row.id}%`]
          );
          syncedCount++;
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
    }
  } catch {}

  const resObj = {
    syncedCount,
    failedCount,
    valueOf: () => syncedCount,
    [Symbol.toPrimitive]: (hint?: string) => (hint === "string" ? String(syncedCount) : syncedCount),
  };
  return resObj as any;
}

export async function enqueueSync(type: string, data: any): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO sync_queue (type, data, synced, created_at) VALUES (?, ?, 0, ?)`,
    [type, JSON.stringify(data), new Date().toISOString()]
  );
}

export async function getPendingSyncCount(): Promise<number> {
  try {
    const db = await getDb();
    const row = (await db.getFirstAsync(
      `SELECT COUNT(*) as c FROM sync_queue WHERE synced = 0`
    )) as any;
    return Number(row?.c || 0);
  } catch {
    return 0;
  }
}

export async function getAllPendingCounts(): Promise<{
  repayments: number;
  savings: number;
  registrations: number;
  withdrawals: number;
  disbursements: number;
  total: number;
}> {
  const [repayments, savingsSql, registrations, withdrawals, disbursements] = await Promise.all([
    getPendingRepaymentsCount(),
    getPendingSavingsCount(),
    getPendingRegistrationsCount(),
    getPendingWithdrawalsCount(),
    getPendingDisbursementsCount(),
  ]);

  let savingsAs = 0;
  let regAs = 0;
  try {
    const sRaw = await AsyncStorage.getItem("cupad_offline_savings_queue");
    if (sRaw) {
      const q = JSON.parse(sRaw);
      if (Array.isArray(q)) savingsAs = q.length;
    }
  } catch {}
  try {
    const rRaw = await AsyncStorage.getItem("cupad_offline_registrations_queue");
    if (rRaw) {
      const q = JSON.parse(rRaw);
      if (Array.isArray(q)) regAs = q.length;
    }
  } catch {}

  const savings = savingsSql + savingsAs;
  const regs = registrations + regAs;
  return {
    repayments,
    savings,
    registrations: regs,
    withdrawals,
    disbursements,
    total: repayments + savings + regs + withdrawals + disbursements,
  };
}

export async function processAsyncStorageOfflineQueues(): Promise<{
  savings: number;
  registrations: number;
  unions: number;
}> {
  let savings = 0;
  let registrations = 0;
  let unions = 0;

  try {
    const raw = await AsyncStorage.getItem("cupad_offline_savings_queue");
    if (raw) {
      const queue: any[] = JSON.parse(raw);
      if (Array.isArray(queue) && queue.length) {
        const remaining: any[] = [];
        for (const item of queue) {
          try {
            const res = await axios.post(
              `${API_BASE}/api/savings_api.php`,
              {
                action: "record_savings",
                client_id: item.client_id,
                amount: Number(item.amount),
                date: item.date,
                officer: item.officer,
                username: item.officer,
                temp_id: item.temp_id,
              },
              { headers: { "Content-Type": "application/json" }, timeout: 12000 }
            );
            if (res.data?.success) savings++;
            else remaining.push(item);
          } catch {
            remaining.push(item);
          }
        }
        await AsyncStorage.setItem(
          "cupad_offline_savings_queue",
          JSON.stringify(remaining)
        );
      }
    }
  } catch {}

  try {
    const raw = await AsyncStorage.getItem("cupad_offline_registrations_queue");
    if (raw) {
      const queue: any[] = JSON.parse(raw);
      if (Array.isArray(queue) && queue.length) {
        const remaining: any[] = [];
        for (const item of queue) {
          try {
            const res = await axios.post(
              `${API_BASE}/api/registration_api.php?action=add_client`,
              {
                ...item,
                offline_ref: item.temp_id || item.offline_ref,
              },
              { headers: { "Content-Type": "application/json" }, timeout: 12000 }
            );
            if (res.data?.success) registrations++;
            else remaining.push(item);
          } catch {
            remaining.push(item);
          }
        }
        await AsyncStorage.setItem(
          "cupad_offline_registrations_queue",
          JSON.stringify(remaining)
        );
      }
    }
  } catch {}

  try {
    const raw = await AsyncStorage.getItem("cupad_offline_unions_queue");
    if (raw) {
      const queue: any[] = JSON.parse(raw);
      if (Array.isArray(queue)) unions = queue.length;
    }
  } catch {}

  return { savings, registrations, unions };
}

export async function processAllPendingSync(): Promise<{
  repayments: { syncedCount: number; failedCount: number };
  savings: { syncedCount: number; failedCount: number };
  registrations: { syncedCount: number; failedCount: number };
  withdrawals: { syncedCount: number; failedCount: number };
  disbursements: { syncedCount: number; failedCount: number };
}> {
  let [repayments, savings, registrations, withdrawals, disbursements] = await Promise.all([
    processRepaymentPendingSync(),
    processSavingsPendingSync(),
    processRegistrationsPendingSync(),
    processWithdrawalsPendingSync(),
    processDisbursementsPendingSync(),
  ]);

  try {
    const db = await getDb();
    const queue = (await db.getAllAsync(
      `SELECT * FROM sync_queue WHERE synced = 0 AND type = 'profile_update' LIMIT 20`
    )) as any[];

    for (const item of queue) {
      try {
        const data = JSON.parse(item.data);
        const form = new FormData();
        form.append("action", "update");
        form.append("username", data.username);
        form.append("full_name", data.full_name || "");
        form.append("email", data.email || "");
        form.append("phone", data.phone || "");
        const res = await axios.post(`${API_BASE}/api/profile.php`, form, {
          headers: { "Content-Type": "multipart/form-data" },
          timeout: 10000,
        });
        if (res.data?.success) {
          await db.runAsync(`UPDATE sync_queue SET synced = 1 WHERE id = ?`, [item.id]);
        }
      } catch {}
    }
  } catch {}

  await setMeta("last_full_sync", new Date().toISOString());

  try {
    const asResult = await processAsyncStorageOfflineQueues();
    if (asResult.savings > 0) {
      savings = {
        syncedCount: (savings?.syncedCount || 0) + asResult.savings,
        failedCount: savings?.failedCount || 0,
      };
    }
    if (asResult.registrations > 0) {
      registrations = {
        syncedCount: (registrations?.syncedCount || 0) + asResult.registrations,
        failedCount: registrations?.failedCount || 0,
      };
    }
  } catch (e) {
    console.log("AsyncStorage queue flush error", e);
  }

  return { repayments, savings, registrations, withdrawals, disbursements };
}

// ─── Offline Stats (used by profile screen) ──────────────────────────────────

export async function getOfflineStats(): Promise<{
  clients: number;
  savings: number;
  loans: number;
  collections: number;
  pendingSync: number;
  lastSync: string | null;
  dbSize: string;
}> {
  const db = await getDb();
  const stats = {
    clients: 0,
    savings: 0,
    loans: 0,
    collections: 0,
    pendingSync: 0,
    lastSync: null as string | null,
    dbSize: "0 items",
  };

  try {
    const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM clients`)) as any;
    stats.clients = r?.c || 0;
  } catch {}
  try {
    const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM savings`)) as any;
    stats.savings = r?.c || 0;
  } catch {}
  try {
    const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM loans`)) as any;
    stats.loans = r?.c || 0;
  } catch {}
  try {
    const r = (await db.getFirstAsync(`SELECT COUNT(*) as c FROM loan_collections`)) as any;
    stats.collections = r?.c || 0;
  } catch {}
  try {
    const counts = await getAllPendingCounts();
    stats.pendingSync = counts.total;
  } catch {}

  stats.lastSync = await getMeta("last_full_sync");
  const total = stats.clients + stats.savings + stats.loans + stats.collections;
  stats.dbSize = total > 1000 ? `${(total / 1000).toFixed(1)}k records` : `${total} items`;
  return stats;
}

// ─── Network helper ──────────────────────────────────────────────────────────

export async function isOnline(): Promise<boolean> {
  try {
    await axios.get(`${API_BASE}/api/dashboard_api.php?action=ping`, {
      timeout: 4000,
      validateStatus: () => true,
    });
    return true;
  } catch (e: any) {
    if (e?.response) return true;
    try {
      await axios.head(API_BASE, { timeout: 3000, validateStatus: () => true });
      return true;
    } catch (e2: any) {
      if (e2?.response) return true;
      return false;
    }
  }
}

export async function autoSyncIfOnline(): Promise<boolean> {
  const online = await isOnline();
  if (!online) return false;
  await processAllPendingSync();
  return true;
}

// ─── Clear / Wipe helpers ────────────────────────────────────────────────────

export async function clearAllOfflineData(): Promise<void> {
  try {
    const db = await getDb();
    await db.execAsync(`
      DELETE FROM clients;
      DELETE FROM unions;
      DELETE FROM loans;
      DELETE FROM savings;
      DELETE FROM savings_collections;
      DELETE FROM loan_collections;
      DELETE FROM withdrawals;
      DELETE FROM disbursements;
      DELETE FROM registrations;
      DELETE FROM sync_queue;
      DELETE FROM meta;
      DELETE FROM users;
      DELETE FROM login_history;
    `);
  } catch (e) {
    console.log("SQLite clear failed", e);
  }

  const KNOWN_KEYS = [
    "cupad_last_sync",
    "cupad_last_backup",
    "cupad_offline_backup",
    "cupad_last_login",
    "cupad_cache_union_names",
    "cupad_cache_unions_full",
    "cupad_cache_loan_plans",
    "cupad_offline_registrations_queue",
    "cupad_offline_unions_queue",
    "cupad_offline_savings_queue",
    "cupad_cache_dashboard_stats",
    "cupad_cache_dashboard_user",
    "cupad_cache_dashboard_activities",
    "cupad_cache_dashboard_unions",
    "cupad_cache_last_sync",
    "cupad_cache_co_clients_list",
    "cupad_cache_co_clients_stats",
    "cupad_cache_close_clients_v3",
    "cupad_cache_co_financial_summary_data",
    "cupad_cache_co_financial_summary_totals",
    "cupad_cache_co_financial_last_sync",
    "cupad_cache_repay_stats",
    "cupad_cache_repay_clients",
    "cupad_cache_repay_disbursements",
    "cupad_cache_repay_settings",
    "cupad_cache_repay_history",
    "cupad_cache_savings_stats",
    "cupad_cache_savings_clients",
    "cupad_cache_savings_transactions",
    "cupad_cache_wth_stats",
    "cupad_cache_wth_clients",
    "cupad_cache_wth_history",
    "cupad_cache_wth_settings",
    "cupad_cache_disb_stats",
    "cupad_cache_disb_clients",
    "cupad_cache_disb_history",
    "cupad_cache_disb_plans",
    "cupad_cache_co_reports",
  ];

  try {
    await AsyncStorage.multiRemove(KNOWN_KEYS);
  } catch {}

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const extra = allKeys.filter(
      (k) =>
        k.startsWith("cupad_cache_") ||
        k.startsWith("cupad_offline_") ||
        k.startsWith("cupad_webdb_")
    );
    if (extra.length > 0) await AsyncStorage.multiRemove(extra);
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

export default {
  getDb,
  upsertUser,
  recordLogin,
  getLoginHistory,
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
  cancelPendingOfflineTransaction,
  getPendingWithdrawalsCount,
  processWithdrawalsPendingSync,
  processDisbursementsPendingSync,
  getPendingDisbursementsCount,
  saveDisbursementOffline,
  enqueueSync,
  getPendingSyncCount,
  getAllPendingCounts,
  processAllPendingSync,
  processAsyncStorageOfflineQueues,
  getOfflineStats,
  isOnline,
  autoSyncIfOnline,
  clearAllOfflineData,
  clearCacheForAccountSwitch,
  setMeta,
  getMeta,
};