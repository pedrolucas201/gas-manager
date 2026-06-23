# APK Multi-Dispositivo — Plano Final (Gaps 2+3 + Engine + UI + APK)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Regras obrigatórias:**
> - Todo task fecha com `go test ./...` (backend, Docker ligado) OU `npm test` (mobile) VERDE antes do commit.
> - Revisão TL+QA por subagentes a cada task antes de fechar.
> - Commits em PT **sem menção ao Claude/IA**.
> - `git` só via PowerShell nesta máquina (Bash tool não tem git).
> - Backend: `cd backend` antes dos comandos Go. Testcontainers (~40s/run — paciência).
> - Mobile: harness Node (better-sqlite3) — importar `expo-sqlite` runtime quebra os testes.

**Goal:** Fechar os Gaps 2 e 3 do backend, implementar o SyncEngine mobile, ligar todas as mutações ao outbox, adicionar login UI + gate de auth, e gerar o APK pronto para os 3 funcionários.

**Architecture:** O backend ganha dois novos streams de pull: `sale_voids` (fato append-only com BIGSERIAL próprio, emitido quando `VoidSale` é chamado) e `catalog_events` (fato append-only com JSON snapshot, emitido pelos handlers de catálogo). O Cursor ganha campos `void` e `catalog`. O mobile recebe um `SyncEngine` que drena o outbox (push) e percorre as páginas do pull com cursor durável, aplicando eventos em duas passadas por página (fatos primeiro, então void/catálogo) para evitar forward-references. Toda mutação local é envolvida em `withTransactionAsync` junto com `enqueue()` no outbox. Uma tela de login + gate em `_layout.tsx` protege o app com Firebase Auth.

**Tech Stack:** Go 1.25, chi, pgx, sqlc, testcontainers; Expo SDK 54, expo-sqlite, expo-crypto, firebase JS SDK 12, zustand 5, better-sqlite3 (tests), NativeWind.

---

## Arquivos criados/modificados

### Backend
| Ação | Arquivo |
|------|---------|
| Create | `backend/internal/db/migrations/0004_sale_voids.up.sql` |
| Create | `backend/internal/db/migrations/0004_sale_voids.down.sql` |
| Create | `backend/internal/db/migrations/0005_catalog_events.up.sql` |
| Create | `backend/internal/db/migrations/0005_catalog_events.down.sql` |
| Modify | `backend/internal/db/queries/events.sql` (+PullSaleVoids, +InsertSaleVoid) |
| Modify | `backend/internal/db/queries/catalog.sql` (+InsertCatalogEvent, +PullCatalogEvents) |
| Regen  | `backend/internal/db/gen/` via `cd backend && sqlc generate` |
| Modify | `backend/internal/sync/pull_dto.go` (+VoidSaleDTO + mapper) |
| Modify | `backend/internal/sync/pull.go` (+Void/Catalog no Cursor, wire das queries novas) |
| Modify | `backend/internal/sync/void.go` (VoidSale insere em sale_voids na mesma tx) |
| Modify | `backend/internal/catalog/handlers.go` (UpsertCustomer/DeleteCustomer/UpdateCylinderType emitem evento) |
| Create | `backend/internal/sync/void_pull_test.go` |
| Create | `backend/internal/catalog/catalog_events_test.go` |

### Mobile
| Ação | Arquivo |
|------|---------|
| Add | `__mocks__/expo-crypto.ts` (mock Node-compat para UUID nos testes) |
| Modify | `jest.config.js` (moduleNameMapper expo-crypto) |
| Modify | `db/database.ts` (migration v3: applied_events + cylinder_types.updated_at) |
| Modify | `lib/sync/apply.ts` (fix dedupe via applied_events; LWW cylinder via updated_at) |
| Modify | `db/__tests__/migration.test.ts` (asserções v3) |
| Create | `store/sync.ts` (zustand sync status) |
| Create | `lib/sync/engine.ts` (SyncEngine: pushOnce, pullAll, start, stop) |
| Create | `lib/sync/__tests__/engine.push.test.ts` |
| Create | `lib/sync/__tests__/engine.pull.test.ts` |
| Modify | `db/queries/sales.ts` (uuid + outbox + voidSale + filtros voided) |
| Create | `db/__tests__/sales.sync.test.ts` |
| Modify | `db/queries/inventory.ts` (uuid + outbox + delta + updated_at) |
| Create | `db/__tests__/inventory.sync.test.ts` |
| Modify | `db/queries/customers.ts` (uuid + updated_at + outbox em toda mutação) |
| Create | `db/__tests__/customers.sync.test.ts` |
| Create | `app/login.tsx` |
| Modify | `app/_layout.tsx` (auth gate + engine start/stop) |
| Create | `components/SyncBadge.tsx` |
| Modify | `app/(tabs)/_layout.tsx` (SyncBadge no header + logout) |

---

## Task A1: Gap 2 — void_sale no stream de pull

**Contexto:** `VoidSale` em `void.go` já anula a venda no Postgres (voided_at + reverse aggregates), mas não grava em nenhuma tabela com BIGSERIAL. Outros dispositivos jamais veem o cancelamento. Solução: tabela `sale_voids` append-only; `VoidSale` insere nela na mesma tx; `PullSaleVoids` é puxada no pull; Cursor ganha campo `void`.

**Files:**
- Create: `backend/internal/db/migrations/0004_sale_voids.up.sql`
- Create: `backend/internal/db/migrations/0004_sale_voids.down.sql`
- Modify: `backend/internal/db/queries/events.sql`
- Regen: `backend/internal/db/gen/`
- Modify: `backend/internal/sync/pull_dto.go`
- Modify: `backend/internal/sync/pull.go`
- Modify: `backend/internal/sync/void.go`
- Create: `backend/internal/sync/void_pull_test.go`

- [ ] **Step 1: Escrever o teste que vai falhar**

Crie `backend/internal/sync/void_pull_test.go`:

```go
package sync_test

import (
	"context"
	"testing"

	"github.com/pedrogomesdev/gas-manager-backend/internal/sync"
	"github.com/pedrogomesdev/gas-manager-backend/internal/testutil"
)

func TestPull_VoidSaleAppearsInPullStream(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewPool(t, ctx)
	svc := sync.NewService(pool)
	user := testutil.EnsureUser(t, ctx, pool, "user-void-pull-1")
	ct := testutil.EnsureCylinderType(t, ctx, pool)

	// 1. Push a sale
	events := testutil.PushSale(t, ctx, svc, user, ct, "cash")
	saleID := events[0].ID

	// 2. Void it
	err := svc.VoidSale(ctx, user, saleID)
	if err != nil {
		t.Fatalf("VoidSale: %v", err)
	}

	// 3. Pull from zero cursor — void_sale event must appear
	page, err := svc.Pull(ctx, sync.Cursor{}, 50)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}

	var found bool
	for _, e := range page.Events {
		if e.Kind == "void_sale" {
			found = true
			data, ok := e.Data.(sync.VoidSaleDTO)
			if !ok {
				t.Fatalf("Data type: got %T", e.Data)
			}
			if data.ID != saleID {
				t.Errorf("VoidSaleDTO.ID: want %s got %s", saleID, data.ID)
			}
		}
	}
	if !found {
		t.Error("expected void_sale event in pull stream, none found")
	}
}

func TestPull_VoidCursorAdvances(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewPool(t, ctx)
	svc := sync.NewService(pool)
	user := testutil.EnsureUser(t, ctx, pool, "user-void-cursor-1")
	ct := testutil.EnsureCylinderType(t, ctx, pool)

	testutil.PushSale(t, ctx, svc, user, ct, "cash")
	svc.VoidSale(ctx, user, testutil.LastSaleID(t, ctx, pool))

	page1, _ := svc.Pull(ctx, sync.Cursor{}, 50)
	if page1.NextCursor.Void == 0 {
		t.Error("Void cursor should advance after first void")
	}

	// Second pull from next cursor: no new void events
	page2, _ := svc.Pull(ctx, page1.NextCursor, 50)
	for _, e := range page2.Events {
		if e.Kind == "void_sale" {
			t.Error("void_sale must not repeat after cursor advanced")
		}
	}
}

func TestVoidSale_DoubleVoidDoesNotCreateTwoEntries(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewPool(t, ctx)
	svc := sync.NewService(pool)
	user := testutil.EnsureUser(t, ctx, pool, "user-double-void-1")
	ct := testutil.EnsureCylinderType(t, ctx, pool)

	results := testutil.PushSale(t, ctx, svc, user, ct, "cash")
	saleID := results[0].ID

	svc.VoidSale(ctx, user, saleID)
	svc.VoidSale(ctx, user, saleID) // idempotent

	page, _ := svc.Pull(ctx, sync.Cursor{}, 50)
	count := 0
	for _, e := range page.Events {
		if e.Kind == "void_sale" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("expected exactly 1 void_sale event, got %d", count)
	}
}
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```powershell
cd backend
go test ./internal/sync/ -run TestPull_VoidSale -v
# Expected: FAIL — VoidSaleDTO undefined / void cursor stays 0
```

- [ ] **Step 3: Criar migration 0004**

`backend/internal/db/migrations/0004_sale_voids.up.sql`:
```sql
CREATE TABLE sale_voids (
  id                 BIGSERIAL PRIMARY KEY,
  sale_id            UUID NOT NULL REFERENCES sales(id),
  voided_by          TEXT NOT NULL REFERENCES users(id),
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_voids_id ON sale_voids(id);
```

`backend/internal/db/migrations/0004_sale_voids.down.sql`:
```sql
DROP TABLE IF EXISTS sale_voids;
```

- [ ] **Step 4: Adicionar queries em `events.sql`**

Adicione ao final de `backend/internal/db/queries/events.sql`:
```sql
-- name: InsertSaleVoid :one
INSERT INTO sale_voids (sale_id, voided_by) VALUES ($1, $2)
RETURNING id, server_received_at;

-- name: PullSaleVoids :many
SELECT id, sale_id, server_received_at
FROM sale_voids
WHERE id > $1
ORDER BY id
LIMIT $2;
```

- [ ] **Step 5: Rodar `sqlc generate`**

```powershell
cd backend && sqlc generate
```

Confirme que compila: `go build ./...`

- [ ] **Step 6: Adicionar `VoidSaleDTO` e mapper em `pull_dto.go`**

Adicione ao final de `backend/internal/sync/pull_dto.go`:
```go
// VoidSaleDTO is the data payload for a void_sale pull event.
// ID is the UUID of the sale that was cancelled (not the sale_voids row id).
type VoidSaleDTO struct {
	ID string `json:"id"`
}

func mapVoidRow(r gen.PullSaleVoidsRow) VoidSaleDTO {
	return VoidSaleDTO{ID: uuidToWire(r.SaleID)}
}
```

- [ ] **Step 7: Atualizar `Cursor` e `Pull()` em `pull.go`**

Adicione campo `Void int64` ao struct `Cursor`:
```go
type Cursor struct {
	Sale    int64 `json:"sale"`
	Restock int64 `json:"restock"`
	Adjust  int64 `json:"adjust"`
	Settle  int64 `json:"settle"`
	Void    int64 `json:"void"`
}
```

Na função `Pull()`, após o bloco `settlements`, adicione:
```go
voids, err := q.PullSaleVoids(ctx, gen.PullSaleVoidsParams{ID: c.Void, Limit: limit})
if err != nil {
    return PullPage{}, err
}
if int32(len(voids)) == limit {
    anyFull = true
}
for _, r := range voids {
    events = append(events, Event{Kind: "void_sale", Sequence: r.ID, ServerReceivedAt: toTime(r.ServerReceivedAt), Data: mapVoidRow(r)})
}
```

No switch de cursor dentro de `Pull()`, adicione:
```go
case "void_sale":
    if e.Sequence > next.Void {
        next.Void = e.Sequence
    }
```

- [ ] **Step 8: Atualizar `VoidSale()` em `void.go` para inserir em `sale_voids`**

No bloco após `q.ReverseInventoryForSale` (antes de `return tx.Commit(ctx)`), adicione:
```go
if _, err := q.InsertSaleVoid(ctx, gen.InsertSaleVoidParams{
    SaleID:   id,
    VoidedBy: userID,
}); err != nil {
    return err
}
```

O fluxo completo deve ser: VoidSale query (UPDATE voided_at) → se retornou linha → ReverseInventory → ReverseBalance (se fiado) → **InsertSaleVoid** → Commit.

- [ ] **Step 9: Confirmar que testes passam**

```powershell
cd backend
go test ./internal/sync/ -run "TestPull_Void|TestVoidSale_Double" -v -count=1
# Expected: PASS
```

- [ ] **Step 10: Rodar suíte completa do pacote sync**

```powershell
go test ./internal/sync/ -count=1 -v 2>&1 | tail -20
# Expected: all PASS, incluindo os testes pré-existentes
```

- [ ] **Step 11: Commit**

```powershell
git add backend/internal/db/migrations/0004_sale_voids.* `
        backend/internal/db/queries/events.sql `
        backend/internal/db/gen/ `
        backend/internal/sync/pull_dto.go `
        backend/internal/sync/pull.go `
        backend/internal/sync/void.go `
        backend/internal/sync/void_pull_test.go
git commit -m "feat(backend): void_sale como fato append-only no stream de pull (Gap 2)"
```

---

## Task A2: Gap 3 — catálogo (clientes e preços) no stream de pull

**Contexto:** Mudanças de cliente e preço de cilindro chegam no servidor via PUT/DELETE, mas nunca chegam em outros dispositivos via pull. Solução: tabela `catalog_events` append-only. Os handlers `UpsertCustomer`, `DeleteCustomer` e `UpdateCylinderType` inserem nela (na mesma tx) com um snapshot JSON. `PullCatalogEvents` é puxada no pull; Cursor ganha campo `catalog`.

**Files:**
- Create: `backend/internal/db/migrations/0005_catalog_events.up.sql`
- Create: `backend/internal/db/migrations/0005_catalog_events.down.sql`
- Modify: `backend/internal/db/queries/catalog.sql`
- Regen: `backend/internal/db/gen/`
- Modify: `backend/internal/sync/pull.go` (+Catalog no Cursor, wire PullCatalogEvents)
- Modify: `backend/internal/catalog/handlers.go` (todos os 3 métodos emitem evento)
- Create: `backend/internal/catalog/catalog_events_test.go`

- [ ] **Step 1: Escrever os testes que vão falhar**

Crie `backend/internal/catalog/catalog_events_test.go`:

```go
package catalog_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/pedrogomesdev/gas-manager-backend/internal/catalog"
	syncsvc "github.com/pedrogomesdev/gas-manager-backend/internal/sync"
	"github.com/pedrogomesdev/gas-manager-backend/internal/testutil"
)

