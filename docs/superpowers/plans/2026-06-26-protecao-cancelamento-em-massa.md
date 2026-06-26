# Proteção contra Cancelamento em Massa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que um acúmulo de cancelamentos (`void_sale`) no outbox drene em massa silenciosamente, e tornar todo cancelamento reversível (com propagação entre dispositivos).

**Architecture:** Duas features independentes mas complementares.
- **#3 Un-void reversível:** novo evento `unvoid_sale` que limpa `voided_at`, re-aplica estoque/saldo (espelho de `applySale`) e propaga via o stream `catalog_events` já existente (sem migration, sem nova chave de cursor). Inclui tela "Vendas canceladas → Restaurar".
- **#1 Disjuntor no push:** antes de enviar um lote de `void_sale`, se houver ≥ `VOID_CONFIRM_THRESHOLD` pendentes, o engine **pausa** e expõe um flag; a UI exige confirmação explícita ou permite "Revisar" (descartar voids indesejados, restaurando a venda localmente — reusa a lógica de #3).

**Tech Stack:** Backend Go + sqlc (pgx/v5) + Postgres; Mobile Expo SDK 54 + expo-sqlite + Zustand + Expo Router + NativeWind; Jest (mobile) e `go test` (backend).

**Ordem:** Parte A (#3) primeiro porque a Parte B (#1) reusa o helper local de restauração de venda.

**Convenções de sinal (CRÍTICO):**
- Servidor (Postgres): `balance` POSITIVO = dívida. Fiado: `+total`. Anular fiado: `-total`. **Des-anular fiado: `+total`** (re-aplica `BumpCustomerBalance`).
- Local (SQLite): `balance` NEGATIVO = dívida. Fiado: `-total`. Anular fiado: `+total`. **Des-anular fiado: `-total`** (espelho de `applySale`).
- Inventário (ambos, sem clamp): venda/des-anular → `full -= qty`, `empty += qty` se troca. Anular → inverso.

---

## File Structure

**Backend (Parte A):**
- Modify: `backend/internal/db/queries/events.sql` — query `UnvoidSale`.
- Regen: `backend/internal/db/gen/events.sql.go` — via `sqlc generate`.
- Create: `backend/internal/sync/unvoid.go` — `UnvoidSale` + `HandleUnvoidSale`.
- Modify: `backend/cmd/server/main.go:93` — rota `POST /sync/unvoid-sale`.
- Create: `backend/internal/sync/unvoid_test.go` — testes do serviço.

**Mobile (Parte A):**
- Modify: `lib/sync/outbox.ts` — `OutboxKind` += `"unvoid_sale"`.
- Modify: `lib/api.ts` — `unvoidSale(id)`.
- Modify: `lib/sync/apply.ts` — `applyUnvoidSale` + case no switch + interface.
- Modify: `db/queries/sales.ts` — `restoreSaleAggregates` (helper), `unvoidSale`, `getVoidedSales`.
- Modify: `lib/sync/engine.ts` — push de `unvoid_sale` individual.
- Create: `app/voided-sales.tsx` — tela "Vendas canceladas".
- Modify: `app/(tabs)/sales.tsx` — botão/atalho para a tela.
- Tests: `lib/sync/__tests__/apply.test.ts`, `db/__tests__/sales.sync.test.ts`, `lib/sync/__tests__/engine.push.test.ts`, `lib/__tests__/api.test.ts`.

**Mobile (Parte B):**
- Modify: `lib/sync/constants.ts` — `VOID_CONFIRM_THRESHOLD`.
- Modify: `store/sync.ts` — `voidConfirmNeeded` + setter.
- Modify: `lib/sync/engine.ts` — disjuntor + `approveVoidBatch()`.
- Modify: `lib/sync/outbox.ts` — `getPendingVoids`, `discardPendingVoid`.
- Create: `app/pending-voids.tsx` — tela de revisão.
- Modify: `app/_layout.tsx` (AuthGate) — banner/modal de confirmação.
- Tests: `lib/sync/__tests__/engine.push.test.ts`.

---

# PARTE A — Feature #3: Un-void reversível

### Task 1: Backend — query + serviço + rota de un-void

**Files:**
- Modify: `backend/internal/db/queries/events.sql` (após bloco `VoidSale`/`ReverseCustomerBalance`, ~linha 29)
- Regen: `backend/internal/db/gen/events.sql.go`
- Create: `backend/internal/sync/unvoid.go`
- Modify: `backend/cmd/server/main.go:93`
- Test: `backend/internal/sync/unvoid_test.go`

- [ ] **Step 1: Escrever o teste do serviço (falhando)**

Em `backend/internal/sync/unvoid_test.go`. Espelha o padrão de `void_test.go` (usa `testutil_test.go` para o pool e migrations). Pré-condição: inserir uma venda, anulá-la, depois des-anular.

```go
package sync

import (
	"context"
	"testing"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

func TestUnvoidSale_RestoresAggregatesAndEmitsEvent(t *testing.T) {
	pool := newSyncTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	q := gen.New(pool)

	user := seedUser(t, pool)             // helper existente em testutil_test.go
	saleID := seedFiadoSale(t, pool, user) // helper novo abaixo

	// Estado pós-venda fiado: inventory full -1, balance +total (servidor: +=dívida).
	if err := svc.VoidSale(ctx, user, saleID); err != nil {
		t.Fatalf("void: %v", err)
	}

	// Un-void.
	if err := svc.UnvoidSale(ctx, user, saleID); err != nil {
		t.Fatalf("unvoid: %v", err)
	}

	// voided_at volta a NULL.
	s, err := q.PullSales(ctx, gen.PullSalesParams{Sequence: 0, Limit: 10})
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if len(s) != 1 || s[0].VoidedAt.Valid {
		t.Fatalf("esperava 1 venda não-anulada, got %+v", s)
	}

	// Emite catalog_event kind=unvoid_sale.
	evts, err := q.PullCatalogEvents(ctx, gen.PullCatalogEventsParams{ID: 0, Limit: 10})
	if err != nil {
		t.Fatalf("pull catalog: %v", err)
	}
	found := false
	for _, e := range evts {
		if e.Kind == "unvoid_sale" {
			found = true
		}
	}
	if !found {
		t.Fatalf("esperava catalog_event unvoid_sale, got %+v", evts)
	}
}

func TestUnvoidSale_IdempotentOnActiveSale(t *testing.T) {
	pool := newSyncTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	user := seedUser(t, pool)
	saleID := seedFiadoSale(t, pool, user) // nunca anulada

	if err := svc.UnvoidSale(ctx, user, saleID); err != nil {
		t.Fatalf("unvoid em venda ativa deve ser no-op, got %v", err)
	}
}

func TestUnvoidSale_UnknownReturnsNotFound(t *testing.T) {
	pool := newSyncTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	err := svc.UnvoidSale(ctx, "u", "00000000-0000-0000-0000-000000000000")
	if err != ErrSaleNotFound {
		t.Fatalf("esperava ErrSaleNotFound, got %v", err)
	}
}
```

Se `seedUser`/`seedFiadoSale` não existirem em `testutil_test.go`, abra `void_test.go` e reutilize os helpers que ele usa (provavelmente inserem via `gen.New(pool).InsertSale`). Replique um `seedFiadoSale` que insere uma venda fiado + bumpa inventário/saldo como o push faria, retornando o UUID string.

- [ ] **Step 2: Adicionar a query SQL `UnvoidSale`**

Em `backend/internal/db/queries/events.sql`, após a `ReverseCustomerBalance` (linha 29):

```sql
-- name: UnvoidSale :one
UPDATE sales SET voided_at = NULL, voided_by = NULL
WHERE id = sqlc.arg(id) AND voided_at IS NOT NULL
RETURNING quantity, is_exchange, payment_method, customer_id, total, cylinder_type_id;
```

- [ ] **Step 3: Regenerar o código sqlc**

Run (PowerShell, do diretório `backend`):
```
& "$env:USERPROFILE\go\bin\sqlc" generate
```
Expected: sem erros; `internal/db/gen/events.sql.go` passa a conter `func (q *Queries) UnvoidSale(...)` e `type UnvoidSaleParams struct { ID ...; }` com o mesmo shape de `VoidSaleRow`.

- [ ] **Step 4: Implementar `UnvoidSale` + handler**

Em `backend/internal/sync/unvoid.go` (espelho de `void.go`, mas re-aplicando os agregados forward e emitindo catalog_event):

```go
package sync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/pedrogomesdev/gas-manager-backend/internal/auth"
	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
)

// UnvoidSale reverts a previous cancellation: clears voided_at/voided_by and
// RE-APPLIES (exactly once) the aggregate bumps the original sale had
// (inventory full-=qty/empty+=exchange, and +total to a fiado customer's
// balance). Un-voiding a non-voided sale is idempotent; an unknown id returns
// ErrSaleNotFound. A catalog_event kind="unvoid_sale" is appended so every
// device reverts the cancellation on its next pull. All work in one tx.
func (s *Service) UnvoidSale(ctx context.Context, userID, saleID string) error {
	id := mustUUID(saleID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	row, err := q.UnvoidSale(ctx, gen.UnvoidSaleParams{ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		if _, gErr := q.GetSaleByID(ctx, id); errors.Is(gErr, pgx.ErrNoRows) {
			return ErrSaleNotFound
		} else if gErr != nil {
			return gErr
		}
		return tx.Commit(ctx) // já ativa → idempotente no-op
	}
	if err != nil {
		return err
	}

	if err := q.BumpInventoryForSale(ctx, gen.BumpInventoryForSaleParams{
		Quantity:       row.Quantity,
		IsExchange:     row.IsExchange,
		CylinderTypeID: row.CylinderTypeID,
	}); err != nil {
		return err
	}

	if row.PaymentMethod == "fiado" && row.CustomerID.Valid {
		// Servidor: dívida positiva → re-aplica +total.
		if err := q.BumpCustomerBalance(ctx, gen.BumpCustomerBalanceParams{
			ID:      row.CustomerID,
			Balance: row.Total,
		}); err != nil {
			return err
		}
	}

	data, _ := json.Marshal(map[string]any{"id": saleID})
	if _, err := q.InsertCatalogEvent(ctx, gen.InsertCatalogEventParams{
		Kind: "unvoid_sale", RefID: id, Data: string(data),
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// HandleUnvoidSale serves POST /sync/unvoid-sale with body {"id":"<uuid>"}.
func (s *Service) HandleUnvoidSale(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		httpx.Error(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := s.UnvoidSale(r.Context(), auth.UserID(r.Context()), req.ID)
	if errors.Is(err, ErrSaleNotFound) {
		httpx.Error(w, http.StatusNotFound, "sale_not_found")
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "unvoid_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"status": "unvoided"})
}
```

> Confira os nomes de campo de `BumpCustomerBalanceParams` no gen: a query é `UPDATE customers SET balance = balance + $2 WHERE id = $1`. sqlc nomeia os params `ID` e `Balance` (ou `Column2`). Ajuste o struct literal ao que o gen emitir. `RefID` é `pgtype.UUID` — `id` já é desse tipo via `mustUUID`.

- [ ] **Step 5: Registrar a rota**

Em `backend/cmd/server/main.go`, após a linha 92 (`r.Post("/sync/void-sale", syncSvc.HandleVoidSale)`):

```go
		r.Post("/sync/unvoid-sale", syncSvc.HandleUnvoidSale)
```

- [ ] **Step 6: Rodar os testes do pacote sync**

Run (PowerShell, do diretório `backend`): `go test ./internal/sync/...`
Expected: PASS (inclui os 3 testes novos). Requer Postgres de teste como os demais testes do pacote.

- [ ] **Step 7: Commit**

```bash
git add backend/internal/db/queries/events.sql backend/internal/db/gen/events.sql.go backend/internal/sync/unvoid.go backend/internal/sync/unvoid_test.go backend/cmd/server/main.go
git commit -m "feat(backend): endpoint /sync/unvoid-sale + evento unvoid_sale no pull"
```

---

### Task 2: Mobile — api.ts + apply.ts + outbox kind

**Files:**
- Modify: `lib/sync/outbox.ts:6-16`
- Modify: `lib/api.ts` (após `voidSale`, ~linha 282)
- Modify: `lib/sync/apply.ts` (interface + switch + handler)
- Test: `lib/__tests__/api.test.ts`, `lib/sync/__tests__/apply.test.ts`

- [ ] **Step 1: Adicionar `"unvoid_sale"` ao `OutboxKind`**

Em `lib/sync/outbox.ts`, na união de tipos (linha 12, junto de `"void_sale"`):

```ts
  | "void_sale"
  | "unvoid_sale"
```

- [ ] **Step 2: Teste do `unvoidSale` da api (falhando)**

Em `lib/__tests__/api.test.ts`, espelhando o `describe("voidSale")` (linha 343):

```ts
describe("unvoidSale", () => {
  it("faz POST /sync/unvoid-sale com o id", async () => {
    mockFetchOnce({ status: "unvoided" });
    await unvoidSale("sale-uuid");
    expect(lastFetch().url).toContain("/sync/unvoid-sale");
    expect(lastFetch().method).toBe("POST");
    expect(JSON.parse(lastFetch().body)).toEqual({ id: "sale-uuid" });
  });
});
```

Use exatamente os mesmos helpers de mock que o teste de `voidSale` usa nesse arquivo (`mockFetchOnce`/`lastFetch` ou equivalente). Adicione `unvoidSale` ao import do topo.

- [ ] **Step 3: Implementar `unvoidSale` na api**

Em `lib/api.ts`, após `voidSale` (linha 282):

```ts
/**
 * POST /sync/unvoid-sale — restaura uma venda anulada pelo ID.
 * Retorna { status: "unvoided" } do servidor.
 */
export async function unvoidSale(id: string): Promise<{ status: string }> {
  return request<{ status: string }>("POST", "/sync/unvoid-sale", { id });
}
```

- [ ] **Step 4: Rodar o teste da api**

Run: `npx jest lib/__tests__/api.test.ts --no-coverage -t unvoidSale`
Expected: PASS.

- [ ] **Step 5: Teste do `applyUnvoidSale` (falhando)**

Em `lib/sync/__tests__/apply.test.ts`, novo bloco (espelha os testes de `void_sale` ~linha 443). Cobre: (a) restaura venda anulada e re-aplica agregados; (b) no-op se venda já ativa; (c) no-op se uuid desconhecido.

```ts
describe("applyEvent unvoid_sale", () => {
  it("limpa voided_at e re-aplica estoque + saldo fiado", async () => {
    // Arrange: cria cliente + venda fiado já anulada localmente.
    // (use os helpers do arquivo: seedCustomer, insira sale com voided_at setado,
    //  inventory e balance no estado PÓS-anulação)
    const before = await getInventoryRow(db);
    await applyEvent(db, { kind: "unvoid_sale", data: { id: "sale-uuid" } } as any);

    const sale = await db.getFirstAsync<{ voided_at: string | null }>(
      `SELECT voided_at FROM sales WHERE uuid = ?`, ["sale-uuid"]
    );
    expect(sale?.voided_at).toBeNull();
    const after = await getInventoryRow(db);
    expect(after.full_qty).toBe(before.full_qty - 1); // venda re-aplicada
  });

  it("é no-op se a venda já está ativa (voided_at NULL)", async () => {
    // venda ativa → estado não muda
    const before = await getInventoryRow(db);
    await applyEvent(db, { kind: "unvoid_sale", data: { id: "active-uuid" } } as any);
    const after = await getInventoryRow(db);
    expect(after).toEqual(before);
  });

  it("é no-op se o uuid é desconhecido", async () => {
    await expect(
      applyEvent(db, { kind: "unvoid_sale", data: { id: "nope" } } as any)
    ).resolves.toBeUndefined();
  });
});
```

Ajuste os nomes dos helpers (`getInventoryRow`, `seedCustomer`) aos que já existem no arquivo de teste — inspecione o topo de `apply.test.ts` e os testes de `void_sale` para reaproveitar.

- [ ] **Step 6: Implementar `applyUnvoidSale` + case + interface**

Em `lib/sync/apply.ts`:

(a) Adicionar interface após `PulledVoidSale` (linha 135):

```ts
interface PulledUnvoidSale {
  id: string;
}
```

(b) Adicionar case no switch de `applyEvent` (após o `case "void_sale"`, linha 170):

```ts
    case "unvoid_sale":
      return applyUnvoidSale(db, event.data as PulledUnvoidSale);
```

(c) Adicionar o handler após `applyVoidSale` (linha 356). É o espelho de `applySale` (forward), guardado por `voided_at !== null`:

```ts
async function applyUnvoidSale(db: SQLiteDatabase, d: PulledUnvoidSale): Promise<void> {
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

  if (!sale) return;                  // uuid desconhecido → no-op
  if (sale.voided_at === null) return; // já ativa → no-op (idempotência)

  await db.runAsync(`UPDATE sales SET voided_at = NULL WHERE id = ?`, [sale.id]);

  // Re-aplica como applySale: full -= qty, empty += qty (se troca).
  await db.runAsync(
    `UPDATE inventory
     SET full_qty  = full_qty - ?,
         empty_qty = empty_qty + ?
     WHERE cylinder_type_id = ?`,
    [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
  );

  // Re-aplica saldo fiado (local: dívida negativa → balance - total).
  if (sale.payment_method === "fiado" && sale.customer_id !== null) {
    await db.runAsync(
      `UPDATE customers SET balance = balance - ? WHERE id = ?`,
      [sale.total, sale.customer_id]
    );
  }
}
```

- [ ] **Step 7: Rodar os testes de apply**

Run: `npx jest lib/sync/__tests__/apply.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add lib/sync/outbox.ts lib/api.ts lib/sync/apply.ts lib/__tests__/api.test.ts lib/sync/__tests__/apply.test.ts
git commit -m "feat(sync): apply unvoid_sale no pull + api unvoidSale"
```

---

### Task 3: Mobile — un-void local (`db/queries/sales.ts`)

**Files:**
- Modify: `db/queries/sales.ts` (após `voidSale`, linha 124)
- Test: `db/__tests__/sales.sync.test.ts`

- [ ] **Step 1: Teste de `unvoidSale` local + `getVoidedSales` (falhando)**

Em `db/__tests__/sales.sync.test.ts`, novo `describe` espelhando `voidSale` (linha 107):

```ts
describe("unvoidSale (local)", () => {
  it("limpa voided_at, re-aplica agregados e enfileira unvoid_sale", async () => {
    // cria venda fiado, anula (voidSale), depois unvoidSale
    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM sales ORDER BY id DESC LIMIT 1`
    );
    await voidSale(db, saleRow!.id);
    await unvoidSale(db, saleRow!.id);

    const sale = await db.getFirstAsync<{ voided_at: string | null }>(
      `SELECT voided_at FROM sales WHERE id = ?`, [saleRow!.id]
    );
    expect(sale?.voided_at).toBeNull();

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(
      `SELECT kind, payload FROM sync_outbox WHERE kind = 'unvoid_sale' ORDER BY id DESC LIMIT 1`
    );
    expect(outbox?.kind).toBe("unvoid_sale");
    expect(JSON.parse(outbox!.payload).id).toBe(saleRow!.uuid);
  });

  it("é no-op se a venda já está ativa", async () => {
    const saleRow = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM sales WHERE voided_at IS NULL ORDER BY id DESC LIMIT 1`
    );
    await unvoidSale(db, saleRow!.id); // não deve lançar nem enfileirar
  });
});

describe("getVoidedSales", () => {
  it("retorna só vendas anuladas, mais recentes primeiro", async () => {
    const list = await getVoidedSales(db);
    expect(list.every((s) => s.voided_at !== null)).toBe(true);
  });
});
```

Reaproveite o `beforeEach`/seed do arquivo (que já cria cliente + venda para os testes de `voidSale`).

- [ ] **Step 2: Implementar `restoreSaleAggregates`, `unvoidSale`, `getVoidedSales`**

Em `db/queries/sales.ts`, após `voidSale` (linha 124):

```ts
// restoreSaleAggregates limpa voided_at e re-aplica os agregados como na venda
// original (espelho de registerSale): full -= qty, empty += qty (troca), e saldo
// fiado - total. Idempotente: no-op se a venda já está ativa ou não existe.
// Retorna o uuid da venda restaurada, ou null se não fez nada.
async function restoreSaleAggregates(
  db: SQLiteDatabase,
  id: number
): Promise<string | null> {
  const sale = await db.getFirstAsync<
    Sale & { uuid: string; voided_at: string | null }
  >(`SELECT * FROM sales WHERE id = ? AND voided_at IS NOT NULL`, [id]);
  if (!sale) return null;

  await db.runAsync(`UPDATE sales SET voided_at = NULL WHERE id = ?`, [id]);
  await db.runAsync(
    `UPDATE inventory SET full_qty = full_qty - ?, empty_qty = empty_qty + ?
     WHERE cylinder_type_id = ?`,
    [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
  );
  if (sale.payment_method === "fiado" && sale.customer_id) {
    await db.runAsync(
      `UPDATE customers SET balance = balance - ? WHERE id = ?`,
      [sale.total, sale.customer_id]
    );
  }
  return sale.uuid;
}

// unvoidSale restaura uma venda anulada (que JÁ foi sincronizada como void) e
// enfileira unvoid_sale para propagar a restauração ao servidor/outros devices.
export async function unvoidSale(db: SQLiteDatabase, id: number) {
  await db.withTransactionAsync(async () => {
    const uuid = await restoreSaleAggregates(db, id);
    if (!uuid) return; // já ativa → nada a propagar

    await enqueue(db, {
      event_uuid: randomUUID(),
      kind: "unvoid_sale",
      payload: JSON.stringify({ id: uuid }),
      client_created_at: new Date().toISOString(),
    });
  });
}

// getVoidedSales lista vendas anuladas (para a tela "Vendas canceladas").
export async function getVoidedSales(db: SQLiteDatabase): Promise<Sale[]> {
  return db.getAllAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.voided_at IS NOT NULL
     ORDER BY s.voided_at DESC`
  );
}
```

> `restoreSaleAggregates` será reusada pela Parte B (`discardPendingVoid`). Mantenha-a `export`-ável internamente — exporte-a se o teste da Parte B precisar; senão deixe privada e exponha via `discardPendingVoid`.

- [ ] **Step 3: Rodar os testes**

Run: `npx jest db/__tests__/sales.sync.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add db/queries/sales.ts db/__tests__/sales.sync.test.ts
git commit -m "feat(sales): unvoidSale local + getVoidedSales + restoreSaleAggregates"
```

---

### Task 4: Mobile — engine envia `unvoid_sale`

**Files:**
- Modify: `lib/sync/engine.ts:76-173`
- Test: `lib/sync/__tests__/engine.push.test.ts`

- [ ] **Step 1: Teste (falhando) — unvoid_sale chama api e marca done**

Em `lib/sync/__tests__/engine.push.test.ts`, espelhando o teste `"void_sale chama voidSale..."` (linha 131). Adicione `mockUnvoidSale` ao mock de `@/lib/api` (junto de `voidSale`, linha 33):

```ts
  it("unvoid_sale chama unvoidSale (endpoint individual) e marca done", async () => {
    // enfileira um unvoid_sale pendente, roda pushOnce, espera POST e markDone
    await seedOutbox({ kind: "unvoid_sale", payload: JSON.stringify({ id: "s1" }) });
    await engine.pushOnce();
    expect(mockUnvoidSale).toHaveBeenCalledWith("s1");
    const row = await getOutbox("unvoid_sale");
    expect(row.status).toBe("done");
  });
