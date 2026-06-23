# Web Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dashboard web de relatórios financeiros para o Beto Gás — 5 endpoints Go novos + frontend React hospedado no Firebase Hosting.

**Architecture:** Backend Go com pacote `reports` usando SQL direto (sem sqlc) e CORS inline; frontend em `web/` com Vite + React + Tailwind v3 + Recharts + Firebase Auth. Auth via Bearer token (mesmo Firebase project do mobile).

**Tech Stack:** Go 1.22 + pgx/v5, React 18 + TypeScript + Vite, Tailwind CSS v3, Recharts, Firebase Web SDK v10, Firebase Hosting.

---

## File Map

### Backend (new)
- `backend/internal/reports/handlers.go` — Service + 5 métodos de query + 5 handlers HTTP
- `backend/internal/reports/handlers_test.go` — testes dos 5 service methods
- `backend/internal/reports/testutil_test.go` — testcontainer + seed
- `backend/internal/httpx/cors.go` — CORS middleware inline

### Backend (modified)
- `backend/internal/config/config.go` — campo `CORSOrigin`
- `backend/cmd/server/main.go` — registra reports routes + CORS global

### Web (new — tudo em `web/`)
- `package.json`, `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`
- `tailwind.config.js`, `postcss.config.js`, `index.html`, `.env.example`
- `src/main.tsx` — entry point
- `src/App.tsx` — router (Login vs Dashboard)
- `src/auth.ts` — Firebase init + helpers
- `src/api.ts` — fetch wrapper com auth token
- `src/pages/Login.tsx`
- `src/pages/Dashboard.tsx`
- `src/components/SummaryCards.tsx`
- `src/components/SalesSection.tsx`
- `src/components/ExpensesSection.tsx`
- `src/components/DebtorsSection.tsx`
- `src/components/InventorySection.tsx`

### Firebase Hosting (new — raiz do repo)
- `firebase.json`
- `.firebaserc`

---

## Task 1: Backend — CORS + config

**Files:**
- Create: `backend/internal/httpx/cors.go`
- Modify: `backend/internal/config/config.go`

- [ ] **Step 1: Criar `backend/internal/httpx/cors.go`**

```go
package httpx

import "net/http"

func CORS(origin string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

- [ ] **Step 2: Modificar `backend/internal/config/config.go`**

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
	CORSOrigin        string
}

func Load() (Config, error) {
	cfg := Config{
		DatabaseURL:       os.Getenv("DATABASE_URL"),
		Port:              os.Getenv("PORT"),
		FirebaseProjectID: os.Getenv("FIREBASE_PROJECT_ID"),
		CORSOrigin:        os.Getenv("CORS_ORIGIN"),
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
	if cfg.CORSOrigin == "" {
		cfg.CORSOrigin = "*"
	}
	return cfg, nil
}
```

- [ ] **Step 3: Verificar que config_test.go passa**

```
cd backend && go test ./internal/config/ -count=1
```

Esperado: `ok  github.com/pedrogomesdev/gas-manager-backend/internal/config`

- [ ] **Step 4: Commit**

```
git add backend/internal/httpx/cors.go backend/internal/config/config.go
git commit -m "feat(backend): CORS middleware + CORSOrigin config"
```

---

## Task 2: Backend — reports testutil + summary endpoint (TDD)

**Files:**
- Create: `backend/internal/reports/testutil_test.go`
- Create: `backend/internal/reports/handlers_test.go` (summary only)
- Create: `backend/internal/reports/handlers.go` (Service + Summary)

- [ ] **Step 1: Criar `backend/internal/reports/testutil_test.go`**

```go
package reports

import (
	"context"
	"os"
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
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(ctx) })

	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("conn string: %v", err)
	}

	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	applyMigrations(t, pool)
	seed(t, pool)
	return pool
}

func applyMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, name := range []string{
		"0001_init.up.sql",
		"0002_sync_errors.up.sql",
		"0004_sale_voids.up.sql",
		"0005_catalog_events.up.sql",
		"0006_expenses.up.sql",
	} {
		path := filepath.Join("..", "db", "migrations", name)
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		if _, err := pool.Exec(ctx, string(b)); err != nil {
			t.Fatalf("migrate %s: %v", name, err)
		}
	}
}

func seed(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`INSERT INTO users(id,name,role) VALUES ('` + seedUser + `','Pedro','admin')`,
		`INSERT INTO cylinder_types(id,name,weight_kg,sale_price,cost_price) VALUES ('` + seedType + `','P13',13,120,90)`,
		`INSERT INTO customers(id,name,balance,credit_limit,updated_at) VALUES ('` + seedCustomer + `','Maria',300,200,now())`,
		`INSERT INTO inventory(id,cylinder_type_id,full_qty,empty_qty) VALUES ('` + seedInvID + `','` + seedType + `',10,5)`,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}
```

- [ ] **Step 2: Escrever teste falho para Summary em `backend/internal/reports/handlers_test.go`**

