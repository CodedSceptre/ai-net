/**
 * Unit tests for {@link TaskProjection} (issue #717).
 *
 * The `project` reducer is pure, so its suite always runs. `getCurrentState`
 * reads from an {@link AppendOnlyEventStore} and needs genuine SQLite for the
 * snapshot behaviour, so it runs against a real better-sqlite3 database
 * (loaded by absolute path to bypass the jest moduleNameMapper stub) and is
 * skipped when a working native build is unavailable.
 */

import { loadRealDatabase } from '../../tests/realSqlite';
import { AppendOnlyEventStore } from '../events/appendOnlyEventStore';
import type { AppendOnlyEvent } from '../events/appendOnlyEventStore';
import { TaskProjection, applyEvent, initialTaskState } from './taskProjection';
import type { TaskState } from './taskProjection';

// ---------------------------------------------------------------------------
// Event fixture builder
// ---------------------------------------------------------------------------

function ev(
  taskId: string,
  eventType: AppendOnlyEvent['eventType'],
  sequence: number,
  payload: Record<string, unknown> = {},
  timestamp = `2025-01-01T00:00:${String(sequence).padStart(2, '0')}.000Z`
): AppendOnlyEvent {
  return { id: sequence, taskId, eventType, payload, timestamp, sequence };
}

// ---------------------------------------------------------------------------
// project — pure reducer (always runs)
// ---------------------------------------------------------------------------

describe('TaskProjection.project — 6-event acceptance sequence', () => {
  it("produces { status: 'completed', completedNodes: 1 }", () => {
    const events: AppendOnlyEvent[] = [
      ev('t1', 'TaskCreated', 1, { prompt: 'p', walletPublicKey: 'G', dagSize: 1 }),
      ev('t1', 'NodeStarted', 2, { agentType: 'research' }),
      ev('t1', 'NodeCompleted', 3, { result: { ok: true } }),
      ev('t1', 'PaymentLocked', 4, { balanceId: 'B1', amountStroops: 5_000_000 }),
      ev('t1', 'PaymentReleased', 5, { txHash: 'TX1' }),
      ev('t1', 'TaskCompleted', 6),
    ];
    const state = TaskProjection.project(events);
    expect(state.status).toBe('completed');
    expect(state.completedNodes).toBe(1);
  });
});

describe('TaskProjection.project — 7-event known fixture', () => {
  it('produces the expected final TaskState', () => {
    const events: AppendOnlyEvent[] = [
      ev('t1', 'TaskCreated', 1, { prompt: 'analyze market', walletPublicKey: 'GXYZ', dagSize: 2 }),
      ev('t1', 'NodeStarted', 2, { agentType: 'research' }),
      ev('t1', 'NodeCompleted', 3, { result: { summary: 'data' } }),
      ev('t1', 'PaymentLocked', 4, { balanceId: 'B1', amountStroops: 10_000_000 }),
      ev('t1', 'PaymentReleased', 5, { txHash: 'TX1' }),
      ev('t1', 'NodeStarted', 6, { agentType: 'report' }),
      ev('t1', 'TaskCompleted', 7),
    ];
    const state = TaskProjection.project(events);
    expect(state.status).toBe('completed');
    expect(state.startedNodes).toBe(2);
    expect(state.completedNodes).toBe(1);
    expect(state.failedNodes).toBe(0);
    expect(state.paymentLockedCount).toBe(1);
    expect(state.paymentReleasedCount).toBe(1);
    expect(state.prompt).toBe('analyze market');
    expect(state.walletPublicKey).toBe('GXYZ');
    expect(state.createdAt).toBe(events[0].timestamp);
    expect(state.completedAt).toBe(events[6].timestamp);
    expect(state.eventCount).toBe(7);
    expect(state.lastSequence).toBe(7);
    expect(state.fromSnapshotSequence).toBe(0);
    expect(state.replayedEventCount).toBe(7);
  });
});

