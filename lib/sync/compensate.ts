import type { SQLiteDatabase } from "expo-sqlite";
import type { PendingEvent } from "./outbox";

// compensateError reverte o efeito local de um evento rejeitado pelo servidor.
// Chamado logo após markError para que o SQLite local fique consistente com
// o servidor. Cada tipo de evento tem o inverso exato do que foi aplicado em
// db/queries/*.ts no momento da criação.
export async function compensateError(
  db: SQLiteDatabase,
  event: PendingEvent
): Promise<void> {
  try {
    await db.withTransactionAsync(async () => {
      switch (event.kind) {
        case "debt_settlement":
          await compensateDebtSettlement(db, event.event_uuid);
          break;
        case "sale":
          await compensateSale(db, event.event_uuid);
          break;
        case "restock":
          await compensateRestock(db, event.event_uuid);
          break;
        case "expense":
          await compensateExpense(db, event.event_uuid);
          break;
        case "stock_adjustment":
          await compensateStockAdjustment(db, event.event_uuid);
          break;
        // stock_set: o próximo pull traz um stock_set do servidor que corrige
        // via LWW — não precisa compensar aqui.
        // customer_upsert / customer_delete / cylinder_upsert: catálogo LWW,
        // o pull reconcilia automaticamente.
      }
      // Remove de applied_events para que um evento equivalente vindo do pull
      // possa ser aplicado normalmente.
      await db.runAsync(
        `DELETE FROM applied_events WHERE event_uuid = ?`,
        [event.event_uuid]
      );
    });
  } catch (err) {
    console.warn("[compensate] falhou para", event.kind, event.event_uuid, err);
  }
}

async function compensateDebtSettlement(
  db: SQLiteDatabase,
  uuid: string
): Promise<void> {
  const row = await db.getFirstAsync<{ customer_id: number; amount: number }>(
    `SELECT customer_id, amount FROM debt_settlements WHERE uuid = ?`,
    [uuid]
  );
  if (!row) return;

  // Reverte o balance += amount que foi aplicado localmente
  await db.runAsync(
    `UPDATE customers SET balance = balance - ? WHERE id = ?`,
    [row.amount, row.customer_id]
  );
  await db.runAsync(`DELETE FROM debt_settlements WHERE uuid = ?`, [uuid]);
}

async function compensateSale(db: SQLiteDatabase, uuid: string): Promise<void> {
  const sale = await db.getFirstAsync<{
    customer_id: number | null;
    cylinder_type_id: number;
    quantity: number;
    is_exchange: number;
    total: number;
    payment_method: string;
    voided_at: string | null;
  }>(`SELECT customer_id, cylinder_type_id, quantity, is_exchange, total,
             payment_method, voided_at FROM sales WHERE uuid = ?`, [uuid]);
  if (!sale || sale.voided_at) return;

  // Reverte inventory: +full, -empty (inverso do registerSale)
  await db.runAsync(
    `UPDATE inventory
     SET full_qty  = full_qty  + ?,
         empty_qty = empty_qty - ?
     WHERE cylinder_type_id = ?`,
    [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
  );

  // Reverte balance fiado
  if (sale.payment_method === "fiado" && sale.customer_id) {
    await db.runAsync(
      `UPDATE customers SET balance = balance + ? WHERE id = ?`,
      [sale.total, sale.customer_id]
    );
  }

  // Soft-delete: voidSale local sem enfileirar void_sale no outbox
  await db.runAsync(
    `UPDATE sales SET voided_at = datetime('now') WHERE uuid = ?`,
    [uuid]
  );
}

async function compensateRestock(
  db: SQLiteDatabase,
  uuid: string
): Promise<void> {
  const row = await db.getFirstAsync<{
    cylinder_type_id: number;
    quantity: number;
  }>(`SELECT cylinder_type_id, quantity FROM restocks WHERE uuid = ?`, [uuid]);
  if (!row) return;

  await db.runAsync(
    `UPDATE inventory SET full_qty = full_qty - ? WHERE cylinder_type_id = ?`,
    [row.quantity, row.cylinder_type_id]
  );
  await db.runAsync(`DELETE FROM restocks WHERE uuid = ?`, [uuid]);
}

async function compensateExpense(
  db: SQLiteDatabase,
  uuid: string
): Promise<void> {
  await db.runAsync(`DELETE FROM expenses WHERE uuid = ?`, [uuid]);
}

async function compensateStockAdjustment(
  db: SQLiteDatabase,
  uuid: string
): Promise<void> {
  const row = await db.getFirstAsync<{
    cylinder_type_id: number;
    field: string;
    delta: number;
  }>(
    `SELECT cylinder_type_id, field, delta FROM stock_adjustments WHERE uuid = ?`,
    [uuid]
  );
  if (!row) return;

  // Aplica -delta (inverso do ajuste original)
  await db.runAsync(
    `UPDATE inventory
     SET full_qty  = full_qty  + (CASE WHEN ? = 'full'  THEN ? ELSE 0 END),
         empty_qty = empty_qty + (CASE WHEN ? = 'empty' THEN ? ELSE 0 END)
     WHERE cylinder_type_id = ?`,
    [row.field, -row.delta, row.field, -row.delta, row.cylinder_type_id]
  );
  await db.runAsync(
    `DELETE FROM stock_adjustments WHERE uuid = ?`,
    [uuid]
  );
}
