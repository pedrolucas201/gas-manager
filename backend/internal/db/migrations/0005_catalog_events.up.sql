CREATE TABLE catalog_events (
  id                 BIGSERIAL PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('customer_upsert','customer_delete','cylinder_upsert')),
  ref_id             UUID NOT NULL,
  data               TEXT NOT NULL,
  server_received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_catalog_events_id ON catalog_events(id);
