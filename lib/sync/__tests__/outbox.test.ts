import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import {
  enqueue,
  markDone,
  markError,
  oldestPendingAt,
  pendingCount,
  pendingEvents,
} from "@/lib/sync/outbox";

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

const entry = (uuid: string, at: string) => ({
  event_uuid: uuid,
  kind: "sale" as const,
  payload: JSON.stringify({ id: uuid }),
  client_created_at: at,
});

describe("sync outbox", () => {
  it("enqueues a pending event", async () => {
    const db = await freshDb();
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    const rows = await pendingEvents(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      event_uuid: "u1",
      kind: "sale",
      status: "pending",
      attempts: 0,
    });
  });

  it("is idempotent on event_uuid", async () => {
    const db = await freshDb();
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    expect(await pendingCount(db)).toBe(1);
  });

  it("returns pending events oldest-first", async () => {
    const db = await freshDb();
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    await enqueue(db, entry("u2", "2026-06-18T11:00:00Z"));
    const rows = await pendingEvents(db);
    expect(rows.map((r) => r.event_uuid)).toEqual(["u1", "u2"]);
  });

  it("markDone removes an event from the pending set", async () => {
    const db = await freshDb();
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    await markDone(db, "u1");
    expect(await pendingCount(db)).toBe(0);
  });

  it("markError parks the event and bumps attempts", async () => {
    const db = await freshDb();
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    await markError(db, "u1", "id_conflict");
    expect(await pendingCount(db)).toBe(0);
    const row = await db.getFirstAsync<{ status: string; attempts: number; last_error: string }>(
      `SELECT status, attempts, last_error FROM sync_outbox WHERE event_uuid = 'u1'`
    );
    expect(row).toMatchObject({ status: "error", attempts: 1, last_error: "id_conflict" });
  });

  it("pendingCount and oldestPendingAt ignore done and error rows", async () => {
    const db = await freshDb();
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    await enqueue(db, entry("u2", "2026-06-18T11:00:00Z"));
    await enqueue(db, entry("u3", "2026-06-18T12:00:00Z"));
    await markDone(db, "u1");
    await markError(db, "u2", "x");
    expect(await pendingCount(db)).toBe(1);
    expect(await oldestPendingAt(db)).toBe("2026-06-18T12:00:00Z");
  });

  it("markError increments attempts cumulatively", async () => {
    const db = await freshDb();
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    await markError(db, "u1", "a");
    await markError(db, "u1", "b");
    const row = await db.getFirstAsync<{ attempts: number; last_error: string }>(
      `SELECT attempts, last_error FROM sync_outbox WHERE event_uuid = 'u1'`
    );
    expect(row).toMatchObject({ attempts: 2, last_error: "b" });
  });

  it("oldestPendingAt reports the earliest pending timestamp", async () => {
    const db = await freshDb();
    expect(await oldestPendingAt(db)).toBeNull();
    await enqueue(db, entry("u2", "2026-06-18T11:00:00Z"));
    await enqueue(db, entry("u1", "2026-06-18T10:00:00Z"));
    expect(await oldestPendingAt(db)).toBe("2026-06-18T10:00:00Z");
  });
});