```go
package reports

import (
	"context"
	"testing"
	"time"
)

func TestSummary_Aggregates(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	// Insert 2 sales and 1 expense with client_created_at = now()
	insertSale(t, pool, "s1", 2, 120, 90) // total=240, profit=60
	insertSale(t, pool, "s2", 1, 120, 90) // total=120, profit=30
	insertExpense(t, pool, "e1", "Gasolina", 50)

	from := time.Now().AddDate(0, -1, 0)
	to := time.Now().AddDate(0, 1, 0)

	got, err := svc.Summary(ctx, from, to)
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if got.Revenue != 360 {
		t.Errorf("revenue want 360, got %v", got.Revenue)
	}
	if got.Profit != 90 {
		t.Errorf("profit want 90, got %v", got.Profit)
	}
	if got.Expenses != 50 {
		t.Errorf("expenses want 50, got %v", got.Expenses)
	}
	if got.NetFlow != 310 {
		t.Errorf("net_flow want 310, got %v", got.NetFlow)
	}
}

// helpers usados por outros testes também
func insertSale(t *testing.T, pool interface{ Exec(context.Context, string, ...any) (interface{}, error) }, id string, qty int, unitPrice, costPrice float64) {
	t.Helper()
	_, err := pool.(*pgxpool.Pool).Exec(context.Background(), `
		INSERT INTO sales(id,cylinder_type_id,quantity,unit_price,cost_price,total,payment_method,payload_hash,created_by,client_created_at)
		VALUES ($1::UUID,$2::UUID,$3,$4,$5,$6,'dinheiro','hash-'||$1,$7,now())
	`, id+"000000000000000000000000", seedType, qty, unitPrice, costPrice, float64(qty)*unitPrice, seedUser)
	if err != nil {
		t.Fatalf("insertSale %s: %v", id, err)
	}
}

func insertExpense(t *testing.T, pool interface{ Exec(context.Context, string, ...any) (interface{}, error) }, id, category string, amount float64) {
	t.Helper()
	_, err := pool.(*pgxpool.Pool).Exec(context.Background(), `
		INSERT INTO expenses(id,category,amount,payload_hash,created_by,client_created_at)
		VALUES ($1::UUID,$2,$3,'hash-'||$1,$4,now())
	`, id+"000000000000000000000000", category, amount, seedUser)
	if err != nil {
		t.Fatalf("insertExpense %s: %v", id, err)
	}
}
```

**Nota:** os helpers de insert usam UUID sintético padded com zeros. O campo `id` do parâmetro é curto (e.g. "s1") e é padded para 36 chars (`s1000000...`). Na prática, é mais simples passar UUIDs reais — veja Step 3 abaixo com a versão corrigida.

- [ ] **Step 3: Reescrever helpers de insert com UUIDs válidos**

Substitua os helpers no `handlers_test.go` — eles precisam de UUIDs no formato `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`:

```go
package reports

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestSummary_Aggregates(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	insertSale(t, pool, "aaaaaaaa-0000-0000-0000-000000000001", 2, 120, 90)
	insertSale(t, pool, "aaaaaaaa-0000-0000-0000-000000000002", 1, 120, 90)
	insertExpense(t, pool, "bbbbbbbb-0000-0000-0000-000000000001", "Gasolina", 50)

	from := time.Now().AddDate(0, -1, 0)
	to := time.Now().AddDate(0, 1, 0)

	got, err := svc.Summary(ctx, from, to)
	if err != nil {
		t.Fatalf("Summary: %v", err)
	}
	if got.Revenue != 360 {
		t.Errorf("revenue want 360, got %v", got.Revenue)
	}
	if got.Profit != 90 {
		t.Errorf("profit want 90, got %v", got.Profit)
	}
	if got.Expenses != 50 {
		t.Errorf("expenses want 50, got %v", got.Expenses)
	}
	if got.NetFlow != 310 {
		t.Errorf("net_flow want 310, got %v", got.NetFlow)
	}
}

func insertSale(t *testing.T, pool *pgxpool.Pool, id string, qty int, unitPrice, costPrice float64) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO sales(id,cylinder_type_id,quantity,unit_price,cost_price,total,payment_method,payload_hash,created_by,client_created_at)
		VALUES ($1::UUID,$2::UUID,$3,$4,$5,$6,'dinheiro','hash-'||$1,$7,now())
	`, id, seedType, qty, unitPrice, costPrice, float64(qty)*unitPrice, seedUser)
	if err != nil {
		t.Fatalf("insertSale %s: %v", id, err)
	}
}

func insertExpense(t *testing.T, pool *pgxpool.Pool, id, category string, amount float64) {
	t.Helper()
	_, err := pool.Exec(context.Background(), `
		INSERT INTO expenses(id,category,amount,payload_hash,created_by,client_created_at)
		VALUES ($1::UUID,$2,$3,'hash-'||$1,$4,now())
	`, id, category, amount, seedUser)
	if err != nil {
		t.Fatalf("insertExpense %s: %v", id, err)
	}
}
```

- [ ] **Step 4: Rodar o teste para confirmar que falha (pacote não existe)**

```
cd backend && go test ./internal/reports/ -run TestSummary -v -count=1
```

Esperado: erro de compilação `no Go files in .../reports`

- [ ] **Step 5: Criar `backend/internal/reports/handlers.go` com Summary**

```go
package reports

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type SummaryResponse struct {
	Revenue  float64 `json:"revenue"`
	Profit   float64 `json:"profit"`
	Expenses float64 `json:"expenses"`
	NetFlow  float64 `json:"net_flow"`
}

type SalesDayRow struct {
	Day   string  `json:"day"`
	Total float64 `json:"total"`
	Count int     `json:"count"`
}

type SaleRow struct {
	ID              string  `json:"id"`
	CustomerName    string  `json:"customer_name"`
	PaymentMethod   string  `json:"payment_method"`
	Total           float64 `json:"total"`
	ClientCreatedAt string  `json:"client_created_at"`
}

type SalesResponse struct {
	ByDay []SalesDayRow `json:"by_day"`
	List  []SaleRow     `json:"list"`
}

type ExpenseCategoryRow struct {
	Category string  `json:"category"`
	Total    float64 `json:"total"`
}

type ExpenseRow struct {
	ID              string  `json:"id"`
	Category        string  `json:"category"`
	Description     string  `json:"description"`
	Amount          float64 `json:"amount"`
	ClientCreatedAt string  `json:"client_created_at"`
}

type ExpensesResponse struct {
	ByCategory []ExpenseCategoryRow `json:"by_category"`
	List       []ExpenseRow         `json:"list"`
}

type DebtorRow struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Balance     float64 `json:"balance"`
	CreditLimit float64 `json:"credit_limit"`
}

type DebtorsResponse struct {
	Total   float64     `json:"total"`
	Debtors []DebtorRow `json:"debtors"`
}

type InventoryRow struct {
	Name     string `json:"name"`
	FullQty  int32  `json:"full_qty"`
	EmptyQty int32  `json:"empty_qty"`
}

