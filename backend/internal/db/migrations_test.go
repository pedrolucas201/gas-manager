package db

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/testcontainers/testcontainers-go"
	tcpg "github.com/testcontainers/testcontainers-go/modules/postgres"
	"github.com/testcontainers/testcontainers-go/wait"
)

// migrationsTestDB spins up a fresh Postgres and applies the schema migrations
// (0001, 0002) so that the seed migration (0003) can be exercised against the
// real DDL — FKs, UNIQUE constraints and all. The seed itself is applied by the
// individual tests so they control how many times it runs.
func migrationsTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	ctx := context.Background()
	ctr, err := tcpg.Run(ctx, "postgres:16",
		tcpg.WithDatabase("gas"), tcpg.WithUsername("gas"), tcpg.WithPassword("gas"),
		testcontainers.WithWaitStrategy(
			wait.ForListeningPort("5432/tcp").WithStartupTimeout(60*time.Second)))
	if err != nil {
		t.Fatalf("start postgres: %v", err)
	}
	t.Cleanup(func() { _ = ctr.Terminate(ctx) })

	url, err := ctr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("conn string: %v", err)
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatalf("pool: %v", err)
	}
	t.Cleanup(pool.Close)

	for _, name := range []string{"0001_init.up.sql", "0002_sync_errors.up.sql"} {
		applyMigration(t, pool, name)
	}
	return pool
}

func applyMigration(t *testing.T, pool *pgxpool.Pool, name string) {
	t.Helper()
	path := filepath.Join("migrations", name)
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if _, err := pool.Exec(context.Background(), string(b)); err != nil {
		t.Fatalf("apply %s: %v", name, err)
	}
}

func countRows(t *testing.T, pool *pgxpool.Pool, table string) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM "+table).Scan(&n); err != nil {
		t.Fatalf("count %s: %v", table, err)
	}
	return n
}

func TestSeedP13_Applies(t *testing.T) {
	pool := migrationsTestDB(t)
	applyMigration(t, pool, "0003_seed_p13.up.sql")
	ctx := context.Background()

	var name string
	var weight, sale, cost int
	err := pool.QueryRow(ctx,
		`SELECT name, weight_kg, sale_price, cost_price FROM cylinder_types`).
		Scan(&name, &weight, &sale, &cost)
	if err != nil {
		t.Fatalf("read cylinder_types: %v", err)
	}
	if name != "P13" || weight != 13 || sale != 120 || cost != 90 {
		t.Errorf("unexpected seed: name=%q weight=%d sale=%d cost=%d", name, weight, sale, cost)
	}

	var full, empty int
	err = pool.QueryRow(ctx,
		`SELECT i.full_qty, i.empty_qty FROM inventory i
		   JOIN cylinder_types c ON c.id = i.cylinder_type_id
		  WHERE c.name = 'P13'`).Scan(&full, &empty)
	if err != nil {
		t.Fatalf("read inventory: %v", err)
	}
	if full != 0 || empty != 0 {
		t.Errorf("seed inventory must start at zero, got full=%d empty=%d", full, empty)
	}
}

// The migration is annotated "Idempotent on re-run"; applying it twice must not
// error nor create duplicates. Exercises both ON CONFLICT targets: cylinder_types
// (id) and inventory (cylinder_type_id, backed by the UNIQUE on the FK column).
func TestSeedP13_Idempotent(t *testing.T) {
	pool := migrationsTestDB(t)
	applyMigration(t, pool, "0003_seed_p13.up.sql")
	applyMigration(t, pool, "0003_seed_p13.up.sql")

	if n := countRows(t, pool, "cylinder_types"); n != 1 {
		t.Errorf("cylinder_types: want 1 row after re-run, got %d", n)
	}
	if n := countRows(t, pool, "inventory"); n != 1 {
		t.Errorf("inventory: want 1 row after re-run, got %d", n)
	}
}

// down must remove the seed in FK-safe order (inventory before cylinder_types)
// and leave both tables empty.
func TestSeedP13_DownRemovesRows(t *testing.T) {
	pool := migrationsTestDB(t)
	applyMigration(t, pool, "0003_seed_p13.up.sql")
	applyMigration(t, pool, "0003_seed_p13.down.sql")

	if n := countRows(t, pool, "inventory"); n != 0 {
		t.Errorf("inventory: want 0 rows after down, got %d", n)
	}
	if n := countRows(t, pool, "cylinder_types"); n != 0 {
		t.Errorf("cylinder_types: want 0 rows after down, got %d", n)
	}
}