func TestUpsertCustomer_EmitsCatalogEvent(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewPool(t, ctx)
	testutil.EnsureUser(t, ctx, pool, "user-cat-1")
	svc := catalog.NewService(pool)
	syncSvc := syncsvc.NewService(pool)

	custID := "aaaaaaaa-0000-0000-0000-000000000001"
	err := svc.UpsertCustomer(ctx, catalog.CustomerInput{
		ID: custID, Name: "Teste", UpdatedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("UpsertCustomer: %v", err)
	}

	page, err := syncSvc.Pull(ctx, syncsvc.Cursor{}, 50)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}

	var found bool
	for _, e := range page.Events {
		if e.Kind == "customer_upsert" {
			found = true
			raw, _ := json.Marshal(e.Data)
			var d map[string]interface{}
			json.Unmarshal(raw, &d)
			if d["id"] != custID {
				t.Errorf("customer_upsert id: want %s got %v", custID, d["id"])
			}
			if d["name"] != "Teste" {
				t.Errorf("customer_upsert name: want Teste got %v", d["name"])
			}
		}
	}
	if !found {
		t.Error("expected customer_upsert in pull stream")
	}
}

func TestDeleteCustomer_EmitsCatalogEvent(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewPool(t, ctx)
	testutil.EnsureUser(t, ctx, pool, "user-cat-2")
	svc := catalog.NewService(pool)
	syncSvc := syncsvc.NewService(pool)

	custID := "aaaaaaaa-0000-0000-0000-000000000002"
	svc.UpsertCustomer(ctx, catalog.CustomerInput{ID: custID, Name: "A Deletar", UpdatedAt: time.Now()})

	// Need to pull catalog event first to advance catalog cursor
	page0, _ := syncSvc.Pull(ctx, syncsvc.Cursor{}, 50)

	svc.DeleteCustomer(ctx, custID)

	page1, _ := syncSvc.Pull(ctx, page0.NextCursor, 50)
	var found bool
	for _, e := range page1.Events {
		if e.Kind == "customer_delete" {
			found = true
			raw, _ := json.Marshal(e.Data)
			var d map[string]interface{}
			json.Unmarshal(raw, &d)
			if d["id"] != custID {
				t.Errorf("customer_delete id: want %s", custID)
			}
		}
	}
	if !found {
		t.Error("expected customer_delete in pull stream")
	}
}

func TestUpdateCylinderType_EmitsCatalogEvent(t *testing.T) {
	ctx := context.Background()
	pool := testutil.NewPool(t, ctx)
	testutil.EnsureUser(t, ctx, pool, "user-cat-3")
	svc := catalog.NewService(pool)
	syncSvc := syncsvc.NewService(pool)
	ct := testutil.EnsureCylinderType(t, ctx, pool)

	err := svc.UpdateCylinderType(ctx, ct, catalog.CylinderTypeInput{
		SalePrice: "140.00", CostPrice: "100.00", Active: true, UpdatedAt: time.Now(),
	})
	if err != nil {
		t.Fatalf("UpdateCylinderType: %v", err)
	}

	page, _ := syncSvc.Pull(ctx, syncsvc.Cursor{}, 50)
	var found bool
	for _, e := range page.Events {
		if e.Kind == "cylinder_upsert" {
			found = true
			raw, _ := json.Marshal(e.Data)
			var d map[string]interface{}
			json.Unmarshal(raw, &d)
			if d["sale_price"] != "140.00" {
				t.Errorf("cylinder_upsert sale_price: want 140.00 got %v", d["sale_price"])
			}
		}
	}
	if !found {
		t.Error("expected cylinder_upsert in pull stream")
	}
}
```

- [ ] **Step 2: Rodar e confirmar que falha**

```powershell
cd backend
go test ./internal/catalog/ -run "TestUpsertCustomer_Emits|TestDeleteCustomer_Emits|TestUpdateCylinder_Emits" -v -count=1
# Expected: FAIL — catalog_events table doesn't exist
```

- [ ] **Step 3: Criar migration 0005**

`backend/internal/db/migrations/0005_catalog_events.up.sql`:
```sql
CREATE TABLE catalog_events (
  id                 BIGSERIAL PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('customer_upsert','customer_delete','cylinder_upsert')),
  ref_id             UUID NOT NULL,
  data               TEXT NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_catalog_events_id ON catalog_events(id);
```

`backend/internal/db/migrations/0005_catalog_events.down.sql`:
```sql
DROP TABLE IF EXISTS catalog_events;
```

- [ ] **Step 4: Adicionar queries em `catalog.sql`**

Adicione ao final de `backend/internal/db/queries/catalog.sql`:
```sql
-- name: InsertCatalogEvent :one
INSERT INTO catalog_events (kind, ref_id, data) VALUES ($1, $2, $3)
RETURNING id, server_received_at;

-- name: PullCatalogEvents :many
SELECT id, kind, data, server_received_at
FROM catalog_events
WHERE id > $1
ORDER BY id
LIMIT $2;
```

- [ ] **Step 5: Rodar `sqlc generate` e confirmar que compila**

```powershell
cd backend && sqlc generate && go build ./...
```

- [ ] **Step 6: Atualizar `Cursor` e `Pull()` em `pull.go`**

Adicione campo ao struct `Cursor`:
```go
type Cursor struct {
	Sale    int64 `json:"sale"`
	Restock int64 `json:"restock"`
	Adjust  int64 `json:"adjust"`
	Settle  int64 `json:"settle"`
	Void    int64 `json:"void"`
	Catalog int64 `json:"catalog"`
}
```

Na função `Pull()`, após o bloco de voids, adicione:
```go
catalogEvts, err := q.PullCatalogEvents(ctx, gen.PullCatalogEventsParams{ID: c.Catalog, Limit: limit})
if err != nil {
    return PullPage{}, err
}
if int32(len(catalogEvts)) == limit {
    anyFull = true
}
for _, r := range catalogEvts {
    var rawData json.RawMessage
    if jsonErr := json.Unmarshal([]byte(r.Data), &rawData); jsonErr != nil {
        rawData = json.RawMessage(`{}`)
    }
    events = append(events, Event{Kind: r.Kind, Sequence: r.ID, ServerReceivedAt: toTime(r.ServerReceivedAt), Data: rawData})
}
```

Adicione o import `"encoding/json"` ao topo do arquivo se ainda não estiver presente.

No switch de cursor, adicione:
```go
case "customer_upsert", "customer_delete", "cylinder_upsert":
    if e.Sequence > next.Catalog {
        next.Catalog = e.Sequence
    }
