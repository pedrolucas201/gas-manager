-- name: InsertSyncError :exec
INSERT INTO sync_errors (event_id, event_kind, user_id, error_code)
VALUES ($1, $2, $3, $4);

-- name: RecentSyncErrors :many
SELECT id, event_id, event_kind, user_id, error_code, created_at
FROM sync_errors
ORDER BY created_at DESC
LIMIT $1;
