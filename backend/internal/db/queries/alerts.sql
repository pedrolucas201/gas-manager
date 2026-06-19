-- name: NegativeStock :many
SELECT i.cylinder_type_id, ct.name, i.full_qty, i.empty_qty
FROM inventory i JOIN cylinder_types ct ON ct.id = i.cylinder_type_id
WHERE i.full_qty < 0 OR i.empty_qty < 0;

-- name: OverLimitBalance :many
SELECT id, name, balance, credit_limit
FROM customers
WHERE credit_limit IS NOT NULL AND balance > credit_limit;
