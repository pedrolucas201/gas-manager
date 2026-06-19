package auth

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

func TestDBUserLoader_AutoProvisionsUnknownUID(t *testing.T) {
	pool := newAuthTestDB(t)
	l := NewDBUserLoader(pool)

	u, err := l.LoadUser(context.Background(), "brand-new-uid")
	if err != nil {
		t.Fatalf("LoadUser: %v", err)
	}
	if u.ID != "brand-new-uid" {
		t.Errorf("want id brand-new-uid, got %q", u.ID)
	}
	if !u.Active {
		t.Error("auto-provisioned user must be active")
	}

	// The row must actually be persisted, not just returned.
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM users WHERE id=$1`, "brand-new-uid").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("auto-provision must persist exactly one row, got %d", n)
	}
}

// Idempotency is the central guarantee of the bootstrap commit: loading the same
// unknown UID twice must not error nor create a duplicate row.
func TestDBUserLoader_IsIdempotent(t *testing.T) {
	pool := newAuthTestDB(t)
	l := NewDBUserLoader(pool)
	ctx := context.Background()

	if _, err := l.LoadUser(ctx, "dup-uid"); err != nil {
		t.Fatalf("first LoadUser: %v", err)
	}
	if _, err := l.LoadUser(ctx, "dup-uid"); err != nil {
		t.Fatalf("second LoadUser: %v", err)
	}

	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM users WHERE id=$1`, "dup-uid").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("repeated provision must keep exactly one row, got %d", n)
	}
}

func TestDBUserLoader_LoadsExistingActiveUser(t *testing.T) {
	pool := newAuthTestDB(t)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users(id,name,role,active) VALUES ('u1','U','employee',true)`); err != nil {
		t.Fatalf("seed: %v", err)
	}
	l := NewDBUserLoader(pool)

	u, err := l.LoadUser(context.Background(), "u1")
	if err != nil {
		t.Fatalf("LoadUser: %v", err)
	}
	if !u.Active {
		t.Error("existing active user must stay active")
	}
}

func TestDBUserLoader_DoesNotResurrectDeactivated(t *testing.T) {
	pool := newAuthTestDB(t)
	d := time.Now().Add(-2 * 24 * time.Hour)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users(id,name,role,active,deactivated_at) VALUES ('gone','G','employee',false,$1)`, d); err != nil {
		t.Fatalf("seed: %v", err)
	}
	l := NewDBUserLoader(pool)

	u, err := l.LoadUser(context.Background(), "gone")
	if err != nil {
		t.Fatalf("LoadUser: %v", err)
	}
	if u.Active {
		t.Fatal("a deactivated user must not be resurrected to active")
	}
	if u.DeactivatedAt == nil {
		t.Fatal("deactivated_at must be preserved")
	}
}

// LoadUser short-circuits on GetUser for an existing user, so the no-op
// DO UPDATE in EnsureUser is never reached through it. Hit EnsureUser directly
// to guard the ON CONFLICT clause itself against a future edit that resurrects
// a deactivated user (e.g. someone changing it to DO UPDATE SET active=true).
func TestEnsureUser_DoesNotResurrectOnConflict(t *testing.T) {
	pool := newAuthTestDB(t)
	d := time.Now().Add(-2 * 24 * time.Hour)
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users(id,name,role,active,deactivated_at) VALUES ('gone','G','employee',false,$1)`, d); err != nil {
		t.Fatalf("seed: %v", err)
	}

	row, err := gen.New(pool).EnsureUser(context.Background(), "gone")
	if err != nil {
		t.Fatalf("EnsureUser: %v", err)
	}
	if row.Active {
		t.Fatal("EnsureUser conflict path must not reactivate a deactivated user")
	}
	if !row.DeactivatedAt.Valid {
		t.Fatal("EnsureUser conflict path must preserve deactivated_at")
	}
}

// Two phones (or a retrying client) hitting LoadUser with the same brand-new UID
// race: both see ErrNoRows and both INSERT ... ON CONFLICT. None must error and
// exactly one row must result.
func TestDBUserLoader_ConcurrentProvisionSameUID(t *testing.T) {
	pool := newAuthTestDB(t)
	l := NewDBUserLoader(pool)
	ctx := context.Background()

	const goroutines = 8
	var wg sync.WaitGroup
	errs := make([]error, goroutines)
	for i := range goroutines {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, errs[i] = l.LoadUser(ctx, "race-uid")
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: concurrent provision must not error: %v", i, err)
		}
	}
	var n int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM users WHERE id=$1`, "race-uid").Scan(&n); err != nil {
		t.Fatalf("count: %v", err)
	}
	if n != 1 {
		t.Fatalf("concurrent provision must produce exactly one row, got %d", n)
	}
}
