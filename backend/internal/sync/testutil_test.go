package sync

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

const (
	seedUser     = "u1"
	seedType     = "11111111-1111-1111-1111-111111111111"
	seedCustomer = "22222222-2222-2222-2222-222222222222"
	seedInvID    = "33333333-3333-3333-3333-333333333333"
)

func newTestDB(t *testing.T) *pgxpool.Pool {
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

	applyMigrations(t, pool)
	seed(t, pool)
	return pool
}

func applyMigrations(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, name := range []string{
		"0001_init.up.sql",
		"0002_sync_errors.up.sql",
		"0004_sale_voids.up.sql",
		"0005_catalog_events.up.sql",
		"0006_expenses.up.sql",
	} {
		path := filepath.Join("..", "db", "migrations", name)
		sql := readFile(t, path)
		if _, err := pool.Exec(ctx, sql); err != nil {
			t.Fatalf("migrate %s: %v", name, err)
		}
	}
}

func seed(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`INSERT INTO users(id,name,role) VALUES ('` + seedUser + `','U','employee')`,
		`INSERT INTO cylinder_types(id,name,weight_kg,sale_price,cost_price) VALUES ('` + seedType + `','P13',13,120,90)`,
		`INSERT INTO customers(id,name,balance,credit_limit) VALUES ('` + seedCustomer + `','C',0,500)`,
		`INSERT INTO inventory(id,cylinder_type_id,full_qty,empty_qty) VALUES ('` + seedInvID + `','` + seedType + `',10,0)`,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}

func readFile(t *testing.T, p string) string {
	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read %s: %v", p, err)
	}
	return string(b)
}
