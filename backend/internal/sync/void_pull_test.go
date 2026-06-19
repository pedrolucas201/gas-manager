package sync

import (
	"context"
	"testing"
	"time"
)

func TestPull_VoidSaleAppearsInPullStream(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	saleID := "cccccccc-0000-0000-0000-000000000001"
	res, err := svc.Push(ctx, seedUser, []PushEvent{cashSale(saleID, 1)})
	if err != nil || res[0].Status != "applied" {
		t.Fatalf("push failed: %v / %s", err, res[0].Status)
	}

	if err := svc.VoidSale(ctx, seedUser, saleID); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}

	page, err := svc.Pull(ctx, Cursor{}, 50)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}

	var found bool
	for _, e := range page.Events {
		if e.Kind == "void_sale" {
			found = true
			dto, ok := e.Data.(VoidSaleDTO)
			if !ok {
				t.Fatalf("Data type: got %T", e.Data)
			}
			if dto.ID != saleID {
				t.Errorf("VoidSaleDTO.ID: want %s got %s", saleID, dto.ID)
			}
		}
	}
	if !found {
		t.Error("expected void_sale event in pull stream, none found")
	}
}

func TestPull_VoidCursorAdvances(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	saleID := "cccccccc-0000-0000-0000-000000000002"
	svc.Push(ctx, seedUser, []PushEvent{cashSale(saleID, 1)})
	svc.VoidSale(ctx, seedUser, saleID)

	page1, err := svc.Pull(ctx, Cursor{}, 50)
	if err != nil {
		t.Fatalf("Pull page1: %v", err)
	}
	if page1.NextCursor.Void == 0 {
		t.Error("Void cursor should advance after first void")
	}

	// Second pull from next cursor: no new void events
	page2, err := svc.Pull(ctx, page1.NextCursor, 50)
	if err != nil {
		t.Fatalf("Pull page2: %v", err)
	}
	for _, e := range page2.Events {
		if e.Kind == "void_sale" {
			t.Error("void_sale must not repeat after cursor advanced")
		}
	}
}

func TestVoidSale_DoubleVoidDoesNotCreateTwoEntries(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	saleID := "cccccccc-0000-0000-0000-000000000003"
	svc.Push(ctx, seedUser, []PushEvent{cashSale(saleID, 1)})

	svc.VoidSale(ctx, seedUser, saleID)
	svc.VoidSale(ctx, seedUser, saleID) // idempotent — already voided

	page, err := svc.Pull(ctx, Cursor{}, 50)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}
	count := 0
	for _, e := range page.Events {
		if e.Kind == "void_sale" {
			count++
		}
	}
	if count != 1 {
		t.Errorf("expected exactly 1 void_sale event, got %d", count)
	}
}

func TestPull_VoidSaleServerReceivedAtIsRecent(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	before := time.Now().Add(-2 * time.Second)

	saleID := "cccccccc-0000-0000-0000-000000000004"
	svc.Push(ctx, seedUser, []PushEvent{cashSale(saleID, 1)})
	svc.VoidSale(ctx, seedUser, saleID)

	page, _ := svc.Pull(ctx, Cursor{}, 50)
	for _, e := range page.Events {
		if e.Kind == "void_sale" {
			if e.ServerReceivedAt.Before(before) {
				t.Errorf("ServerReceivedAt too old: %v", e.ServerReceivedAt)
			}
		}
	}
}
