package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeVerifier struct {
	uid string
	err error
}

func (f fakeVerifier) Verify(_ context.Context, _ string) (string, error) { return f.uid, f.err }

type fakeLoader struct {
	user UserRow
	err  error
}

func (f fakeLoader) LoadUser(_ context.Context, _ string) (UserRow, error) { return f.user, f.err }

func newReq(method, path string) *http.Request {
	r := httptest.NewRequest(method, path, nil)
	r.Header.Set("Authorization", "Bearer x")
	return r
}

func run(t *testing.T, v Verifier, l UserLoader, now time.Time, r *http.Request) int {
	t.Helper()
	w := httptest.NewRecorder()
	h := Middleware(v, l, func() time.Time { return now })(
		http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(200) }))
	h.ServeHTTP(w, r)
	return w.Code
}

func TestMiddleware_ActiveUserPasses(t *testing.T) {
	code := run(t, fakeVerifier{uid: "u1"}, fakeLoader{user: UserRow{ID: "u1", Active: true}},
		time.Now(), newReq("GET", "/sync/pull"))
	if code != 200 {
		t.Fatalf("want 200, got %d", code)
	}
}

func TestMiddleware_DeactivatedWithinGraceCanPush(t *testing.T) {
	d := time.Now().Add(-2 * 24 * time.Hour)
	code := run(t, fakeVerifier{uid: "u1"},
		fakeLoader{user: UserRow{ID: "u1", Active: false, DeactivatedAt: &d}},
		time.Now(), newReq("POST", "/sync/push"))
	if code != 200 {
		t.Fatalf("want 200 (grace push), got %d", code)
	}
}

func TestMiddleware_DeactivatedWithinGraceCannotPull(t *testing.T) {
	d := time.Now().Add(-2 * 24 * time.Hour)
	code := run(t, fakeVerifier{uid: "u1"},
		fakeLoader{user: UserRow{ID: "u1", Active: false, DeactivatedAt: &d}},
		time.Now(), newReq("GET", "/sync/pull"))
	if code != 401 {
		t.Fatalf("want 401, got %d", code)
	}
}

func TestMiddleware_DeactivatedAfterGraceBlocksPush(t *testing.T) {
	d := time.Now().Add(-20 * 24 * time.Hour)
	code := run(t, fakeVerifier{uid: "u1"},
		fakeLoader{user: UserRow{ID: "u1", Active: false, DeactivatedAt: &d}},
		time.Now(), newReq("POST", "/sync/push"))
	if code != 401 {
		t.Fatalf("want 401, got %d", code)
	}
}

func TestMiddleware_BadTokenIs401(t *testing.T) {
	code := run(t, fakeVerifier{err: ErrInvalidToken}, fakeLoader{},
		time.Now(), newReq("GET", "/sync/pull"))
	if code != 401 {
		t.Fatalf("want 401, got %d", code)
	}
}