```

- [ ] **Step 7: Atualizar `catalog/handlers.go` — os 3 métodos emitem evento**

Substitua `UpsertCustomer`:
```go
func (s *Service) UpsertCustomer(ctx context.Context, in CustomerInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	var creditLimit pgtype.Numeric
	if in.CreditLimit != nil {
		creditLimit = pgconv.Numeric(*in.CreditLimit)
	}
	if err := q.UpsertCustomer(ctx, gen.UpsertCustomerParams{
		ID: pgconv.MustUUID(in.ID), Name: in.Name, Phone: in.Phone,
		Address: in.Address, CreditLimit: creditLimit,
		UpdatedAt: pgconv.Timestamptz(in.UpdatedAt),
	}); err != nil {
		return err
	}

	data, _ := json.Marshal(map[string]any{
		"id": in.ID, "name": in.Name, "phone": in.Phone,
		"address": in.Address, "updated_at": in.UpdatedAt.UTC().Format(time.RFC3339),
	})
	if _, err := q.InsertCatalogEvent(ctx, gen.InsertCatalogEventParams{
		Kind: "customer_upsert", RefID: pgconv.MustUUID(in.ID), Data: string(data),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
```

Substitua `DeleteCustomer`:
```go
func (s *Service) DeleteCustomer(ctx context.Context, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	if err := q.UnlinkCustomerSales(ctx, pgconv.MustUUID(id)); err != nil {
		return err
	}
	rows, err := q.DeleteCustomerIfNoBalance(ctx, pgconv.MustUUID(id))
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrBalanceOwed
	}

	data, _ := json.Marshal(map[string]any{"id": id})
	if _, err := q.InsertCatalogEvent(ctx, gen.InsertCatalogEventParams{
		Kind: "customer_delete", RefID: pgconv.MustUUID(id), Data: string(data),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
```

Substitua `UpdateCylinderType`:
```go
func (s *Service) UpdateCylinderType(ctx context.Context, id string, in CylinderTypeInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	if err := q.UpdateCylinderType(ctx, gen.UpdateCylinderTypeParams{
		ID: pgconv.MustUUID(id), SalePrice: pgconv.Numeric(in.SalePrice),
		CostPrice: pgconv.Numeric(in.CostPrice), Active: in.Active,
		UpdatedAt: pgconv.Timestamptz(in.UpdatedAt),
	}); err != nil {
		return err
	}

	data, _ := json.Marshal(map[string]any{
		"id": id, "sale_price": in.SalePrice, "cost_price": in.CostPrice,
		"updated_at": in.UpdatedAt.UTC().Format(time.RFC3339),
	})
	if _, err := q.InsertCatalogEvent(ctx, gen.InsertCatalogEventParams{
		Kind: "cylinder_upsert", RefID: pgconv.MustUUID(id), Data: string(data),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
```

Adicione `"encoding/json"` e `"time"` aos imports de `handlers.go` se necessário.

- [ ] **Step 8: Confirmar que os testes do catalogo passam**

```powershell
cd backend
go test ./internal/catalog/ -v -count=1 2>&1 | tail -20
# Expected: all PASS
```

- [ ] **Step 9: Rodar suíte completa**

```powershell
go test ./... -count=1 2>&1 | tail -30
# Expected: all PASS (ignoring infra failures em internal/auth e internal/db)
```

- [ ] **Step 10: Commit**

```powershell
git add backend/internal/db/migrations/0005_catalog_events.* `
        backend/internal/db/queries/catalog.sql `
        backend/internal/db/gen/ `
        backend/internal/sync/pull.go `
        backend/internal/catalog/handlers.go `
        backend/internal/catalog/catalog_events_test.go
git commit -m "feat(backend): catalog_events no stream de pull (Gap 3) — clientes e precos sincronizam"
```

---

## Task A3: Revisão TL+QA + redeploy do backend

- [ ] **Step 1: Revisão TL+QA** — subagente revisa o diff dos Gaps 2+3.

- [ ] **Step 2: Rodar suíte completa de novo** (confirmação final antes do deploy)

```powershell
cd backend
go test ./internal/sync/ ./internal/catalog/ ./internal/pgconv/ -count=1 -v 2>&1 | grep -E "PASS|FAIL|---"
```

- [ ] **Step 3: Deploy via skill**

Use o skill `backend` (ou o comando abaixo via PowerShell):
```powershell
gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet
```

- [ ] **Step 4: Verificar health + shapes**

```powershell
Invoke-WebRequest -Uri "https://gas-backend-750551393506.southamerica-east1.run.app/readyz" -UseBasicParsing | Select-Object StatusCode
# Expected: 200
```

- [ ] **Step 5: Commit de doc update no HANDOFF**

```powershell
git add HANDOFF.md
git commit -m "docs: backend redeployado com Gaps 2+3 fechados"
```

---

## Task B1: Schema v3 + fix apply.ts

**Contexto:** Schema v2 não tem `applied_events` nem `cylinder_types.updated_at`. O `apply.ts` usa `sync_outbox` para dedupe de `stock_adjustment`/`debt_settlement` (overload de tabela de saída) e âncora LWW de `cylinder_upsert` (smell). Isso será corrigido.

**Files:**
- Create: `__mocks__/expo-crypto.ts`
- Modify: `jest.config.js`
- Modify: `db/database.ts`
- Modify: `lib/sync/apply.ts`
- Modify: `db/__tests__/migration.test.ts`

- [ ] **Step 1: Criar mock de `expo-crypto` para o harness Node**

Crie `__mocks__/expo-crypto.ts`:
```typescript
import { randomUUID as nodeRandomUUID } from "crypto";
export const randomUUID = nodeRandomUUID;
```

Adicione ao `jest.config.js` dentro de `moduleNameMapper`:
```js
"^expo-crypto$": "<rootDir>/__mocks__/expo-crypto.ts",
```

- [ ] **Step 2: Escrever as asserções v3 no teste de migração**

Em `db/__tests__/migration.test.ts`, adicione (ou substitua o check de versão):
```typescript
it("schema v3: applied_events existe e cylinder_types tem updated_at", async () => {
  const db = await freshDb();
  const ver = await db.getFirstAsync<{ user_version: number }>("PRAGMA user_version");
  expect(ver?.user_version).toBe(3);

  const cols = await db.getAllAsync<{ name: string }>(
    `PRAGMA table_info(cylinder_types)`
  );
  const names = cols.map((c) => c.name);
  expect(names).toContain("updated_at");

  const tbl = await db.getFirstAsync<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='applied_events'`
  );
  expect(tbl?.name).toBe("applied_events");
});
```

Rode e confirme que falha:
```powershell
cd C:\Users\PC\Documents\gas-manager
npx jest db/__tests__/migration.test.ts -t "schema v3"
# Expected: FAIL
```

- [ ] **Step 3: Implementar migration v3 em `db/database.ts`**

Mude `SCHEMA_VERSION = 3`.

No bloco `migrate()`, adicione após o bloco `if (current < 2)`:
```typescript
if (current < 3) {
  await db.withTransactionAsync(async () => {
    await db.execAsync(`
      ALTER TABLE cylinder_types ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';

      CREATE TABLE IF NOT EXISTS applied_events (
        event_uuid TEXT NOT NULL PRIMARY KEY
      );

      PRAGMA user_version = 3;
    `);
  });
}
```

- [ ] **Step 4: Confirmar que o teste de migração passa**

```powershell
npx jest db/__tests__/migration.test.ts -v
# Expected: all PASS
```

- [ ] **Step 5: Corrigir os smells em `apply.ts`**

**Corrija `applyStockAdj`** — substitua o bloco de dedupe via `sync_outbox`:
```typescript
// ANTES (smell):
// const dedup = await db.runAsync(`INSERT OR IGNORE INTO sync_outbox ...`)

// DEPOIS:
const dedup = await db.runAsync(
  `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
  [d.id]
);
if (dedup.changes === 0) return;
```

**Corrija `applySettlement`** — mesma substituição:
```typescript
const dedup = await db.runAsync(
  `INSERT OR IGNORE INTO applied_events (event_uuid) VALUES (?)`,
  [d.id]
);
if (dedup.changes === 0) return;
```

**Reescreva `applyCylinderUpsert`** inteira — substitua pela versão limpa:
```typescript
async function applyCylinderUpsert(
  db: SQLiteDatabase,
  d: PulledCylinderUpsert
): Promise<void> {
  const salePrice = parseFloat(d.sale_price);
  const costPrice = parseFloat(d.cost_price);

  // LWW via cylinder_types.updated_at (coluna adicionada na v3).
  // A comparação lexicográfica de strings ISO8601 é equivalente à
  // comparação cronológica. updated_at='' sempre perde para qualquer
  // timestamp real.
  await db.runAsync(
    `UPDATE cylinder_types
     SET sale_price = ?, cost_price = ?, updated_at = ?
     WHERE name = 'P13' AND ? > updated_at`,
    [salePrice, costPrice, d.updated_at, d.updated_at]
  );
}
```

- [ ] **Step 6: Rodar suíte completa**

```powershell
npx jest --runInBand
# Expected: all PASS (37+ testes)
```

- [ ] **Step 7: Commit**

```powershell
git add __mocks__/ jest.config.js db/database.ts lib/sync/apply.ts db/__tests__/migration.test.ts
git commit -m "feat(app): schema v3 (applied_events + cylinder_types.updated_at) + fix smells do apply.ts"
```

---

## Task B2: store/sync.ts + SyncEngine push loop

**Files:**
- Create: `store/sync.ts`
- Create: `lib/sync/engine.ts`
- Create: `lib/sync/__tests__/engine.push.test.ts`

- [ ] **Step 1: Escrever os testes do push loop**

Crie `lib/sync/__tests__/engine.push.test.ts`:
```typescript
import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { enqueue } from "@/lib/sync/outbox";
import { SyncEngine } from "@/lib/sync/engine";
import type { SQLiteDatabase } from "expo-sqlite";

// Mock da API
const mockPushEvents = jest.fn();
const mockVoidSale = jest.fn();
const mockUpsertCustomer = jest.fn();
const mockDeleteCustomer = jest.fn();
const mockUpsertCylinderType = jest.fn();
let mockSignOutUser = jest.fn();

jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  pushEvents: (...a: unknown[]) => mockPushEvents(...a),
  voidSale: (...a: unknown[]) => mockVoidSale(...a),
  upsertCustomer: (...a: unknown[]) => mockUpsertCustomer(...a),
  deleteCustomer: (...a: unknown[]) => mockDeleteCustomer(...a),
  upsertCylinderType: (...a: unknown[]) => mockUpsertCylinderType(...a),
  AuthError: class AuthError extends Error { constructor(m = '') { super(m); this.name = 'AuthError'; } },
  NetworkError: class NetworkError extends Error { constructor(m = '') { super(m); this.name = 'NetworkError'; } },
}));

jest.mock("@/lib/auth", () => ({
  signOutUser: () => mockSignOutUser(),
}));

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

async function enqueueSale(db: SQLiteDatabase, uuid = "sale-uuid-push-1") {
  await enqueue(db, {
    event_uuid: uuid,
    kind: "sale",
    payload: JSON.stringify({ kind: "sale", id: uuid, client_created_at: new Date().toISOString(), sale: {} }),
    client_created_at: new Date().toISOString(),
  });
}

describe("SyncEngine.pushOnce", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockPushEvents.mockResolvedValue([{ id: "sale-uuid-push-1", status: "applied" }]);
  });

  it("não chama pushEvents se outbox está vazio", async () => {
    const db = await freshDb();
    const engine = new SyncEngine(db);
    await engine.pushOnce();
    expect(mockPushEvents).not.toHaveBeenCalled();
  });

  it("envia eventos de fato via pushEvents e marca done", async () => {
    const db = await freshDb();
    await enqueueSale(db);
    const engine = new SyncEngine(db);
    await engine.pushOnce();
    expect(mockPushEvents).toHaveBeenCalledTimes(1);
    const pending = await db.getAllAsync(
      `SELECT * FROM sync_outbox WHERE status = 'pending'`
    );
    expect(pending).toHaveLength(0);
  });

  it("status duplicate também marca done", async () => {
    mockPushEvents.mockResolvedValue([{ id: "sale-uuid-push-1", status: "duplicate" }]);
    const db = await freshDb();
    await enqueueSale(db);
    const engine = new SyncEngine(db);
    await engine.pushOnce();
    const done = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'sale-uuid-push-1'`
    );
    expect(done?.status).toBe("done");
  });

  it("void_sale chama voidSale (endpoint individual) e marca done", async () => {
    mockVoidSale.mockResolvedValue(undefined);
    const db = await freshDb();
    await enqueue(db, {
      event_uuid: "void-uuid-1",
      kind: "void_sale",
      payload: JSON.stringify({ id: "sale-ref-uuid" }),
      client_created_at: new Date().toISOString(),
    });
    const engine = new SyncEngine(db);
    await engine.pushOnce();
    expect(mockVoidSale).toHaveBeenCalledWith("sale-ref-uuid");
    const row = await db.getFirstAsync<{ status: string }>(
      `SELECT status FROM sync_outbox WHERE event_uuid = 'void-uuid-1'`
    );
    expect(row?.status).toBe("done");
  });

  it("AuthError no pushEvents chama signOutUser e para", async () => {
    const { AuthError } = jest.requireMock("@/lib/api");
    mockPushEvents.mockRejectedValue(new AuthError());
    const db = await freshDb();
    await enqueueSale(db);
    const engine = new SyncEngine(db);
    await engine.pushOnce();
    expect(mockSignOutUser).toHaveBeenCalled();
  });

  it("NetworkError bumpa attempts mas não marca error", async () => {
    const { NetworkError } = jest.requireMock("@/lib/api");
    mockPushEvents.mockRejectedValue(new NetworkError());
    const db = await freshDb();
    await enqueueSale(db);
    const engine = new SyncEngine(db);
    await engine.pushOnce().catch(() => {});
    const row = await db.getFirstAsync<{ attempts: number; status: string }>(
      `SELECT attempts, status FROM sync_outbox WHERE event_uuid = 'sale-uuid-push-1'`
    );
    expect(row?.status).toBe("pending"); // não marca error em falha de rede
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```powershell
npx jest lib/sync/__tests__/engine.push.test.ts -v
# Expected: FAIL — SyncEngine undefined
```

- [ ] **Step 3: Criar `store/sync.ts`**

```typescript
import { create } from "zustand";

export type SyncStatus = "idle" | "syncing" | "error" | "offline";

interface SyncStore {
  status: SyncStatus;
  pendingCount: number;
  lastSyncedAt: string | null;
  online: boolean;
  setStatus: (s: SyncStatus) => void;
  setPendingCount: (n: number) => void;
  setLastSyncedAt: (t: string) => void;
  setOnline: (v: boolean) => void;
}

export const useSyncStore = create<SyncStore>((set) => ({
  status: "idle",
  pendingCount: 0,
  lastSyncedAt: null,
  online: true,
  setStatus: (status) => set({ status }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  setOnline: (online) => set({ online }),
}));
```

- [ ] **Step 4: Criar `lib/sync/engine.ts` com `pushOnce`**

```typescript
import type { SQLiteDatabase } from "expo-sqlite";
import {
  pushEvents, voidSale, upsertCustomer, deleteCustomer, upsertCylinderType,
  AuthError, NetworkError, type PushEvent,
} from "@/lib/api";
import { pendingEvents, markDone, markError, pendingCount, type PendingEvent } from "@/lib/sync/outbox";
import { signOutUser } from "@/lib/auth";

const FACT_KINDS = new Set(["sale", "restock", "stock_adjustment", "debt_settlement"]);

export class SyncEngine {
  constructor(private db: SQLiteDatabase) {}

  async pushOnce(): Promise<void> {
    const events = await pendingEvents(this.db);
    if (events.length === 0) return;

    const facts = events.filter((e) => FACT_KINDS.has(e.kind));
    const others = events.filter((e) => !FACT_KINDS.has(e.kind));

    if (facts.length > 0) {
      try {
        const payloads = facts.map((e) => JSON.parse(e.payload) as PushEvent);
        const results = await pushEvents(payloads);
        for (const r of results) {
          if (r.status === "applied" || r.status === "duplicate") {
            await markDone(this.db, r.id);
          } else {
            await markError(this.db, r.id, r.error ?? "server_error");
          }
        }
      } catch (e) {
        if (e instanceof AuthError) {
          await signOutUser();
          return;
        }
        if (e instanceof NetworkError) {
          // Deixa pending — próxima tentativa na reconexão
          return;
        }
        throw e;
      }
    }

    for (const event of others) {
      try {
        await this._pushCatalogEvent(event);
        await markDone(this.db, event.event_uuid);
      } catch (e) {
        if (e instanceof AuthError) {
          await signOutUser();
          return;
        }
        if (e instanceof NetworkError) {
          return; // retry na reconexão
        }
        await markError(this.db, event.event_uuid, (e as Error).message ?? "unknown");
      }
    }
  }

  private async _pushCatalogEvent(event: PendingEvent): Promise<void> {
    const payload = JSON.parse(event.payload);
    switch (event.kind) {
      case "void_sale":       return voidSale(payload.id);
      case "customer_upsert": return upsertCustomer(payload);
      case "customer_delete": return deleteCustomer(payload.id);
      case "cylinder_upsert": return upsertCylinderType(payload.id, payload);
    }
  }
}
```

- [ ] **Step 5: Confirmar que os testes passam**

```powershell
npx jest lib/sync/__tests__/engine.push.test.ts -v
# Expected: all PASS
```

- [ ] **Step 6: Commit**

```powershell
git add store/sync.ts lib/sync/engine.ts lib/sync/__tests__/engine.push.test.ts
git commit -m "feat(app): store de sync + SyncEngine push loop com backoff e re-auth"
```

---

## Task B3: SyncEngine pull loop

**Files:**
- Modify: `lib/sync/engine.ts` (+pullAll)
- Create: `lib/sync/__tests__/engine.pull.test.ts`

- [ ] **Step 1: Escrever os testes do pull loop**

Crie `lib/sync/__tests__/engine.pull.test.ts`:
```typescript
import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { SyncEngine } from "@/lib/sync/engine";
import { SERVER_P13_UUID } from "@/lib/sync/constants";

const mockPullPage = jest.fn();
jest.mock("@/lib/api", () => ({
  ...jest.requireActual("@/lib/api"),
  pullPage: (...a: unknown[]) => mockPullPage(...a),
}));

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  await db.runAsync(`UPDATE inventory SET full_qty = 10 WHERE cylinder_type_id = (SELECT id FROM cylinder_types WHERE name='P13' LIMIT 1)`);
  return db;
}

function makeSalePage(cursor: string, next: string, hasMore = false) {
  return {
    events: [{
      kind: "sale", sequence: 1, server_received_at: "2026-06-19T10:00:00Z",
      data: { id: "sale-pull-uuid-1", customer_id: null, cylinder_type_id: SERVER_P13_UUID,
              quantity: 1, unit_price: "120.00", cost_price: "90.00", total: "120.00",
              payment_method: "cash", is_exchange: false, voided_at: null,
              server_received_at: "2026-06-19T10:00:00Z", sequence: 1 },
    }],
    next_cursor: next,
    has_more: hasMore,
  };
}

describe("SyncEngine.pullAll", () => {
  beforeEach(() => jest.resetAllMocks());

  it("aplica eventos de uma página e avança o cursor", async () => {
    mockPullPage.mockResolvedValueOnce(makeSalePage("", "cursor-abc", false));
    const db = await freshDb();
    const engine = new SyncEngine(db);
    await engine.pullAll();

    const sale = await db.getFirstAsync(`SELECT uuid FROM sales WHERE uuid = 'sale-pull-uuid-1'`);
    expect(sale).not.toBeNull();

    const state = await db.getFirstAsync<{ pull_cursor: string }>("SELECT pull_cursor FROM sync_state WHERE id=1");
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

  it("retoma do cursor persistido ao reiniciar", async () => {
    mockPullPage.mockResolvedValue({ events: [], next_cursor: "resume-cursor", has_more: false });
    const db = await freshDb();
    await db.runAsync("UPDATE sync_state SET pull_cursor = 'persisted-cursor' WHERE id=1");
    await new SyncEngine(db).pullAll();
    expect(mockPullPage).toHaveBeenCalledWith("persisted-cursor", expect.any(Number));
  });

  it("aplica void_sale DEPOIS da venda na mesma página (duas passadas)", async () => {
    const db = await freshDb();
    // Página com sale E void_sale (no mesmo pull)
    mockPullPage.mockResolvedValueOnce({
      events: [
        { kind: "void_sale", sequence: 5, server_received_at: "2026-06-19T10:01:00Z",
          data: { id: "sale-two-pass-1" } },
        { kind: "sale", sequence: 1, server_received_at: "2026-06-19T10:00:00Z",
          data: { id: "sale-two-pass-1", customer_id: null, cylinder_type_id: SERVER_P13_UUID,
                  quantity: 2, unit_price: "120.00", cost_price: "90.00", total: "240.00",
                  payment_method: "cash", is_exchange: false, voided_at: null,
                  server_received_at: "2026-06-19T10:00:00Z", sequence: 1 } },
      ],
      next_cursor: "c1",
      has_more: false,
    });

    await new SyncEngine(db).pullAll();

    // Venda deve existir e estar anulada
    const sale = await db.getFirstAsync<{ voided_at: string | null }>(
      "SELECT voided_at FROM sales WHERE uuid = 'sale-two-pass-1'"
    );
    expect(sale).not.toBeNull();
    expect(sale?.voided_at).not.toBeNull(); // void foi aplicado após a venda
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```powershell
npx jest lib/sync/__tests__/engine.pull.test.ts -v
# Expected: FAIL — pullAll undefined
```

- [ ] **Step 3: Implementar `pullAll` em `engine.ts`**

Adicione à classe `SyncEngine`:
```typescript
async pullAll(): Promise<void> {
  const state = await this.db.getFirstAsync<{ pull_cursor: string }>(
    `SELECT pull_cursor FROM sync_state WHERE id = 1`
  );
  let cursor = state?.pull_cursor ?? "";

  let hasMore = true;
  while (hasMore) {
    const page = await pullPage(cursor, 200);

    // Duas passadas: fatos primeiro, void/catálogo depois.
    // Garante que a venda existe localmente antes de tentar anulá-la
    // no mesmo page (evita forward-reference quando void.sequence < sale.sequence).
    const facts = page.events.filter((e) => FACT_KINDS.has(e.kind));
    const rest  = page.events.filter((e) => !FACT_KINDS.has(e.kind));

    await this.db.withTransactionAsync(async () => {
      for (const e of facts) await applyEventSafe(this.db, e);
      for (const e of rest)  await applyEventSafe(this.db, e);
      await this.db.runAsync(
        `UPDATE sync_state SET pull_cursor = ?, last_synced_at = datetime('now') WHERE id = 1`,
        [page.next_cursor]
      );
    });

    cursor  = page.next_cursor;
    hasMore = page.has_more;
  }
}
```

Adicione a função `applyEventSafe` (logo após os imports):
```typescript
import { applyEvent } from "@/lib/sync/apply";
import { pullPage } from "@/lib/api";

async function applyEventSafe(db: SQLiteDatabase, e: unknown): Promise<void> {
  try {
    await applyEvent(db, e as any);
  } catch (err) {
    // Evento malformado não deve bloquear o cursor; logar e continuar.
    console.warn("[SyncEngine] applyEvent falhou:", err);
  }
}
```

- [ ] **Step 4: Confirmar que os testes passam**

```powershell
npx jest lib/sync/__tests__/engine.pull.test.ts -v
# Expected: all PASS
```

- [ ] **Step 5: Rodar suíte completa**

```powershell
npx jest --runInBand
# Expected: all PASS
```

- [ ] **Step 6: Commit**

```powershell
git add lib/sync/engine.ts lib/sync/__tests__/engine.pull.test.ts
git commit -m "feat(app): SyncEngine pull loop com cursor duravel e duas passadas por pagina"
```

---

## Task B4: Engine orchestration + conectividade

**Files:**
- Modify: `lib/sync/engine.ts` (+start, stop, syncNow)
- Verify: `@react-native-community/netinfo` (ou `expo-network` disponível via expo)

- [ ] **Step 1: Verificar disponibilidade de API de conectividade**

Expo SDK 54 inclui `expo-network` nativamente. Confirme:
```powershell
cat "C:\Users\PC\Documents\gas-manager\node_modules\expo\package.json" | Select-String "network"
```

Se não disponível, instale:
```powershell
npx expo install expo-network
```

- [ ] **Step 2: Adicionar `start`, `stop`, `syncNow` ao `engine.ts`**

```typescript
import NetInfo from "@react-native-community/netinfo";
// OU, se usando expo-network:
// import * as Network from 'expo-network';

export class SyncEngine {
  private _stopped = false;
  private _unsubscribe?: () => void;

  // ... pushOnce e pullAll já existem ...

  async syncNow(): Promise<void> {
    if (this._stopped) return;
    try {
      await this.pullAll();
      await this.pushOnce();
    } catch (e) {
      if (!(e instanceof NetworkError)) {
        console.warn("[SyncEngine] syncNow erro:", e);
      }
    }
  }

  start(): void {
    this._stopped = false;
    // Sync inicial ao ligar
    this.syncNow();

    // Re-sync ao reconectar
    this._unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected && !this._stopped) {
        this.syncNow();
      }
    });
  }

  stop(): void {
    this._stopped = true;
    this._unsubscribe?.();
    this._unsubscribe = undefined;
  }
}
```

Se usar `expo-network` ao invés de NetInfo, ajuste para polling ou use `useNetInfo` do react-native-netinfo. A instância do engine viverá no `_layout.tsx` e `start()` será chamado no login.

- [ ] **Step 3: Instalar `@react-native-community/netinfo` se necessário**

```powershell
npx expo install @react-native-community/netinfo
```

- [ ] **Step 4: Commit**

```powershell
git add lib/sync/engine.ts package.json
git commit -m "feat(app): orquestracao do SyncEngine (start/stop/syncNow + reconexao automatica)"
```

---

## Task B5: Wire — mutations de vendas ao outbox

**Contexto:** `registerSale` precisa gerar UUID e enfileirar `sale` no outbox (mesma tx). `deleteSale` vira `voidSale` (seta `voided_at`, reverte aggregados, enfileira `void_sale`, sem DELETE físico). Queries de listagem precisam filtrar `voided_at IS NULL`.

**Files:**
- Modify: `db/queries/sales.ts`
- Create: `db/__tests__/sales.sync.test.ts`

- [ ] **Step 1: Escrever os testes**

Crie `db/__tests__/sales.sync.test.ts`:
```typescript
import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { registerSale, voidSale, getSales, getTodaySales, getDashboardStats } from "@/db/queries/sales";
import { SERVER_P13_UUID } from "@/lib/sync/constants";

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  await db.runAsync(`UPDATE inventory SET full_qty=10 WHERE cylinder_type_id=(SELECT id FROM cylinder_types WHERE name='P13' LIMIT 1)`);
  return db;
}

async function getP13Id(db: any) {
  const r = await db.getFirstAsync<{ id: number }>(`SELECT id FROM cylinder_types WHERE name='P13' LIMIT 1`);
  return r!.id;
}

describe("registerSale", () => {
  it("gera uuid e enfileira evento no outbox", async () => {
    const db = await freshDb();
    const cylinderTypeId = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cylinderTypeId, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });

    const row = await db.getFirstAsync<{ uuid: string }>(`SELECT uuid FROM sales LIMIT 1`);
    expect(row?.uuid).toBeTruthy();

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("sale");
    const payload = JSON.parse(outbox!.payload);
    expect(payload.sale.cylinder_type_id).toBe(SERVER_P13_UUID);
    expect(payload.sale.unit_price).toBe("120.00");
    expect(payload.id).toBe(row?.uuid);
  });

  it("venda fiado: payload inclui customer_id (uuid do cliente)", async () => {
    const db = await freshDb();
    const cylinderTypeId = await getP13Id(db);
    const custR = await db.runAsync(`INSERT INTO customers (name, uuid, balance, updated_at) VALUES ('João', 'cust-uuid-b5-1', 0, datetime('now'))`);
    const custId = custR.lastInsertRowId;

    await registerSale(db, { customer_id: custId, cylinder_type_id: cylinderTypeId, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "fiado", is_exchange: false });

    const outbox = await db.getFirstAsync<{ payload: string }>(`SELECT payload FROM sync_outbox WHERE kind='sale'`);
    const payload = JSON.parse(outbox!.payload);
    expect(payload.sale.customer_id).toBe("cust-uuid-b5-1");
    expect(payload.sale.payment_method).toBe("fiado");
  });
});

