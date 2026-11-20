/**
 * TaskProjection — derive current task state from the event log (issue #717).
 *
 * State is never mutated in place; it is always *derived* by replaying the
 * immutable events in `event_store`. `TaskProjection` provides:
 *
 *   • `project(events)` — a pure reducer that folds an ordered event array
 *     into a single {@link TaskState}. No I/O, so it is trivially unit-testable
 *     and deterministic.
 *   • `getCurrentState(taskId)` — loads the latest persisted snapshot for the
 *     task, replays only the events after it, and folds them onto the snapshot
 *     state. Every {@link SNAPSHOT_INTERVAL}th event a new snapshot is written,
 *     so subsequent reads replay progressively fewer events.
 *
 * Together with {@link AppendOnlyEventStore} this is the event-sourcing read
 * model: the `event_store` table is the source of truth and `TaskState` is a
 * projection rebuilt on demand.
 */

import type { AppendOnlyEvent, AppendOnlyEventStore } from '../events/appendOnlyEventStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStateStatus = 'created' | 'running' | 'completed' | 'failed' | 'interrupted';

/** The derived, replayable view of a task. */
export interface TaskState {
  taskId: string;
  status: TaskStateStatus;
  /** Number of nodes that reached `NodeCompleted`. */
  completedNodes: number;
  /** Number of nodes that reached `NodeFailed`. */
  failedNodes: number;
  /** Number of nodes that were started (`NodeStarted`). */
  startedNodes: number;
  /** Number of `PaymentLocked` events. */
  paymentLockedCount: number;
  /** Number of `PaymentReleased` events. */
  paymentReleasedCount: number;
  /** Prompt from the `TaskCreated` event, if present. */
  prompt?: string;
  /** Wallet public key from the `TaskCreated` event, if present. */
  walletPublicKey?: string;
  /** ISO-8601 creation time from `TaskCreated`. */
  createdAt?: string;
  /** ISO-8601 time of the terminal event (`TaskCompleted`/`TaskFailed`). */
  completedAt?: string;
  /** Error message from a `TaskFailed` event. */
  terminalError?: string;
  /** Reason from a `TaskInterrupted` event. */
  interruptReason?: string;
  // ── replay metadata (populated by project / getCurrentState) ──
  /** Total events that make up this state. */
  eventCount: number;
  /** Sequence number of the last event applied. */
  lastSequence: number;
  /** Sequence of the snapshot replay resumed from (0 if none). */
  fromSnapshotSequence: number;
  /** Events replayed in the most recent `getCurrentState` call. */
  replayedEventCount: number;
}

/** A snapshot is written every N events for a task. */
export const SNAPSHOT_INTERVAL = 50;

// ---------------------------------------------------------------------------
// Payload shapes the reducer reads (kept local & permissive)
// ---------------------------------------------------------------------------

