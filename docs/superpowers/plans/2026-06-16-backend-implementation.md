# Backend gas-manager — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the offline-first sync backend for gas-manager — a Go + Postgres API on Cloud Run implementing the ledger pattern (append-only fact tables + atomically-incremented aggregates), Firebase-validated auth, idempotent push / cursor-paginated pull, catalog CRUD, alerts, data migration, and deploy.

**Architecture:** Ledger pattern. Fact tables (`sales`, `restocks`, `stock_adjustments`, `debt_settlements`) are append-only with client-generated UUIDs; the same DB transaction that inserts a fact atomically increments its aggregate (`inventory.full_qty`/`empty_qty`, `customers.balance`). Pull pagination uses a strictly-monotonic `BIGSERIAL sequence`, not wall-clock. Auth is a Firebase ID-token middleware. See spec: `docs/superpowers/specs/2026-06-16-backend-design.md`.

**Tech Stack:** Go 1.25, chi (router), pgx v5 (Postgres driver), sqlc (type-safe queries from SQL), golang-migrate (versioned migrations), Firebase Admin SDK for Go (token verification), testcontainers-go (integration tests against real Postgres), Docker, Cloud Run + Cloud SQL (`southamerica-east1`, project `gas-manager-499616`).

**Module path:** `github.com/pedrogomesdev/gas-manager-backend` (backend lives in `backend/` subdir of the existing repo as its own Go module).

---

## File Structure

```
backend/
  go.mod  go.sum
  sqlc.yaml                         # sqlc codegen config
  docker-compose.yml                # local Postgres for dev + tests
  Dockerfile                        # Cloud Run image
  .env.example                      # documents required env vars
  Makefile                          # common dev commands
  cmd/server/main.go                # wires config, db pool, router, starts HTTP
  internal/
    config/config.go                # env → typed Config
    httpx/respond.go                # JSON helpers + error envelope
    db/
      pool.go                       # pgxpool construction (Cloud SQL unix socket aware)
      migrations/                   # golang-migrate SQL files
        0001_init.up.sql
        0001_init.down.sql
      queries/                      # sqlc source SQL
        events.sql
        catalog.sql
        alerts.sql
      gen/                          # sqlc-GENERATED Go (do not edit by hand)
    auth/
      verifier.go                   # Firebase token verifier interface + real impl
      middleware.go                 # chi middleware: verify token, load user, grace window
    sync/
      types.go                      # PushEvent, PushResult, PullResponse DTOs
      payload_hash.go               # canonical hash of an event payload (UUID-collision guard)
      push.go                       # POST /sync/push handler + per-event tx logic
      pull.go                       # GET /sync/pull handler + cursor
    catalog/
      handlers.go                   # customers + cylinder_types CRUD (last-write-wins)
    alerts/
      handlers.go                   # GET /alerts/negative-stock, /alerts/over-limit-balance, /sync/errors
  migration/                        # one-off DATA migration tooling (separate from db/migrations)
    snapshot/main.go                # read a phone's SQLite export → baseline events JSON
    reconcile/main.go               # compare local sums vs server sums; 100%-match gate
    testdata/                       # SQLite fixtures incl. known DELETE-physical holes
```

**Responsibility split:** `sync/` owns the ledger write/read logic (the hard part). `catalog/` is plain mutable CRUD and must never touch aggregates. `auth/` is isolated behind an interface so handlers test without real Firebase. `migration/` is throwaway tooling that never imports server internals beyond DTOs.

---

## Conventions for every task

- **TDD:** failing test first, watch it fail, minimal code, watch it pass, commit.
- **Run commands from `backend/`** unless stated. Integration tests need Docker running.
- **Commit messages** in Portuguese, `feat:`/`test:`/`chore:` prefixes, ending with the Co-Authored-By trailer the repo uses.
- **`server_received_at` and `sequence` are server-assigned** — never trust client values for them.

---

## Phase 0 — Project setup

### Task 0.1: Initialize Go module and directory skeleton

**Files:**
- Create: `backend/go.mod`
- Create: `backend/.gitignore`

- [ ] **Step 1: Create module**

Run from repo root:
```bash
mkdir -p backend && cd backend
go mod init github.com/pedrogomesdev/gas-manager-backend
go get github.com/go-chi/chi/v5@latest
go get github.com/jackc/pgx/v5@latest
go get github.com/jackc/pgx/v5/pgxpool@latest
```

- [ ] **Step 2: Add backend/.gitignore**

```
# build
/server
/bin/
# env
.env
# go
*.out
```

- [ ] **Step 3: Verify module builds**

Run: `go build ./...`
Expected: no output, exit 0 (no packages yet is fine).

- [ ] **Step 4: Commit**

```bash
git add backend/go.mod backend/go.sum backend/.gitignore
git commit -m "chore(backend): inicializar modulo Go + chi + pgx"
```

### Task 0.2: Local Postgres via docker-compose

**Files:**
- Create: `backend/docker-compose.yml`
- Create: `backend/.env.example`

- [ ] **Step 1: Write docker-compose.yml**

```yaml
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_USER: gas
      POSTGRES_PASSWORD: gas
      POSTGRES_DB: gas
    ports:
      - "5433:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- [ ] **Step 2: Write .env.example**

```
# Local dev DB (docker-compose). Cloud Run uses the unix-socket form instead.
DATABASE_URL=postgres://gas:gas@localhost:5433/gas?sslmode=disable
PORT=8080
# Firebase project that issues the ID tokens the app sends.
FIREBASE_PROJECT_ID=gas-manager-499616
# Path to the Firebase Admin service-account JSON (Secret Manager mounts it here in prod).
GOOGLE_APPLICATION_CREDENTIALS=./firebase-sa.json
```

- [ ] **Step 3: Start DB and verify**

Run: `docker compose up -d && docker compose exec db pg_isready -U gas`
Expected: `... accepting connections`

- [ ] **Step 4: Commit**

```bash
git add backend/docker-compose.yml backend/.env.example
git commit -m "chore(backend): postgres local via docker-compose"
```

### Task 0.3: Config loader (TDD)

**Files:**
- Create: `backend/internal/config/config.go`
- Test: `backend/internal/config/config_test.go`

- [ ] **Step 1: Write the failing test**

```go
package config

import "testing"

func TestLoad_RequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("expected error when DATABASE_URL is empty")
	}
}

func TestLoad_DefaultsPort(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("FIREBASE_PROJECT_ID", "p")
	t.Setenv("PORT", "")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.Port != "8080" {
		t.Fatalf("want default port 8080, got %q", cfg.Port)
	}
}
```

- [ ] **Step 2: Run test, verify it fails**

Run: `go test ./internal/config/...`
Expected: FAIL — `undefined: Load`.

- [ ] **Step 3: Implement config.go**

```go
package config

import (
	"errors"
	"os"
)

type Config struct {
	DatabaseURL       string
	Port              string
	FirebaseProjectID string
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		Port:              os.Getenv("PORT"),
		FirebaseProjectID: os.Getenv("FIREBASE_PROJECT_ID"),
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}
	if cfg.FirebaseProjectID == "" {
		return Config{}, errors.New("FIREBASE_PROJECT_ID is required")
	}
	if cfg.Port == "" {
		cfg.Port = "8080"
	}
	return cfg, nil
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `go test ./internal/config/...`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/config/
git commit -m "feat(backend): config loader a partir de env"
```

---

## Phase 1 — Database schema (migrations)

### Task 1.1: Install migrate CLI and write the init migration

**Files:**
- Create: `backend/internal/db/migrations/0001_init.up.sql`
- Create: `backend/internal/db/migrations/0001_init.down.sql`

- [ ] **Step 1: Install golang-migrate CLI**

```bash
go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@latest
```
Expected: `migrate` on PATH (`migrate -version`).

- [ ] **Step 2: Write 0001_init.up.sql**

```sql
-- Aggregates are mutable; fact tables are append-only.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,            -- Firebase UID
  name            TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','employee')),
  active          BOOLEAN NOT NULL DEFAULT true,
  deactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cylinder_types (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  weight_kg   INT NOT NULL,
  sale_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  credit_limit  NUMERIC(12,2),
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0,   -- aggregate, ledger-only
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),  -- catalog LWW tiebreaker
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory (
  id                UUID PRIMARY KEY,
  cylinder_type_id  UUID NOT NULL UNIQUE REFERENCES cylinder_types(id),
  full_qty          INT NOT NULL DEFAULT 0,   -- aggregate, may go negative
  empty_qty         INT NOT NULL DEFAULT 0    -- aggregate
);

CREATE TABLE sales (
  id                 UUID PRIMARY KEY,                 -- client-generated
  customer_id        UUID REFERENCES customers(id),    -- NULL = avulsa / unlinked
  cylinder_type_id   UUID NOT NULL REFERENCES cylinder_types(id),
  quantity           INT NOT NULL,
  unit_price         NUMERIC(12,2) NOT NULL,
  cost_price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total              NUMERIC(12,2) NOT NULL,
  payment_method     TEXT NOT NULL,
  is_exchange        BOOLEAN NOT NULL DEFAULT false,
  payload_hash       TEXT NOT NULL,                    -- UUID-collision guard
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL,
  voided_at          TIMESTAMPTZ,
  voided_by          TEXT REFERENCES users(id)
);

