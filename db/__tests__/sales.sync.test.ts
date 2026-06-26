import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import {
  registerSale,
  voidSale,
  unvoidSale,
  getVoidedSales,
  getPendingVoids,
  discardPendingVoid,
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
// unvoidSale (local) + getVoidedSales
// ---------------------------------------------------------------------------

describe("unvoidSale (local)", () => {
  it("limpa voided_at, re-aplica inventário e enfileira unvoid_sale", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 2, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(`SELECT id, uuid FROM sales LIMIT 1`);

    await voidSale(db, saleRow!.id);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`); // void "enviado"
    // pós-void: full 10
    expect((await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]))?.full_qty).toBe(10);

    await unvoidSale(db, saleRow!.id);

    const sale = await db.getFirstAsync<{ voided_at: string | null }>(`SELECT voided_at FROM sales WHERE id = ?`, [saleRow!.id]);
    expect(sale?.voided_at).toBeNull();
    // re-aplicado: full 8
    expect((await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]))?.full_qty).toBe(8);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("unvoid_sale");
    expect(JSON.parse(outbox!.payload).id).toBe(saleRow!.uuid);
  });

  it("re-aplica dívida fiado ao restaurar", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    const r = await db.runAsync(`INSERT INTO customers (name, uuid, balance, updated_at) VALUES ('Maria','cust-unvoid',0,datetime('now'))`);
    const custId = r.lastInsertRowId;
    await registerSale(db, { customer_id: custId, cylinder_type_id: cid, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "fiado", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number }>(`SELECT id FROM sales LIMIT 1`);

    await voidSale(db, saleRow!.id);
    expect((await db.getFirstAsync<{ balance: number }>(`SELECT balance FROM customers WHERE id = ?`, [custId]))?.balance).toBeCloseTo(0, 5);

    await unvoidSale(db, saleRow!.id);
    expect((await db.getFirstAsync<{ balance: number }>(`SELECT balance FROM customers WHERE id = ?`, [custId]))?.balance).toBeCloseTo(-120, 5);
  });

  it("é no-op se a venda já está ativa (não enfileira nada)", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);
    const saleRow = await db.getFirstAsync<{ id: number }>(`SELECT id FROM sales LIMIT 1`);

    await unvoidSale(db, saleRow!.id); // venda ativa

    const pending = await db.getAllAsync(`SELECT * FROM sync_outbox WHERE status = 'pending'`);
    expect(pending).toHaveLength(0);
    expect((await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]))?.full_qty).toBe(9);
  });
});

describe("getVoidedSales", () => {
  it("retorna só vendas anuladas, mais recentes primeiro", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 100, cost_price: 90, payment_method: "pix", is_exchange: false });
    const first = await db.getFirstAsync<{ id: number }>(`SELECT id FROM sales ORDER BY id ASC LIMIT 1`);
    await voidSale(db, first!.id);

    const voided = await getVoidedSales(db);
    expect(voided).toHaveLength(1);
    expect(voided.every((s) => s.voided_at !== null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getPendingVoids / discardPendingVoid (disjuntor de cancelamento em massa)
// ---------------------------------------------------------------------------

describe("getPendingVoids", () => {
  it("lista voids pendentes com os dados da venda local", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(`SELECT id, uuid FROM sales LIMIT 1`);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`); // a venda já foi enviada
    await voidSale(db, saleRow!.id);

    const pending = await getPendingVoids(db);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(saleRow!.id);
    expect(pending[0].event_uuid).toBeTruthy();
  });

  it("exclui voids 'done', ignora unvoids e ordena por enfileiramento", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    // 3 vendas
    for (let i = 0; i < 3; i++) {
      await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 1, unit_price: 100, cost_price: 90, payment_method: "cash", is_exchange: false });
    }
    const rows = await db.getAllAsync<{ id: number }>(`SELECT id FROM sales ORDER BY id ASC`);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`); // vendas já enviadas

    // void #1 será marcado done; void #2 e #3 ficam pendentes; um unvoid pendente não deve aparecer.
    await voidSale(db, rows[0].id);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done' WHERE kind = 'void_sale'`);
    await voidSale(db, rows[1].id);
    await voidSale(db, rows[2].id);
    await unvoidSale(db, rows[0].id); // gera unvoid_sale pendente (não é void_sale)

    const pending = await getPendingVoids(db);
    expect(pending.map((p) => p.id)).toEqual([rows[1].id, rows[2].id]); // só pendentes, na ordem
  });
});

describe("discardPendingVoid", () => {
  it("remove o void pendente do outbox e restaura a venda localmente (sem unvoid)", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 2, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(`SELECT id, uuid FROM sales LIMIT 1`);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);
    await voidSale(db, saleRow!.id); // anula local + enfileira void pendente
    const voidEvt = await db.getFirstAsync<{ event_uuid: string }>(
      `SELECT event_uuid FROM sync_outbox WHERE kind = 'void_sale' AND status = 'pending' LIMIT 1`
    );

    await discardPendingVoid(db, voidEvt!.event_uuid, saleRow!.id);

    // outbox limpo
    const remaining = await db.getFirstAsync(`SELECT 1 FROM sync_outbox WHERE event_uuid = ?`, [voidEvt!.event_uuid]);
    expect(remaining).toBeNull();
    // venda restaurada
    const sale = await db.getFirstAsync<{ voided_at: string | null }>(`SELECT voided_at FROM sales WHERE id = ?`, [saleRow!.id]);
    expect(sale?.voided_at).toBeNull();
    // estoque re-aplicado: 10 - 2 = 8
    expect((await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]))?.full_qty).toBe(8);
    // NÃO enfileirou unvoid_sale (servidor nunca soube do void)
    const unvoid = await db.getFirstAsync(`SELECT 1 FROM sync_outbox WHERE kind = 'unvoid_sale'`);
    expect(unvoid).toBeNull();
  });

  it("NÃO restaura se o void já foi enviado (changes==0) — evita divergência", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cid, quantity: 2, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(`SELECT id, uuid FROM sales LIMIT 1`);
    await db.runAsync(`UPDATE sync_outbox SET status = 'done'`);
    await voidSale(db, saleRow!.id);
    const voidEvt = await db.getFirstAsync<{ event_uuid: string }>(
      `SELECT event_uuid FROM sync_outbox WHERE kind = 'void_sale' AND status = 'pending' LIMIT 1`
    );
    // simula o void tendo sido enviado entre a tela carregar e o toque
    await db.runAsync(`UPDATE sync_outbox SET status = 'done' WHERE event_uuid = ?`, [voidEvt!.event_uuid]);
    const fullBefore = (await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]))?.full_qty;

    await discardPendingVoid(db, voidEvt!.event_uuid, saleRow!.id);

    // venda continua anulada (não restaurou) e estoque inalterado
    const sale = await db.getFirstAsync<{ voided_at: string | null }>(`SELECT voided_at FROM sales WHERE id = ?`, [saleRow!.id]);
    expect(sale?.voided_at).not.toBeNull();
    expect((await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]))?.full_qty).toBe(fullBefore);
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
