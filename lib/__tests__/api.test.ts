/**
 * Testes para lib/api.ts
 *
 * Firebase é completamente isolado via jest.mock('../auth').
 * fetch global é substituído por jest.fn() em cada teste.
 */

import { getIdToken } from "../auth";
import {
  pushEvents,
  pullPage,
  upsertCustomer,
  deleteCustomer,
  upsertCylinderType,
  voidSale,
  unvoidSale,
  AuthError,
  NetworkError,
  ApiError,
} from "../api";

// Impede qualquer importação real do Firebase no ambiente Node
jest.mock("../auth", () => ({
  getIdToken: jest.fn(),
}));

const mockGetIdToken = getIdToken as jest.MockedFunction<typeof getIdToken>;

const BASE = "https://api.example.com";

// Salva e restaura process.env entre testes
const originalEnv = process.env;
beforeAll(() => {
  process.env = {
    ...originalEnv,
    EXPO_PUBLIC_API_BASE_URL: BASE,
  };
});
afterAll(() => {
  process.env = originalEnv;
});

// Helper: cria um fetch mock que resolve com status + body JSON
function mockFetch(status: number, body: unknown): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
  global.fetch = fn;
  return fn;
}

// Helper: cria um fetch mock cujo json() rejeita (body inválido/vazio)
function mockFetchBadJson(status: number): jest.Mock {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError("Unexpected end of JSON input")),
  });
  global.fetch = fn;
  return fn;
}

// Helper: cria um fetch mock que rejeita (falha de transporte)
function mockFetchNetworkError(message = "Failed to fetch"): jest.Mock {
  const fn = jest.fn().mockRejectedValue(new TypeError(message));
  global.fetch = fn;
  return fn;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetIdToken.mockResolvedValue("test-id-token");
});

// ---------------------------------------------------------------------------
// pushEvents
// ---------------------------------------------------------------------------