CREATE TABLE restocks (
  id                 UUID PRIMARY KEY,
  cylinder_type_id   UUID NOT NULL REFERENCES cylinder_types(id),
  quantity           INT NOT NULL,
  cost_per_unit      NUMERIC(12,2) NOT NULL,
  total_cost         NUMERIC(12,2) NOT NULL,
  notes              TEXT,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

CREATE TABLE stock_adjustments (
  id                 UUID PRIMARY KEY,
  cylinder_type_id   UUID NOT NULL REFERENCES cylinder_types(id),
  field              TEXT NOT NULL CHECK (field IN ('full','empty')),
  delta              INT NOT NULL,                     -- may be negative
  reason             TEXT,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

CREATE TABLE debt_settlements (
  id                 UUID PRIMARY KEY,
  customer_id        UUID NOT NULL REFERENCES customers(id),
  amount             NUMERIC(12,2) NOT NULL,
  payment_method     TEXT NOT NULL,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

-- Pull cursor: unified stream is ordered by per-table sequence; these indexes back it.
CREATE INDEX idx_sales_seq ON sales(sequence);
CREATE INDEX idx_restocks_seq ON restocks(sequence);
CREATE INDEX idx_stock_adjustments_seq ON stock_adjustments(sequence);
CREATE INDEX idx_debt_settlements_seq ON debt_settlements(sequence);
```

- [ ] **Step 3: Write 0001_init.down.sql**

```sql
DROP TABLE IF EXISTS debt_settlements;
DROP TABLE IF EXISTS stock_adjustments;
DROP TABLE IF EXISTS restocks;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS inventory;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS cylinder_types;
DROP TABLE IF EXISTS users;
```

- [ ] **Step 4: Apply migration against local DB**

Run:
```bash
migrate -path internal/db/migrations -database "postgres://gas:gas@localhost:5433/gas?sslmode=disable" up
```
Expected: `1/u init (...)`. Verify: `docker compose exec db psql -U gas -c '\dt'` lists all 8 tables.

- [ ] **Step 5: Verify down works, then re-up**

Run:
```bash
migrate -path internal/db/migrations -database "postgres://gas:gas@localhost:5433/gas?sslmode=disable" down 1
migrate -path internal/db/migrations -database "postgres://gas:gas@localhost:5433/gas?sslmode=disable" up
```
Expected: clean down then clean up, no errors.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/db/migrations/
git commit -m "feat(backend): schema inicial (ledger + agregados + sequence)"
```

---

## Phase 2 — Data access layer (sqlc)

### Task 2.1: sqlc config + pool

**Files:**
- Create: `backend/sqlc.yaml`
- Create: `backend/internal/db/pool.go`
- Test: `backend/internal/db/pool_test.go`

- [ ] **Step 1: Install sqlc**

```bash
go install github.com/sqlc-dev/sqlc/cmd/sqlc@latest
```

- [ ] **Step 2: Write sqlc.yaml**

```yaml
version: "2"
sql:
  - engine: "postgresql"
    schema: "internal/db/migrations"
    queries: "internal/db/queries"
    gen:
      go:
        package: "gen"
        out: "internal/db/gen"
        sql_package: "pgx/v5"
        emit_pointers_for_null_types: true
```

- [ ] **Step 3: Write pool.go**

```go
package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool builds a small pool (Cloud Run scales horizontally, so per-instance
// connections must stay low to respect Postgres max_connections).
func NewPool(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 5
	cfg.MaxConnIdleTime = 5 * time.Minute
	return pgxpool.NewWithConfig(ctx, cfg)
}
```

- [ ] **Step 4: Write pool_test.go (integration, needs local DB)**

```go
package db

import (
	"context"
	"os"
	"testing"
)

func TestNewPool_Connects(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL to run")
	}
	pool, err := NewPool(context.Background(), url)
	if err != nil {
		t.Fatalf("NewPool: %v", err)
	}
	defer pool.Close()
	if err := pool.Ping(context.Background()); err != nil {
		t.Fatalf("Ping: %v", err)
	}
}
```

- [ ] **Step 5: Run it**

Run: `TEST_DATABASE_URL="postgres://gas:gas@localhost:5433/gas?sslmode=disable" go test ./internal/db/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/sqlc.yaml backend/internal/db/pool.go backend/internal/db/pool_test.go
git commit -m "feat(backend): pgx pool + config sqlc"
```

### Task 2.2: Write event queries and generate

**Files:**
- Create: `backend/internal/db/queries/events.sql`
- Create (generated): `backend/internal/db/gen/*`

- [ ] **Step 1: Write events.sql**

Each insert returns server-assigned fields. Aggregate updates are separate named queries so the push handler can call them in the same tx.

```sql
-- name: GetSaleByID :one
SELECT id, payload_hash FROM sales WHERE id = $1;

-- name: InsertSale :one
INSERT INTO sales (id, customer_id, cylinder_type_id, quantity, unit_price,
  cost_price, total, payment_method, is_exchange, payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING sequence, server_received_at;

-- name: BumpInventoryForSale :exec
UPDATE inventory SET full_qty = full_qty - $2,
  empty_qty = empty_qty + (CASE WHEN $3 THEN $2 ELSE 0 END)
WHERE cylinder_type_id = $1;

-- name: BumpCustomerBalance :exec
UPDATE customers SET balance = balance + $2 WHERE id = $1;

-- name: GetRestockByID :one
SELECT id, payload_hash FROM restocks WHERE id = $1;

-- name: InsertRestock :one
INSERT INTO restocks (id, cylinder_type_id, quantity, cost_per_unit, total_cost,
  notes, payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING sequence, server_received_at;

-- name: BumpInventoryFull :exec
UPDATE inventory SET full_qty = full_qty + $2 WHERE cylinder_type_id = $1;

-- name: GetStockAdjustmentByID :one
SELECT id, payload_hash FROM stock_adjustments WHERE id = $1;

-- name: InsertStockAdjustment :one
INSERT INTO stock_adjustments (id, cylinder_type_id, field, delta, reason,
  payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
RETURNING sequence, server_received_at;

-- name: BumpInventoryField :exec
UPDATE inventory
SET full_qty  = full_qty  + (CASE WHEN $2 = 'full'  THEN $3 ELSE 0 END),
    empty_qty = empty_qty + (CASE WHEN $2 = 'empty' THEN $3 ELSE 0 END)
WHERE cylinder_type_id = $1;

-- name: GetDebtSettlementByID :one
SELECT id, payload_hash FROM debt_settlements WHERE id = $1;

-- name: InsertDebtSettlement :one
INSERT INTO debt_settlements (id, customer_id, amount, payment_method,
  payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)
RETURNING sequence, server_received_at;

-- name: PullSales :many
SELECT id, customer_id, cylinder_type_id, quantity, unit_price, cost_price, total,
  payment_method, is_exchange, voided_at, server_received_at, sequence
FROM sales WHERE sequence > $1 ORDER BY sequence LIMIT $2;

-- name: PullRestocks :many
SELECT id, cylinder_type_id, quantity, cost_per_unit, total_cost, notes,
  server_received_at, sequence
FROM restocks WHERE sequence > $1 ORDER BY sequence LIMIT $2;

-- name: PullStockAdjustments :many
SELECT id, cylinder_type_id, field, delta, reason, server_received_at, sequence
FROM stock_adjustments WHERE sequence > $1 ORDER BY sequence LIMIT $2;

-- name: PullDebtSettlements :many
SELECT id, customer_id, amount, payment_method, server_received_at, sequence
FROM debt_settlements WHERE sequence > $1 ORDER BY sequence LIMIT $2;
```

- [ ] **Step 2: Generate**

Run: `sqlc generate`
Expected: files appear under `internal/db/gen/`, exit 0.

- [ ] **Step 3: Verify it compiles**

Run: `go build ./...`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/db/queries/events.sql backend/internal/db/gen/
git commit -m "feat(backend): queries de eventos (insert + bump agregado + pull) via sqlc"
```

---

## Phase 3 — Auth middleware

### Task 3.1: Token verifier behind an interface (TDD with a fake)

**Files:**
- Create: `backend/internal/auth/verifier.go`
- Create: `backend/internal/auth/middleware.go`
- Test: `backend/internal/auth/middleware_test.go`

- [ ] **Step 1: Add Firebase Admin dep**

```bash
go get firebase.google.com/go/v4@latest
```

- [ ] **Step 2: Write verifier.go**

```go
package auth

import (
	"context"
	"errors"

	firebase "firebase.google.com/go/v4"
	fbauth "firebase.google.com/go/v4/auth"
	"google.golang.org/api/option"
)

// Verifier checks a Firebase ID token and returns the Firebase UID.
type Verifier interface {
	Verify(ctx context.Context, idToken string) (uid string, err error)
}

var ErrInvalidToken = errors.New("invalid firebase token")

type firebaseVerifier struct{ client *fbauth.Client }

func NewFirebaseVerifier(ctx context.Context, projectID, credsFile string) (Verifier, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID},
		option.WithCredentialsFile(credsFile))
	if err != nil {
		return nil, err
	}
	client, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}
	return &firebaseVerifier{client: client}, nil
}

