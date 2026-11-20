/**
 * Unit tests for {@link AppendOnlyEventStore} (issue #717).
 *
 * These exercises need genuine SQLite semantics — the immutability triggers,
 * the `MAX(sequence) + 1` transaction, the `UNIQUE(taskId, sequence)` backstop,
 * and `replayFrom` filtering — so they run against a REAL better-sqlite3
 * database (loaded by absolute path to bypass the jest moduleNameMapper stub).
 * If a working native build is unavailable in the current environment the
 * suite is skipped rather than failing.
 */

import { loadRealDatabase } from '../../tests/realSqlite';
import { AppendOnlyEventStore } from './appendOnlyEventStore';

const DatabaseCtor = loadRealDatabase();
const maybe = DatabaseCtor ? describe : describe.skip;

function newStore() {
  if (!DatabaseCtor) throw new Error('real better-sqlite3 unavailable in this environment');
  const db = new DatabaseCtor(':memory:');
  return new AppendOnlyEventStore(db);
}

maybe('AppendOnlyEventStore — append', () => {
  it('assigns sequence 1 to the first event and 2 to the next for a task', () => {
    const store = newStore();
    const e1 = store.append('t1', 'TaskCreated', { prompt: 'hi' });
    const e2 = store.append('t1', 'NodeStarted', { agentType: 'research' });

    expect(e1.sequence).toBe(1);
    expect(e2.sequence).toBe(2);
    expect(e1.taskId).toBe('t1');
    expect(e1.eventType).toBe('TaskCreated');
    expect(e2.eventType).toBe('NodeStarted');
    store.close();
  });

  it('returns the inserted event with an id and an ISO-8601 timestamp', () => {
    const store = newStore();
    const e = store.append('t1', 'TaskCreated', { prompt: 'hi' });
    expect(typeof e.id).toBe('number');
    expect(e.id).toBeGreaterThan(0);
    expect(() => new Date(e.timestamp).toISOString()).not.toThrow();
    expect(new Date(e.timestamp).toISOString()).toBe(e.timestamp);
    store.close();
  });

  it('round-trips the payload as JSON (objects, numbers, nested)', () => {
    const store = newStore();
    const payload = { balanceId: 'BAL-1', amountStroops: 5_000_000, nested: { a: [1, 2] } };
    store.append('t1', 'PaymentLocked', payload);
    const [stored] = store.replay('t1');
    expect(stored.payload).toEqual(payload);
    store.close();
  });

  it('isolates sequences per taskId (each task starts at 1)', () => {
    const store = newStore();
    const a1 = store.append('taskA', 'TaskCreated', {});
    const b1 = store.append('taskB', 'TaskCreated', {});
    const a2 = store.append('taskA', 'NodeStarted', {});

    expect(a1.sequence).toBe(1);
    expect(b1.sequence).toBe(1);
    expect(a2.sequence).toBe(2);
    store.close();
  });
});

maybe('AppendOnlyEventStore — replay', () => {
  it('returns all events in ascending sequence order', () => {
    const store = newStore();
    for (let i = 0; i < 5; i++) store.append('t1', 'NodeStarted', { i });
    const events = store.replay('t1');
    expect(events.map((e) => e.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(events.map((e) => e.eventType)).toEqual([
      'NodeStarted',
      'NodeStarted',
      'NodeStarted',
      'NodeStarted',
      'NodeStarted',
    ]);
    store.close();
  });

  it('returns an empty array for an unknown taskId', () => {
    const store = newStore();
    expect(store.replay('ghost')).toEqual([]);
    store.close();
  });
});

maybe('AppendOnlyEventStore — replayFrom', () => {
  it('returns only events with sequence >= fromSequence', () => {
    const store = newStore();
    for (let i = 0; i < 60; i++) store.append('t1', 'NodeStarted', {});
    const from50 = store.replayFrom('t1', 50);
    expect(from50.map((e) => e.sequence)).toEqual(
      Array.from({ length: 11 }, (_, i) => 50 + i)
    );
    store.close();
  });

  it('returns all events when fromSequence is 1', () => {
    const store = newStore();
    for (let i = 0; i < 4; i++) store.append('t1', 'NodeStarted', {});
    expect(store.replayFrom('t1', 1).map((e) => e.sequence)).toEqual([1, 2, 3, 4]);
    store.close();
  });

  it('returns an empty array when fromSequence is past the last event', () => {
    const store = newStore();
    for (let i = 0; i < 4; i++) store.append('t1', 'NodeStarted', {});
    expect(store.replayFrom('t1', 100)).toEqual([]);
    store.close();
  });
});

maybe('AppendOnlyEventStore — immutability', () => {
  it('raises on UPDATE (trigger prevents mutation)', () => {
    const store = newStore();
    store.append('t1', 'TaskCreated', { prompt: 'x' });
    expect(() =>
      (store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } }).db
        .prepare('UPDATE event_store SET eventType = ? WHERE taskId = ?')
        .run('TaskFailed', 't1')
    ).toThrow();
    store.close();
  });

  it('raises on DELETE (trigger prevents mutation)', () => {
    const store = newStore();
    store.append('t1', 'TaskCreated', { prompt: 'x' });
    expect(() =>
      (store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } }).db
        .prepare('DELETE FROM event_store WHERE taskId = ?')
        .run('t1')
    ).toThrow();
    store.close();
  });

  it('still allows new appends after the triggers are in place', () => {
    const store = newStore();
    store.append('t1', 'TaskCreated', {});
    store.append('t1', 'NodeStarted', {});
    expect(store.replay('t1').length).toBe(2);
    store.close();
  });
});

