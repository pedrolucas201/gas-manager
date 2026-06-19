package alerts

import (
	"context"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
	"github.com/pedrogomesdev/gas-manager-backend/internal/pgconv"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type NegativeStockItem struct {
	CylinderTypeID string `json:"cylinder_type_id"`
	Name           string `json:"name"`
	FullQty        int32  `json:"full_qty"`
	EmptyQty       int32  `json:"empty_qty"`
}

type OverLimitBalanceItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Balance     string `json:"balance"`
	CreditLimit string `json:"credit_limit"`
}

func (s *Service) NegativeStock(ctx context.Context) ([]NegativeStockItem, error) {
	rows, err := gen.New(s.pool).NegativeStock(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]NegativeStockItem, len(rows))
	for i, r := range rows {
		out[i] = NegativeStockItem{
			CylinderTypeID: pgconv.UUIDToString(r.CylinderTypeID),
			Name:           r.Name,
			FullQty:        r.FullQty,
			EmptyQty:       r.EmptyQty,
		}
	}
	return out, nil
}

func (s *Service) OverLimitBalance(ctx context.Context) ([]OverLimitBalanceItem, error) {
	rows, err := gen.New(s.pool).OverLimitBalance(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]OverLimitBalanceItem, len(rows))
	for i, r := range rows {
		out[i] = OverLimitBalanceItem{
			ID:          pgconv.UUIDToString(r.ID),
			Name:        r.Name,
			Balance:     pgconv.NumericToString(r.Balance),
			CreditLimit: pgconv.NumericToString(r.CreditLimit),
		}
	}
	return out, nil
}

func (s *Service) HandleNegativeStock(w http.ResponseWriter, r *http.Request) {
	items, err := s.NegativeStock(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}

func (s *Service) HandleOverLimitBalance(w http.ResponseWriter, r *http.Request) {
	items, err := s.OverLimitBalance(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, items)
}
