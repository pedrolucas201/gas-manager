/**
 * Cliente HTTP do backend gas-manager.
 *
 * Responsabilidades:
 *  - Injetar o Bearer token do Firebase em toda requisição autenticada.
 *  - Classificar falhas:
 *      AuthError    → getIdToken() retornou null (sem sessão) OU resposta 401/403.
 *      NetworkError → fetch() rejeitou (falha de transporte/rede).
 *      ApiError     → resposta não-2xx que não seja 401/403 (carrega .status).
 *  - Expor funções tipadas que mapeiam 1:1 com os endpoints do backend.
 *
 * Decisão de design: se getIdToken() retornar null (usuário não autenticado),
 * lançamos AuthError imediatamente sem chamar fetch, pois todos os endpoints
 * cobertos aqui exigem autenticação. Isso evita enviar requisições sem Bearer
 * que inevitavelmente receberiam 401.
 *
 * Dinheiro: todos os campos monetários são strings (como nos DTOs do backend Go).
 */

import { getIdToken } from "./auth";

// ---------------------------------------------------------------------------
// Classes de erro
// ---------------------------------------------------------------------------

export class AuthError extends Error {
  constructor(message = "Não autenticado") {
    super(message);
    this.name = "AuthError";
  }
}

export class NetworkError extends Error {
  constructor(message = "Falha de rede") {
    super(message);
    this.name = "NetworkError";
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message = `Erro HTTP ${status}`
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------------------
// Tipos — shapes mapeados dos DTOs Go
// ---------------------------------------------------------------------------

export interface SalePayload {
  customer_id: string | null;
  cylinder_type_id: string;
  quantity: number;
  unit_price: string; // money como string
  cost_price: string; // money como string
  total: string; // money como string
  payment_method: string;
  is_exchange: boolean;
}

export interface RestockPayload {
  cylinder_type_id: string;
  quantity: number;
  cost_per_unit: string; // money como string
  total_cost: string; // money como string
  notes: string | null;
}

export interface StockAdjPayload {
  cylinder_type_id: string;
  field: "full" | "empty";
  delta: number;
  reason: string | null;
}

export interface SettlePayload {
  customer_id: string;
  amount: string; // money como string
  payment_method: string;
}

export interface PushEvent {
  kind: "sale" | "restock" | "stock_adjustment" | "debt_settlement";
  id: string; // client UUID
  client_created_at: string; // RFC3339
  sale?: SalePayload;
  restock?: RestockPayload;
  stock_adjustment?: StockAdjPayload;
  debt_settlement?: SettlePayload;
}

export interface PushResult {
  id: string;
  status: "applied" | "duplicate" | "error";
  sequence?: number;
  server_received_at?: string;
  error?: string;
}

export interface PullEvent {
  kind: string;
  sequence: number;
  server_received_at: string;
  data: unknown;
}

export interface PullPageResponse {
  events: PullEvent[];
  next_cursor: string;
  has_more: boolean;
}

export interface CustomerInput {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  credit_limit: string | null; // money como string
  updated_at: string; // RFC3339
}

export interface CylinderTypeInput {
  sale_price: string; // money como string
  cost_price: string; // money como string
  active: boolean;
  updated_at: string; // RFC3339
}

// ---------------------------------------------------------------------------
// Helper central: request()
// ---------------------------------------------------------------------------

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

async function request<T>(
  method: HttpMethod,
  path: string,
  body?: unknown
): Promise<T> {
  const token = await getIdToken();
  if (token === null) {
    throw new AuthError("Sessão expirada ou usuário não autenticado");
  }

  const base = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";
  const url = `${base}${path}`;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (cause) {
    throw new NetworkError(
      cause instanceof Error ? cause.message : "Falha de rede"
    );
  }

  if (!response.ok) {
    // Fix #3: lê o body de erro defensivamente para capturar mensagem do servidor
    let serverMsg: string | undefined;
    try {
      serverMsg = ((await response.json()) as { error?: string }).error;
    } catch {
      /* ignora body não-JSON ou vazio */
    }
    if (response.status === 401 || response.status === 403) {
      throw new AuthError(serverMsg ?? `HTTP ${response.status}`);
    }
    throw new ApiError(response.status, serverMsg ?? `Erro HTTP ${response.status}`);
  }

  // 204 No Content — sem body
  if (response.status === 204) {
    return undefined as unknown as T;
  }

  // Fix #2: parse seguro — body malformado/vazio vira ApiError classificado
  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError(response.status, "Resposta inválida do servidor");
  }
}

// ---------------------------------------------------------------------------
// Funções públicas
// ---------------------------------------------------------------------------

/**
 * POST /sync/push — envia um lote de eventos ao servidor.
 * Retorna os resultados por evento (applied | duplicate | error).
 */
export async function pushEvents(events: PushEvent[]): Promise<PushResult[]> {
  const res = await request<{ results: PushResult[] }>("POST", "/sync/push", {
    events,
  });
  return res.results;
}

/**
 * GET /sync/pull?since=<cursor>&limit=<n> — busca a próxima página de eventos.
 * cursor="" significa "desde o início".
 * O since é sempre incluído na query string (mesmo quando vazio).
 */
export async function pullPage(
  cursor: string,
  limit: number
): Promise<PullPageResponse> {
  const params = new URLSearchParams();
  params.set("since", cursor);
  params.set("limit", String(limit));
  return request<PullPageResponse>("GET", `/sync/pull?${params.toString()}`);
}

/**
 * PUT /catalog/customers — upsert de cliente (LWW por updated_at).
 * Resolve sem valor em caso de sucesso (204).
 */
export async function upsertCustomer(input: CustomerInput): Promise<void> {
  await request<void>("PUT", "/catalog/customers", input);
}

/**
 * DELETE /catalog/customers/{id} — remove cliente.
 * Lança ApiError(409) se o cliente tiver saldo devedor (balance_owed).
 * Resolve sem valor se bem-sucedido (204).
 */
export async function deleteCustomer(id: string): Promise<void> {
  await request<void>("DELETE", `/catalog/customers/${id}`);
}

/**
 * PUT /catalog/cylinder-types/{id} — atualiza preços/status do tipo de cilindro (LWW).
 * Resolve sem valor em caso de sucesso (204).
 */
export async function upsertCylinderType(
  id: string,
  input: CylinderTypeInput
): Promise<void> {
  await request<void>("PUT", `/catalog/cylinder-types/${id}`, input);
}

/**
 * POST /sync/void-sale — anula uma venda pelo ID.
 * Retorna { status: "voided" } do servidor.
 */
export async function voidSale(id: string): Promise<{ status: string }> {
  return request<{ status: string }>("POST", "/sync/void-sale", { id });
}
