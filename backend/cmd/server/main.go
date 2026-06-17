package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/alerts"
	"github.com/pedrogomesdev/gas-manager-backend/internal/auth"
	"github.com/pedrogomesdev/gas-manager-backend/internal/catalog"
	"github.com/pedrogomesdev/gas-manager-backend/internal/config"
	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/pedrogomesdev/gas-manager-backend/internal/sync"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		return err
	}

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	verifier, err := auth.NewFirebaseVerifier(ctx, cfg.FirebaseProjectID, os.Getenv("GOOGLE_APPLICATION_CREDENTIALS"))
	if err != nil {
		return err
	}

	authMW := auth.Middleware(verifier, pgUserLoader{pool}, time.Now)

	router := newRouter(
		sync.NewService(pool),
		catalog.NewService(pool),
		alerts.NewService(pool),
		authMW,
	)

	log.Printf("listening on :%s", cfg.Port)
	return http.ListenAndServe(":"+cfg.Port, router)
}

func newRouter(
	syncSvc *sync.Service,
	catalogSvc *catalog.Service,
	alertsSvc *alerts.Service,
	authMW func(http.Handler) http.Handler,
) http.Handler {
	r := chi.NewRouter()

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.Group(func(r chi.Router) {
		r.Use(authMW)
		r.Post("/sync/push", syncSvc.HandlePush)
		r.Get("/sync/pull", syncSvc.HandlePull)
		r.Get("/sync/errors", syncSvc.HandleSyncErrors)
		r.Put("/catalog/customers", catalogSvc.HandleUpsertCustomer)
		r.Delete("/catalog/customers/{id}", catalogSvc.HandleDeleteCustomer)
		r.Get("/alerts/negative-stock", alertsSvc.HandleNegativeStock)
		r.Get("/alerts/over-limit-balance", alertsSvc.HandleOverLimitBalance)
	})

	return r
}

type pgUserLoader struct{ pool *pgxpool.Pool }

func (l pgUserLoader) LoadUser(ctx context.Context, uid string) (auth.UserRow, error) {
	u, err := gen.New(l.pool).GetUser(ctx, uid)
	if err != nil {
		return auth.UserRow{}, err
	}
	row := auth.UserRow{ID: u.ID, Active: u.Active}
	if u.DeactivatedAt.Valid {
		t := u.DeactivatedAt.Time
		row.DeactivatedAt = &t
	}
	return row, nil
}