describe('TaskProjection.project — every event type', () => {
  it('TaskCreated sets status, prompt, wallet, createdAt', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, { prompt: 'do thing', walletPublicKey: 'GW', dagSize: 3 }),
    ]);
    expect(state.status).toBe('created');
    expect(state.prompt).toBe('do thing');
    expect(state.walletPublicKey).toBe('GW');
    expect(state.createdAt).toBeDefined();
  });

  it('NodeStarted advances created → running and counts started nodes', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'NodeStarted', 2, { agentType: 'research' }),
    ]);
    expect(state.status).toBe('running');
    expect(state.startedNodes).toBe(1);
  });

  it('NodeCompleted counts a completed node', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'NodeStarted', 2, {}),
      ev('t1', 'NodeCompleted', 3, { result: 42 }),
    ]);
    expect(state.completedNodes).toBe(1);
  });

  it('NodeFailed counts a failed node', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'NodeStarted', 2, {}),
      ev('t1', 'NodeFailed', 3, { error: 'boom' }),
    ]);
    expect(state.failedNodes).toBe(1);
  });

  it('PaymentLocked counts a locked payment', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'PaymentLocked', 2, { balanceId: 'B', amountStroops: 1 }),
    ]);
    expect(state.paymentLockedCount).toBe(1);
    expect(state.paymentReleasedCount).toBe(0);
  });

  it('PaymentReleased counts a released payment', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'PaymentLocked', 2, {}),
      ev('t1', 'PaymentReleased', 3, { txHash: 'T' }),
    ]);
    expect(state.paymentReleasedCount).toBe(1);
    expect(state.paymentLockedCount).toBe(1);
  });

  it('TaskCompleted sets terminal status and completedAt', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'TaskCompleted', 2),
    ]);
    expect(state.status).toBe('completed');
    expect(state.completedAt).toBeDefined();
  });

  it('TaskFailed sets status failed and terminalError', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'TaskFailed', 2, { error: 'payment failed' }),
    ]);
    expect(state.status).toBe('failed');
    expect(state.terminalError).toBe('payment failed');
  });

  it('TaskInterrupted sets status interrupted and interruptReason', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'TaskInterrupted', 2, { reason: 'user-cancelled' }),
    ]);
    expect(state.status).toBe('interrupted');
    expect(state.interruptReason).toBe('user-cancelled');
  });
});

describe('TaskProjection.project — edge cases', () => {
  it('returns an initial state for an empty event array', () => {
    const state = TaskProjection.project([]);
    expect(state.status).toBe('created');
    expect(state.completedNodes).toBe(0);
    expect(state.eventCount).toBe(0);
    expect(state.lastSequence).toBe(0);
  });

  it('does not regress from running back to created', () => {
    const state = TaskProjection.project([
      ev('t1', 'TaskCreated', 1, {}),
      ev('t1', 'NodeStarted', 2, {}),
      ev('t1', 'NodeStarted', 3, {}), // second node start keeps running
    ]);
    expect(state.status).toBe('running');
    expect(state.startedNodes).toBe(2);
  });

  it('a terminal state is not overwritten by a later NodeStarted', () => {
    let state = TaskProjection.project([ev('t1', 'TaskCreated', 1, {}), ev('t1', 'TaskCompleted', 2)]);
    state = applyEvent(state, ev('t1', 'NodeStarted', 3, {}));
    expect(state.status).toBe('completed');
    expect(state.startedNodes).toBe(1);
  });
});

describe('applyEvent / initialTaskState', () => {
  it('initialTaskState zeroes all counters', () => {
    const s = initialTaskState('t9');
    expect(s.completedNodes).toBe(0);
    expect(s.failedNodes).toBe(0);
    expect(s.startedNodes).toBe(0);
    expect(s.paymentLockedCount).toBe(0);
    expect(s.paymentReleasedCount).toBe(0);
    expect(s.eventCount).toBe(0);
  });

  it('applyEvent is pure — returns a new object, input untouched', () => {
    const before = initialTaskState('t1');
    const beforeCompleted = before.completedNodes;
    const after = applyEvent(before, ev('t1', 'NodeCompleted', 1, {}));
    expect(after).not.toBe(before);
    expect(before.completedNodes).toBe(beforeCompleted); // input untouched
    expect(after.completedNodes).toBe(beforeCompleted + 1);
  });
});

