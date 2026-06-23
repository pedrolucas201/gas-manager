import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import {
  addCustomer,
  updateCustomer,
  deleteCustomer,
  settleCustomerDebt,
} from "@/db/queries/customers";
import type { SQLiteDatabase } from "expo-sqlite";

async function freshDb(): Promise<SQLiteDatabase> {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

describe("addCustomer", () => {
  it("gera uuid e enfileira customer_upsert", async () => {
    const db = await freshDb();
    await addCustomer(db, { name: "Maria", phone: "11999" });

    const cust = await db.getFirstAsync<{ uuid: string }>(
      `SELECT uuid FROM customers LIMIT 1`
    );
    expect(cust?.uuid).toBeTruthy();
    expect(cust?.uuid).toHaveLength(36);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("customer_upsert");

    const p = JSON.parse(outbox!.payload);
    expect(p.id).toBe(cust?.uuid);
    expect(p.name).toBe("Maria");
    expect(p.phone).toBe("11999");
    expect(p.updated_at).toBeTruthy();
  });

  it("retorna o id local", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "João" });
    expect(id).toBeGreaterThan(0);
  });
});

describe("updateCustomer", () => {
  it("bumpa updated_at e enfileira customer_upsert", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "João" });
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);

    await updateCustomer(db, id, { name: "João Atualizado", phone: "11888" });

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("customer_upsert");
    const p = JSON.parse(outbox!.payload);
    expect(p.name).toBe("João Atualizado");
    expect(p.phone).toBe("11888");
  });
});

describe("deleteCustomer", () => {
  it("enfileira customer_delete com uuid do cliente", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "A Deletar" });
    const cust = await db.getFirstAsync<{ uuid: string }>(
      `SELECT uuid FROM customers WHERE id = ?`, [id]
    );
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);

    await deleteCustomer(db, id);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("customer_delete");
    const p = JSON.parse(outbox!.payload);
    expect(p.id).toBe(cust?.uuid);
  });

  it("bloqueia delete com saldo devedor e não enfileira evento", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Devedor" });
    await db.runAsync(`UPDATE customers SET balance = -200 WHERE id = ?`, [id]);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);

    await expect(deleteCustomer(db, id)).rejects.toThrow("saldo devedor");

    const pending = await db.getAllAsync(
      `SELECT * FROM sync_outbox WHERE status = 'pending'`
    );
    expect(pending).toHaveLength(0);
  });
});

describe("settleCustomerDebt", () => {
  it("grava log em debt_settlements com payment_method", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Pagador" });
    await db.runAsync(`UPDATE customers SET balance = -300 WHERE id = ?`, [id]);

    await settleCustomerDebt(db, id, 150, "cash");

    const row = await db.getFirstAsync<{
      uuid: string;
      customer_name: string;
      amount: number;
      payment_method: string;
    }>(`SELECT * FROM debt_settlements LIMIT 1`);

    expect(row).toBeTruthy();
    expect(row!.customer_name).toBe("Pagador");
    expect(row!.amount).toBeCloseTo(150, 5);
    expect(row!.payment_method).toBe("cash");
    expect(row!.uuid).toHaveLength(36);
  });

  it("usa pix como método padrão se não especificado", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Padrão" });
    await db.runAsync(`UPDATE customers SET balance = -100 WHERE id = ?`, [id]);

    await settleCustomerDebt(db, id, 100);

    const row = await db.getFirstAsync<{ payment_method: string }>(
      `SELECT payment_method FROM debt_settlements LIMIT 1`
    );
    expect(row?.payment_method).toBe("pix");
  });

  it("enfileira debt_settlement com customer_id (uuid) e amount string", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Fiado" });
    await db.runAsync(
      `UPDATE customers SET balance = -200 WHERE id = ?`, [id]
    );
    const cust = await db.getFirstAsync<{ uuid: string }>(
      `SELECT uuid FROM customers WHERE id = ?`, [id]
    );
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);

    await settleCustomerDebt(db, id, 100);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("debt_settlement");
    const p = JSON.parse(outbox!.payload);
    expect(p.debt_settlement.amount).toBe("100.00");
    expect(p.debt_settlement.customer_id).toBe(cust?.uuid);
  });

  it("atualiza o saldo do cliente", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Saldo" });
    await db.runAsync(`UPDATE customers SET balance = -200 WHERE id = ?`, [id]);
    await settleCustomerDebt(db, id, 100);
    const c = await db.getFirstAsync<{ balance: number }>(
      `SELECT balance FROM customers WHERE id = ?`, [id]
    );
    expect(c?.balance).toBeCloseTo(-100, 5);
  });
});
