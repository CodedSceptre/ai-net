-- Reverse of 005_create_event_store. Drop triggers first, then the tables.

DROP TRIGGER IF EXISTS event_store_no_delete;
DROP TRIGGER IF EXISTS event_store_no_update;

DROP INDEX IF EXISTS idx_task_snapshots_taskId;
DROP TABLE IF EXISTS task_snapshots;

DROP INDEX IF EXISTS idx_event_store_taskId;
DROP TABLE IF EXISTS event_store;
