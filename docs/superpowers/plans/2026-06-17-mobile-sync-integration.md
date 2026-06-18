# Mobile Sync + Firebase Auth Integration Plan (sub-projeto #3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **AGENTS.md rule:** before writing any mobile/Expo code in a task, read the versioned Expo docs for the **installed** SDK (54) at https://docs.expo.dev/versions/v54.0.0/. Do not assume APIs.
>
> **User rule:** every code task ends with the full suite green (`go test ./...` for backend with Docker up; `npx tsc --noEmit` / app boot for mobile) **and** a TL + QA review of the diff via subagents before closing.

**Goal:** Make the gas-manager app multi-device for the 3 staff: log in once with Firebase email/senha (session persists), every sale/restock/settle/stock-edit syncs to the existing Cloud Run backend, and changes made on one phone appear on the others.

**Architecture:** Offline-first **outbox + pull-cursor** on top of the existing Go ledger backend (already deployed, untouched except two small gaps closed in Phase 1). Local SQLite gains client-generated **UUIDs** per syncable row plus two infra tables: `sync_outbox` (pending events to push) and `sync_state` (pull cursor + metadata). A background `SyncEngine` drains the outbox (`POST /sync/push`, idempotent by UUID) and applies `GET /sync/pull` pages into local SQLite, deduping our own events by UUID so aggregates are never double-counted. Server (Postgres) is the source of truth; local SQLite is a convergent cache. Firebase Auth (email/senha, admin-created accounts) gates the app and provides the bearer token.

**Tech Stack:** Expo SDK 54, expo-sqlite, expo-crypto (`randomUUID`), `firebase` (JS SDK ≥12) + `@react-native-async-storage/async-storage` for persistent auth, zustand (existing), Go 1.25 backend (chi/pgx/sqlc) for Phase 1 gaps.

---

## Key decisions (locked)

- **Login:** Firebase **email/senha**. Accounts created manually by the owner in the Firebase console. The app has a **login screen only** (no registration). Backend auto-provisions the UID on first authenticated request (`EnsureUser`, already built).
- **Session persistence:** `initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) })`. ID token (1h) auto-refreshes via the refresh token (no expiry) → user logs in once, stays logged in until logout/uninstall.
- **IDs:** keep the existing INTEGER PKs for local joins/UI; **add a `uuid TEXT UNIQUE` column** to every syncable table (`customers`, `sales`, `restocks`) generated at insert. The sync layer speaks UUID; the UI keeps working with integer ids. `cylinder_types` maps to the server's fixed P13 UUID via a constant.
- **Server P13 constants:** `cylinder_type_id = 11111111-1111-1111-1111-111111111111`. The app is P13-only (see [[project_p13_simplification]]); we hardcode this single mapping rather than syncing a catalog of types.
- **Fresh start (no migration):** the app is **not in production** (memory `project_backend_design` 2026-06-17 correction). On first successful login the local DB is treated as a cache of server state — no legacy local data to merge, sidestepping the "3 local DBs" risk in HANDOFF §6.
- **Money over the wire is strings** (the Go DTOs use `string` for `unit_price`/`total`/etc. to preserve decimal exactness). The mobile formats numbers to fixed-2 strings on push and parses on pull.

## Backend contract (confirmed in code, do not re-derive)

- Auth: `Authorization: Bearer <firebase_id_token>` on `/sync/*`, `/catalog/*`, `/alerts/*`.
- `POST /sync/push` body: `{"events":[PushEvent]}`. `PushEvent = {kind, id(uuid), client_created_at(RFC3339), sale|restock|stock_adjustment|debt_settlement}`. Response: `{"results":[{id,status:"applied"|"duplicate"|"error",sequence?,server_received_at?,error?}]}`. Per-event tx; one failure never drops the batch.
- `GET /sync/pull?since=<base64 cursor>&limit=<n>` → `{events:[{kind,sequence,server_received_at,data}], next_cursor:<base64>, has_more}`. `since=""` ⇒ from the beginning.
- `PUT /catalog/customers` body `CustomerInput {id,name,phone,address,credit_limit?(string),updated_at(RFC3339)}` (LWW). `DELETE /catalog/customers/{id}` → 204, or 409 `balance_owed`.
- External health = `/readyz` (never `/healthz`).
- Payload shapes: `backend/internal/sync/types.go`, `backend/internal/catalog/handlers.go`.

