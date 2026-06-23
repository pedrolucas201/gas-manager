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

describe("schema migration to v4", () => {
  it("brings a fresh database to version 4 with all expected tables and columns", async () => {
    const db = createTestDb();
    await initDatabase(db);

    expect(await userVersion(db)).toBe(4);

    // v3 additions
    expect(await tableExists(db, "applied_events")).toBe(true);
    expect(await columnNames(db, "cylinder_types")).toEqual(
      expect.arrayContaining(["updated_at"])
    );

    // v4 additions
    expect(await tableExists(db, "debt_settlements")).toBe(true);
    expect(await columnNames(db, "debt_settlements")).toEqual(
      expect.arrayContaining(["uuid", "customer_id", "customer_name", "amount", "payment_method"])
    );
  });
});

describe("schema migration to v2", () => {
  it("brings a fresh database to version 3 (was 2) with uuid columns and sync tables", async () => {
    const db = createTestDb();
    await initDatabase(db);

    expect(await userVersion(db)).toBe(4);

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

  it("is idempotent: running init twice stays at v4 with a single sync_state row", async () => {
    const db = createTestDb();
    await initDatabase(db);
    await initDatabase(db);

    expect(await userVersion(db)).toBe(4);
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

  it("backfills distinct, non-null uuids across customers, sales and restocks", async () => {
    const db = createTestDb();
    await createBaseTables(db);
    await db.runAsync(`INSERT INTO cylinder_types (name, weight_kg) VALUES ('P13', 13)`);
    const N = 50;
    for (let i = 0; i < N; i++) {
      await db.runAsync(`INSERT INTO customers (name) VALUES (?)`, [`c${i}`]);
      await db.runAsync(
        `INSERT INTO sales (cylinder_type_id, quantity, unit_price, total, payment_method) VALUES (1,1,120,120,'cash')`
      );
      await db.runAsync(
        `INSERT INTO restocks (cylinder_type_id, quantity, cost_per_unit, total_cost) VALUES (1,1,90,90)`
      );
    }

    await migrate(db);

    for (const t of ["customers", "sales", "restocks"]) {
      const r = await db.getFirstAsync<{
        total: number;
        distinct_count: number;
        null_count: number;
      }>(
        `SELECT COUNT(*) total, COUNT(DISTINCT uuid) distinct_count,
                SUM(CASE WHEN uuid IS NULL THEN 1 ELSE 0 END) null_count FROM ${t}`
      );
      expect(r).toMatchObject({ total: N, distinct_count: N, null_count: 0 });
    }
  });

  it("test adapter's withTransactionAsync rolls back on error (atomicity primitive)", async () => {
    const db = createTestDb();
    await db.execAsync(`CREATE TABLE t (x)`);
    await expect(
      db.withTransactionAsync(async () => {
        await db.runAsync(`INSERT INTO t (x) VALUES (1)`);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const r = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) c FROM t`);
    expect(r?.c).toBe(0);
  });
});
