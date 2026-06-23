CREATE TABLE expenses (
  id                 UUID PRIMARY KEY,
  category           TEXT NOT NULL,
  description        TEXT,
  amount             NUMERIC(12,2) NOT NULL,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

CREATE INDEX idx_expenses_seq ON expenses(sequence);