// ---------------------------------------------------------------------------
// getCurrentState — snapshot-aware (real SQLite only)
// ---------------------------------------------------------------------------

const DatabaseCtor = loadRealDatabase();
const maybe = DatabaseCtor ? describe : describe.skip;

function newStore() {
  if (!DatabaseCtor) throw new Error('real better-sqlite3 unavailable in this environment');
  const db = new DatabaseCtor(':memory:');
  return new AppendOnlyEventStore(db);
}

function appendTaskLifecycle(store: AppendOnlyEventStore, taskId: string, count: number): void {
  for (let i = 0; i < count; i++) {
    if (i === 0) {
      store.append(taskId, 'TaskCreated', { prompt: 'p', walletPublicKey: 'G', dagSize: 1 });
    } else if (i % 2 === 1) {
      store.append(taskId, 'NodeStarted', { agentType: 'research' });
    } else {
      store.append(taskId, 'NodeCompleted', { result: null });
    }
  }
}

maybe('TaskProjection.getCurrentState — snapshots', () => {
  it('saves a snapshot at the 50th event', () => {
    const store = newStore();
    const projection = new TaskProjection(store);
    const taskId = 'snap-50';
    appendTaskLifecycle(store, taskId, 50);

    // First read replays 1..50 and saves a snapshot at sequence 50.
    projection.getCurrentState(taskId);
    const snap = store.loadLatestSnapshot(taskId);
    expect(snap).not.toBeNull();
    expect(snap?.sequence).toBe(50);
    store.close();
  });

  it('replays only 10 events for a 60-event task after the snapshot at 50', () => {
    const store = newStore();
    const projection = new TaskProjection(store);
    const taskId = 'snap-60';
    appendTaskLifecycle(store, taskId, 50);
    projection.getCurrentState(taskId); // saves snapshot @ 50

    appendTaskLifecycle(store, taskId, 10); // now 60 events total (51..60)
    const state = projection.getCurrentState(taskId);

    expect(state.fromSnapshotSequence).toBe(50);
    expect(state.replayedEventCount).toBe(10);
    expect(state.eventCount).toBe(60);
    store.close();
  });

  it('without a snapshot, replays all events and reports fromSnapshotSequence 0', () => {
    const store = newStore();
    const projection = new TaskProjection(store);
    const taskId = 'no-snap';
    appendTaskLifecycle(store, taskId, 7);
    const state = projection.getCurrentState(taskId);
    expect(state.fromSnapshotSequence).toBe(0);
    expect(state.replayedEventCount).toBe(7);
    expect(state.eventCount).toBe(7);
    store.close();
  });

  it('produces the same derived state as project() over the full replay', () => {
    const store = newStore();
    const projection = new TaskProjection(store);
    const taskId = 'consistency';
    appendTaskLifecycle(store, taskId, 60);
    // Prime a snapshot at 50 so getCurrentState takes the snapshot path.
    projection.getCurrentState(taskId);
    const derived = projection.getCurrentState(taskId);
    const fullReplay = TaskProjection.project(store.replay(taskId));

    expect(derived.status).toBe(fullReplay.status);
    expect(derived.completedNodes).toBe(fullReplay.completedNodes);
    expect(derived.failedNodes).toBe(fullReplay.failedNodes);
    expect(derived.startedNodes).toBe(fullReplay.startedNodes);
    expect(derived.paymentLockedCount).toBe(fullReplay.paymentLockedCount);
    expect(derived.paymentReleasedCount).toBe(fullReplay.paymentReleasedCount);
    expect(derived.eventCount).toBe(fullReplay.eventCount);
    expect(derived.lastSequence).toBe(fullReplay.lastSequence);
    store.close();
  });

  it('returns a created initial state for a task with no events', () => {
    const store = newStore();
    const projection = new TaskProjection(store);
    const state = projection.getCurrentState('never-existed');
    expect(state.status).toBe('created');
    expect(state.eventCount).toBe(0);
    store.close();
  });
});
