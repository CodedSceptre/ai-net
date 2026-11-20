# Database Migration Guide

This guide explains the **expand-contract** migration convention used by the ai-net backend to achieve zero-downtime schema changes.

---

## Why expand-contract?

Traditional migrations that run synchronously during deployment lock tables and cause request failures. The expand-contract pattern eliminates that by splitting every schema change into two separate, safe phases:

| Phase | When it runs | What it may contain |
|-------|-------------|---------------------|
| **Expand** | Before the new code is deployed | ADD columns, CREATE tables, CREATE indexes |
| **Contract** | After the new code passes its health check | DROP columns, DROP tables, DROP old indexes |

The old code runs against the expanded schema without errors. Once the new code is confirmed healthy, the contract migration cleans up structures the new code no longer uses.

---

## File naming convention

```
YYYYMMDD_HHMMSS_<description>.<phase>.ts
```

Examples:
```
20250610_143000_add_agent_metadata.expand.ts
20250610_143001_drop_legacy_agent_status.contract.ts
```

Place migration files under:
```
backend/src/db/migrations/<domain>/
  e.g. tasks/, agents/, payments/
```

---

## Writing an expand migration

Expand migrations must be purely additive — the old application code must continue to work while this migration is applied.

```ts
// 20250610_143000_add_agent_metadata.expand.ts
import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(process.env.DB_PATH ?? 'data/agents.db');

export async function up(): Promise<void> {
  const db = new Database(DB_PATH);
  try {
    db.pragma('journal_mode = WAL');

    // ✅ Safe: adding a nullable column with a DEFAULT
    db.exec(`
      ALTER TABLE agents ADD COLUMN metadata TEXT DEFAULT NULL;
    `);
  } finally {
    db.close();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  up().catch((err) => { console.error(err); process.exit(1); });
}
```

### Expand migration rules

- ✅ `ALTER TABLE … ADD COLUMN` with a `DEFAULT` or nullable
- ✅ `CREATE TABLE IF NOT EXISTS`
- ✅ `CREATE INDEX IF NOT EXISTS`
- ❌ `ALTER TABLE … DROP COLUMN` — use a contract migration
- ❌ `DROP TABLE` — use a contract migration
- ❌ `ALTER TABLE … RENAME` — split into expand (add new name) + contract (drop old)
- ❌ Adding `NOT NULL` to an existing column without a `DEFAULT`

---

## Writing a contract migration

Contract migrations run after the new application version is confirmed healthy. They must export both `up()` and `down()` — `down()` is called by the rollback script.

```ts
// 20250610_143001_drop_legacy_agent_status.contract.ts
import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(process.env.DB_PATH ?? 'data/agents.db');

export async function up(): Promise<void> {
  const db = new Database(DB_PATH);
  try {
    db.pragma('journal_mode = WAL');

    // SQLite ≥ 3.35 supports DROP COLUMN directly.
    // For older SQLite use the table-rebuild pattern:
    db.exec(`
      BEGIN;
      CREATE TABLE agents_new AS
        SELECT id, name, capabilities, price, reputation, status
        FROM agents;
      DROP TABLE agents;
      ALTER TABLE agents_new RENAME TO agents;
      COMMIT;
    `);
  } finally {
    db.close();
  }
}

// down() must undo the up() change — called by rollback-migrations.sh
export async function down(): Promise<void> {
  const db = new Database(DB_PATH);
  try {
    db.pragma('journal_mode = WAL');
    db.exec(`
      ALTER TABLE agents ADD COLUMN legacy_status TEXT DEFAULT NULL;
    `);
  } finally {
    db.close();
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  up().catch((err) => { console.error(err); process.exit(1); });
}
```

---

## Running migrations locally

```bash
# Run all expand migrations
bash scripts/run-migrations.sh --phase expand

# Run all contract migrations
bash scripts/run-migrations.sh --phase contract

# Roll back the most recent contract migration
bash scripts/rollback-migrations.sh

# Roll back the last 2 contract migrations
bash scripts/rollback-migrations.sh --batch-size 2
```

---

## Deployment sequence (automated via CI)

The `.github/workflows/deploy-backend.yml` workflow enforces this five-phase sequence:

```
1. Expand migrations    →  schema is now backward-compatible
2. Health-check OLD     →  confirm old code still healthy
3. Deploy NEW image     →  swap in new application version
4. Health-check NEW     →  confirm new code is healthy
5. Contract migrations  →  clean up obsolete schema structures
```

A failure at any phase stops the pipeline before the next phase executes:
- Failed expand → new code never deployed; old code still running against unchanged schema.
- Failed health-check (old) → deployment aborted; operator must investigate before retrying.
- Failed new health-check → contract migrations are **not** run; operator can roll back the image.
- Failed contract → schema is live but old structures remain; safe to retry or roll back.

---

## SQLite WAL mode

All database connections set `PRAGMA journal_mode = WAL` immediately after opening. WAL allows readers and the writer to proceed concurrently, so expand migrations that run while the application is serving traffic never block reads.

Verify WAL mode is active:
```bash
sqlite3 data/tasks.db "PRAGMA journal_mode;"
# → wal
```

---

## Testing a migration locally

1. Copy the production database file (or use the seed database):
   ```bash
   cp data/tasks.db /tmp/tasks-test.db
   ```
2. Set `DB_PATH` and run the migration directly:
   ```bash
   DB_PATH=/tmp/tasks-test.db npx tsx \
     backend/src/db/migrations/tasks/20250610_143000_add_agent_metadata.expand.ts
   ```
3. Verify the schema change:
   ```bash
   sqlite3 /tmp/tasks-test.db ".schema agents"
   ```
4. Test the rollback:
   ```bash
   DB_PATH=/tmp/tasks-test.db bash scripts/rollback-migrations.sh
   ```