```

Use os helpers do arquivo (`seedOutbox`, `getOutbox`) — copie do teste de `void_sale` adjacente.

- [ ] **Step 2: Implementar no engine**

Em `lib/sync/engine.ts`:

(a) Import (linha 4, junto de `voidSale`):
```ts
  voidSale,
  unvoidSale,
```

(b) Em `pushOnce` (após a linha 85 `const voids = ...`), adicionar a lista de unvoids e o passo de push (após o passo 3 de voids, linha 92):
```ts
    const unvoids = events.filter((e) => e.kind === "unvoid_sale");
```
```ts
    // 4. Unvoids por último (depois dos voids, para ordem causal consistente).
    if (await this._pushIndividual(unvoids)) return;
```

(c) No `_pushCatalogEvent` switch (após `case "void_sale"`, linha 162):
```ts
      case "unvoid_sale":
        await unvoidSale(payload.id);
        break;
```

- [ ] **Step 3: Rodar os testes do engine**

Run: `npx jest lib/sync/__tests__/engine.push.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/sync/engine.ts lib/sync/__tests__/engine.push.test.ts
git commit -m "feat(sync): engine envia unvoid_sale via endpoint individual"
```

---

### Task 5: Mobile — tela "Vendas canceladas"

**Files:**
- Create: `app/voided-sales.tsx`
- Modify: `app/(tabs)/sales.tsx` (header: botão para abrir a tela)

- [ ] **Step 1: Criar a tela**

Em `app/voided-sales.tsx`. Segue o padrão visual de `app/(tabs)/sales.tsx` (FlatList + NativeWind + `useSQLiteContext`/`db`). Lista `getVoidedSales`, cada item com botão "Restaurar" que chama `unvoidSale(db, id)` atrás de um `Alert` de confirmação, depois `bumpSales/bumpInventory/bumpCustomers` e recarrega.

```tsx
import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, Alert, RefreshControl } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { Stack } from "expo-router";
import { getVoidedSales, unvoidSale } from "@/db/queries/sales";
import { useAppStore } from "@/store";
import { triggerManualSync } from "@/lib/sync/engine";
import type { Sale } from "@/types";