## Backend gaps this plan closes (Phase 1)

1. **Sale cancellation does not sync.** Local app physically deletes a sale (`db/queries/sales.ts:deleteSale`); the ledger has `voided_at/voided_by` columns but **no endpoint**. → add `POST /sync/void-sale`.
2. **Price/cost edits do not sync.** Estoque tab edits `cylinder_types` (`updateCylinderPrice`) but there is **no catalog endpoint** for cylinder types. → add `PUT /catalog/cylinder-types/{id}` (LWW), mirroring customers.

Both are small, mirror existing patterns, and are required for "pronto para o pessoal usar" given the current feature set.

---

## File structure

**Backend (Phase 1 only):**
- Modify: `backend/internal/db/queries/sales.sql` — add `VoidSale` query.
- Modify: `backend/internal/db/queries/catalog.sql` — add `UpsertCylinderType` (LWW).
- Regenerate: `backend/internal/db/gen/*` via `sqlc generate`.
- Modify: `backend/internal/sync/push.go` (or new `void.go`) — `HandleVoidSale`.
- Modify: `backend/internal/catalog/handlers.go` — `HandleUpsertCylinderType`.
- Modify: `backend/cmd/server/main.go` — wire the two routes.
- Test: `backend/internal/sync/void_test.go`, `backend/internal/catalog/cylinder_test.go`.

**Mobile — new files:**
- `lib/firebase.ts` — Firebase app + persistent auth init, env-driven config.
- `lib/auth.ts` — `signIn`, `signOut`, `onAuthChange`, `getIdToken`.
- `lib/api.ts` — fetch wrapper that injects the bearer token and base URL; `pushEvents`, `pullPage`, `upsertCustomer`, `deleteCustomer`, `upsertCylinderType`, `voidSale`.
- `lib/sync/constants.ts` — `SERVER_P13_UUID`, base URL.
- `lib/sync/outbox.ts` — enqueue/dequeue/mark for `sync_outbox`.
- `lib/sync/engine.ts` — `SyncEngine`: push loop, pull loop, backoff, status.
- `lib/sync/apply.ts` — apply a pulled event into local SQLite (dedupe by uuid).
- `store/sync.ts` — zustand slice: `{status, pendingCount, oldestPendingAt, lastSyncedAt, online}`.
- `app/login.tsx` — login screen (email/senha).
- `components/SyncBadge.tsx` — header badge: synced / N pendentes / offline.

**Mobile — modified:**
- `db/database.ts` — schema v2 migration (uuid columns + sync tables + `voided_at`).
- `db/queries/*.ts` — generate uuid on insert + enqueue outbox event in the same tx.
- `app/_layout.tsx` — auth gate (redirect to `/login` when signed out) + start `SyncEngine`.
- `app.json` — `extra` config for backend URL + Firebase keys (via env).
- `package.json` — add `firebase`, `@react-native-async-storage/async-storage`.

---

## Phase 0 — Firebase Auth enablement (manual, with the user)

These are console/CLI actions the **user** performs; the agent provides exact steps and verifies.

