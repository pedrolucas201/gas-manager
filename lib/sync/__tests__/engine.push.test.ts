import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { enqueue } from "@/lib/sync/outbox";
import { SyncEngine, getSyncEngine, triggerManualSync } from "@/lib/sync/engine";
import { useSyncStore } from "@/store/sync";
import type { SQLiteDatabase } from "expo-sqlite";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPushEvents = jest.fn();
const mockVoidSale = jest.fn();
const mockUnvoidSale = jest.fn();
const mockUpsertCustomer = jest.fn();
const mockDeleteCustomer = jest.fn();
const mockUpsertCylinderType = jest.fn();
const mockSignOutUser = jest.fn();

jest.mock("@/lib/api", () => {
  class AuthError extends Error {
    constructor(m = "") {
      super(m);
      this.name = "AuthError";
    }
  }
  class NetworkError extends Error {
    constructor(m = "") {
      super(m);
      this.name = "NetworkError";
    }
  }
  return {
    pushEvents: (...a: unknown[]) => mockPushEvents(...a),
    voidSale: (...a: unknown[]) => mockVoidSale(...a),
    unvoidSale: (...a: unknown[]) => mockUnvoidSale(...a),
    upsertCustomer: (...a: unknown[]) => mockUpsertCustomer(...a),
    deleteCustomer: (...a: unknown[]) => mockDeleteCustomer(...a),
    upsertCylinderType: (...a: unknown[]) => mockUpsertCylinderType(...a),
    pullPage: jest.fn().mockResolvedValue({ events: [], next_cursor: "", has_more: false }),
    AuthError,
    NetworkError,
  };
});

jest.mock("@/lib/auth", () => ({
  signOutUser: () => mockSignOutUser(),
  getIdToken: jest.fn().mockResolvedValue("tok"),
}));

