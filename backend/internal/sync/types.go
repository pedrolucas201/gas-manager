package sync

import "time"

// PushEvent is one client event in a /sync/push batch. Kind selects the table.
type PushEvent struct {
	Kind            string           `json:"kind"` // sale|restock|stock_adjustment|debt_settlement|expense
	ID              string           `json:"id"`   // client UUID
	ClientCreatedAt time.Time        `json:"client_created_at"`
	Sale            *SalePayload     `json:"sale,omitempty"`
	Restock         *RestockPayload  `json:"restock,omitempty"`
	StockAdjustment *StockAdjPayload `json:"stock_adjustment,omitempty"`
	DebtSettlement  *SettlePayload   `json:"debt_settlement,omitempty"`
	Expense         *ExpensePayload  `json:"expense,omitempty"`
}

type SalePayload struct {
	CustomerID     *string `json:"customer_id"`
	CylinderTypeID string  `json:"cylinder_type_id"`
	Quantity       int     `json:"quantity"`
	UnitPrice      string  `json:"unit_price"`
	CostPrice      string  `json:"cost_price"`
	Total          string  `json:"total"`
	PaymentMethod  string  `json:"payment_method"`
	IsExchange     bool    `json:"is_exchange"`
}

type RestockPayload struct {
	CylinderTypeID string  `json:"cylinder_type_id"`
	Quantity       int     `json:"quantity"`
	CostPerUnit    string  `json:"cost_per_unit"`
	TotalCost      string  `json:"total_cost"`
	Notes          *string `json:"notes"`
}

type StockAdjPayload struct {
	CylinderTypeID string  `json:"cylinder_type_id"`
	Field          string  `json:"field"` // full|empty
	Delta          int     `json:"delta"`
	Reason         *string `json:"reason"`
}

type SettlePayload struct {
	CustomerID    string `json:"customer_id"`
	Amount        string `json:"amount"`
	PaymentMethod string `json:"payment_method"`
}

type ExpensePayload struct {
	Category    string  `json:"category"`
	Description *string `json:"description"`
	Amount      string  `json:"amount"` // decimal string
}

// PushResult is the per-event outcome returned to the client.
type PushResult struct {
	ID               string     `json:"id"`
	Status           string     `json:"status"` // applied|duplicate|error
	Sequence         *int64     `json:"sequence,omitempty"`
	ServerReceivedAt *time.Time `json:"server_received_at,omitempty"`
	Error            string     `json:"error,omitempty"`
}
