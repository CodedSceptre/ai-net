import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const RETENTION_DAYS = parseInt(process.env.AUDIT_RETENTION_DAYS ?? '90', 10);
const DELETE_AFTER_ARCHIVE = process.env.AUDIT_DELETE_AFTER_ARCHIVE !== 'false';

export function archiveAuditLog(db: Database.Database, archiveDir: string = process.cwd()): { archived: number; deleted: number } {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const rows = db.prepare('SELECT * FROM audit_log WHERE timestamp < ?').all(cutoff) as any[];
  if (rows.length === 0) return { archived: 0, deleted: 0 };

  const filename = path.join(archiveDir, `audit-archive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(filename, JSON.stringify(rows, null, 2), 'utf8');

  let deleted = 0;
  if (DELETE_AFTER_ARCHIVE) {
    const result = db.prepare('DELETE FROM audit_log WHERE timestamp < ?').run(cutoff);
    deleted = result.changes;
  }

  return { archived: rows.length, deleted };
}

// CLI entry point
if (require.main === module) {
  const dbPath = process.env.AUDIT_DB_PATH ?? path.join(process.cwd(), 'audit.db');
  const archiveDir = process.env.AUDIT_ARCHIVE_DIR ?? process.cwd();
  const db = new Database(dbPath);
  const result = archiveAuditLog(db, archiveDir);
  console.log(`Archived ${result.archived} entries, deleted ${result.deleted}`);
  db.close();
}
