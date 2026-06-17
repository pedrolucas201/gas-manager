-- name: GetUser :one
SELECT id, active, deactivated_at FROM users WHERE id = $1;