describe("voidSale", () => {
  it("seta voided_at, reverte inventário e enfileira void_sale (sem DELETE)", async () => {
    const db = await freshDb();
    const cylinderTypeId = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cylinderTypeId, quantity: 2, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });

    const saleRow = await db.getFirstAsync<{ id: number; uuid: string }>(`SELECT id, uuid FROM sales LIMIT 1`);
    const saleId = saleRow!.id;

    // Limpa o outbox para contar apenas o void
    await db.runAsync(`UPDATE sync_outbox SET status='done'`);

    await voidSale(db, saleId);

    const sale = await db.getFirstAsync<{ voided_at: string | null }>(`SELECT voided_at FROM sales WHERE id=?`, [saleId]);
    expect(sale?.voided_at).not.toBeNull();

    const inv = await db.getFirstAsync<{ full_qty: number }>(`SELECT full_qty FROM inventory WHERE cylinder_type_id=?`, [cylinderTypeId]);
    expect(inv?.full_qty).toBe(10); // revertido para valor original

    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("void_sale");
    const voidPayload = JSON.parse(outbox!.payload);
    expect(voidPayload.id).toBe(saleRow!.uuid);
  });

  it("getSales filtra vendas anuladas (voided_at IS NULL)", async () => {
    const db = await freshDb();
    const cylinderTypeId = await getP13Id(db);
    await registerSale(db, { customer_id: null, cylinder_type_id: cylinderTypeId, quantity: 1, unit_price: 120, cost_price: 90, payment_method: "cash", is_exchange: false });
    const saleRow = await db.getFirstAsync<{ id: number }>(`SELECT id FROM sales LIMIT 1`);
    await voidSale(db, saleRow!.id);

    const sales = await getSales(db);
    expect(sales).toHaveLength(0); // anulada não aparece
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```powershell
npx jest db/__tests__/sales.sync.test.ts -v
# Expected: FAIL — uuid undefined, void_sale não existe
```

- [ ] **Step 3: Reescrever `db/queries/sales.ts`**

```typescript
import { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueue } from "@/lib/sync/outbox";
import { SERVER_P13_UUID } from "@/lib/sync/constants";
import { Sale, DashboardStats } from "@/types";

export async function registerSale(
  db: SQLiteDatabase,
  data: {
    customer_id: number | null;
    cylinder_type_id: number;
    quantity: number;
    unit_price: number;
    cost_price: number;
    payment_method: string;
    is_exchange: boolean;
  }
) {
  const total = data.quantity * data.unit_price;
  const uuid = randomUUID();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO sales (uuid, customer_id, cylinder_type_id, quantity, unit_price, cost_price, total, payment_method, is_exchange)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, data.customer_id, data.cylinder_type_id, data.quantity, data.unit_price, data.cost_price, total, data.payment_method, data.is_exchange ? 1 : 0]
    );

    await db.runAsync(
      `UPDATE inventory SET full_qty = MAX(0, full_qty - ?), empty_qty = empty_qty + ?
       WHERE cylinder_type_id = ?`,
      [data.quantity, data.is_exchange ? data.quantity : 0, data.cylinder_type_id]
    );

    if (data.payment_method === "fiado" && data.customer_id) {
      await db.runAsync(`UPDATE customers SET balance = balance - ? WHERE id = ?`, [total, data.customer_id]);
    }

    let customerUuid: string | null = null;
    if (data.customer_id) {
      const cr = await db.getFirstAsync<{ uuid: string }>(`SELECT uuid FROM customers WHERE id = ?`, [data.customer_id]);
      customerUuid = cr?.uuid ?? null;
    }

    await enqueue(db, {
      event_uuid: uuid,
      kind: "sale",
      payload: JSON.stringify({
        kind: "sale", id: uuid, client_created_at: now,
        sale: {
          cylinder_type_id: SERVER_P13_UUID, customer_id: customerUuid,
          quantity: data.quantity, unit_price: data.unit_price.toFixed(2),
          cost_price: data.cost_price.toFixed(2), total: total.toFixed(2),
          payment_method: data.payment_method, is_exchange: data.is_exchange,
        },
      }),
      client_created_at: now,
    });
  });
}

// voidSale substitui deleteSale: seta voided_at, reverte aggregados,
// enfileira void_sale. Sem DELETE físico (histórico preservado).
export async function voidSale(db: SQLiteDatabase, id: number) {
  const sale = await db.getFirstAsync<Sale & { uuid: string }>(
    `SELECT * FROM sales WHERE id = ? AND voided_at IS NULL`, [id]
  );
  if (!sale) return; // já anulada ou não existe

  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE sales SET voided_at = datetime('now') WHERE id = ?`, [id]);

    await db.runAsync(
      `UPDATE inventory SET full_qty = full_qty + ?, empty_qty = MAX(0, empty_qty - ?)
       WHERE cylinder_type_id = ?`,
      [sale.quantity, sale.is_exchange ? sale.quantity : 0, sale.cylinder_type_id]
    );

    if (sale.payment_method === "fiado" && sale.customer_id) {
      await db.runAsync(`UPDATE customers SET balance = balance + ? WHERE id = ?`, [sale.total, sale.customer_id]);
    }

    await enqueue(db, {
      event_uuid: randomUUID(),
      kind: "void_sale",
      payload: JSON.stringify({ id: sale.uuid }),
      client_created_at: new Date().toISOString(),
    });
  });
}

