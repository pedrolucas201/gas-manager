// Package pgconv holds small adapters between DTO primitives (strings, time)
// and pgx column types, shared by the sync and catalog packages.
package pgconv

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

func MustUUID(s string) pgtype.UUID {
	var u pgtype.UUID
	_ = u.Scan(s)
	return u
}

func Numeric(s string) pgtype.Numeric {
	var n pgtype.Numeric
	_ = n.Scan(s)
	return n
}

func Timestamptz(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

func ToTime(t pgtype.Timestamptz) time.Time { return t.Time }
