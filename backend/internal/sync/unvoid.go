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

// UnvoidSale reverts a previous cancellation: it clears voided_at/voided_by and
// RE-APPLIES, exactly once, the aggregate bumps the original sale had (inventory
// full-=qty / empty+=qty for an exchange, plus +total on a fiado customer's
// balance). Un-voiding a sale that is not voided is idempotent (no second
// application); an unknown id returns ErrSaleNotFound. A catalog_event
// kind="unvoid_sale" is appended so other devices revert the cancellation on
// their next pull. All work runs in one transaction.
func (s *Service) UnvoidSale(ctx context.Context, userID, saleID string) error {
	id := mustUUID(saleID)
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	row, err := q.UnvoidSale(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		// Nothing was un-voided: the sale is either unknown or already active.
		if _, gErr := q.GetSaleByID(ctx, id); errors.Is(gErr, pgx.ErrNoRows) {
			return ErrSaleNotFound
		} else if gErr != nil {
			return gErr
		}
		return tx.Commit(ctx) // already active → idempotent no-op
	}
	if err != nil {
		return err
	}

	if err := q.BumpInventoryForSale(ctx, gen.BumpInventoryForSaleParams{
		Quantity:       row.Quantity,
		IsExchange:     row.IsExchange,
		CylinderTypeID: row.CylinderTypeID,
	}); err != nil {
		return err
	}

	if row.PaymentMethod == "fiado" && row.CustomerID.Valid {
		// Server convention: debt is positive → re-apply +total.
		if err := q.BumpCustomerBalance(ctx, gen.BumpCustomerBalanceParams{
			ID:      row.CustomerID,
			Balance: row.Total,
		}); err != nil {
			return err
		}
	}

	// Append to the same sale_voids stream as the void (kind='unvoid'), so void
	// and unvoid share one monotonic sequence and converge in causal order on
	// every device's pull.
	if _, err := q.InsertSaleUnvoid(ctx, gen.InsertSaleUnvoidParams{
		SaleID:   id,
		VoidedBy: userID,
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

// HandleUnvoidSale serves POST /sync/unvoid-sale with body {"id":"<uuid>"}.
func (s *Service) HandleUnvoidSale(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ID string `json:"id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.ID == "" {
		httpx.Error(w, http.StatusBadRequest, "invalid body")
		return
	}
	err := s.UnvoidSale(r.Context(), auth.UserID(r.Context()), req.ID)
	if errors.Is(err, ErrSaleNotFound) {
		httpx.Error(w, http.StatusNotFound, "sale_not_found")
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "unvoid_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"status": "unvoided"})
}
