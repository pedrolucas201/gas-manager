package sync

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"sort"
	"strconv"
	"time"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
)

// Cursor holds the last-seen sequence per fact table. Each table owns an
// independent BIGSERIAL, so the cursor advances each table independently.
type Cursor struct {
	Sale    int64 `json:"sale"`
	Restock int64 `json:"restock"`
	Adjust  int64 `json:"adjust"`
	Settle  int64 `json:"settle"`
}

type Event struct {
	Kind             string    `json:"kind"`
	Sequence         int64     `json:"sequence"`
	ServerReceivedAt time.Time `json:"server_received_at"`
	Data             any       `json:"data"`
}

type PullPage struct {
	Events     []Event `json:"events"`
	NextCursor Cursor  `json:"-"`
	HasMore    bool    `json:"has_more"`
}

// Pull merges the four fact streams, each filtered past its own cursor, ordered
// by sequence and capped at limit. The next cursor for a kind only advances to
// the max sequence of the events actually EMITTED for that kind, so truncated
// events are re-fetched on the next page (lossless pagination). hasMore is
// conservative: if any single table returned a full `limit` page there may be
// more, so we report hasMore=true.
func (s *Service) Pull(ctx context.Context, c Cursor, limit int32) (PullPage, error) {
	q := gen.New(s.pool)
	var events []Event
	anyFull := false

	sales, err := q.PullSales(ctx, gen.PullSalesParams{Sequence: c.Sale, Limit: limit})
	if err != nil {
		return PullPage{}, err
	}
	if int32(len(sales)) == limit {
		anyFull = true
	}
	for _, r := range sales {
		events = append(events, Event{Kind: "sale", Sequence: r.Sequence, ServerReceivedAt: toTime(r.ServerReceivedAt), Data: r})
	}

	restocks, err := q.PullRestocks(ctx, gen.PullRestocksParams{Sequence: c.Restock, Limit: limit})
	if err != nil {
		return PullPage{}, err
	}
	if int32(len(restocks)) == limit {
		anyFull = true
	}
	for _, r := range restocks {
		events = append(events, Event{Kind: "restock", Sequence: r.Sequence, ServerReceivedAt: toTime(r.ServerReceivedAt), Data: r})
	}

	adjustments, err := q.PullStockAdjustments(ctx, gen.PullStockAdjustmentsParams{Sequence: c.Adjust, Limit: limit})
	if err != nil {
		return PullPage{}, err
	}
	if int32(len(adjustments)) == limit {
		anyFull = true
	}
	for _, r := range adjustments {
		events = append(events, Event{Kind: "stock_adjustment", Sequence: r.Sequence, ServerReceivedAt: toTime(r.ServerReceivedAt), Data: r})
	}

	settlements, err := q.PullDebtSettlements(ctx, gen.PullDebtSettlementsParams{Sequence: c.Settle, Limit: limit})
	if err != nil {
		return PullPage{}, err
	}
	if int32(len(settlements)) == limit {
		anyFull = true
	}
	for _, r := range settlements {
		events = append(events, Event{Kind: "debt_settlement", Sequence: r.Sequence, ServerReceivedAt: toTime(r.ServerReceivedAt), Data: r})
	}

	sort.SliceStable(events, func(i, j int) bool { return events[i].Sequence < events[j].Sequence })

	hasMore := anyFull || int32(len(events)) > limit
	if int32(len(events)) > limit {
		events = events[:limit]
	}

	// Advance the cursor per kind to the max sequence of EMITTED events only.
	next := c
	for _, e := range events {
		switch e.Kind {
		case "sale":
			if e.Sequence > next.Sale {
				next.Sale = e.Sequence
			}
		case "restock":
			if e.Sequence > next.Restock {
				next.Restock = e.Sequence
			}
		case "stock_adjustment":
			if e.Sequence > next.Adjust {
				next.Adjust = e.Sequence
			}
		case "debt_settlement":
			if e.Sequence > next.Settle {
				next.Settle = e.Sequence
			}
		}
	}

	return PullPage{Events: events, NextCursor: next, HasMore: hasMore}, nil
}

// HandlePull serves GET /sync/pull. The cursor is carried as base64 JSON in
// the `since` query param; `limit` is clamped to [1,500].
func (s *Service) HandlePull(w http.ResponseWriter, r *http.Request) {
	cur := decodeCursor(r.URL.Query().Get("since"))
	limit := parseLimit(r.URL.Query().Get("limit"), 200)
	page, err := s.Pull(r.Context(), cur, limit)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "pull_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"events":      page.Events,
		"next_cursor": encodeCursor(page.NextCursor),
		"has_more":    page.HasMore,
	})
}

func encodeCursor(c Cursor) string {
	b, _ := json.Marshal(c)
	return base64.StdEncoding.EncodeToString(b)
}

func decodeCursor(s string) Cursor {
	var c Cursor
	if s == "" {
		return c
	}
	b, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return c
	}
	_ = json.Unmarshal(b, &c)
	return c
}

func parseLimit(s string, def int32) int32 {
	if s == "" {
		return def
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return def
	}
	if n < 1 {
		return 1
	}
	if n > 500 {
		return 500
	}
	return int32(n)
}
