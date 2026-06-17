package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pedrogomesdev/gas-manager-backend/internal/alerts"
	"github.com/pedrogomesdev/gas-manager-backend/internal/catalog"
	"github.com/pedrogomesdev/gas-manager-backend/internal/sync"
)

// passthroughAuth is a no-op auth middleware for smoke tests.
func passthroughAuth(next http.Handler) http.Handler { return next }

func TestHealthz(t *testing.T) {
	router := newRouter(
		sync.NewService(nil),
		catalog.NewService(nil),
		alerts.NewService(nil),
		passthroughAuth,
	)

	req := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}
