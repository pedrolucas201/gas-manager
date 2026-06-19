package sync

import (
	"context"
	"sync"
	"testing"
)

func TestPush_ConcurrentSalesSameCustomerNoLostUpdate(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	var wg sync.WaitGroup
	ids := []string{"aaaaaaaa-0000-0000-0000-0000000000d1", "aaaaaaaa-0000-0000-0000-0000000000d2"}
	for _, id := range ids {
		wg.Add(1)
		go func(id string) {
			defer wg.Done()
			svc.Push(context.Background(), seedUser, []PushEvent{saleEvent(id, 1)})
		}(id)
	}
	wg.Wait()
	var bal float64
	pool.QueryRow(context.Background(), `SELECT balance FROM customers WHERE id=$1`, seedCustomer).Scan(&bal)
	if bal != 240 {
		t.Fatalf("want balance 240 (no lost update), got %v", bal)
	}

	page, _ := svc.Pull(context.Background(), Cursor{}, 10)
	if len(page.Events) != 2 {
		t.Fatalf("want both events visible, got %d", len(page.Events))
	}
}
