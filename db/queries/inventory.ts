import { SQLiteDatabase } from "expo-sqlite";
import { CylinderType, Inventory, Restock } from "@/types";

export async function getInventory(db: SQLiteDatabase): Promise<Inventory[]> {
  return await db.getAllAsync<Inventory>(
    `SELECT i.*, ct.name as cylinder_name
     FROM inventory i
     JOIN cylinder_types ct ON i.cylinder_type_id = ct.id
     WHERE ct.active = 1
     ORDER BY ct.weight_kg ASC`
  );
}

export async function getCylinderTypes(db: SQLiteDatabase): Promise<CylinderType[]> {
  return await db.getAllAsync<CylinderType>(
    `SELECT * FROM cylinder_types WHERE active = 1 ORDER BY weight_kg ASC`
  );
}

export async function updateInventory(
  db: SQLiteDatabase,
  cylinder_type_id: number,
  full_qty: number,
  empty_qty: number
) {
  await db.runAsync(
    `UPDATE inventory SET full_qty = ?, empty_qty = ? WHERE cylinder_type_id = ?`,
    [full_qty, empty_qty, cylinder_type_id]
  );
}

export async function addRestock(
  db: SQLiteDatabase,
  data: {
    cylinder_type_id: number;
    quantity: number;
    cost_per_unit: number;
    notes?: string;
  }
) {
  const total_cost = data.quantity * data.cost_per_unit;

  await db.runAsync(
    `INSERT INTO restocks (cylinder_type_id, quantity, cost_per_unit, total_cost, notes)
     VALUES (?, ?, ?, ?, ?)`,
    [data.cylinder_type_id, data.quantity, data.cost_per_unit, total_cost, data.notes ?? null]
  );

  await db.runAsync(
    `UPDATE inventory SET full_qty = full_qty + ? WHERE cylinder_type_id = ?`,
    [data.quantity, data.cylinder_type_id]
  );
}

export async function updateCylinderPrice(
  db: SQLiteDatabase,
  id: number,
  sale_price: number,
  cost_price: number
) {
  await db.runAsync(
    `UPDATE cylinder_types SET sale_price = ?, cost_price = ? WHERE id = ?`,
    [sale_price, cost_price, id]
  );
}

export async function getRestocks(db: SQLiteDatabase): Promise<Restock[]> {
  return await db.getAllAsync<Restock>(
    `SELECT r.*, ct.name as cylinder_name
     FROM restocks r
     JOIN cylinder_types ct ON r.cylinder_type_id = ct.id
     ORDER BY r.created_at DESC
     LIMIT 30`
  );
}
