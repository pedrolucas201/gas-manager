package sync

import (
	"context"
	"errors"
	"testing"
	"time"
)

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

func TestVoidSale_unknownID(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	err := svc.VoidSale(context.Background(), seedUser, "bbbbbbbb-0000-0000-0000-0000000000ff")
	if !errors.Is(err, ErrSaleNotFound) {
		t.Fatalf("want ErrSaleNotFound, got %v", err)
	}
}