// parseDateRange lê ?from=YYYY-MM-DD&to=YYYY-MM-DD; default = mês atual no fuso de São Paulo.
func parseDateRange(r *http.Request) (from, to time.Time) {
	loc, _ := time.LoadLocation("America/Sao_Paulo")
	now := time.Now().In(loc)
	from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	to = time.Date(now.Year(), now.Month()+1, 0, 23, 59, 59, 0, loc)

	if s := r.URL.Query().Get("from"); s != "" {
		if t, err := time.ParseInLocation("2006-01-02", s, loc); err == nil {
			from = t
		}
	}
	if s := r.URL.Query().Get("to"); s != "" {
		if t, err := time.ParseInLocation("2006-01-02", s, loc); err == nil {
			to = time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, loc)
		}
	}
	return from, to
}

func (s *Service) Summary(ctx context.Context, from, to time.Time) (SummaryResponse, error) {
	var revenue, profit float64
	err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(total),0)::FLOAT8,
			COALESCE(SUM((unit_price - cost_price) * quantity),0)::FLOAT8
		FROM sales
		WHERE voided_at IS NULL AND client_created_at BETWEEN $1 AND $2
	`, from, to).Scan(&revenue, &profit)
	if err != nil {
		return SummaryResponse{}, err
	}

	var expenses float64
	err = s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount),0)::FLOAT8
		FROM expenses
		WHERE client_created_at BETWEEN $1 AND $2
	`, from, to).Scan(&expenses)
	if err != nil {
		return SummaryResponse{}, err
	}

	return SummaryResponse{
		Revenue:  revenue,
		Profit:   profit,
		Expenses: expenses,
		NetFlow:  revenue - expenses,
	}, nil
}

func (s *Service) HandleSummary(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r)
	data, err := s.Summary(r.Context(), from, to)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

// Sales, Expenses, Debtors, Inventory — implementados na Task 3
func (s *Service) HandleSales(w http.ResponseWriter, r *http.Request)     {}
func (s *Service) HandleExpenses(w http.ResponseWriter, r *http.Request)  {}
func (s *Service) HandleDebtors(w http.ResponseWriter, r *http.Request)   {}
func (s *Service) HandleInventory(w http.ResponseWriter, r *http.Request) {}
```

- [ ] **Step 6: Rodar teste para confirmar que passa**

```
cd backend && go test ./internal/reports/ -run TestSummary -v -count=1 -timeout 120s
```

Esperado: `PASS`

---

## Task 3: Backend — endpoints Sales, Expenses, Debtors, Inventory

**Files:**
- Modify: `backend/internal/reports/handlers.go` (implementar os 4 handlers)
- Modify: `backend/internal/reports/handlers_test.go` (adicionar 4 testes)

- [ ] **Step 1: Adicionar testes para Sales, Expenses, Debtors, Inventory no `handlers_test.go`**

Adicionar após `TestSummary_Aggregates`:

```go
func TestSales_ReturnsList(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	insertSale(t, pool, "aaaaaaaa-0000-0000-0000-000000000010", 1, 120, 90)
	insertSale(t, pool, "aaaaaaaa-0000-0000-0000-000000000011", 2, 120, 90)

	from := time.Now().AddDate(0, -1, 0)
	to := time.Now().AddDate(0, 1, 0)

	got, err := svc.Sales(ctx, from, to)
	if err != nil {
		t.Fatalf("Sales: %v", err)
	}
	if len(got.List) != 2 {
		t.Fatalf("want 2 sales, got %d", len(got.List))
	}
	if len(got.ByDay) == 0 {
		t.Error("ByDay should not be empty")
	}
	// segunda venda tem total=240
	totals := map[float64]bool{}
	for _, s := range got.List {
		totals[s.Total] = true
	}
	if !totals[120] || !totals[240] {
		t.Errorf("unexpected totals: %v", got.List)
	}
}

func TestExpenses_ReturnsByCategory(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	insertExpense(t, pool, "bbbbbbbb-0000-0000-0000-000000000010", "Gasolina", 150)
	insertExpense(t, pool, "bbbbbbbb-0000-0000-0000-000000000011", "Gasolina", 50)
	insertExpense(t, pool, "bbbbbbbb-0000-0000-0000-000000000012", "Pneu", 80)

	from := time.Now().AddDate(0, -1, 0)
	to := time.Now().AddDate(0, 1, 0)

	got, err := svc.Expenses(ctx, from, to)
	if err != nil {
		t.Fatalf("Expenses: %v", err)
	}
	if len(got.ByCategory) != 2 {
		t.Fatalf("want 2 categories, got %d", len(got.ByCategory))
	}
	// Gasolina (200) deve vir antes de Pneu (80)
	if got.ByCategory[0].Category != "Gasolina" {
		t.Errorf("want Gasolina first, got %s", got.ByCategory[0].Category)
	}
	if got.ByCategory[0].Total != 200 {
		t.Errorf("want Gasolina total 200, got %v", got.ByCategory[0].Total)
	}
	if len(got.List) != 3 {
		t.Fatalf("want 3 in list, got %d", len(got.List))
	}
}

func TestDebtors_ReturnsPositiveBalance(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	// seedCustomer "Maria" já tem balance=300, credit_limit=200 → deve aparecer
	// Adicionar um sem dívida
	_, err := pool.Exec(ctx, `
		INSERT INTO customers(id,name,balance,credit_limit,updated_at)
		VALUES ('cccccccc-0000-0000-0000-000000000001','João',0,500,now())
	`)
	if err != nil {
		t.Fatalf("seed extra customer: %v", err)
	}

	got, err := svc.Debtors(ctx)
	if err != nil {
		t.Fatalf("Debtors: %v", err)
	}
	if len(got.Debtors) != 1 {
		t.Fatalf("want 1 debtor, got %d", len(got.Debtors))
	}
	if got.Debtors[0].Name != "Maria" {
		t.Errorf("want Maria, got %s", got.Debtors[0].Name)
	}
	if got.Total != 300 {
		t.Errorf("want total 300, got %v", got.Total)
	}
}

