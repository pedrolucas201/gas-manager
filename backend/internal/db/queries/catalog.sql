-- name: UpsertCustomer :exec
INSERT INTO customers (id, name, phone, address, credit_limit, updated_at)
VALUES ($1,$2,$3,$4,$5,$6)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, phone = EXCLUDED.phone, address = EXCLUDED.address,
  credit_limit = EXCLUDED.credit_limit, updated_at = EXCLUDED.updated_at
WHERE customers.updated_at < EXCLUDED.updated_at;

-- name: DeleteCustomerIfNoBalance :execrows
DELETE FROM customers WHERE id = $1 AND balance = 0;

-- name: UnlinkCustomerSales :exec
UPDATE sales SET customer_id = NULL WHERE customer_id = $1;

-- name: UpdateCylinderType :exec
UPDATE cylinder_types SET sale_price=$2, cost_price=$3, active=$4, updated_at=$5
WHERE id=$1 AND updated_at < $5;
