import Database from 'better-sqlite3';
import path from 'path';
import { createPool, type SqlitePool } from './pool';
import { poolSettings } from './poolConfig';
import { migrateToLatest } from './migrator';

const MIGRATIONS_DIR = path.join(__dirname, 'migrations', 'audit');

let _pool: SqlitePool | null = null;

export function getAuditPool(dbPath?: string): SqlitePool {
  if (!_pool || _pool.closed) {
    const filePath = dbPath ?? path.join(process.cwd(), 'audit.db');
    _pool = createPool({
      filePath,
      ...poolSettings(),
      onCreate: (db: Database.Database) => {
        migrateToLatest(db, MIGRATIONS_DIR);
      },
    });
  }
  return _pool;
}

export function getAuditDb(dbPath?: string): Database.Database {
  return getAuditPool(dbPath).writer;
}

export function closeAuditDb(): void {
  if (_pool && !_pool.closed) {
    void _pool.close();
    _pool = null;
  }
}
