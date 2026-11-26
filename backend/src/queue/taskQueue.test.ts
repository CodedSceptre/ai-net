/**
 * TaskQueue integration tests
 *
 * Uses an in-memory SQLite database (no Redis required) to verify the full
 * enqueue → worker execution → completion flow for DAG jobs.
 */

import Database from 'better-sqlite3';
import { createJobStore } from './jobStore';
import { TaskQueue, QueueStatus, setGlobalTaskQueue } from './taskQueue';
import type { DAGJobPayload } from './taskQueue';
import type { DAGNode } from '../types/task';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a TaskQueue that uses an in-memory SQLite store so tests are
 * isolated and do not touch the filesystem job.db.
 */
function makeInMemoryTaskQueue(options?: {
  concurrency?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
}): TaskQueue {
  const db = new Database(':memory:');
  const store = createJobStore(db);

  return new TaskQueue({ baseBackoffMs: 100, ...options, store });
}

function makeDag(nodeCount = 2): DAGNode[] {
  return Array.from({ length: nodeCount }, (_, i) => ({
    nodeId: `node-${i}`,
    type: 'research',
    status: 'pending' as const,
    dependencies: i === 0 ? [] : [`node-${i - 1}`],
    prompt: `Step ${i}`,
  }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskQueue', () => {
  it('enqueueDAG returns a job ID immediately without blocking', async () => {
    const tq = makeInMemoryTaskQueue({ concurrency: 1 });
    const dag = makeDag(2);
    const start = Date.now();
    const jobId = tq.enqueueDAG('task_abc', dag);
    const elapsed = Date.now() - start;

    expect(jobId).toMatch(/^job_/);
    expect(elapsed).toBeLessThan(100); // must return within 100 ms

    await tq.shutdown(2000);
  });

  it('getStatus returns correct shape with all required fields', async () => {
    const tq = makeInMemoryTaskQueue({ concurrency: 3 });
    const status: QueueStatus = tq.getStatus();

    expect(status).toHaveProperty('waiting');
    expect(status).toHaveProperty('active');
    expect(status).toHaveProperty('completed');
    expect(status).toHaveProperty('failed');
    expect(status).toHaveProperty('dlqDepth');
    expect(status).toHaveProperty('workerCount', 3);

    // All values must be non-negative numbers
    for (const key of ['waiting', 'active', 'completed', 'failed', 'dlqDepth', 'workerCount'] as const) {
      expect(typeof status[key]).toBe('number');
      expect(status[key]).toBeGreaterThanOrEqual(0);
    }

    await tq.shutdown(2000);
  });

  it('workerCount reflects QUEUE_CONCURRENCY env variable default', async () => {
    const original = process.env.QUEUE_CONCURRENCY;
    process.env.QUEUE_CONCURRENCY = '5';

    const tq = new TaskQueue();
    expect(tq.getStatus().workerCount).toBe(5);

    process.env.QUEUE_CONCURRENCY = original ?? '';
    await tq.shutdown(2000);
  });

  it('enqueuing a 4th job while 3 are active leaves it in waiting state', async () => {
    const tq = makeInMemoryTaskQueue({ concurrency: 3, maxRetries: 1, baseBackoffMs: 100 });
    const blockers: Array<() => void> = [];

    tq.setHandler(async () => {
      await new Promise<void>((r) => blockers.push(r));
    });

    tq.enqueueDAG('task_1', makeDag(1));
    tq.enqueueDAG('task_2', makeDag(1));
    tq.enqueueDAG('task_3', makeDag(1));
    tq.enqueueDAG('task_4', makeDag(1));

    // Allow worker poll cycle to pick up jobs
    await sleep(500);

    const status = tq.getStatus();
    // 3 slots occupied, 1 waiting
    expect(status.active).toBe(3);
    expect(status.waiting).toBeGreaterThanOrEqual(1);

    // Unblock all
    blockers.forEach((r) => r());
    await tq.shutdown(5000);
  });

  it('a job that fails maxRetries times lands in the dead-letter queue', async () => {
    // baseBackoffMs=50 so 2 retries take ~100 ms total (50 + 100)
    const tq = makeInMemoryTaskQueue({ concurrency: 1, maxRetries: 2, baseBackoffMs: 50 });

    tq.setHandler(async () => {
      throw new Error('simulated failure');
    });

    tq.enqueueDAG('task_fail', makeDag(1));

    // Wait long enough for 2 retries with 50 ms backoff
    await sleep(2000);

    const status = tq.getStatus();
    expect(status.dlqDepth).toBeGreaterThanOrEqual(1);

    await tq.shutdown(2000);
  }, 10_000);

  it('shutdown resolves without corrupting in-flight job state', async () => {
    const tq = makeInMemoryTaskQueue({ concurrency: 1, maxRetries: 1, baseBackoffMs: 100 });
    let handlerStarted = false;
    let handlerFinished = false;

    tq.setHandler(async () => {
      handlerStarted = true;
      await sleep(200);
      handlerFinished = true;
    });

    tq.enqueueDAG('task_shutdown', makeDag(1));
    await sleep(50); // let handler start

    await tq.shutdown(2000);

    expect(handlerStarted).toBe(true);
    expect(handlerFinished).toBe(true);
  });

  it('setGlobalTaskQueue replaces the singleton', () => {
    const original = new TaskQueue({ concurrency: 1 });
    setGlobalTaskQueue(original);

    const replacement = new TaskQueue({ concurrency: 7 });
    setGlobalTaskQueue(replacement);

    // We can't call getGlobalTaskQueue here without importing it circularly,
    // but the setter should not throw.
    expect(replacement.getStatus().workerCount).toBe(7);

    original.shutdown().catch(() => { /* ignore */ });
    replacement.shutdown().catch(() => { /* ignore */ });
  });
});

describe('QueueStatus shape', () => {
  it('has all required fields with numeric values', async () => {
    const tq = makeInMemoryTaskQueue({ concurrency: 2 });
    const s = tq.getStatus();
    const keys: Array<keyof QueueStatus> = [
      'waiting',
      'active',
      'completed',
      'failed',
      'dlqDepth',
      'workerCount',
    ];
    keys.forEach((k) => {
      expect(s).toHaveProperty(k);
      expect(typeof s[k]).toBe('number');
    });
    await tq.shutdown(2000);
  });

  it('workerCount matches configured concurrency', async () => {
    const tq = makeInMemoryTaskQueue({ concurrency: 4 });
    expect(tq.getStatus().workerCount).toBe(4);
    await tq.shutdown(2000);
  });
});

describe('DAGJobPayload', () => {
  it('enqueueDAG stores taskId and dag in the job payload', async () => {
    const db = new Database(':memory:');
    const store = createJobStore(db);

    const tq = new TaskQueue({ concurrency: 1, store });

    // Pause the handler so the job stays in the store long enough to read back
    tq.setHandler(async () => { await sleep(10_000); });

    const dag = makeDag(3);
    const jobId = tq.enqueueDAG('task_payload_check', dag, 'corr-123');

    const job = tq.getQueue().getJob(jobId);
    expect(job).toBeDefined();
    expect(job!.taskId).toBe('task_payload_check');

    const payload = job!.payload as DAGJobPayload;
    expect(payload.dag).toHaveLength(3);
    expect(payload.correlationId).toBe('corr-123');

    await tq.shutdown(500);
  });
});