func TestInventory_ReturnsStock(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	// seedInvID com full_qty=10, empty_qty=5 já está no seed
	got, err := svc.Inventory(ctx)
	if err != nil {
		t.Fatalf("Inventory: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("want 1 row, got %d", len(got))
	}
	if got[0].Name != "P13" {
		t.Errorf("want P13, got %s", got[0].Name)
	}
	if got[0].FullQty != 10 || got[0].EmptyQty != 5 {
		t.Errorf("want full=10 empty=5, got full=%d empty=%d", got[0].FullQty, got[0].EmptyQty)
	}
}
```

- [ ] **Step 2: Rodar para confirmar que falha**

```
cd backend && go test ./internal/reports/ -v -count=1 -timeout 120s
```

Esperado: erros de compilação por métodos não implementados.

- [ ] **Step 3: Implementar Sales, Expenses, Debtors, Inventory em `handlers.go`**

Substituir os stubs na parte de baixo de `handlers.go` pelo código completo:

```go
func (s *Service) Sales(ctx context.Context, from, to time.Time) (SalesResponse, error) {
	byDayRows, err := s.pool.Query(ctx, `
		SELECT
			to_char(client_created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
			SUM(total)::FLOAT8,
			COUNT(*)::INT
		FROM sales
		WHERE voided_at IS NULL AND client_created_at BETWEEN $1 AND $2
		GROUP BY 1 ORDER BY 1
	`, from, to)
	if err != nil {
		return SalesResponse{}, err
	}
	defer byDayRows.Close()
	var byDay []SalesDayRow
	for byDayRows.Next() {
		var row SalesDayRow
		if err := byDayRows.Scan(&row.Day, &row.Total, &row.Count); err != nil {
			return SalesResponse{}, err
		}
		byDay = append(byDay, row)
	}
	if byDay == nil {
		byDay = []SalesDayRow{}
	}

	listRows, err := s.pool.Query(ctx, `
		SELECT
			s.id::TEXT,
			COALESCE(c.name, 'Balcão'),
			s.payment_method,
			s.total::FLOAT8,
			s.client_created_at::TEXT
		FROM sales s
		LEFT JOIN customers c ON s.customer_id = c.id
		WHERE s.voided_at IS NULL AND s.client_created_at BETWEEN $1 AND $2
		ORDER BY s.client_created_at DESC
		LIMIT 100
	`, from, to)
	if err != nil {
		return SalesResponse{}, err
	}
	defer listRows.Close()
	var list []SaleRow
	for listRows.Next() {
		var row SaleRow
		if err := listRows.Scan(&row.ID, &row.CustomerName, &row.PaymentMethod, &row.Total, &row.ClientCreatedAt); err != nil {
			return SalesResponse{}, err
		}
		list = append(list, row)
	}
	if list == nil {
		list = []SaleRow{}
	}

	return SalesResponse{ByDay: byDay, List: list}, nil
}

func (s *Service) HandleSales(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r)
	data, err := s.Sales(r.Context(), from, to)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Service) Expenses(ctx context.Context, from, to time.Time) (ExpensesResponse, error) {
	catRows, err := s.pool.Query(ctx, `
		SELECT category, SUM(amount)::FLOAT8
		FROM expenses
		WHERE client_created_at BETWEEN $1 AND $2
		GROUP BY category ORDER BY 2 DESC
	`, from, to)
	if err != nil {
		return ExpensesResponse{}, err
	}
	defer catRows.Close()
	var byCategory []ExpenseCategoryRow
	for catRows.Next() {
		var row ExpenseCategoryRow
		if err := catRows.Scan(&row.Category, &row.Total); err != nil {
			return ExpensesResponse{}, err
		}
		byCategory = append(byCategory, row)
	}
	if byCategory == nil {
		byCategory = []ExpenseCategoryRow{}
	}

	listRows, err := s.pool.Query(ctx, `
		SELECT id::TEXT, category, COALESCE(description,''), amount::FLOAT8, client_created_at::TEXT
		FROM expenses
		WHERE client_created_at BETWEEN $1 AND $2
		ORDER BY client_created_at DESC
		LIMIT 100
	`, from, to)
	if err != nil {
		return ExpensesResponse{}, err
	}
	defer listRows.Close()
	var list []ExpenseRow
	for listRows.Next() {
		var row ExpenseRow
		if err := listRows.Scan(&row.ID, &row.Category, &row.Description, &row.Amount, &row.ClientCreatedAt); err != nil {
			return ExpensesResponse{}, err
		}
		list = append(list, row)
	}
	if list == nil {
		list = []ExpenseRow{}
	}

	return ExpensesResponse{ByCategory: byCategory, List: list}, nil
}

