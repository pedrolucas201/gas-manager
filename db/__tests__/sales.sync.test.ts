import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import {
  registerSale,
  voidSale,
  getSales,
  getTodaySales,
  getDashboardStats,
} from "@/db/queries/sales";
import { SERVER_P13_UUID } from "@/lib/sync/constants";
import type { SQLiteDatabase } from "expo-sqlite";

async function freshDb(): Promise<SQLiteDatabase> {
  const db = createTestDb();
  await initDatabase(db);
  await db.runAsync(
    `UPDATE inventory SET full_qty = 10 WHERE cylinder_type_id = (SELECT id FROM cylinder_types WHERE name = 'P13' LIMIT 1)`
  );
  return db;
}

async function getP13Id(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM cylinder_types WHERE name = 'P13' LIMIT 1`
  );
  return r!.id;
}

// ---------------------------------------------------------------------------
// registerSale
// ---------------------------------------------------------------------------

describe("registerSale", () => {
  it("gera uuid e enfileira evento 'sale' no outbox", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);

    await registerSale(db, {
      customer_id: null,
      cylinder_type_id: cid,
      quantity: 1,
      unit_price: 120,
      cost_price: 90,
      payment_method: "cash",
      is_exchange: false,
    });

    const saleRow = await db.getFirstAsync<{ uuid: string }>(
      `SELECT uuid FROM sales LIMIT 1`
    );
    expect(saleRow?.uuid).toBeTruthy();
    expect(saleRow?.uuid).toHaveLength(36);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("sale");

    const payload = JSON.parse(outbox!.payload);
    expect(payload.id).toBe(saleRow?.uuid);
    expect(payload.sale.cylinder_type_id).toBe(SERVER_P13_UUID);
    expect(payload.sale.unit_price).toBe("120.00");
    expect(payload.sale.total).toBe("120.00");
    expect(payload.sale.payment_method).toBe("cash");
    expect(payload.sale.customer_id).toBeNull();
  });

  it("venda fiado: payload inclui customer_id (uuid do cliente)", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    const r = await db.runAsync(
      `INSERT INTO customers (name, uuid, balance, updated_at) VALUES ('João','cust-uuid-s1',0,datetime('now'))`
    );
    const custId = r.lastInsertRowId;

    await registerSale(db, {
      customer_id: custId,
      cylinder_type_id: cid,
      quantity: 1,
      unit_price: 120,
      cost_price: 90,
      payment_method: "fiado",
      is_exchange: false,
    });

    const outbox = await db.getFirstAsync<{ payload: string }>(
      `SELECT payload FROM sync_outbox WHERE kind = 'sale'`
    );
    const payload = JSON.parse(outbox!.payload);
    expect(payload.sale.customer_id).toBe("cust-uuid-s1");
    expect(payload.sale.payment_method).toBe("fiado");
  });

  it("decrementar full_qty do inventário", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 3, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const inv = await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]);
    expect(inv?.full_qty).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// voidSale
// ---------------------------------------------------------------------------

describe("voidSale", () => {
  it("seta voided_at, reverte inventário e enfileira void_sale (sem DELETE)", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 2, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });

    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM sales LIMIT 1`
    );
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);

    await voidSale(db, saleRow!.id);

    const sale = await db.getFirstAsync<{ voided_at: string | null }>(
      `SELECT voided_at FROM sales WHERE id = ?`, [saleRow!.id]
    );
    expect(sale?.voided_at).not.toBeNull();

    const inv = await db.getFirstAsync<{ full_qty: number }>(
      `SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(inv?.full_qty).toBe(10);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("void_sale");
    const voidPayload = JSON.parse(outbox!.payload);
    expect(voidPayload.id).toBe(saleRow!.uuid);
  });

  it("é no-op se venda já está anulada", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number }>(`SELECT id FROM sales LIMIT 1`);
    await voidSale(db, saleRow!.id);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);
    await voidSale(db, saleRow!.id); // segunda chamada

    const pending = await db.getAllAsync(`SELECT * FROM sync_outbox WHERE status = 'pending'`);
    expect(pending).toHaveLength(0);

    const inv = await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]);
    expect(inv?.full_qty).toBe(10); // só reverteu uma vez
  });
});

// ---------------------------------------------------------------------------
// Filtros de voided_at IS NULL
// ---------------------------------------------------------------------------

describe("getSales / getDashboardStats filtram vendas anuladas", () => {
  it("getSales não retorna vendas anuladas", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number }>(`SELECT id FROM sales LIMIT 1`);
    await voidSale(db, saleRow!.id);
    const sales = await getSales(db);
    expect(sales).toHaveLength(0);
  });

  it("getDashboardStats exclui vendas anuladas do faturamento", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number }>(`SELECT id FROM sales LIMIT 1`);
    await voidSale(db, saleRow!.id);
    const stats = await getDashboardStats(db);
    expect(stats.today_revenue).toBe(0);
  });
});