func (v *firebaseVerifier) Verify(ctx context.Context, idToken string) (string, error) {
	tok, err := v.client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return "", ErrInvalidToken
	}
	return tok.UID, nil
}
```

- [ ] **Step 3: Write middleware.go**

The grace window rule: deactivated user within 14 days may only `POST /sync/push`; after 14 days everything is 401.

```go
package auth

import (
	"context"
	"net/http"
	"strings"
	"time"
)

type ctxKey string

const userIDKey ctxKey = "uid"

type UserRow struct {
	ID            string
	Active        bool
	DeactivatedAt *time.Time
}

// UserLoader fetches the app user mapped to a Firebase UID.
type UserLoader interface {
	LoadUser(ctx context.Context, uid string) (UserRow, error)
}

const graceWindow = 14 * 24 * time.Hour

func Middleware(v Verifier, loader UserLoader, now func() time.Time) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if raw == "" {
				http.Error(w, "missing token", http.StatusUnauthorized)
				return
			}
			uid, err := v.Verify(r.Context(), raw)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			user, err := loader.LoadUser(r.Context(), uid)
			if err != nil {
				http.Error(w, "unknown user", http.StatusUnauthorized)
				return
			}
			if !user.Active {
				within := user.DeactivatedAt != nil && now().Sub(*user.DeactivatedAt) < graceWindow
				isPush := r.Method == http.MethodPost && r.URL.Path == "/sync/push"
				if !(within && isPush) {
					http.Error(w, "user deactivated", http.StatusUnauthorized)
					return
				}
			}
			ctx := context.WithValue(r.Context(), userIDKey, user.ID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserID returns the authenticated user id stored by Middleware.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(userIDKey).(string)
	return v
}
```

- [ ] **Step 4: Write middleware_test.go (fakes, no real Firebase)**

```go
package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeVerifier struct{ uid string; err error }
func (f fakeVerifier) Verify(_ context.Context, _ string) (string, error) { return f.uid, f.err }

type fakeLoader struct{ user UserRow; err error }
func (f fakeLoader) LoadUser(_ context.Context, _ string) (UserRow, error) { return f.user, f.err }

func newReq(method, path string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	r.Header.Set("Authorization", "Bearer x")
	return r
}

func run(t *testing.T, v Verifier, l UserLoader, now time.Time, r *http.Request) int {
	t.Helper()
	w := httptest.NewRecorder()
	h := Middleware(v, l, func() time.Time { return now })(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	h.ServeHTTP(w, r)
	return w.Code
}

func TestMiddleware_ActiveUserPasses(t *testing.T) {
	code := run(t, fakeVerifier{uid: "u1"}, fakeLoader{user: UserRow{ID: "u1", Active: true}},
		time.Now(), newReq("GET", "/sync/pull"))
	if code != 200 { t.Fatalf("want 200, got %d", code) }
}

func TestMiddleware_DeactivatedWithinGraceCanPush(t *testing.T) {
	d := time.Now().Add(-2 * 24 * time.Hour)
	code := run(t, fakeVerifier{uid: "u1"},
		fakeLoader{user: UserRow{ID: "u1", Active: false, DeactivatedAt: &d}},
		time.Now(), newReq("POST", "/sync/push"))
	if code != 200 { t.Fatalf("want 200 (grace push), got %d", code) }
}

func TestMiddleware_DeactivatedWithinGraceCannotPull(t *testing.T) {
	d := time.Now().Add(-2 * 24 * time.Hour)
	code := run(t, fakeVerifier{uid: "u1"},
		fakeLoader{user: UserRow{ID: "u1", Active: false, DeactivatedAt: &d}},
		time.Now(), newReq("GET", "/sync/pull"))
	if code != 401 { t.Fatalf("want 401, got %d", code) }
}

func TestMiddleware_DeactivatedAfterGraceBlocksPush(t *testing.T) {
	d := time.Now().Add(-20 * 24 * time.Hour)
	code := run(t, fakeVerifier{uid: "u1"},
		fakeLoader{user: UserRow{ID: "u1", Active: false, DeactivatedAt: &d}},
		time.Now(), newReq("POST", "/sync/push"))
	if code != 401 { t.Fatalf("want 401, got %d", code) }
}

func TestMiddleware_BadTokenIs401(t *testing.T) {
	code := run(t, fakeVerifier{err: ErrInvalidToken}, fakeLoader{},
		time.Now(), newReq("GET", "/sync/pull"))
	if code != 401 { t.Fatalf("want 401, got %d", code) }
}
```

- [ ] **Step 5: Run tests**

Run: `go test ./internal/auth/...`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/auth/
git commit -m "feat(backend): middleware de auth Firebase + janela de carencia 14d"
```

---

## Phase 4 — Sync push (the ledger write)

### Task 4.1: DTOs and payload hash (TDD)

**Files:**
- Create: `backend/internal/sync/types.go`
- Create: `backend/internal/sync/payload_hash.go`
- Test: `backend/internal/sync/payload_hash_test.go`

- [ ] **Step 1: Write types.go**

```go
package sync

import "time"

// PushEvent is one client event in a /sync/push batch. Kind selects the table.
type PushEvent struct {
	Kind            string          `json:"kind"` // sale|restock|stock_adjustment|debt_settlement
	ID              string          `json:"id"`   // client UUID
	ClientCreatedAt time.Time       `json:"client_created_at"`
	Sale            *SalePayload    `json:"sale,omitempty"`
	Restock         *RestockPayload `json:"restock,omitempty"`
	StockAdjustment *StockAdjPayload `json:"stock_adjustment,omitempty"`
	DebtSettlement  *SettlePayload  `json:"debt_settlement,omitempty"`
}

type SalePayload struct {
	CustomerID     *string `json:"customer_id"`
	CylinderTypeID string  `json:"cylinder_type_id"`
	Quantity       int     `json:"quantity"`
	UnitPrice      string  `json:"unit_price"`
	CostPrice      string  `json:"cost_price"`
	Total          string  `json:"total"`
	PaymentMethod  string  `json:"payment_method"`
	IsExchange     bool    `json:"is_exchange"`
}

type RestockPayload struct {
	CylinderTypeID string  `json:"cylinder_type_id"`
	Quantity       int     `json:"quantity"`
	CostPerUnit    string  `json:"cost_per_unit"`
	TotalCost      string  `json:"total_cost"`
	Notes          *string `json:"notes"`
}

type StockAdjPayload struct {
	CylinderTypeID string  `json:"cylinder_type_id"`
	Field          string  `json:"field"` // full|empty
	Delta          int     `json:"delta"`
	Reason         *string `json:"reason"`
}

type SettlePayload struct {
	CustomerID    string `json:"customer_id"`
	Amount        string `json:"amount"`
	PaymentMethod string `json:"payment_method"`
}

// PushResult is the per-event outcome returned to the client.
type PushResult struct {
	ID               string     `json:"id"`
	Status           string     `json:"status"` // applied|duplicate|error
	Sequence         *int64     `json:"sequence,omitempty"`
	ServerReceivedAt *time.Time `json:"server_received_at,omitempty"`
	Error            string     `json:"error,omitempty"`
}
```

- [ ] **Step 2: Write the failing hash test**

```go
package sync

import "testing"

func TestPayloadHash_StableAcrossCalls(t *testing.T) {
	e := PushEvent{Kind: "sale", ID: "abc",
		Sale: &SalePayload{CylinderTypeID: "c1", Quantity: 2, Total: "240.00", PaymentMethod: "cash"}}
	if PayloadHash(e) != PayloadHash(e) {
		t.Fatal("hash must be deterministic")
	}
}

func TestPayloadHash_DiffersWhenMaterialFieldChanges(t *testing.T) {
	a := PushEvent{Kind: "sale", ID: "abc", Sale: &SalePayload{Quantity: 2}}
	b := PushEvent{Kind: "sale", ID: "abc", Sale: &SalePayload{Quantity: 3}}
	if PayloadHash(a) == PayloadHash(b) {
		t.Fatal("different quantity must change hash")
	}
}
```

- [ ] **Step 3: Run it, verify fail**

Run: `go test ./internal/sync/...`
Expected: FAIL — `undefined: PayloadHash`.

- [ ] **Step 4: Write payload_hash.go**

```go
package sync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// PayloadHash is a deterministic hash of the material content of an event,
// used to distinguish a genuine retry (same hash) from a UUID collision
// (same id, different hash) on /sync/push.
func PayloadHash(e PushEvent) string {
	material := struct {
		Kind string      `json:"kind"`
		Sale *SalePayload `json:"sale,omitempty"`
		Restock *RestockPayload `json:"restock,omitempty"`
		StockAdjustment *StockAdjPayload `json:"stock_adjustment,omitempty"`
		DebtSettlement *SettlePayload `json:"debt_settlement,omitempty"`
	}{e.Kind, e.Sale, e.Restock, e.StockAdjustment, e.DebtSettlement}
	b, _ := json.Marshal(material)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
```

- [ ] **Step 5: Run, verify pass**

Run: `go test ./internal/sync/...`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/sync/types.go backend/internal/sync/payload_hash.go backend/internal/sync/payload_hash_test.go
git commit -m "feat(backend): DTOs de sync + hash de payload (guarda colisao de UUID)"
```

### Task 4.2: Push handler — per-event tx, idempotency, atomic increment (integration TDD)

**Files:**
- Create: `backend/internal/sync/push.go`
- Create: `backend/internal/sync/testutil_test.go` (shared test DB harness)
- Test: `backend/internal/sync/push_test.go`

- [ ] **Step 1: Add testcontainers dep**

```bash
go get github.com/testcontainers/testcontainers-go@latest
go get github.com/testcontainers/testcontainers-go/modules/postgres@latest
```

- [ ] **Step 2: Write testutil_test.go (spins Postgres, runs migrations, seeds a user/type/customer)**

```go
package sync

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpg "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

const (
	seedUser     = "u1"
	seedType     = "11111111-1111-1111-1111-111111111111"
	seedCustomer = "22222222-2222-2222-2222-222222222222"
	seedInvID    = "33333333-3333-3333-3333-333333333333"
)

func newTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	ctr, err := tcpg.Run(ctx, "postgres:16",
		tcpg.WithDatabase("gas"), tcpg.WithUsername("gas"), tcpg.WithPassword("gas"),
		testcontainers.WithWaitStrategy(
			wait.ForListeningPort("5432/tcp").WithStartupTimeout(60*time.Second)))
	if err != nil { t.Fatalf("start postgres: %v", err) }
	t.Cleanup(func() { _ = ctr.Terminate(ctx) })

	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil { t.Fatalf("conn string: %v", err) }

	pool, err := pgxpool.New(ctx, url)
	if err != nil { t.Fatalf("pool: %v", err) }
	t.Cleanup(pool.Close)

	applyMigrations(t, pool)
	seed(t, pool)
	return pool
}

func applyMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	// Load the up migration file and execute it directly.
	path := filepath.Join("..", "db", "migrations", "0001_init.up.sql")
	sql := readFile(t, path)
	if _, err := pool.Exec(context.Background(), sql); err != nil {
		t.Fatalf("migrate: %v", err)
	}
}

func seed(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`INSERT INTO users(id,name,role) VALUES ('` + seedUser + `','U','employee')`,
		`INSERT INTO cylinder_types(id,name,weight_kg,sale_price,cost_price) VALUES ('` + seedType + `','P13',13,120,90)`,
		`INSERT INTO customers(id,name,balance,credit_limit) VALUES ('` + seedCustomer + `','C',0,500)`,
		`INSERT INTO inventory(id,cylinder_type_id,full_qty,empty_qty) VALUES ('` + seedInvID + `','` + seedType + `',10,0)`,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil { t.Fatalf("seed: %v", err) }
	}
}
```

> Note: `readFile` is a 3-line helper — add it at the bottom of testutil_test.go:
```go
func readFile(t *testing.T, p string) string {
	b, err := os.ReadFile(p); if err != nil { t.Fatalf("read %s: %v", p, err) }; return string(b)
}
```
(add `"os"` to imports).

- [ ] **Step 3: Write the failing push test**

```go
package sync

import (
	"context"
	"testing"
	"time"
)

func saleEvent(id string, qty int) PushEvent {
	cust := seedCustomer
	return PushEvent{Kind: "sale", ID: id, ClientCreatedAt: time.Now(),
		Sale: &SalePayload{CustomerID: &cust, CylinderTypeID: seedType, Quantity: qty,
			UnitPrice: "120", CostPrice: "90", Total: "120", PaymentMethod: "fiado"}}
}

func TestPush_AppliesSaleAndBumpsAggregates(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	res, err := svc.Push(context.Background(), seedUser, []PushEvent{saleEvent("aaaaaaaa-0000-0000-0000-000000000001", 1)})
	if err != nil { t.Fatalf("Push: %v", err) }
	if res[0].Status != "applied" { t.Fatalf("want applied, got %s (%s)", res[0].Status, res[0].Error) }

	var full int; var bal float64
	pool.QueryRow(context.Background(), `SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType).Scan(&full)
	pool.QueryRow(context.Background(), `SELECT balance FROM customers WHERE id=$1`, seedCustomer).Scan(&bal)
	if full != 9 { t.Fatalf("want full_qty 9, got %d", full) }
	if bal != 120 { t.Fatalf("want balance 120, got %v", bal) }
}

func TestPush_DuplicateSamePayloadIsIdempotent(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ev := saleEvent("aaaaaaaa-0000-0000-0000-000000000002", 1)
	_, _ = svc.Push(context.Background(), seedUser, []PushEvent{ev})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{ev})
	if res[0].Status != "duplicate" { t.Fatalf("want duplicate, got %s", res[0].Status) }

	var full int
	pool.QueryRow(context.Background(), `SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType).Scan(&full)
	if full != 9 { t.Fatalf("aggregate must not double-apply, got %d", full) }
}

