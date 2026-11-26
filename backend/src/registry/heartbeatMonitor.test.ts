/**
 * Unit tests for HeartbeatMonitor.
 *
 * Uses Jest fake timers to control the check interval and a real in-memory
 * SQLite database (via better-sqlite3) so DB queries execute correctly.
 *
 * The eventBus is spied on rather than mocked so we can capture emitted
 * events without breaking the EventBus internals.
 */

// Silence logger output during tests.
jest.mock('../utils/logger', () => {
  const stub: Record<string, unknown> = {
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    fatal: () => {},
  };
  stub['child'] = () => stub;
  return { createLogger: () => stub };
});

// Use the real better-sqlite3 instead of the stub mock so SQL actually runs.
jest.mock('better-sqlite3', () => jest.requireActual('better-sqlite3'));

import Database from 'better-sqlite3';
import { HeartbeatMonitor } from './heartbeatMonitor';
import { createAgentDb, type AgentDb } from '../db/agents';
import { eventBus } from '../coordinator/eventBus';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function createTestDb(): { db: AgentDb; raw: Database.Database } {
  const raw = new Database(':memory:');
  const db = createAgentDb(raw);
  return { db, raw };
}

function insertAgent(
  db: AgentDb,
  raw: Database.Database,
  overrides: Partial<{
    id: string;
    status: 'online' | 'offline' | 'deregistered';
    minutesAgo: number;
  }> = {},
): void {
  const id = overrides.id ?? 'agent-test-1';
  const status = overrides.status ?? 'online';
  // Insert with current timestamp first, then backdate.
  db.upsert({
    id,
    capabilities: ['coding'],
    pricingXLM: 1.0,
    endpoint: 'http://localhost:3001',
    stellarPublicKey: 'GBXXX',
    reputationScore: 50,
    lastSeenAt: new Date().toISOString(),
    status: status as 'online' | 'offline',
  });

  if (overrides.minutesAgo !== undefined) {
    const secondsAgo = overrides.minutesAgo * 60;
    raw
      .prepare(
        `UPDATE agents
         SET lastSeenAt    = datetime('now', '-' || ? || ' seconds'),
             last_seen_at  = unixepoch() - ?
         WHERE id = ?`,
      )
      .run(secondsAgo, secondsAgo, id);
  }

  if (overrides.status === 'offline' || overrides.status === 'deregistered') {
    raw.prepare(`UPDATE agents SET status = ? WHERE id = ?`).run(status, id);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('HeartbeatMonitor — start() / stop()', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('starts the interval and fires runCheck on each tick', async () => {
    const { db } = createTestDb();
    const monitor = new HeartbeatMonitor({ db, checkIntervalMs: 1_000 });
    const runCheckSpy = jest.spyOn(monitor, 'runCheck').mockResolvedValue(undefined);

    monitor.start();
    expect(runCheckSpy).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1_000);
    // Let the microtask queue drain.
    await Promise.resolve();

    expect(runCheckSpy).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(2_000);
    await Promise.resolve();

    expect(runCheckSpy).toHaveBeenCalledTimes(3);
    monitor.stop();
  });

  it('calling start() twice does not create a second interval', () => {
    const { db } = createTestDb();
    const setIntervalSpy = jest.spyOn(global, 'setInterval');
    const monitor = new HeartbeatMonitor({ db, checkIntervalMs: 1_000 });

    monitor.start();
    monitor.start(); // duplicate — must be ignored

    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    monitor.stop();
    setIntervalSpy.mockRestore();
  });

  it('stop() clears the interval', () => {
    const { db } = createTestDb();
    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    const monitor = new HeartbeatMonitor({ db, checkIntervalMs: 1_000 });

    monitor.start();
    monitor.stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    clearIntervalSpy.mockRestore();
  });

  it('stop() without start() does not throw', () => {
    const { db } = createTestDb();
    const monitor = new HeartbeatMonitor({ db, checkIntervalMs: 1_000 });
    expect(() => monitor.stop()).not.toThrow();
  });

  it('stop() after stop() does not call clearInterval a second time', () => {
    const { db } = createTestDb();
    const monitor = new HeartbeatMonitor({ db, checkIntervalMs: 1_000 });

    monitor.start();
    monitor.stop();

    const clearIntervalSpy = jest.spyOn(global, 'clearInterval');
    monitor.stop(); // second stop — must be a no-op

    expect(clearIntervalSpy).not.toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('HeartbeatMonitor — markOffline (15-minute threshold)', () => {
  it('marks an online agent offline when it exceeds the threshold', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'online', minutesAgo: 16 });

    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
    });
    await monitor.runCheck();

    expect(db.findById('a1')?.status).toBe('offline');
  });

  it('leaves an online agent untouched when it is within the threshold', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'online', minutesAgo: 10 });

    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
    });
    await monitor.runCheck();

    expect(db.findById('a1')?.status).toBe('online');
  });

  it('marks multiple stale agents offline in one check', async () => {
    const { db, raw } = createTestDb();
    for (const id of ['a1', 'a2', 'a3']) {
      insertAgent(db, raw, { id, status: 'online', minutesAgo: 20 });
    }

    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
    });
    await monitor.runCheck();

    for (const id of ['a1', 'a2', 'a3']) {
      expect(db.findById(id)?.status).toBe('offline');
    }
  });

  it('never marks an already-offline agent through markStaleAgents', async () => {
    // An agent that is already offline should not be touched by the online→offline pass.
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'offline', minutesAgo: 20 });

    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      // Keep deregister threshold high enough so it won't be deregistered here.
      deregisterThresholdMs: 999_999_999,
    });
    await monitor.runCheck();

    // Still offline (not deregistered yet, threshold too high)
    expect(db.findById('a1')?.status).toBe('offline');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('HeartbeatMonitor — markDeregistered (45-minute threshold)', () => {
  it('deregisters an offline agent that exceeds the deregister threshold', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'offline', minutesAgo: 46 });

    const revoked: string[] = [];
    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async (id) => { revoked.push(id); },
    });
    await monitor.runCheck();

    expect(db.findById('a1')?.status).toBe('deregistered');
    expect(revoked).toContain('a1');
  });

  it('leaves an offline agent untouched when it is within the deregister threshold', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'offline', minutesAgo: 30 });

    const revoked: string[] = [];
    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async (id) => { revoked.push(id); },
    });
    await monitor.runCheck();

    expect(db.findById('a1')?.status).toBe('offline');
    expect(revoked).toHaveLength(0);
  });

  it('calls onChainRevoke exactly once per agent across two check cycles', async () => {
    const { db, raw } = createTestDb();
    for (const id of ['a1', 'a2']) {
      insertAgent(db, raw, { id, status: 'offline', minutesAgo: 50 });
    }

    const revokeCounts: Record<string, number> = {};
    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async (id) => {
        revokeCounts[id] = (revokeCounts[id] ?? 0) + 1;
      },
    });

    await monitor.runCheck();
    await monitor.runCheck(); // second cycle must not re-revoke

    expect(revokeCounts['a1']).toBe(1);
    expect(revokeCounts['a2']).toBe(1);
  });

  it('continues deregistering remaining agents when one revocation fails', async () => {
    const { db, raw } = createTestDb();
    for (const id of ['a1', 'a2', 'a3']) {
      insertAgent(db, raw, { id, status: 'offline', minutesAgo: 50 });
    }

    const revoked: string[] = [];
    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async (id) => {
        if (id === 'a2') throw new Error('Stellar RPC unavailable');
        revoked.push(id);
      },
    });
    await monitor.runCheck();

    // a1 and a3 succeed; a2's DB row was already updated before the throw
    expect(db.findById('a1')?.status).toBe('deregistered');
    expect(db.findById('a2')?.status).toBe('deregistered'); // DB updated before throw
    expect(db.findById('a3')?.status).toBe('deregistered');
    expect(revoked).toContain('a1');
    expect(revoked).toContain('a3');
    expect(revoked).not.toContain('a2');
  });

  it('does not revoke online agents even if they are very old', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'online', minutesAgo: 120 });

    const revoked: string[] = [];
    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 999_999_999, // effectively disabled
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async (id) => { revoked.push(id); },
    });
    await monitor.runCheck();

    expect(revoked).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('HeartbeatMonitor — event emission', () => {
  it('emits AgentDeregistered on the system channel with agentId and reason', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'offline', minutesAgo: 50 });

    const captured: Array<{ type: string; payload: unknown }> = [];
    const originalEmit = eventBus.emit.bind(eventBus);
    const emitSpy = jest
      .spyOn(eventBus, 'emit')
      .mockImplementation(((taskId: string, event: any) => {
        if (taskId === 'system') captured.push({ type: event.type, payload: event.payload });
        return originalEmit(taskId, event);
      }) as typeof eventBus.emit);

    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async () => {},
    });
    await monitor.runCheck();

    const deregEvent = captured.find((e) => e.type === 'AgentDeregistered');
    expect(deregEvent).toBeDefined();
    expect(deregEvent?.payload).toMatchObject({
      agentId: 'a1',
      reason: 'heartbeat_timeout',
    });

    emitSpy.mockRestore();
  });

  it('emits AgentMarkedOffline on the system channel when agents go offline', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'online', minutesAgo: 20 });

    const captured: Array<{ type: string; payload: unknown }> = [];
    const originalEmit = eventBus.emit.bind(eventBus);
    const emitSpy = jest
      .spyOn(eventBus, 'emit')
      .mockImplementation(((taskId: string, event: any) => {
        if (taskId === 'system') captured.push({ type: event.type, payload: event.payload });
        return originalEmit(taskId, event);
      }) as typeof eventBus.emit);

    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async () => {},
    });
    await monitor.runCheck();

    const offlineEvent = captured.find((e) => e.type === 'AgentMarkedOffline');
    expect(offlineEvent).toBeDefined();
    expect(offlineEvent?.payload).toMatchObject({ reason: 'heartbeat_timeout' });

    emitSpy.mockRestore();
  });

  it('does not emit AgentDeregistered when no agents cross the threshold', async () => {
    const { db, raw } = createTestDb();
    insertAgent(db, raw, { id: 'a1', status: 'offline', minutesAgo: 10 });

    const captured: string[] = [];
    const originalEmit = eventBus.emit.bind(eventBus);
    const emitSpy = jest
      .spyOn(eventBus, 'emit')
      .mockImplementation(((taskId: string, event: any) => {
        if (taskId === 'system') captured.push(event.type as string);
        return originalEmit(taskId, event);
      }) as typeof eventBus.emit);

    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async () => {},
    });
    await monitor.runCheck();

    expect(captured).not.toContain('AgentDeregistered');

    emitSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('HeartbeatMonitor — full lifecycle transition', () => {
  it('transitions an agent online → offline → deregistered across two checks', async () => {
    const { db, raw } = createTestDb();
    // Start online and stale enough to go offline (> 15 min).
    insertAgent(db, raw, { id: 'a1', status: 'online', minutesAgo: 20 });

    const revoked: string[] = [];
    const monitor = new HeartbeatMonitor({
      db,
      offlineThresholdMs: 15 * 60_000,
      deregisterThresholdMs: 45 * 60_000,
      onChainRevoke: async (id) => { revoked.push(id); },
    });

    // First check: online → offline (20 min > 15 min threshold).
    await monitor.runCheck();
    expect(db.findById('a1')?.status).toBe('offline');
    expect(revoked).toHaveLength(0); // 20 min < 45 min deregister threshold

    // Simulate more time passing — now 50 minutes old in total.
    raw
      .prepare(
        `UPDATE agents
         SET lastSeenAt   = datetime('now', '-50 minutes'),
             last_seen_at = unixepoch() - 3000
         WHERE id = 'a1'`,
      )
      .run();

    // Second check: offline → deregistered (50 min > 45 min threshold).
    await monitor.runCheck();
    expect(db.findById('a1')?.status).toBe('deregistered');
    expect(revoked).toContain('a1');
  });
});
