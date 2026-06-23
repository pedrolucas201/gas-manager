package reports

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/pedrogomesdev/gas-manager-backend/internal/httpx"
)

type Service struct{ pool *pgxpool.Pool }

func NewService(pool *pgxpool.Pool) *Service { return &Service{pool: pool} }

type SummaryResponse struct {
	Revenue  float64 `json:"revenue"`
	Profit   float64 `json:"profit"`
	Expenses float64 `json:"expenses"`
	NetFlow  float64 `json:"net_flow"`
}

type SalesDayRow struct {
	Day   string  `json:"day"`
	Total float64 `json:"total"`
	Count int     `json:"count"`
}

type SaleRow struct {
	ID              string  `json:"id"`
	CustomerName    string  `json:"customer_name"`
	PaymentMethod   string  `json:"payment_method"`
	Total           float64 `json:"total"`
	ClientCreatedAt string  `json:"client_created_at"`
}

type SalesResponse struct {
	ByDay []SalesDayRow `json:"by_day"`
	List  []SaleRow     `json:"list"`
}

type ExpenseCategoryRow struct {
	Category string  `json:"category"`
	Total    float64 `json:"total"`
}

type ExpenseRow struct {
	ID              string  `json:"id"`
	Category        string  `json:"category"`
	Description     string  `json:"description"`
	Amount          float64 `json:"amount"`
	ClientCreatedAt string  `json:"client_created_at"`
}

type ExpensesResponse struct {
	ByCategory []ExpenseCategoryRow `json:"by_category"`
	List       []ExpenseRow         `json:"list"`
}

type DebtorRow struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Balance     float64 `json:"balance"`
	CreditLimit float64 `json:"credit_limit"`
}

type DebtorsResponse struct {
	Total   float64     `json:"total"`
	Debtors []DebtorRow `json:"debtors"`
}

type InventoryRow struct {
	Name     string `json:"name"`
	FullQty  int32  `json:"full_qty"`
	EmptyQty int32  `json:"empty_qty"`
}

// parseDateRange reads ?from=YYYY-MM-DD&to=YYYY-MM-DD; default = current month in São Paulo.
func parseDateRange(r *http.Request) (from, to time.Time) {
	loc, _ := time.LoadLocation("America/Sao_Paulo")
	now := time.Now().In(loc)
	from = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, loc)
	to = time.Date(now.Year(), now.Month()+1, 0, 23, 59, 59, 0, loc)

	if s := r.URL.Query().Get("from"); s != "" {
		if t, err := time.ParseInLocation("2006-01-02", s, loc); err == nil {
			from = t
		}
	}
	if s := r.URL.Query().Get("to"); s != "" {
		if t, err := time.ParseInLocation("2006-01-02", s, loc); err == nil {
			to = time.Date(t.Year(), t.Month(), t.Day(), 23, 59, 59, 0, loc)
		}
	}
	return from, to
}

