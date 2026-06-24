import { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueue } from "@/lib/sync/outbox";
import { Expense } from "@/types";

export async function addExpense(
  db: SQLiteDatabase,
  data: { category: string; description?: string; amount: number }
): Promise<void> {
  const uuid = randomUUID();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO expenses (uuid, category, description, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
      [uuid, data.category, data.description ?? null, data.amount, now]
    );

    await enqueue(db, {
      event_uuid: uuid,
      kind: "expense",
      payload: JSON.stringify({
        kind: "expense",
        id: uuid,
        client_created_at: now,
        expense: {
          category: data.category,
          description: data.description ?? null,
          amount: data.amount.toFixed(2),
        },
      }),
      client_created_at: now,
    });
  });
}

export async function getExpenses(
  db: SQLiteDatabase,
  from: string,
  to: string
): Promise<Expense[]> {
  return db.getAllAsync<Expense>(
    `SELECT * FROM expenses
     WHERE date(created_at) BETWEEN ? AND ?
     ORDER BY created_at DESC`,
    [from, to]
  );
}
