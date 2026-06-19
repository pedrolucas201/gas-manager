package sync

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/pedrogomesdev/gas-manager-backend/internal/auth"
)

func TestHandlePush_ReturnsPerEventResults(t *testing.T) {
	pool := newTestDB(t)
	svc := NewService(pool)
	body, _ := json.Marshal(map[string]any{"events": []PushEvent{saleEvent("aaaaaaaa-0000-0000-0000-0000000000aa", 1)}})
	r := httptest.NewRequest("POST", "/sync/push", bytes.NewReader(body))
	r = r.WithContext(auth.WithUserID(r.Context(), seedUser))
	w := httptest.NewRecorder()
	svc.HandlePush(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", w.Code)
	}
	var resp struct {
		Results []PushResult `json:"results"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Results) != 1 || resp.Results[0].Status != "applied" {
		t.Fatalf("unexpected results: %+v", resp.Results)
	}
}
