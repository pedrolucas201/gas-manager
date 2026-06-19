-- Bootstrap seed: the app is P13-only today. Catalog/inventory rows must exist
-- before any phone can push a sale (FK on cylinder_type_id, and the inventory
-- bump silently no-ops if the row is missing). Idempotent on re-run.
-- Prices are initial defaults; the Estoque tab adjusts them via catalog LWW.
INSERT INTO cylinder_types (id, name, weight_kg, sale_price, cost_price)
VALUES ('11111111-1111-1111-1111-111111111111', 'P13', 13, 120, 90)
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory (id, cylinder_type_id, full_qty, empty_qty)
VALUES ('11111111-1111-1111-1111-111111111112',
        '11111111-1111-1111-1111-111111111111', 0, 0)
ON CONFLICT (cylinder_type_id) DO NOTHING;
