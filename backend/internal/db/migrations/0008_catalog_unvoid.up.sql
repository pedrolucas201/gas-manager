-- Allow the unvoid_sale event kind to ride the catalog_events pull stream.
ALTER TABLE catalog_events DROP CONSTRAINT catalog_events_kind_check;
ALTER TABLE catalog_events ADD CONSTRAINT catalog_events_kind_check
  CHECK (kind IN ('customer_upsert','customer_delete','cylinder_upsert','unvoid_sale'));