export async function getSales(db: SQLiteDatabase, limit = 50): Promise<Sale[]> {
  return db.getAllAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.voided_at IS NULL
     ORDER BY s.created_at DESC LIMIT ?`,
    [limit]
  );
}

export async function getTodaySales(db: SQLiteDatabase): Promise<Sale[]> {
  return db.getAllAsync<Sale>(
    `SELECT s.*, c.name as customer_name, ct.name as cylinder_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE date(s.created_at) = date('now', 'localtime') AND s.voided_at IS NULL
     ORDER BY s.created_at DESC`
  );
}

export async function getDashboardStats(db: SQLiteDatabase): Promise<DashboardStats> {
  const result = await db.getFirstAsync<DashboardStats>(`
    SELECT
      COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN total ELSE 0 END), 0) as today_revenue,
      COALESCE(SUM(CASE WHEN date(created_at) = date('now', 'localtime') THEN quantity ELSE 0 END), 0) as today_sales,
      COALESCE(SUM(CASE WHEN created_at >= date('now', 'localtime', '-6 days') THEN total ELSE 0 END), 0) as week_revenue,
      COALESCE(SUM(CASE WHEN created_at >= date('now', 'localtime', '-6 days') THEN quantity ELSE 0 END), 0) as week_sales,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') THEN total ELSE 0 END), 0) as month_revenue,
      COALESCE(SUM(CASE WHEN strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime') THEN quantity ELSE 0 END), 0) as month_sales
    FROM sales WHERE voided_at IS NULL
  `);
  return result ?? { today_revenue: 0, today_sales: 0, week_revenue: 0, week_sales: 0, month_revenue: 0, month_sales: 0 };
}

export async function getReportByPeriod(db: SQLiteDatabase, from: string, to: string) {
  return db.getAllAsync(
    `SELECT ct.name as cylinder_name, SUM(s.quantity) as total_qty, SUM(s.total) as total_revenue,
            SUM(s.quantity * s.cost_price) as total_cost,
            SUM(s.total) - SUM(s.quantity * s.cost_price) as total_profit,
            s.payment_method, COUNT(*) as num_sales
     FROM sales s JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE date(s.created_at) BETWEEN ? AND ? AND s.voided_at IS NULL
     GROUP BY ct.id, s.payment_method ORDER BY total_revenue DESC`,
    [from, to]
  );
}

export async function getCustomerSales(db: SQLiteDatabase, customer_id: number) {
  return db.getAllAsync(
    `SELECT s.*, ct.name as cylinder_name FROM sales s
     JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.customer_id = ? AND s.voided_at IS NULL ORDER BY s.created_at DESC`,
    [customer_id]
  );
}
```

**Atenção:** qualquer tela que chama `deleteSale` deve ser atualizada para `voidSale`. Procure com grep:
```powershell
grep -r "deleteSale" C:\Users\PC\Documents\gas-manager\app --include="*.tsx" --include="*.ts"
```
Atualize as importações e chamadas nas telas encontradas.

- [ ] **Step 4: Confirmar que os testes passam**

```powershell
npx jest db/__tests__/sales.sync.test.ts -v
```

- [ ] **Step 5: Rodar suíte completa**

```powershell
npx jest --runInBand
# Expected: all PASS
```

- [ ] **Step 6: Commit**

```powershell
git add db/queries/sales.ts db/__tests__/sales.sync.test.ts app/
git commit -m "feat(app): vendas geram evento de sync (uuid + outbox); cancelamento vira void local"
```

---

## Task B6: Wire — mutations de estoque e preços

**Files:**
- Modify: `db/queries/inventory.ts`
- Create: `db/__tests__/inventory.sync.test.ts`

- [ ] **Step 1: Escrever os testes**

Crie `db/__tests__/inventory.sync.test.ts`:
```typescript
import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { addRestock, updateInventory, updateCylinderPrice } from "@/db/queries/inventory";
import { SERVER_P13_UUID } from "@/lib/sync/constants";

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}
async function getP13Id(db: any) {
  return (await db.getFirstAsync<{id:number}>(`SELECT id FROM cylinder_types WHERE name='P13' LIMIT 1`))!.id;
}

describe("addRestock", () => {
  it("gera uuid e enfileira evento restock", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await addRestock(db, { cylinder_type_id: cid, quantity: 10, cost_per_unit: 90 });

    const row = await db.getFirstAsync<{uuid:string}>(`SELECT uuid FROM restocks LIMIT 1`);
    expect(row?.uuid).toBeTruthy();

    const outbox = await db.getFirstAsync<{kind:string;payload:string}>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("restock");
    const p = JSON.parse(outbox!.payload);
    expect(p.restock.cylinder_type_id).toBe(SERVER_P13_UUID);
    expect(p.restock.cost_per_unit).toBe("90.00");
  });
});

describe("updateInventory", () => {
  it("enfileira stock_adjustment somente para campos alterados", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await db.runAsync(`UPDATE inventory SET full_qty=5, empty_qty=3 WHERE cylinder_type_id=?`, [cid]);

    await updateInventory(db, cid, 8, 3); // full muda, empty igual

    const rows = await db.getAllAsync<{kind:string;payload:string}>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    const adjRows = rows.filter(r => r.kind === 'stock_adjustment');
    expect(adjRows).toHaveLength(1); // só full mudou
    const p = JSON.parse(adjRows[0].payload);
    expect(p.stock_adjustment.field).toBe("full");
    expect(p.stock_adjustment.delta).toBe(3); // 8 - 5 = +3
  });
});

describe("updateCylinderPrice", () => {
  it("enfileira cylinder_upsert com updated_at", async () => {
    const db = await freshDb();
    const cid = await getP13Id(db);
    await updateCylinderPrice(db, cid, 135, 100);

    const outbox = await db.getFirstAsync<{kind:string;payload:string}>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("cylinder_upsert");
    const p = JSON.parse(outbox!.payload);
    expect(p.id).toBe(SERVER_P13_UUID);
    expect(p.sale_price).toBe("135.00");
    expect(p.updated_at).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```powershell
npx jest db/__tests__/inventory.sync.test.ts -v
# Expected: FAIL
```

- [ ] **Step 3: Reescrever `db/queries/inventory.ts`**

```typescript
import { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueue } from "@/lib/sync/outbox";
import { SERVER_P13_UUID } from "@/lib/sync/constants";
import { CylinderType, Inventory, Restock } from "@/types";

export async function getInventory(db: SQLiteDatabase): Promise<Inventory[]> {
  return db.getAllAsync<Inventory>(
    `SELECT i.*, ct.name as cylinder_name FROM inventory i
     JOIN cylinder_types ct ON i.cylinder_type_id = ct.id
     WHERE ct.active = 1 ORDER BY ct.weight_kg ASC`
  );
}

export async function getCylinderTypes(db: SQLiteDatabase): Promise<CylinderType[]> {
  return db.getAllAsync<CylinderType>(`SELECT * FROM cylinder_types WHERE active = 1 ORDER BY weight_kg ASC`);
}

export async function addRestock(db: SQLiteDatabase, data: { cylinder_type_id: number; quantity: number; cost_per_unit: number; notes?: string }) {
  const total_cost = data.quantity * data.cost_per_unit;
  const uuid = randomUUID();
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO restocks (uuid, cylinder_type_id, quantity, cost_per_unit, total_cost, notes) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid, data.cylinder_type_id, data.quantity, data.cost_per_unit, total_cost, data.notes ?? null]
    );
    await db.runAsync(`UPDATE inventory SET full_qty = full_qty + ? WHERE cylinder_type_id = ?`, [data.quantity, data.cylinder_type_id]);
    await enqueue(db, {
      event_uuid: uuid, kind: "restock",
      payload: JSON.stringify({
        kind: "restock", id: uuid, client_created_at: now,
        restock: { cylinder_type_id: SERVER_P13_UUID, quantity: data.quantity,
                   cost_per_unit: data.cost_per_unit.toFixed(2), total_cost: total_cost.toFixed(2),
                   notes: data.notes ?? null },
      }),
      client_created_at: now,
    });
  });
}

