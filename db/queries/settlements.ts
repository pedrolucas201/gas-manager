import { SQLiteDatabase } from "expo-sqlite";
import { DebtSettlement } from "@/types";

export async function getSettlements(
  db: SQLiteDatabase,
  from: string,
  to: string
): Promise<DebtSettlement[]> {
  return db.getAllAsync<DebtSettlement>(
    `SELECT ds.id, ds.uuid, ds.customer_id,
            COALESCE(c.name, ds.customer_name) AS customer_name,
            ds.amount, ds.payment_method, ds.created_at
     FROM debt_settlements ds
     LEFT JOIN customers c ON c.id = ds.customer_id
     WHERE date(ds.created_at) BETWEEN ? AND ?
     ORDER BY ds.created_at DESC`,
    [from, to]
  );
}

export async function getSettlementsByCustomer(
  db: SQLiteDatabase,
  customerId: number
): Promise<DebtSettlement[]> {
  return db.getAllAsync<DebtSettlement>(
    `SELECT ds.id, ds.uuid, ds.customer_id,
            COALESCE(c.name, ds.customer_name) AS customer_name,
            ds.amount, ds.payment_method, ds.created_at
     FROM debt_settlements ds
     LEFT JOIN customers c ON c.id = ds.customer_id
     WHERE ds.customer_id = ?
     ORDER BY ds.created_at DESC`,
    [customerId]
  );
}