jest.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: jest.fn().mockReturnValue(() => {}) },
}), { virtual: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function freshDb(): Promise<SQLiteDatabase> {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

async function enqueueFact(db: SQLiteDatabase, uuid = "sale-uuid-push-1") {
  await enqueue(db, {
    event_uuid: uuid,
    kind: "sale",
    payload: JSON.stringify({
      kind: "sale",
      id: uuid,
      client_created_at: new Date().toISOString(),
      sale: {
        cylinder_type_id: "11111111-1111-1111-1111-111111111111",
        customer_id: null,
        quantity: 1,
        unit_price: "120.00",
        cost_price: "90.00",
        total: "120.00",
        payment_method: "cash",
        is_exchange: false,
      },
    }),
    client_created_at: new Date().toISOString(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncEngine.pushOnce", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPushEvents.mockResolvedValue([
      { id: "sale-uuid-push-1", status: "applied" },
    ]);
    mockVoidSale.mockResolvedValue(undefined);
    mockUnvoidSale.mockResolvedValue(undefined);
    mockUpsertCustomer.mockResolvedValue(undefined);
    mockDeleteCustomer.mockResolvedValue(undefined);
    mockUpsertCylinderType.mockResolvedValue(undefined);
    useSyncStore.setState({ voidConfirmNeeded: 0 });
  });

  it("não chama pushEvents se o outbox está vazio", async () => {
    const db = await freshDb();
    await new SyncEngine(db).pushOnce();
    expect(mockPushEvents).not.toHaveBeenCalled();
  });

  it("envia eventos de fato via pushEvents e marca done", async () => {
    const db = await freshDb();
    await enqueueFact(db);
    await new SyncEngine(db).pushOnce();
    expect(mockPushEvents).toHaveBeenCalledTimes(1);
    const pending = await db.getAllAsync(
      `SELECT * FROM sync_outbox WHERE status = 'pending'`
    );
    expect(pending).toHaveLength(0);
  });

  it("status 'duplicate' também marca done", async () => {
    mockPushEvents.mockResolvedValue([
      { id: "sale-uuid-push-1", status: "duplicate" },
    ]);
    const db = await freshDb();
    await enqueueFact(db);
    await new SyncEngine(db).pushOnce();
    const row = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'sale-uuid-push-1'`
    );
    expect(row?.status).toBe("done");
  });

  it("void_sale chama voidSale (endpoint individual) e marca done", async () => {
    const db = await freshDb();
    await enqueue(db, {
      event_uuid: "void-uuid-1",
      kind: "void_sale",
      payload: JSON.stringify({ id: "sale-ref-uuid" }),
      client_created_at: new Date().toISOString(),
    });
    await new SyncEngine(db).pushOnce();
    expect(mockVoidSale).toHaveBeenCalledWith("sale-ref-uuid");
    const row = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'void-uuid-1'`
    );
    expect(row?.status).toBe("done");
  });

  it("unvoid_sale chama unvoidSale (endpoint individual) e marca done", async () => {
    const db = await freshDb();
    await enqueue(db, {
      event_uuid: "unvoid-uuid-1",
      kind: "unvoid_sale",
      payload: JSON.stringify({ id: "sale-ref-uuid" }),
      client_created_at: new Date().toISOString(),
    });
    await new SyncEngine(db).pushOnce();
    expect(mockUnvoidSale).toHaveBeenCalledWith("sale-ref-uuid");
    const row = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'unvoid-uuid-1'`
    );
    expect(row?.status).toBe("done");
  });

  it("envia unvoid_sale DEPOIS dos voids", async () => {
    const db = await freshDb();
    const order: string[] = [];
    mockVoidSale.mockImplementation(async () => { order.push("void"); });
    mockUnvoidSale.mockImplementation(async () => { order.push("unvoid"); });

    await enqueue(db, {
      event_uuid: "void-uuid-3",
      kind: "void_sale",
      payload: JSON.stringify({ id: "sale-a" }),
      client_created_at: new Date().toISOString(),
    });
    await enqueue(db, {
      event_uuid: "unvoid-uuid-3",
      kind: "unvoid_sale",
      payload: JSON.stringify({ id: "sale-b" }),
      client_created_at: new Date().toISOString(),
    });

    await new SyncEngine(db).pushOnce();

    expect(order).toEqual(["void", "unvoid"]);
  });

  it("customer_upsert chama upsertCustomer e marca done", async () => {
    const db = await freshDb();
    const payload = { id: "cust-uuid-1", name: "Teste", phone: null, address: null, credit_limit: null, updated_at: "2026-06-19T10:00:00Z" };
    await enqueue(db, {
      event_uuid: "cu-uuid-1",
      kind: "customer_upsert",
      payload: JSON.stringify(payload),
      client_created_at: new Date().toISOString(),
    });
    await new SyncEngine(db).pushOnce();
    expect(mockUpsertCustomer).toHaveBeenCalledWith(payload);
    const row = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'cu-uuid-1'`
    );
    expect(row?.status).toBe("done");
  });

  it("envia customer_upsert ANTES dos facts (FK do fiado)", async () => {
    const db = await freshDb();
    const order: string[] = [];
    mockUpsertCustomer.mockImplementation(async () => { order.push("catalog"); });
    mockPushEvents.mockImplementation(async () => {
      order.push("facts");
      return [{ id: "sale-fiado-1", status: "applied" }];
    });

    const custPayload = { id: "cust-uuid-9", name: "Novo", phone: null, address: null, credit_limit: null, updated_at: "2026-06-23T10:00:00Z" };
    await enqueue(db, {
      event_uuid: "cu-uuid-9",
      kind: "customer_upsert",
      payload: JSON.stringify(custPayload),
      client_created_at: new Date().toISOString(),
    });
    await enqueue(db, {
      event_uuid: "sale-fiado-1",
      kind: "sale",
      payload: JSON.stringify({
        kind: "sale", id: "sale-fiado-1", client_created_at: new Date().toISOString(),
        sale: { cylinder_type_id: "11111111-1111-1111-1111-111111111111", customer_id: "cust-uuid-9", quantity: 1, unit_price: "120.00", cost_price: "90.00", total: "120.00", payment_method: "fiado", is_exchange: false },
      }),
      client_created_at: new Date().toISOString(),
    });

    await new SyncEngine(db).pushOnce();

    expect(order).toEqual(["catalog", "facts"]);
  });

  it("envia void_sale DEPOIS dos facts (venda existe antes de anular)", async () => {
    const db = await freshDb();
    const order: string[] = [];
    mockPushEvents.mockImplementation(async () => {
      order.push("facts");
      return [{ id: "sale-uuid-push-1", status: "applied" }];
    });
    mockVoidSale.mockImplementation(async () => { order.push("void"); });

    await enqueueFact(db);
    await enqueue(db, {
      event_uuid: "void-uuid-2",
      kind: "void_sale",
      payload: JSON.stringify({ id: "sale-ref" }),
      client_created_at: new Date().toISOString(),
    });

    await new SyncEngine(db).pushOnce();

    expect(order).toEqual(["facts", "void"]);
  });

  it("não envia facts se o catálogo falhar com NetworkError", async () => {
    const { NetworkError } = jest.requireMock("@/lib/api");
    mockUpsertCustomer.mockRejectedValue(new NetworkError("timeout"));
    const db = await freshDb();
    await enqueue(db, {
      event_uuid: "cu-uuid-net",
      kind: "customer_upsert",
      payload: JSON.stringify({ id: "c1", name: "X", phone: null, address: null, credit_limit: null, updated_at: "2026-06-23T10:00:00Z" }),
      client_created_at: new Date().toISOString(),
    });
    await enqueueFact(db);

    await new SyncEngine(db).pushOnce();

    expect(mockPushEvents).not.toHaveBeenCalled();
    const sale = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'sale-uuid-push-1'`
    );
    expect(sale?.status).toBe("pending");
  });

  it("AuthError no pushEvents chama signOutUser e para", async () => {
    const { AuthError } = jest.requireMock("@/lib/api");
    mockPushEvents.mockRejectedValue(new AuthError("not auth"));
    const db = await freshDb();
    await enqueueFact(db);
    await new SyncEngine(db).pushOnce();
    expect(mockSignOutUser).toHaveBeenCalled();
  });

  it("NetworkError deixa evento pending (retry depois)", async () => {
    const { NetworkError } = jest.requireMock("@/lib/api");
    mockPushEvents.mockRejectedValue(new NetworkError("timeout"));
    const db = await freshDb();
    await enqueueFact(db);
    await new SyncEngine(db).pushOnce();
    const row = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'sale-uuid-push-1'`
    );
    expect(row?.status).toBe("pending");
  });
});

