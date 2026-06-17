package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pedrogomesdev/gas-manager-backend/internal/alerts"
	"github.com/pedrogomesdev/gas-manager-backend/internal/catalog"
	"github.com/pedrogomesdev/gas-manager-backend/internal/sync"
)

// passthroughAuth is a no-op auth middleware for smoke tests.
func passthroughAuth(next http.Handler) http.Handler { return next }

// denyAuth blocks every request, standing in for the real Firebase middleware
// so we can prove which routes sit outside the authenticated group.
func denyAuth(http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	})
}

func okReady(context.Context) error { return nil }

func newTestRouter(ready func(context.Context) error) http.Handler {
	return newRouter(
		sync.NewService(nil),
		catalog.NewService(nil),
		alerts.NewService(nil),
		passthroughAuth,
		ready,
	)
}

func TestHealthz(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter(okReady).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
}

func TestReadyz_DBUp(t *testing.T) {
	rec := httptest.NewRecorder()
	newTestRouter(okReady).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 when db reachable, got %d", rec.Code)
	}
}

func TestReadyz_DBDown(t *testing.T) {
	down := func(context.Context) error { return errors.New("connection refused") }
	rec := httptest.NewRecorder()
	newTestRouter(down).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("want 503 when db unreachable, got %d", rec.Code)
	}
	// The 503 body is the only diagnostic signal, and it must not leak the
	// underlying pg error (which would expose host/connstring details).
	if got := strings.TrimSpace(rec.Body.String()); got != "db unavailable" {
		t.Fatalf("want body 'db unavailable', got %q", got)
	}
}

// Regression guard: /healthz and /readyz must stay outside the auth group.
// denyAuth blocks everything, so a protected route returns 401 while the
// probes still answer — proving they are public (and that denyAuth really
// blocks, so the assertion can't pass for the wrong reason).
func TestProbes_ArePublic(t *testing.T) {
	router := newRouter(
		sync.NewService(nil), catalog.NewService(nil), alerts.NewService(nil),
		denyAuth, okReady,
	)
	for _, p := range []string{"/healthz", "/readyz"} {
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, p, nil))
		if rec.Code != http.StatusOK {
			t.Errorf("%s must be public, got %d", p, rec.Code)
		}
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/sync/pull", nil))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("protected route must require auth (proves denyAuth blocks), got %d", rec.Code)
	}
}

// The handler must hand ready() a deadline-bound context so a slow/hung DB
// can't make the probe block forever. Asserts propagation, not wall-clock time.
func TestReadyz_PassesDeadline(t *testing.T) {
	var hadDeadline bool
	probe := func(ctx context.Context) error {
		_, hadDeadline = ctx.Deadline()
		return nil
	}
	rec := httptest.NewRecorder()
	newTestRouter(probe).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if !hadDeadline {
		t.Fatal("ready() should receive a context with a deadline")
	}
}
