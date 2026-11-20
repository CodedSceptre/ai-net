/**
 * ConfigService — runtime hot-reload configuration manager.
 *
 * Implements a three-tier fallback for every key:
 *   1. In-memory cache (populated from the `config` DB table on startup)
 *   2. Environment variable with the same name
 *   3. Caller-supplied default value
 *
 * Changes applied via `set()` are written to the DB, reflected in the
 * in-memory cache, and published to the Redis `config:updates` channel so
 * every running backend instance picks them up within ~1 second.
 *
 * Unknown keys (not in ALLOWED_CONFIG_KEYS) are rejected with a typed error.
 */

import Database from 'better-sqlite3';
import path from 'path';
import { createLogger } from '../utils/logger';

const logger = createLogger({ module: 'configService' });

// ---------------------------------------------------------------------------
// Allow-list of hot-reloadable keys
// ---------------------------------------------------------------------------

export const ALLOWED_CONFIG_KEYS = [
  'RATE_LIMIT_RPM',
  'VENICE_MODEL',
  'MAX_CONCURRENT_NODES',
  'FEATURE_FLAGS',
] as const;

export type ConfigKey = (typeof ALLOWED_CONFIG_KEYS)[number];

export function isAllowedConfigKey(key: string): key is ConfigKey {
  return (ALLOWED_CONFIG_KEYS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Pub/sub message shape
// ---------------------------------------------------------------------------

export interface ConfigUpdateMessage {
  key: ConfigKey;
  value: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// Minimal Redis interface (compatible with ioredis)
// ---------------------------------------------------------------------------

export interface RedisPublisher {
  publish(channel: string, message: string): Promise<unknown>;
}

export interface RedisSubscriber {
  subscribe(channel: string): Promise<unknown>;
  on(event: 'message', listener: (channel: string, message: string) => void): this;
}

export const CONFIG_REDIS_CHANNEL = 'config:updates';

// ---------------------------------------------------------------------------
// DB row type
// ---------------------------------------------------------------------------

interface ConfigRow {
  key: string;
  value: string;
  updatedAt: string;
  updatedBy: string;
}

// ---------------------------------------------------------------------------
// ConfigService
// ---------------------------------------------------------------------------

export class ConfigService {
  private cache = new Map<string, string>();
  private db: Database.Database;

  constructor(dbOrPath?: Database.Database | string) {
    if (!dbOrPath) {
      const dbPath =
        process.env.DATABASE_URL?.replace(/^sqlite:\/\//, '') ??
        path.join(process.cwd(), 'data', 'config.db');
      this.db = new Database(dbPath === ':memory:' ? ':memory:' : dbPath);
    } else if (typeof dbOrPath === 'string') {
      this.db = new Database(dbOrPath);
    } else {
      this.db = dbOrPath;
    }

    this.ensureTable();
    this.loadFromDb();
  }

  // ── Schema bootstrap ──────────────────────────────────────────────────────

  private ensureTable(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS config (
        key       TEXT PRIMARY KEY,
        value     TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        updatedBy TEXT NOT NULL
      );
    `);
  }

  private loadFromDb(): void {
    const rows = this.db.prepare('SELECT key, value FROM config').all() as ConfigRow[];
    for (const row of rows) {
      this.cache.set(row.key, row.value);
    }
    logger.info({ keys: rows.map(r => r.key) }, 'config loaded from DB');
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Read a config value.
   *
   * Fallback order: in-memory cache → environment variable → defaultValue.
   */
  get(key: string, defaultValue?: string): string | undefined {
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    if (process.env[key] !== undefined) {
      return process.env[key];
    }
    return defaultValue;
  }

  /**
   * Write a config value.
   *
   * Persists to DB, updates the in-memory cache, and publishes to Redis so
   * other instances pick up the change.
   *
   * @throws {UnknownConfigKeyError} if key is not in ALLOWED_CONFIG_KEYS
   */
  async set(
    key: string,
    value: string,
    updatedBy: string,
    publisher?: RedisPublisher,
  ): Promise<void> {
    if (!isAllowedConfigKey(key)) {
      throw new UnknownConfigKeyError(key);
    }

    const oldValue = this.get(key);
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO config (key, value, updatedAt, updatedBy)
         VALUES (@key, @value, @updatedAt, @updatedBy)
         ON CONFLICT(key) DO UPDATE SET
           value     = excluded.value,
           updatedAt = excluded.updatedAt,
           updatedBy = excluded.updatedBy`,
      )
      .run({ key, value, updatedAt: now, updatedBy });

    this.cache.set(key, value);

    logger.info({ key, oldValue, newValue: value, updatedBy }, 'config updated');

    if (publisher) {
      const message: ConfigUpdateMessage = { key, value, updatedBy };
      await publisher.publish(CONFIG_REDIS_CHANNEL, JSON.stringify(message));
    }
  }

  /**
   * Subscribe to Redis config updates and apply them to the in-memory cache.
   */
  subscribe(subscriber: RedisSubscriber): void {
    subscriber.subscribe(CONFIG_REDIS_CHANNEL).catch(err => {
      logger.warn({ err }, 'config: failed to subscribe to Redis channel');
    });

    subscriber.on('message', (_channel, rawMessage) => {
      let msg: ConfigUpdateMessage;
      try {
        msg = JSON.parse(rawMessage) as ConfigUpdateMessage;
      } catch (err) {
        logger.warn({ err, rawMessage }, 'config: failed to parse Redis message');
        return;
      }

      if (!isAllowedConfigKey(msg.key)) {
        logger.warn({ key: msg.key }, 'config: received update for unknown key, ignoring');
        return;
      }

      const oldValue = this.cache.get(msg.key);
      this.cache.set(msg.key, msg.value);

      logger.info(
        { key: msg.key, oldValue, newValue: msg.value, source: 'redis_pubsub' },
        'config hot-reloaded',
      );
    });
  }

  /**
   * Expose the entire in-memory cache (for testing / debugging).
   */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.cache.entries());
  }

  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class UnknownConfigKeyError extends Error {
  readonly code = 'UNKNOWN_CONFIG_KEY' as const;

  constructor(key: string) {
    super(`Unknown config key: ${key}`);
    this.name = 'UnknownConfigKeyError';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: ConfigService | undefined;

export function getConfigService(): ConfigService {
  if (!_instance) {
    _instance = new ConfigService();
  }
  return _instance;
}

/** Replace the singleton — for testing only. */
export function setConfigServiceForTests(svc: ConfigService): void {
  _instance = svc;
}

export function resetConfigServiceForTests(): void {
  _instance = undefined;
}