export async function updateInventory(db: SQLiteDatabase, cylinder_type_id: number, full_qty: number, empty_qty: number) {
  const cur = await db.getFirstAsync<{ full_qty: number; empty_qty: number }>(
    `SELECT full_qty, empty_qty FROM inventory WHERE cylinder_type_id = ?`, [cylinder_type_id]
  );
  if (!cur) return;
  const now = new Date().toISOString();

  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE inventory SET full_qty = ?, empty_qty = ? WHERE cylinder_type_id = ?`, [full_qty, empty_qty, cylinder_type_id]);
    if (full_qty !== cur.full_qty) {
      const uuid = randomUUID();
      await enqueue(db, {
        event_uuid: uuid, kind: "stock_adjustment",
        payload: JSON.stringify({
          kind: "stock_adjustment", id: uuid, client_created_at: now,
          stock_adjustment: { cylinder_type_id: SERVER_P13_UUID, field: "full", delta: full_qty - cur.full_qty, reason: null },
        }),
        client_created_at: now,
      });
    }
    if (empty_qty !== cur.empty_qty) {
      const uuid = randomUUID();
      await enqueue(db, {
        event_uuid: uuid, kind: "stock_adjustment",
        payload: JSON.stringify({
          kind: "stock_adjustment", id: uuid, client_created_at: now,
          stock_adjustment: { cylinder_type_id: SERVER_P13_UUID, field: "empty", delta: empty_qty - cur.empty_qty, reason: null },
        }),
        client_created_at: now,
      });
    }
  });
}

export async function updateCylinderPrice(db: SQLiteDatabase, id: number, sale_price: number, cost_price: number) {
  const now = new Date().toISOString();
  const uuid = randomUUID();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cylinder_types SET sale_price = ?, cost_price = ?, updated_at = ? WHERE id = ?`,
      [sale_price, cost_price, now, id]
    );
    await enqueue(db, {
      event_uuid: uuid, kind: "cylinder_upsert",
      payload: JSON.stringify({
        id: SERVER_P13_UUID, sale_price: sale_price.toFixed(2),
        cost_price: cost_price.toFixed(2), active: true, updated_at: now,
      }),
      client_created_at: now,
    });
  });
}