interface TaskCreatedPayload {
  prompt?: string;
  walletPublicKey?: string;
  dagSize?: number;
}
interface NodeFailedPayload {
  error?: string;
}
interface TaskFailedPayload {
  error?: string;
  failedStage?: string;
}
interface TaskInterruptedPayload {
  reason?: string;
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

export function initialTaskState(taskId: string): TaskState {
  return {
    taskId,
    status: 'created',
    completedNodes: 0,
    failedNodes: 0,
    startedNodes: 0,
    paymentLockedCount: 0,
    paymentReleasedCount: 0,
    eventCount: 0,
    lastSequence: 0,
    fromSnapshotSequence: 0,
    replayedEventCount: 0,
  };
}

// ---------------------------------------------------------------------------
// Reducer step (pure)
// ---------------------------------------------------------------------------

/**
 * Apply a single event to `state`, returning a NEW state. Pure: never mutates
 * the input. Used by both `project` (full replay) and `getCurrentState`
 * (incremental replay onto a snapshot).
 */
export function applyEvent(state: TaskState, event: AppendOnlyEvent): TaskState {
  switch (event.eventType) {
    case 'TaskCreated': {
      const p = (event.payload ?? {}) as TaskCreatedPayload;
      return {
        ...state,
        taskId: event.taskId,
        status: 'created',
        prompt: p.prompt,
        walletPublicKey: p.walletPublicKey,
        createdAt: event.timestamp,
      };
    }
    case 'NodeStarted': {
      // Only advance from 'created' to 'running'; a task already running or
      // in a terminal state stays where it is.
      const nextStatus = state.status === 'created' ? 'running' : state.status;
      return { ...state, status: nextStatus, startedNodes: state.startedNodes + 1 };
    }
    case 'NodeCompleted':
      return { ...state, completedNodes: state.completedNodes + 1 };
    case 'NodeFailed': {
      const p = (event.payload ?? {}) as NodeFailedPayload;
      return { ...state, failedNodes: state.failedNodes + 1, terminalError: p.error ?? state.terminalError };
    }
    case 'PaymentLocked':
      return { ...state, paymentLockedCount: state.paymentLockedCount + 1 };
    case 'PaymentReleased':
      return { ...state, paymentReleasedCount: state.paymentReleasedCount + 1 };
    case 'TaskCompleted':
      return { ...state, status: 'completed', completedAt: event.timestamp };
    case 'TaskFailed': {
      const p = (event.payload ?? {}) as TaskFailedPayload;
      return { ...state, status: 'failed', completedAt: event.timestamp, terminalError: p.error ?? state.terminalError };
    }
    case 'TaskInterrupted': {
      const p = (event.payload ?? {}) as TaskInterruptedPayload;
      return { ...state, status: 'interrupted', completedAt: event.timestamp, interruptReason: p.reason };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// TaskProjection
// ---------------------------------------------------------------------------

/**
 * Projects `event_store` events into a {@link TaskState}.
 *
 * Construct with an {@link AppendOnlyEventStore}. `project` is a pure static
 * reducer; `getCurrentState` reads from the store and uses snapshots to avoid
 * replaying the whole log on every call.
 */
export class TaskProjection {
  constructor(private readonly store: AppendOnlyEventStore) {}

  /**
   * Pure reducer: fold an ordered event array into a {@link TaskState}.
   * Deterministic and I/O-free.
   */
  static project(events: readonly AppendOnlyEvent[]): TaskState {
    const initial = events.length ? initialTaskState(events[0].taskId) : initialTaskState('');
    const state = events.reduce(applyEvent, initial);
    state.eventCount = events.length;
    state.lastSequence = events.length ? events[events.length - 1].sequence : 0;
    state.replayedEventCount = events.length;
    state.fromSnapshotSequence = 0;
    return state;
  }

  /**
   * Derive the current state for `taskId`.
   *
   * Loads the latest snapshot (if any), replays only the events after it, folds
   * them onto the snapshot state, and writes a fresh snapshot every
   * {@link SNAPSHOT_INTERVAL} events so future reads replay even fewer events.
   */
  getCurrentState(taskId: string): TaskState {
    const snapshot = this.store.loadLatestSnapshot(taskId);
    const fromSnapshotSequence = snapshot ? snapshot.sequence : 0;

    let state: TaskState = snapshot
      ? { ...initialTaskState(taskId), ...(snapshot.state as Partial<TaskState>) }
      : initialTaskState(taskId);
    state.taskId = taskId;
    state.fromSnapshotSequence = fromSnapshotSequence;

    const events = this.store.replayFrom(taskId, fromSnapshotSequence + 1);
    state.replayedEventCount = events.length;

    for (const event of events) {
      state = applyEvent(state, event);
      // Persist a snapshot at every 50-event boundary so the next read can
      // resume from here instead of re-reading the whole log.
      if (event.sequence > 0 && event.sequence % SNAPSHOT_INTERVAL === 0) {
        this.store.saveSnapshot(taskId, event.sequence, state);
      }
    }

    state.lastSequence = events.length ? events[events.length - 1].sequence : fromSnapshotSequence;
    state.eventCount = fromSnapshotSequence + events.length;
    state.fromSnapshotSequence = fromSnapshotSequence;
    state.replayedEventCount = events.length;
    return state;
  }
}
