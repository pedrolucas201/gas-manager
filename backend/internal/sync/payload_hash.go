package sync

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// PayloadHash is a deterministic hash of the material content of an event,
// used to distinguish a genuine retry (same hash) from a UUID collision
// (same id, different hash) on /sync/push.
func PayloadHash(e PushEvent) string {
	material := struct {
		Kind            string           `json:"kind"`
		Sale            *SalePayload     `json:"sale,omitempty"`
		Restock         *RestockPayload  `json:"restock,omitempty"`
		StockAdjustment *StockAdjPayload `json:"stock_adjustment,omitempty"`
		DebtSettlement  *SettlePayload   `json:"debt_settlement,omitempty"`
	}{e.Kind, e.Sale, e.Restock, e.StockAdjustment, e.DebtSettlement}
	b, _ := json.Marshal(material)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}
