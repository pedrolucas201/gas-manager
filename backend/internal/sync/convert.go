package sync

import (
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/pedrogomesdev/gas-manager-backend/internal/pgconv"
)

func mustUUID(s string) pgtype.UUID { return pgconv.MustUUID(s) }

func numeric(s string) pgtype.Numeric { return pgconv.Numeric(s) }

func toTime(t pgtype.Timestamptz) time.Time { return pgconv.ToTime(t) }

func timestamptz(t time.Time) pgtype.Timestamptz { return pgconv.Timestamptz(t) }
