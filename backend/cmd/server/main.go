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
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
	"github.com/pedrogomesdev/gas-manager-backend/internal/reports"
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

	authMW := auth.Middleware(verifier, auth.NewDBUserLoader(pool), time.Now)

	router := newRouter(
		sync.NewService(pool),
		catalog.NewService(pool),
		alerts.NewService(pool),
		reports.NewService(pool),
		authMW,
		httpx.CORS(cfg.CORSOrigin),
		pool.Ping,
	)

	log.Printf("listening on :%s", cfg.Port)
	return http.ListenAndServe(":"+cfg.Port, router)
}

func newRouter(
	syncSvc *sync.Service,
	catalogSvc *catalog.Service,
	alertsSvc *alerts.Service,
	reportsSvc *reports.Service,
	authMW func(http.Handler) http.Handler,
	corsMW func(http.Handler) http.Handler,
	ready func(context.Context) error,
) http.Handler {
	r := chi.NewRouter()
	r.Use(corsMW)

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})

	r.Get("/readyz", func(w http.ResponseWriter, req *http.Request) {
		ctx, cancel := context.WithTimeout(req.Context(), 2*time.Second)
		defer cancel()
		if err := ready(ctx); err != nil {
			http.Error(w, "db unavailable", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	r.Group(func(r chi.Router) {
		r.Use(authMW)
		r.Post("/sync/push", syncSvc.HandlePush)
		r.Post("/sync/void-sale", syncSvc.HandleVoidSale)
		r.Post("/sync/unvoid-sale", syncSvc.HandleUnvoidSale)
		r.Get("/sync/pull", syncSvc.HandlePull)
		r.Get("/sync/errors", syncSvc.HandleSyncErrors)
		r.Put("/catalog/customers", catalogSvc.HandleUpsertCustomer)
		r.Delete("/catalog/customers/{id}", catalogSvc.HandleDeleteCustomer)
		r.Put("/catalog/cylinder-types/{id}", catalogSvc.HandleUpdateCylinderType)
		r.Get("/alerts/negative-stock", alertsSvc.HandleNegativeStock)
		r.Get("/alerts/over-limit-balance", alertsSvc.HandleOverLimitBalance)
		r.Get("/reports/summary", reportsSvc.HandleSummary)
		r.Get("/reports/sales", reportsSvc.HandleSales)
		r.Get("/reports/expenses", reportsSvc.HandleExpenses)
		r.Get("/reports/debtors", reportsSvc.HandleDebtors)
		r.Get("/inventory", reportsSvc.HandleInventory)
	})

	return r
}
