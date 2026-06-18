package sync

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// cashSale is a paid-in-full sale: voiding it must NOT touch the customer balance.
func cashSale(id string, qty int) PushEvent {
	cust := seedCustomer
	return PushEvent{Kind: "sale", ID: id, ClientCreatedAt: time.Now(),
		Sale: &SalePayload{CustomerID: &cust, CylinderTypeID: seedType, Quantity: qty,
			UnitPrice: "120", CostPrice: "90", Total: "120", PaymentMethod: "cash"}}
}

// exchangeFiadoSale builds a fiado sale that also takes an empty cylinder in
// exchange, so voiding it must reverse full_qty, empty_qty and the balance.
func exchangeFiadoSale(id string, qty int) PushEvent {
	cust := seedCustomer
	return PushEvent{Kind: "sale", ID: id, ClientCreatedAt: time.Now(),
		Sale: &SalePayload{CustomerID: &cust, CylinderTypeID: seedType, Quantity: qty,
			UnitPrice: "120", CostPrice: "90", Total: "240.00", PaymentMethod: "fiado",
			IsExchange: true}}
}

func readAggregates(t *testing.T, svc *Service) (full, empty int, bal float64) {
	t.Helper()
	ctx := context.Background()
	svc.pool.QueryRow(ctx, `SELECT full_qty, empty_qty FROM inventory WHERE cylinder_type_id=$1`, seedType).Scan(&full, &empty)
	svc.pool.QueryRow(ctx, `SELECT balance FROM customers WHERE id=$1`, seedCustomer).Scan(&bal)
	return
}

func TestVoidSale_reversesAggregatesOnce(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	saleID := "bbbbbbbb-0000-0000-0000-000000000001"
	res, err := svc.Push(ctx, seedUser, []PushEvent{exchangeFiadoSale(saleID, 2)})
	if err != nil || res[0].Status != "applied" {
		t.Fatalf("setup push failed: %v / %s", err, res[0].Status)
	}
	// After the sale: full 10->8, empty 0->2, balance 0->240.
	if full, empty, bal := readAggregates(t, svc); full != 8 || empty != 2 || bal != 240 {
		t.Fatalf("post-sale want 8/2/240, got %d/%d/%v", full, empty, bal)
	}

	if err := svc.VoidSale(ctx, seedUser, saleID); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}

	// voided_at / voided_by stamped.
	var voidedAt *time.Time
	var voidedBy *string
	pool.QueryRow(ctx, `SELECT voided_at, voided_by FROM sales WHERE id=$1`, saleID).Scan(&voidedAt, &voidedBy)
	if voidedAt == nil {
		t.Fatalf("voided_at must be set")
	}
	if voidedBy == nil || *voidedBy != seedUser {
		t.Fatalf("voided_by want %s, got %v", seedUser, voidedBy)
	}

	// Aggregates back to baseline.
	if full, empty, bal := readAggregates(t, svc); full != 10 || empty != 0 || bal != 0 {
		t.Fatalf("post-void want 10/0/0, got %d/%d/%v", full, empty, bal)
	}

	// Second void is idempotent: no second reversal.
	if err := svc.VoidSale(ctx, seedUser, saleID); err != nil {
		t.Fatalf("second VoidSale: %v", err)
	}
	if full, empty, bal := readAggregates(t, svc); full != 10 || empty != 0 || bal != 0 {
		t.Fatalf("idempotent void want 10/0/0, got %d/%d/%v", full, empty, bal)
	}
}

func TestVoidSale_cashSaleDoesNotTouchBalance(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	id := "bbbbbbbb-0000-0000-0000-000000000010"
	if res, _ := svc.Push(ctx, seedUser, []PushEvent{cashSale(id, 1)}); res[0].Status != "applied" {
		t.Fatalf("setup push: %s", res[0].Status)
	}
	if _, _, bal := readAggregates(t, svc); bal != 0 {
		t.Fatalf("cash sale must not move balance, got %v", bal)
	}
	if err := svc.VoidSale(ctx, seedUser, id); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}
	if full, empty, bal := readAggregates(t, svc); full != 10 || empty != 0 || bal != 0 {
		t.Fatalf("post-void want 10/0/0, got %d/%d/%v", full, empty, bal)
	}
}

func TestVoidSale_nonExchangeDoesNotTouchEmpty(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	id := "bbbbbbbb-0000-0000-0000-000000000011"
	svc.Push(ctx, seedUser, []PushEvent{saleEvent(id, 1)}) // fiado, no exchange, total 120
	if full, empty, bal := readAggregates(t, svc); full != 9 || empty != 0 || bal != 120 {
		t.Fatalf("post-sale want 9/0/120, got %d/%d/%v", full, empty, bal)
	}
	if err := svc.VoidSale(ctx, seedUser, id); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}
	if full, empty, bal := readAggregates(t, svc); full != 10 || empty != 0 || bal != 0 {
		t.Fatalf("post-void want 10/0/0, got %d/%d/%v", full, empty, bal)
	}
}

func TestVoidSale_concurrentDoubleVoidReversesOnce(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	id := "bbbbbbbb-0000-0000-0000-000000000012"
	svc.Push(ctx, seedUser, []PushEvent{exchangeFiadoSale(id, 2)}) // post-sale 8/2/240
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = svc.VoidSale(ctx, seedUser, id)
		}()
	}
	wg.Wait()
	if full, empty, bal := readAggregates(t, svc); full != 10 || empty != 0 || bal != 0 {
		t.Fatalf("concurrent double-void must reverse exactly once, got %d/%d/%v", full, empty, bal)
	}
}

func TestVoidSale_unlinkedCustomerSkipsBalance(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	id := "bbbbbbbb-0000-0000-0000-000000000013"
	svc.Push(ctx, seedUser, []PushEvent{exchangeFiadoSale(id, 2)}) // balance -> 240
	// Simulate the customer being unlinked from the sale (e.g. customer deleted).
	if _, err := pool.Exec(ctx, `UPDATE sales SET customer_id = NULL WHERE id=$1`, id); err != nil {
		t.Fatalf("unlink: %v", err)
	}
	if err := svc.VoidSale(ctx, seedUser, id); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}
	// Inventory reverses; the balance effect is intentionally dropped (customer gone).
	full, empty, bal := readAggregates(t, svc)
	if full != 10 || empty != 0 {
		t.Fatalf("inventory should reverse, got %d/%d", full, empty)
	}
	if bal != 240 {
		t.Fatalf("balance is intentionally not reversed when customer unlinked, want 240, got %v", bal)
	}
}

func TestVoidSale_unknownID(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	err := svc.VoidSale(context.Background(), seedUser, "bbbbbbbb-0000-0000-0000-0000000000ff")
	if !errors.Is(err, ErrSaleNotFound) {
		t.Fatalf("want ErrSaleNotFound, got %v", err)
	}
}
