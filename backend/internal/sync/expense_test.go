package sync

import (
	"context"
	"testing"
	"time"
)

func expenseEvent(id, category, amount string) PushEvent {
	return PushEvent{
		Kind:            "expense",
		ID:              id,
		ClientCreatedAt: time.Now(),
		Expense: &ExpensePayload{
			Category: category,
			Amount:   amount,
		},
	}
}

func TestPush_AppliesExpense(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	ev := expenseEvent("eeeeeeee-0000-0000-0000-000000000001", "Gasolina", "150.00")
	res, err := svc.Push(context.Background(), seedUser, []PushEvent{ev})
	if err != nil {
		t.Fatalf("Push: %v", err)
	}
	if res[0].Status != "applied" {
		t.Fatalf("want applied, got %s (%s)", res[0].Status, res[0].Error)
	}

	var category string
	var amount float64
	pool.QueryRow(context.Background(),
		`SELECT category, amount FROM expenses WHERE id=$1`,
		mustUUID("eeeeeeee-0000-0000-0000-000000000001"),
	).Scan(&category, &amount)

	if category != "Gasolina" {
		t.Fatalf("want category Gasolina, got %s", category)
	}
	if amount != 150.00 {
		t.Fatalf("want amount 150.00, got %v", amount)
	}
}

func TestPush_ExpenseDuplicateIsIdempotent(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	ev := expenseEvent("eeeeeeee-0000-0000-0000-000000000002", "Pneu", "80.00")
	_, _ = svc.Push(context.Background(), seedUser, []PushEvent{ev})
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{ev})

	if res[0].Status != "duplicate" {
		t.Fatalf("want duplicate, got %s", res[0].Status)
	}

	var count int
	pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM expenses WHERE id=$1`,
		mustUUID("eeeeeeee-0000-0000-0000-000000000002"),
	).Scan(&count)
	if count != 1 {
		t.Fatalf("want 1 row, got %d (duplicate was inserted)", count)
	}
}

func TestPull_IncludesExpenses(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)

	ev := expenseEvent("eeeeeeee-0000-0000-0000-000000000003", "Manutenção", "200.00")
	res, _ := svc.Push(context.Background(), seedUser, []PushEvent{ev})
	if res[0].Status != "applied" {
		t.Fatalf("setup push failed: %s", res[0].Status)
	}

	page, err := svc.Pull(context.Background(), Cursor{}, 200)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}

	var found bool
	for _, e := range page.Events {
		if e.Kind == "expense" {
			dto, ok := e.Data.(ExpenseDTO)
			if !ok {
				t.Fatalf("data is not ExpenseDTO")
			}
			if dto.Category == "Manutenção" && dto.Amount == "200.00" {
				found = true
			}
		}
	}
	if !found {
		t.Fatal("expense not found in pull stream")
	}

	page2, _ := svc.Pull(context.Background(), page.NextCursor, 200)
	for _, e := range page2.Events {
		if e.Kind == "expense" {
			t.Fatal("expense appeared twice in pull stream")
		}
	}
}
