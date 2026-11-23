import { createHash } from "node:crypto";
import { deserialize, serialize } from "node:v8";
import type Database from "better-sqlite3";
import { LRUCache } from "lru-cache";
import { createLogger } from "../utils/logger";
import type { SlowQueryInfo } from "./pool";

const logger = createLogger({ component: "db-query" });
const buckets = [1, 5, 10, 25, 50, 100, 250, 500, 1_000];
const metrics = { slow: 0, hits: 0, misses: 0, count: 0, sum: 0, buckets: buckets.map(() => 0) };

export function queryMetrics() {
  return {
    ...metrics,
    buckets: buckets.map((bound, index) => ({ le: String(bound), count: metrics.buckets[index] })),
  };
}

const OPTIMIZE_INTERVAL_MS = 24 * 60 * 60 * 1_000;
const READ_TABLE = /^\s*SELECT\s+[\w\s*.,"]+\s+FROM\s+([\w]+)(?=\s|;|$)/i;
const WRITE_TABLE = /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+["`\[]?(\w+)\b/i;

function readTable(sql: string): string | undefined {
  // Complex or nondeterministic queries still get monitored. Cache only
  // straightforward single-table selects to keep invalidation predictable.
  if (/[();]/.test(sql.trim().replace(/;$/, "")) ||
      /\b(JOIN|UNION|INTERSECT|EXCEPT|SELECT.*SELECT|CURRENT_(DATE|TIME|TIMESTAMP))\b/is.test(sql)) {
    return undefined;
  }
  const match = READ_TABLE.exec(sql);
  if (!match || /^\s*[,\.]/.test(sql.slice(match[0].length))) return undefined;
  return match[1].toLowerCase();
}

interface CacheEntry {
  table: string;
  value: Buffer;
  expiresAt: number;
}

interface MonitorOptions {
  thresholdMs?: number;
  onSlowQuery?: (info: SlowQueryInfo) => void;
}

/** One monitor per database file, shared by its writer and pooled readers. */
export class QueryMonitor {
  private readonly cache = new LRUCache<string, CacheEntry>({ max: 100 });
  private nextConnection = 0;

  constructor(private readonly options: MonitorOptions = {}) {}

  attach(db: Database.Database): void {
    const prepare = db.prepare.bind(db) as (sql: string) => Database.Statement;
    const exec = db.exec.bind(db);
    const monitor = this;
    const connectionId = this.nextConnection++;
    const totalChanges = db.readonly ? undefined : prepare("SELECT total_changes()").pluck?.();
    Object.assign(db, {
      exec(sql: string) {
        try {
          return exec(sql);
        } finally {
          monitor.cache.clear();
        }
      },
      prepare(sql: string) {
        const statement = prepare(sql);
        const table = readTable(sql);
        let customized = false;
        let boundParams: unknown[] | undefined;
        const proxy: Database.Statement = new Proxy(statement, {
          get(target, property) {
            const method = Reflect.get(target, property, target) as unknown;
            if (typeof method !== "function") return method;
            if (property !== "get" && property !== "all" && property !== "run" && property !== "iterate") {
              return (...args: unknown[]) => {
                const result: unknown = method.apply(target, args);
                if (result === target) {
                  customized = true;
                  if (property === "bind") boundParams = args;
                  return proxy;
                }
                return result;
              };
            }
            return (...args: unknown[]) => {
              const writable = target.readonly === false || property === "run";
              const cacheable = table && !customized && !db.inTransaction && !writable && property !== "iterate";
              let key: string | undefined;
              if (cacheable) {
                // data_version changes when another connection commits.
                const version = db.pragma("data_version", { simple: true });
                const params = JSON.stringify(args, (_key, value: unknown) =>
                  typeof value === "bigint" ? { bigint: String(value) } : value);
                key = createHash("sha256").update(`${connectionId}:${String(version)}:${String(property)}:${sql}\0${params}`).digest("hex");
                const entry = monitor.cache.get(key);
                if (entry && Date.now() < entry.expiresAt) {
                  metrics.hits++;
                  return deserialize(entry.value);
                }
                monitor.cache.delete(key);
                metrics.misses++;
              }

              const changesBefore = writable && property === "run" ? totalChanges?.get() : undefined;
              const started = performance.now();
              let result: unknown;
              try {
                result = method.apply(target, args);
              } finally {
                monitor.record(prepare, sql, boundParams ?? args, performance.now() - started);
                if (writable) monitor.invalidate(sql, changesBefore, totalChanges?.get(), result);
              }
              if (key && table) monitor.cache.set(key, { table, value: serialize(result), expiresAt: Date.now() + 5_000 });
              return result;
            };
          },
        });
        return proxy;
      },
    });
  }

  scheduleOptimize(db: Database.Database): () => void {
    const timer = setInterval(() => {
      try {
        db.pragma("optimize");
      } catch (err) {
        logger.warn({ err }, "SQLite optimize failed");
      }
    }, OPTIMIZE_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }

  private invalidate(sql: string, before: unknown, after: unknown, result: unknown): void {
    const table = WRITE_TABLE.exec(sql)?.[1].toLowerCase();
    const changes = (result as Database.RunResult | undefined)?.changes;
    // Trigger and foreign-key side effects can change additional tables.
    if (!table || typeof before !== "number" || typeof after !== "number" || after - before !== changes) {
      this.cache.clear();
      return;
    }
    for (const [key, entry] of this.cache) {
      if (entry.table === table) this.cache.delete(key);
    }
  }

  private record(prepare: (sql: string) => Database.Statement, query: string, params: unknown[], durationMs: number): void {
    metrics.count++;
    metrics.sum += durationMs;
    buckets.forEach((bound, index) => {
      if (durationMs <= bound) metrics.buckets[index]++;
    });
    const threshold = this.options.thresholdMs ?? 100;
    if (threshold >= 0 && (durationMs > threshold || threshold === 0)) {
      metrics.slow++;
      this.options.onSlowQuery?.({ sql: query, durationMs });
      logger.warn({ query, params, durationMs }, "slow query");
    }
    if (process.env.LOG_LEVEL === "debug") {
      try {
        const plan = prepare(`EXPLAIN QUERY PLAN ${query}`).all(...params);
        logger.debug({ query, plan }, "query plan");
      } catch (err) {
        logger.debug({ query, err }, "query plan unavailable");
      }
    }
  }
}
