/**
 * Loads the REAL better-sqlite3 native module for tests that need genuine
 * SQLite behaviour (triggers, transactions, MAX(sequence), UNIQUE constraints).
 *
 * Why this exists
 * ──────────────
 * backend/jest.config.js unconditionally maps the bare specifier
 * `better-sqlite3` to a stub mock (`__mocks__/better-sqlite3.js`) whose
 * `prepare().all()` returns `[]` and `get()` returns `undefined` — it executes
 * no SQL. That stub is fine for trace-propagation tests but cannot exercise
 * real event-store semantics. Requiring the module by its absolute file path
 * bypasses the name-based moduleNameMapper (the pattern `^better-sqlite3$`
 * only matches the bare specifier, not an absolute path), so we get the real
 * native addon.
 *
 * Robustness
 * ──────────
 * We probe the returned constructor: we only hand it back if it actually runs
 * SQL (a round-tripped COUNT(*) returns 1). If the load fails (e.g. the native
 * binary was built for a different Node.js ABI) or the stub mock slipped
 * through, we return `undefined` and callers `describe.skip` their suites —
 * the test file never turns red, it is merely skipped in that environment.
 */

import { existsSync } from 'fs';
import { join } from 'path';

/** Candidate install locations, nearest first. */
const CANDIDATES = [
  join(__dirname, '..', 'node_modules', 'better-sqlite3'), // backend/node_modules
  join(__dirname, '..', '..', 'node_modules', 'better-sqlite3'), // repo root
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DatabaseCtor = new (path: string) => any;

/**
 * @returns the real better-sqlite3 `Database` constructor, or `undefined` if a
 *          working native build is not available in this environment.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function loadRealDatabase(): DatabaseCtor | undefined {
  for (const candidate of CANDIDATES) {
    try {
      if (!existsSync(candidate)) continue;
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
      const Database = require(candidate) as DatabaseCtor;

      // Probe: prove this is real SQLite, not the jest stub mock.
      const probe = new Database(':memory:');
      probe.exec('CREATE TABLE __probe (x INTEGER)');
      probe.prepare('INSERT INTO __probe VALUES (1)').run();
      const got = probe.prepare('SELECT COUNT(*) AS c FROM __probe').get() as
        | { c: number }
        | undefined;
      probe.close();
      if (got && got.c === 1) {
        return Database;
      }
    } catch {
      // native build unavailable for this Node ABI, or not real SQLite — try next
    }
  }
  return undefined;
}