describe("pushEvents", () => {
  it("POST /sync/push com Authorization: Bearer e body {events}", async () => {
    const events = [
      {
        kind: "sale" as const,
        id: "uuid-1",
        client_created_at: "2026-06-18T10:00:00Z",
        sale: {
          customer_id: null,
          cylinder_type_id: "cyl-uuid",
          quantity: 1,
          unit_price: "50.00",
          cost_price: "30.00",
          total: "50.00",
          payment_method: "dinheiro",
          is_exchange: false,
        },
      },
    ];

    const responseBody = {
      results: [
        {
          id: "uuid-1",
          status: "applied",
          sequence: 1,
          server_received_at: "2026-06-18T10:00:00Z",
        },
      ],
    };
    const fetchMock = mockFetch(200, responseBody);

    const results = await pushEvents(events);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/sync/push`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-id-token"
    );
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json"
    );
    expect(JSON.parse(init.body as string)).toEqual({ events });
    expect(results).toEqual(responseBody.results);
  });

  it("retorna results do servidor", async () => {
    const results = [
      { id: "uuid-2", status: "duplicate" },
      { id: "uuid-3", status: "applied", sequence: 2 },
    ];
    mockFetch(200, { results });
    const out = await pushEvents([]);
    expect(out).toEqual(results);
  });
});

// ---------------------------------------------------------------------------
// pullPage
// ---------------------------------------------------------------------------

describe("pullPage", () => {
  it("GET /sync/pull?since=<cursor>&limit=<n> com Authorization: Bearer", async () => {
    const responseBody = {
      events: [],
      next_cursor: "eyJzYWxlIjoxfQ==",
      has_more: false,
    };
    const fetchMock = mockFetch(200, responseBody);

    const cursor = "eyJzYWxlIjowfQ==";
    const limit = 50;
    const page = await pullPage(cursor, limit);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/sync/pull?since=${encodeURIComponent(cursor)}&limit=${limit}`);
    expect(init.method).toBe("GET");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-id-token"
    );
    expect(page).toEqual(responseBody);
  });

  it("since='' (cursor vazio) é enviado sem encode como string vazia", async () => {
    mockFetch(200, { events: [], next_cursor: "", has_more: false });
    const fetchMock = global.fetch as jest.Mock;

    await pullPage("", 100);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    // since="" deve aparecer na query string
    expect(url).toContain("since=");
    expect(url).toContain("limit=100");
  });

  it("retorna events, next_cursor e has_more do servidor", async () => {
    const body = {
      events: [{ kind: "sale", sequence: 1, server_received_at: "...", data: {} }],
      next_cursor: "abc123",
      has_more: true,
    };
    mockFetch(200, body);
    const page = await pullPage("", 10);
    expect(page.events).toEqual(body.events);
    expect(page.next_cursor).toBe("abc123");
    expect(page.has_more).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Classificação de erros
// ---------------------------------------------------------------------------

describe("classificação de erros HTTP", () => {
  it("401 lança AuthError", async () => {
    mockFetch(401, { error: "unauthorized" });
    await expect(pullPage("", 10)).rejects.toBeInstanceOf(AuthError);
  });

  it("403 lança AuthError", async () => {
    mockFetch(403, { error: "forbidden" });
    await expect(pullPage("", 10)).rejects.toBeInstanceOf(AuthError);
  });

  it("500 lança ApiError com status 500", async () => {
    mockFetch(500, { error: "internal_error" });
    const err = await pullPage("", 10).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(500);
  });

  it("404 lança ApiError com status 404", async () => {
    mockFetch(404, { error: "not_found" });
    const err = await pullPage("", 10).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });

  it("falha de transporte (rede) lança NetworkError", async () => {
    mockFetchNetworkError("Network request failed");
    await expect(pullPage("", 10)).rejects.toBeInstanceOf(NetworkError);
  });

  it("NetworkError também ocorre em pushEvents", async () => {
    mockFetchNetworkError();
    await expect(pushEvents([])).rejects.toBeInstanceOf(NetworkError);
  });

  it("401 em pushEvents lança AuthError", async () => {
    mockFetch(401, { error: "unauthorized" });
    await expect(pushEvents([])).rejects.toBeInstanceOf(AuthError);
  });

  // Fix #2: body JSON inválido/vazio em resposta 2xx deve lançar ApiError (não SyntaxError bruto)
  it("2xx com JSON inválido lança ApiError (não SyntaxError bruto)", async () => {
    mockFetchBadJson(200);
    const err = await pullPage("", 10).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(200);
  });

  // Fix #3: 409 deve carregar a mensagem do servidor no ApiError
  it("409 lança ApiError com status 409 e mensagem do servidor", async () => {
    mockFetch(409, { error: "balance_owed" });
    const err = await deleteCustomer("cust-uuid").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toBe("balance_owed");
  });
});

// ---------------------------------------------------------------------------
// Sem token: AuthError imediato (sem chamar fetch)
// ---------------------------------------------------------------------------

describe("sem token de autenticação", () => {
  it("lança AuthError se getIdToken retornar null", async () => {
    mockGetIdToken.mockResolvedValue(null);
    const fetchMock = mockFetch(200, {});
    await expect(pullPage("", 10)).rejects.toBeInstanceOf(AuthError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// upsertCustomer
// ---------------------------------------------------------------------------

describe("upsertCustomer", () => {
  it("PUT /catalog/customers com body CustomerInput", async () => {
    const fetchMock = mockFetch(204, null);
    const input = {
      id: "cust-uuid",
      name: "João",
      phone: null,
      address: null,
      credit_limit: null,
      updated_at: "2026-06-18T10:00:00Z",
    };

    await upsertCustomer(input);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/catalog/customers`);
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-id-token"
    );
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// deleteCustomer
// ---------------------------------------------------------------------------

describe("deleteCustomer", () => {
  it("DELETE /catalog/customers/{id} → 204 resolve sem valor", async () => {
    const fetchMock = mockFetch(204, null);
    await expect(deleteCustomer("cust-uuid")).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/catalog/customers/cust-uuid`);
    expect(init.method).toBe("DELETE");
  });

  it("409 (balance_owed) lança ApiError com status 409", async () => {
    mockFetch(409, { error: "balance_owed" });
    const err = await deleteCustomer("cust-uuid").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// upsertCylinderType
// ---------------------------------------------------------------------------

describe("upsertCylinderType", () => {
  it("PUT /catalog/cylinder-types/{id} com body CylinderTypeInput", async () => {
    const fetchMock = mockFetch(204, null);
    const input = {
      sale_price: "80.00",
      cost_price: "50.00",
      active: true,
      updated_at: "2026-06-18T10:00:00Z",
    };

    await upsertCylinderType("cyl-uuid", input);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/catalog/cylinder-types/cyl-uuid`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual(input);
  });
});

// ---------------------------------------------------------------------------
// voidSale
// ---------------------------------------------------------------------------

describe("voidSale", () => {
  it("POST /sync/void-sale com body {id}", async () => {
    const fetchMock = mockFetch(200, { status: "voided" });

    await voidSale("sale-uuid");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/sync/void-sale`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ id: "sale-uuid" });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-id-token"
    );
  });
});

// ---------------------------------------------------------------------------
// unvoidSale
// ---------------------------------------------------------------------------

describe("unvoidSale", () => {
  it("POST /sync/unvoid-sale com body {id}", async () => {
    const fetchMock = mockFetch(200, { status: "unvoided" });

    await unvoidSale("sale-uuid");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE}/sync/unvoid-sale`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ id: "sale-uuid" });
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer test-id-token"
    );
  });
});

// ---------------------------------------------------------------------------
// Classes de erro exportadas (instâncias corretas)
// ---------------------------------------------------------------------------

describe("classes de erro", () => {
  it("AuthError é instância de Error", () => {
    const e = new AuthError("sem sessão");
    expect(e).toBeInstanceOf(Error);
    expect(e.message).toBe("sem sessão");
  });

  it("NetworkError é instância de Error", () => {
    const e = new NetworkError("rede");
    expect(e).toBeInstanceOf(Error);
  });

  it("ApiError carrega status", () => {
    const e = new ApiError(422, "Unprocessable Entity");
    expect(e).toBeInstanceOf(Error);
    expect(e.status).toBe(422);
  });
});
