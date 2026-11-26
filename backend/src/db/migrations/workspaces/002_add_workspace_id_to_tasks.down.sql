DROP INDEX IF EXISTS idx_tasks_workspace_id;
-- SQLite does not support DROP COLUMN before 3.35; recreate the table without workspaceId.
CREATE TABLE tasks_backup AS SELECT id, prompt, walletPublicKey, status, dagJson, createdAt, updatedAt FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_backup RENAME TO tasks;