func (s *Service) HandleExpenses(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r)
	data, err := s.Expenses(r.Context(), from, to)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Service) Debtors(ctx context.Context) (DebtorsResponse, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::TEXT, name, balance::FLOAT8, COALESCE(credit_limit,0)::FLOAT8
		FROM customers
		WHERE balance > 0
		ORDER BY balance DESC
	`)
	if err != nil {
		return DebtorsResponse{}, err
	}
	defer rows.Close()
	var debtors []DebtorRow
	var total float64
	for rows.Next() {
		var row DebtorRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Balance, &row.CreditLimit); err != nil {
			return DebtorsResponse{}, err
		}
		total += row.Balance
		debtors = append(debtors, row)
	}
	if debtors == nil {
		debtors = []DebtorRow{}
	}
	return DebtorsResponse{Total: total, Debtors: debtors}, nil
}

func (s *Service) HandleDebtors(w http.ResponseWriter, r *http.Request) {
	data, err := s.Debtors(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Service) Inventory(ctx context.Context) ([]InventoryRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT ct.name, i.full_qty::INT, i.empty_qty::INT
		FROM inventory i
		JOIN cylinder_types ct ON ct.id = i.cylinder_type_id
		WHERE ct.active = true
		ORDER BY ct.name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []InventoryRow
	for rows.Next() {
		var row InventoryRow
		if err := rows.Scan(&row.Name, &row.FullQty, &row.EmptyQty); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if out == nil {
		out = []InventoryRow{}
	}
	return out, nil
}

func (s *Service) HandleInventory(w http.ResponseWriter, r *http.Request) {
	data, err := s.Inventory(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}
```

- [ ] **Step 4: Rodar todos os testes do pacote reports**

```
cd backend && go test ./internal/reports/ -v -count=1 -timeout 300s
```

Esperado: 5 testes passando (`TestSummary_Aggregates`, `TestSales_ReturnsList`, `TestExpenses_ReturnsByCategory`, `TestDebtors_ReturnsPositiveBalance`, `TestInventory_ReturnsStock`)

- [ ] **Step 5: Commit**

```
git add backend/internal/reports/
git commit -m "feat(backend/reports): 5 endpoints de relatorios com testes"
```

---

## Task 4: Backend — Wire reports + CORS ao main.go + deploy

**Files:**
- Modify: `backend/cmd/server/main.go`

- [ ] **Step 1: Modificar `backend/cmd/server/main.go`**

```go
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/alerts"
	"github.com/pedrogomesdev/gas-manager-backend/internal/auth"
	"github.com/pedrogomesdev/gas-manager-backend/internal/catalog"
	"github.com/pedrogomesdev/gas-manager-backend/internal/config"
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
	"github.com/pedrogomesdev/gas-manager-backend/internal/reports"
	"github.com/pedrogomesdev/gas-manager-backend/internal/sync"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	verifier, err := auth.NewFirebaseVerifier(ctx, cfg.FirebaseProjectID, os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"))
	if err != nil {
		return err
	}

	authMW := auth.Middleware(verifier, auth.NewDBUserLoader(pool), time.Now)

	router := newRouter(
		sync.NewService(pool),
		catalog.NewService(pool),
		alerts.NewService(pool),
		reports.NewService(pool),
		authMW,
		httpx.CORS(cfg.CORSOrigin),
		pool.Ping,
	)

	log.Printf("listening on :%s", cfg.Port)
	return http.ListenAndServe(":"+cfg.Port, router)
}

func newRouter(
	syncSvc *sync.Service,
	catalogSvc *catalog.Service,
	alertsSvc *alerts.Service,
	reportsSvc *reports.Service,
	authMW func(http.Handler) http.Handler,
	corsMW func(http.Handler) http.Handler,
	ready func(context.Context) error,
) http.Handler {
	r := chi.NewRouter()
	r.Use(corsMW)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if err := ready(ctx); err != nil {
			http.Error(w, "db unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	r.Group(func(r chi.Router) {
		r.Use(authMW)
		r.Post("/sync/push", syncSvc.HandlePush)
		r.Post("/sync/void-sale", syncSvc.HandleVoidSale)
		r.Get("/sync/pull", syncSvc.HandlePull)
		r.Get("/sync/errors", syncSvc.HandleSyncErrors)
		r.Put("/catalog/customers", catalogSvc.HandleUpsertCustomer)
		r.Delete("/catalog/customers/{id}", catalogSvc.HandleDeleteCustomer)
		r.Put("/catalog/cylinder-types/{id}", catalogSvc.HandleUpdateCylinderType)
		r.Get("/alerts/negative-stock", alertsSvc.HandleNegativeStock)
		r.Get("/alerts/over-limit-balance", alertsSvc.HandleOverLimitBalance)
		r.Get("/reports/summary", reportsSvc.HandleSummary)
		r.Get("/reports/sales", reportsSvc.HandleSales)
		r.Get("/reports/expenses", reportsSvc.HandleExpenses)
		r.Get("/reports/debtors", reportsSvc.HandleDebtors)
		r.Get("/inventory", reportsSvc.HandleInventory)
	})

	return r
}
```

- [ ] **Step 2: Verificar que o main_test.go ainda compila e passa**

```
cd backend && go build ./... && go test ./cmd/server/ -count=1
```

Esperado: sem erros de compilação, testes passando.

- [ ] **Step 3: Setar CORS_ORIGIN na variável de ambiente do Cloud Run**

```powershell
gcloud run services update gas-backend `
  --region southamerica-east1 `
  --project gas-manager-499616 `
  --set-env-vars "CORS_ORIGIN=https://gas-manager-499616.web.app"
```

- [ ] **Step 4: Deploy do backend**

```powershell
gcloud run deploy gas-backend --source backend --region southamerica-east1 --project gas-manager-499616 --quiet
```

Aguardar revisão ativa. Verificar: `curl https://gas-backend-750551393506.southamerica-east1.run.app/readyz`

- [ ] **Step 5: Commit**

```
git add backend/cmd/server/main.go
git commit -m "feat(backend): wire reports endpoints + CORS global"
```

---

## Task 5: Web — scaffold Vite + React + Tailwind + Recharts

**Files:** Todos em `web/`

- [ ] **Step 1: Criar o projeto Vite dentro de `web/`**

```powershell
npm create vite@latest web -- --template react-ts
```

- [ ] **Step 2: Instalar dependências**

```powershell
cd web
npm install
npm install recharts firebase
npm install -D tailwindcss@3 postcss autoprefixer
npx tailwindcss init -p
```

- [ ] **Step 3: Configurar Tailwind — substituir `web/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 4: Substituir `web/src/index.css`** (arquivo gerado pelo Vite)

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Substituir `web/index.html`**

```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Beto Gás — Dashboard</title>
  </head>
  <body class="bg-gray-50 text-gray-900">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Criar `web/.env.example`**

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_BACKEND_URL=https://gas-backend-750551393506.southamerica-east1.run.app
```

- [ ] **Step 7: Criar `web/.env.local`** com os valores reais do Firebase (copiar do `.env.local` da raiz do projeto)

Os valores do Firebase para o projeto `gas-manager-499616` já estão em `../.env.local`. Copiar as 3 vars `EXPO_PUBLIC_FIREBASE_*` → renomear para `VITE_FIREBASE_*`. BACKEND_URL conforme o `.env.example` acima.

- [ ] **Step 8: Verificar que `npm run dev` sobe sem erro**

```
cd web && npm run dev
```

Esperado: `VITE v5.x ready` rodando em `http://localhost:5173`. A página padrão do Vite aparece no browser — isso confirma que o scaffold funciona.

- [ ] **Step 9: Commit (fora de web/)**

```
cd ..
git add web/
git commit -m "feat(web): scaffold Vite + React + Tailwind + Recharts"
```

---

## Task 6: Web — Firebase Auth + API client

**Files:**
- Create: `web/src/auth.ts`
- Create: `web/src/api.ts`

- [ ] **Step 1: Criar `web/src/auth.ts`**

```ts
import { initializeApp, getApps } from 'firebase/app'
import {
  getAuth,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  type User,
} from 'firebase/auth'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
}

if (!getApps().length) {
  initializeApp(firebaseConfig)
}

export const auth = getAuth()

export function login(email: string, password: string) {
  return signInWithEmailAndPassword(auth, email, password)
}

export function logout() {
  return signOut(auth)
}

export function onAuth(cb: (user: User | null) => void) {
  return onAuthStateChanged(auth, cb)
}
```

- [ ] **Step 2: Criar `web/src/api.ts`**

```ts
import { auth } from './auth'

const BASE = import.meta.env.VITE_BACKEND_URL as string

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const token = await auth.currentUser?.getIdToken()
  const url = new URL(BASE + path)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token ?? ''}` },
  })
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return res.json()
}

