package sync

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestUnvoidSale_reappliesAggregatesAndEmitsEvent(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	saleID := "cccccccc-0000-0000-0000-000000000001"
	// Fiado + troca, qty 2: post-sale 8/2/240.
	if res, _ := svc.Push(ctx, seedUser, []PushEvent{exchangeFiadoSale(saleID, 2)}); res[0].Status != "applied" {
		t.Fatalf("setup push: %s", res[0].Status)
	}
	if err := svc.VoidSale(ctx, seedUser, saleID); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}
	// Post-void baseline: 10/0/0.
	if full, empty, bal := readAggregates(t, svc); full != 10 || empty != 0 || bal != 0 {
		t.Fatalf("post-void want 10/0/0, got %d/%d/%v", full, empty, bal)
	}

	if err := svc.UnvoidSale(ctx, seedUser, saleID); err != nil {
		t.Fatalf("UnvoidSale: %v", err)
	}

	// voided_at cleared.
	var voidedAt *time.Time
	pool.QueryRow(ctx, `SELECT voided_at FROM sales WHERE id=$1`, saleID).Scan(&voidedAt)
	if voidedAt != nil {
		t.Fatalf("voided_at must be NULL after unvoid, got %v", voidedAt)
	}
	// Aggregates re-applied: back to post-sale 8/2/240.
	if full, empty, bal := readAggregates(t, svc); full != 8 || empty != 2 || bal != 240 {
		t.Fatalf("post-unvoid want 8/2/240, got %d/%d/%v", full, empty, bal)
	}

	// unvoid_sale event emitted in the pull stream.
	page, err := svc.Pull(ctx, Cursor{}, 50)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	found := false
	for _, e := range page.Events {
		if e.Kind == "unvoid_sale" {
			found = true
		}
	}
	if !found {
		t.Fatalf("expected an unvoid_sale event in the pull stream, got %+v", page.Events)
	}

	// Regressão (TL-C1): a partir do cursor avançado, o unvoid_sale NÃO reaparece.
	page2, err := svc.Pull(ctx, page.NextCursor, 50)
	if err != nil {
		t.Fatalf("second pull: %v", err)
	}
	for _, e := range page2.Events {
		if e.Kind == "unvoid_sale" || e.Kind == "void_sale" {
			t.Fatalf("evento %s re-entregue após avançar o cursor: %+v", e.Kind, page2.Events)
		}
	}
}

func TestUnvoidSale_cashSaleDoesNotTouchBalance(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	id := "cccccccc-0000-0000-0000-000000000020"
	svc.Push(ctx, seedUser, []PushEvent{cashSale(id, 1)}) // 9/0/0
	if err := svc.VoidSale(ctx, seedUser, id); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}
	if err := svc.UnvoidSale(ctx, seedUser, id); err != nil {
		t.Fatalf("UnvoidSale: %v", err)
	}
	// Re-aplica estoque (10→9) mas não mexe no balance (cash).
	if full, empty, bal := readAggregates(t, svc); full != 9 || empty != 0 || bal != 0 {
		t.Fatalf("post-unvoid cash want 9/0/0, got %d/%d/%v", full, empty, bal)
	}
}

func TestUnvoidSale_unlinkedCustomerSkipsBalance(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	id := "cccccccc-0000-0000-0000-000000000021"
	svc.Push(ctx, seedUser, []PushEvent{exchangeFiadoSale(id, 2)}) // 8/2/240
	if err := svc.VoidSale(ctx, seedUser, id); err != nil {
		t.Fatalf("VoidSale: %v", err)
	}
	// Cliente desvinculado entre void e unvoid (ex.: cliente deletado).
	if _, err := pool.Exec(ctx, `UPDATE sales SET customer_id = NULL WHERE id=$1`, id); err != nil {
		t.Fatalf("unlink: %v", err)
	}
	if err := svc.UnvoidSale(ctx, seedUser, id); err != nil {
		t.Fatalf("UnvoidSale: %v", err)
	}
	// Estoque re-aplica; o balanço é intencionalmente ignorado (cliente sumiu).
	full, empty, bal := readAggregates(t, svc)
	if full != 8 || empty != 2 {
		t.Fatalf("inventário deve re-aplicar, got %d/%d", full, empty)
	}
	if bal != 0 {
		t.Fatalf("balanço não deve ser tocado quando cliente desvinculado, want 0, got %v", bal)
	}
}

func TestUnvoidSale_concurrentDoubleUnvoidReappliesOnce(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()
	id := "cccccccc-0000-0000-0000-000000000022"
	svc.Push(ctx, seedUser, []PushEvent{exchangeFiadoSale(id, 2)}) // 8/2/240
	if err := svc.VoidSale(ctx, seedUser, id); err != nil {        // 10/0/0
		t.Fatalf("VoidSale: %v", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_ = svc.UnvoidSale(ctx, seedUser, id)
		}()
	}
	wg.Wait()
	// Re-aplica exatamente uma vez: de volta ao pós-venda 8/2/240.
	if full, empty, bal := readAggregates(t, svc); full != 8 || empty != 2 || bal != 240 {
		t.Fatalf("unvoid concorrente deve re-aplicar uma vez, got %d/%d/%v", full, empty, bal)
	}
}

func TestUnvoidSale_idempotentOnActiveSale(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	ctx := context.Background()

	saleID := "cccccccc-0000-0000-0000-000000000002"
	svc.Push(ctx, seedUser, []PushEvent{saleEvent(saleID, 1)}) // fiado, never voided → 9/0/120
	if err := svc.UnvoidSale(ctx, seedUser, saleID); err != nil {
		t.Fatalf("unvoid on active sale must be a no-op, got %v", err)
	}
	if full, empty, bal := readAggregates(t, svc); full != 9 || empty != 0 || bal != 120 {
		t.Fatalf("idempotent unvoid want 9/0/120, got %d/%d/%v", full, empty, bal)
	}
}

func TestUnvoidSale_unknownID(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	err := svc.UnvoidSale(context.Background(), seedUser, "cccccccc-0000-0000-0000-0000000000ff")
	if !errors.Is(err, ErrSaleNotFound) {
		t.Fatalf("want ErrSaleNotFound, got %v", err)
	}
}
