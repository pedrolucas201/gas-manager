import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { addRestock, updateInventory, updateCylinderPrice } from "@/db/queries/inventory";
import { SERVER_P13_UUID } from "@/lib/sync/constants";
import type { SQLiteDatabase } from "expo-sqlite";

async function freshDb(): Promise<SQLiteDatabase> {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

async function getP13Id(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM cylinder_types WHERE name = 'P13' LIMIT 1`
  );
  return r!.id;
}

describe("addRestock", () => {
  it("gera uuid e enfileira evento 'restock'", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await addRestock(db, { cylinder_type_id: cid, quantity: 10, cost_per_unit: 90 });

    const row = await db.getFirstAsync<{ uuid: string }>(
      `SELECT uuid FROM restocks LIMIT 1`
    );
    expect(row?.uuid).toBeTruthy();

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("restock");
    const p = JSON.parse(outbox!.payload);
    expect(p.id).toBe(row?.uuid);
    expect(p.restock.cylinder_type_id).toBe(SERVER_P13_UUID);
    expect(p.restock.quantity).toBe(10);
    expect(p.restock.cost_per_unit).toBe("90.00");
    expect(p.restock.total_cost).toBe("900.00");
  });

  it("incrementa full_qty do inventário", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await addRestock(db, { cylinder_type_id: cid, quantity: 5, cost_per_unit: 90 });
    const inv = await db.getFirstAsync<{ full_qty: number }>(
      `SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(inv?.full_qty).toBe(5);
  });
});

describe("updateInventory", () => {
  it("enfileira stock_adjustment somente para campos alterados", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await db.runAsync(
      `UPDATE inventory SET full_qty = 5, empty_qty = 3 WHERE cylinder_type_id = ?`, [cid]
    );

    await updateInventory(db, cid, 8, 3); // full muda (+3), empty igual

    const rows = await db.getAllAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(rows).toHaveLength(1);
    const p = JSON.parse(rows[0].payload);
    expect(p.stock_adjustment.field).toBe("full");
    expect(p.stock_adjustment.delta).toBe(3);
  });

  it("enfileira dois ajustes quando ambos os campos mudam", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await db.runAsync(
      `UPDATE inventory SET full_qty = 5, empty_qty = 3 WHERE cylinder_type_id = ?`, [cid]
    );

    await updateInventory(db, cid, 8, 5);

    const rows = await db.getAllAsync(
      `SELECT kind FROM sync_outbox WHERE status = 'pending'`
    );
    expect(rows).toHaveLength(2);
  });

  it("não enfileira nada quando os valores não mudaram", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await db.runAsync(
      `UPDATE inventory SET full_qty = 5, empty_qty = 3 WHERE cylinder_type_id = ?`, [cid]
    );

    await updateInventory(db, cid, 5, 3); // sem mudança

    const rows = await db.getAllAsync(`SELECT * FROM sync_outbox WHERE status = 'pending'`);
    expect(rows).toHaveLength(0);
  });
});

describe("updateCylinderPrice", () => {
  it("enfileira cylinder_upsert com updated_at e preços string", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await updateCylinderPrice(db, cid, 135, 100);

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(outbox?.kind).toBe("cylinder_upsert");
    const p = JSON.parse(outbox!.payload);
    expect(p.id).toBe(SERVER_P13_UUID);
    expect(p.sale_price).toBe("135.00");
    expect(p.cost_price).toBe("100.00");
    expect(p.updated_at).toBeTruthy();
  });

  it("atualiza updated_at na tabela local", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await updateCylinderPrice(db, cid, 135, 100);
    const ct = await db.getFirstAsync<{ updated_at: string }>(
      `SELECT updated_at FROM cylinder_types WHERE id = ?`, [cid]
    );
    expect(ct?.updated_at).toBeTruthy();
    expect(ct?.updated_at).not.toBe("");
  });
});
