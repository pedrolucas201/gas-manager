package auth

import (
	"context"
	"net/http"
	"strings"
	"time"
)

type ctxKey string

const userIDKey ctxKey = "uid"

type UserRow struct {
	ID            string
	Active        bool
	DeactivatedAt *time.Time
}

// UserLoader fetches the app user mapped to a Firebase UID.
type UserLoader interface {
	LoadUser(ctx context.Context, uid string) (UserRow, error)
}

const graceWindow = 14 * 24 * time.Hour

func Middleware(v Verifier, loader UserLoader, now func() time.Time) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
			if raw == "" {
				http.Error(w, "missing token", http.StatusUnauthorized)
				return
			}
			uid, err := v.Verify(r.Context(), raw)
			if err != nil {
				http.Error(w, "invalid token", http.StatusUnauthorized)
				return
			}
			user, err := loader.LoadUser(r.Context(), uid)
			if err != nil {
				http.Error(w, "unknown user", http.StatusUnauthorized)
				return
			}
			if !user.Active {
				within := user.DeactivatedAt != nil && now().Sub(*user.DeactivatedAt) < graceWindow
				isPush := r.Method == http.MethodPost && r.URL.Path == "/sync/push"
				if !(within && isPush) {
					http.Error(w, "user deactivated", http.StatusUnauthorized)
					return
				}
			}
			ctx := context.WithValue(r.Context(), userIDKey, user.ID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// UserID returns the authenticated user id stored by Middleware.
func UserID(ctx context.Context) string {
	v, _ := ctx.Value(userIDKey).(string)
	return v
}

// WithUserID injects a user id into ctx — used in tests to bypass middleware.
func WithUserID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, userIDKey, id)
}