- [ ] **Step 1: Enable Email/Password provider.** In Firebase console for project `gas-manager-499616` → Build → Authentication → Get started → Sign-in method → enable **Email/Password** (leave passwordless off).
- [ ] **Step 2: Register a Web app** (the JS SDK uses the Web config even on RN). Project settings → General → Your apps → add **Web** app → copy `apiKey`, `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
- [ ] **Step 3: Create the 3 staff accounts.** Authentication → Users → Add user (email + senha) ×3. Note: backend has no RBAC; any valid account sees all data.
- [ ] **Step 4: Confirm backend project id matches.** Cloud Run env already `FIREBASE_PROJECT_ID=gas-manager-499616` (HANDOFF §4) — the token audience must match this project. No redeploy needed.
- [ ] **Step 5: Record the Web config** into local env (not committed): create `.env.local` consumed by `app.json`/`app.config` `extra`. Verify `.env*` is gitignored.

**Done when:** owner confirms 3 users exist and the Web config values are in hand.

---

## Phase 1 — Close backend gaps (Go, TDD)

> Run backend tests with Docker running (testcontainers). `cd backend`.

### Task 1.1: `VoidSale` query + endpoint

**Files:**
- Modify: `backend/internal/db/queries/sales.sql`
- Regenerate: `backend/internal/db/gen/`
- Create: `backend/internal/sync/void.go`
- Modify: `backend/cmd/server/main.go`
- Test: `backend/internal/sync/void_test.go`

- [ ] **Step 1: Write the failing test.** Insert a sale via `applyEvent`, then call `Service.VoidSale(ctx, userID, saleID)`; assert `voided_at` is set, the inventory bump is reversed (full_qty back up, empty_qty back down if exchange), and a fiado balance is restored. Voiding an already-voided sale is idempotent (no double reversal). Voiding an unknown id → `ErrNotFound`.

```go
func TestVoidSale_reversesAggregatesOnce(t *testing.T) {
    // arrange: push a fiado sale of qty 2, is_exchange true, total "240.00"
    // act: VoidSale once, then again
    // assert: inventory.full_qty == baseline, empty_qty == baseline,
    //         customer.balance == baseline, voided_at != nil, second call no-ops
}
```

- [ ] **Step 2: Run it, verify it fails** (`go test ./internal/sync/ -run VoidSale -v` → undefined `VoidSale`).
- [ ] **Step 3: Add the SQL.** In `sales.sql`:

```sql
-- name: VoidSale :one
UPDATE sales SET voided_at = now(), voided_by = @voided_by
WHERE id = @id AND voided_at IS NULL
RETURNING quantity, is_exchange, payment_method, customer_id, total, cylinder_type_id;
```

- [ ] **Step 4: `sqlc generate`** in `backend/` (regenerates `gen/`). Verify it compiles.
- [ ] **Step 5: Implement `VoidSale`** in `void.go`: one tx — run `VoidSale` (0 rows ⇒ already void/unknown → return idempotent success/ErrNotFound), then reverse the same bumps `applyEvent` made for a sale (inverse of `BumpInventoryForSale`; if fiado, `BumpCustomerBalance` by `+total`). Reuse existing bump queries with negated args, or add `ReverseInventoryForSale`.
- [ ] **Step 6: Add `HandleVoidSale`** (body `{"id":"<uuid>"}`), wire `r.Post("/sync/void-sale", syncSvc.HandleVoidSale)` inside the authed group in `main.go`.
- [ ] **Step 7: Run** `go test ./internal/sync/ -v` → PASS.
- [ ] **Step 8: Commit** `feat(backend): endpoint /sync/void-sale (cancelamento reversivel no ledger)`.

### Task 1.2: `UpsertCylinderType` (LWW) endpoint

**Files:**
- Modify: `backend/internal/db/queries/catalog.sql`
- Regenerate: `gen/`
- Modify: `backend/internal/catalog/handlers.go`
- Modify: `backend/cmd/server/main.go`
- Test: `backend/internal/catalog/cylinder_test.go`

- [ ] **Step 1: Failing test** — upsert P13 with newer `updated_at` overwrites price; older `updated_at` is ignored (LWW). Mirror the existing customer LWW test.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Add SQL** mirroring `UpsertCustomer` but for `cylinder_types` (id, name, weight_kg, sale_price, cost_price, active, updated_at) with `WHERE excluded.updated_at > cylinder_types.updated_at` LWW guard.
- [ ] **Step 4: `sqlc generate`.**
- [ ] **Step 5: Implement `UpsertCylinderType` + `HandleUpsertCylinderType`** mirroring `UpsertCustomer`. Wire `r.Put("/catalog/cylinder-types/{id}", catalogSvc.HandleUpsertCylinderType)`.
- [ ] **Step 6: Run** `go test ./internal/catalog/ -v` → PASS.
- [ ] **Step 7: Commit** `feat(backend): PUT /catalog/cylinder-types (LWW de preco/custo)`.

### Task 1.3: Full backend suite + deploy

- [ ] **Step 1:** `go test ./...` (Docker up) → all green.
- [ ] **Step 2:** TL + QA subagent review of the Phase 1 diff (per user rule).
- [ ] **Step 3:** Deploy via the `backend` skill (or `gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet`). Verify `/readyz` → 200 and the new routes return 401 without a token.
- [ ] **Step 4: Commit** any doc updates; update HANDOFF.

---

## Phase 2 — Local schema: UUIDs + sync tables (mobile, TDD)

> Read https://docs.expo.dev/versions/v54.0.0/sdk/sqlite/ and `.../sdk/crypto/` before coding.

### Task 2.1: Schema v2 migration

**Files:** Modify `db/database.ts`. Test: `db/__tests__/migration.test.ts` (run with an in-memory/temp expo-sqlite or a node-sqlite shim; if no RN test runner exists, validate via a dev-only boot assertion + manual check, documented in the task).

- [ ] **Step 1: Write migration assertions** — after `initDatabase`, `PRAGMA user_version` is 2; `customers`, `sales`, `restocks` each have a non-null unique `uuid`; tables `sync_outbox` and `sync_state` exist; `sales` has `voided_at`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement versioned migration** using `PRAGMA user_version`:

```sql
-- v1 -> v2
ALTER TABLE customers ADD COLUMN uuid TEXT;
ALTER TABLE sales     ADD COLUMN uuid TEXT;
ALTER TABLE sales     ADD COLUMN voided_at TEXT;
ALTER TABLE restocks  ADD COLUMN uuid TEXT;
-- backfill existing rows with generated uuids (dev only; no prod data)
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_uuid ON customers(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_uuid     ON sales(uuid);
CREATE UNIQUE INDEX IF NOT EXISTS idx_restocks_uuid  ON restocks(uuid);

CREATE TABLE sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_uuid TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,              -- sale|restock|stock_adjustment|debt_settlement|void_sale|customer_upsert|customer_delete|cylinder_upsert
  payload TEXT NOT NULL,          -- JSON body for the request
  client_created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending', -- pending|done|error
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sync_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pull_cursor TEXT NOT NULL DEFAULT '',
  last_synced_at TEXT
);
INSERT OR IGNORE INTO sync_state (id, pull_cursor) VALUES (1, '');
```

Backfill `uuid` for any existing rows with `expo-crypto`'s `randomUUID()` in JS after the DDL (dev data only). Map the local P13 `cylinder_types` row's effective server id to `SERVER_P13_UUID` (constant, not stored).

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): schema v2 (uuid por linha + sync_outbox/sync_state + voided_at)`.

