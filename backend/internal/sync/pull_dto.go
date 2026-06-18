package sync

import (
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

// ---------------------------------------------------------------------------
// Wire DTO structs — exported so tests in this package can construct them
// directly. All fields use snake_case JSON tags. Money fields are decimal
// strings (never bare JSON numbers). Nullable fields use *string.
// ---------------------------------------------------------------------------

// SaleDTO is the read-side mirror of SalePayload, extended with server-set
// fields (voided_at, server_received_at, sequence).
type SaleDTO struct {
	ID               string  `json:"id"`
	CustomerID       *string `json:"customer_id"`       // null when no customer
	CylinderTypeID   string  `json:"cylinder_type_id"`
	Quantity         int32   `json:"quantity"`
	UnitPrice        string  `json:"unit_price"`        // decimal string
	CostPrice        string  `json:"cost_price"`        // decimal string
	Total            string  `json:"total"`             // decimal string
	PaymentMethod    string  `json:"payment_method"`
	IsExchange       bool    `json:"is_exchange"`
	VoidedAt         *string `json:"voided_at"`         // RFC3339 or null
	ServerReceivedAt string  `json:"server_received_at"` // RFC3339
	Sequence         int64   `json:"sequence"`
}

// RestockDTO is the read-side DTO for restock events.
type RestockDTO struct {
	ID               string  `json:"id"`
	CylinderTypeID   string  `json:"cylinder_type_id"`
	Quantity         int32   `json:"quantity"`
	CostPerUnit      string  `json:"cost_per_unit"` // decimal string
	TotalCost        string  `json:"total_cost"`    // decimal string
	Notes            *string `json:"notes"`
	ServerReceivedAt string  `json:"server_received_at"`
	Sequence         int64   `json:"sequence"`
}

// StockAdjDTO is the read-side DTO for stock_adjustment events.
type StockAdjDTO struct {
	ID               string  `json:"id"`
	CylinderTypeID   string  `json:"cylinder_type_id"`
	Field            string  `json:"field"`
	Delta            int32   `json:"delta"`
	Reason           *string `json:"reason"`
	ServerReceivedAt string  `json:"server_received_at"`
	Sequence         int64   `json:"sequence"`
}

// DebtSettlementDTO is the read-side DTO for debt_settlement events.
type DebtSettlementDTO struct {
	ID               string `json:"id"`
	CustomerID       string `json:"customer_id"`
	Amount           string `json:"amount"` // decimal string
	PaymentMethod    string `json:"payment_method"`
	ServerReceivedAt string `json:"server_received_at"`
	Sequence         int64  `json:"sequence"`
}

// ---------------------------------------------------------------------------
// pgtype → wire conversion helpers
// ---------------------------------------------------------------------------

// uuidToWire converts a valid pgtype.UUID to a canonical lowercase
// 8-4-4-4-12 hyphenated string. Panics on invalid (callers should only pass
// non-nullable UUIDs that are guaranteed valid by the DB schema).
func uuidToWire(u pgtype.UUID) string {
	b := u.Bytes
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// nullableUUIDToWire converts a pgtype.UUID to *string: nil when not valid
// (NULL in the DB), canonical UUID string otherwise.
func nullableUUIDToWire(u pgtype.UUID) *string {
	if !u.Valid {
		return nil
	}
	s := uuidToWire(u)
	return &s
}

// numericToWire converts a pgtype.Numeric to a plain decimal string such as
// "120.50" or "90". It relies on pgtype.Numeric.MarshalJSON which calls
// numberTextBytes() internally — that produces an unquoted decimal number
// (e.g. the bytes 1,2,0,.,5,0) without scientific notation or curly braces.
// We convert those bytes to a Go string, which is then stored in a string
// field of the DTO and will be marshalled by encoding/json as a JSON string
// (i.e. surrounded by quotes in the final output).
func numericToWire(n pgtype.Numeric) string {
	if !n.Valid {
		return "0"
	}
	b, _ := n.MarshalJSON()
	// MarshalJSON returns "null" for invalid (handled above) and the raw
	// decimal bytes for valid values (no surrounding quotes).
	return string(b)
}

// timestamptzToWire formats a valid pgtype.Timestamptz as an RFC3339 string.
func timestamptzToWire(ts pgtype.Timestamptz) string {
	return ts.Time.UTC().Format(time.RFC3339)
}

// nullableTimestamptzToWire converts a pgtype.Timestamptz to *string: nil
// when not valid (NULL in the DB), RFC3339 string otherwise.
func nullableTimestamptzToWire(ts pgtype.Timestamptz) *string {
	if !ts.Valid {
		return nil
	}
	s := timestamptzToWire(ts)
	return &s
}

// ---------------------------------------------------------------------------
// Row → DTO mappers
// ---------------------------------------------------------------------------

func mapSaleRow(r gen.PullSalesRow) SaleDTO {
	return SaleDTO{
		ID:               uuidToWire(r.ID),
		CustomerID:       nullableUUIDToWire(r.CustomerID),
		CylinderTypeID:   uuidToWire(r.CylinderTypeID),
		Quantity:         r.Quantity,
		UnitPrice:        numericToWire(r.UnitPrice),
		CostPrice:        numericToWire(r.CostPrice),
		Total:            numericToWire(r.Total),
		PaymentMethod:    r.PaymentMethod,
		IsExchange:       r.IsExchange,
		VoidedAt:         nullableTimestamptzToWire(r.VoidedAt),
		ServerReceivedAt: timestamptzToWire(r.ServerReceivedAt),
		Sequence:         r.Sequence,
	}
}

func mapRestockRow(r gen.PullRestocksRow) RestockDTO {
	return RestockDTO{
		ID:               uuidToWire(r.ID),
		CylinderTypeID:   uuidToWire(r.CylinderTypeID),
		Quantity:         r.Quantity,
		CostPerUnit:      numericToWire(r.CostPerUnit),
		TotalCost:        numericToWire(r.TotalCost),
		Notes:            r.Notes,
		ServerReceivedAt: timestamptzToWire(r.ServerReceivedAt),
		Sequence:         r.Sequence,
	}
}

func mapStockAdjRow(r gen.PullStockAdjustmentsRow) StockAdjDTO {
	return StockAdjDTO{
		ID:               uuidToWire(r.ID),
		CylinderTypeID:   uuidToWire(r.CylinderTypeID),
		Field:            r.Field,
		Delta:            r.Delta,
		Reason:           r.Reason,
		ServerReceivedAt: timestamptzToWire(r.ServerReceivedAt),
		Sequence:         r.Sequence,
	}
}

func mapDebtSettlementRow(r gen.PullDebtSettlementsRow) DebtSettlementDTO {
	return DebtSettlementDTO{
		ID:               uuidToWire(r.ID),
		CustomerID:       uuidToWire(r.CustomerID),
		Amount:           numericToWire(r.Amount),
		PaymentMethod:    r.PaymentMethod,
		ServerReceivedAt: timestamptzToWire(r.ServerReceivedAt),
		Sequence:         r.Sequence,
	}
}
