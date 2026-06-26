/**
 * apply.ts — aplica um evento pullado do servidor no SQLite local.
 *
 * Responsabilidade única: traduzir um PullEvent para operações SQLite locais,
 * com dedupe por uuid (INSERT OR IGNORE + changes()==0 → pula o bump de
 * agregados). Sem HTTP, sem lógica de cursor (isso fica em engine.ts).
 *
 * -----------------------------------------------------------------------
 * CONVENÇÃO DE SINAL (CRÍTICO — leia antes de mexer neste arquivo)
 * -----------------------------------------------------------------------
 * Servidor (Postgres):  balance POSITIVO = dívida
 *   • Fiado: BumpCustomerBalance(+total)    → balance sobe
 *   • Quitação: BumpCustomerBalance(-amount) → balance desce
 *
 * Local (SQLite):       balance NEGATIVO = dívida
 *   • Fiado: balance = balance - total      → balance desce (fica negativo)
 *   • Quitação: balance = balance + amount  → balance sobe (em direção a 0)
 *
 * Os valores numéricos de total/amount são sempre positivos em ambos os
 * lados. Apenas a direção da operação difere. apply.ts usa a convenção
 * LOCAL em todas as operações SQL.
 *
 * -----------------------------------------------------------------------
 * RESOLUÇÃO DE FOREIGN KEYS (UUID → ID local)
 * -----------------------------------------------------------------------
 * cylinder_type_id (servidor UUID 11111111-...) → SELECT id FROM cylinder_types
 *   WHERE name='P13' LIMIT 1. Sempre resolvível (app é P13-only).
 *
 * customer_id (UUID) → SELECT id FROM customers WHERE uuid=?
 *   Se AUSENTE (cliente ainda não pullado): insere um placeholder
 *   (uuid + name='(sincronizando)', balance=0) para que o saldo da venda
 *   fiado fique vinculado. Um customer_upsert posterior atualiza os campos
 *   reais via LWW. Isso garante que a dívida não se perde por ordem de
 *   chegada dos eventos.
 *   Alternativa descartada (NULL + reconciliar depois): perderia o vínculo
 *   do saldo fiado até a chegada do customer_upsert.
 *
 * -----------------------------------------------------------------------
 * SHAPES DOS DADOS PULLADOS (derivados de backend/internal/db/gen/events.sql.go)
 * -----------------------------------------------------------------------
 * sale:            { id, customer_id, cylinder_type_id, quantity, unit_price,
 *                    cost_price, total, payment_method, is_exchange, voided_at,
 *                    server_received_at, sequence }
 *   money = string (pgtype.Numeric.MarshalJSON emite string decimal)
 *   voided_at = string ISO ou null
 *
 * restock:         { id, cylinder_type_id, quantity, cost_per_unit, total_cost,
 *                    notes, server_received_at, sequence }
 *
 * stock_adjustment:{ id, cylinder_type_id, field("full"|"empty"), delta(int),
 *                    reason, server_received_at, sequence }
 *
 * debt_settlement: { id, customer_id, amount, payment_method,
 *                    server_received_at, sequence }
 *
 * customer_upsert: { id, name, phone, address, updated_at }
 *   (enviado via PUT /catalog/customers; pode também chegar no pull stream
 *    como evento de catálogo — shape idêntica ao payload do endpoint)
 *
 * customer_delete: { id }
 *
 * cylinder_upsert: { id, sale_price, cost_price, updated_at }
 */

import type { SQLiteDatabase } from "expo-sqlite";
import type { PullEvent } from "@/lib/api";

// ---------------------------------------------------------------------------
// Tipos de dados pullados (shapes do servidor)
// ---------------------------------------------------------------------------

interface PulledSale {
  id: string;
  customer_id: string | null;
  cylinder_type_id: string;
  quantity: number;
  unit_price: string;
  cost_price: string;
  total: string;
  payment_method: string;
  is_exchange: boolean;
  voided_at: string | null;
  server_received_at: string;
  client_created_at: string;
}

interface PulledRestock {
  id: string;
  cylinder_type_id: string;
  quantity: number;
  cost_per_unit: string;
  total_cost: string;
  notes: string | null;
  server_received_at: string;
  client_created_at: string;
}

