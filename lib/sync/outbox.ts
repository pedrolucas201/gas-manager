import type { SQLiteDatabase } from "expo-sqlite";

// The kinds of local events that get pushed to the backend. Fact events go to
// /sync/push; the catalog/void kinds map to their own endpoints (handled by the
// sync engine), but all of them queue here so nothing is lost offline.
export type OutboxKind =
  | "sale"
  | "restock"
  | "stock_adjustment"
  | "stock_set"
  | "debt_settlement"
  | "void_sale"
  | "customer_upsert"
  | "customer_delete"
  | "cylinder_upsert"
  | "expense";

export interface OutboxEntry {
  event_uuid: string;
  kind: OutboxKind;
  payload: string; // JSON body for the request
  client_created_at: string; // ISO 8601
}

export interface PendingEvent extends OutboxEntry {
  id: number;
  attempts: number;
  status: string;
  last_error: string | null;
}

// Called by the sync engine so a write to the outbox triggers an immediate push.
let _onEnqueue: (() => void) | null = null;
export function setEnqueueHook(fn: (() => void) | null): void {
  _onEnqueue = fn;
}

// enqueue adds a pending event. It is idempotent on event_uuid (INSERT OR
// IGNORE), so re-enqueuing the same event after a crash never duplicates it.
export async function enqueue(db: SQLiteDatabase, entry: OutboxEntry): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO sync_outbox (event_uuid, kind, payload, client_created_at)
     VALUES (?, ?, ?, ?)`,
    [entry.event_uuid, entry.kind, entry.payload, entry.client_created_at]
  );
  _onEnqueue?.();
}

// pendingEvents returns everything still awaiting a successful push, oldest
// first (insertion order), so the queue drains in the order events happened.
export async function pendingEvents(db: SQLiteDatabase): Promise<PendingEvent[]> {
  return db.getAllAsync<PendingEvent>(
    `SELECT id, event_uuid, kind, payload, client_created_at, attempts, status, last_error
     FROM sync_outbox WHERE status = 'pending' ORDER BY id ASC`
  );
}

// markDone marks an event applied/duplicate on the server — it leaves the queue.
export async function markDone(db: SQLiteDatabase, eventUuid: string): Promise<void> {
  await db.runAsync(`UPDATE sync_outbox SET status = 'done' WHERE event_uuid = ?`, [
    eventUuid,
  ]);
}

// markError parks an event the server rejected by validation (status: "error").
// It bumps attempts and records the reason for the admin to inspect; it does not
// block the rest of the queue.
export async function markError(
  db: SQLiteDatabase,
  eventUuid: string,
  message: string
): Promise<void> {
  await db.runAsync(
    `UPDATE sync_outbox SET status = 'error', last_error = ?, attempts = attempts + 1
     WHERE event_uuid = ?`,
    [message, eventUuid]
  );
}

export async function pendingCount(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) c FROM sync_outbox WHERE status = 'pending'`
  );
  return r?.c ?? 0;
}

// oldestPendingAt returns the client timestamp of the oldest pending event, so
// the UI can warn "N events pending for X" on a flaky connection.
export async function oldestPendingAt(db: SQLiteDatabase): Promise<string | null> {
  const r = await db.getFirstAsync<{ t: string | null }>(
    `SELECT MIN(client_created_at) t FROM sync_outbox WHERE status = 'pending'`
  );
  return r?.t ?? null;
}
