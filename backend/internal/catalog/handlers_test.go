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

func TestUpdateCylinderType_StaleUpdateIgnored(t *testing.T) {
	pool := newCatalogTestDB(t)
	svc := NewService(pool)
	old := time.Now().Add(-time.Hour)
	// seeded P13 has updated_at = now(); an older write must not overwrite price.
	err := svc.UpdateCylinderType(context.Background(), seedType,
		CylinderTypeInput{SalePrice: "999.00", CostPrice: "900.00", Active: true, UpdatedAt: old})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	var price float64
	pool.QueryRow(context.Background(), `SELECT sale_price FROM cylinder_types WHERE id=$1`, seedType).Scan(&price)
	if price == 999 {
		t.Fatal("stale LWW write must be ignored")
	}
}

func TestUpdateCylinderType_FreshUpdateApplies(t *testing.T) {
	pool := newCatalogTestDB(t)
	svc := NewService(pool)
	fresh := time.Now().Add(time.Hour)
	err := svc.UpdateCylinderType(context.Background(), seedType,
		CylinderTypeInput{SalePrice: "150.00", CostPrice: "100.00", Active: true, UpdatedAt: fresh})
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	var price float64
	pool.QueryRow(context.Background(), `SELECT sale_price FROM cylinder_types WHERE id=$1`, seedType).Scan(&price)
	if price != 150 {
		t.Fatalf("fresh LWW write should apply, got %v", price)
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
