import { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueue } from "@/lib/sync/outbox";
import { Customer } from "@/types";

export async function getCustomers(db: SQLiteDatabase): Promise<Customer[]> {
  return db.getAllAsync<Customer>(`SELECT * FROM customers ORDER BY name ASC`);
}

export async function getCustomerById(
  db: SQLiteDatabase,
  id: number
): Promise<Customer | null> {
  return db.getFirstAsync<Customer>(
    `SELECT * FROM customers WHERE id = ?`,
    [id]
  );
}

export async function addCustomer(
  db: SQLiteDatabase,
  data: { name: string; phone?: string; address?: string }
): Promise<number> {
  const uuid = randomUUID();
  const now = new Date().toISOString();
  let localId = 0;

  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      `INSERT INTO customers (name, phone, address, uuid, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [data.name, data.phone ?? null, data.address ?? null, uuid, now]
    );
    localId = r.lastInsertRowId;

    await enqueue(db, {
      event_uuid: randomUUID(),
      kind: "customer_upsert",
      payload: JSON.stringify({
        id: uuid,
        name: data.name,
        phone: data.phone ?? null,
        address: data.address ?? null,
        credit_limit: null,
        updated_at: now,
      }),
      client_created_at: now,
    });
  });

  return localId;
}

export async function updateCustomer(
  db: SQLiteDatabase,
  id: number,
  data: { name: string; phone?: string; address?: string }
) {
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE customers SET name = ?, phone = ?, address = ?, updated_at = ? WHERE id = ?`,
      [data.name, data.phone ?? null, data.address ?? null, now, id]
    );

    const r = await db.getFirstAsync<{ uuid: string }>(
      `SELECT uuid FROM customers WHERE id = ?`,
      [id]
    );

    await enqueue(db, {
      event_uuid: randomUUID(),
      kind: "customer_upsert",
      payload: JSON.stringify({
        id: r!.uuid,
        name: data.name,
        phone: data.phone ?? null,
        address: data.address ?? null,
        credit_limit: null,
        updated_at: now,
      }),
      client_created_at: now,
    });
  });
}

export async function deleteCustomer(db: SQLiteDatabase, id: number) {
  const customer = await db.getFirstAsync<Customer & { uuid: string }>(
    `SELECT * FROM customers WHERE id = ?`,
    [id]
  );
  if (!customer) return;

  if (customer.balance < 0) {
    throw new Error(
      "Não é possível excluir um cliente com saldo devedor pendente. Quite o débito antes de excluir."
    );
  }

  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE sales SET customer_id = NULL WHERE customer_id = ?`,
      [id]
    );
    await db.runAsync(`DELETE FROM customers WHERE id = ?`, [id]);

    await enqueue(db, {
      event_uuid: randomUUID(),
      kind: "customer_delete",
      payload: JSON.stringify({ id: customer.uuid }),
      client_created_at: now,
    });
  });
}

export async function settleCustomerDebt(
  db: SQLiteDatabase,
  id: number,
  amount: number,
  paymentMethod: string = "pix"
) {
  const now = new Date().toISOString();
  const uuid = randomUUID();

  await db.withTransactionAsync(async () => {
    const customer = await db.getFirstAsync<{ uuid: string; name: string }>(
      `SELECT uuid, name FROM customers WHERE id = ?`,
      [id]
    );
    if (!customer) throw new Error("Cliente não encontrado");

    await db.runAsync(
      `UPDATE customers SET balance = balance + ? WHERE id = ?`,
      [amount, id]
    );

    await db.runAsync(
      `INSERT INTO debt_settlements (uuid, customer_id, customer_name, amount, payment_method, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid, id, customer.name, amount, paymentMethod, now]
    );

    // Marca em applied_events para que applySettlement (pull path) não
    // re-aplique o balance bump quando o evento voltar do servidor.
    await db.runAsync(
      `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
      [uuid]
    );

    await enqueue(db, {
      event_uuid: uuid,
      kind: "debt_settlement",
      payload: JSON.stringify({
        kind: "debt_settlement",
        id: uuid,
        client_created_at: now,
        debt_settlement: {
          customer_id: customer.uuid,
          amount: amount.toFixed(2),
          payment_method: paymentMethod,
        },
      }),
      client_created_at: now,
    });
  });
}

export async function getDebtors(db: SQLiteDatabase): Promise<Customer[]> {
  return db.getAllAsync<Customer>(
    `SELECT * FROM customers WHERE balance < 0 ORDER BY balance ASC`
  );
}

export async function getCustomerSales(
  db: SQLiteDatabase,
  customer_id: number
) {
  return db.getAllAsync(
    `SELECT s.*, ct.name as cylinder_name
     FROM sales s
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.customer_id = ? AND s.voided_at IS NULL
     ORDER BY s.created_at DESC`,
    [customer_id]
  );
}
