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

	// seedCustomer "Maria" já tem balance=300 → deve aparecer
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
