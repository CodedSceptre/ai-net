-- Add nullable workspaceId column to tasks (personal tasks keep NULL).
ALTER TABLE tasks ADD COLUMN workspaceId TEXT REFERENCES workspaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspaceId);
