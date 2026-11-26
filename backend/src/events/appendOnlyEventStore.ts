/**
 * Append-only event store backed by SQLite (issue #717).
 *
 * This is the issue-spec event store: a single `event_store` table whose rows
 * are immutable events keyed by `(taskId, sequence)`, plus a `task_snapshots`
 * table used by {@link TaskProjection} to short-circuit replay. The DDL is
 * applied inline so the store is usable without an external migration runner
 * (in tests and on a freshly opened connection); the canonical schema also
 * lives in `db/migrations/tasks/005_create_event_store.up.sql`.
 *
 * Immutability is enforced two ways:
 *   • The store API exposes no UPDATE/DELETE — only `append`.
 *   • `BEFORE UPDATE` / `BEFORE DELETE` triggers raise if anything ever tries
 *     to mutate a committed row, so a buggy caller cannot rewrite history.
 *
 * `append` assigns `sequence = MAX(sequence) + 1` for the task inside a
 * SQLite transaction, so concurrent appends produce a gap-free, duplicate-free
 * sequence (the `UNIQUE(taskId, sequence)` constraint is the backstop).
 *
 * The store never imports the native `better-sqlite3` module at runtime — it
 * accepts an already-open `Database` instance (dependency injection) and only
 * references its TypeScript type. This keeps the store free of the test
 * environment's `better-sqlite3` mock: tests pass a real `Database` in.
 */

import type Database from 'better-sqlite3';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** All event types this store recognises (mirrors `events/eventTypes.ts`). */
export type AppendOnlyEventType =
  | 'TaskCreated'
  | 'NodeStarted'
  | 'NodeCompleted'
  | 'NodeFailed'
  | 'PaymentLocked'
  | 'PaymentReleased'
  | 'TaskCompleted'
  | 'TaskFailed'
  | 'TaskInterrupted';

/** A committed event row, exactly as stored in `event_store`. */
export interface AppendOnlyEvent {
  id: number;
  taskId: string;
  eventType: AppendOnlyEventType;
  /** Parsed JSON payload (round-trips through serialisation intact). */
  payload: unknown;
  /** ISO-8601 timestamp assigned on append. */
  timestamp: string;
  /** Per-task sequence number (1-based). */
  sequence: number;
}

/** A persisted projection snapshot used to resume replay. */
export interface TaskSnapshot {
  id: number;
  taskId: string;
  sequence: number;
  /** Parsed JSON TaskState. */
  state: unknown;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// DDL — mirrors db/migrations/tasks/005_create_event_store.up.sql
// ---------------------------------------------------------------------------

export const EVENT_STORE_DDL = `
  CREATE TABLE IF NOT EXISTS event_store (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    taskId    TEXT    NOT NULL,
    eventType TEXT    NOT NULL,
    payload   TEXT    NOT NULL,
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
    state     TEXT    NOT NULL,
    createdAt TEXT    NOT NULL,
    UNIQUE (taskId, sequence)
  );

  CREATE INDEX IF NOT EXISTS idx_task_snapshots_taskId
    ON task_snapshots (taskId, sequence DESC);

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
`;

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

interface EventRow {
  id: number;
  taskId: string;
  eventType: string;
  payload: string;
  timestamp: string;
  sequence: number;
}

interface SnapshotRow {
  id: number;
  taskId: string;
  sequence: number;
  state: string;
  createdAt: string;
}

function rowToEvent(row: EventRow): AppendOnlyEvent {
  return {
    id: row.id,
    taskId: row.taskId,
    eventType: row.eventType as AppendOnlyEventType,
    payload: JSON.parse(row.payload),
    timestamp: row.timestamp,
    sequence: row.sequence,
  };
}

function rowToSnapshot(row: SnapshotRow): TaskSnapshot {
  return {
    id: row.id,
    taskId: row.taskId,
    sequence: row.sequence,
    state: JSON.parse(row.state),
    createdAt: row.createdAt,
  };
}

// ---------------------------------------------------------------------------
// AppendOnlyEventStore
// ---------------------------------------------------------------------------

/**
 * Create an append-only event store over an open SQLite `Database`.
 *
 * The store owns no connection lifecycle beyond the `close()` it forwards to
 * the supplied database. Pass a `:memory:` database for tests, or the shared
 * task database in production.
 */
export class AppendOnlyEventStore {
  private readonly insertStmt;
  private readonly maxSeqStmt;
  private readonly replayStmt;
  private readonly replayFromStmt;
  private readonly saveSnapshotStmt;
  private readonly latestSnapshotStmt;
  private readonly appendTx;