interface PulledStockAdj {
  id: string;
  cylinder_type_id: string;
  field: "full" | "empty";
  delta: number;
  reason: string | null;
}

interface PulledSettlement {
  id: string;
  customer_id: string;
  amount: string;
  payment_method: string;
  client_created_at: string;
}

interface PulledCustomerUpsert {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  updated_at: string;
}

interface PulledCustomerDelete {
  id: string;
}

interface PulledCylinderUpsert {
  id: string;
  sale_price: string;
  cost_price: string;
  updated_at: string;
}

interface PulledVoidSale {
  id: string;
}

interface PulledUnvoidSale {
  id: string;
}

interface PulledExpense {
  id: string;
  category: string;
  description: string | null;
  amount: string;
  server_received_at: string;
  client_created_at: string;
}

interface PulledStockSet {
  id: string;
  cylinder_type_id: string;
  full_qty: number;
  empty_qty: number;
  client_created_at: string;
  server_received_at: string;
}

// ---------------------------------------------------------------------------
// Ponto de entrada público
// ---------------------------------------------------------------------------

/**
 * applyEvent aplica um único PullEvent no banco SQLite local.
 * Todos os kinds de fatos usam dedupe por uuid (INSERT OR IGNORE).
 * Eventos de catálogo usam upsert LWW por updated_at.
 * Eventos desconhecidos são silenciosamente ignorados.
 */
export async function applyEvent(db: SQLiteDatabase, event: PullEvent): Promise<void> {
  switch (event.kind) {
    case "sale":
      return applySale(db, event.data as PulledSale);
    case "void_sale":
      return applyVoidSale(db, event.data as PulledVoidSale);
    case "unvoid_sale":
      return applyUnvoidSale(db, event.data as PulledUnvoidSale);
    case "restock":
      return applyRestock(db, event.data as PulledRestock);
    case "stock_adjustment":
      return applyStockAdj(db, event.data as PulledStockAdj);
    case "debt_settlement":
      return applySettlement(db, event.data as PulledSettlement);
    case "customer_upsert":
      return applyCustomerUpsert(db, event.data as PulledCustomerUpsert);
    case "customer_delete":
      return applyCustomerDelete(db, event.data as PulledCustomerDelete);
    case "cylinder_upsert":
      return applyCylinderUpsert(db, event.data as PulledCylinderUpsert);
    case "expense":
      return applyExpense(db, event.data as PulledExpense);
    case "stock_set":
      return applyStockSet(db, event.data as PulledStockSet);
    default:
      // Kind desconhecido — ignorar silenciosamente para compatibilidade futura.
      return;
  }
}

// ---------------------------------------------------------------------------
// Helpers de resolução de FK
// ---------------------------------------------------------------------------

/**
 * Retorna o id local (INTEGER PK) do único cilindro P13.
 * Lança se não encontrado (não deveria acontecer após initDatabase).
 */
async function resolveP13LocalId(db: SQLiteDatabase): Promise<number> {
  const r = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM cylinder_types WHERE name = 'P13' LIMIT 1`
  );
  if (!r) throw new Error("apply.ts: cilindro P13 não encontrado no banco local");
  return r.id;
}

/**
 * Resolve o uuid de um cliente para o seu id local (INTEGER PK).
 * Se o cliente ainda não existe localmente, insere um placeholder para que
 * a venda fiado tenha o customer_id correto e o saldo seja rastreado.
 * Um customer_upsert posterior atualiza name/phone/address via LWW.
 *
 * Decisão documentada: preferimos placeholder a NULL para não perder o
 * vínculo do saldo fiado quando o customer_upsert chega depois.
 */
async function resolveOrCreateCustomer(
  db: SQLiteDatabase,
  customerUuid: string
): Promise<number> {
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM customers WHERE uuid = ?`,
    [customerUuid]
  );
  if (existing) return existing.id;

  // Insere placeholder. updated_at='' garante que qualquer customer_upsert
  // real (com updated_at preenchido) vença no LWW de applyCustomerUpsert.
  const r = await db.runAsync(
    `INSERT INTO customers (name, uuid, balance, updated_at)
     VALUES ('(sincronizando)', ?, 0, '')`,
    [customerUuid]
  );
  return r.lastInsertRowId;
}

