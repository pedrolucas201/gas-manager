/**
 * Tests para applyEvent — aplicar um evento pullado no SQLite local.
 *
 * Usa o mesmo harness Node (better-sqlite3 + adapter async) dos testes de
 * migração e outbox. O esquema real v2 é inicializado via initDatabase.
 *
 * Convenções de sinal:
 *   Servidor (Postgres): balance POSITIVO = dívida (fiado soma +total,
 *     quitação soma -amount via BumpCustomerBalance).
 *   Local (SQLite):     balance NEGATIVO = dívida (fiado: balance - total;
 *     quitação: balance + amount).
 *   apply.ts traduz: para venda fiado recebida do servidor, aplica localmente
 *     balance - total (igual ao write path local). Para quitação, aplica
 *     balance + amount (igual ao write path local). O valor numérico de
 *     total/amount é sempre positivo em ambos os lados.
 */

import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { applyEvent } from "@/lib/sync/apply";
import type { SQLiteDatabase } from "expo-sqlite";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

/** UUID fixo do P13 no servidor. */
const SERVER_P13_UUID = "11111111-1111-1111-1111-111111111111";

/** Retorna o id local (INTEGER) do P13. */
async function p13LocalId(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM cylinder_types WHERE name = 'P13' LIMIT 1`
  );
  if (!r) throw new Error("P13 not seeded");
  return r.id;
}

/** Insere um cliente e retorna seu id local e uuid. */
async function seedCustomer(
  db: SQLiteDatabase,
  uuid: string,
  name = "João",
  balance = 0
): Promise<number> {
  const r = await db.runAsync(
    `INSERT INTO customers (name, uuid, balance, updated_at) VALUES (?, ?, ?, datetime('now'))`,
    [name, uuid, balance]
  );
  return r.lastInsertRowId;
}

/** Lê o inventário do P13. */
async function getInventory(
  db: SQLiteDatabase
): Promise<{ full_qty: number; empty_qty: number }> {
  const id = await p13LocalId(db);
  const r = await db.getFirstAsync<{ full_qty: number; empty_qty: number }>(
    `SELECT full_qty, empty_qty FROM inventory WHERE cylinder_type_id = ?`,
    [id]
  );
  return r ?? { full_qty: 0, empty_qty: 0 };
}

/** Seta o inventário do P13. */
async function setInventory(
  db: SQLiteDatabase,
  full_qty: number,
  empty_qty: number
) {
  const id = await p13LocalId(db);
  await db.runAsync(
    `UPDATE inventory SET full_qty = ?, empty_qty = ? WHERE cylinder_type_id = ?`,
    [full_qty, empty_qty, id]
  );
}

/** Lê o saldo de um cliente pelo id local. */
async function getBalance(db: SQLiteDatabase, customerId: number): Promise<number> {
  const r = await db.getFirstAsync<{ balance: number }>(
    `SELECT balance FROM customers WHERE id = ?`,
    [customerId]
  );
  return r?.balance ?? 0;
}

/** Constrói um PullEvent de venda. */
function makeSaleEvent(opts: {
  uuid: string;
  customerUuid?: string | null;
  quantity?: number;
  unitPrice?: string;
  costPrice?: string;
  total?: string;
  paymentMethod?: string;
  isExchange?: boolean;
  voidedAt?: string | null;
  sequence?: number;
}) {
  return {
    kind: "sale" as const,
    sequence: opts.sequence ?? 1,
    server_received_at: "2026-06-18T10:00:00Z",
    data: {
      id: opts.uuid,
      customer_id: opts.customerUuid ?? null,
      cylinder_type_id: SERVER_P13_UUID,
      quantity: opts.quantity ?? 1,
      unit_price: opts.unitPrice ?? "120.00",
      cost_price: opts.costPrice ?? "90.00",
      total: opts.total ?? "120.00",
      payment_method: opts.paymentMethod ?? "cash",
      is_exchange: opts.isExchange ?? false,
      voided_at: opts.voidedAt ?? null,
      server_received_at: "2026-06-18T10:00:00Z",
      sequence: opts.sequence ?? 1,
    },
  };
}

/** Constrói um PullEvent de reabastecimento. */
function makeRestockEvent(opts: {
  uuid: string;
  quantity?: number;
  costPerUnit?: string;
  totalCost?: string;
  notes?: string | null;
  sequence?: number;
}) {
  return {
    kind: "restock" as const,
    sequence: opts.sequence ?? 1,
    server_received_at: "2026-06-18T10:00:00Z",
    data: {
      id: opts.uuid,
      cylinder_type_id: SERVER_P13_UUID,
      quantity: opts.quantity ?? 10,
      cost_per_unit: opts.costPerUnit ?? "90.00",
      total_cost: opts.totalCost ?? "900.00",
      notes: opts.notes ?? null,
      server_received_at: "2026-06-18T10:00:00Z",
      sequence: opts.sequence ?? 1,
    },
  };
}

/** Constrói um PullEvent de ajuste de estoque. */
function makeStockAdjEvent(opts: {
  uuid: string;
  field: "full" | "empty";
  delta: number;
  reason?: string | null;
  sequence?: number;
}) {
  return {
    kind: "stock_adjustment" as const,
    sequence: opts.sequence ?? 1,
    server_received_at: "2026-06-18T10:00:00Z",
    data: {
      id: opts.uuid,
      cylinder_type_id: SERVER_P13_UUID,
      field: opts.field,
      delta: opts.delta,
      reason: opts.reason ?? null,
      server_received_at: "2026-06-18T10:00:00Z",
      sequence: opts.sequence ?? 1,
    },
  };
}

/** Constrói um PullEvent de quitação de dívida. */
function makeSettlementEvent(opts: {
  uuid: string;
  customerUuid: string;
  amount: string;
  paymentMethod?: string;
  sequence?: number;
}) {
  return {
    kind: "debt_settlement" as const,
    sequence: opts.sequence ?? 1,
    server_received_at: "2026-06-18T10:00:00Z",
    data: {
      id: opts.uuid,
      customer_id: opts.customerUuid,
      amount: opts.amount,
      payment_method: opts.paymentMethod ?? "pix",
      server_received_at: "2026-06-18T10:00:00Z",
      sequence: opts.sequence ?? 1,
    },
  };
}

/** Constrói um PullEvent de upsert de cliente. */
function makeCustomerUpsertEvent(opts: {
  uuid: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  updatedAt?: string;
  sequence?: number;
}) {
  return {
    kind: "customer_upsert" as const,
    sequence: opts.sequence ?? 1,
    server_received_at: "2026-06-18T10:00:00Z",
    data: {
      id: opts.uuid,
      name: opts.name,
      phone: opts.phone ?? null,
      address: opts.address ?? null,
      updated_at: opts.updatedAt ?? "2026-06-18T10:00:00Z",
    },
  };
}

/** Constrói um PullEvent de exclusão de cliente. */
function makeCustomerDeleteEvent(opts: {
  uuid: string;
  sequence?: number;
}) {
  return {
    kind: "customer_delete" as const,
    sequence: opts.sequence ?? 1,
    server_received_at: "2026-06-18T10:00:00Z",
    data: {
      id: opts.uuid,
    },
  };
}

/** Constrói um PullEvent de upsert de cilindro. */
function makeCylinderUpsertEvent(opts: {
  salePrice: string;
  costPrice: string;
  updatedAt?: string;
  sequence?: number;
}) {
  return {
    kind: "cylinder_upsert" as const,
    sequence: opts.sequence ?? 1,
    server_received_at: "2026-06-18T10:00:00Z",
    data: {
      id: SERVER_P13_UUID,
      sale_price: opts.salePrice,
      cost_price: opts.costPrice,
      updated_at: opts.updatedAt ?? "2026-06-18T10:00:00Z",
    },
  };
}

// ---------------------------------------------------------------------------
// Testes: sale
// ---------------------------------------------------------------------------

describe("applyEvent — sale", () => {
  it("insere a venda e decrementa full_qty do inventário", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 2);

    await applyEvent(db, makeSaleEvent({ uuid: "sale-uuid-0001", quantity: 3 }));

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(7);
    expect(inv.empty_qty).toBe(2); // sem troca → empty inalterado

    const sale = await db.getFirstAsync<{ uuid: string; quantity: number }>(
      `SELECT uuid, quantity FROM sales WHERE uuid = 'sale-uuid-0001'`
    );
    expect(sale).not.toBeNull();
    expect(sale?.quantity).toBe(3);
  });

  it("para troca (is_exchange=true) incrementa empty_qty", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);

    await applyEvent(
      db,
      makeSaleEvent({ uuid: "sale-uuid-0002", quantity: 2, isExchange: true })
    );

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(8);
    expect(inv.empty_qty).toBe(2);
  });

  it("full_qty não cai abaixo de 0 (MAX(0, full_qty - qty))", async () => {
    const db = await freshDb();
    await setInventory(db, 0, 0);

    await applyEvent(db, makeSaleEvent({ uuid: "sale-uuid-0003", quantity: 5 }));

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(0);
  });

  it("dedupe: aplicar o mesmo uuid duas vezes é no-op (sem dupla contagem)", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);

    const ev = makeSaleEvent({ uuid: "sale-uuid-0004", quantity: 1 });
    await applyEvent(db, ev);
    await applyEvent(db, ev); // segunda aplicação: no-op

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(9); // decremento só uma vez

    const count = await db.getFirstAsync<{ c: number }>(
      `SELECT COUNT(*) c FROM sales WHERE uuid = 'sale-uuid-0004'`
    );
    expect(count?.c).toBe(1);
  });

  it("SIGN TEST — venda fiado: balance fica negativo no local (dívida = negativo)", async () => {
    const db = await freshDb();
    const custUuid = "cust-uuid-sign-test";
    const custId = await seedCustomer(db, custUuid, "Fiado Test", 0);
    await setInventory(db, 10, 0);

    await applyEvent(
      db,
      makeSaleEvent({
        uuid: "sale-uuid-sign",
        customerUuid: custUuid,
        total: "120.00",
        paymentMethod: "fiado",
      })
    );

    const bal = await getBalance(db, custId);
    // Convenção local: dívida = negativo. Venda de 120 → balance = -120.
    expect(bal).toBeCloseTo(-120, 5);
  });

  it("venda fiado sem cliente conhecido não atualiza balanço (customer_id é NULL na venda)", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);

    // Sem customer_id, a venda é cash-equivalente para o inventário
    await applyEvent(
      db,
      makeSaleEvent({
        uuid: "sale-uuid-nocust",
        customerUuid: null,
        paymentMethod: "cash",
        total: "120.00",
      })
    );

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(9);
    // Não há customer para checar balanço — apenas garantir que não houve erro
  });

  it("venda fiado com customer_id desconhecido: insere placeholder e vincula o saldo", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);
    const unknownUuid = "unknown-cust-uuid-0001";

    await applyEvent(
      db,
      makeSaleEvent({
        uuid: "sale-uuid-placeholder",
        customerUuid: unknownUuid,
        paymentMethod: "fiado",
        total: "100.00",
      })
    );

    // Deve ter criado um cliente placeholder com esse uuid
    const cust = await db.getFirstAsync<{ uuid: string; balance: number }>(
      `SELECT uuid, balance FROM customers WHERE uuid = ?`,
      [unknownUuid]
    );
    expect(cust).not.toBeNull();
    expect(cust?.uuid).toBe(unknownUuid);
    // O saldo do placeholder deve refletir a dívida
    expect(cust?.balance).toBeCloseTo(-100, 5);
  });

  it("venda com voided_at preenchido: insere voided e reverte agregados", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);
    const custUuid = "cust-uuid-void-in-sale";
    const custId = await seedCustomer(db, custUuid, "Void Test", 0);

    // Evento de venda que já vem voided (servidor voidou antes deste pull)
    await applyEvent(
      db,
      makeSaleEvent({
        uuid: "sale-uuid-voided-0001",
        customerUuid: custUuid,
        paymentMethod: "fiado",
        total: "120.00",
        quantity: 2,
        voidedAt: "2026-06-18T11:00:00Z",
      })
    );

    // Venda anulada desde o início: inventário não deve ter sido decrementado
    // (insert + void imediato = agregados zerados)
    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(10); // sem alteração líquida

    // Saldo não deve ter sido afetado
    const bal = await getBalance(db, custId);
    expect(bal).toBeCloseTo(0, 5);

    // voided_at deve estar preenchido
    const sale = await db.getFirstAsync<{ voided_at: string | null }>(
      `SELECT voided_at FROM sales WHERE uuid = 'sale-uuid-voided-0001'`
    );
    expect(sale?.voided_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Testes: void_sale (venda previamente inserida, agora anulada via evento)
// ---------------------------------------------------------------------------

describe("applyEvent — void_sale (reversão de venda já local)", () => {
  it("anula venda cash: reverte inventário uma única vez", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);

    // Primeiro, aplica a venda (sem void)
    await applyEvent(
      db,
      makeSaleEvent({ uuid: "sale-uuid-void-cash", quantity: 3 })
    );
    expect((await getInventory(db)).full_qty).toBe(7);

    // Agora aplica o evento de void
    await applyEvent(db, {
      kind: "void_sale",
      sequence: 2,
      server_received_at: "2026-06-18T12:00:00Z",
      data: { id: "sale-uuid-void-cash" },
    });

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(10); // revertido
  });

  it("anula venda fiado: reverte balanço do cliente (dívida some)", async () => {
    const db = await freshDb();
    const custUuid = "cust-uuid-void-fiado";
    const custId = await seedCustomer(db, custUuid, "Fiado Void", 0);
    await setInventory(db, 10, 0);

    await applyEvent(
      db,
      makeSaleEvent({
        uuid: "sale-uuid-void-fiado",
        customerUuid: custUuid,
        paymentMethod: "fiado",
        total: "120.00",
        quantity: 1,
      })
    );
    expect(await getBalance(db, custId)).toBeCloseTo(-120, 5);

    await applyEvent(db, {
      kind: "void_sale",
      sequence: 2,
      server_received_at: "2026-06-18T12:00:00Z",
      data: { id: "sale-uuid-void-fiado" },
    });

    expect(await getBalance(db, custId)).toBeCloseTo(0, 5);
  });

  it("void_sale com is_exchange=true: reverte empty_qty também", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);

    await applyEvent(
      db,
      makeSaleEvent({ uuid: "sale-uuid-void-exchange", quantity: 2, isExchange: true })
    );
    const afterSale = await getInventory(db);
    expect(afterSale.full_qty).toBe(8);
    expect(afterSale.empty_qty).toBe(2);

    await applyEvent(db, {
      kind: "void_sale",
      sequence: 2,
      server_received_at: "2026-06-18T12:00:00Z",
      data: { id: "sale-uuid-void-exchange" },
    });

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(10);
    expect(inv.empty_qty).toBe(0); // MAX(0, 2-2)
  });

  it("void_sale idempotente: aplicar duas vezes reverte só uma vez", async () => {
    const db = await freshDb();
    await setInventory(db, 10, 0);

    await applyEvent(
      db,
      makeSaleEvent({ uuid: "sale-uuid-void-idem", quantity: 1 })
    );

    const voidEv = {
      kind: "void_sale" as const,
      sequence: 2,
      server_received_at: "2026-06-18T12:00:00Z",
      data: { id: "sale-uuid-void-idem" },
    };
    await applyEvent(db, voidEv);
    await applyEvent(db, voidEv); // segunda vez: no-op

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(10); // só reverteu uma vez
  });

  it("void_sale para uuid desconhecido é no-op (não lança erro)", async () => {
    const db = await freshDb();
    await expect(
      applyEvent(db, {
        kind: "void_sale",
        sequence: 1,
        server_received_at: "2026-06-18T10:00:00Z",
        data: { id: "uuid-nao-existe" },
      })
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Testes: restock
// ---------------------------------------------------------------------------

describe("applyEvent — restock", () => {
  it("insere restock e incrementa full_qty", async () => {
    const db = await freshDb();
    await setInventory(db, 5, 0);

    await applyEvent(
      db,
      makeRestockEvent({ uuid: "restock-uuid-0001", quantity: 10 })
    );

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(15);

    const r = await db.getFirstAsync<{ uuid: string; quantity: number }>(
      `SELECT uuid, quantity FROM restocks WHERE uuid = 'restock-uuid-0001'`
    );
    expect(r?.quantity).toBe(10);
  });

  it("dedupe: mesmo uuid de restock não duplica o incremento", async () => {
    const db = await freshDb();
    await setInventory(db, 5, 0);

    const ev = makeRestockEvent({ uuid: "restock-uuid-0002", quantity: 5 });
    await applyEvent(db, ev);
    await applyEvent(db, ev);

    const inv = await getInventory(db);
    expect(inv.full_qty).toBe(10); // só incrementou uma vez
  });
});

// ---------------------------------------------------------------------------
// Testes: stock_adjustment
// ---------------------------------------------------------------------------

describe("applyEvent — stock_adjustment", () => {
  it("aplica delta positivo em full_qty", async () => {
    const db = await freshDb();
    await setInventory(db, 5, 0);

    await applyEvent(
      db,
      makeStockAdjEvent({ uuid: "adj-uuid-0001", field: "full", delta: 3 })
    );

    expect((await getInventory(db)).full_qty).toBe(8);
  });

  it("aplica delta negativo em full_qty (clampado em 0)", async () => {
    const db = await freshDb();
    await setInventory(db, 2, 0);

    await applyEvent(
      db,
      makeStockAdjEvent({ uuid: "adj-uuid-0002", field: "full", delta: -10 })
    );

    expect((await getInventory(db)).full_qty).toBe(0); // MAX(0, 2-10)
  });

  it("aplica delta em empty_qty", async () => {
    const db = await freshDb();
    await setInventory(db, 5, 3);

    await applyEvent(
      db,
      makeStockAdjEvent({ uuid: "adj-uuid-0003", field: "empty", delta: 2 })
    );

    expect((await getInventory(db)).empty_qty).toBe(5);
  });

  it("dedupe: mesmo uuid de ajuste não duplica o delta", async () => {
    const db = await freshDb();
    await setInventory(db, 5, 0);

    const ev = makeStockAdjEvent({ uuid: "adj-uuid-0004", field: "full", delta: 3 });
    await applyEvent(db, ev);
    await applyEvent(db, ev);

    expect((await getInventory(db)).full_qty).toBe(8); // só aplicou uma vez
  });
});

// ---------------------------------------------------------------------------
// Testes: debt_settlement
// ---------------------------------------------------------------------------

describe("applyEvent — debt_settlement", () => {
  it("SIGN TEST — quitação: balance sobe em direção a zero (dívida diminui)", async () => {
    const db = await freshDb();
    const custUuid = "cust-uuid-settle-sign";
    const custId = await seedCustomer(db, custUuid, "Settle Sign", -200);

    await applyEvent(
      db,
      makeSettlementEvent({
        uuid: "settle-uuid-0001",
        customerUuid: custUuid,
        amount: "100.00",
      })
    );

    const bal = await getBalance(db, custId);
    // balance era -200; quitação de 100 → balance += 100 → -100
    expect(bal).toBeCloseTo(-100, 5);
  });

  it("grava log em debt_settlements com uuid e payment_method", async () => {
    const db = await freshDb();
    const custUuid = "cust-uuid-settle-log";
    await seedCustomer(db, custUuid, "Log Test", -200);

    await applyEvent(
      db,
      makeSettlementEvent({
        uuid: "settle-uuid-log-001",
        customerUuid: custUuid,
        amount: "75.00",
      })
    );

    const row = await db.getFirstAsync<{
      uuid: string;
      amount: number;
      payment_method: string;
    }>(`SELECT * FROM debt_settlements WHERE uuid = 'settle-uuid-log-001'`);

    expect(row).toBeTruthy();
    expect(row!.amount).toBeCloseTo(75, 5);
    expect(row!.payment_method).toBe("pix");
  });

  it("dedupe: mesmo uuid de quitação não aplica duas vezes", async () => {
    const db = await freshDb();
    const custUuid = "cust-uuid-settle-idem";
    const custId = await seedCustomer(db, custUuid, "Settle Idem", -200);

    const ev = makeSettlementEvent({
      uuid: "settle-uuid-0002",
      customerUuid: custUuid,
      amount: "50.00",
    });
    await applyEvent(db, ev);
    await applyEvent(db, ev);

    const bal = await getBalance(db, custId);
    expect(bal).toBeCloseTo(-150, 5); // só aplicou uma vez
  });
});

// ---------------------------------------------------------------------------
// Testes: customer_upsert
// ---------------------------------------------------------------------------

describe("applyEvent — customer_upsert", () => {
  it("insere novo cliente quando uuid não existe localmente", async () => {
    const db = await freshDb();
    const uuid = "cust-uuid-upsert-new";

    await applyEvent(
      db,
      makeCustomerUpsertEvent({ uuid, name: "Maria Nova", phone: "11999" })
    );

    const c = await db.getFirstAsync<{ name: string; phone: string }>(
      `SELECT name, phone FROM customers WHERE uuid = ?`,
      [uuid]
    );
    expect(c?.name).toBe("Maria Nova");
    expect(c?.phone).toBe("11999");
  });

  it("atualiza cliente existente se updated_at é mais recente (LWW)", async () => {
    const db = await freshDb();
    const uuid = "cust-uuid-upsert-lww";

    // Insere versão antiga
    await applyEvent(
      db,
      makeCustomerUpsertEvent({
        uuid,
        name: "Nome Antigo",
        updatedAt: "2026-06-01T00:00:00Z",
      })
    );

    // Aplica versão mais nova
    await applyEvent(
      db,
      makeCustomerUpsertEvent({
        uuid,
        name: "Nome Novo",
        updatedAt: "2026-06-18T00:00:00Z",
      })
    );

    const c = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM customers WHERE uuid = ?`,
      [uuid]
    );
    expect(c?.name).toBe("Nome Novo");
  });

  it("ignora upsert com updated_at mais antigo (LWW não regride)", async () => {
    const db = await freshDb();
    const uuid = "cust-uuid-upsert-lww-old";

    // Insere versão recente
    await applyEvent(
      db,
      makeCustomerUpsertEvent({
        uuid,
        name: "Nome Atual",
        updatedAt: "2026-06-18T00:00:00Z",
      })
    );

    // Tenta aplicar versão mais antiga
    await applyEvent(
      db,
      makeCustomerUpsertEvent({
        uuid,
        name: "Nome Antigo",
        updatedAt: "2026-06-01T00:00:00Z",
      })
    );

    const c = await db.getFirstAsync<{ name: string }>(
      `SELECT name FROM customers WHERE uuid = ?`,
      [uuid]
    );
    expect(c?.name).toBe("Nome Atual"); // não regrediu
  });

  it("customer_upsert não toca o saldo do cliente", async () => {
    const db = await freshDb();
    const uuid = "cust-uuid-upsert-bal";
    const custId = await seedCustomer(db, uuid, "Bal Test", -500);

    await applyEvent(
      db,
      makeCustomerUpsertEvent({
        uuid,
        name: "Bal Atualizado",
        updatedAt: "2026-06-18T10:00:00Z",
      })
    );

    const bal = await getBalance(db, custId);
    expect(bal).toBeCloseTo(-500, 5); // saldo intacto
  });
});

