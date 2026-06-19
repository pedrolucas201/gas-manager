package sync

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/pedrogomesdev/gas-manager-backend/internal/auth"
	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
)

// ErrSaleNotFound is returned when voiding a sale id that does not exist.
var ErrSaleNotFound = errors.New("sale not found")

// VoidSale cancels a sale as a new ledger event: it stamps voided_at/voided_by
// and reverses, exactly once, the aggregate bumps the original sale applied
// (inventory, plus the customer balance for a fiado sale). Voiding an
// already-voided sale is idempotent (no second reversal); an unknown id returns
// ErrSaleNotFound. All work runs in one transaction.
func (s *Service) VoidSale(ctx context.Context, userID, saleID string) error {
	id := mustUUID(saleID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	row, err := q.VoidSale(ctx, gen.VoidSaleParams{VoidedBy: &userID, ID: id})
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing was voided: the sale is either unknown or already voided.
		if _, gErr := q.GetSaleByID(ctx, id); errors.Is(gErr, pgx.ErrNoRows) {
			return ErrSaleNotFound
		} else if gErr != nil {
			return gErr
		}
		return tx.Commit(ctx) // already voided → idempotent no-op
	}
	if err != nil {
		return err
	}

	if err := q.ReverseInventoryForSale(ctx, gen.ReverseInventoryForSaleParams{
		Quantity:       row.Quantity,
		IsExchange:     row.IsExchange,
		CylinderTypeID: row.CylinderTypeID,
	}); err != nil {
		return err
	}

	if row.PaymentMethod == "fiado" && row.CustomerID.Valid {
		if err := q.ReverseCustomerBalance(ctx, gen.ReverseCustomerBalanceParams{
			Amount: row.Total,
			ID:     row.CustomerID,
		}); err != nil {
			return err
		}
	}

	// Append to the pull stream so other devices see the cancellation.
	if _, err := q.InsertSaleVoid(ctx, gen.InsertSaleVoidParams{
		SaleID:   id,
		VoidedBy: userID,
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// HandleVoidSale serves POST /sync/void-sale with body {"id":"<uuid>"}.
func (s *Service) HandleVoidSale(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		httpx.Error(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := s.VoidSale(r.Context(), auth.UserID(r.Context()), req.ID)
	if errors.Is(err, ErrSaleNotFound) {
		httpx.Error(w, http.StatusNotFound, "sale_not_found")
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "void_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"status": "voided"})
}
