/**
 * EXPAND migration — purely additive.
 *
 * Convention: YYYYMMDD_HHMMSS_<description>.expand.ts
 *
 * Expand migrations run BEFORE the new application version is deployed.
 * The old code must continue to work while this migration is applied.
 *
 * Rules for expand migrations:
 *  - ADD columns (nullable or with a DEFAULT — never NOT NULL without a DEFAULT)
 *  - CREATE new tables
 *  - CREATE new indexes (use CREATE INDEX IF NOT EXISTS)
 *  - NEVER DROP columns, tables, or indexes
 *  - NEVER rename columns or tables
 *
 * This file is a documentation example. It does not modify any real table.
 * Remove or replace it when creating your first real expand migration.
 */

import path from 'path';
import Database from 'better-sqlite3';

const DB_PATH = path.resolve(process.env.DB_PATH ?? 'data/tasks.db');

export async function up(): Promise<void> {
  const db = new Database(DB_PATH);
  try {
    db.pragma('journal_mode = WAL');

    // Example: add a nullable metadata column — safe while old code is running
    // db.exec(`
    //   ALTER TABLE tasks ADD COLUMN metadata TEXT DEFAULT NULL;
    // `);

    console.log('[expand] example expand migration: no-op (documentation stub)');
  } finally {
    db.close();
  }
}

// Allow the script to be run directly: `npx tsx this-file.ts`
if (process.argv[1] === new URL(import.meta.url).pathname) {
  up().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
