CREATE TABLE sale_voids (
  id                 BIGSERIAL PRIMARY KEY,
  sale_id            UUID NOT NULL REFERENCES sales(id),
  voided_by          TEXT NOT NULL REFERENCES users(id),
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_voids_id ON sale_voids(id);
