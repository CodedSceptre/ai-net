/**
 * TaskQueue — high-level DAG enqueueing wrapper around the SQLite-backed JobQueue.
 *
 * Provides the enqueueDAG / getStatus / shutdown API described in issue #649.
 * Uses the existing JobQueue + JobWorker infrastructure (backend/src/queue/index.ts)
 * rather than introducing an external Redis dependency for the queue layer itself;
 * Redis is used only for the EventBus multi-process fan-out when REDIS_URL is set.
 */

import { JobQueue, createJobQueue } from './index';
import { createJobStore, getJobDb } from './jobStore';
import type { JobStore } from './jobStore';
import { JobWorker } from './worker';
import { eventBus } from '../coordinator/eventBus';
import { createLogger } from '../utils/logger';
import type { DAGNode } from '../types/task';
import type { Job } from './jobStore';

const logger = createLogger({ component: 'task-queue' });

export interface DAGJobPayload {
  taskId: string;
  dag: DAGNode[];
  correlationId?: string;
}

export interface QueueStatus {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  dlqDepth: number;
  workerCount: number;
}

export type DAGJobHandler = (
  job: Job<DAGJobPayload>,
  updateProgress: (pct: number) => void
) => Promise<void>;

export class TaskQueue {
  private readonly queue: JobQueue;
  private readonly worker: JobWorker;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private _handler: DAGJobHandler;

  constructor(options?: {
    concurrency?: number;
    maxRetries?: number;
    baseBackoffMs?: number;
    /** Inject a custom JobStore (e.g. in-memory SQLite for tests). */
    store?: JobStore;
  }) {
    this.concurrency = options?.concurrency ?? Number(process.env.QUEUE_CONCURRENCY ?? '3');
    this.maxRetries = options?.maxRetries ?? Number(process.env.QUEUE_MAX_RETRIES ?? '3');
    const baseBackoffMs = options?.baseBackoffMs ?? 1000;

    // Default no-op handler; replace via setHandler() before use.
    this._handler = async (job) => {
      logger.debug({ jobId: job.id, taskId: job.taskId }, 'DAG job placeholder handler called');
    };

    const store = options?.store ?? createJobStore(getJobDb());
    this.queue = createJobQueue(store);

    this.worker = new JobWorker({
      jobStore: store,
      handler: (job, updateProgress) => this._handler(job as Job<DAGJobPayload>, updateProgress),
      concurrency: this.concurrency,
      baseBackoffMs,
      maxAttempts: this.maxRetries,
      autoStart: true,
    });

    // Wire worker callbacks to EventBus for WebSocket propagation.
    this.worker.onJobProgress = (job, progress) => {
      eventBus.emit(job.taskId, {
        type: 'node_started',
        taskId: job.taskId,
        nodeId: `queue-progress-${job.id}`,
        timestamp: new Date().toISOString(),
        payload: { progress },
        seq: 0,
      });
    };

    this.worker.onJobCompleted = (job) => {
      eventBus.emit(job.taskId, {
        type: 'task_completed',
        taskId: job.taskId,
        nodeId: '',
        timestamp: new Date().toISOString(),
        payload: { jobId: job.id },
        seq: 0,
      });
    };

    this.worker.onJobFailed = (job, error, willRetry) => {
      if (!willRetry) {
        eventBus.emit(job.taskId, {
          type: 'task_failed',
          taskId: job.taskId,
          nodeId: '',
          timestamp: new Date().toISOString(),
          payload: { error: error.message, jobId: job.id },
          seq: 0,
        });
      }
    };

    this.worker.onJobDeadLetter = (job, error) => {
      logger.error(
        { jobId: job.id, taskId: job.taskId, error: error.message },
        'DAG job moved to dead-letter queue',
      );
      eventBus.emit(job.taskId, {
        type: 'task_failed',
        taskId: job.taskId,
        nodeId: '',
        timestamp: new Date().toISOString(),
        payload: { error: error.message, jobId: job.id, deadLetter: true },
        seq: 0,
      });
    };

    this.queue.setWorker(this.worker);

    logger.info({ concurrency: this.concurrency, maxRetries: this.maxRetries }, 'TaskQueue initialised');
  }

  /**
   * Enqueue a DAG for asynchronous execution.
   * Returns immediately with the job ID.
   */
  enqueueDAG(taskId: string, dag: DAGNode[], correlationId?: string): string {
    const payload: DAGJobPayload = { taskId, dag, correlationId };
    const job = this.queue.enqueue<DAGJobPayload>({
      taskId,
      type: 'execute_dag',
      payload,
      maxAttempts: this.maxRetries,
    });
    logger.info({ jobId: job.id, taskId, dagSize: dag.length }, 'DAG enqueued');
    return job.id;
  }

  /** Current queue depth and worker statistics. */
  getStatus(): QueueStatus {
    const stats = this.queue.getStats();
    return {
      waiting: stats.pending,
      active: stats.active,
      completed: stats.completed,
      failed: stats.failed,
      dlqDepth: stats.deadLetter,
      workerCount: this.concurrency,
    };
  }

  /**
   * Graceful shutdown — signals the worker to stop accepting new jobs and
   * waits for the currently executing job to finish.
   */
  async shutdown(timeoutMs = 30_000): Promise<void> {
    logger.info('TaskQueue shutdown initiated');
    await this.worker.stop(timeoutMs);
    logger.info('TaskQueue shutdown complete');
  }

  /**
   * Replace the default no-op handler with a real execution function.
   * Must be called before any jobs are dequeued.
   */
  setHandler(handler: DAGJobHandler): void {
    this._handler = handler;
  }

  /** Expose the underlying JobQueue for testing or advanced use. */
  getQueue(): JobQueue {
    return this.queue;
  }

  /** Expose the underlying JobWorker for testing or advanced use. */
  getWorker(): JobWorker {
    return this.worker;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _globalTaskQueue: TaskQueue | null = null;

export function getGlobalTaskQueue(): TaskQueue {
  if (!_globalTaskQueue) {
    _globalTaskQueue = new TaskQueue();
  }
  return _globalTaskQueue;
}

export function setGlobalTaskQueue(queue: TaskQueue): void {
  _globalTaskQueue = queue;
}
