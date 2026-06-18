package pgconv

import (
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

// ---------------------------------------------------------------------------
// UUIDToString — correctness proof
// ---------------------------------------------------------------------------

// TestUUIDToString_ZeroHighByte proves that UUIDToString (which uses %x over
// []byte slices) produces the same zero-padded canonical output as the DTO
// layer's uuidToWire (which uses %08x/%04x/... over the same bytes).
// The UUID aa aa aa aa | 00 01 | 00 02 | 00 03 | 00 00 00 00 00 04
// has zero high bytes in segments 5–8 and 13–16, so it exercises the padding
// path that the code-review "latent bug" claim was about.
func TestUUIDToString_ZeroHighByte(t *testing.T) {
	// bytes: aaaaaaaa-0001-0002-0003-000000000004
	var b [16]byte
	b[0], b[1], b[2], b[3] = 0xaa, 0xaa, 0xaa, 0xaa
	b[4], b[5] = 0x00, 0x01
	b[6], b[7] = 0x00, 0x02
	b[8], b[9] = 0x00, 0x03
	b[10], b[11], b[12], b[13], b[14], b[15] = 0x00, 0x00, 0x00, 0x00, 0x00, 0x04

	u := pgtype.UUID{Bytes: b, Valid: true}
	want := "aaaaaaaa-0001-0002-0003-000000000004"

	got := UUIDToString(u)
	if got != want {
		t.Fatalf("UUIDToString: want %q, got %q (padding bug present)", want, got)
	}
	// t.Logf confirms pgconv was already correct — no bug found.
	t.Logf("UUIDToString: confirmed correct → %q", got)
}

func TestUUIDToString_AllZeroes(t *testing.T) {
	u := pgtype.UUID{Bytes: [16]byte{}, Valid: true}
	want := "00000000-0000-0000-0000-000000000000"
	if got := UUIDToString(u); got != want {
		t.Fatalf("want %q, got %q", want, got)
	}
}

func TestUUIDToString_InvalidReturnsEmpty(t *testing.T) {
	var u pgtype.UUID // Valid==false
	if got := UUIDToString(u); got != "" {
		t.Fatalf("want empty string for invalid UUID, got %q", got)
	}
}

// ---------------------------------------------------------------------------
// NumericToString — NaN and Infinity defensive guard
// ---------------------------------------------------------------------------

func TestNumericToString_NaN_ReturnsZero(t *testing.T) {
	n := pgtype.Numeric{NaN: true, Valid: true}
	got := NumericToString(n)
	if got != "0" {
		t.Fatalf("NaN: want \"0\", got %q", got)
	}
}

func TestNumericToString_Infinity_ReturnsZero(t *testing.T) {
	n := pgtype.Numeric{InfinityModifier: pgtype.Infinity, Valid: true}
	got := NumericToString(n)
	if got != "0" {
		t.Fatalf("Infinity: want \"0\", got %q", got)
	}
}

func TestNumericToString_NegativeInfinity_ReturnsZero(t *testing.T) {
	n := pgtype.Numeric{InfinityModifier: pgtype.NegativeInfinity, Valid: true}
	got := NumericToString(n)
	if got != "0" {
		t.Fatalf("NegativeInfinity: want \"0\", got %q", got)
	}
}

func TestNumericToString_Invalid_ReturnsZero(t *testing.T) {
	var n pgtype.Numeric // Valid==false
	got := NumericToString(n)
	if got != "0" {
		t.Fatalf("invalid: want \"0\", got %q", got)
	}
}

func TestNumericToString_ValidDecimal(t *testing.T) {
	n := Numeric("120.50")
	got := NumericToString(n)
	if got != "120.50" {
		t.Fatalf("want %q, got %q", "120.50", got)
	}
}
