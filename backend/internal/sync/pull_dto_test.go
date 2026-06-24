package sync

import (
	"encoding/json"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"

	"github.com/pedrogomesdev/gas-manager-backend/internal/db/gen"
)

// fixedTime returns a deterministic UTC time for test assertions.
func fixedTime() time.Time {
	return time.Date(2025, 1, 1, 12, 0, 0, 0, time.UTC)
}

// ---------------------------------------------------------------------------
// Helpers: uuidToWire
// ---------------------------------------------------------------------------

func TestUUIDToWire_ValidUUID(t *testing.T) {
	u := mustUUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
	got := uuidToWire(u)
	want := "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
	if got != want {
		t.Fatalf("uuidToWire: want %q, got %q", want, got)
	}
}

func TestUUIDToWire_Canonical8444412Lowercase(t *testing.T) {
	u := mustUUID("11111111-2222-3333-4444-555555555555")
	got := uuidToWire(u)
	// Must be lowercase and 8-4-4-4-12 format.
	parts := strings.Split(got, "-")
	if len(parts) != 5 {
		t.Fatalf("expected 5 hyphen-separated groups, got %q", got)
	}
	if len(parts[0]) != 8 || len(parts[1]) != 4 || len(parts[2]) != 4 || len(parts[3]) != 4 || len(parts[4]) != 12 {
		t.Fatalf("unexpected group lengths in %q", got)
	}
	if got != strings.ToLower(got) {
		t.Fatalf("want lowercase, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// Helpers: nullableUUIDToWire
// ---------------------------------------------------------------------------

func TestNullableUUIDToWire_ValidIsString(t *testing.T) {
	u := mustUUID("22222222-2222-2222-2222-222222222222")
	got := nullableUUIDToWire(u)
	if got == nil {
		t.Fatal("want non-nil pointer for valid UUID")
	}
	if *got != "22222222-2222-2222-2222-222222222222" {
		t.Fatalf("want canonical uuid string, got %q", *got)
	}
}

func TestNullableUUIDToWire_InvalidIsNil(t *testing.T) {
	var u pgtype.UUID // zero value → Valid==false
	got := nullableUUIDToWire(u)
	if got != nil {
		t.Fatalf("want nil for invalid UUID, got %q", *got)
	}
}

// ---------------------------------------------------------------------------
// Helpers: numericToWire
// ---------------------------------------------------------------------------

func TestNumericToWire_DecimalString_120_50(t *testing.T) {
	n := numeric("120.50")
	got := numericToWire(n)
	want := "120.50"
	if got != want {
		t.Fatalf("numericToWire: want %q, got %q", want, got)
	}
}

func TestNumericToWire_DecimalString_90_00(t *testing.T) {
	n := numeric("90.00")
	got := numericToWire(n)
	want := "90.00"
	if got != want {
		t.Fatalf("numericToWire: want %q, got %q", want, got)
	}
}

func TestNumericToWire_Integer(t *testing.T) {
	n := numeric("120")
	got := numericToWire(n)
	want := "120"
	if got != want {
		t.Fatalf("numericToWire: want %q, got %q", want, got)
	}
}

func TestNumericToWire_FromBigInt(t *testing.T) {
	// Construct a pgtype.Numeric directly from big.Int + Exp, mirroring how
	// pgx stores "120.50" internally: Int=12050, Exp=-2.
	n := pgtype.Numeric{Int: big.NewInt(12050), Exp: -2, Valid: true}
	got := numericToWire(n)
	want := "120.50"
	if got != want {
		t.Fatalf("numericToWire: want %q, got %q", want, got)
	}
}

// ---------------------------------------------------------------------------
// Helpers: timestamptzToWire / nullableTimestamptzToWire
// ---------------------------------------------------------------------------

func TestTimestamptzToWire_ValidIsRFC3339(t *testing.T) {
	ts := pgtype.Timestamptz{Time: fixedTime(), Valid: true}
	got := timestamptzToWire(ts)
	if got == "" {
		t.Fatal("want non-empty RFC3339 string")
	}
	// Must contain 'T' separating date/time.
	if !strings.Contains(got, "T") {
		t.Fatalf("want RFC3339 with T, got %q", got)
	}
}

func TestNullableTimestamptzToWire_ValidIsPointer(t *testing.T) {
	ts := pgtype.Timestamptz{Time: fixedTime(), Valid: true}
	got := nullableTimestamptzToWire(ts)
	if got == nil {
		t.Fatal("want non-nil pointer for valid timestamptz")
	}
	if !strings.Contains(*got, "T") {
		t.Fatalf("want RFC3339, got %q", *got)
	}
}

func TestNullableTimestamptzToWire_InvalidIsNil(t *testing.T) {
	var ts pgtype.Timestamptz // Valid==false
	got := nullableTimestamptzToWire(ts)
	if got != nil {
		t.Fatalf("want nil for invalid timestamptz, got %q", *got)
	}
}

// ---------------------------------------------------------------------------
// DTO serialization: JSON shape assertions
// ---------------------------------------------------------------------------

func TestSaleDTO_JSONShape(t *testing.T) {
	dto := saleDTOFixture()
	b, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	js := string(b)

	assertContains(t, js, `"id":"`)
	assertContains(t, js, `"customer_id":`)
	assertContains(t, js, `"cylinder_type_id":"`)
	assertContains(t, js, `"unit_price":"`) // money must be a JSON string (quoted)
	assertContains(t, js, `"cost_price":"`)
	assertContains(t, js, `"total":"`)
	assertContains(t, js, `"payment_method":"`)
	assertContains(t, js, `"is_exchange":`)
	assertContains(t, js, `"voided_at":`)
	assertContains(t, js, `"server_received_at":"`)
	assertContains(t, js, `"sequence":`)

	// money must NOT be a bare number (would look like "total":120 or "total":1)
	assertNotContains(t, js, `"total":1`)
	assertNotContains(t, js, `"unit_price":1`)
}

func TestSaleDTO_NullableCustomerAndVoidedAt(t *testing.T) {
	// Build a row with no customer and no voided_at.
	dto := SaleDTO{
		ID:               "aaaaaaaa-0000-0000-0000-000000000001",
		CustomerID:       nil, // no customer
		CylinderTypeID:   "11111111-1111-1111-1111-111111111111",
		Quantity:         1,
		UnitPrice:        "120.50",
		CostPrice:        "90.00",
		Total:            "120.50",
		PaymentMethod:    "dinheiro",
		IsExchange:       false,
		VoidedAt:         nil, // not voided
		ServerReceivedAt: "2025-01-01T12:00:00Z",
		Sequence:         1,
	}
	b, _ := json.Marshal(dto)
	js := string(b)
	assertContains(t, js, `"customer_id":null`)
	assertContains(t, js, `"voided_at":null`)
}

func TestRestockDTO_JSONShape(t *testing.T) {
	dto := restockDTOFixture()
	b, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	js := string(b)
	assertContains(t, js, `"id":"`)
	assertContains(t, js, `"cylinder_type_id":"`)
	assertContains(t, js, `"cost_per_unit":"`) // money as quoted string
	assertContains(t, js, `"total_cost":"`)    // money as quoted string
	assertContains(t, js, `"server_received_at":"`)
}

func TestStockAdjDTO_JSONShape(t *testing.T) {
	dto := stockAdjDTOFixture()
	b, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	js := string(b)
	assertContains(t, js, `"id":"`)
	assertContains(t, js, `"cylinder_type_id":"`)
	assertContains(t, js, `"field":"`)
	assertContains(t, js, `"delta":`)
	assertContains(t, js, `"server_received_at":"`)
}

func TestDebtSettlementDTO_JSONShape(t *testing.T) {
	dto := debtSettlementDTOFixture()
	b, err := json.Marshal(dto)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	js := string(b)
	assertContains(t, js, `"id":"`)
	assertContains(t, js, `"customer_id":"`)
	assertContains(t, js, `"amount":"`) // money as quoted string
	assertContains(t, js, `"payment_method":"`)
	assertContains(t, js, `"server_received_at":"`)
	// amount must NOT be a bare number
	assertNotContains(t, js, `"amount":1`)
}

// ---------------------------------------------------------------------------
// Mapper: Pull*Row → DTO
// ---------------------------------------------------------------------------

func TestMapSaleRow_CustomerNullWhenInvalid(t *testing.T) {
	row := pullSaleRowFixture()
	row.CustomerID = pgtype.UUID{} // invalid → null customer
	dto := mapSaleRow(row)
	if dto.CustomerID != nil {
		t.Fatalf("want nil customer_id, got %q", *dto.CustomerID)
	}
}

func TestMapSaleRow_CustomerPresentWhenValid(t *testing.T) {
	row := pullSaleRowFixture()
	dto := mapSaleRow(row)
	if dto.CustomerID == nil {
		t.Fatal("want non-nil customer_id")
	}
}

func TestMapSaleRow_VoidedAtNullWhenInvalid(t *testing.T) {
	row := pullSaleRowFixture()
	row.VoidedAt = pgtype.Timestamptz{Valid: false}
	dto := mapSaleRow(row)
	if dto.VoidedAt != nil {
		t.Fatalf("want nil voided_at, got %q", *dto.VoidedAt)
	}
}

func TestMapSaleRow_MoneyAsDecimalString(t *testing.T) {
	row := pullSaleRowFixture()
	dto := mapSaleRow(row)
	// Verify the string is a valid decimal (parseable as float).
	for _, s := range []string{dto.UnitPrice, dto.CostPrice, dto.Total} {
		var f float64
		if err := json.Unmarshal([]byte(s), &f); err != nil {
			t.Fatalf("money field %q is not a valid decimal: %v", s, err)
		}
	}
}

func TestMapRestockRow_MoneyAsDecimalString(t *testing.T) {
	row := pullRestockRowFixture()
	dto := mapRestockRow(row)
	for _, s := range []string{dto.CostPerUnit, dto.TotalCost} {
		var f float64
		if err := json.Unmarshal([]byte(s), &f); err != nil {
			t.Fatalf("money field %q is not a valid decimal: %v", s, err)
		}
	}
}

func TestMapDebtSettlementRow_MoneyAsDecimalString(t *testing.T) {
	row := pullDebtSettlementRowFixture()
	dto := mapDebtSettlementRow(row)
	var f float64
	if err := json.Unmarshal([]byte(dto.Amount), &f); err != nil {
		t.Fatalf("amount %q is not a valid decimal: %v", dto.Amount, err)
	}
}

func TestMapStockAdjRow_FieldDeltaPassThrough(t *testing.T) {
	row := pullStockAdjRowFixture()
	dto := mapStockAdjRow(row)

	if dto.Field != "full" {
		t.Fatalf("field: want %q, got %q", "full", dto.Field)
	}
	if dto.Delta != -3 {
		t.Fatalf("delta: want %d, got %d", -3, dto.Delta)
	}
	if dto.Sequence != 7 {
		t.Fatalf("sequence: want %d, got %d", 7, dto.Sequence)
	}
}

func TestMapStockAdjRow_ReasonNilWhenNil(t *testing.T) {
	row := pullStockAdjRowFixture()
	row.Reason = nil
	dto := mapStockAdjRow(row)
	if dto.Reason != nil {
		t.Fatalf("want nil reason, got %q", *dto.Reason)
	}
}

func TestMapStockAdjRow_ReasonSetWhenNonNil(t *testing.T) {
	row := pullStockAdjRowFixture()
	reason := "inventário mensal"
	row.Reason = &reason
	dto := mapStockAdjRow(row)
	if dto.Reason == nil {
		t.Fatal("want non-nil reason")
	}
	if *dto.Reason != reason {
		t.Fatalf("reason: want %q, got %q", reason, *dto.Reason)
	}
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

func saleDTOFixture() SaleDTO {
	cust := "22222222-2222-2222-2222-222222222222"
	voided := "2025-06-01T10:00:00Z"
	return SaleDTO{
		ID:               "aaaaaaaa-0000-0000-0000-000000000001",
		CustomerID:       &cust,
		CylinderTypeID:   "11111111-1111-1111-1111-111111111111",
		Quantity:         2,
		UnitPrice:        "120.50",
		CostPrice:        "90.00",
		Total:            "241.00",
		PaymentMethod:    "dinheiro",
		IsExchange:       false,
		VoidedAt:         &voided,
		ServerReceivedAt: "2025-01-01T12:00:00Z",
		Sequence:         1,
	}
}

func restockDTOFixture() RestockDTO {
	return RestockDTO{
		ID:               "bbbbbbbb-0000-0000-0000-000000000001",
		CylinderTypeID:   "11111111-1111-1111-1111-111111111111",
		Quantity:         10,
		CostPerUnit:      "90.00",
		TotalCost:        "900.00",
		Notes:            nil,
		ServerReceivedAt: "2025-01-01T12:00:00Z",
		ClientCreatedAt:  "2025-01-01T11:59:00Z",
		Sequence:         2,
	}
}

func stockAdjDTOFixture() StockAdjDTO {
	return StockAdjDTO{
		ID:               "cccccccc-0000-0000-0000-000000000001",
		CylinderTypeID:   "11111111-1111-1111-1111-111111111111",
		Field:            "full",
		Delta:            -1,
		Reason:           nil,
		ServerReceivedAt: "2025-01-01T12:00:00Z",
		Sequence:         3,
	}
}

func debtSettlementDTOFixture() DebtSettlementDTO {
	return DebtSettlementDTO{
		ID:               "dddddddd-0000-0000-0000-000000000001",
		CustomerID:       "22222222-2222-2222-2222-222222222222",
		Amount:           "120.50",
		PaymentMethod:    "dinheiro",
		ServerReceivedAt: "2025-01-01T12:00:00Z",
		ClientCreatedAt:  "2025-01-01T11:59:00Z",
		Sequence:         4,
	}
}

func pullSaleRowFixture() gen.PullSalesRow {
	return gen.PullSalesRow{
		ID:               mustUUID("aaaaaaaa-0000-0000-0000-000000000001"),
		CustomerID:       mustUUID("22222222-2222-2222-2222-222222222222"),
		CylinderTypeID:   mustUUID("11111111-1111-1111-1111-111111111111"),
		Quantity:         1,
		UnitPrice:        numeric("120.50"),
		CostPrice:        numeric("90.00"),
		Total:            numeric("120.50"),
		PaymentMethod:    "dinheiro",
		IsExchange:       false,
		VoidedAt:         pgtype.Timestamptz{Valid: false},
		ServerReceivedAt: pgtype.Timestamptz{Time: fixedTime(), Valid: true},
		Sequence:         1,
	}
}

func pullRestockRowFixture() gen.PullRestocksRow {
	return gen.PullRestocksRow{
		ID:               mustUUID("bbbbbbbb-0000-0000-0000-000000000001"),
		CylinderTypeID:   mustUUID("11111111-1111-1111-1111-111111111111"),
		Quantity:         10,
		CostPerUnit:      numeric("90.00"),
		TotalCost:        numeric("900.00"),
		Notes:            nil,
		ServerReceivedAt: pgtype.Timestamptz{Time: fixedTime(), Valid: true},
		ClientCreatedAt:  pgtype.Timestamptz{Time: fixedTime(), Valid: true},
		Sequence:         2,
	}
}

func pullDebtSettlementRowFixture() gen.PullDebtSettlementsRow {
	return gen.PullDebtSettlementsRow{
		ID:               mustUUID("dddddddd-0000-0000-0000-000000000001"),
		CustomerID:       mustUUID("22222222-2222-2222-2222-222222222222"),
		Amount:           numeric("120.50"),
		PaymentMethod:    "dinheiro",
		ServerReceivedAt: pgtype.Timestamptz{Time: fixedTime(), Valid: true},
		ClientCreatedAt:  pgtype.Timestamptz{Time: fixedTime(), Valid: true},
		Sequence:         4,
	}
}

func pullStockAdjRowFixture() gen.PullStockAdjustmentsRow {
	return gen.PullStockAdjustmentsRow{
		ID:               mustUUID("eeeeeeee-0000-0000-0000-000000000001"),
		CylinderTypeID:   mustUUID("11111111-1111-1111-1111-111111111111"),
		Field:            "full",
		Delta:            -3,
		Reason:           nil,
		ServerReceivedAt: pgtype.Timestamptz{Time: fixedTime(), Valid: true},
		Sequence:         7,
	}
}

// ---------------------------------------------------------------------------
// Assert helpers
// ---------------------------------------------------------------------------

func assertContains(t *testing.T, s, substr string) {
	t.Helper()
	if !strings.Contains(s, substr) {
		t.Errorf("expected JSON to contain %q, got:\n%s", substr, s)
	}
}

func assertNotContains(t *testing.T, s, substr string) {
	t.Helper()
	if strings.Contains(s, substr) {
		t.Errorf("expected JSON NOT to contain %q, got:\n%s", substr, s)
	}
}
