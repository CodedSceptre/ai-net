/**
 * CONTRACT migration — destructive cleanup.
 *
 * Convention: YYYYMMDD_HHMMSS_<description>.contract.ts
 *
 * Contract migrations run AFTER the new application version is deployed and
 * its health check has passed. The new code must NOT reference the structures
 * removed here.
 *
 * Rules for contract migrations:
 *  - DROP columns that the new code no longer reads or writes
 *  - DROP tables superseded by the expand migration
 *  - DROP old indexes replaced by new ones
 *  - Remove DEFAULT constraints or NOT NULL flags added only for compatibility
 *
 * Every contract migration MUST export a down() function that reverses the
 * change — this is called by scripts/rollback-migrations.sh.
 *
 * This file is a documentation example. Remove or replace it for real work.
 */

import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(process.env.DB_PATH ?? 'data/tasks.db');

export async function up(): Promise<void> {
  const db = new Database(DB_PATH);
  try {
    db.pragma('journal_mode = WAL');

    // Example: drop the legacy column now that the new code is live
    // SQLite does not support DROP COLUMN before v3.35; use table-rebuild pattern:
    //
    // db.exec(`
    //   BEGIN;
    //   CREATE TABLE tasks_new AS SELECT id, prompt, walletPublicKey, status,
    //     dagJson, createdAt, updatedAt FROM tasks;
    //   DROP TABLE tasks;
    //   ALTER TABLE tasks_new RENAME TO tasks;
    //   COMMIT;
    // `);

    console.log('[contract] example contract migration: no-op (documentation stub)');
  } finally {
    db.close();
  }
}

export async function down(): Promise<void> {
  // Reverse the contract change — called by rollback-migrations.sh
  const db = new Database(DB_PATH);
  try {
    db.pragma('journal_mode = WAL');

    // Example: restore the dropped column
    // db.exec(`ALTER TABLE tasks ADD COLUMN legacy_field TEXT DEFAULT NULL;`);

    console.log('[contract] example contract rollback: no-op (documentation stub)');
  } finally {
    db.close();
  }
}

// Allow direct execution: `npx tsx this-file.ts`
if (process.argv[1] === new URL(import.meta.url).pathname) {
  up().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
