import { SQLiteDatabase } from "expo-sqlite";

export async function initDatabase(db: SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

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

  await seedDefaultData(db);
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