maybe('AppendOnlyEventStore — concurrent / gap-free sequences', () => {
  it('maintains gap-free, duplicate-free sequences across many appends', () => {
    const store = newStore();
    const N = 100;
    for (let i = 0; i < N; i++) store.append('t1', 'NodeStarted', { i });
    const sequences = store.replay('t1').map((e) => e.sequence);
    expect(sequences).toEqual(Array.from({ length: N }, (_, i) => i + 1));
    // No gaps or duplicates (Set size === N and max === N).
    expect(new Set(sequences).size).toBe(N);
    expect(Math.max(...sequences)).toBe(N);
    store.close();
  });

  it('rejects a duplicate (taskId, sequence) via the UNIQUE constraint', () => {
    const store = newStore();
    store.append('t1', 'TaskCreated', {});
    expect(() =>
      (store as unknown as { db: { prepare: (s: string) => { run: (...a: unknown[]) => unknown } } }).db
        .prepare('INSERT INTO event_store (taskId, eventType, payload, timestamp, sequence) VALUES (?, ?, ?, ?, ?)')
        .run('t1', 'NodeStarted', '{}', new Date().toISOString(), 1)
    ).toThrow();
    store.close();
  });

  it('two connections to the same file DB interleave without sequence gaps/dupes', () => {
    if (!DatabaseCtor) throw new Error('real better-sqlite3 unavailable in this environment');
    const path = `${process.cwd()}/es-concurrency-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
    const db1 = new DatabaseCtor(path);
    const db2 = new DatabaseCtor(path);
    const store1 = new AppendOnlyEventStore(db1);
    const store2 = new AppendOnlyEventStore(db2);

    // Interleave appends across the two connections.
    for (let i = 0; i < 25; i++) {
      store1.append('t1', 'NodeStarted', { from: 's1', i });
      store2.append('t1', 'NodeCompleted', { from: 's2', i });
    }

    const sequences = store1.replay('t1').map((e) => e.sequence);
    expect(sequences).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(new Set(sequences).size).toBe(50);

    store1.close();
    store2.close();
    // tidy up the temp file
    try {
      const fs = require('fs');
      fs.unlinkSync(path);
    } catch {
      /* ignore */
    }
  });
});

maybe('AppendOnlyEventStore — snapshots', () => {
  it('saveSnapshot / loadLatestSnapshot round-trip a state object', () => {
    const store = newStore();
    store.saveSnapshot('t1', 10, { status: 'running', completedNodes: 2 });
    const snap = store.loadLatestSnapshot('t1');
    expect(snap).not.toBeNull();
    expect(snap?.sequence).toBe(10);
    expect(snap?.state).toEqual({ status: 'running', completedNodes: 2 });
    store.close();
  });

  it('loadLatestSnapshot returns null when no snapshot exists', () => {
    const store = newStore();
    expect(store.loadLatestSnapshot('t1')).toBeNull();
    store.close();
  });

  it('loadLatestSnapshot returns the highest-sequence snapshot', () => {
    const store = newStore();
    store.saveSnapshot('t1', 10, { s: 10 });
    store.saveSnapshot('t1', 50, { s: 50 });
    store.saveSnapshot('t1', 20, { s: 20 });
    const snap = store.loadLatestSnapshot('t1');
    expect(snap?.sequence).toBe(50);
    expect(snap?.state).toEqual({ s: 50 });
    store.close();
  });
});
