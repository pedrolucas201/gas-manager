import { SQLiteDatabase } from "expo-sqlite";
import { Customer } from "@/types";

export async function getCustomers(db: SQLiteDatabase): Promise<Customer[]> {
  return await db.getAllAsync<Customer>(
    `SELECT * FROM customers ORDER BY name ASC`
  );
}

export async function getCustomerById(
  db: SQLiteDatabase,
  id: number
): Promise<Customer | null> {
  return await db.getFirstAsync<Customer>(
    `SELECT * FROM customers WHERE id = ?`,
    [id]
  );
}

export async function addCustomer(
  db: SQLiteDatabase,
  data: { name: string; phone?: string; address?: string }
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)`,
    [data.name, data.phone ?? null, data.address ?? null]
  );
  return result.lastInsertRowId;
}

export async function updateCustomer(
  db: SQLiteDatabase,
  id: number,
  data: { name: string; phone?: string; address?: string }
) {
  await db.runAsync(
    `UPDATE customers SET name = ?, phone = ?, address = ? WHERE id = ?`,
    [data.name, data.phone ?? null, data.address ?? null, id]
  );
}

export async function settleCustomerDebt(
  db: SQLiteDatabase,
  id: number,
  amount: number
) {
  await db.runAsync(
    `UPDATE customers SET balance = balance + ? WHERE id = ?`,
    [amount, id]
  );
}

export async function getDebtors(db: SQLiteDatabase): Promise<Customer[]> {
  return await db.getAllAsync<Customer>(
    `SELECT * FROM customers WHERE balance < 0 ORDER BY balance ASC`
  );
}

export async function getCustomerSales(db: SQLiteDatabase, customer_id: number) {
  return await db.getAllAsync(
    `SELECT s.*, ct.name as cylinder_name
     FROM sales s
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.customer_id = ?
     ORDER BY s.created_at DESC`,
    [customer_id]
  );
}