// ---------------------------------------------------------------------------
// Testes: customer_delete
// ---------------------------------------------------------------------------

describe("applyEvent — customer_delete", () => {
  it("deleta o cliente e desvincula suas vendas (customer_id → NULL)", async () => {
    const db = await freshDb();
    const uuid = "cust-uuid-delete-0001";
    const custId = await seedCustomer(db, uuid, "A Deletar", 0);
    await setInventory(db, 10, 0);

    // Cria uma venda vinculada ao cliente
    await applyEvent(
      db,
      makeSaleEvent({
        uuid: "sale-uuid-for-delete-cust",
        customerUuid: uuid,
        paymentMethod: "cash",
      })
    );

    // Deleta o cliente
    await applyEvent(db, makeCustomerDeleteEvent({ uuid }));

    // Cliente não deve mais existir
    const c = await db.getFirstAsync(
      `SELECT id FROM customers WHERE id = ?`,
      [custId]
    );
    expect(c).toBeNull();

    // A venda deve estar desvinculada (customer_id = NULL)
    const s = await db.getFirstAsync<{ customer_id: number | null }>(
      `SELECT customer_id FROM sales WHERE uuid = 'sale-uuid-for-delete-cust'`
    );
    expect(s?.customer_id).toBeNull();
  });

  it("customer_delete para uuid desconhecido é no-op", async () => {
    const db = await freshDb();
    await expect(
      applyEvent(db, makeCustomerDeleteEvent({ uuid: "nao-existe-uuid" }))
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Testes: cylinder_upsert
// ---------------------------------------------------------------------------

describe("applyEvent — cylinder_upsert", () => {
  it("atualiza sale_price e cost_price do P13 se updated_at é mais recente", async () => {
    const db = await freshDb();

    await applyEvent(
      db,
      makeCylinderUpsertEvent({
        salePrice: "135.00",
        costPrice: "95.00",
        updatedAt: "2026-06-18T10:00:00Z",
      })
    );

    const ct = await db.getFirstAsync<{ sale_price: number; cost_price: number }>(
      `SELECT sale_price, cost_price FROM cylinder_types WHERE name = 'P13'`
    );
    expect(ct?.sale_price).toBeCloseTo(135, 5);
    expect(ct?.cost_price).toBeCloseTo(95, 5);
  });

  it("cylinder_upsert com updated_at mais antigo não sobrescreve (LWW)", async () => {
    const db = await freshDb();

    // Primeiro, aplica uma versão recente
    await applyEvent(
      db,
      makeCylinderUpsertEvent({
        salePrice: "150.00",
        costPrice: "100.00",
        updatedAt: "2026-06-18T12:00:00Z",
      })
    );

    // Tenta aplicar versão mais antiga
    await applyEvent(
      db,
      makeCylinderUpsertEvent({
        salePrice: "120.00",
        costPrice: "90.00",
        updatedAt: "2026-06-01T00:00:00Z",
      })
    );

    const ct = await db.getFirstAsync<{ sale_price: number }>(
      `SELECT sale_price FROM cylinder_types WHERE name = 'P13'`
    );
    expect(ct?.sale_price).toBeCloseTo(150, 5); // não regrediu
  });
});

// ---------------------------------------------------------------------------
// Testes: eventos desconhecidos
// ---------------------------------------------------------------------------

describe("applyEvent — kind desconhecido", () => {
  it("ignora evento de kind desconhecido sem lançar erro", async () => {
    const db = await freshDb();
    await expect(
      applyEvent(db, {
        kind: "unknown_kind",
        sequence: 1,
        server_received_at: "2026-06-18T10:00:00Z",
        data: {},
      })
    ).resolves.not.toThrow();
  });
});
