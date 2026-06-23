package sync

import "testing"

func TestPayloadHash_StableAcrossCalls(t *testing.T) {
	e := PushEvent{Kind: "sale", ID: "abc",
		Sale: &SalePayload{CylinderTypeID: "c1", Quantity: 2, Total: "240.00", PaymentMethod: "cash"}}
	h1, h2 := PayloadHash(e), PayloadHash(e)
	if h1 != h2 {
		t.Fatal("hash must be deterministic")
	}
}

func TestPayloadHash_DiffersWhenMaterialFieldChanges(t *testing.T) {
	a := PushEvent{Kind: "sale", ID: "abc", Sale: &SalePayload{Quantity: 2}}
	b := PushEvent{Kind: "sale", ID: "abc", Sale: &SalePayload{Quantity: 3}}
	if PayloadHash(a) == PayloadHash(b) {
		t.Fatal("different quantity must change hash")
	}
}
