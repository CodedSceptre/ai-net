/**
 * Unit tests for ConfigService.
 *
 * Redis pub/sub is fully mocked so the tests run without an actual Redis
 * server.
 */

import Database from 'better-sqlite3';
import {
  ConfigService,
  UnknownConfigKeyError,
  CONFIG_REDIS_CHANNEL,
  type RedisPublisher,
  type RedisSubscriber,
} from './configService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInMemoryDb(): Database.Database {
  return new Database(':memory:');
}

function makeService(db?: Database.Database): ConfigService {
  return new ConfigService(db ?? makeInMemoryDb());
}

// ---------------------------------------------------------------------------
// Mock Redis
// ---------------------------------------------------------------------------

function makeMockPublisher(): RedisPublisher & { calls: { channel: string; message: string }[] } {
  const calls: { channel: string; message: string }[] = [];
  return {
    calls,
    async publish(channel: string, message: string) {
      calls.push({ channel, message });
    },
  };
}

type MessageListener = (channel: string, message: string) => void;

function makeMockSubscriber(): RedisSubscriber & {
  emit(channel: string, message: string): void;
  subscribed: string[];
} {
  const subscribed: string[] = [];
  const listeners: MessageListener[] = [];

  return {
    subscribed,
    async subscribe(channel: string) {
      subscribed.push(channel);
    },
    on(_event: 'message', listener: MessageListener) {
      listeners.push(listener);
      return this;
    },
    emit(channel: string, message: string) {
      for (const l of listeners) l(channel, message);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConfigService', () => {
  describe('get()', () => {
    it('returns a value stored in the DB', () => {
      const db = makeInMemoryDb();
      db.exec(`
        CREATE TABLE IF NOT EXISTS config (
          key TEXT PRIMARY KEY, value TEXT NOT NULL,
          updatedAt TEXT NOT NULL, updatedBy TEXT NOT NULL
        );
        INSERT INTO config VALUES ('RATE_LIMIT_RPM', '60', datetime('now'), 'test');
      `);
      const svc = new ConfigService(db);
      expect(svc.get('RATE_LIMIT_RPM')).toBe('60');
    });

    it('falls back to environment variable when key is absent from DB', () => {
      const svc = makeService();
      const original = process.env.VENICE_MODEL;
      process.env.VENICE_MODEL = 'gpt-4o';
      try {
        expect(svc.get('VENICE_MODEL')).toBe('gpt-4o');
      } finally {
        if (original === undefined) delete process.env.VENICE_MODEL;
        else process.env.VENICE_MODEL = original;
      }
    });

    it('falls back to defaultValue when key is absent from DB and env', () => {
      const svc = makeService();
      const original = process.env.MAX_CONCURRENT_NODES;
      delete process.env.MAX_CONCURRENT_NODES;
      try {
        expect(svc.get('MAX_CONCURRENT_NODES', '5')).toBe('5');
      } finally {
        if (original !== undefined) process.env.MAX_CONCURRENT_NODES = original;
      }
    });

    it('returns undefined when key is absent from all sources and no default given', () => {
      const svc = makeService();
      delete process.env.MAX_CONCURRENT_NODES;
      expect(svc.get('MAX_CONCURRENT_NODES')).toBeUndefined();
    });
  });

  describe('set()', () => {
    it('writes to DB and updates in-memory cache', async () => {
      const svc = makeService();
      await svc.set('RATE_LIMIT_RPM', '30', 'test-user');
      expect(svc.get('RATE_LIMIT_RPM')).toBe('30');

      // Verify persisted to DB by creating a new service instance with the same DB
      const db = (svc as unknown as { db: Database.Database }).db;
      const svc2 = new ConfigService(db);
      expect(svc2.get('RATE_LIMIT_RPM')).toBe('30');
    });

    it('publishes to Redis channel when publisher is provided', async () => {
      const svc = makeService();
      const pub = makeMockPublisher();
      await svc.set('RATE_LIMIT_RPM', '45', 'test-user', pub);

      expect(pub.calls).toHaveLength(1);
      expect(pub.calls[0].channel).toBe(CONFIG_REDIS_CHANNEL);

      const payload = JSON.parse(pub.calls[0].message);
      expect(payload).toMatchObject({ key: 'RATE_LIMIT_RPM', value: '45', updatedBy: 'test-user' });
    });

    it('throws UnknownConfigKeyError for an unrecognised key', async () => {
      const svc = makeService();
      await expect(svc.set('UNKNOWN_KEY', 'value', 'test')).rejects.toBeInstanceOf(
        UnknownConfigKeyError,
      );
    });

    it('does not publish to Redis if publisher is omitted', async () => {
      const svc = makeService();
      // Should not throw even without a publisher
      await expect(svc.set('VENICE_MODEL', 'llama-3', 'test')).resolves.toBeUndefined();
    });
  });

  describe('subscribe()', () => {
    it('subscribes to the config:updates Redis channel', () => {
      const svc = makeService();
      const sub = makeMockSubscriber();
      svc.subscribe(sub);
      expect(sub.subscribed).toContain(CONFIG_REDIS_CHANNEL);
    });

    it('updates in-memory cache on receiving a valid Redis message', () => {
      const svc = makeService();
      const sub = makeMockSubscriber();
      svc.subscribe(sub);

      const msg = JSON.stringify({ key: 'RATE_LIMIT_RPM', value: '99', updatedBy: 'remote-instance' });
      sub.emit(CONFIG_REDIS_CHANNEL, msg);

      expect(svc.get('RATE_LIMIT_RPM')).toBe('99');
    });

    it('ignores messages with unknown config keys', () => {
      const svc = makeService();
      const sub = makeMockSubscriber();
      svc.subscribe(sub);

      const msg = JSON.stringify({ key: 'UNKNOWN_KEY', value: 'bad', updatedBy: 'remote' });
      // Should not throw
      expect(() => sub.emit(CONFIG_REDIS_CHANNEL, msg)).not.toThrow();
      expect(svc.snapshot()['UNKNOWN_KEY']).toBeUndefined();
    });

    it('ignores malformed JSON messages', () => {
      const svc = makeService();
      const sub = makeMockSubscriber();
      svc.subscribe(sub);

      expect(() => sub.emit(CONFIG_REDIS_CHANNEL, 'not-json')).not.toThrow();
    });

    it('propagates a set() change to a second instance via Redis pub/sub', async () => {
      // Simulates two ConfigService instances sharing the same Redis channel
      const db1 = makeInMemoryDb();
      const db2 = makeInMemoryDb();
      const svc1 = new ConfigService(db1);
      const svc2 = new ConfigService(db2);

      const pub = makeMockPublisher();
      const sub = makeMockSubscriber();

      svc2.subscribe(sub);

      await svc1.set('RATE_LIMIT_RPM', '77', 'instance-1', pub);

      // Simulate the message arriving on instance 2's subscriber
      expect(pub.calls).toHaveLength(1);
      sub.emit(pub.calls[0].channel, pub.calls[0].message);

      expect(svc2.get('RATE_LIMIT_RPM')).toBe('77');
    });
  });
});
