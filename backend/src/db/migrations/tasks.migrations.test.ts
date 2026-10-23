/**
 * Migration tests for tasks.db
 *
 * Verifies that every migration in the tasks migrations directory applies the
 * correct schema changes (tables, columns, indexes) and rolls back cleanly.
 * Also covers the multi-step chain v1→v2→v3→v4 forward and v4→v3→v2→v1
 * in reverse.
 *
 * Real SQLite is used (jest.requireActual) so that actual DDL executes rather
 * than the no-op mock wired via moduleNameMapper.
 */

import path from "path";
import { migrateToLatest, rollback, getAppliedMigrations } from "../migrator";

// Bypass the moduleNameMapper mock — we need real SQLite for schema assertions.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RealDatabase = jest.requireActual<typeof import("better-sqlite3")>("better-sqlite3");

const MIGRATIONS_DIR = path.join(__dirname, "tasks");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Db = InstanceType<typeof RealDatabase>;

function openDb(): Db {
  return new RealDatabase(":memory:");
}

function tables(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name NOT LIKE 'sqlite_%'
           AND name != 'schema_migrations'
         ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function columns(db: Db, table: string): string[] {
  return (
    db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function indexes(db: Db): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
      .all() as Array<{ name: string }>
  ).map((r) => r.name);
}

function appliedVersions(db: Db): number[] {
  return getAppliedMigrations(db).map((m) => m.version);
}

// ---------------------------------------------------------------------------
// 001_create_tasks_table
// ---------------------------------------------------------------------------

describe("tasks migrations — 001_create_tasks_table", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb();
  });

  afterEach(() => {
    db.close();
  });

  it("up() creates the tasks table with all expected columns", () => {
    expect(tables(db)).not.toContain("tasks");

    migrateToLatest(db, MIGRATIONS_DIR);

    expect(tables(db)).toContain("tasks");
    const cols = columns(db, "tasks");
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "prompt",
        "walletPublicKey",
        "status",
        "dagJson",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("up() applies correct DEFAULT values for walletPublicKey, status, and dagJson", () => {
    migrateToLatest(db, MIGRATIONS_DIR);

    db.prepare(
      `INSERT INTO tasks (id, prompt, createdAt, updatedAt)
       VALUES ('t1', 'hello', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
    ).run();

    const row = db
      .prepare("SELECT walletPublicKey, status, dagJson FROM tasks WHERE id = 't1'")
      .get() as { walletPublicKey: string; status: string; dagJson: string };

    expect(row.walletPublicKey).toBe("");
    expect(row.status).toBe("queued");
    expect(row.dagJson).toBe("[]");
  });

  it("up() is idempotent — a second migrateToLatest call applies nothing extra", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    const second = migrateToLatest(db, MIGRATIONS_DIR);

    expect(second.applied).toEqual([]);
  });

  it("down() removes the tasks table", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 4); // roll back all 4 migrations

    expect(tables(db)).not.toContain("tasks");
    expect(appliedVersions(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 002_create_task_events_table
// ---------------------------------------------------------------------------

describe("tasks migrations — 002_create_task_events_table", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb();
    migrateToLatest(db, MIGRATIONS_DIR);
    // Roll back to just v1 so we can test v2 in isolation.
    rollback(db, MIGRATIONS_DIR, 3);
  });

  afterEach(() => {
    db.close();
  });

  it("starting state: only tasks table exists after rolling back to v1", () => {
    expect(appliedVersions(db)).toEqual([1]);
    expect(tables(db)).toContain("tasks");
    expect(tables(db)).not.toContain("task_events");
  });

  it("up() adds task_events table with correct columns", () => {
    migrateToLatest(db, MIGRATIONS_DIR);

    expect(tables(db)).toContain("task_events");
    const cols = columns(db, "task_events");
    expect(cols).toEqual(
      expect.arrayContaining(["id", "taskId", "type", "nodeId", "payload", "timestamp"]),
    );
  });

  it("up() creates idx_task_events_taskId index", () => {
    migrateToLatest(db, MIGRATIONS_DIR);

    expect(indexes(db)).toContain("idx_task_events_taskId");
  });

  it("down() drops the task_events table and its index", () => {
    migrateToLatest(db, MIGRATIONS_DIR); // bring back to v4
    rollback(db, MIGRATIONS_DIR, 3);    // roll back v4, v3, v2

    expect(appliedVersions(db)).toEqual([1]);
    expect(tables(db)).not.toContain("task_events");
    expect(indexes(db)).not.toContain("idx_task_events_taskId");
  });

  it("down() leaves tasks table untouched", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 3);

    expect(tables(db)).toContain("tasks");
  });
});

// ---------------------------------------------------------------------------
// 003_create_quality_scores_table
// ---------------------------------------------------------------------------

describe("tasks migrations — 003_create_quality_scores_table", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb();
    migrateToLatest(db, MIGRATIONS_DIR);
    // Roll back to v2 so we can test v3 in isolation.
    rollback(db, MIGRATIONS_DIR, 2);
  });

  afterEach(() => {
    db.close();
  });

  it("starting state: tasks + task_events exist, quality_scores does not", () => {
    expect(appliedVersions(db)).toEqual([1, 2]);
    expect(tables(db)).not.toContain("quality_scores");
  });

  it("up() creates quality_scores with all expected columns", () => {
    migrateToLatest(db, MIGRATIONS_DIR);

    expect(tables(db)).toContain("quality_scores");
    const cols = columns(db, "quality_scores");
    expect(cols).toEqual(
      expect.arrayContaining([
        "id",
        "taskId",
        "nodeId",
        "agentId",
        "agentType",
        "score",
        "completeness",
        "relevance",
        "format",
        "needsReview",
        "timestamp",
      ]),
    );
  });

  it("up() creates idx_quality_scores_agentId index", () => {
    migrateToLatest(db, MIGRATIONS_DIR);

    expect(indexes(db)).toContain("idx_quality_scores_agentId");
  });

  it("down() drops quality_scores table and its index", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 2);

    expect(appliedVersions(db)).toEqual([1, 2]);
    expect(tables(db)).not.toContain("quality_scores");
    expect(indexes(db)).not.toContain("idx_quality_scores_agentId");
  });
});

// ---------------------------------------------------------------------------
// 004_add_created_at_index
// ---------------------------------------------------------------------------

describe("tasks migrations — 004_add_created_at_index", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb();
    migrateToLatest(db, MIGRATIONS_DIR);
    // Roll back to v3 so we can test v4 in isolation.
    rollback(db, MIGRATIONS_DIR, 1);
  });

  afterEach(() => {
    db.close();
  });

  it("starting state: idx_tasks_created_at does not exist at v3", () => {
    expect(appliedVersions(db)).toEqual([1, 2, 3]);
    expect(indexes(db)).not.toContain("idx_tasks_created_at");
  });

  it("up() adds idx_tasks_created_at index", () => {
    migrateToLatest(db, MIGRATIONS_DIR);

    expect(indexes(db)).toContain("idx_tasks_created_at");
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4]);
  });

  it("down() removes idx_tasks_created_at index and leaves tasks table intact", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 1);

    expect(indexes(db)).not.toContain("idx_tasks_created_at");
    expect(tables(db)).toContain("tasks");
  });

  it("up() is idempotent — a second migrateToLatest adds nothing", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    const second = migrateToLatest(db, MIGRATIONS_DIR);

    expect(second.applied).toEqual([]);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4]);
  });
});

// ---------------------------------------------------------------------------
// Full chain: v1 → v2 → v3 → v4 then v4 → v3 → v2 → v1 → (empty)
// ---------------------------------------------------------------------------

describe("tasks migrations — full forward and reverse chain", () => {
  let db: Db;

  beforeEach(() => {
    db = openDb();
  });

  afterEach(() => {
    db.close();
  });

  it("applies all 4 migrations in order and records them in the ledger", () => {
    const { applied } = migrateToLatest(db, MIGRATIONS_DIR);

    expect(applied).toEqual([
      "1_create_tasks_table",
      "2_create_task_events_table",
      "3_create_quality_scores_table",
      "4_add_created_at_index",
    ]);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4]);
  });

  it("v4 → v3 rollback removes only the created-at index", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    const { rolledBack } = rollback(db, MIGRATIONS_DIR, 1);

    expect(rolledBack).toEqual(["4_add_created_at_index"]);
    expect(appliedVersions(db)).toEqual([1, 2, 3]);
    expect(indexes(db)).not.toContain("idx_tasks_created_at");
    expect(tables(db)).toContain("quality_scores");
  });

  it("v3 → v2 rollback removes quality_scores", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 2); // removes v4 + v3

    expect(appliedVersions(db)).toEqual([1, 2]);
    expect(tables(db)).not.toContain("quality_scores");
    expect(tables(db)).toContain("task_events");
  });

  it("v2 → v1 rollback removes task_events", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 3); // removes v4 + v3 + v2

    expect(appliedVersions(db)).toEqual([1]);
    expect(tables(db)).not.toContain("task_events");
    expect(tables(db)).toContain("tasks");
  });

  it("full rollback (all 4 steps) leaves an empty schema", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    const { rolledBack } = rollback(db, MIGRATIONS_DIR, 4);

    expect(rolledBack).toEqual([
      "4_add_created_at_index",
      "3_create_quality_scores_table",
      "2_create_task_events_table",
      "1_create_tasks_table",
    ]);
    expect(tables(db)).toHaveLength(0);
    expect(indexes(db)).toHaveLength(0);
    expect(appliedVersions(db)).toHaveLength(0);
  });

  it("migrating forward again after a full rollback restores the complete schema", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 4);

    const { applied } = migrateToLatest(db, MIGRATIONS_DIR);

    expect(applied).toHaveLength(4);
    expect(tables(db)).toEqual(
      expect.arrayContaining(["tasks", "task_events", "quality_scores"]),
    );
    expect(indexes(db)).toEqual(
      expect.arrayContaining(["idx_task_events_taskId", "idx_quality_scores_agentId", "idx_tasks_created_at"]),
    );
  });

  it("partial rollback (v4→v2) then re-migrate restores v3 and v4", () => {
    migrateToLatest(db, MIGRATIONS_DIR);
    rollback(db, MIGRATIONS_DIR, 2); // back to v2

    const { applied } = migrateToLatest(db, MIGRATIONS_DIR);

    expect(applied).toEqual([
      "3_create_quality_scores_table",
      "4_add_created_at_index",
    ]);
    expect(appliedVersions(db)).toEqual([1, 2, 3, 4]);
  });
});
