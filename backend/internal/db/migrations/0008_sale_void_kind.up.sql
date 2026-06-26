-- Un-void rides the same sale_voids stream as void so both share one monotonic
-- sequence (id), guaranteeing causal order on pull. kind='void' is the original
-- cancellation; kind='unvoid' reverses it.
ALTER TABLE sale_voids ADD COLUMN kind TEXT NOT NULL DEFAULT 'void'
  CHECK (kind IN ('void','unvoid'));