export async function getRestocks(db: SQLiteDatabase): Promise<Restock[]> {
  return db.getAllAsync<Restock>(
    `SELECT r.*, ct.name as cylinder_name FROM restocks r
     JOIN cylinder_types ct ON r.cylinder_type_id = ct.id ORDER BY r.created_at DESC LIMIT 30`
  );
}
```

- [ ] **Step 4: Confirmar que os testes passam e rodar suíte**

```powershell
npx jest db/__tests__/inventory.sync.test.ts -v
npx jest --runInBand
```

- [ ] **Step 5: Commit**

```powershell
git add db/queries/inventory.ts db/__tests__/inventory.sync.test.ts
git commit -m "feat(app): restock/ajuste de estoque/preco geram eventos de sync"
```

---

## Task B7: Wire — mutations de clientes e quitação de fiado

**Files:**
- Modify: `db/queries/customers.ts`
- Create: `db/__tests__/customers.sync.test.ts`

- [ ] **Step 1: Escrever os testes**

Crie `db/__tests__/customers.sync.test.ts`:
```typescript
import { initDatabase } from "@/db/database";
import { createTestDb } from "@/db/__tests__/helpers/testdb";
import { addCustomer, updateCustomer, deleteCustomer, settleCustomerDebt } from "@/db/queries/customers";

async function freshDb() {
  const db = createTestDb();
  await initDatabase(db);
  return db;
}

describe("addCustomer", () => {
  it("gera uuid e enfileira customer_upsert", async () => {
    const db = await freshDb();
    await addCustomer(db, { name: "Maria", phone: "11999" });
    const cust = await db.getFirstAsync<{ uuid: string }>(`SELECT uuid FROM customers LIMIT 1`);
    expect(cust?.uuid).toBeTruthy();
    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("customer_upsert");
    const p = JSON.parse(outbox!.payload);
    expect(p.id).toBe(cust?.uuid);
    expect(p.name).toBe("Maria");
  });
});

describe("updateCustomer", () => {
  it("bumpa updated_at e enfileira customer_upsert", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "João" });
    await db.runAsync(`UPDATE sync_outbox SET status='done'`); // limpa
    await updateCustomer(db, id, { name: "João Atualizado" });
    const outbox = await db.getFirstAsync<{ kind: string }>(`SELECT kind FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("customer_upsert");
  });
});

describe("deleteCustomer", () => {
  it("enfileira customer_delete (physical delete local)", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "A Deletar" });
    await db.runAsync(`UPDATE sync_outbox SET status='done'`);
    await deleteCustomer(db, id);
    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("customer_delete");
    const p = JSON.parse(outbox!.payload);
    expect(p.id).toBeTruthy();
  });
});

describe("settleCustomerDebt", () => {
  it("enfileira debt_settlement com customer_id (uuid) e amount string", async () => {
    const db = await freshDb();
    const id = await addCustomer(db, { name: "Fiado" });
    await db.runAsync(`UPDATE customers SET balance = -200 WHERE id = ?`, [id]);
    await db.runAsync(`UPDATE sync_outbox SET status='done'`);
    await settleCustomerDebt(db, id, 100);
    const outbox = await db.getFirstAsync<{ kind: string; payload: string }>(`SELECT kind, payload FROM sync_outbox WHERE status='pending'`);
    expect(outbox?.kind).toBe("debt_settlement");
    const p = JSON.parse(outbox!.payload);
    expect(p.debt_settlement.amount).toBe("100.00");
    expect(p.debt_settlement.customer_id).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

```powershell
npx jest db/__tests__/customers.sync.test.ts -v
# Expected: FAIL
```

- [ ] **Step 3: Reescrever `db/queries/customers.ts`**

```typescript
import { SQLiteDatabase } from "expo-sqlite";
import { randomUUID } from "expo-crypto";
import { enqueue } from "@/lib/sync/outbox";
import { Customer } from "@/types";

export async function getCustomers(db: SQLiteDatabase): Promise<Customer[]> {
  return db.getAllAsync<Customer>(`SELECT * FROM customers ORDER BY name ASC`);
}

export async function getCustomerById(db: SQLiteDatabase, id: number): Promise<Customer | null> {
  return db.getFirstAsync<Customer>(`SELECT * FROM customers WHERE id = ?`, [id]);
}

export async function addCustomer(db: SQLiteDatabase, data: { name: string; phone?: string; address?: string }): Promise<number> {
  const uuid = randomUUID();
  const now = new Date().toISOString();
  let localId = 0;

  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      `INSERT INTO customers (name, phone, address, uuid, updated_at) VALUES (?, ?, ?, ?, ?)`,
      [data.name, data.phone ?? null, data.address ?? null, uuid, now]
    );
    localId = r.lastInsertRowId;
    await enqueue(db, {
      event_uuid: randomUUID(), kind: "customer_upsert",
      payload: JSON.stringify({ id: uuid, name: data.name, phone: data.phone ?? null,
                                address: data.address ?? null, credit_limit: null, updated_at: now }),
      client_created_at: now,
    });
  });
  return localId;
}

export async function updateCustomer(db: SQLiteDatabase, id: number, data: { name: string; phone?: string; address?: string }) {
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE customers SET name = ?, phone = ?, address = ?, updated_at = ? WHERE id = ?`,
      [data.name, data.phone ?? null, data.address ?? null, now, id]
    );
    const r = await db.getFirstAsync<{ uuid: string }>(`SELECT uuid FROM customers WHERE id = ?`, [id]);
    await enqueue(db, {
      event_uuid: randomUUID(), kind: "customer_upsert",
      payload: JSON.stringify({ id: r!.uuid, name: data.name, phone: data.phone ?? null,
                                address: data.address ?? null, credit_limit: null, updated_at: now }),
      client_created_at: now,
    });
  });
}

export async function deleteCustomer(db: SQLiteDatabase, id: number) {
  const customer = await db.getFirstAsync<Customer>(`SELECT * FROM customers WHERE id = ?`, [id]);
  if (!customer) return;
  if ((customer as any).balance < 0) {
    throw new Error("Não é possível excluir um cliente com saldo devedor pendente. Quite o débito antes de excluir.");
  }
  const now = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE sales SET customer_id = NULL WHERE customer_id = ?`, [id]);
    await db.runAsync(`DELETE FROM customers WHERE id = ?`, [id]);
    await enqueue(db, {
      event_uuid: randomUUID(), kind: "customer_delete",
      payload: JSON.stringify({ id: (customer as any).uuid }),
      client_created_at: now,
    });
  });
}

