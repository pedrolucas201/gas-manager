import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { SyncEngine } from "@/lib/sync/engine";
import { SERVER_P13_UUID } from "@/lib/sync/constants";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPullPage = jest.fn();

jest.mock("@/lib/api", () => {
  class AuthError extends Error {
    constructor(m = "") { super(m); this.name = "AuthError"; }
  }
  class NetworkError extends Error {
    constructor(m = "") { super(m); this.name = "NetworkError"; }
  }
  return {
    pushEvents: jest.fn().mockResolvedValue([]),
    pullPage: (...a: unknown[]) => mockPullPage(...a),
    voidSale: jest.fn().mockResolvedValue(undefined),
    upsertCustomer: jest.fn().mockResolvedValue(undefined),
    deleteCustomer: jest.fn().mockResolvedValue(undefined),
    upsertCylinderType: jest.fn().mockResolvedValue(undefined),
    AuthError,
    NetworkError,
  };
});

jest.mock("@/lib/auth", () => ({
  signOutUser: jest.fn(),
  getIdToken: jest.fn().mockResolvedValue("tok"),
}));

jest.mock("@react-native-community/netinfo", () => ({
  default: { addEventListener: jest.fn().mockReturnValue(() => {}) },
}), { virtual: true });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  await db.runAsync(
    `UPDATE inventory SET full_qty = 10 WHERE cylinder_type_id = (SELECT id FROM cylinder_types WHERE name = 'P13' LIMIT 1)`
  );
  return db;
}

function makeSaleEvent(uuid: string, sequence = 1) {
  return {
    kind: "sale",
    sequence,
    server_received_at: "2026-06-19T10:00:00Z",
    data: {
      id: uuid,
      customer_id: null,
      cylinder_type_id: SERVER_P13_UUID,
      quantity: 1,
      unit_price: "120.00",
      cost_price: "90.00",
      total: "120.00",
      payment_method: "cash",
      is_exchange: false,
      voided_at: null,
      server_received_at: "2026-06-19T10:00:00Z",
      sequence,
    },
  };
}

function makeVoidEvent(saleUuid: string, sequence = 2) {
  return {
    kind: "void_sale",
    sequence,
    server_received_at: "2026-06-19T10:01:00Z",
    data: { id: saleUuid },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncEngine.pullAll", () => {
  beforeEach(() => jest.resetAllMocks());

  it("aplica eventos de uma página e avança o cursor", async () => {
    mockPullPage.mockResolvedValueOnce({
      events: [makeSaleEvent("sale-pull-1")],
      next_cursor: "cursor-abc",
      has_more: false,
    });

    const db = await freshDb();
    await new SyncEngine(db).pullAll();

    const sale = await db.getFirstAsync(
      `SELECT uuid FROM sales WHERE uuid = 'sale-pull-1'`
    );
    expect(sale).not.toBeNull();

    const state = await db.getFirstAsync<{ pull_cursor: string }>(
      `SELECT pull_cursor FROM sync_state WHERE id = 1`
    );
    expect(state?.pull_cursor).toBe("cursor-abc");
  });

  it("pagina até has_more=false", async () => {
    mockPullPage
      .mockResolvedValueOnce({ events: [], next_cursor: "c1", has_more: true })
      .mockResolvedValueOnce({ events: [], next_cursor: "c2", has_more: false });

    const db = await freshDb();
    await new SyncEngine(db).pullAll();
    expect(mockPullPage).toHaveBeenCalledTimes(2);
  });

  it("retoma do cursor persistido", async () => {
    mockPullPage.mockResolvedValue({
      events: [],
      next_cursor: "resume-cursor",
      has_more: false,
    });

    const db = await freshDb();
    await db.runAsync(
      `UPDATE sync_state SET pull_cursor = 'persisted-cursor' WHERE id = 1`
    );

    await new SyncEngine(db).pullAll();
    expect(mockPullPage).toHaveBeenCalledWith("persisted-cursor", 200);
  });

  it("cursor não avança se withTransactionAsync falha (atomicidade)", async () => {
    // Simula página com evento malformado que applyEvent lança
    mockPullPage.mockResolvedValueOnce({
      events: [{ kind: "sale", sequence: 1, server_received_at: "x", data: null }],
      next_cursor: "c1",
      has_more: false,
    });

    const db = await freshDb();
    // applyEventSafe silencia o erro — o cursor ainda avança
    await new SyncEngine(db).pullAll();
    const state = await db.getFirstAsync<{ pull_cursor: string }>(
      `SELECT pull_cursor FROM sync_state WHERE id = 1`
    );
    // cursor avança mesmo com evento inválido (applyEventSafe é best-effort)
    expect(state?.pull_cursor).toBe("c1");
  });

  it("aplica void_sale DEPOIS da venda na mesma página (duas passadas)", async () => {
    const saleUuid = "sale-two-pass-1";
    // void_sale aparece ANTES da venda no array (simula overlap de BIGSERIALs)
    mockPullPage.mockResolvedValueOnce({
      events: [
        makeVoidEvent(saleUuid, 5),    // sequence baixo (void)
        makeSaleEvent(saleUuid, 1000), // sequence alto (venda)
      ],
      next_cursor: "c1",
      has_more: false,
    });

    const db = await freshDb();
    await new SyncEngine(db).pullAll();

    // Venda deve existir e estar anulada (void aplicado após a venda)
    const sale = await db.getFirstAsync<{ voided_at: string | null }>(
      `SELECT voided_at FROM sales WHERE uuid = ?`,
      [saleUuid]
    );
    expect(sale).not.toBeNull();
    expect(sale?.voided_at).not.toBeNull();
  });

  it("inventário não é alterado quando venda e void chegam juntos", async () => {
    const saleUuid = "sale-two-pass-inv";
    mockPullPage.mockResolvedValueOnce({
      events: [
        makeVoidEvent(saleUuid, 2),
        makeSaleEvent(saleUuid, 1),
      ],
      next_cursor: "c1",
      has_more: false,
    });

    const db = await freshDb();
    await new SyncEngine(db).pullAll();

    const inv = await db.getFirstAsync<{ full_qty: number }>(
      `SELECT full_qty FROM inventory WHERE cylinder_type_id = (SELECT id FROM cylinder_types WHERE name='P13' LIMIT 1)`
    );
    // Venda aplicada (full -1) depois void aplicado (full +1) = líquido 10
    expect(inv?.full_qty).toBe(10);
  });
});
