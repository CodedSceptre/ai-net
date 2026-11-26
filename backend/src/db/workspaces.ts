import Database from "better-sqlite3";
import path from "path";
import { createLogger } from "../utils/logger";
import { migrateToLatest } from "./migrator";

const MIGRATIONS_DIR = path.join(__dirname, "migrations", "workspaces");
const logger = createLogger({ component: "workspace-db" });

let _db: Database.Database | null = null;

function applyWorkspaceSchema(db: Database.Database): void {
  migrateToLatest(db, MIGRATIONS_DIR);
}

export function getWorkspaceDb(dbPath?: string): Database.Database {
  if (_db) return _db;

  const filePath = dbPath ?? path.join(process.cwd(), "workspaces.db");
  _db = new Database(filePath);
  (_db as unknown as { on: (event: string, fn: (error: Error) => void) => void }).on(
    "error",
    (error: Error) => {
      logger.error({ err: error }, "workspace database error");
    }
  );
  applyWorkspaceSchema(_db);
  return _db;
}

export function closeWorkspaceDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
