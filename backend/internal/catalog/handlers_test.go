package catalog

import (
	"context"
	"testing"
	"time"
)

func TestDeleteCustomer_BlockedWhenBalanceOwed(t *testing.T) {
	pool := newCatalogTestDB(t)
	svc := NewService(pool)
	err := svc.DeleteCustomer(context.Background(), seedCustomerWithDebt)
	if err == nil {
		t.Fatal("expected delete to be blocked by outstanding balance")
	}
}

func TestDeleteCustomer_BlockedLeavesSalesLinked(t *testing.T) {
	pool := newCatalogTestDB(t)
	svc := NewService(pool)
	_ = svc.DeleteCustomer(context.Background(), seedCustomerWithDebt) // blocked
	var linked int
	pool.QueryRow(context.Background(),
		`SELECT count(*) FROM sales WHERE customer_id=$1`, seedCustomerWithDebt).Scan(&linked)
	if linked != 1 {
		t.Fatalf("blocked delete must leave sales linked, got %d linked", linked)
	}
}

func TestUpsertCustomer_StaleUpdateIgnored(t *testing.T) {
	pool := newCatalogTestDB(t)
	svc := NewService(pool)
	old := time.Now().Add(-time.Hour)
	// existing row has updated_at = now; an older write must not overwrite name.
	err := svc.UpsertCustomer(context.Background(), CustomerInput{ID: seedCustomerFresh, Name: "STALE", UpdatedAt: old})
	if err != nil {
		t.Fatalf("upsert: %v", err)
	}
	var name string
	pool.QueryRow(context.Background(), `SELECT name FROM customers WHERE id=$1`, seedCustomerFresh).Scan(&name)
	if name == "STALE" {
		t.Fatal("stale LWW write must be ignored")
	}
}
