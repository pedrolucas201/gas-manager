CREATE TABLE sync_errors (
  id         BIGSERIAL PRIMARY KEY,
  event_id   TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  user_id    TEXT NOT NULL,
  error_code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
