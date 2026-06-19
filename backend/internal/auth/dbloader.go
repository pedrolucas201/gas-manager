package auth

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

// DBUserLoader loads the app user mapped to a Firebase UID. There is no RBAC
// and any phone that signs into the Firebase project should be able to feed the
// shared base, so an authenticated-but-unknown UID is auto-provisioned as a new
// active user on its first request instead of being rejected.
type DBUserLoader struct{ pool *pgxpool.Pool }

func NewDBUserLoader(pool *pgxpool.Pool) *DBUserLoader { return &DBUserLoader{pool: pool} }

func (l *DBUserLoader) LoadUser(ctx context.Context, uid string) (UserRow, error) {
	q := gen.New(l.pool)

	u, err := q.GetUser(ctx, uid)
	if err == nil {
		return userRow(u.ID, u.Active, u.DeactivatedAt), nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return UserRow{}, err
	}

	// First time we see this UID — provision it. EnsureUser is idempotent and
	// never resurrects an existing deactivated user.
	ensured, err := q.EnsureUser(ctx, uid)
	if err != nil {
		return UserRow{}, err
	}
	return userRow(ensured.ID, ensured.Active, ensured.DeactivatedAt), nil
}

func userRow(id string, active bool, deactivatedAt pgtype.Timestamptz) UserRow {
	row := UserRow{ID: id, Active: active}
	if deactivatedAt.Valid {
		t := deactivatedAt.Time
		row.DeactivatedAt = &t
	}
	return row
}