func (s *Service) Summary(ctx context.Context, from, to time.Time) (SummaryResponse, error) {
	var revenue, profit float64
	err := s.pool.QueryRow(ctx, `
		SELECT
			COALESCE(SUM(total),0)::FLOAT8,
			COALESCE(SUM((unit_price - cost_price) * quantity),0)::FLOAT8
		FROM sales
		WHERE voided_at IS NULL AND client_created_at BETWEEN $1 AND $2
	`, from, to).Scan(&revenue, &profit)
	if err != nil {
		return SummaryResponse{}, err
	}

	var expenses float64
	err = s.pool.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount),0)::FLOAT8
		FROM expenses
		WHERE client_created_at BETWEEN $1 AND $2
	`, from, to).Scan(&expenses)
	if err != nil {
		return SummaryResponse{}, err
	}

	return SummaryResponse{
		Revenue:  revenue,
		Profit:   profit,
		Expenses: expenses,
		NetFlow:  revenue - expenses,
	}, nil
}

func (s *Service) HandleSummary(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r)
	data, err := s.Summary(r.Context(), from, to)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Service) Sales(ctx context.Context, from, to time.Time) (SalesResponse, error) {
	byDayRows, err := s.pool.Query(ctx, `
		SELECT
			to_char(client_created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD'),
			SUM(total)::FLOAT8,
			COUNT(*)::INT
		FROM sales
		WHERE voided_at IS NULL AND client_created_at BETWEEN $1 AND $2
		GROUP BY 1 ORDER BY 1
	`, from, to)
	if err != nil {
		return SalesResponse{}, err
	}
	defer byDayRows.Close()
	var byDay []SalesDayRow
	for byDayRows.Next() {
		var row SalesDayRow
		if err := byDayRows.Scan(&row.Day, &row.Total, &row.Count); err != nil {
			return SalesResponse{}, err
		}
		byDay = append(byDay, row)
	}
	if byDay == nil {
		byDay = []SalesDayRow{}
	}

	listRows, err := s.pool.Query(ctx, `
		SELECT
			s.id::TEXT,
			COALESCE(c.name, 'Balcão'),
			s.payment_method,
			s.total::FLOAT8,
			s.client_created_at::TEXT
		FROM sales s
		LEFT JOIN customers c ON s.customer_id = c.id
		WHERE s.voided_at IS NULL AND s.client_created_at BETWEEN $1 AND $2
		ORDER BY s.client_created_at DESC
		LIMIT 100
	`, from, to)
	if err != nil {
		return SalesResponse{}, err
	}
	defer listRows.Close()
	var list []SaleRow
	for listRows.Next() {
		var row SaleRow
		if err := listRows.Scan(&row.ID, &row.CustomerName, &row.PaymentMethod, &row.Total, &row.ClientCreatedAt); err != nil {
			return SalesResponse{}, err
		}
		list = append(list, row)
	}
	if list == nil {
		list = []SaleRow{}
	}

	return SalesResponse{ByDay: byDay, List: list}, nil
}

func (s *Service) HandleSales(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r)
	data, err := s.Sales(r.Context(), from, to)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Service) Expenses(ctx context.Context, from, to time.Time) (ExpensesResponse, error) {
	catRows, err := s.pool.Query(ctx, `
		SELECT category, SUM(amount)::FLOAT8
		FROM expenses
		WHERE client_created_at BETWEEN $1 AND $2
		GROUP BY category ORDER BY 2 DESC
	`, from, to)
	if err != nil {
		return ExpensesResponse{}, err
	}
	defer catRows.Close()
	var byCategory []ExpenseCategoryRow
	for catRows.Next() {
		var row ExpenseCategoryRow
		if err := catRows.Scan(&row.Category, &row.Total); err != nil {
			return ExpensesResponse{}, err
		}
		byCategory = append(byCategory, row)
	}
	if byCategory == nil {
		byCategory = []ExpenseCategoryRow{}
	}

	listRows, err := s.pool.Query(ctx, `
		SELECT id::TEXT, category, COALESCE(description,''), amount::FLOAT8, client_created_at::TEXT
		FROM expenses
		WHERE client_created_at BETWEEN $1 AND $2
		ORDER BY client_created_at DESC
		LIMIT 100
	`, from, to)
	if err != nil {
		return ExpensesResponse{}, err
	}
	defer listRows.Close()
	var list []ExpenseRow
	for listRows.Next() {
		var row ExpenseRow
		if err := listRows.Scan(&row.ID, &row.Category, &row.Description, &row.Amount, &row.ClientCreatedAt); err != nil {
			return ExpensesResponse{}, err
		}
		list = append(list, row)
	}
	if list == nil {
		list = []ExpenseRow{}
	}

	return ExpensesResponse{ByCategory: byCategory, List: list}, nil
}

func (s *Service) HandleExpenses(w http.ResponseWriter, r *http.Request) {
	from, to := parseDateRange(r)
	data, err := s.Expenses(r.Context(), from, to)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Service) Debtors(ctx context.Context) (DebtorsResponse, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT id::TEXT, name, balance::FLOAT8, COALESCE(credit_limit,0)::FLOAT8
		FROM customers
		WHERE balance > 0
		ORDER BY balance DESC
	`)
	if err != nil {
		return DebtorsResponse{}, err
	}
	defer rows.Close()
	var debtors []DebtorRow
	var total float64
	for rows.Next() {
		var row DebtorRow
		if err := rows.Scan(&row.ID, &row.Name, &row.Balance, &row.CreditLimit); err != nil {
			return DebtorsResponse{}, err
		}
		total += row.Balance
		debtors = append(debtors, row)
	}
	if debtors == nil {
		debtors = []DebtorRow{}
	}
	return DebtorsResponse{Total: total, Debtors: debtors}, nil
}

func (s *Service) HandleDebtors(w http.ResponseWriter, r *http.Request) {
	data, err := s.Debtors(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}

func (s *Service) Inventory(ctx context.Context) ([]InventoryRow, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT ct.name, i.full_qty::INT, i.empty_qty::INT
		FROM inventory i
		JOIN cylinder_types ct ON ct.id = i.cylinder_type_id
		WHERE ct.active = true
		ORDER BY ct.name
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []InventoryRow
	for rows.Next() {
		var row InventoryRow
		if err := rows.Scan(&row.Name, &row.FullQty, &row.EmptyQty); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	if out == nil {
		out = []InventoryRow{}
	}
	return out, nil
}

func (s *Service) HandleInventory(w http.ResponseWriter, r *http.Request) {
	data, err := s.Inventory(r.Context())
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "query_failed")
		return
	}
	httpx.JSON(w, http.StatusOK, data)
}
