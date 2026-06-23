package sync

import (
	"context"
	"testing"
	"time"
)

func stockSetEvent(id string, full, empty int) PushEvent {
	return PushEvent{
		Kind:            "stock_set",
		ID:              id,
		ClientCreatedAt: time.Now(),
		StockSet: &StockSetPayload{
			CylinderTypeID: seedType,
			FullQty:        full,
			EmptyQty:       empty,
		},
	}
}

func TestPush_StockSet_AppliesAbsoluteValues(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	res, err := svc.Push(context.Background(), seedUser, []PushEvent{
		stockSetEvent("cccccccc-0000-0000-0000-000000000001", 49, 7),
	})
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	if res[0].Status != "applied" {
		t.Fatalf("want applied, got %s (%s)", res[0].Status, res[0].Error)
	}

	var full, empty int
	pool.QueryRow(context.Background(),
		`SELECT full_qty, empty_qty FROM inventory WHERE cylinder_type_id=$1`, seedType,
	).Scan(&full, &empty)

	if full != 49 {
		t.Fatalf("want full_qty 49, got %d", full)
	}
	if empty != 7 {
		t.Fatalf("want empty_qty 7, got %d", empty)
	}
}

func TestPush_StockSet_Duplicate(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	ev := stockSetEvent("cccccccc-0000-0000-0000-000000000002", 49, 7)
	svc.Push(context.Background(), seedUser, []PushEvent{ev})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{ev})

	if res[0].Status != "duplicate" {
		t.Fatalf("want duplicate, got %s", res[0].Status)
	}

	// Inventory must not double-apply.
	var full int
	pool.QueryRow(context.Background(),
		`SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType,
	).Scan(&full)
	if full != 49 {
		t.Fatalf("want full_qty 49 after duplicate, got %d", full)
	}
}

func TestPush_StockSet_LWW_NewerWins(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	older := PushEvent{
		Kind:            "stock_set",
		ID:              "cccccccc-0000-0000-0000-000000000003",
		ClientCreatedAt: time.Now().Add(-10 * time.Minute),
		StockSet:        &StockSetPayload{CylinderTypeID: seedType, FullQty: 5, EmptyQty: 1},
	}
	newer := PushEvent{
		Kind:            "stock_set",
		ID:              "cccccccc-0000-0000-0000-000000000004",
		ClientCreatedAt: time.Now(),
		StockSet:        &StockSetPayload{CylinderTypeID: seedType, FullQty: 99, EmptyQty: 3},
	}

	// Apply newer first, then older — older must not overwrite.
	svc.Push(context.Background(), seedUser, []PushEvent{newer})
	svc.Push(context.Background(), seedUser, []PushEvent{older})

	var full int
	pool.QueryRow(context.Background(),
		`SELECT full_qty FROM inventory WHERE cylinder_type_id=$1`, seedType,
	).Scan(&full)
	if full != 99 {
		t.Fatalf("want full_qty 99 (newer wins), got %d", full)
	}
}

func TestPull_StockSet_InStream(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	svc.Push(context.Background(), seedUser, []PushEvent{
		stockSetEvent("cccccccc-0000-0000-0000-000000000005", 30, 4),
	})

	page, err := svc.Pull(context.Background(), Cursor{}, 200)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}

	var found bool
	for _, e := range page.Events {
		if e.Kind == "stock_set" {
			found = true
			dto, ok := e.Data.(StockSetDTO)
			if !ok {
				t.Fatalf("data is not StockSetDTO: %T", e.Data)
			}
			if dto.FullQty != 30 || dto.EmptyQty != 4 {
				t.Fatalf("want full=30 empty=4, got full=%d empty=%d", dto.FullQty, dto.EmptyQty)
			}
			if dto.ClientCreatedAt == "" {
				t.Fatal("client_created_at must not be empty")
			}
		}
	}
	if !found {
		t.Fatal("stock_set event not found in pull stream")
	}
}

func TestPull_StockSet_CursorAdvances(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	svc.Push(context.Background(), seedUser, []PushEvent{
		stockSetEvent("cccccccc-0000-0000-0000-000000000006", 20, 2),
	})

	page, _ := svc.Pull(context.Background(), Cursor{}, 200)

	// Cursor must have advanced past the stock_set sequence.
	if page.NextCursor.StockSet == 0 {
		t.Fatal("StockSet cursor must advance past the emitted event")
	}

	// Second pull with advanced cursor must return no stock_set events.
	page2, _ := svc.Pull(context.Background(), page.NextCursor, 200)
	for _, e := range page2.Events {
		if e.Kind == "stock_set" {
			t.Fatal("should not re-emit already-cursored stock_set event")
		}
	}
}
