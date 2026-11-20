-- Issue #717: append-only event store for task state + snapshot table.
--
-- event_store is the authoritative mutation log for task state. Every row is an
-- immutable event; current task state is derived by replaying a task's events
-- in sequence order. Two BEFORE triggers make the table append-only: any
-- UPDATE or DELETE raises, so the history can never be silently rewritten.
--
-- task_snapshots caches a projected TaskState at a given sequence so replay
-- can resume from the snapshot instead of re-reading the whole log. A
-- snapshot is written every SNAPSHOT_INTERVAL events (see TaskProjection).

CREATE TABLE IF NOT EXISTS event_store (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId    TEXT    NOT NULL,
  eventType TEXT    NOT NULL,
  payload   TEXT    NOT NULL,   -- JSON
  timestamp TEXT    NOT NULL,
  sequence  INTEGER NOT NULL,
  UNIQUE (taskId, sequence)
);

CREATE INDEX IF NOT EXISTS idx_event_store_taskId
  ON event_store (taskId, sequence);

CREATE TABLE IF NOT EXISTS task_snapshots (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  taskId    TEXT    NOT NULL,
  sequence  INTEGER NOT NULL,
  state     TEXT    NOT NULL,   -- JSON TaskState
  createdAt TEXT    NOT NULL,
  UNIQUE (taskId, sequence)
);

CREATE INDEX IF NOT EXISTS idx_task_snapshots_taskId
  ON task_snapshots (taskId, sequence DESC);

-- Immutability enforcement: the event log is append-only by contract.
-- These triggers are a defence-in-depth so a stray UPDATE/DELETE cannot
-- rewrite history even if application code is buggy.
CREATE TRIGGER IF NOT EXISTS event_store_no_update
BEFORE UPDATE ON event_store
BEGIN
  SELECT RAISE(ABORT, 'event_store is append-only: UPDATE is not permitted');
END;

CREATE TRIGGER IF NOT EXISTS event_store_no_delete
BEFORE DELETE ON event_store
BEGIN
  SELECT RAISE(ABORT, 'event_store is append-only: DELETE is not permitted');
END;
