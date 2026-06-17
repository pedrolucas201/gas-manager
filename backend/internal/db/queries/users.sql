-- name: GetUser :one
SELECT id, active, deactivated_at FROM users WHERE id = $1;

-- name: EnsureUser :one
-- Auto-provision an authenticated-but-unknown Firebase UID as a new active
-- user (no RBAC; any linked phone may feed the shared base). The no-op
-- DO UPDATE lets RETURNING fire on conflict without resurrecting a
-- deactivated user (active/deactivated_at are left untouched).
INSERT INTO users (id, name, role)
VALUES ($1, $1, 'employee')
ON CONFLICT (id) DO UPDATE SET id = users.id
RETURNING id, active, deactivated_at;