// ---------------------------------------------------------------------------
// Handlers por kind
// ---------------------------------------------------------------------------

async function applySale(db: SQLiteDatabase, d: PulledSale): Promise<void> {
  const cylinderTypeId = await resolveP13LocalId(db);
  const total = parseFloat(d.total);
  const unitPrice = parseFloat(d.unit_price);
  const costPrice = parseFloat(d.cost_price);
  const isExchange = d.is_exchange ? 1 : 0;

  // Resolve customer. null customer_id na venda = venda anônima (sem fiado).
  let customerId: number | null = null;
  if (d.customer_id) {
    customerId = await resolveOrCreateCustomer(db, d.customer_id);
  }

  // INSERT OR IGNORE — dedupe por uuid.
  const ins = await db.runAsync(
    `INSERT OR IGNORE INTO sales
       (uuid, customer_id, cylinder_type_id, quantity, unit_price, cost_price,
        total, payment_method, is_exchange, created_at, voided_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.id,
      customerId,
      cylinderTypeId,
      d.quantity,
      unitPrice,
      costPrice,
      total,
      d.payment_method,
      isExchange,
      d.client_created_at,
      d.voided_at ?? null,
    ]
  );

  // Se changes()==0, o uuid já existia → no-op (dedupe).
  if (ins.changes === 0) return;

  // A venda foi inserida: determinar o estado líquido dos agregados.
  // Se a venda já vem voided (voided_at não-null), os agregados se cancelam:
  // insere e anula imediatamente (efeito líquido = zero).
  if (d.voided_at) {
    // Efeito líquido: sem impacto em inventário nem balanço.
    return;
  }

  // Bump inventário: full_qty -= quantity, empty_qty += qty se troca.
  // Sem clamp — paridade com o backend (BumpInventoryForSale não clampa) e
  // convergência determinística (MAX não é comutativo nem associativo).
  await db.runAsync(
    `UPDATE inventory
     SET full_qty  = full_qty - ?,
         empty_qty = empty_qty + ?
     WHERE cylinder_type_id = ?`,
    [d.quantity, d.is_exchange ? d.quantity : 0, cylinderTypeId]
  );

  // Bump balanço do cliente se fiado.
  // Convenção local: balance NEGATIVO = dívida → balance - total.
  if (d.payment_method === "fiado" && customerId !== null) {
    await db.runAsync(
      `UPDATE customers SET balance = balance - ? WHERE id = ?`,
      [total, customerId]
    );
  }
}

async function applyVoidSale(db: SQLiteDatabase, d: PulledVoidSale): Promise<void> {
  // Busca a venda pelo uuid. Só prossegue se encontrada E ainda não anulada.
  const sale = await db.getFirstAsync<{
    id: number;
    customer_id: number | null;
    cylinder_type_id: number;
    quantity: number;
    total: number;
    payment_method: string;
    is_exchange: number;
    voided_at: string | null;
  }>(
    `SELECT id, customer_id, cylinder_type_id, quantity, total,
            payment_method, is_exchange, voided_at
     FROM sales WHERE uuid = ?`,
    [d.id]
  );

  // UUID desconhecido → no-op.
  if (!sale) return;

  // Já anulada → no-op (idempotência; a reversão só ocorre uma vez).
  if (sale.voided_at !== null) return;

  // Marca voided_at.
  await db.runAsync(
    `UPDATE sales SET voided_at = datetime('now') WHERE id = ?`,
    [sale.id]
  );

  // Reverte inventário: full_qty += quantity; empty_qty -= qty (se troca).
  // Sem clamp — simétrico ao applySale e à paridade com o backend.
  await db.runAsync(
    `UPDATE inventory
     SET full_qty  = full_qty + ?,
         empty_qty = empty_qty - ?
     WHERE cylinder_type_id = ?`,
    [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
  );

  // Reverte balanço se fiado + cliente vinculado.
  // Convenção local: anular fiado → balance + total (dívida some).
  if (sale.payment_method === "fiado" && sale.customer_id !== null) {
    await db.runAsync(
      `UPDATE customers SET balance = balance + ? WHERE id = ?`,
      [sale.total, sale.customer_id]
    );
  }
}

async function applyUnvoidSale(db: SQLiteDatabase, d: PulledUnvoidSale): Promise<void> {
  // Busca a venda pelo uuid. Só prossegue se encontrada E atualmente anulada.
  const sale = await db.getFirstAsync<{
    id: number;
    customer_id: number | null;
    cylinder_type_id: number;
    quantity: number;
    total: number;
    payment_method: string;
    is_exchange: number;
    voided_at: string | null;
  }>(
    `SELECT id, customer_id, cylinder_type_id, quantity, total,
            payment_method, is_exchange, voided_at
     FROM sales WHERE uuid = ?`,
    [d.id]
  );

  // UUID desconhecido → no-op.
  if (!sale) return;

  // Já ativa → no-op (idempotência; a re-aplicação só ocorre uma vez).
  if (sale.voided_at === null) return;

  // Limpa voided_at.
  await db.runAsync(`UPDATE sales SET voided_at = NULL WHERE id = ?`, [sale.id]);

  // Re-aplica como applySale: full_qty -= quantity; empty_qty += qty (se troca).
  // Sem clamp — simétrico ao applySale e à paridade com o backend.
  await db.runAsync(
    `UPDATE inventory
     SET full_qty  = full_qty - ?,
         empty_qty = empty_qty + ?
     WHERE cylinder_type_id = ?`,
    [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
  );

  // Re-aplica balanço se fiado + cliente vinculado.
  // Convenção local: venda fiado → balance - total (dívida volta).
  if (sale.payment_method === "fiado" && sale.customer_id !== null) {
    await db.runAsync(
      `UPDATE customers SET balance = balance - ? WHERE id = ?`,
      [sale.total, sale.customer_id]
    );
  }
}

async function applyRestock(db: SQLiteDatabase, d: PulledRestock): Promise<void> {
  const cylinderTypeId = await resolveP13LocalId(db);
  const costPerUnit = parseFloat(d.cost_per_unit);
  const totalCost = parseFloat(d.total_cost);

  const ins = await db.runAsync(
    `INSERT OR IGNORE INTO restocks
       (uuid, cylinder_type_id, quantity, cost_per_unit, total_cost, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      d.id,
      cylinderTypeId,
      d.quantity,
      costPerUnit,
      totalCost,
      d.notes ?? null,
      d.client_created_at,
    ]
  );

  if (ins.changes === 0) return; // dedupe

  await db.runAsync(
    `UPDATE inventory SET full_qty = full_qty + ? WHERE cylinder_type_id = ?`,
    [d.quantity, cylinderTypeId]
  );
}

