package catalog

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
	"github.com/pedrogomesdev/gas-manager-backend/internal/pgconv"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type CustomerInput struct {
	ID          string    `json:"id"`
	Name        string    `json:"name"`
	Phone       *string   `json:"phone"`
	Address     *string   `json:"address"`
	CreditLimit *string   `json:"credit_limit"`
	UpdatedAt   time.Time `json:"updated_at"`
}

var ErrBalanceOwed = errors.New("customer has outstanding balance")

// DeleteCustomer unlinks the customer's sales and deletes the row only if the
// balance is zero. Both run in one transaction: a blocked delete (balance != 0)
// rolls back, leaving the sales still linked.
func (s *Service) DeleteCustomer(ctx context.Context, id string) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)
	if err := q.UnlinkCustomerSales(ctx, pgconv.MustUUID(id)); err != nil {
		return err
	}
	rows, err := q.DeleteCustomerIfNoBalance(ctx, pgconv.MustUUID(id))
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrBalanceOwed
	}
	return tx.Commit(ctx)
}

// UpsertCustomer applies a last-write-wins catalog write: the underlying query
// only overwrites when the incoming UpdatedAt is newer.
func (s *Service) UpsertCustomer(ctx context.Context, in CustomerInput) error {
	q := gen.New(s.pool)
	var creditLimit pgtype.Numeric
	if in.CreditLimit != nil {
		creditLimit = pgconv.Numeric(*in.CreditLimit)
	}
	return q.UpsertCustomer(ctx, gen.UpsertCustomerParams{
		ID:          pgconv.MustUUID(in.ID),
		Name:        in.Name,
		Phone:       in.Phone,
		Address:     in.Address,
		CreditLimit: creditLimit,
		UpdatedAt:   pgconv.Timestamptz(in.UpdatedAt),
	})
}

// HandleUpsertCustomer serves PUT /customers.
func (s *Service) HandleUpsertCustomer(w http.ResponseWriter, r *http.Request) {
	var in CustomerInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := s.UpsertCustomer(r.Context(), in); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "upsert_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type CylinderTypeInput struct {
	SalePrice string    `json:"sale_price"`
	CostPrice string    `json:"cost_price"`
	Active    bool      `json:"active"`
	UpdatedAt time.Time `json:"updated_at"`
}

// UpdateCylinderType applies a last-write-wins price/cost/active edit to a
// cylinder type. The underlying query only overwrites when the incoming
// UpdatedAt is newer. The row is expected to already exist (seeded P13).
func (s *Service) UpdateCylinderType(ctx context.Context, id string, in CylinderTypeInput) error {
	q := gen.New(s.pool)
	return q.UpdateCylinderType(ctx, gen.UpdateCylinderTypeParams{
		ID:        pgconv.MustUUID(id),
		SalePrice: pgconv.Numeric(in.SalePrice),
		CostPrice: pgconv.Numeric(in.CostPrice),
		Active:    in.Active,
		UpdatedAt: pgconv.Timestamptz(in.UpdatedAt),
	})
}

// HandleUpdateCylinderType serves PUT /catalog/cylinder-types/{id}.
func (s *Service) HandleUpdateCylinderType(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var in CylinderTypeInput
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpx.Error(w, http.StatusBadRequest, "invalid body")
		return
	}
	if err := s.UpdateCylinderType(r.Context(), id, in); err != nil {
		httpx.Error(w, http.StatusInternalServerError, "update_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// HandleDeleteCustomer serves DELETE /customers/{id}.
func (s *Service) HandleDeleteCustomer(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	err := s.DeleteCustomer(r.Context(), id)
	if errors.Is(err, ErrBalanceOwed) {
		httpx.Error(w, http.StatusConflict, "balance_owed")
		return
	}
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "delete_failed")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
