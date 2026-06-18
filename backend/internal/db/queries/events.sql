-- name: GetSaleByID :one
SELECT id, payload_hash FROM sales WHERE id = $1;

-- name: InsertSale :one
INSERT INTO sales (id, customer_id, cylinder_type_id, quantity, unit_price,
  cost_price, total, payment_method, is_exchange, payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
RETURNING sequence, server_received_at;

-- name: BumpInventoryForSale :exec
UPDATE inventory SET full_qty = full_qty - sqlc.arg(quantity)::int,
  empty_qty = empty_qty + (CASE WHEN sqlc.arg(is_exchange)::boolean THEN sqlc.arg(quantity)::int ELSE 0 END)
WHERE cylinder_type_id = sqlc.arg(cylinder_type_id);

-- name: BumpCustomerBalance :exec
UPDATE customers SET balance = balance + $2 WHERE id = $1;

-- name: VoidSale :one
UPDATE sales SET voided_at = now(), voided_by = sqlc.arg(voided_by)
WHERE id = sqlc.arg(id) AND voided_at IS NULL
RETURNING quantity, is_exchange, payment_method, customer_id, total, cylinder_type_id;

-- name: ReverseInventoryForSale :exec
UPDATE inventory SET full_qty = full_qty + sqlc.arg(quantity)::int,
  empty_qty = empty_qty - (CASE WHEN sqlc.arg(is_exchange)::boolean THEN sqlc.arg(quantity)::int ELSE 0 END)
WHERE cylinder_type_id = sqlc.arg(cylinder_type_id);

-- name: ReverseCustomerBalance :exec
UPDATE customers SET balance = balance - sqlc.arg(amount) WHERE id = sqlc.arg(id);

-- name: GetRestockByID :one
SELECT id, payload_hash FROM restocks WHERE id = $1;

-- name: InsertRestock :one
INSERT INTO restocks (id, cylinder_type_id, quantity, cost_per_unit, total_cost,
  notes, payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
RETURNING sequence, server_received_at;

-- name: BumpInventoryFull :exec
UPDATE inventory SET full_qty = full_qty + $2 WHERE cylinder_type_id = $1;

-- name: GetStockAdjustmentByID :one
SELECT id, payload_hash FROM stock_adjustments WHERE id = $1;

-- name: InsertStockAdjustment :one
INSERT INTO stock_adjustments (id, cylinder_type_id, field, delta, reason,
  payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
RETURNING sequence, server_received_at;

-- name: BumpInventoryField :exec
UPDATE inventory
SET full_qty  = full_qty  + (CASE WHEN sqlc.arg(field)::text = 'full'  THEN sqlc.arg(delta)::int ELSE 0 END),
    empty_qty = empty_qty + (CASE WHEN sqlc.arg(field)::text = 'empty' THEN sqlc.arg(delta)::int ELSE 0 END)
WHERE cylinder_type_id = sqlc.arg(cylinder_type_id);

-- name: GetDebtSettlementByID :one
SELECT id, payload_hash FROM debt_settlements WHERE id = $1;

-- name: InsertDebtSettlement :one
INSERT INTO debt_settlements (id, customer_id, amount, payment_method,
  payload_hash, created_by, client_created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7)
RETURNING sequence, server_received_at;

-- name: PullSales :many
SELECT id, customer_id, cylinder_type_id, quantity, unit_price, cost_price, total,
  payment_method, is_exchange, voided_at, server_received_at, sequence
FROM sales WHERE sequence > $1 ORDER BY sequence LIMIT $2;

-- name: PullRestocks :many
SELECT id, cylinder_type_id, quantity, cost_per_unit, total_cost, notes,
  server_received_at, sequence
FROM restocks WHERE sequence > $1 ORDER BY sequence LIMIT $2;

-- name: PullStockAdjustments :many
SELECT id, cylinder_type_id, field, delta, reason, server_received_at, sequence
FROM stock_adjustments WHERE sequence > $1 ORDER BY sequence LIMIT $2;

-- name: PullDebtSettlements :many
SELECT id, customer_id, amount, payment_method, server_received_at, sequence
FROM debt_settlements WHERE sequence > $1 ORDER BY sequence LIMIT $2;
