package alerts

import (
	"context"
	"testing"
)

func TestNegativeStock_FlagsNegativeFullQty(t *testing.T) {
	pool := newAlertsTestDB(t)
	svc := NewService(pool)

	items, err := svc.NegativeStock(context.Background())
	if err != nil {
		t.Fatalf("NegativeStock: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(items))
	}
	if items[0].FullQty >= 0 {
		t.Errorf("expected negative full_qty, got %d", items[0].FullQty)
	}
	if items[0].Name != "P13" {
		t.Errorf("expected name P13, got %q", items[0].Name)
	}
}

func TestOverLimitBalance_FlagsCustomerPastLimit(t *testing.T) {
	pool := newAlertsTestDB(t)
	svc := NewService(pool)

	items, err := svc.OverLimitBalance(context.Background())
	if err != nil {
		t.Fatalf("OverLimitBalance: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(items))
	}
	if items[0].Name != "Cliente Devedor" {
		t.Errorf("expected name 'Cliente Devedor', got %q", items[0].Name)
	}
	if items[0].Balance == "" || items[0].CreditLimit == "" {
		t.Error("balance and credit_limit must be non-empty")
	}
}
