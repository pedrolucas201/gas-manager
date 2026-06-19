import Database from "better-sqlite3";
import type { SQLiteDatabase } from "expo-sqlite";

// createTestDb wraps an in-memory better-sqlite3 database in the subset of the
// expo-sqlite async API that our data layer uses, so the real SQL runs in Node
// tests without the native expo-sqlite module.
export function createTestDb(): SQLiteDatabase {
  const db = new Database(":memory:");

  const api = {
    execAsync: async (source: string) => {
      db.exec(source);
    },
    runAsync: async (source: string, params: unknown[] = []) => {
      const info = db.prepare(source).run(...normalize(params));
      return {
        lastInsertRowId: Number(info.lastInsertRowid),
        changes: info.changes,
      };
    },
    getAllAsync: async (source: string, params: unknown[] = []) => {
      return db.prepare(source).all(...normalize(params));
    },
    getFirstAsync: async (source: string, params: unknown[] = []) => {
      return db.prepare(source).get(...normalize(params)) ?? null;
    },
    withTransactionAsync: async (task: () => Promise<void>) => {
      db.exec("BEGIN");
      try {
        await task();
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };

  return api as unknown as SQLiteDatabase;
}

// better-sqlite3 rejects undefined and JS booleans; map them to SQLite-friendly
// values (null and 0/1) the same way expo-sqlite does.
function normalize(params: unknown[]): unknown[] {
  return params.map((p) =>
    p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : p
  );
}