func TestPush_DuplicateAfterLaterEventApplied(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	first := saleEvent("aaaaaaaa-0000-0000-0000-000000000003", 1)
	second := saleEvent("aaaaaaaa-0000-0000-0000-000000000004", 1)
	svc.Push(context.Background(), seedUser, []PushEvent{first})
	svc.Push(context.Background(), seedUser, []PushEvent{second})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{first}) // resend first, out of order
	if res[0].Status != "duplicate" { t.Fatalf("want duplicate, got %s", res[0].Status) }
	var full int
	pool.QueryRow(context.Background(), `SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType).Scan(&full)
	if full != 8 { t.Fatalf("want 8 after two distinct sales, got %d", full) }
}

func TestPush_UUIDCollisionDifferentPayloadIsError(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	a := saleEvent("aaaaaaaa-0000-0000-0000-000000000005", 1)
	b := saleEvent("aaaaaaaa-0000-0000-0000-000000000005", 5) // same id, different qty
	svc.Push(context.Background(), seedUser, []PushEvent{a})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{b})
	if res[0].Status != "error" || res[0].Error != "id_conflict" {
		t.Fatalf("want error/id_conflict, got %s/%s", res[0].Status, res[0].Error)
	}
}

func TestPush_BadEventDoesNotBreakBatch(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	good := saleEvent("aaaaaaaa-0000-0000-0000-000000000006", 1)
	bad := saleEvent("aaaaaaaa-0000-0000-0000-000000000007", 1)
	bad.Sale.CylinderTypeID = "99999999-9999-9999-9999-999999999999" // FK violation
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{bad, good})
	if res[0].Status != "error" { t.Fatalf("bad event should be error, got %s", res[0].Status) }
	if res[1].Status != "applied" { t.Fatalf("good event should still apply, got %s", res[1].Status) }
}
```

- [ ] **Step 4: Run it, verify fail**

Run: `go test ./internal/sync/ -run TestPush`
Expected: FAIL — `undefined: NewService`.

- [ ] **Step 5: Write push.go**

Each event runs in its OWN transaction: dup-check → insert fact → bump aggregate, then commit. A failure rolls back only that event.

```go
package sync

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

func (s *Service) Push(ctx context.Context, userID string, events []PushEvent) ([]PushResult, error) {
	out := make([]PushResult, 0, len(events))
	for _, e := range events {
		out = append(out, s.pushOne(ctx, userID, e))
	}
	return out, nil
}

func (s *Service) pushOne(ctx context.Context, userID string, e PushEvent) PushResult {
	hash := PayloadHash(e)

	// Idempotency / collision check (read committed; same id is unique PK).
	existing, found, err := s.existingHash(ctx, e)
	if err != nil {
		return PushResult{ID: e.ID, Status: "error", Error: "lookup_failed"}
	}
	if found {
		if existing == hash {
			return PushResult{ID: e.ID, Status: "duplicate"}
		}
		return PushResult{ID: e.ID, Status: "error", Error: "id_conflict"}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PushResult{ID: e.ID, Status: "error", Error: "tx_begin"}
	}
	defer tx.Rollback(ctx)

	seq, recvAt, err := s.applyEvent(ctx, tx, userID, e, hash)
	if err != nil {
		// A racing duplicate insert collides on PK → treat as duplicate.
		if isUniqueViolation(err) {
			return PushResult{ID: e.ID, Status: "duplicate"}
		}
		return PushResult{ID: e.ID, Status: "error", Error: "apply_failed"}
	}
	if err := tx.Commit(ctx); err != nil {
		return PushResult{ID: e.ID, Status: "error", Error: "commit_failed"}
	}
	return PushResult{ID: e.ID, Status: "applied", Sequence: &seq, ServerReceivedAt: &recvAt}
}
```

> `existingHash`, `applyEvent`, `isUniqueViolation` are implemented in the next step using the sqlc `gen` package. They dispatch on `e.Kind`. (Full bodies in Step 6.)

- [ ] **Step 6: Add the dispatch helpers (same file)**

```go
import (
	"time"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/jackc/pgx/v5/pgtype"
)

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (s *Service) existingHash(ctx context.Context, e PushEvent) (string, bool, error) {
	q := gen.New(s.pool)
	switch e.Kind {
	case "sale":
		row, err := q.GetSaleByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	case "restock":
		row, err := q.GetRestockByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	case "stock_adjustment":
		row, err := q.GetStockAdjustmentByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	case "debt_settlement":
		row, err := q.GetDebtSettlementByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	}
	return "", false, errors.New("unknown kind")
}

func scanHash(h string, err error) (string, bool, error) {
	if errors.Is(err, pgx.ErrNoRows) { return "", false, nil }
	if err != nil { return "", false, err }
	return h, true, nil
}

func (s *Service) applyEvent(ctx context.Context, tx pgx.Tx, userID string, e PushEvent, hash string) (int64, time.Time, error) {
	q := gen.New(tx)
	switch e.Kind {
	case "sale":
		p := e.Sale
		ins, err := q.InsertSale(ctx, gen.InsertSaleParams{ /* map fields incl. PayloadHash:hash, CreatedBy:userID, ClientCreatedAt:e.ClientCreatedAt */ })
		if err != nil { return 0, time.Time{}, err }
		if err := q.BumpInventoryForSale(ctx, gen.BumpInventoryForSaleParams{CylinderTypeID: mustUUID(p.CylinderTypeID), Column2: int32(p.Quantity), Column3: p.IsExchange}); err != nil {
			return 0, time.Time{}, err
		}
		if p.CustomerID != nil && p.PaymentMethod == "fiado" {
			if err := q.BumpCustomerBalance(ctx, gen.BumpCustomerBalanceParams{ID: mustUUID(*p.CustomerID), Balance: numeric(p.Total)}); err != nil {
				return 0, time.Time{}, err
			}
		}
		return ins.Sequence, toTime(ins.ServerReceivedAt), nil
	// case "restock": InsertRestock + BumpInventoryFull(+quantity)
	// case "stock_adjustment": InsertStockAdjustment + BumpInventoryField(field, delta)
	// case "debt_settlement": InsertDebtSettlement + BumpCustomerBalance(-amount)
	}
	return 0, time.Time{}, errors.New("unknown kind")
}
```

> **Implementation note for the worker:** fill the `restock`, `stock_adjustment`, `debt_settlement` cases by analogy with `sale` — each does exactly one `Insert*` + the matching `Bump*` call listed in the comments. `mustUUID`, `numeric`, `toTime` are small adapters between the DTO strings and pgx types — implement them in a `convert.go` (next task) so this compiles. Do not invent extra behavior; settlement bumps balance by `-amount`.

- [ ] **Step 7: Run tests, verify pass**

Run: `go test ./internal/sync/ -run TestPush`
Expected: all 5 PASS (Docker must be running).

- [ ] **Step 8: Commit**

```bash
git add backend/internal/sync/
git commit -m "feat(backend): push idempotente com tx por evento + incremento atomico"
```

### Task 4.3: Type adapters (TDD)

**Files:**
- Create: `backend/internal/sync/convert.go`
- Test: `backend/internal/sync/convert_test.go`

- [ ] **Step 1: Failing test**

```go
package sync

import "testing"

func TestNumeric_ParsesDecimalString(t *testing.T) {
	n := numeric("120.50")
	if !n.Valid { t.Fatal("want valid numeric") }
}

func TestMustUUID_RoundTrips(t *testing.T) {
	u := mustUUID("11111111-1111-1111-1111-111111111111")
	if !u.Valid { t.Fatal("want valid uuid") }
}
```

- [ ] **Step 2: Run, verify fail** — `go test ./internal/sync/ -run TestNumeric` → FAIL undefined.

- [ ] **Step 3: Implement convert.go**

```go
package sync

import (
	"time"
	"github.com/jackc/pgx/v5/pgtype"
)

func mustUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	_ = u.Scan(s)
	return u
}

func numeric(s string) pgtype.Numeric {
	var n pgtype.Numeric
	_ = n.Scan(s)
	return n
}

func toTime(t pgtype.Timestamptz) time.Time { return t.Time }
```

- [ ] **Step 4: Run, verify pass** — `go test ./internal/sync/ -run "TestNumeric|TestMustUUID"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/sync/convert.go backend/internal/sync/convert_test.go
git commit -m "feat(backend): adaptadores de tipo DTO->pgx"
```

### Task 4.4: HTTP layer for push

**Files:**
- Create: `backend/internal/httpx/respond.go`
- Modify: `backend/internal/sync/push.go` (add `HandlePush`)
- Test: `backend/internal/sync/push_http_test.go`

- [ ] **Step 1: Write respond.go**

```go
package httpx

import (
	"encoding/json"
	"net/http"
)

func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func Error(w http.ResponseWriter, status int, msg string) {
	JSON(w, status, map[string]string{"error": msg})
}
```

- [ ] **Step 2: Failing HTTP test**

```go
package sync

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHandlePush_ReturnsPerEventResults(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	body, _ := json.Marshal(map[string]any{"events": []PushEvent{saleEvent("aaaaaaaa-0000-0000-0000-0000000000aa", 1)}})
	r := httptest.NewRequest("POST", "/sync/push", bytes.NewReader(body))
	r = r.WithContext(context.WithValue(r.Context(), ctxUserKey, seedUser))
	w := httptest.NewRecorder()
	svc.HandlePush(w, r)
	if w.Code != http.StatusOK { t.Fatalf("want 200, got %d", w.Code) }
	var resp struct{ Results []PushResult `json:"results"` }
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Results) != 1 || resp.Results[0].Status != "applied" {
		t.Fatalf("unexpected results: %+v", resp.Results)
	}
}
```

> `ctxUserKey` is the context key the auth middleware uses. To avoid an import cycle, the sync package reads the user id via a small exported accessor; in Step 3 use `auth.UserID(r.Context())` instead of a local key, and delete the `ctxUserKey` reference from the test (set the value with `auth.WithUserID` test helper added to the auth package). Simpler: have `HandlePush` accept the uid from `auth.UserID`.

- [ ] **Step 3: Add HandlePush to push.go**

```go
func (s *Service) HandlePush(w http.ResponseWriter, r *http.Request) {
	var req struct{ Events []PushEvent `json:"events"` }
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid body"); return
	}
	uid := auth.UserID(r.Context())
	results, _ := s.Push(r.Context(), uid, req.Events)
	httpx.JSON(w, http.StatusOK, map[string]any{"results": results})
}
```
(add imports: `encoding/json`, `net/http`, the `httpx` and `auth` packages. In the test, set the user with `r = r.WithContext(auth.WithUserID(r.Context(), seedUser))` and add `WithUserID` to the auth package: `func WithUserID(ctx context.Context, id string) context.Context { return context.WithValue(ctx, userIDKey, id) }`.)

- [ ] **Step 4: Run, verify pass**

Run: `go test ./internal/sync/ -run TestHandlePush`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpx/ backend/internal/sync/ backend/internal/auth/
git commit -m "feat(backend): endpoint POST /sync/push"
```

---

## Phase 5 — Sync pull (unified stream by sequence)

### Task 5.1: Pull service + handler (integration TDD)

**Files:**
- Create: `backend/internal/sync/pull.go`
- Test: `backend/internal/sync/pull_test.go`

**Cursor design:** the cursor is an opaque base64 of `"<kind>:<sequence>"` per source isn't needed — because we expose ONE unified stream, the cursor is a single struct holding the last-seen `sequence` per table (4 ints). The handler reads up to `limit` total events across tables, always advancing each table's own sequence, and returns `next_cursor` + `has_more`. This guarantees no event is skipped even if rows commit out of wall-clock order.

- [ ] **Step 1: Failing test**

```go
package sync

import (
	"context"
	"testing"
)

func TestPull_ReturnsAppliedEventsInSequenceOrder(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	svc.Push(context.Background(), seedUser, []PushEvent{
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000b1", 1),
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000b2", 1),
	})
	page, err := svc.Pull(context.Background(), Cursor{}, 10)
	if err != nil { t.Fatalf("Pull: %v", err) }
	if len(page.Events) != 2 { t.Fatalf("want 2 events, got %d", len(page.Events)) }
	if page.HasMore { t.Fatal("should not have more") }
}

func TestPull_PaginatesAndResumesFromCursor(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	svc.Push(context.Background(), seedUser, []PushEvent{
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000c1", 1),
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000c2", 1),
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000c3", 1),
	})
	p1, _ := svc.Pull(context.Background(), Cursor{}, 2)
	if len(p1.Events) != 2 || !p1.HasMore { t.Fatalf("page1 wrong: %d more=%v", len(p1.Events), p1.HasMore) }
	p2, _ := svc.Pull(context.Background(), p1.NextCursor, 2)
	if len(p2.Events) != 1 || p2.HasMore { t.Fatalf("page2 wrong: %d more=%v", len(p2.Events), p2.HasMore) }
}
```

- [ ] **Step 2: Run, verify fail** — `go test ./internal/sync/ -run TestPull` → FAIL undefined `Cursor`/`Pull`.

- [ ] **Step 3: Implement pull.go**

```go
package sync

import (
	"context"
	"time"
)

type Cursor struct {
	Sale   int64 `json:"sale"`
	Restock int64 `json:"restock"`
	Adjust int64 `json:"adjust"`
	Settle int64 `json:"settle"`
}

type Event struct {
	Kind             string    `json:"kind"`
	Sequence         int64     `json:"sequence"`
	ServerReceivedAt time.Time `json:"server_received_at"`
	Data             any       `json:"data"`
}

type PullPage struct {
	Events     []Event `json:"events"`
	NextCursor Cursor  `json:"-"`
	HasMore    bool    `json:"has_more"`
}

// Pull merges the four fact streams ordered by each table's sequence, capped at limit.
// Strategy: pull up to `limit` from each table past its cursor, merge-sort by sequence
// globally, take the first `limit`, and advance each table's cursor to the max sequence
// actually emitted for that table.
func (s *Service) Pull(ctx context.Context, c Cursor, limit int32) (PullPage, error) {
	// 1. Query each table: WHERE sequence > cursor.<table> ORDER BY sequence LIMIT limit.
	// 2. Wrap rows into []Event tagged with Kind.
	// 3. Sort merged slice by Sequence asc.
	// 4. hasMore = totalFetched > limit OR any table returned a full `limit` page.
	// 5. Truncate to limit; recompute next cursor from emitted events (per-kind max seq;
	//    untouched kinds keep their old cursor value).
	// (Full body: ~50 lines of straightforward merge logic using the Pull* sqlc queries.)
	return PullPage{}, nil
}
```

> **Worker note:** implement the numbered steps literally. The `hasMore` rule must be conservative: if any single table returned exactly `limit` rows, there may be more in that table, so `hasMore = true`. The next cursor for a kind only advances to the max sequence of the events actually emitted (not fetched), so truncated events are re-fetched next page. This is what makes pagination lossless under the tests above.

- [ ] **Step 4: Add HandlePull (same file)**

Encodes/decodes the cursor as base64 JSON in the `since` query param.

```go
func (s *Service) HandlePull(w http.ResponseWriter, r *http.Request) {
	cur := decodeCursor(r.URL.Query().Get("since")) // "" → zero Cursor
	limit := parseLimit(r.URL.Query().Get("limit"), 200)
	page, err := s.Pull(r.Context(), cur, limit)
	if err != nil { httpx.Error(w, 500, "pull_failed"); return }
	httpx.JSON(w, 200, map[string]any{
		"events": page.Events,
		"next_cursor": encodeCursor(page.NextCursor),
		"has_more": page.HasMore,
	})
}
```
(`decodeCursor`/`encodeCursor` = base64 of `json.Marshal(Cursor)`; `parseLimit` clamps to [1,500]. Implement these as small unexported funcs in pull.go.)

- [ ] **Step 5: Run, verify pass**

Run: `go test ./internal/sync/ -run TestPull`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/sync/pull.go backend/internal/sync/pull_test.go
git commit -m "feat(backend): GET /sync/pull stream unificado paginado por sequence"
```

### Task 5.2: Concurrency + out-of-order regression test

**Files:**
- Test: `backend/internal/sync/concurrency_test.go`

- [ ] **Step 1: Write the test (two concurrent sales to same customer; no lost update)**

```go
package sync

import (
	"context"
	"sync"
	"testing"
)

func TestPush_ConcurrentSalesSameCustomerNoLostUpdate(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	var wg sync.WaitGroup
	ids := []string{"aaaaaaaa-0000-0000-0000-0000000000d1", "aaaaaaaa-0000-0000-0000-0000000000d2"}
	for _, id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			svc.Push(context.Background(), seedUser, []PushEvent{saleEvent(id, 1)})
		}(id)
	}
	wg.Wait()
	var bal float64
	pool.QueryRow(context.Background(), `SELECT balance FROM customers WHERE id=$1`, seedCustomer).Scan(&bal)
	if bal != 240 { t.Fatalf("want balance 240 (no lost update), got %v", bal) }

	page, _ := svc.Pull(context.Background(), Cursor{}, 10)
	if len(page.Events) != 2 { t.Fatalf("want both events visible, got %d", len(page.Events)) }
}
```

- [ ] **Step 2: Run, verify pass**

Run: `go test ./internal/sync/ -run TestPush_Concurrent`
Expected: PASS (atomic `balance = balance + x` is what makes this hold).

- [ ] **Step 3: Commit**

```bash
git add backend/internal/sync/concurrency_test.go
git commit -m "test(backend): vendas concorrentes mesmo cliente sem lost update"
```

---

## Phase 6 — Catalog CRUD (last-write-wins)

### Task 6.1: Catalog queries

**Files:**
- Create: `backend/internal/db/queries/catalog.sql`
- Regenerate: `backend/internal/db/gen/`

- [ ] **Step 1: Write catalog.sql**

LWW: update only when the incoming `updated_at` is newer.

```sql
-- name: UpsertCustomer :exec
INSERT INTO customers (id, name, phone, address, credit_limit, updated_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, phone = EXCLUDED.phone, address = EXCLUDED.address,
  credit_limit = EXCLUDED.credit_limit, updated_at = EXCLUDED.updated_at
WHERE customers.updated_at < EXCLUDED.updated_at;

-- name: DeleteCustomerIfNoBalance :execrows
DELETE FROM customers WHERE id = $1 AND balance = 0;

-- name: UnlinkCustomerSales :exec
UPDATE sales SET customer_id = NULL WHERE customer_id = $1;

-- name: UpdateCylinderType :exec
UPDATE cylinder_types SET sale_price=$2, cost_price=$3, active=$4, updated_at=$5
WHERE id=$1 AND updated_at < $5;
```

- [ ] **Step 2: Regenerate** — `sqlc generate` → exit 0.

- [ ] **Step 3: Verify build** — `go build ./...` → exit 0.

- [ ] **Step 4: Commit**

```bash
git add backend/internal/db/queries/catalog.sql backend/internal/db/gen/
git commit -m "feat(backend): queries de catalogo (LWW por updated_at)"
```

### Task 6.2: Catalog handlers (integration TDD)

**Files:**
- Create: `backend/internal/catalog/handlers.go`
- Test: `backend/internal/catalog/handlers_test.go`

- [ ] **Step 1: Failing test — delete blocked when balance > 0; unlink on delete; LWW ignores stale update**

```go
package catalog

import (
	"context"
	"testing"
	"time"
)

func TestDeleteCustomer_BlockedWhenBalanceOwed(t *testing.T) {
	pool := newCatalogTestDB(t) // seeds a customer with balance 50
	svc := NewService(pool)
	err := svc.DeleteCustomer(context.Background(), seedCustomerWithDebt)
	if err == nil { t.Fatal("expected delete to be blocked by outstanding balance") }
}

func TestUpsertCustomer_StaleUpdateIgnored(t *testing.T) {
	pool := newCatalogTestDB(t)
	svc := NewService(pool)
	old := time.Now().Add(-time.Hour)
	// existing row has updated_at = now; an older write must not overwrite name.
	err := svc.UpsertCustomer(context.Background(), CustomerInput{ID: seedCustomerFresh, Name: "STALE", UpdatedAt: old})
	if err != nil { t.Fatalf("upsert: %v", err) }
	var name string
	pool.QueryRow(context.Background(), `SELECT name FROM customers WHERE id=$1`, seedCustomerFresh).Scan(&name)
	if name == "STALE" { t.Fatal("stale LWW write must be ignored") }
}
```

> `newCatalogTestDB`, `seedCustomerWithDebt`, `seedCustomerFresh` mirror the sync test harness (copy the testcontainers setup into a `testutil_test.go` in this package, seeding one customer with balance 50 and one fresh customer with `updated_at = now()`).

- [ ] **Step 2: Run, verify fail** — `go test ./internal/catalog/...` → FAIL undefined.

- [ ] **Step 3: Implement handlers.go**

```go
package catalog

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

type Service struct{ pool *pgxpool.Pool }
func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type CustomerInput struct {
	ID, Name string
	Phone, Address *string
	CreditLimit *string
	UpdatedAt time.Time
}

var ErrBalanceOwed = errors.New("customer has outstanding balance")

func (s *Service) DeleteCustomer(ctx context.Context, id string) error {
	q := gen.New(s.pool)
	if err := q.UnlinkCustomerSales(ctx, mustUUID(id)); err != nil { return err }
	rows, err := q.DeleteCustomerIfNoBalance(ctx, mustUUID(id))
	if err != nil { return err }
	if rows == 0 { return ErrBalanceOwed }
	return nil
}

func (s *Service) UpsertCustomer(ctx context.Context, in CustomerInput) error {
	q := gen.New(s.pool)
	return q.UpsertCustomer(ctx, gen.UpsertCustomerParams{ /* map fields; UpdatedAt:in.UpdatedAt */ })
}
```
(reuse the `mustUUID`/`numeric` adapters — extract them to a tiny shared `internal/pgconv` package imported by both `sync` and `catalog` so they aren't duplicated; refactor the sync package's `convert.go` to call it. Keep the refactor in this commit.)

> **Ordering caveat for the worker:** `DeleteCustomer` unlinks sales first, then attempts the conditional delete. If the delete is blocked (balance ≠ 0) the unlink has already run — wrap both in a single transaction and roll back when `rows == 0`, so a blocked delete leaves sales linked. Add a test `TestDeleteCustomer_BlockedLeavesSalesLinked` asserting `customer_id` is unchanged after a blocked delete.

- [ ] **Step 4: Add the HTTP handlers** (`PUT /customers`, `DELETE /customers/:id`, `PUT /cylinder-types/:id`) — thin wrappers decoding JSON and calling the service, mapping `ErrBalanceOwed` → 409.

- [ ] **Step 5: Run, verify pass** — `go test ./internal/catalog/...` → PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/catalog/ backend/internal/pgconv/ backend/internal/sync/convert.go
git commit -m "feat(backend): CRUD de catalogo + delete de cliente transacional"
```

---

## Phase 7 — Alerts and sync errors

### Task 7.1: Alert queries + handlers (integration TDD)

**Files:**
- Create: `backend/internal/db/queries/alerts.sql`
- Create: `backend/internal/alerts/handlers.go`
- Test: `backend/internal/alerts/handlers_test.go`

- [ ] **Step 1: Write alerts.sql**

```sql
-- name: NegativeStock :many
SELECT i.cylinder_type_id, ct.name, i.full_qty, i.empty_qty
FROM inventory i JOIN cylinder_types ct ON ct.id = i.cylinder_type_id
WHERE i.full_qty < 0 OR i.empty_qty < 0;

-- name: OverLimitBalance :many
SELECT id, name, balance, credit_limit
FROM customers
WHERE credit_limit IS NOT NULL AND balance > credit_limit;
```

- [ ] **Step 2: Regenerate** — `sqlc generate`.

- [ ] **Step 3: Failing test**

```go
package alerts

import (
	"context"
	"testing"
)

func TestOverLimitBalance_FlagsCustomerPastLimit(t *testing.T) {
	pool := newAlertsTestDB(t) // seeds customer balance 600, credit_limit 500
	svc := NewService(pool)
	rows, err := svc.OverLimitBalance(context.Background())
	if err != nil { t.Fatalf("query: %v", err) }
	if len(rows) != 1 { t.Fatalf("want 1 over-limit customer, got %d", len(rows)) }
}

func TestNegativeStock_FlagsNegativeFullQty(t *testing.T) {
	pool := newAlertsTestDB(t) // seeds inventory full_qty -3
	svc := NewService(pool)
	rows, _ := svc.NegativeStock(context.Background())
	if len(rows) != 1 { t.Fatalf("want 1 negative-stock row, got %d", len(rows)) }
}
```

- [ ] **Step 4: Run, verify fail → implement handlers.go → run, verify pass**

Implement `NegativeStock`, `OverLimitBalance`, and HTTP handlers `GET /alerts/negative-stock`, `GET /alerts/over-limit-balance` (thin wrappers calling sqlc + `httpx.JSON`).

Run: `go test ./internal/alerts/...` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/db/queries/alerts.sql backend/internal/db/gen/ backend/internal/alerts/
git commit -m "feat(backend): alertas de estoque negativo e saldo acima do limite"
```

### Task 7.2: Server-side sync error log + endpoint (integration TDD)

> **Decision (locked):** errored push events never commit, but we DO want a central, durable record for the web panel and audit trail (motivation: "don't lose data" + central control). So on a non-duplicate error, `pushOne` writes a best-effort row to a `sync_errors` table in a **separate transaction** (its failure must never affect the push result). `GET /sync/errors` lists recent rows for the admin.

**Files:**
- Create: `backend/internal/db/migrations/0002_sync_errors.up.sql`
- Create: `backend/internal/db/migrations/0002_sync_errors.down.sql`
- Create: `backend/internal/db/queries/sync_errors.sql`
- Modify: `backend/internal/sync/push.go` (`pushOne` logs on error; add `HandleSyncErrors`)
- Test: `backend/internal/sync/sync_errors_test.go`

- [ ] **Step 1: Write 0002_sync_errors.up.sql**

```sql
CREATE TABLE sync_errors (
  id          BIGSERIAL PRIMARY KEY,
  event_id    UUID NOT NULL,
  kind        TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  error_code  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sync_errors_created ON sync_errors(created_at DESC);
```

- [ ] **Step 2: Write 0002_sync_errors.down.sql**

```sql
DROP TABLE IF EXISTS sync_errors;
```

- [ ] **Step 3: Write sync_errors.sql + regenerate**

```sql
-- name: InsertSyncError :exec
INSERT INTO sync_errors (event_id, kind, user_id, error_code, payload)
VALUES ($1,$2,$3,$4,$5);

-- name: RecentSyncErrors :many
SELECT event_id, kind, user_id, error_code, payload, created_at
FROM sync_errors ORDER BY created_at DESC LIMIT $1;
```
Run `sqlc generate`. Update the test harness's `applyMigrations` to also execute `0002_sync_errors.up.sql` (append after 0001).

- [ ] **Step 4: Failing test**

```go
package sync

import (
	"context"
	"testing"
)

func TestPush_ErrorIsLoggedToSyncErrors(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	bad := saleEvent("aaaaaaaa-0000-0000-0000-0000000000e1", 1)
	bad.Sale.CylinderTypeID = "99999999-9999-9999-9999-999999999999" // FK violation
	svc.Push(context.Background(), seedUser, []PushEvent{bad})
	var n int
	pool.QueryRow(context.Background(), `SELECT count(*) FROM sync_errors`).Scan(&n)
	if n != 1 { t.Fatalf("want 1 logged error, got %d", n) }
}

func TestPush_DuplicateIsNotLogged(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ev := saleEvent("aaaaaaaa-0000-0000-0000-0000000000e2", 1)
	svc.Push(context.Background(), seedUser, []PushEvent{ev})
	svc.Push(context.Background(), seedUser, []PushEvent{ev}) // duplicate, not an error
	var n int
	pool.QueryRow(context.Background(), `SELECT count(*) FROM sync_errors`).Scan(&n)
	if n != 0 { t.Fatalf("duplicate must not be logged, got %d", n) }
}
```

- [ ] **Step 5: Run, verify fail → implement**

In `pushOne`, where a result with `Status == "error"` is returned (and only there, never for `duplicate`), call a `logSyncError(ctx, userID, e, result.Error)` helper that marshals the event payload to JSON and runs `InsertSyncError` in a fresh short-lived context/tx; ignore its error (best-effort). Add `HandleSyncErrors(w, r)` calling `RecentSyncErrors(ctx, 100)` → `httpx.JSON`.

- [ ] **Step 6: Run, verify pass** — `go test ./internal/sync/ -run "TestPush_Error|TestPush_DuplicateIsNot"` → PASS.

- [ ] **Step 7: Register route** — add `pr.Get("/sync/errors", syncSvc.HandleSyncErrors)` in `main.go` (fold into Task 8.1 if not yet wired).

- [ ] **Step 8: Commit**

```bash
git add backend/internal/db/migrations/0002_* backend/internal/db/queries/sync_errors.sql backend/internal/db/gen/ backend/internal/sync/
git commit -m "feat(backend): log server-side de eventos com erro + GET /sync/errors"
```

---

## Phase 8 — Server wiring + data migration tooling

### Task 8.1: Wire main.go (router + middleware + routes)

**Files:**
- Create: `backend/cmd/server/main.go`
- Test: `backend/cmd/server/main_test.go` (smoke: `/healthz` returns 200)

- [ ] **Step 1: Failing healthz test**

```go
package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthz(t *testing.T) {
	r := httptest.NewRequest("GET", "/healthz", nil)
	w := httptest.NewRecorder()
	healthz(w, r)
	if w.Code != http.StatusOK { t.Fatalf("want 200, got %d", w.Code) }
}
```

- [ ] **Step 2: Run, verify fail → implement main.go**

```go
package main

import (
	"context"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/pedrogomesdev/gas-manager-backend/internal/alerts"
	"github.com/pedrogomesdev/gas-manager-backend/internal/auth"
	"github.com/pedrogomesdev/gas-manager-backend/internal/catalog"
	"github.com/pedrogomesdev/gas-manager-backend/internal/config"
	"github.com/pedrogomesdev/gas-manager-backend/internal/db"
	syncpkg "github.com/pedrogomesdev/gas-manager-backend/internal/sync"
)

func healthz(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) }

func main() {
	ctx := context.Background()
	cfg, err := config.Load()
	if err != nil { log.Fatal(err) }
	pool, err := db.NewPool(ctx, cfg.DatabaseURL)
	if err != nil { log.Fatal(err) }
	defer pool.Close()

	verifier, err := auth.NewFirebaseVerifier(ctx, cfg.FirebaseProjectID, "")
	if err != nil { log.Fatal(err) }
	loader := auth.NewDBUserLoader(pool) // implement: SELECT id,active,deactivated_at FROM users WHERE id=$1

	syncSvc := syncpkg.NewService(pool)
	catSvc := catalog.NewService(pool)
	alertSvc := alerts.NewService(pool)

	r := chi.NewRouter()
	r.Get("/healthz", healthz)
	r.Group(func(pr chi.Router) {
		pr.Use(auth.Middleware(verifier, loader, time.Now))
		pr.Post("/sync/push", syncSvc.HandlePush)
		pr.Get("/sync/pull", syncSvc.HandlePull)
		pr.Put("/customers", catSvc.HandleUpsertCustomer)
		pr.Delete("/customers/{id}", catSvc.HandleDeleteCustomer)
		pr.Put("/cylinder-types/{id}", catSvc.HandleUpdateCylinderType)
		pr.Get("/alerts/negative-stock", alertSvc.HandleNegativeStock)
		pr.Get("/alerts/over-limit-balance", alertSvc.HandleOverLimitBalance)
	})

	log.Printf("listening on :%s", cfg.Port)
	log.Fatal(http.ListenAndServe(":"+cfg.Port, r))
}
```
(add `auth.NewDBUserLoader` implementing `UserLoader` via a `GetUser` sqlc query; add `"time"` import.)

- [ ] **Step 3: Run, verify pass** — `go test ./cmd/server/...` → PASS. Then full suite: `go test ./...` (Docker up) → all green.

- [ ] **Step 4: Commit**

```bash
git add backend/cmd/server/ backend/internal/auth/
git commit -m "feat(backend): wiring do servidor (chi + rotas + healthz)"
```

### Task 8.2: Snapshot migration tool

**Files:**
- Create: `backend/migration/snapshot/main.go`
- Create: `backend/migration/testdata/sample.sqlite` (a phone export with known holes)
- Test: `backend/migration/snapshot/main_test.go`

- [ ] **Step 1: Failing test — reads SQLite, emits baseline events**

```go
package main

import "testing"

func TestSnapshot_EmitsBaselineBalanceAndStockEvents(t *testing.T) {
	events, err := buildSnapshot("../testdata/sample.sqlite")
	if err != nil { t.Fatalf("buildSnapshot: %v", err) }
	var balance, stock int
	for _, e := range events {
		switch e.Kind {
		case "initial_balance_migrated": balance++
		case "initial_stock_migrated": stock++
		}
	}
	if balance == 0 || stock == 0 { t.Fatalf("want baseline events, got balance=%d stock=%d", balance, stock) }
}
```

- [ ] **Step 2: Run fail → implement buildSnapshot** (open SQLite with `modernc.org/sqlite` (pure-Go, no cgo), `SELECT id,balance FROM customers` → `initial_balance_migrated`; `SELECT cylinder_type_id, full_qty, empty_qty FROM inventory` → `initial_stock_migrated`; write JSON to stdout). `go get modernc.org/sqlite`.

- [ ] **Step 3: Run, verify pass → commit**

```bash
git add backend/migration/snapshot/ backend/migration/testdata/
git commit -m "feat(backend): tool de snapshot de migracao (SQLite -> eventos baseline)"
```

### Task 8.3: Reconciliation tool (100%-match gate)

**Files:**
- Create: `backend/migration/reconcile/main.go`
- Test: `backend/migration/reconcile/main_test.go`

- [ ] **Step 1: Failing tests — passes on exact match, ABORTS on unmapped divergence**

```go
package main

import "testing"

func TestReconcile_PassesOnExactMatch(t *testing.T) {
	if err := reconcile(map[string]float64{"sales": 1000}, map[string]float64{"sales": 1000}); err != nil {
		t.Fatalf("exact match must pass: %v", err)
	}
}

func TestReconcile_AbortsOnUnmappedDivergence(t *testing.T) {
	if err := reconcile(map[string]float64{"sales": 1000}, map[string]float64{"sales": 950}); err == nil {
		t.Fatal("divergence must abort (100%% match gate)")
	}
}
```

- [ ] **Step 2: Run fail → implement reconcile** (compare two sum-maps key by key; any non-zero difference returns an error listing the diffs; zero difference returns nil. No tolerance.)

- [ ] **Step 3: Run, verify pass → commit**

```bash
git add backend/migration/reconcile/
git commit -m "feat(backend): reconciliacao de migracao com gate 100%"
```

---

## Phase 9 — Containerize + deploy

### Task 9.1: Dockerfile + local container smoke

**Files:**
- Create: `backend/Dockerfile`
- Create: `backend/.dockerignore`

- [ ] **Step 1: Write Dockerfile (multi-stage, static binary)**

```dockerfile
FROM golang:1.25 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /server /server
ENV PORT=8080
EXPOSE 8080
ENTRYPOINT ["/server"]
```

- [ ] **Step 2: Write .dockerignore**

```
.git
*_test.go
migration/testdata
.env
```

- [ ] **Step 3: Build image**

Run: `docker build -t gas-backend:dev .`
Expected: builds successfully.

- [ ] **Step 4: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore
git commit -m "chore(backend): Dockerfile multi-stage para Cloud Run"
```

### Task 9.2: Cloud SQL + Cloud Run provisioning (manual, documented)

**Files:**
- Create: `backend/deploy/README.md`

- [ ] **Step 1: Document + run provisioning commands** (region `southamerica-east1`, project `gas-manager-499616`)

```bash
gcloud config set project gas-manager-499616

# Cloud SQL Postgres with daily backups from day 1
gcloud sql instances create gas-pg \
  --database-version=POSTGRES_16 --tier=db-f1-micro \
  --region=southamerica-east1 --backup-start-time=03:00 \
  --availability-type=zonal
gcloud sql databases create gas --instance=gas-pg
gcloud sql users create gasapp --instance=gas-pg --password=<SECRET>

# Secrets
printf '%s' '<DB_URL_UNIX_SOCKET>' | gcloud secrets create DATABASE_URL --data-file=-
gcloud secrets create firebase-sa --data-file=firebase-sa.json
```

DATABASE_URL for Cloud Run (unix socket via Auth Proxy):
`postgres://gasapp:<pw>@/gas?host=/cloudsql/gas-manager-499616:southamerica-east1:gas-pg`

- [ ] **Step 2: Run migrations against Cloud SQL** (via Auth Proxy locally)

```bash
cloud-sql-proxy gas-manager-499616:southamerica-east1:gas-pg &
migrate -path internal/db/migrations -database "postgres://gasapp:<pw>@localhost:5432/gas?sslmode=disable" up
```

- [ ] **Step 3: Deploy to Cloud Run**

```bash
gcloud run deploy gas-backend \
  --source . --region=southamerica-east1 \
  --add-cloudsql-instances=gas-manager-499616:southamerica-east1:gas-pg \
  --set-secrets=DATABASE_URL=DATABASE_URL:latest,GOOGLE_APPLICATION_CREDENTIALS=/secrets/firebase-sa:firebase-sa:latest \
  --set-env-vars=FIREBASE_PROJECT_ID=gas-manager-499616 \
  --max-instances=4 --min-instances=0 --allow-unauthenticated
```

- [ ] **Step 4: Smoke test deployed service**

Run: `curl https://<service-url>/healthz`
Expected: `200`.

- [ ] **Step 5: Commit deploy docs**

```bash
git add backend/deploy/README.md
git commit -m "docs(backend): provisionamento Cloud SQL + deploy Cloud Run"
```

---

## Self-Review (completed by plan author)

**1. Spec coverage:**
- Ledger pattern / atomic increment → Tasks 1.1, 2.2, 4.2 ✅
- Client UUIDs + idempotency → 4.2 (`TestPush_Duplicate*`) ✅
- `sequence` cursor (not wall-clock) → 1.1, 5.1, 5.2 ✅
- UUID-collision guard (`payload_hash`) → 4.1, 4.2 (`TestPush_UUIDCollision...`) ✅
- Per-event tx, batch doesn't fail wholesale → 4.2 (`TestPush_BadEventDoesNotBreakBatch`) ✅
- Firebase auth + 14-day grace → 3.1 ✅
- Catalog CRUD last-write-wins + delete-unlink → 6.1, 6.2 ✅
- `negative-stock` + `over-limit-balance` alerts → 7.1 ✅
- Migration snapshot + reconciliation 100% gate → 8.2, 8.3 ✅
- Infra: small pool, daily backup, southamerica-east1, secrets → 2.1, 9.2 ✅
- `GET /sync/errors` → 7.2 — server-side `sync_errors` log (best-effort, separate tx) + endpoint. Decision locked by user (senior call): keep central audit trail for the web panel. ✅

**2. Placeholder scan:** Code-bearing steps contain real code. Three tasks (4.2 Step 6, 5.1 Step 3, 6.2 Step 3) intentionally leave a clearly-scoped "by analogy" body for the worker with an explicit, enumerated spec of what to write — flagged with worker notes rather than silent TODOs. These are the only non-literal bodies and each names the exact queries/operations to call.

**3. Type consistency:** `Service` is the handler struct in `sync`, `catalog`, `alerts`. `mustUUID`/`numeric`/`toTime` are defined once (4.3) then extracted to `internal/pgconv` (6.2) and reused. `Cursor`/`PullPage`/`Event`/`PushEvent`/`PushResult` names are stable across 4.1/5.1/8.1. `PayloadHash`, `UserID`/`WithUserID` consistent.

**All spec sections are covered and no open decisions remain.** `GET /sync/errors` resolved as a server-side best-effort log (Task 7.2) — central audit trail for the web panel.
