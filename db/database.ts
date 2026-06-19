// Keep this a TYPE-only import: a runtime import from "expo-sqlite" would pull
// the native module, which can't load under the Node (better-sqlite3) test harness.
import type { SQLiteDatabase } from "expo-sqlite";

export const SCHEMA_VERSION = 3;

// A random UUID-shaped id (8-4-4-4-12) built entirely in SQLite via randomblob,
// so the SAME backfill SQL runs identically under expo-sqlite (app) and
// better-sqlite3 (Node tests). Not an RFC-4122 v4 (version/variant nibbles are
// random), but Postgres `UUID` columns validate only the format, not the
// version, so the backend accepts it. ~128 random bits → collisions negligible.
// Each randomblob() call is non-deterministic, so every row gets a distinct id.
const UUID_EXPR = `lower(
  substr(hex(randomblob(4)),1,8) || '-' ||
  substr(hex(randomblob(2)),1,4) || '-' ||
  substr(hex(randomblob(2)),1,4) || '-' ||
  substr(hex(randomblob(2)),1,4) || '-' ||
  substr(hex(randomblob(6)),1,12)
)`;

export async function initDatabase(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
  `);
  await createBaseTables(db);
  await migrate(db);
  await seedDefaultData(db);
}

// createBaseTables is the original v1 schema. It is idempotent (IF NOT EXISTS)
// and untouched by later migrations, which add columns/tables on top.
export async function createBaseTables(db: SQLiteDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS cylinder_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      weight_kg INTEGER NOT NULL,
      sale_price REAL NOT NULL DEFAULT 0,
      cost_price REAL NOT NULL DEFAULT 0,
      active INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cylinder_type_id INTEGER NOT NULL UNIQUE,
      full_qty INTEGER DEFAULT 0,
      empty_qty INTEGER DEFAULT 0,
      FOREIGN KEY (cylinder_type_id) REFERENCES cylinder_types(id)
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      address TEXT,
      balance REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER,
      cylinder_type_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      cost_price REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      is_exchange INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (cylinder_type_id) REFERENCES cylinder_types(id)
    );

    CREATE TABLE IF NOT EXISTS restocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cylinder_type_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL,
      cost_per_unit REAL NOT NULL,
      total_cost REAL NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (cylinder_type_id) REFERENCES cylinder_types(id)
    );
  `);
}

// migrate brings the schema up to SCHEMA_VERSION, tracked via PRAGMA
// user_version. Each step is idempotent and only runs once.
export async function migrate(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ user_version: number }>(
    "PRAGMA user_version"
  );
  const current = row?.user_version ?? 0;

  if (current < 2) {
    // v2: client UUIDs per syncable row, catalog updated_at, sale void marker,
    // and the offline sync infrastructure tables.
    //
    // Wrapped in a transaction so user_version flips ATOMICALLY with the DDL.
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
      ALTER TABLE customers ADD COLUMN uuid TEXT;
      ALTER TABLE customers ADD COLUMN updated_at TEXT;
      ALTER TABLE sales ADD COLUMN uuid TEXT;
      ALTER TABLE sales ADD COLUMN voided_at TEXT;
      ALTER TABLE restocks ADD COLUMN uuid TEXT;

      UPDATE customers SET uuid = ${UUID_EXPR} WHERE uuid IS NULL;
      UPDATE customers SET updated_at = datetime('now') WHERE updated_at IS NULL;
      UPDATE sales SET uuid = ${UUID_EXPR} WHERE uuid IS NULL;
      UPDATE restocks SET uuid = ${UUID_EXPR} WHERE uuid IS NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_uuid ON customers(uuid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_uuid ON sales(uuid);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_restocks_uuid ON restocks(uuid);

      CREATE TABLE IF NOT EXISTS sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_uuid TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        client_created_at TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pull_cursor TEXT NOT NULL DEFAULT '',
        last_synced_at TEXT
      );
      INSERT OR IGNORE INTO sync_state (id, pull_cursor) VALUES (1, '');

      PRAGMA user_version = 2;
    `);
    });
  }

  if (current < 3) {
    // v3: applied_events table for dedupe of pulled events that have no local
    // fact table (stock_adjustment, debt_settlement); cylinder_types.updated_at
    // for LWW tracking of cylinder price upserts from the pull stream.
    await db.withTransactionAsync(async () => {
      await db.execAsync(`
        ALTER TABLE cylinder_types ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

        CREATE TABLE IF NOT EXISTS applied_events (
          event_uuid TEXT NOT NULL PRIMARY KEY
        );

        PRAGMA user_version = 3;
      `);
    });
  }
}

async function seedDefaultData(db: SQLiteDatabase) {
  const existing = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM cylinder_types"
  );
  if (existing && existing.count > 0) return;

  await db.execAsync(`
    INSERT INTO cylinder_types (name, weight_kg, sale_price, cost_price) VALUES
      ('P13', 13, 120.00, 90.00);

    INSERT INTO inventory (cylinder_type_id, full_qty, empty_qty)
      SELECT id, 0, 0 FROM cylinder_types;
  `);
}
