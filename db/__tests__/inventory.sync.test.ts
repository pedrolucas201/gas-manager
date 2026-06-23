import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { addRestock, updateInventory, updateCylinderPrice } from "@/db/queries/inventory";
import { applyEvent } from "@/lib/sync/apply";
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
  it("enfileira um único stock_set com valores absolutos", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await db.runAsync(
      `UPDATE inventory SET full_qty = 5, empty_qty = 3 WHERE cylinder_type_id = ?`, [cid]
    );

    await updateInventory(db, cid, 49, 7);

    const rows = await db.getAllAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE status = 'pending'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("stock_set");
    const p = JSON.parse(rows[0].payload);
    expect(p.stock_set.cylinder_type_id).toBe(SERVER_P13_UUID);
    expect(p.stock_set.full_qty).toBe(49);
    expect(p.stock_set.empty_qty).toBe(7);
  });

  it("aplica localmente os valores absolutos e grava last_set_at", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);

    await updateInventory(db, cid, 49, 7);

    const inv = await db.getFirstAsync<{ full_qty: number; empty_qty: number; last_set_at: string }>(
      `SELECT full_qty, empty_qty, last_set_at FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(inv?.full_qty).toBe(49);
    expect(inv?.empty_qty).toBe(7);
    expect(inv?.last_set_at).toBeTruthy();
  });

  it("enfileira stock_set mesmo quando os valores não mudaram (set absoluto sempre é registrado)", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await db.runAsync(
      `UPDATE inventory SET full_qty = 5, empty_qty = 3 WHERE cylinder_type_id = ?`, [cid]
    );

    await updateInventory(db, cid, 5, 3); // mesmos valores

    const rows = await db.getAllAsync(`SELECT * FROM sync_outbox WHERE status = 'pending'`);
    expect(rows).toHaveLength(1); // ainda enfileira — o set é absoluto
  });

  it("grava o uuid do stock_set em applied_events", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);

    await updateInventory(db, cid, 15, 2);

    const evt = await db.getFirstAsync<{ event_uuid: string }>(
      `SELECT event_uuid FROM sync_outbox WHERE kind = 'stock_set' LIMIT 1`
    );
    expect(evt?.event_uuid).toBeTruthy();
    const applied = await db.getFirstAsync<{ event_uuid: string }>(
      `SELECT event_uuid FROM applied_events WHERE event_uuid = ?`, [evt!.event_uuid]
    );
    expect(applied?.event_uuid).toBe(evt!.event_uuid);
  });

  it("IDEMPOTÊNCIA: stock_set local não re-aplica quando volta no pull", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);

    await updateInventory(db, cid, 13, 0);
    const before = await db.getFirstAsync<{ full_qty: number }>(
      `SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(before?.full_qty).toBe(13);

    // Simula o pull devolvendo o mesmo evento stock_set
    const evt = await db.getFirstAsync<{ event_uuid: string; payload: string }>(
      `SELECT event_uuid, payload FROM sync_outbox WHERE kind = 'stock_set' LIMIT 1`
    );
    const p = JSON.parse(evt!.payload);
    await applyEvent(db, {
      kind: "stock_set",
      sequence: 1,
      server_received_at: "2026-06-23T10:00:00Z",
      data: {
        id: evt!.event_uuid,
        cylinder_type_id: SERVER_P13_UUID,
        full_qty: p.stock_set.full_qty,
        empty_qty: p.stock_set.empty_qty,
        client_created_at: p.client_created_at,
        server_received_at: "2026-06-23T10:00:00Z",
      },
    });

    const after = await db.getFirstAsync<{ full_qty: number }>(
      `SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(after?.full_qty).toBe(13); // não re-aplicou
  });

  it("LWW: stock_set de outro device aplica se é mais recente", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);

    // Aplica set local com timestamp t1
    await updateInventory(db, cid, 10, 2);

    // Set remoto com timestamp t2 > t1 deve vencer
    await applyEvent(db, {
      kind: "stock_set",
      sequence: 2,
      server_received_at: "2026-06-23T12:00:00Z",
      data: {
        id: "remote-set-0001",
        cylinder_type_id: SERVER_P13_UUID,
        full_qty: 50,
        empty_qty: 5,
        client_created_at: "2099-01-01T00:00:00.000Z", // muito mais recente
        server_received_at: "2026-06-23T12:00:00Z",
      },
    });

    const inv = await db.getFirstAsync<{ full_qty: number; empty_qty: number }>(
      `SELECT full_qty, empty_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(inv?.full_qty).toBe(50);
    expect(inv?.empty_qty).toBe(5);
  });

  it("LWW: stock_set de outro device é ignorado se é mais antigo", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);

    // Aplica set local com timestamp próximo do momento atual
    await updateInventory(db, cid, 30, 4);

    // Set remoto com timestamp muito antigo não deve sobrescrever
    await applyEvent(db, {
      kind: "stock_set",
      sequence: 2,
      server_received_at: "2026-06-23T12:00:00Z",
      data: {
        id: "remote-set-old",
        cylinder_type_id: SERVER_P13_UUID,
        full_qty: 1,
        empty_qty: 1,
        client_created_at: "2000-01-01T00:00:00.000Z", // muito mais antigo
        server_received_at: "2026-06-23T12:00:00Z",
      },
    });

    const inv = await db.getFirstAsync<{ full_qty: number }>(
      `SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(inv?.full_qty).toBe(30); // não foi sobrescrito
  });

  it("ajuste de OUTRO device (uuid não local) ainda aplica normalmente (stock_adjustment)", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await db.runAsync(
      `UPDATE inventory SET full_qty = 10, empty_qty = 0 WHERE cylinder_type_id = ?`, [cid]
    );

    await applyEvent(db, {
      kind: "stock_adjustment",
      sequence: 2,
      server_received_at: "2026-06-23T10:00:00Z",
      data: {
        id: "remote-adj-0001",
        cylinder_type_id: SERVER_P13_UUID,
        field: "full",
        delta: 5,
        reason: null,
        server_received_at: "2026-06-23T10:00:00Z",
        sequence: 2,
      },
    });

    const inv = await db.getFirstAsync<{ full_qty: number }>(
      `SELECT full_qty FROM inventory WHERE cylinder_type_id = ?`, [cid]
    );
    expect(inv?.full_qty).toBe(15);
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