### Task 2.2: Constants + outbox helper

**Files:** Create `lib/sync/constants.ts`, `lib/sync/outbox.ts`. Test: `lib/sync/__tests__/outbox.test.ts`.

- [ ] **Step 1: Failing test** — `enqueue(db, {kind,event_uuid,payload,client_created_at})` inserts a pending row; `enqueue` of the same `event_uuid` twice is idempotent (`INSERT OR IGNORE`); `pendingEvents(db)` returns them oldest-first; `markDone(db, uuid)` / `markError(db, uuid, msg)` update status and bump attempts; `pendingCount(db)` / `oldestPendingAt(db)` report correctly.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** `constants.ts` (`SERVER_P13_UUID = "11111111-1111-1111-1111-111111111111"`, `API_BASE_URL` from `expo-constants` extra) and `outbox.ts` (the functions above as thin SQL wrappers).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): outbox helpers + sync constants`.

---

## Phase 3 — Firebase auth + API client (mobile, TDD where pure)

### Task 3.1: Firebase init + auth wrappers

**Files:** Create `lib/firebase.ts`, `lib/auth.ts`. Modify `package.json`, `app.json`.

- [ ] **Step 1: Install deps** — `npx expo install firebase @react-native-async-storage/async-storage`. Confirm `firebase` ≥ 12 (SDK 54 requirement).
- [ ] **Step 2: Add config plumbing** — read Firebase web config + `API_BASE_URL` from `expo-constants` `extra` (sourced from `.env.local`). Verify `.env.local` is gitignored.
- [ ] **Step 3: Implement `lib/firebase.ts`** (persistent auth — the exact, version-correct pattern):

```ts
import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, getReactNativePersistence } from "firebase/auth";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";