export interface SummaryData {
  revenue: number
  profit: number
  expenses: number
  net_flow: number
}

export interface SalesDayRow {
  day: string
  total: number
  count: number
}

export interface SaleRow {
  id: string
  customer_name: string
  payment_method: string
  total: number
  client_created_at: string
}

export interface SalesData {
  by_day: SalesDayRow[]
  list: SaleRow[]
}

export interface ExpenseCategoryRow {
  category: string
  total: number
}

export interface ExpenseRow {
  id: string
  category: string
  description: string
  amount: number
  client_created_at: string
}

export interface ExpensesData {
  by_category: ExpenseCategoryRow[]
  list: ExpenseRow[]
}

export interface DebtorRow {
  id: string
  name: string
  balance: number
  credit_limit: number
}

export interface DebtorsData {
  total: number
  debtors: DebtorRow[]
}

export interface InventoryRow {
  name: string
  full_qty: number
  empty_qty: number
}

export function fetchSummary(from: string, to: string) {
  return get<SummaryData>('/reports/summary', { from, to })
}

export function fetchSales(from: string, to: string) {
  return get<SalesData>('/reports/sales', { from, to })
}

export function fetchExpenses(from: string, to: string) {
  return get<ExpensesData>('/reports/expenses', { from, to })
}

export function fetchDebtors() {
  return get<DebtorsData>('/reports/debtors')
}

export function fetchInventory() {
  return get<InventoryRow[]>('/inventory')
}
```

- [ ] **Step 3: Verificar que não há erros de TypeScript**

```
cd web && npx tsc --noEmit
```

Esperado: sem erros.

- [ ] **Step 4: Commit**

```
cd .. && git add web/src/auth.ts web/src/api.ts
git commit -m "feat(web): Firebase Auth + API client tipado"
```

---

## Task 7: Web — Login page + App router

**Files:**
- Create: `web/src/pages/Login.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Criar `web/src/pages/Login.tsx`**

```tsx
import { useState, FormEvent } from 'react'
import { login } from '../auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(email, password)
    } catch {
      setError('Email ou senha inválidos.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-2">Beto Gás</h1>
        <p className="text-gray-500 text-center text-sm mb-8">Dashboard de relatórios</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="pedro@gmail.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Senha</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-50"
          >
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Criar `web/src/App.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { type User } from 'firebase/auth'
import { onAuth } from './auth'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)

  useEffect(() => {
    return onAuth(setUser)
  }, [])

  if (user === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-400">Carregando...</p>
      </div>
    )
  }

  if (!user) return <Login />
  return <Dashboard user={user} />
}
```

- [ ] **Step 3: Criar placeholder `web/src/pages/Dashboard.tsx`** (implementado na Task 8)

```tsx
import { type User } from 'firebase/auth'

interface Props { user: User }

export default function Dashboard({ user }: Props) {
  return (
    <div className="p-8">
      <p>Olá, {user.email}</p>
      <p>Dashboard em construção…</p>
    </div>
  )
}
```

- [ ] **Step 4: Modificar `web/src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Step 5: Testar login no browser**

```
cd web && npm run dev
```

Abrir `http://localhost:5173`. Deve aparecer a tela de login. Entrar com `pedro@gmail.com` / `123456` (ou a senha atual). Deve mostrar "Dashboard em construção…".

- [ ] **Step 6: Commit**

```
cd .. && git add web/src/
git commit -m "feat(web): login page + app router com Firebase Auth"
```

---

## Task 8: Web — Dashboard + Visão Geral

**Files:**
- Create: `web/src/components/SummaryCards.tsx`
- Modify: `web/src/pages/Dashboard.tsx`

- [ ] **Step 1: Criar `web/src/components/SummaryCards.tsx`**

```tsx
import { type SummaryData } from '../api'

interface Props {
  data: SummaryData
}

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function SummaryCards({ data }: Props) {
  const cards = [
    { label: 'Receita', value: fmt(data.revenue), color: 'bg-blue-50 border-blue-200' },
    { label: 'Lucro Bruto', value: fmt(data.profit), color: 'bg-green-50 border-green-200' },
    { label: 'Despesas', value: fmt(data.expenses), color: 'bg-red-50 border-red-200' },
    { label: 'Fluxo Líquido', value: fmt(data.net_flow), color: data.net_flow >= 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {cards.map(c => (
        <div key={c.label} className={`border rounded-xl p-4 ${c.color}`}>
          <p className="text-xs text-gray-500 uppercase tracking-wide">{c.label}</p>
          <p className="text-xl font-bold mt-1">{c.value}</p>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Substituir `web/src/pages/Dashboard.tsx` com shell completo + Visão Geral**

```tsx
import { useEffect, useState, useCallback } from 'react'
import { type User } from 'firebase/auth'
import { logout } from '../auth'
import {
  fetchSummary, fetchSales, fetchExpenses, fetchDebtors, fetchInventory,
  type SummaryData, type SalesData, type ExpensesData, type DebtorsData, type InventoryRow,
} from '../api'
import SummaryCards from '../components/SummaryCards'
import SalesSection from '../components/SalesSection'
import ExpensesSection from '../components/ExpensesSection'
import DebtorsSection from '../components/DebtorsSection'
import InventorySection from '../components/InventorySection'

