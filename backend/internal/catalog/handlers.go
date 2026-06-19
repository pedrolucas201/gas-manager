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

// DeleteCustomer unlinks the customer's sales, deletes the row only if the
// balance is zero, and appends a customer_delete catalog event — all in one tx.
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
	data, _ := json.Marshal(map[string]any{"id": id})
	if _, err := q.InsertCatalogEvent(ctx, gen.InsertCatalogEventParams{
		Kind: "customer_delete", RefID: pgconv.MustUUID(id), Data: string(data),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// UpsertCustomer applies a last-write-wins catalog write and appends a
// customer_upsert catalog event — both in one transaction.
func (s *Service) UpsertCustomer(ctx context.Context, in CustomerInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	var creditLimit pgtype.Numeric
	if in.CreditLimit != nil {
		creditLimit = pgconv.Numeric(*in.CreditLimit)
	}
	if err := q.UpsertCustomer(ctx, gen.UpsertCustomerParams{
		ID:          pgconv.MustUUID(in.ID),
		Name:        in.Name,
		Phone:       in.Phone,
		Address:     in.Address,
		CreditLimit: creditLimit,
		UpdatedAt:   pgconv.Timestamptz(in.UpdatedAt),
	}); err != nil {
		return err
	}

	data, _ := json.Marshal(map[string]any{
		"id":         in.ID,
		"name":       in.Name,
		"phone":      in.Phone,
		"address":    in.Address,
		"updated_at": in.UpdatedAt.UTC().Format(time.RFC3339),
	})
	if _, err := q.InsertCatalogEvent(ctx, gen.InsertCatalogEventParams{
		Kind: "customer_upsert", RefID: pgconv.MustUUID(in.ID), Data: string(data),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
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

// UpdateCylinderType applies a last-write-wins price/cost/active edit and
// appends a cylinder_upsert catalog event — both in one transaction.
func (s *Service) UpdateCylinderType(ctx context.Context, id string, in CylinderTypeInput) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	q := gen.New(tx)

	if err := q.UpdateCylinderType(ctx, gen.UpdateCylinderTypeParams{
		ID:        pgconv.MustUUID(id),
		SalePrice: pgconv.Numeric(in.SalePrice),
		CostPrice: pgconv.Numeric(in.CostPrice),
		Active:    in.Active,
		UpdatedAt: pgconv.Timestamptz(in.UpdatedAt),
	}); err != nil {
		return err
	}

	data, _ := json.Marshal(map[string]any{
		"id":         id,
		"sale_price": in.SalePrice,
		"cost_price": in.CostPrice,
		"updated_at": in.UpdatedAt.UTC().Format(time.RFC3339),
	})
	if _, err := q.InsertCatalogEvent(ctx, gen.InsertCatalogEventParams{
		Kind: "cylinder_upsert", RefID: pgconv.MustUUID(id), Data: string(data),
	}); err != nil {
		return err
	}
	return tx.Commit(ctx)
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
