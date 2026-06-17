package auth

import (
	"context"
	"testing"
	"time"
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
	pool.QueryRow(context.Background(), `SELECT count(*) FROM users WHERE id=$1`, "brand-new-uid").Scan(&n)
	if n != 1 {
		t.Fatalf("auto-provision must persist exactly one row, got %d", n)
	}
}

func TestDBUserLoader_LoadsExistingActiveUser(t *testing.T) {
	pool := newAuthTestDB(t)
	pool.Exec(context.Background(),
		`INSERT INTO users(id,name,role,active) VALUES ('u1','U','employee',true)`)
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
	pool.Exec(context.Background(),
		`INSERT INTO users(id,name,role,active,deactivated_at) VALUES ('gone','G','employee',false,$1)`, d)
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