interface Props { user: User }

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function firstOfMonthStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

export default function Dashboard({ user }: Props) {
  const [from, setFrom] = useState(firstOfMonthStr)
  const [to, setTo] = useState(todayStr)
  const [summary, setSummary] = useState<SummaryData | null>(null)
  const [sales, setSales] = useState<SalesData | null>(null)
  const [expenses, setExpenses] = useState<ExpensesData | null>(null)
  const [debtors, setDebtors] = useState<DebtorsData | null>(null)
  const [inventory, setInventory] = useState<InventoryRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [s, sa, ex, de, inv] = await Promise.all([
        fetchSummary(from, to),
        fetchSales(from, to),
        fetchExpenses(from, to),
        fetchDebtors(),
        fetchInventory(),
      ])
      setSummary(s)
      setSales(sa)
      setExpenses(ex)
      setDebtors(de)
      setInventory(inv)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { load() }, [load])

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <h1 className="text-lg font-bold">⛽ Beto Gás</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-600">De</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="border rounded px-2 py-1 text-sm" />
          <label className="text-sm text-gray-600">Até</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="border rounded px-2 py-1 text-sm" />
          <button onClick={load}
            className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700">
            Atualizar
          </button>
          <button onClick={() => logout()}
            className="text-gray-400 hover:text-gray-600 text-sm ml-2">
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        {loading && <p className="text-center text-gray-400">Carregando…</p>}
        {error && <p className="text-center text-red-500">{error}</p>}

        {summary && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Visão Geral</h2>
            <SummaryCards data={summary} />
          </section>
        )}

        {sales && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Vendas</h2>
            <SalesSection data={sales} />
          </section>
        )}

        {expenses && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Despesas</h2>
            <ExpensesSection data={expenses} />
          </section>
        )}

        {debtors && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Fiado</h2>
            <DebtorsSection data={debtors} />
          </section>
        )}

        {inventory && (
          <section>
            <h2 className="text-sm font-semibold uppercase text-gray-500 mb-3">Estoque</h2>
            <InventorySection data={inventory} />
          </section>
        )}
      </main>
    </div>
  )
}
```

**Nota:** `SalesSection`, `ExpensesSection`, `DebtorsSection`, `InventorySection` são criados nas Tasks 9 e 10 como placeholders primeiro.

- [ ] **Step 3: Criar placeholders para os 4 componentes restantes**

`web/src/components/SalesSection.tsx`:
```tsx
import { type SalesData } from '../api'
export default function SalesSection({ data }: { data: SalesData }) {
  return <div className="bg-white rounded-xl border p-4">Em construção ({data.list.length} vendas)</div>
}
```

`web/src/components/ExpensesSection.tsx`:
```tsx
import { type ExpensesData } from '../api'
export default function ExpensesSection({ data }: { data: ExpensesData }) {
  return <div className="bg-white rounded-xl border p-4">Em construção ({data.list.length} despesas)</div>
}
```

`web/src/components/DebtorsSection.tsx`:
```tsx
import { type DebtorsData } from '../api'
export default function DebtorsSection({ data }: { data: DebtorsData }) {
  return <div className="bg-white rounded-xl border p-4">Em construção ({data.debtors.length} devedores)</div>
}
```

`web/src/components/InventorySection.tsx`:
```tsx
import { type InventoryRow } from '../api'
export default function InventorySection({ data }: { data: InventoryRow[] }) {
  return <div className="bg-white rounded-xl border p-4">Em construção ({data.length} tipos)</div>
}
```

- [ ] **Step 4: Testar no browser**

```
cd web && npm run dev
```

Fazer login → deve ver o top bar com date picker, os 4 cards de Visão Geral com valores reais do backend, e 4 placeholders "Em construção". Confirmar que os números de Receita/Lucro/Despesas/Fluxo são coerentes.

- [ ] **Step 5: Commit**

```
cd .. && git add web/src/
git commit -m "feat(web): dashboard shell + Visao Geral com SummaryCards"
```

---

## Task 9: Web — SalesSection (chart + tabela)

**Files:**
- Modify: `web/src/components/SalesSection.tsx`

- [ ] **Step 1: Substituir `web/src/components/SalesSection.tsx`**

```tsx
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { type SalesData } from '../api'

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

const METHOD_LABELS: Record<string, string> = {
  dinheiro: 'Dinheiro',
  pix: 'PIX',
  fiado: 'Fiado',
  cartao: 'Cartão',
}