const cfg = Constants.expoConfig?.extra?.firebase;
const app = getApps().length ? getApp() : initializeApp(cfg);
export const auth = initializeAuth(app, {
  persistence: getReactNativePersistence(AsyncStorage),
});
```

- [ ] **Step 4: Implement `lib/auth.ts`** — `signIn(email,pw)` (`signInWithEmailAndPassword`), `signOutUser()`, `onAuthChange(cb)` (`onAuthStateChanged`), `getIdToken()` (`auth.currentUser?.getIdToken()` — auto-refreshes). Map Firebase error codes to PT messages (`auth/invalid-credential` → "E-mail ou senha incorretos").
- [ ] **Step 5: Verify** `npx tsc --noEmit` passes; manual boot shows no init error. (Pure unit tests not practical for the SDK calls; keep logic thin.)
- [ ] **Step 6: Commit** `feat(app): firebase auth init com persistencia + wrappers`.

### Task 3.2: API client

**Files:** Create `lib/api.ts`. Test: `lib/__tests__/api.test.ts` (mock `fetch` + `getIdToken`).

- [ ] **Step 1: Failing test** — `pushEvents(events)` POSTs `{events}` to `${BASE}/sync/push` with `Authorization: Bearer <token>` and returns `results`; `pullPage(cursor,limit)` GETs `/sync/pull?since=&limit=`; a 401 throws `AuthError`; a network failure throws `NetworkError`; non-2xx throws `ApiError` with status.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `lib/api.ts`** — a `request()` helper that injects the token from `getIdToken()`, sets JSON headers, classifies failures (`AuthError` for 401/403, `NetworkError` for transport, `ApiError` otherwise), plus typed `pushEvents`, `pullPage`, `upsertCustomer`, `deleteCustomer`, `upsertCylinderType`, `voidSale`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): cliente HTTP do backend com bearer token`.

---

## Phase 4 — Sync engine: push + pull (mobile, TDD)

### Task 4.1: Apply a pulled event locally (dedupe by uuid)

**Files:** Create `lib/sync/apply.ts`. Test: `lib/sync/__tests__/apply.test.ts` (in-memory sqlite shim).

- [ ] **Step 1: Failing tests** — applying a `sale` event whose `data.id` is **not** present locally inserts the sale (mapped to local columns, `customer_id` resolved via `uuid`→local id, falling back to NULL) and bumps local `inventory`/`balance`; applying the **same** uuid again is a **no-op** (no double count); a `void_sale`-style voided sale sets `voided_at` and reverses aggregates once; `restock`/`stock_adjustment`/`debt_settlement` map likewise.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement `applyEvent(db, event)`** — switch on `kind`; for fact kinds: `INSERT OR IGNORE` by uuid; if `changes()==0` skip the aggregate bump (dedup); else bump using the same arithmetic as the local write paths. Resolve foreign uuids to local ids (insert a placeholder customer row if an unknown `customer_id` uuid arrives before its catalog upsert — or treat as NULL and reconcile on customer pull; document the choice).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): aplicar eventos do pull no SQLite com dedupe por uuid`.

### Task 4.2: SyncEngine push loop

**Files:** Create `lib/sync/engine.ts`, `store/sync.ts`. Test: `lib/sync/__tests__/engine.push.test.ts` (mock api).

- [ ] **Step 1: Failing test** — `engine.pushOnce()` reads pending outbox rows, calls `pushEvents`, marks `applied`/`duplicate` rows done, marks `error` rows error (without blocking the rest), and on `AuthError` triggers re-auth (callback) instead of backoff; on `NetworkError` increments attempts and schedules backoff (1s,2s,4s… cap 5min) by attempt count, not wall clock.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the push loop + backoff + zustand status updates (`pendingCount`, `oldestPendingAt`, `status`).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): SyncEngine push loop com backoff e re-auth`.

