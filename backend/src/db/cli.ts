/**
 * `npm run db:migrate` / `db:rollback` / `db:seed` / `db:make-migration` entry point.
 *
 * Operates on all three SQLite databases the backend owns (payments,
 * agents, tasks) — each has its own migrations directory, applied
 * independently, so "migrate" always brings every database to its own
 * latest version in one command.
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { migrateToLatest, rollback, getPendingMigrations } from "./migrator";
import { seed } from "./seed";

interface DbTarget {
  name: string;
  dbPath: string;
  migrationsDir: string;
}

function targets(): DbTarget[] {
  const cwd = process.cwd();
  const migrationsRoot = path.join(__dirname, "migrations");
  return [
    { name: "payments", dbPath: path.join(cwd, "payments.db"), migrationsDir: path.join(migrationsRoot, "payments") },
    { name: "agents", dbPath: path.join(cwd, "agents.db"), migrationsDir: path.join(migrationsRoot, "agents") },
    { name: "tasks", dbPath: path.join(cwd, "tasks.db"), migrationsDir: path.join(migrationsRoot, "tasks") },
  ];
}

function runMigrate(dryRun: boolean): void {
  if (dryRun) {
    for (const target of targets()) {
      const db = new Database(target.dbPath);
      try {
        const pending = getPendingMigrations(db, target.migrationsDir);
        if (pending.length === 0) {
          console.log(`[${target.name}] [dry-run] no pending migrations`);
        } else {
          console.log(`[${target.name}] [dry-run] pending migrations:`);
          for (const m of pending) {
            console.log(`  ${m.version}_${m.name}`);
          }
        }
      } finally {
        db.close();
      }
    }
    return;
  }

  for (const target of targets()) {
    const db = new Database(target.dbPath);
    try {
      const { applied } = migrateToLatest(db, target.migrationsDir);
      if (applied.length === 0) {
        console.log(`[${target.name}] already at latest`);
      } else {
        console.log(`[${target.name}] applied: ${applied.join(", ")}`);
      }
    } finally {
      db.close();
    }
  }
}

/**
 * Scaffold a new timestamped up/down migration pair.
 *
 * Usage: ts-node src/db/cli.ts make-migration <name> [--db agents|tasks|payments|events]
 */
function runMakeMigration(name: string, dbTarget: string): void {
  const migrationsRoot = path.join(__dirname, "migrations");
  const validTargets = ["agents", "tasks", "payments", "events"];
  if (!validTargets.includes(dbTarget)) {
    console.error(`Unknown --db target: ${dbTarget}. Expected one of: ${validTargets.join(", ")}`);
    process.exit(1);
  }

  const now = new Date();
  const pad = (n: number, len = 2): string => String(n).padStart(len, "0");
  const timestamp =
    `${now.getFullYear()}` +
    `${pad(now.getMonth() + 1)}` +
    `${pad(now.getDate())}` +
    `${pad(now.getHours())}` +
    `${pad(now.getMinutes())}` +
    `${pad(now.getSeconds())}`;

  const dir = path.join(migrationsRoot, dbTarget);
  fs.mkdirSync(dir, { recursive: true });

  const baseName = `${timestamp}_${name}`;
  const upPath = path.join(dir, `${baseName}.up.sql`);
  const downPath = path.join(dir, `${baseName}.down.sql`);
  const placeholder = "-- TODO: write your migration SQL here\n";

  fs.writeFileSync(upPath, placeholder, "utf8");
  fs.writeFileSync(downPath, placeholder, "utf8");

  console.log(`Created: ${upPath}`);
  console.log(`Created: ${downPath}`);
}

function runRollback(steps: number): void {
  for (const target of targets()) {
    const db = new Database(target.dbPath);
    try {
      const { rolledBack } = rollback(db, target.migrationsDir, steps);
      if (rolledBack.length === 0) {
        console.log(`[${target.name}] nothing to roll back`);
      } else {
        console.log(`[${target.name}] rolled back: ${rolledBack.join(", ")}`);
      }
    } finally {
      db.close();
    }
  }
}

function runSeed(): void {
  runMigrate(false); // seeding assumes an up-to-date schema
  seed();
}

function main(): void {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "migrate": {
      const dryRun = rest.includes("--dry-run");
      runMigrate(dryRun);
      break;
    }
    case "rollback": {
      const stepsFlagIndex = rest.indexOf("--steps");
      const steps = stepsFlagIndex >= 0 ? Number(rest[stepsFlagIndex + 1]) : 1;
      runRollback(Number.isFinite(steps) && steps > 0 ? steps : 1);
      break;
    }
    case "seed":
      runSeed();
      break;
    case "make-migration": {
      const name = rest.find((arg) => !arg.startsWith("--"));
      if (!name) {
        console.error("Usage: db:make-migration <name> [--db agents|tasks|payments|events]");
        process.exit(1);
      }
      const dbFlagIndex = rest.indexOf("--db");
      const dbTarget = dbFlagIndex >= 0 ? rest[dbFlagIndex + 1] : "agents";
      runMakeMigration(name, dbTarget ?? "agents");
      break;
    }
    default:
      console.error(
        `Unknown command: ${command ?? "(none)"}. Expected one of: migrate, rollback, seed, make-migration`,
      );
      process.exit(1);
  }
}

main();
