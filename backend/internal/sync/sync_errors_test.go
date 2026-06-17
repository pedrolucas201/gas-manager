package sync

import (
	"context"
	"testing"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

func TestPush_ErrorIsLoggedToSyncErrors(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	// FK violation on cylinder_type_id produces an apply_failed error.
	bad := saleEvent("eeeeeeee-0000-0000-0000-000000000001", 1)
	bad.Sale.CylinderTypeID = "99999999-9999-9999-9999-999999999999"

	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{bad})
	if res[0].Status != "error" {
		t.Fatalf("expected error status, got %s", res[0].Status)
	}

	rows, err := gen.New(pool).RecentSyncErrors(context.Background(), 10)
	if err != nil {
		t.Fatalf("RecentSyncErrors: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 sync_error row, got %d", len(rows))
	}
	if rows[0].EventID != bad.ID {
		t.Errorf("expected event_id %s, got %s", bad.ID, rows[0].EventID)
	}
	if rows[0].ErrorCode != res[0].Error {
		t.Errorf("expected error_code %s, got %s", res[0].Error, rows[0].ErrorCode)
	}
}

func TestPush_DuplicateIsNotLogged(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	ev := saleEvent("eeeeeeee-0000-0000-0000-000000000002", 1)
	svc.Push(context.Background(), seedUser, []PushEvent{ev})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{ev})
	if res[0].Status != "duplicate" {
		t.Fatalf("expected duplicate, got %s", res[0].Status)
	}

	rows, err := gen.New(pool).RecentSyncErrors(context.Background(), 10)
	if err != nil {
		t.Fatalf("RecentSyncErrors: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("duplicate must not be logged, got %d rows", len(rows))
	}
}