### Task 4.3: SyncEngine pull loop

**Files:** Modify `lib/sync/engine.ts`. Test: `engine.pull.test.ts`.

- [ ] **Step 1: Failing test** — `engine.pullAll()` loops `pullPage` from the stored cursor, applies each page via `applyEvent`, advances+persists `pull_cursor` **only after** the page is committed locally, and stops at `has_more=false`; a failure mid-stream resumes from the last persisted cursor (no lost/dup events).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the pull loop (page → apply in a tx → persist cursor → repeat). Update `lastSyncedAt`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): SyncEngine pull loop com cursor duravel`.

### Task 4.4: Engine orchestration + connectivity

**Files:** Modify `lib/sync/engine.ts`. Read `.../sdk/netinfo` or use `@react-native-community/netinfo` via `npx expo install`.

- [ ] **Step 1:** `engine.start()` runs an initial pull then push, subscribes to connectivity, and triggers a sync cycle on reconnect and after each local mutation enqueues. `engine.stop()` on logout. (Manual/integration verification; keep orchestration thin over the tested loops.)
- [ ] **Step 2: Commit** `feat(app): orquestracao do SyncEngine (online/reconnect)`.

---

## Phase 5 — Wire local mutations to the outbox (mobile, TDD)

> Each existing write path generates a uuid and enqueues an outbox event **in the same SQLite transaction** as the local write, so a crash never leaves a local row without its pending event.

### Task 5.1: Sales → enqueue `sale` (+ `void_sale` on delete)

**Files:** Modify `db/queries/sales.ts`. Test: `db/__tests__/sales.sync.test.ts`.

- [ ] **Step 1: Failing test** — `registerSale` inserts the sale with a `uuid` and a matching `pending` `sync_outbox` row whose JSON payload matches the backend `SalePayload` (money as fixed-2 strings, `cylinder_type_id = SERVER_P13_UUID`, `customer_id` = customer.uuid or null). `deleteSale` instead becomes a **void**: sets local `voided_at`, reverses local aggregates, and enqueues a `void_sale` event `{id: sale.uuid}` (no physical delete).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — wrap insert+enqueue in `db.withTransactionAsync`; replace physical delete with void. Keep list queries filtering `voided_at IS NULL` so the UI is unchanged.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): vendas geram evento de sync (e cancelamento vira void)`.

### Task 5.2: Restocks → `restock`; Inventory edit → `stock_adjustment`

**Files:** Modify `db/queries/inventory.ts`. Test: `db/__tests__/inventory.sync.test.ts`.

