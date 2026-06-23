ALTER TABLE inventory ADD COLUMN last_set_at TIMESTAMPTZ;

CREATE TABLE stock_sets (
  id                 UUID PRIMARY KEY,
  cylinder_type_id   UUID NOT NULL REFERENCES cylinder_types(id),
  full_qty           INT NOT NULL,
  empty_qty          INT NOT NULL,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

CREATE INDEX idx_stock_sets_seq ON stock_sets(sequence);