export async function settleCustomerDebt(db: SQLiteDatabase, id: number, amount: number) {
  const now = new Date().toISOString();
  const uuid = randomUUID();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE customers SET balance = balance + ? WHERE id = ?`, [amount, id]);
    const r = await db.getFirstAsync<{ uuid: string }>(`SELECT uuid FROM customers WHERE id = ?`, [id]);
    await enqueue(db, {
      event_uuid: uuid, kind: "debt_settlement",
      payload: JSON.stringify({
        kind: "debt_settlement", id: uuid, client_created_at: now,
        debt_settlement: { customer_id: r!.uuid, amount: amount.toFixed(2), payment_method: "pix" },
      }),
      client_created_at: now,
    });
  });
}

export async function getDebtors(db: SQLiteDatabase): Promise<Customer[]> {
  return db.getAllAsync<Customer>(`SELECT * FROM customers WHERE balance < 0 ORDER BY balance ASC`);
}

export async function getCustomerSales(db: SQLiteDatabase, customer_id: number) {
  return db.getAllAsync(
    `SELECT s.*, ct.name as cylinder_name FROM sales s JOIN cylinder_types ct ON s.cylinder_type_id = ct.id
     WHERE s.customer_id = ? AND s.voided_at IS NULL ORDER BY s.created_at DESC`,
    [customer_id]
  );
}
```

**Nota sobre `settleCustomerDebt`:** o `payment_method` está hardcoded como `"pix"`. Se a tela de quitação já tem um seletor de método, passe-o como parâmetro aqui. Ajuste a assinatura da função e os chamadores conforme necessário.

- [ ] **Step 4: Confirmar que os testes passam e rodar suíte**

```powershell
npx jest db/__tests__/customers.sync.test.ts -v
npx jest --runInBand
# Expected: all PASS
```

- [ ] **Step 5: Commit**

```powershell
git add db/queries/customers.ts db/__tests__/customers.sync.test.ts
git commit -m "feat(app): clientes e quitacao de fiado geram eventos de sync"
```

---

## Task B8: Tela de login + gate de autenticação

**Files:**
- Create: `app/login.tsx`
- Modify: `app/_layout.tsx`

- [ ] **Step 1: Criar `app/login.tsx`**

```tsx
import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, KeyboardAvoidingView, Platform } from "react-native";
import { router } from "expo-router";
import { signIn } from "@/lib/auth";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError("");
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e: any) {
      setError(e.message ?? "Erro ao entrar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <View className="flex-1 items-center justify-center px-8 gap-4">
        <Text className="text-3xl font-bold text-orange-500 mb-4">GasManager</Text>

        <TextInput
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base"
          placeholder="E-mail"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />

        <TextInput
          className="w-full border border-gray-300 rounded-xl px-4 py-3 text-base"
          placeholder="Senha"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text className="text-red-500 text-sm text-center">{error}</Text> : null}

        <TouchableOpacity
          className="w-full bg-orange-500 rounded-xl py-4 items-center"
          onPress={handleLogin}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white text-base font-bold">Entrar</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 2: Atualizar `app/_layout.tsx` com o gate de auth e start/stop do engine**

```tsx
import "../global.css";
import { Stack, router } from "expo-router";
import { SQLiteProvider, useSQLiteContext } from "expo-sqlite";
import { Suspense, useEffect, useRef } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { initDatabase } from "@/db/database";
import { onAuthChange } from "@/lib/auth";
import { SyncEngine } from "@/lib/sync/engine";

function AuthGate({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    const unsub = onAuthChange((user) => {
      if (user === null) {
        engineRef.current?.stop();
        engineRef.current = null;
        router.replace("/login");
      } else {
        if (!engineRef.current) {
          const engine = new SyncEngine(db);
          engineRef.current = engine;
          engine.start();
        }
        router.replace("/(tabs)");
      }
    });
    return () => {
      unsub();
      engineRef.current?.stop();
    };
  }, [db]);

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Suspense
        fallback={
          <View className="flex-1 items-center justify-center bg-white">
            <ActivityIndicator size="large" color="#f97316" />
          </View>
        }
      >
        <SQLiteProvider databaseName="gas-manager-v2.db" onInit={initDatabase} useSuspense>
          <AuthGate>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="login" />
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="sale-form" options={{ headerShown: true, title: "Nova Venda", presentation: "modal" }} />
              <Stack.Screen name="restock-form" options={{ headerShown: true, title: "Entrada de Estoque", presentation: "modal" }} />
              <Stack.Screen name="customer-form" options={{ headerShown: true, title: "Cliente", presentation: "modal" }} />
              <Stack.Screen name="settle-debt" options={{ headerShown: true, title: "Registrar Pagamento", presentation: "modal" }} />
              <Stack.Screen name="customer-detail" options={{ headerShown: true, title: "Cliente", headerStyle: { backgroundColor: "#f97316" }, headerTintColor: "#ffffff", headerTitleStyle: { fontWeight: "700" } }} />
            </Stack>
          </AuthGate>
        </SQLiteProvider>
      </Suspense>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 3: Verificar TypeScript**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
# Expected: zero erros novos (os 6 pré-existentes em components/ podem permanecer)
```

- [ ] **Step 4: Verificar manualmente no celular**

Boot a frio → tela de login aparece. Login com credencial válida → vai para tabs. Matar o app e reabrir → continua logado (persistência). Fazer logout (implementado no próximo task) → volta para login.

- [ ] **Step 5: Commit**

```powershell
git add app/login.tsx app/_layout.tsx
git commit -m "feat(app): tela de login e gate de autenticacao Firebase"
```

---

## Task B9: SyncBadge + botão de logout

**Files:**
- Create: `components/SyncBadge.tsx`
- Modify: `app/(tabs)/_layout.tsx`

- [ ] **Step 1: Criar `components/SyncBadge.tsx`**

```tsx
import { TouchableOpacity, Text, View } from "react-native";
import { useSyncStore } from "@/store/sync";

export function SyncBadge({ onLogout }: { onLogout: () => void }) {
  const { status, pendingCount, lastSyncedAt, online } = useSyncStore();

  let label = "Sincronizado";
  let color = "bg-green-100 text-green-800";

  if (!online) {
    label = "Offline";
    color = "bg-gray-100 text-gray-600";
  } else if (pendingCount > 0) {
    label = `${pendingCount} pendente${pendingCount > 1 ? "s" : ""}`;
    color = "bg-yellow-100 text-yellow-800";
  } else if (status === "syncing") {
    label = "Sincronizando…";
    color = "bg-blue-100 text-blue-800";
  } else if (status === "error") {
    label = "Erro de sync";
    color = "bg-red-100 text-red-800";
  }

  return (
    <View className="flex-row items-center gap-2 pr-2">
      <View className={`px-2 py-0.5 rounded-full ${color}`}>
        <Text className={`text-xs font-semibold ${color.split(" ")[1]}`}>{label}</Text>
      </View>
      <TouchableOpacity onPress={onLogout}>
        <Text className="text-white text-xs">Sair</Text>
      </TouchableOpacity>
    </View>
  );
}
```

- [ ] **Step 2: Adicionar SyncBadge e logout em `app/(tabs)/_layout.tsx`**

```tsx
import { Tabs, router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SyncBadge } from "@/components/SyncBadge";
import { signOutUser } from "@/lib/auth";

type IoniconsName = React.ComponentProps<typeof Ionicons>["name"];

function TabIcon({ name, color, size }: { name: IoniconsName; color: string | any; size: number }) {
  return <Ionicons name={name} size={size} color={color as string} />;
}

async function handleLogout() {
  await signOutUser();
  router.replace("/login");
}

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#f97316",
        tabBarInactiveTintColor: "#9ca3af",
        tabBarStyle: { backgroundColor: "#ffffff", borderTopColor: "#e5e7eb", paddingBottom: insets.bottom + 8, height: 52 + insets.bottom },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        headerStyle: { backgroundColor: "#f97316" },
        headerTintColor: "#ffffff",
        headerTitleStyle: { fontWeight: "700" },
        headerRight: () => <SyncBadge onLogout={handleLogout} />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Dashboard", tabBarIcon: ({ color, size }) => <TabIcon name="home" color={color} size={size} /> }} />
      <Tabs.Screen name="sales" options={{ title: "Vendas", tabBarIcon: ({ color, size }) => <TabIcon name="cart" color={color} size={size} /> }} />
      <Tabs.Screen name="inventory" options={{ title: "Estoque", tabBarIcon: ({ color, size }) => <TabIcon name="cube" color={color} size={size} /> }} />
      <Tabs.Screen name="customers" options={{ title: "Clientes", tabBarIcon: ({ color, size }) => <TabIcon name="people" color={color} size={size} /> }} />
      <Tabs.Screen name="reports" options={{ title: "Relatórios", tabBarIcon: ({ color, size }) => <TabIcon name="bar-chart" color={color} size={size} /> }} />
    </Tabs>
  );
}
```

- [ ] **Step 3: Verificar TypeScript**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
```

- [ ] **Step 4: Commit**

```powershell
git add components/SyncBadge.tsx app/"(tabs)"/_layout.tsx
git commit -m "feat(app): badge de sync e botao de logout no header"
```

---

## Task C1: Revisão TL+QA + suíte completa + APK

- [ ] **Step 1: Rodar suíte completa mobile**

```powershell
npx jest --runInBand
# Expected: todos os testes passam
```

- [ ] **Step 2: TypeScript limpo**

```powershell
npx tsc --noEmit 2>&1 | Select-String "error"
# Expected: zero erros novos
```

- [ ] **Step 3: Revisão TL+QA** — subagentes revisam o diff completo desta branch.

- [ ] **Step 4: Teste manual de dois dispositivos contra produção**

- Login em dois celulares (contas diferentes).
- Venda no celular A → após sync, aparece no B.
- Cancelar a venda no A → cancelamento aparece no B.
- Restock no B → refletido no A.
- Adicionar cliente no A → aparece no B.
- Ficar offline no A, fazer 3 vendas, reconectar → todas sobem e aparecem no B.

- [ ] **Step 5: Trocar senhas dos 3 usuários Firebase para senhas fortes**

No Firebase Console → Authentication → Users → redefinir senha de cada um.

- [ ] **Step 6: Build APK via EAS**

```powershell
eas build -p android --profile preview
# Aguardar conclusão; copiar o link do APK
```

- [ ] **Step 7: Instalar e testar o APK no celular físico**

Instalar via link do EAS e repetir o fluxo básico: login, venda, cancelamento, restock.

- [ ] **Step 8: Merge e changelog**

```powershell
git tag v0.6.0
git push origin feat/backend --tags
# Abrir PR feat/backend → main, squash merge
```

Gerar changelog via `/changelog`.

---

## Self-review

**Cobertura do spec:**
- Gap 2 (void no pull): Tasks A1 ✅
- Gap 3 (catálogo no pull): Task A2 ✅
- Redeploy: Task A3 ✅
- Schema v3 + apply.ts smells: Task B1 ✅
- Push loop + backoff + re-auth: Task B2 ✅
- Pull loop + cursor durável + duas passadas: Task B3 ✅
- Orquestração + conectividade: Task B4 ✅
- Outbox wiring (todas as mutações): Tasks B5/B6/B7 ✅
- Login UI + auth gate: Task B8 ✅
- SyncBadge + logout: Task B9 ✅
- APK: Task C1 ✅

**Riscos/armadilhas:**
- `settleCustomerDebt` hardcoded `payment_method: "pix"` — ajustar se a tela já tem seletor.
- `useSQLiteContext()` em `AuthGate` requer que o componente esteja **dentro** do `SQLiteProvider` — a estrutura do `_layout.tsx` já garante isso.
- O `engine.start()` não atualiza o zustand com `pendingCount` nesta versão — adicionar chamadas a `useSyncStore.getState().setPendingCount(await pendingCount(db))` no `pushOnce` e `pullAll` se quiser o badge funcionando em tempo real.
- Testes backend usam `testutil.*` — os helpers existem em `backend/internal/testutil/`; confirme antes de rodar se `EnsureCylinderType` e `PushSale` existem, ou adapte os testes ao helper existente.
- A `catalog_events` usa `data TEXT` (não JSONB) para evitar problemas de mapeamento sqlc. O Pull deserializa com `json.Unmarshal` e re-serializa via `json.RawMessage` para passar como objeto no response — correto.