export default function VoidedSalesScreen() {
  const db = useSQLiteContext();
  const [sales, setSales] = useState<Sale[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { bumpSales, bumpInventory, bumpCustomers } = useAppStore();

  const load = useCallback(async () => {
    setSales(await getVoidedSales(db));
  }, [db]);

  // recarrega ao focar
  useFocusEffectLoad(load);

  const onRestore = (id: number) => {
    Alert.alert(
      "Restaurar venda",
      "A venda volta a contar no faturamento, estoque e saldo do cliente.",
      [
        { text: "Não", style: "cancel" },
        {
          text: "Restaurar",
          onPress: async () => {
            await unvoidSale(db, id);
            bumpSales(); bumpInventory(); bumpCustomers();
            await load();
            triggerManualSync();
          },
        },
      ]
    );
  };

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: "Vendas canceladas" }} />
      <FlatList
        data={sales}
        keyExtractor={(i) => String(i.id)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => {
            setRefreshing(true); await triggerManualSync(); await load(); setRefreshing(false);
          }} tintColor="#f97316" />
        }
        ListEmptyComponent={
          <Text className="text-center text-gray-500 mt-10">Nenhuma venda cancelada.</Text>
        }
        renderItem={({ item }) => (
          <View className="mx-4 my-1 p-4 rounded-xl bg-white dark:bg-gray-900 flex-row justify-between items-center">
            <View>
              <Text className="font-bold text-gray-900 dark:text-gray-50">
                R$ {Number(item.total).toFixed(2)} · {item.payment_method}
              </Text>
              <Text className="text-gray-500 text-sm">{item.customer_name ?? "Sem cliente"}</Text>
            </View>
            <Pressable onPress={() => onRestore(item.id)} className="px-3 py-2 rounded-lg bg-orange-500">
              <Text className="text-white font-semibold">Restaurar</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}
```

> `useFocusEffectLoad` é pseudo: use o padrão real do projeto para recarregar ao focar. Se as outras telas usam `useEffect(() => { load() }, [load, salesVersion])`, replique isso aqui (importe `salesVersion` de `useAppStore`). Ajuste imports (`useFocusEffect` de `expo-router`/`@react-navigation/native`) ao que o projeto já usa.

- [ ] **Step 2: Adicionar atalho na aba de vendas**

Em `app/(tabs)/sales.tsx`, no `ListHeaderComponent` (após o título, ~linha 128), um link/botão:

```tsx
<Pressable onPress={() => router.push("/voided-sales")} className="mt-2 self-start">
  <Text className="text-orange-600 font-medium">Ver vendas canceladas →</Text>
</Pressable>
```

(`router` já está importado no arquivo — confirme; senão `import { router } from "expo-router"`.)

- [ ] **Step 3: Smoke check de tipos/lint**

Run: `npx tsc --noEmit` (ou o script de typecheck do projeto, ver `package.json`).
Expected: sem erros nos arquivos tocados.

- [ ] **Step 4: Commit**

```bash
git add app/voided-sales.tsx "app/(tabs)/sales.tsx"
git commit -m "feat(mobile): tela Vendas Canceladas com Restaurar"
```

---

# PARTE B — Feature #1: Disjuntor no push

### Task 6: Engine — disjuntor por limite de voids

**Files:**
- Modify: `lib/sync/constants.ts`
- Modify: `store/sync.ts`
- Modify: `lib/sync/engine.ts`
- Test: `lib/sync/__tests__/engine.push.test.ts`

- [ ] **Step 1: Constante de limite**

Em `lib/sync/constants.ts`, adicionar:
```ts
// Acima deste número de cancelamentos pendentes num único push, o engine pausa
// e exige confirmação explícita do usuário (proteção contra void em massa).
export const VOID_CONFIRM_THRESHOLD = 3;
```

- [ ] **Step 2: Flag no sync store**

Em `store/sync.ts`, adicionar à interface e ao create:
```ts
  voidConfirmNeeded: number; // >0 = N voids aguardando confirmação manual
  setVoidConfirmNeeded: (n: number) => void;
```
```ts
  voidConfirmNeeded: 0,
  setVoidConfirmNeeded: (voidConfirmNeeded) => set({ voidConfirmNeeded }),
```

- [ ] **Step 3: Teste do disjuntor (falhando)**

Em `lib/sync/__tests__/engine.push.test.ts`:
```ts
  it("NÃO envia voids quando >= threshold e bloqueia até aprovar", async () => {
    for (let i = 0; i < 3; i++) {
      await seedOutbox({ kind: "void_sale", payload: JSON.stringify({ id: `s${i}` }) });
    }
    await engine.pushOnce();
    expect(mockVoidSale).not.toHaveBeenCalled();
    expect(useSyncStore.getState().voidConfirmNeeded).toBe(3);

    // Após aprovar, envia.
    await engine.approveVoidBatch(); // dispara novo push interno
    expect(mockVoidSale).toHaveBeenCalledTimes(3);
    expect(useSyncStore.getState().voidConfirmNeeded).toBe(0);
  });

  it("envia voids normalmente quando abaixo do threshold", async () => {
    await seedOutbox({ kind: "void_sale", payload: JSON.stringify({ id: "s1" }) });
    await engine.pushOnce();
    expect(mockVoidSale).toHaveBeenCalledWith("s1");
  });
```

- [ ] **Step 4: Implementar o disjuntor no engine**

Em `lib/sync/engine.ts`:

(a) Imports:
```ts
import { VOID_CONFIRM_THRESHOLD } from "@/lib/sync/constants";
```

(b) Campo na classe (junto dos privados, ~linha 72):
```ts
  private _voidBatchApproved = false;
```

(c) Em `pushOnce`, substituir o passo 3 (linha 91-92) por:
```ts
    // 3. Voids: disjuntor contra cancelamento em massa.
    if (
      voids.length >= VOID_CONFIRM_THRESHOLD &&
      !this._voidBatchApproved
    ) {
      useSyncStore.getState().setVoidConfirmNeeded(voids.length);
      // não envia voids/unvoids este ciclo; mantém pendentes para revisão.
      return;
    }
    if (await this._pushIndividual(voids)) return;
    this._voidBatchApproved = false;
    useSyncStore.getState().setVoidConfirmNeeded(0);
```

(d) Novo método público (após `pushOnce`):
```ts
  /** Usuário confirmou o envio do lote de cancelamentos pendentes. */
  async approveVoidBatch(): Promise<void> {
    this._voidBatchApproved = true;
    useSyncStore.getState().setVoidConfirmNeeded(0);
    await this.syncNow();
  }
```

(e) Helper estático para a UI disparar sem referência ao engine (após `triggerManualSync`, linha 65):
```ts
export async function approveVoidBatch(): Promise<void> {
  await activeEngine?.approveVoidBatch();
}
```

> Nota: `_voidBatchApproved` é resetado após um push bem-sucedido de voids OU se a contagem cair abaixo do threshold num ciclo futuro. Como é em memória, reiniciar o app com voids pendentes volta a pedir confirmação (mais seguro).

- [ ] **Step 5: Rodar os testes do engine**

Run: `npx jest lib/sync/__tests__/engine.push.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/sync/constants.ts store/sync.ts lib/sync/engine.ts lib/sync/__tests__/engine.push.test.ts
git commit -m "feat(sync): disjuntor que pausa cancelamentos em massa ate confirmacao"
```

---

### Task 7: Mobile — revisão de voids pendentes + banner de confirmação

**Files:**
- Modify: `lib/sync/outbox.ts`
- Create: `app/pending-voids.tsx`
- Modify: `app/_layout.tsx` (AuthGate — banner que observa `voidConfirmNeeded`)
- Test: `db/__tests__/sales.sync.test.ts` (ou `outbox` test existente)

- [ ] **Step 1: Teste de `discardPendingVoid` (falhando)**

Em `db/__tests__/sales.sync.test.ts`:
```ts
describe("discardPendingVoid", () => {
  it("remove o void pendente do outbox e restaura a venda localmente", async () => {
    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(
      `SELECT id, uuid FROM sales ORDER BY id DESC LIMIT 1`
    );
    await voidSale(db, saleRow!.id); // cria void pendente + anula local
    const voidEvt = await db.getFirstAsync<{ event_uuid: string }>(
      `SELECT event_uuid FROM sync_outbox WHERE kind='void_sale' ORDER BY id DESC LIMIT 1`
    );

    await discardPendingVoid(db, voidEvt!.event_uuid, saleRow!.id);

    const remaining = await db.getFirstAsync(
      `SELECT 1 FROM sync_outbox WHERE event_uuid = ?`, [voidEvt!.event_uuid]
    );
    expect(remaining).toBeNull();
    const sale = await db.getFirstAsync<{ voided_at: string | null }>(
      `SELECT voided_at FROM sales WHERE id = ?`, [saleRow!.id]
    );
    expect(sale?.voided_at).toBeNull(); // venda restaurada, SEM evento unvoid
    const unvoid = await db.getFirstAsync(
      `SELECT 1 FROM sync_outbox WHERE kind='unvoid_sale'`
    );
    expect(unvoid).toBeNull();
  });
});
```

- [ ] **Step 2: Implementar `getPendingVoids` + `discardPendingVoid`**

Em `lib/sync/outbox.ts` (ou em `db/queries/sales.ts` se preferir co-localizar com `restoreSaleAggregates` — escolha um e mantenha o import do teste coerente). Recomendado: `discardPendingVoid` em `db/queries/sales.ts` (reusa `restoreSaleAggregates`), e `getPendingVoids` em `db/queries/sales.ts` também.

Em `db/queries/sales.ts`:
```ts
// getPendingVoids lista os cancelamentos ainda na fila (não enviados), com os
// dados da venda local correspondente, para a tela de revisão do disjuntor.
export async function getPendingVoids(
  db: SQLiteDatabase
): Promise<Array<Sale & { event_uuid: string }>> {
  return db.getAllAsync<Sale & { event_uuid: string }>(
    `SELECT s.*, c.name as customer_name, o.event_uuid
     FROM sync_outbox o
     JOIN sales s ON s.uuid = json_extract(o.payload, '$.id')
     LEFT JOIN customers c ON s.customer_id = c.id
     WHERE o.kind = 'void_sale' AND o.status = 'pending'
     ORDER BY o.id ASC`
  );
}

// discardPendingVoid desfaz um cancelamento que AINDA NÃO foi enviado: remove o
// evento do outbox e restaura a venda localmente. Não enfileira unvoid_sale —
// o servidor nunca soube do void.
export async function discardPendingVoid(
  db: SQLiteDatabase,
  eventUuid: string,
  saleId: number
): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM sync_outbox WHERE event_uuid = ? AND status = 'pending'`, [eventUuid]);
    await restoreSaleAggregates(db, saleId);
  });
}
```

> `json_extract` está disponível no SQLite do expo-sqlite. Se algum test-double não suportar, troque por leitura do payload em JS. Confirme nos testes.

- [ ] **Step 3: Rodar os testes**

Run: `npx jest db/__tests__/sales.sync.test.ts --no-coverage`
Expected: PASS.

- [ ] **Step 4: Tela de revisão `app/pending-voids.tsx`**

Lista `getPendingVoids`. Cada item: "Manter venda" (chama `discardPendingVoid` → recarrega) e o rodapé tem "Enviar N cancelamentos" → `approveVoidBatch()` (de `@/lib/sync/engine`) + `router.back()`.

```tsx
import { useCallback, useState } from "react";
import { View, Text, FlatList, Pressable, Alert } from "react-native";
import { useSQLiteContext } from "expo-sqlite";
import { Stack, router } from "expo-router";
import { getPendingVoids, discardPendingVoid } from "@/db/queries/sales";
import { approveVoidBatch } from "@/lib/sync/engine";
import { useAppStore } from "@/store";
import type { Sale } from "@/types";

export default function PendingVoidsScreen() {
  const db = useSQLiteContext();
  const [rows, setRows] = useState<Array<Sale & { event_uuid: string }>>([]);
  const { bumpSales, bumpInventory, bumpCustomers } = useAppStore();

  const load = useCallback(async () => setRows(await getPendingVoids(db)), [db]);
  useFocusEffectLoad(load); // mesmo padrão da Task 5

  const keep = (eventUuid: string, saleId: number) => {
    Alert.alert("Manter venda", "Este cancelamento será descartado e a venda mantida.", [
      { text: "Voltar", style: "cancel" },
      {
        text: "Manter venda",
        onPress: async () => {
          await discardPendingVoid(db, eventUuid, saleId);
          bumpSales(); bumpInventory(); bumpCustomers();
          await load();
        },
      },
    ]);
  };

  return (
    <View className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ title: "Revisar cancelamentos" }} />
      <FlatList
        data={rows}
        keyExtractor={(i) => i.event_uuid}
        ListHeaderComponent={
          <Text className="m-4 text-gray-600 dark:text-gray-300">
            Estes cancelamentos vão apagar as vendas em todos os dispositivos. Revise antes de enviar.
          </Text>
        }
        renderItem={({ item }) => (
          <View className="mx-4 my-1 p-4 rounded-xl bg-white dark:bg-gray-900 flex-row justify-between items-center">
            <View>
              <Text className="font-bold text-gray-900 dark:text-gray-50">
                R$ {Number(item.total).toFixed(2)} · {item.payment_method}
              </Text>
              <Text className="text-gray-500 text-sm">{item.customer_name ?? "Sem cliente"}</Text>
            </View>
            <Pressable onPress={() => keep(item.event_uuid, item.id)} className="px-3 py-2 rounded-lg bg-gray-200 dark:bg-gray-700">
              <Text className="font-semibold text-gray-900 dark:text-gray-50">Manter venda</Text>
            </Pressable>
          </View>
        )}
      />
      <Pressable
        onPress={async () => { await approveVoidBatch(); router.back(); }}
        className="m-4 p-4 rounded-xl bg-red-600 items-center"
      >
        <Text className="text-white font-bold">Enviar {rows.length} cancelamento(s)</Text>
      </Pressable>
    </View>
  );
}
```

- [ ] **Step 5: Banner de confirmação no AuthGate**

Em `app/_layout.tsx`, dentro do componente que renderiza quando logado (AuthGate), observar `voidConfirmNeeded` e renderizar um banner fixo no topo:

```tsx
const voidConfirmNeeded = useSyncStore((s) => s.voidConfirmNeeded);
// ...dentro do JSX, acima do Slot/Stack:
{voidConfirmNeeded > 0 && (
  <Pressable
    onPress={() => router.push("/pending-voids")}
    className="bg-red-600 px-4 py-3"
  >
    <Text className="text-white font-semibold">
      {voidConfirmNeeded} cancelamento(s) aguardando sua confirmação — toque para revisar
    </Text>
  </Pressable>
)}
```

Importe `useSyncStore`, `router`, `Pressable`, `Text`. Posicione o banner de modo que não quebre o layout de navegação existente (acima do `<Stack>`/`<Slot>` dentro de uma `View` flex-1).

- [ ] **Step 6: Typecheck + testes**

Run: `npx tsc --noEmit && npx jest db/__tests__/sales.sync.test.ts --no-coverage`
Expected: sem erros; PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/sync/outbox.ts db/queries/sales.ts db/__tests__/sales.sync.test.ts app/pending-voids.tsx app/_layout.tsx
git commit -m "feat(mobile): revisao de cancelamentos pendentes + banner de confirmacao"
```

---

### Task 8: Verificação final + revisão TL/QA

- [ ] **Step 1: Suíte mobile completa**

Run: `npx jest --no-coverage`
Expected: todos os testes passam (os 125 anteriores + novos).

- [ ] **Step 2: Suíte backend completa**

Run (PowerShell, em `backend`): `go test ./...`
Expected: PASS.

- [ ] **Step 3: Revisão TL + QA com subagentes**

Conforme convenção do projeto, rodar revisão do diff com subagentes Tech Lead e QA (skill `requesting-code-review`). Tratar achados antes de fechar.

- [ ] **Step 4: Deploy backend**

Pré-requisito para o un-void funcionar em produção. Usar a skill `backend` (ou):
```
gcloud run deploy gas-backend --source ./backend --region southamerica-east1 --project gas-manager-499616 --update-env-vars FIREBASE_PROJECT_ID=gas-manager-499616
```
Confirmar revisão ativa nova e `POST /sync/unvoid-sale` respondendo.

- [ ] **Step 5: Atualizar HANDOFF.md + memória**

Registrar as duas features, a necessidade de novo APK, e fechar a pendência de "retry/void em massa".

---

## Notas de design / decisões

1. **Sem migration:** `unvoid_sale` viaja pelo stream `catalog_events` existente (chave de cursor `Catalog`). Evita nova tabela, nova chave de cursor e mexer no `decodeCursor`/`Cursor`. Idempotência garantida pelo guard `voided_at !== null` no apply.
2. **Propagação assimétrica conhecida:** un-void só chega a outros devices que ainda fazem pull incremental. Um device que já tinha a venda como anulada localmente recebe o `unvoid_sale` e reverte. Um device offline há muito tempo converge no próximo pull. Reinstalação (cursor 0) recebe void + unvoid em sequência → estado final correto.
3. **Disjuntor em memória (não persistido):** se o app reiniciar com voids pendentes, re-pede confirmação. É o comportamento mais seguro (nunca drena em massa silenciosamente após restart).
4. **Threshold = 3:** uso normal cancela 1–2 vendas por vez. Ajustável em `constants.ts`.
5. **#1 reusa #3:** "Manter venda" (descartar void pendente) usa `restoreSaleAggregates`, o mesmo helper local do un-void — sem duplicar a lógica de reversão de agregados.
6. **Defesa-em-profundidade adiada:** o limite server-side (#2) não está neste plano; é um complemento recomendado para uma sessão futura (rejeitar/sinalizar N voids/janela por usuário).
```
