import { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueue } from "@/lib/sync/outbox";
import { SERVER_P13_UUID } from "@/lib/sync/constants";
import { CylinderType, Inventory, Restock } from "@/types";

export async function getInventory(db: SQLiteDatabase): Promise<Inventory[]> {
  return db.getAllAsync<Inventory>(
    `SELECT i.*, ct.name as cylinder_name
     FROM inventory i
     JOIN cylinder_types ct ON i.cylinder_type_id = ct.id
     WHERE ct.active = 1
     ORDER BY ct.weight_kg ASC`
  );
}

export async function getCylinderTypes(
  db: SQLiteDatabase
): Promise<CylinderType[]> {
  return db.getAllAsync<CylinderType>(
    `SELECT * FROM cylinder_types WHERE active = 1 ORDER BY weight_kg ASC`
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
  const uuid = randomUUID();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO restocks (uuid, cylinder_type_id, quantity, cost_per_unit, total_cost, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid, data.cylinder_type_id, data.quantity, data.cost_per_unit, total_cost, data.notes ?? null]
    );

    await db.runAsync(
      `UPDATE inventory SET full_qty = full_qty + ? WHERE cylinder_type_id = ?`,
      [data.quantity, data.cylinder_type_id]
    );

    await enqueue(db, {
      event_uuid: uuid,
      kind: "restock",
      payload: JSON.stringify({
        kind: "restock",
        id: uuid,
        client_created_at: now,
        restock: {
          cylinder_type_id: SERVER_P13_UUID,
          quantity: data.quantity,
          cost_per_unit: data.cost_per_unit.toFixed(2),
          total_cost: total_cost.toFixed(2),
          notes: data.notes ?? null,
        },
      }),
      client_created_at: now,
    });
  });
}

export async function updateInventory(
  db: SQLiteDatabase,
  cylinder_type_id: number,
  full_qty: number,
  empty_qty: number
) {
  const cur = await db.getFirstAsync<{ full_qty: number; empty_qty: number }>(
    `SELECT full_qty, empty_qty FROM inventory WHERE cylinder_type_id = ?`,
    [cylinder_type_id]
  );
  if (!cur) return;

  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE inventory SET full_qty = ?, empty_qty = ? WHERE cylinder_type_id = ?`,
      [full_qty, empty_qty, cylinder_type_id]
    );

    if (full_qty !== cur.full_qty) {
      const uuid = randomUUID();
      await enqueue(db, {
        event_uuid: uuid,
        kind: "stock_adjustment",
        payload: JSON.stringify({
          kind: "stock_adjustment",
          id: uuid,
          client_created_at: now,
          stock_adjustment: {
            cylinder_type_id: SERVER_P13_UUID,
            field: "full",
            delta: full_qty - cur.full_qty,
            reason: null,
          },
        }),
        client_created_at: now,
      });
    }

    if (empty_qty !== cur.empty_qty) {
      const uuid = randomUUID();
      await enqueue(db, {
        event_uuid: uuid,
        kind: "stock_adjustment",
        payload: JSON.stringify({
          kind: "stock_adjustment",
          id: uuid,
          client_created_at: now,
          stock_adjustment: {
            cylinder_type_id: SERVER_P13_UUID,
            field: "empty",
            delta: empty_qty - cur.empty_qty,
            reason: null,
          },
        }),
        client_created_at: now,
      });
    }
  });
}

export async function updateCylinderPrice(
  db: SQLiteDatabase,
  id: number,
  sale_price: number,
  cost_price: number
) {
  const now = new Date().toISOString();
  const uuid = randomUUID();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cylinder_types SET sale_price = ?, cost_price = ?, updated_at = ? WHERE id = ?`,
      [sale_price, cost_price, now, id]
    );

    await enqueue(db, {
      event_uuid: uuid,
      kind: "cylinder_upsert",
      payload: JSON.stringify({
        id: SERVER_P13_UUID,
        sale_price: sale_price.toFixed(2),
        cost_price: cost_price.toFixed(2),
        active: true,
        updated_at: now,
      }),
      client_created_at: now,
    });
  });
}

export async function getRestocks(db: SQLiteDatabase): Promise<Restock[]> {
  return db.getAllAsync<Restock>(
    `SELECT r.*, ct.name as cylinder_name
     FROM restocks r
     JOIN cylinder_types ct ON r.cylinder_type_id = ct.id
     ORDER BY r.created_at DESC
     LIMIT 30`
  );
}