export default function SalesSection({ data }: { data: SalesData }) {
  const chartData = data.by_day.map(r => ({
    day: fmtDate(r.day + 'T12:00:00'),
    total: r.total,
  }))

  return (
    <div className="space-y-6">
      {/* Gráfico de barras */}
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold text-gray-600 mb-3">Receita por dia</p>
        {chartData.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Sem vendas no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 40 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={v => `R$${v}`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Bar dataKey="total" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Pagamento</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.list.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-8">Sem vendas</td>
              </tr>
            )}
            {data.list.map(s => (
              <tr key={s.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{s.customer_name}</td>
                <td className="px-4 py-3">{METHOD_LABELS[s.payment_method] ?? s.payment_method}</td>
                <td className="px-4 py-3 text-right font-medium">{fmt(s.total)}</td>
                <td className="px-4 py-3 text-right text-gray-500">
                  {new Date(s.client_created_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Testar no browser**

```
cd web && npm run dev
```

Seção "Vendas" deve mostrar gráfico de barras e tabela com as vendas do período.

- [ ] **Step 3: Commit**

```
cd .. && git add web/src/components/SalesSection.tsx
git commit -m "feat(web): SalesSection com grafico de barras e tabela"
```

---

## Task 10: Web — Despesas, Fiado, Estoque

**Files:**
- Modify: `web/src/components/ExpensesSection.tsx`
- Modify: `web/src/components/DebtorsSection.tsx`
- Modify: `web/src/components/InventorySection.tsx`

- [ ] **Step 1: Substituir `web/src/components/ExpensesSection.tsx`**

```tsx
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { type ExpensesData } from '../api'

const COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6']

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function ExpensesSection({ data }: { data: ExpensesData }) {
  const pieData = data.by_category.map(r => ({ name: r.category, value: r.total }))

  return (
    <div className="space-y-6">
      {/* Pie chart */}
      <div className="bg-white rounded-xl border p-4">
        <p className="text-sm font-semibold text-gray-600 mb-3">Por categoria</p>
        {pieData.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">Sem despesas no período</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => fmt(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Lista */}
      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Categoria</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Descrição</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Valor</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Data</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.list.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-8">Sem despesas</td>
              </tr>
            )}
            {data.list.map(e => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">{e.category}</td>
                <td className="px-4 py-3 text-gray-500">{e.description || '—'}</td>
                <td className="px-4 py-3 text-right font-medium text-red-600">{fmt(e.amount)}</td>
                <td className="px-4 py-3 text-right text-gray-500">
                  {new Date(e.client_created_at).toLocaleDateString('pt-BR')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Substituir `web/src/components/DebtorsSection.tsx`**

```tsx
import { type DebtorsData } from '../api'

function fmt(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function DebtorsSection({ data }: { data: DebtorsData }) {
  return (
    <div className="space-y-4">
      <div className="bg-red-50 border border-red-200 rounded-xl p-4 inline-block">
        <p className="text-xs text-red-500 uppercase tracking-wide">Total em aberto</p>
        <p className="text-2xl font-bold text-red-700">{fmt(data.total)}</p>
      </div>

      <div className="bg-white rounded-xl border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Cliente</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Saldo Devedor</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Limite</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Acima do Limite</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.debtors.length === 0 && (
              <tr>
                <td colSpan={4} className="text-center text-gray-400 py-8">Nenhum devedor</td>
              </tr>
            )}
            {data.debtors.map(d => {
              const over = d.credit_limit > 0 && d.balance > d.credit_limit
              return (
                <tr key={d.id} className={`hover:bg-gray-50 ${over ? 'bg-red-50' : ''}`}>
                  <td className="px-4 py-3 font-medium">{d.name}</td>
                  <td className="px-4 py-3 text-right text-red-600 font-semibold">{fmt(d.balance)}</td>
                  <td className="px-4 py-3 text-right text-gray-500">{d.credit_limit > 0 ? fmt(d.credit_limit) : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {over ? <span className="text-red-600 font-semibold">⚠ {fmt(d.balance - d.credit_limit)}</span> : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Substituir `web/src/components/InventorySection.tsx`**

```tsx
import { type InventoryRow } from '../api'

export default function InventorySection({ data }: { data: InventoryRow[] }) {
  return (
    <div className="bg-white rounded-xl border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-gray-600">Tipo</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Cheios</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Vazios</th>
            <th className="text-right px-4 py-3 font-medium text-gray-600">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {data.length === 0 && (
            <tr>
              <td colSpan={4} className="text-center text-gray-400 py-8">Sem dados de estoque</td>
            </tr>
          )}
          {data.map(r => (
            <tr key={r.name} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-medium">{r.name}</td>
              <td className={`px-4 py-3 text-right font-semibold ${r.full_qty < 0 ? 'text-red-600' : 'text-green-700'}`}>
                {r.full_qty}
              </td>
              <td className="px-4 py-3 text-right">{r.empty_qty}</td>
              <td className="px-4 py-3 text-right text-gray-500">{r.full_qty + r.empty_qty}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 4: Testar tudo no browser**

```
cd web && npm run dev
```

Verificar:
- Visão Geral: 4 cards com valores
- Vendas: gráfico de barras + tabela de vendas
- Despesas: pie chart por categoria + lista
- Fiado: total em aberto + ranking de devedores (destacar quem passou do limite)
- Estoque: tabela com cheios/vazios (vermelho se negativo)

- [ ] **Step 5: Commit**

```
cd .. && git add web/src/components/
git commit -m "feat(web): ExpensesSection, DebtorsSection, InventorySection"
```

---

## Task 11: Firebase Hosting — build + deploy

**Files:**
- Create: `firebase.json` (raiz do repo)
- Create: `.firebaserc` (raiz do repo)

- [ ] **Step 1: Criar `firebase.json`**

```json
{
  "hosting": {
    "public": "web/dist",
    "ignore": [
      "firebase.json",
      "**/.*",
      "**/node_modules/**"
    ],
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

- [ ] **Step 2: Criar `.firebaserc`**

```json
{
  "projects": {
    "default": "gas-manager-499616"
  }
}
```

- [ ] **Step 3: Build de produção**

```powershell
cd web && npm run build
```

Esperado: pasta `web/dist/` gerada sem erros.

- [ ] **Step 4: Login no Firebase CLI (se necessário)**

```powershell
npx firebase-tools login
```

Se já logado (`devgomesss@gmail.com`): pular.

- [ ] **Step 5: Deploy para Firebase Hosting**

```powershell
cd .. && npx firebase-tools deploy --only hosting
```

Esperado: URL `https://gas-manager-499616.web.app` como saída.

- [ ] **Step 6: Atualizar CORS no Cloud Run com a URL do Hosting**

Se a URL for `https://gas-manager-499616.web.app`:

```powershell
gcloud run services update gas-backend `
  --region southamerica-east1 `
  --project gas-manager-499616 `
  --set-env-vars "CORS_ORIGIN=https://gas-manager-499616.web.app"
```

- [ ] **Step 7: Testar a URL de produção no browser**

Abrir `https://gas-manager-499616.web.app`. Fazer login → Dashboard deve carregar com dados reais do backend.

- [ ] **Step 8: Commit final**

```
git add firebase.json .firebaserc
git commit -m "feat(web): Firebase Hosting config + deploy producao"
```

---

## Verificação final

Após completar todos os tasks, rodar a suíte completa:

```powershell
# Backend (Docker Desktop deve estar rodando)
cd backend && go test ./... -count=1 -timeout 300s

# Frontend TypeScript
cd ../web && npx tsc --noEmit && npm run build
```

Esperado: todos os testes Go passando + build do frontend sem erros.
