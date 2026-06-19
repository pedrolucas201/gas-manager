package sync

import "testing"

func TestNumeric_ParsesDecimalString(t *testing.T) {
	n := numeric("120.50")
	if !n.Valid {
		t.Fatal("want valid numeric")
	}
}

func TestMustUUID_RoundTrips(t *testing.T) {
	u := mustUUID("11111111-1111-1111-1111-111111111111")
	if !u.Valid {
		t.Fatal("want valid uuid")
	}
}
