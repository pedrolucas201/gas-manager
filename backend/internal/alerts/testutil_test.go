package alerts

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
	seedTypeID     = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
	seedInvID      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
	seedCustomerID = "cccccccc-cccc-cccc-cccc-cccccccccccc"
)

func newAlertsTestDB(t *testing.T) *pgxpool.Pool {
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
	path := filepath.Join("..", "db", "migrations", "0001_init.up.sql")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read migration: %v", err)
	}
	if _, err := pool.Exec(context.Background(), string(b)); err != nil {
		t.Fatalf("migrate: %v", err)
	}
}

func seed(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	stmts := []string{
		`INSERT INTO cylinder_types(id,name,weight_kg,sale_price,cost_price) VALUES ('` + seedTypeID + `','P13',13,120,90)`,
		// Negative stock: full_qty = -3 triggers the alert.
		`INSERT INTO inventory(id,cylinder_type_id,full_qty,empty_qty) VALUES ('` + seedInvID + `','` + seedTypeID + `',-3,0)`,
		// Over-limit balance: balance 600 > credit_limit 500.
		`INSERT INTO customers(id,name,balance,credit_limit,updated_at) VALUES ('` + seedCustomerID + `','Cliente Devedor',600,500,now())`,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}
