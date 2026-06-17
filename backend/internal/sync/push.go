package sync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/auth"
	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

// HandlePush decodes a /sync/push batch, applies it for the authenticated user,
// and returns the per-event results.
func (s *Service) HandlePush(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Events []PushEvent `json:"events"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid body")
		return
	}
	uid := auth.UserID(r.Context())
	results, _ := s.Push(r.Context(), uid, req.Events)
	httpx.JSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s *Service) Push(ctx context.Context, userID string, events []PushEvent) ([]PushResult, error) {
	out := make([]PushResult, 0, len(events))
	for _, e := range events {
		out = append(out, s.pushOne(ctx, userID, e))
	}
	return out, nil
}

func (s *Service) pushOne(ctx context.Context, userID string, e PushEvent) PushResult {
	result := s.pushOneInner(ctx, userID, e)
	if result.Status == "error" {
		s.logSyncError(ctx, e.ID, e.Kind, userID, result.Error)
	}
	return result
}

func (s *Service) logSyncError(ctx context.Context, eventID, eventKind, userID, errorCode string) {
	_ = gen.New(s.pool).InsertSyncError(ctx, gen.InsertSyncErrorParams{
		EventID:   eventID,
		EventKind: eventKind,
		UserID:    userID,
		ErrorCode: errorCode,
	})
}

func (s *Service) pushOneInner(ctx context.Context, userID string, e PushEvent) PushResult {
	hash := PayloadHash(e)

	// Idempotency / collision check (read committed; same id is unique PK).
	existing, found, err := s.existingHash(ctx, e)
	if err != nil {
		return PushResult{ID: e.ID, Status: "error", Error: "lookup_failed"}
	}
	if found {
		if existing == hash {
			return PushResult{ID: e.ID, Status: "duplicate"}
		}
		return PushResult{ID: e.ID, Status: "error", Error: "id_conflict"}
	}

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return PushResult{ID: e.ID, Status: "error", Error: "tx_begin"}
	}
	defer tx.Rollback(ctx)

	seq, recvAt, err := s.applyEvent(ctx, tx, userID, e, hash)
	if err != nil {
		// A racing duplicate insert collides on PK → treat as duplicate.
		if isUniqueViolation(err) {
			return PushResult{ID: e.ID, Status: "duplicate"}
		}
		return PushResult{ID: e.ID, Status: "error", Error: "apply_failed"}
	}
	if err := tx.Commit(ctx); err != nil {
		return PushResult{ID: e.ID, Status: "error", Error: "commit_failed"}
	}
	return PushResult{ID: e.ID, Status: "applied", Sequence: &seq, ServerReceivedAt: &recvAt}
}

// HandleSyncErrors serves GET /sync/errors — returns the most recent error log entries.
func (s *Service) HandleSyncErrors(w http.ResponseWriter, r *http.Request) {
	limit := parseLimit(r.URL.Query().Get("limit"), 100)
	rows, err := gen.New(s.pool).RecentSyncErrors(r.Context(), int32(limit))
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	type item struct {
		ID        int64  `json:"id"`
		EventID   string `json:"event_id"`
		EventKind string `json:"event_kind"`
		UserID    string `json:"user_id"`
		ErrorCode string `json:"error_code"`
		CreatedAt string `json:"created_at"`
	}
	out := make([]item, len(rows))
	for i, r := range rows {
		out[i] = item{
			ID:        r.ID,
			EventID:   r.EventID,
			EventKind: r.EventKind,
			UserID:    r.UserID,
			ErrorCode: r.ErrorCode,
			CreatedAt: r.CreatedAt.Time.Format(time.RFC3339),
		}
	}
	httpx.JSON(w, http.StatusOK, out)
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (s *Service) existingHash(ctx context.Context, e PushEvent) (string, bool, error) {
	q := gen.New(s.pool)
	switch e.Kind {
	case "sale":
		row, err := q.GetSaleByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	case "restock":
		row, err := q.GetRestockByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	case "stock_adjustment":
		row, err := q.GetStockAdjustmentByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	case "debt_settlement":
		row, err := q.GetDebtSettlementByID(ctx, mustUUID(e.ID))
		return scanHash(row.PayloadHash, err)
	}
	return "", false, errors.New("unknown kind")
}

func scanHash(h string, err error) (string, bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return h, true, nil
}

func (s *Service) applyEvent(ctx context.Context, tx pgx.Tx, userID string, e PushEvent, hash string) (int64, time.Time, error) {
	q := gen.New(tx)
	switch e.Kind {
	case "sale":
		p := e.Sale
		var custID pgtype.UUID
		if p.CustomerID != nil {
			custID = mustUUID(*p.CustomerID)
		}
		ins, err := q.InsertSale(ctx, gen.InsertSaleParams{
			ID:              mustUUID(e.ID),
			CustomerID:      custID,
			CylinderTypeID:  mustUUID(p.CylinderTypeID),
			Quantity:        int32(p.Quantity),
			UnitPrice:       numeric(p.UnitPrice),
			CostPrice:       numeric(p.CostPrice),
			Total:           numeric(p.Total),
			PaymentMethod:   p.PaymentMethod,
			IsExchange:      p.IsExchange,
			PayloadHash:     hash,
			CreatedBy:       userID,
			ClientCreatedAt: timestamptz(e.ClientCreatedAt),
		})
		if err != nil {
			return 0, time.Time{}, err
		}
		if err := q.BumpInventoryForSale(ctx, gen.BumpInventoryForSaleParams{
			Quantity:       int32(p.Quantity),
			IsExchange:     p.IsExchange,
			CylinderTypeID: mustUUID(p.CylinderTypeID),
		}); err != nil {
			return 0, time.Time{}, err
		}
		if p.CustomerID != nil && p.PaymentMethod == "fiado" {
			if err := q.BumpCustomerBalance(ctx, gen.BumpCustomerBalanceParams{
				ID:      mustUUID(*p.CustomerID),
				Balance: numeric(p.Total),
			}); err != nil {
				return 0, time.Time{}, err
			}
		}
		return ins.Sequence, toTime(ins.ServerReceivedAt), nil

	case "restock":
		p := e.Restock
		ins, err := q.InsertRestock(ctx, gen.InsertRestockParams{
			ID:              mustUUID(e.ID),
			CylinderTypeID:  mustUUID(p.CylinderTypeID),
			Quantity:        int32(p.Quantity),
			CostPerUnit:     numeric(p.CostPerUnit),
			TotalCost:       numeric(p.TotalCost),
			Notes:           p.Notes,
			PayloadHash:     hash,
			CreatedBy:       userID,
			ClientCreatedAt: timestamptz(e.ClientCreatedAt),
		})
		if err != nil {
			return 0, time.Time{}, err
		}
		if err := q.BumpInventoryFull(ctx, gen.BumpInventoryFullParams{
			CylinderTypeID: mustUUID(p.CylinderTypeID),
			FullQty:        int32(p.Quantity),
		}); err != nil {
			return 0, time.Time{}, err
		}
		return ins.Sequence, toTime(ins.ServerReceivedAt), nil

	case "stock_adjustment":
		p := e.StockAdjustment
		ins, err := q.InsertStockAdjustment(ctx, gen.InsertStockAdjustmentParams{
			ID:              mustUUID(e.ID),
			CylinderTypeID:  mustUUID(p.CylinderTypeID),
			Field:           p.Field,
			Delta:           int32(p.Delta),
			Reason:          p.Reason,
			PayloadHash:     hash,
			CreatedBy:       userID,
			ClientCreatedAt: timestamptz(e.ClientCreatedAt),
		})
		if err != nil {
			return 0, time.Time{}, err
		}
		if err := q.BumpInventoryField(ctx, gen.BumpInventoryFieldParams{
			Field:          p.Field,
			Delta:          int32(p.Delta),
			CylinderTypeID: mustUUID(p.CylinderTypeID),
		}); err != nil {
			return 0, time.Time{}, err
		}
		return ins.Sequence, toTime(ins.ServerReceivedAt), nil

	case "debt_settlement":
		p := e.DebtSettlement
		ins, err := q.InsertDebtSettlement(ctx, gen.InsertDebtSettlementParams{
			ID:              mustUUID(e.ID),
			CustomerID:      mustUUID(p.CustomerID),
			Amount:          numeric(p.Amount),
			PaymentMethod:   p.PaymentMethod,
			PayloadHash:     hash,
			CreatedBy:       userID,
			ClientCreatedAt: timestamptz(e.ClientCreatedAt),
		})
		if err != nil {
			return 0, time.Time{}, err
		}
		// A settlement pays down debt: balance decreases by amount.
		if err := q.BumpCustomerBalance(ctx, gen.BumpCustomerBalanceParams{
			ID:      mustUUID(p.CustomerID),
			Balance: numeric("-" + p.Amount),
		}); err != nil {
			return 0, time.Time{}, err
		}
		return ins.Sequence, toTime(ins.ServerReceivedAt), nil
	}
	return 0, time.Time{}, errors.New("unknown kind")
}
