package catalog

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
	seedUser              = "u1"
	seedType              = "11111111-1111-1111-1111-111111111111"
	seedCustomerWithDebt  = "22222222-2222-2222-2222-222222222222"
	seedCustomerFresh     = "44444444-4444-4444-4444-444444444444"
	seedSaleLinkedToDebt  = "55555555-5555-5555-5555-555555555555"
	seedInvID             = "33333333-3333-3333-3333-333333333333"
)

func newCatalogTestDB(t *testing.T) *pgxpool.Pool {
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
		"0005_catalog_events.up.sql",
	} {
		path := filepath.Join("..", "db", "migrations", name)
		b, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read migration %s: %v", name, err)
		}
		if _, err := pool.Exec(ctx, string(b)); err != nil {
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
		`INSERT INTO inventory(id,cylinder_type_id,full_qty,empty_qty) VALUES ('` + seedInvID + `','` + seedType + `',10,0)`,
		// Customer who owes money (balance != 0) — delete must be blocked.
		`INSERT INTO customers(id,name,balance,credit_limit,updated_at) VALUES ('` + seedCustomerWithDebt + `','Devedor',50,500,now())`,
		// Fresh customer with updated_at = now() — a stale LWW write must be ignored.
		`INSERT INTO customers(id,name,balance,credit_limit,updated_at) VALUES ('` + seedCustomerFresh + `','C',0,500,now())`,
		// A sale linked to the debtor, to assert it stays linked after a blocked delete.
		`INSERT INTO sales(id,customer_id,cylinder_type_id,quantity,unit_price,cost_price,total,payment_method,payload_hash,created_by,client_created_at)
		 VALUES ('` + seedSaleLinkedToDebt + `','` + seedCustomerWithDebt + `','` + seedType + `',1,120,90,120,'fiado','h','` + seedUser + `',now())`,
	}
	for _, s := range stmts {
		if _, err := pool.Exec(ctx, s); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
}
