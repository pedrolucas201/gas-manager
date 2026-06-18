package sync

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

// TestSampleSaleEventJSON prints the exact JSON shape emitted for a sale event.
// Golden-shape regression test: asserts key fields are present and correctly
// formatted, and logs the full JSON for human inspection.
func TestSampleSaleEventJSON(t *testing.T) {
	srvTime := time.Date(2025, 6, 18, 10, 0, 0, 0, time.UTC)
	row := gen.PullSalesRow{
		ID:               mustUUID("aaaaaaaa-0000-0000-0000-000000000001"),
		CustomerID:       mustUUID("22222222-2222-2222-2222-222222222222"),
		CylinderTypeID:   mustUUID("11111111-1111-1111-1111-111111111111"),
		Quantity:         2,
		UnitPrice:        numeric("120.50"),
		CostPrice:        numeric("90.00"),
		Total:            numeric("241.00"),
		PaymentMethod:    "fiado",
		IsExchange:       false,
		VoidedAt:         pgtype.Timestamptz{Valid: false},
		ServerReceivedAt: pgtype.Timestamptz{Time: srvTime, Valid: true},
		Sequence:         42,
	}

	event := Event{
		Kind:             "sale",
		Sequence:         row.Sequence,
		ServerReceivedAt: toTime(row.ServerReceivedAt),
		Data:             mapSaleRow(row),
	}

	b, err := json.MarshalIndent(event, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent: %v", err)
	}
	t.Logf("Sample sale event JSON:\n%s", string(b))

	// Also assert the shape.
	js := string(b)
	assertContains(t, js, `"kind": "sale"`)
	assertContains(t, js, `"sequence": 42`)
	assertContains(t, js, `"unit_price": "120.50"`)
	assertContains(t, js, `"cost_price": "90.00"`)
	assertContains(t, js, `"total": "241.00"`)
	assertContains(t, js, `"customer_id": "22222222`)
	assertContains(t, js, `"voided_at": null`)
	assertContains(t, js, `"is_exchange": false`)
}