async function applyStockAdj(db: SQLiteDatabase, d: PulledStockAdj): Promise<void> {
  const cylinderTypeId = await resolveP13LocalId(db);

  // Dedupe via applied_events (tabela de fatos visitados do pull stream).
  const dedup = await db.runAsync(
    `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
    [d.id]
  );

  if (dedup.changes === 0) return; // já aplicado

  // Aplica o delta sem clamp — paridade com o backend (BumpInventoryField não
  // clampa) e convergência determinística. Negativo é sinal real, não erro.
  if (d.field === "full") {
    await db.runAsync(
      `UPDATE inventory
       SET full_qty = full_qty + ?
       WHERE cylinder_type_id = ?`,
      [d.delta, cylinderTypeId]
    );
  } else {
    await db.runAsync(
      `UPDATE inventory
       SET empty_qty = empty_qty + ?
       WHERE cylinder_type_id = ?`,
      [d.delta, cylinderTypeId]
    );
  }
}

async function applySettlement(db: SQLiteDatabase, d: PulledSettlement): Promise<void> {
  // Dedupe via applied_events.
  const dedup = await db.runAsync(
    `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
    [d.id]
  );

  if (dedup.changes === 0) return;

  // Resolve o cliente. Se ausente, cria placeholder — mas sem saldo a vincular.
  const customerId = await resolveOrCreateCustomer(db, d.customer_id);
  const amount = parseFloat(d.amount);

  // Convenção local: quitação aumenta balance (em direção a 0).
  await db.runAsync(
    `UPDATE customers SET balance = balance + ? WHERE id = ?`,
    [amount, customerId]
  );

  const customer = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM customers WHERE id = ?`,
    [customerId]
  );

  // Grava no log local (INSERT OR IGNORE para idempotência adicional).
  await db.runAsync(
    `INSERT OR IGNORE INTO debt_settlements
       (uuid, customer_id, customer_name, amount, payment_method, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [d.id, customerId, customer?.name ?? "(sincronizando)", amount, d.payment_method, d.client_created_at]
  );
}

