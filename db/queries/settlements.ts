import { SQLiteDatabase } from "expo-sqlite";
import { DebtSettlement } from "@/types";

export async function getSettlements(
  db: SQLiteDatabase,
  from: string,
  to: string
): Promise<DebtSettlement[]> {
  return db.getAllAsync<DebtSettlement>(
    `SELECT * FROM debt_settlements
     WHERE date(created_at) BETWEEN ? AND ?
     ORDER BY created_at DESC`,
    [from, to]
  );
}

export async function getSettlementsByCustomer(
  db: SQLiteDatabase,
  customerId: number
): Promise<DebtSettlement[]> {
  return db.getAllAsync<DebtSettlement>(
    `SELECT * FROM debt_settlements
     WHERE customer_id = ?
     ORDER BY created_at DESC`,
    [customerId]
  );
}