- [ ] **Step 1: Failing test** — `addRestock` enqueues a `restock` event. `updateInventory` (absolute set in the UI) computes **deltas** vs the current `full_qty`/`empty_qty` and enqueues one `stock_adjustment` per changed field (`field`,`delta`,`reason`). `updateCylinderPrice` enqueues a `cylinder_upsert` (`PUT /catalog/cylinder-types/{SERVER_P13_UUID}`) with a fresh `updated_at`.
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the three paths (delta computation reads current values first, same tx).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): restock/ajuste de estoque/preco geram eventos de sync`.

### Task 5.3: Customers → catalog upsert/delete; debt settle → `debt_settlement`

**Files:** Modify `db/queries/customers.ts`. Test: `db/__tests__/customers.sync.test.ts`.

- [ ] **Step 1: Failing test** — `addCustomer`/`updateCustomer` set/keep `uuid`, bump local `updated_at`, and enqueue a `customer_upsert` (`PUT /catalog/customers`). `deleteCustomer` enqueues a `customer_delete` (`DELETE /catalog/customers/{uuid}`) and keeps the existing local "block if balance owed" rule. `settleCustomerDebt` enqueues a `debt_settlement` event (amount string, payment_method).
- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement.** Note `customers` needs an `updated_at` column — add it in the v2 migration (Task 2.1) if not already; backfill `created_at`.
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** `feat(app): clientes e quitacao de fiado geram eventos de sync`.

---

## Phase 6 — Auth gate + sync UI (mobile)

### Task 6.1: Login screen + auth gate

**Files:** Create `app/login.tsx`. Modify `app/_layout.tsx`. Read `.../router/` docs for redirects.

- [ ] **Step 1:** Build `app/login.tsx` (email + senha fields, submit, error text, loading) using existing NativeWind styles.
- [ ] **Step 2:** In `_layout.tsx`, subscribe to `onAuthChange`; while unknown show splash; signed-out → redirect `/login`; signed-in → render tabs and `engine.start()`. On `signOutUser()` → `engine.stop()`.
- [ ] **Step 3: Verify** on device: cold start goes to login; after login, app stays logged in across full app restarts (persistence check).
- [ ] **Step 4: Commit** `feat(app): tela de login e gate de autenticacao`.

### Task 6.2: Sync status badge

**Files:** Create `components/SyncBadge.tsx`. Modify `app/(tabs)/_layout.tsx` header.

- [ ] **Step 1:** Badge reads `store/sync`: green "Sincronizado", amber "N pendentes" (and "há Xmin" when `oldestPendingAt` exceeds a threshold — the spec §5 staleness warning), grey "Offline".
- [ ] **Step 2:** Add a manual "Sincronizar agora" action (calls `engine.syncNow()`) and a logout button in a settings/header menu.
- [ ] **Step 3: Commit** `feat(app): badge de status de sync + sincronizar agora + logout`.

---

## Phase 7 — End-to-end verification + APK

- [ ] **Step 1:** `npx tsc --noEmit` clean; app boots in Expo Go / dev client.
- [ ] **Step 2: Two-device manual test** — log in on phone A and phone B (different staff accounts). Sale on A appears on B after sync; restock on B appears on A; cancel a sale on A → reversed on B; fiado balance converges; go offline on A, make 3 sales, reconnect → all push and appear on B. Verify no double-count of A's own events after they round-trip.
- [ ] **Step 3:** Reset/confirm a fresh install pulls full state (cache-of-server behavior).
- [ ] **Step 4: TL + QA subagent review** of the whole mobile diff (per user rule).
- [ ] **Step 5: Build APK** via EAS (see [[project_eas_build]]): `eas build -p android --profile preview`. Record the link.
- [ ] **Step 6:** Install the APK on a real phone, repeat the core two-device flow against production Cloud Run.
- [ ] **Step 7: Commit/merge** — open PR `feat/backend` → `main` (or a `feat/mobile-sync` branch), update HANDOFF + memory, share the APK link via `/changelog`.

---

## Self-review notes

- **Spec coverage:** offline-first queue (Phases 2,4,5), idempotent push by uuid (4.2), durable cursor pull (4.3), differentiated retry/re-auth (4.2), staleness UI (6.2), catalog LWW (5.2,5.3 + backend 1.2), void-as-event not delete (1.1,5.1), alerts already exist server-side. Migration §6 intentionally dropped (app not in production).
- **Backend gaps** (void, cylinder-types) are surfaced as Phase 1 rather than discovered mid-mobile-build.
- **Risk to watch at execution:** the local RN test harness — there is no test runner configured today (no jest in package.json). Task 2.x/4.x/5.x tests assume a sqlite-capable unit runner; first execution step in Phase 2 must **add jest + a sqlite shim** (or `better-sqlite3` for node-side logic tests) or downgrade those tasks to dev-boot assertions. Decide before Phase 2.
- **Open question for the user before Phase 1:** OK to add two small endpoints to the deployed backend (void-sale, cylinder-types upsert)? They're required for cancellation/price to sync.
