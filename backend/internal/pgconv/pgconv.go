// Package pgconv holds small adapters between DTO primitives (strings, time)
// and pgx column types, shared by the sync and catalog packages.
package pgconv

import (
	"fmt"
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

func UUIDToString(u pgtype.UUID) string {
	if !u.Valid {
		return ""
	}
	b := u.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func NumericToString(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	b, _ := n.MarshalJSON()
	return string(b)
}
