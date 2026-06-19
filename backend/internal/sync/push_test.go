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
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	if res[0].Status != "applied" {
		t.Fatalf("want applied, got %s (%s)", res[0].Status, res[0].Error)
	}

	var full int
	var bal float64
	pool.QueryRow(context.Background(), `SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType).Scan(&full)
	pool.QueryRow(context.Background(), `SELECT balance FROM customers WHERE id=$1`, seedCustomer).Scan(&bal)
	if full != 9 {
		t.Fatalf("want full_qty 9, got %d", full)
	}
	if bal != 120 {
		t.Fatalf("want balance 120, got %v", bal)
	}
}

func TestPush_DuplicateSamePayloadIsIdempotent(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ev := saleEvent("aaaaaaaa-0000-0000-0000-000000000002", 1)
	_, _ = svc.Push(context.Background(), seedUser, []PushEvent{ev})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{ev})
	if res[0].Status != "duplicate" {
		t.Fatalf("want duplicate, got %s", res[0].Status)
	}

	var full int
	pool.QueryRow(context.Background(), `SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType).Scan(&full)
	if full != 9 {
		t.Fatalf("aggregate must not double-apply, got %d", full)
	}
}

func TestPush_DuplicateAfterLaterEventApplied(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	first := saleEvent("aaaaaaaa-0000-0000-0000-000000000003", 1)
	second := saleEvent("aaaaaaaa-0000-0000-0000-000000000004", 1)
	svc.Push(context.Background(), seedUser, []PushEvent{first})
	svc.Push(context.Background(), seedUser, []PushEvent{second})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{first}) // resend first, out of order
	if res[0].Status != "duplicate" {
		t.Fatalf("want duplicate, got %s", res[0].Status)
	}
	var full int
	pool.QueryRow(context.Background(), `SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType).Scan(&full)
	if full != 8 {
		t.Fatalf("want 8 after two distinct sales, got %d", full)
	}
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
	if res[0].Status != "error" {
		t.Fatalf("bad event should be error, got %s", res[0].Status)
	}
	if res[1].Status != "applied" {
		t.Fatalf("good event should still apply, got %s", res[1].Status)
	}
}
