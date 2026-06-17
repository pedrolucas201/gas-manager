package sync

import (
	"context"
	"testing"
)

func TestPull_ReturnsAppliedEventsInSequenceOrder(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	svc.Push(context.Background(), seedUser, []PushEvent{
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000b1", 1),
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000b2", 1),
	})
	page, err := svc.Pull(context.Background(), Cursor{}, 10)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}
	if len(page.Events) != 2 {
		t.Fatalf("want 2 events, got %d", len(page.Events))
	}
	if page.HasMore {
		t.Fatal("should not have more")
	}
}

func TestPull_PaginatesAndResumesFromCursor(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	svc.Push(context.Background(), seedUser, []PushEvent{
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000c1", 1),
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000c2", 1),
		saleEvent("aaaaaaaa-0000-0000-0000-0000000000c3", 1),
	})
	p1, _ := svc.Pull(context.Background(), Cursor{}, 2)
	if len(p1.Events) != 2 || !p1.HasMore {
		t.Fatalf("page1 wrong: %d more=%v", len(p1.Events), p1.HasMore)
	}
	p2, _ := svc.Pull(context.Background(), p1.NextCursor, 2)
	if len(p2.Events) != 1 || p2.HasMore {
		t.Fatalf("page2 wrong: %d more=%v", len(p2.Events), p2.HasMore)
	}
}
