import type { SQLiteDatabase } from "expo-sqlite";
import { createBaseTables, initDatabase, migrate } from "@/db/database";
import { createTestDb } from "./helpers/testdb";

async function userVersion(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  return r!.user_version;
}

async function columnNames(db: SQLiteDatabase, table: string): Promise<string[]> {
  const rows = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.map((r) => r.name);
}

async function tableExists(db: SQLiteDatabase, name: string): Promise<boolean> {
  const r = await db.getFirstAsync(
    `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    [name]
  );
  return r !== null;
}

describe("schema migration to v2", () => {
  it("brings a fresh database to version 2 with uuid columns and sync tables", async () => {
    const db = createTestDb();
    await initDatabase(db);

    expect(await userVersion(db)).toBe(2);

    expect(await columnNames(db, "customers")).toEqual(
      expect.arrayContaining(["uuid", "updated_at"])
    );
    expect(await columnNames(db, "sales")).toEqual(
      expect.arrayContaining(["uuid", "voided_at"])
    );
    expect(await columnNames(db, "restocks")).toEqual(
      expect.arrayContaining(["uuid"])
    );

    expect(await tableExists(db, "sync_outbox")).toBe(true);
    expect(await tableExists(db, "sync_state")).toBe(true);

    const state = await db.getAllAsync(`SELECT id, pull_cursor FROM sync_state`);
    expect(state).toEqual([{ id: 1, pull_cursor: "" }]);
  });

  it("seeds P13 in cylinder_types", async () => {
    const db = createTestDb();
    await initDatabase(db);
    const ct = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM cylinder_types LIMIT 1`
    );
    expect(ct?.name).toBe("P13");
  });

  it("is idempotent: running init twice stays at v2 with a single sync_state row", async () => {
    const db = createTestDb();
    await initDatabase(db);
    await initDatabase(db);

    expect(await userVersion(db)).toBe(2);
    const count = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) c FROM sync_state`
    );
    expect(count?.c).toBe(1);
  });

  it("backfills a uuid onto pre-existing v1 rows", async () => {
    const db = createTestDb();
    await createBaseTables(db); // simulate a v1 device (user_version still 0)
    await db.runAsync(`INSERT INTO customers (name) VALUES (?)`, ["Legado"]);

    await migrate(db);

    const c = await db.getFirstAsync<{ uuid: string }>(
      `SELECT uuid FROM customers WHERE name = 'Legado'`
    );
    expect(typeof c?.uuid).toBe("string");
    expect(c?.uuid).toHaveLength(36); // 8-4-4-4-12
  });
});
