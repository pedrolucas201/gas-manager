-- Aggregates are mutable; fact tables are append-only.
CREATE TABLE users (
  id              TEXT PRIMARY KEY,            -- Firebase UID
  name            TEXT NOT NULL,
  role            TEXT NOT NULL CHECK (role IN ('admin','employee')),
  active          BOOLEAN NOT NULL DEFAULT true,
  deactivated_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE cylinder_types (
  id          UUID PRIMARY KEY,
  name        TEXT NOT NULL,
  weight_kg   INT NOT NULL,
  sale_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_price  NUMERIC(12,2) NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT true,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id            UUID PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  address       TEXT,
  credit_limit  NUMERIC(12,2),
  balance       NUMERIC(12,2) NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE inventory (
  id                UUID PRIMARY KEY,
  cylinder_type_id  UUID NOT NULL UNIQUE REFERENCES cylinder_types(id),
  full_qty          INT NOT NULL DEFAULT 0,
  empty_qty         INT NOT NULL DEFAULT 0
);

CREATE TABLE sales (
  id                 UUID PRIMARY KEY,
  customer_id        UUID REFERENCES customers(id),
  cylinder_type_id   UUID NOT NULL REFERENCES cylinder_types(id),
  quantity           INT NOT NULL,
  unit_price         NUMERIC(12,2) NOT NULL,
  cost_price         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total              NUMERIC(12,2) NOT NULL,
  payment_method     TEXT NOT NULL,
  is_exchange        BOOLEAN NOT NULL DEFAULT false,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL,
  voided_at          TIMESTAMPTZ,
  voided_by          TEXT REFERENCES users(id)
);

CREATE TABLE restocks (
  id                 UUID PRIMARY KEY,
  cylinder_type_id   UUID NOT NULL REFERENCES cylinder_types(id),
  quantity           INT NOT NULL,
  cost_per_unit      NUMERIC(12,2) NOT NULL,
  total_cost         NUMERIC(12,2) NOT NULL,
  notes              TEXT,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

CREATE TABLE stock_adjustments (
  id                 UUID PRIMARY KEY,
  cylinder_type_id   UUID NOT NULL REFERENCES cylinder_types(id),
  field              TEXT NOT NULL CHECK (field IN ('full','empty')),
  delta              INT NOT NULL,
  reason             TEXT,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

CREATE TABLE debt_settlements (
  id                 UUID PRIMARY KEY,
  customer_id        UUID NOT NULL REFERENCES customers(id),
  amount             NUMERIC(12,2) NOT NULL,
  payment_method     TEXT NOT NULL,
  payload_hash       TEXT NOT NULL,
  created_by         TEXT NOT NULL REFERENCES users(id),
  client_created_at  TIMESTAMPTZ NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sequence           BIGSERIAL NOT NULL
);

CREATE INDEX idx_sales_seq ON sales(sequence);
CREATE INDEX idx_restocks_seq ON restocks(sequence);
CREATE INDEX idx_stock_adjustments_seq ON stock_adjustments(sequence);
CREATE INDEX idx_debt_settlements_seq ON debt_settlements(sequence);