  constructor(private readonly db: Database.Database) {
    db.exec(EVENT_STORE_DDL);

    this.insertStmt = db.prepare(`
      INSERT INTO event_store (taskId, eventType, payload, timestamp, sequence)
      VALUES (@taskId, @eventType, @payload, @timestamp, @sequence)
    `);

    this.maxSeqStmt = db.prepare(`
      SELECT COALESCE(MAX(sequence), 0) AS maxSeq
      FROM event_store
      WHERE taskId = ?
    `);

    this.replayStmt = db.prepare(`
      SELECT * FROM event_store
      WHERE taskId = ?
      ORDER BY sequence ASC
    `);

    this.replayFromStmt = db.prepare(`
      SELECT * FROM event_store
      WHERE taskId = ? AND sequence >= ?
      ORDER BY sequence ASC
    `);

    this.saveSnapshotStmt = db.prepare(`
      INSERT INTO task_snapshots (taskId, sequence, state, createdAt)
      VALUES (@taskId, @sequence, @state, @createdAt)
      ON CONFLICT(taskId, sequence) DO UPDATE SET state = excluded.state, createdAt = excluded.createdAt
    `);

    this.latestSnapshotStmt = db.prepare(`
      SELECT * FROM task_snapshots
      WHERE taskId = ?
      ORDER BY sequence DESC
      LIMIT 1
    `);

    // Append is a single transaction: read MAX(sequence), compute +1, insert.
    // The UNIQUE(taskId, sequence) constraint guarantees no duplicate sequence
    // survives a race; the transaction guarantees the read+write are atomic.
    this.appendTx = db.transaction(
      (taskId: string, eventType: AppendOnlyEventType, payload: unknown, timestamp: string) => {
        const row = this.maxSeqStmt.get(taskId) as { maxSeq: number } | undefined;
        const sequence = (row?.maxSeq ?? 0) + 1;
        const result = this.insertStmt.run({
          taskId,
          eventType,
          payload: JSON.stringify(payload),
          timestamp,
          sequence,
        });
        return {
          id: Number(result.lastInsertRowid),
          taskId,
          eventType,
          payload,
          timestamp,
          sequence,
        } satisfies AppendOnlyEvent;
      }
    );
  }

  /**
   * Append an immutable event for `taskId`. The per-task `sequence` is
   * `MAX(sequence) + 1`, assigned inside a SQLite transaction, and the
   * committed event is returned.
   */
  append(
    taskId: string,
    eventType: AppendOnlyEventType,
    payload: unknown = {}
  ): AppendOnlyEvent {
    const timestamp = new Date().toISOString();
    return this.appendTx(taskId, eventType, payload, timestamp);
  }

  /** Full replay: every event for `taskId` in ascending sequence order. */
  replay(taskId: string): AppendOnlyEvent[] {
    return (this.replayStmt.all(taskId) as EventRow[]).map(rowToEvent);
  }

  /** Partial replay: events for `taskId` with `sequence >= fromSequence`. */
  replayFrom(taskId: string, fromSequence: number): AppendOnlyEvent[] {
    return (this.replayFromStmt.all(taskId, fromSequence) as EventRow[]).map(rowToEvent);
  }

  /** Persist a projected snapshot at `sequence`. Idempotent per (taskId, sequence). */
  saveSnapshot(taskId: string, sequence: number, state: unknown): void {
    this.saveSnapshotStmt.run({
      taskId,
      sequence,
      state: JSON.stringify(state),
      createdAt: new Date().toISOString(),
    });
  }

  /** The most recent snapshot for `taskId`, or `null` if none exists. */
  loadLatestSnapshot(taskId: string): TaskSnapshot | null {
    const row = this.latestSnapshotStmt.get(taskId) as SnapshotRow | undefined;
    return row ? rowToSnapshot(row) : null;
  }

  /** Close the underlying database connection. */
  close(): void {
    this.db.close();
  }
}