describe("SyncEngine — disjuntor de cancelamento em massa", () => {
  beforeEach(() => {
    jest.clearAllMocks(); // zera contagens entre os testes deste describe
    useSyncStore.setState({ voidConfirmNeeded: 0 });
    // approveVoidBatch chama syncNow → pullAll → pullPage. Garante que o pull
    // resolve um page vazio (o resetAllMocks de outros describes pode ter
    // limpado a implementação do mock).
    const api = jest.requireMock("@/lib/api");
    api.pullPage.mockResolvedValue({ events: [], next_cursor: "", has_more: false });
    mockVoidSale.mockResolvedValue(undefined);
    mockUnvoidSale.mockResolvedValue(undefined);
    // clearAllMocks não remove implementações; o último teste do describe acima
    // deixou mockPushEvents rejeitando. Restaura um push de fato bem-sucedido.
    mockPushEvents.mockResolvedValue([{ id: "sale-uuid-push-1", status: "applied" }]);
  });

  async function enqueueVoid(db: SQLiteDatabase, n: number) {
    await enqueue(db, {
      event_uuid: `mass-void-${n}`,
      kind: "void_sale",
      payload: JSON.stringify({ id: `sale-${n}` }),
      client_created_at: new Date().toISOString(),
    });
  }

  it("NÃO envia voids quando >= limite; bloqueia e sinaliza a UI", async () => {
    const db = await freshDb();
    for (let i = 0; i < 3; i++) await enqueueVoid(db, i);

    await new SyncEngine(db).pushOnce();

    expect(mockVoidSale).not.toHaveBeenCalled();
    expect(useSyncStore.getState().voidConfirmNeeded).toBe(3);
    const pending = await db.getAllAsync(
      `SELECT * FROM sync_outbox WHERE status = 'pending' AND kind = 'void_sale'`
    );
    expect(pending).toHaveLength(3); // nada foi enviado
  });

  it("após approveVoidBatch, envia o lote e limpa o sinal", async () => {
    const db = await freshDb();
    for (let i = 0; i < 3; i++) await enqueueVoid(db, i);
    const engine = new SyncEngine(db);

    await engine.pushOnce();
    expect(useSyncStore.getState().voidConfirmNeeded).toBe(3);

    await engine.approveVoidBatch();

    expect(mockVoidSale).toHaveBeenCalledTimes(3);
    expect(useSyncStore.getState().voidConfirmNeeded).toBe(0);
    const pending = await db.getAllAsync(
      `SELECT * FROM sync_outbox WHERE status = 'pending' AND kind = 'void_sale'`
    );
    expect(pending).toHaveLength(0);
  });

  it("envia voids normalmente quando abaixo do limite (sem confirmação)", async () => {
    const db = await freshDb();
    await enqueueVoid(db, 1);
    await enqueueVoid(db, 2); // 2 < 3

    await new SyncEngine(db).pushOnce();

    expect(mockVoidSale).toHaveBeenCalledTimes(2);
    expect(useSyncStore.getState().voidConfirmNeeded).toBe(0);
  });

  it("a aprovação é one-shot: um NOVO lote >= limite bloqueia de novo", async () => {
    const db = await freshDb();
    const engine = new SyncEngine(db);

    for (let i = 0; i < 3; i++) await enqueueVoid(db, i);
    await engine.pushOnce();
    await engine.approveVoidBatch(); // envia o 1º lote
    expect(mockVoidSale).toHaveBeenCalledTimes(3);

    // Novo lote de 3 cancelamentos deve voltar a exigir confirmação.
    for (let i = 10; i < 13; i++) await enqueueVoid(db, i);
    await engine.pushOnce();

    expect(useSyncStore.getState().voidConfirmNeeded).toBe(3);
    expect(mockVoidSale).toHaveBeenCalledTimes(3); // nada novo enviado sem aprovar
  });

  it("com gate ativo, catálogo e fatos AINDA são enviados; unvoids ficam represados", async () => {
    const db = await freshDb();
    await enqueueFact(db); // 1 fato
    for (let i = 0; i < 3; i++) await enqueueVoid(db, i); // dispara o gate
    await enqueue(db, {
      event_uuid: "unvoid-gated",
      kind: "unvoid_sale",
      payload: JSON.stringify({ id: "sale-x" }),
      client_created_at: new Date().toISOString(),
    });

    await new SyncEngine(db).pushOnce();

    expect(mockPushEvents).toHaveBeenCalledTimes(1); // fato enviado
    expect(mockVoidSale).not.toHaveBeenCalled();
    expect(mockUnvoidSale).not.toHaveBeenCalled(); // unvoid represado com os voids
    expect(useSyncStore.getState().voidConfirmNeeded).toBe(3);
  });
});

describe("SyncEngine — engine ativo (pull-to-refresh)", () => {
  it("start() registra o engine ativo; stop() limpa", async () => {
    const db = await freshDb();
    const engine = new SyncEngine(db);
    expect(getSyncEngine()).toBeNull();
    engine.start();
    expect(getSyncEngine()).toBe(engine);
    engine.stop();
    expect(getSyncEngine()).toBeNull();
  });

  it("triggerManualSync é no-op seguro quando não há engine ativo", async () => {
    // Garante que nenhum engine está ativo.
    const db = await freshDb();
    const engine = new SyncEngine(db);
    engine.start();
    engine.stop();
    await expect(triggerManualSync()).resolves.toBeUndefined();
  });
});