async function applyCustomerUpsert(
  db: SQLiteDatabase,
  d: PulledCustomerUpsert
): Promise<void> {
  // LWW: insere se não existe; atualiza campos não-financeiros se updated_at
  // do evento é mais recente que o local. Saldo (balance) nunca é tocado.
  await db.runAsync(
    `INSERT INTO customers (uuid, name, phone, address, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(uuid) DO UPDATE SET
       name       = excluded.name,
       phone      = excluded.phone,
       address    = excluded.address,
       updated_at = excluded.updated_at
     WHERE excluded.updated_at > customers.updated_at`,
    [d.id, d.name, d.phone ?? null, d.address ?? null, d.updated_at]
  );
}

async function applyCustomerDelete(
  db: SQLiteDatabase,
  d: PulledCustomerDelete
): Promise<void> {
  // Busca o id local pelo uuid.
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM customers WHERE uuid = ?`,
    [d.id]
  );
  if (!existing) return; // UUID desconhecido → no-op

  // Desvincula vendas (preserva histórico, igual ao deleteCustomer local).
  await db.runAsync(
    `UPDATE sales SET customer_id = NULL WHERE customer_id = ?`,
    [existing.id]
  );
  await db.runAsync(`DELETE FROM customers WHERE id = ?`, [existing.id]);
}

async function applyExpense(db: SQLiteDatabase, d: PulledExpense): Promise<void> {
  await db.runAsync(
    `INSERT OR IGNORE INTO expenses (uuid, category, description, amount, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    [d.id, d.category, d.description ?? null, parseFloat(d.amount), d.client_created_at]
  );
}

async function applyStockSet(db: SQLiteDatabase, d: PulledStockSet): Promise<void> {
  const cylinderTypeId = await resolveP13LocalId(db);

  // Dedupe: se este evento já foi aplicado (inclusive pelo próprio dispositivo
  // via updateInventory), não processa novamente.
  const dedup = await db.runAsync(
    `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
    [d.id]
  );
  if (dedup.changes === 0) return;

  // LWW: só aplica se client_created_at é mais recente que o último set
  // registrado. Garante que sets concorrentes convergem para o mais recente,
  // independente da ordem de chegada dos eventos.
  await db.runAsync(
    `UPDATE inventory
     SET full_qty    = ?,
         empty_qty   = ?,
         last_set_at = ?
     WHERE cylinder_type_id = ?
       AND (last_set_at IS NULL OR ? > last_set_at)`,
    [d.full_qty, d.empty_qty, d.client_created_at, cylinderTypeId, d.client_created_at]
  );
}

async function applyCylinderUpsert(
  db: SQLiteDatabase,
  d: PulledCylinderUpsert
): Promise<void> {
  const salePrice = parseFloat(d.sale_price);
  const costPrice = parseFloat(d.cost_price);

  // LWW via cylinder_types.updated_at (coluna adicionada na v3).
  // Comparação lexicográfica de strings ISO8601 = comparação cronológica.
  // updated_at='' (valor inicial) perde sempre para qualquer timestamp real.
  await db.runAsync(
    `UPDATE cylinder_types
     SET sale_price = ?, cost_price = ?, updated_at = ?
     WHERE name = 'P13' AND ? > updated_at`,
    [salePrice, costPrice, d.updated_at, d.updated_at]
  );
}
