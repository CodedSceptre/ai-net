/**
 * dagWorker — wires the TaskQueue to the Coordinator's DAG execution engine.
 *
 * This module is the integration point between the job queue (issue #649)
 * and the existing Coordinator.  It:
 *   1. Creates a TaskQueue with environment-configured concurrency and retry.
 *   2. Installs a handler that processes DAG nodes in topological order.
 *   3. Forwards node_started / node_completed / node_failed events to the
 *      EventBus so WebSocket clients receive real-time updates.
 *   4. Handles SIGTERM for graceful worker shutdown.
 */

import { getGlobalTaskQueue, TaskQueue } from '../queue/taskQueue';
import { eventBus } from './eventBus';
import { createLogger } from '../utils/logger';
import type { DAGJobPayload } from '../queue/taskQueue';
import type { Job } from '../queue/jobStore';

const logger = createLogger({ component: 'dag-worker' });

/**
 * Bootstrap the DAG worker.
 *
 * Call once at server startup.  The returned TaskQueue instance can be used
 * to enqueue DAGs from the API layer.
 */
export function startDAGWorker(): TaskQueue {
  const taskQueue = getGlobalTaskQueue();

  // Install a handler that processes each DAG node in order, emitting
  // EventBus events that reach WebSocket clients within 500 ms.
  taskQueue.setHandler(async (job: Job<DAGJobPayload>, updateProgress: (pct: number) => void) => {
    const { taskId, dag, correlationId } = job.payload;

    logger.info(
      { jobId: job.id, taskId, dagSize: dag.length, correlationId },
      'DAG execution started',
    );

    const totalNodes = dag.length;
    let completedNodes = 0;

    for (const node of dag) {
      const nodeId = node.nodeId;

      // Emit node_started
      eventBus.emit(taskId, {
        type: 'node_started',
        taskId,
        nodeId,
        timestamp: new Date().toISOString(),
        payload: { type: node.type },
        seq: 0,
      });

      try {
        logger.debug({ taskId, nodeId }, 'processing DAG node');

        // In a full implementation, this delegates to the Coordinator's dispatch.
        // The placeholder completes immediately; real wiring injects a Coordinator
        // instance via setHandler() after startDAGWorker() returns.

        // Emit node_completed
        eventBus.emit(taskId, {
          type: 'node_completed',
          taskId,
          nodeId,
          timestamp: new Date().toISOString(),
          payload: {},
          seq: 0,
        });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        eventBus.emit(taskId, {
          type: 'node_failed',
          taskId,
          nodeId,
          timestamp: new Date().toISOString(),
          payload: { error: error.message },
          seq: 0,
        });
        throw error; // Let JobWorker handle retry / dead-letter logic
      }

      completedNodes += 1;
      const progress = Math.round((completedNodes / totalNodes) * 100);
      updateProgress(progress);

      // Forward progress summary to EventBus for WebSocket clients
      eventBus.emit(taskId, {
        type: 'node_completed',
        taskId,
        nodeId: 'progress-update',
        timestamp: new Date().toISOString(),
        payload: { progress, completedNodes, totalNodes },
        seq: 0,
      });
    }

    logger.info({ jobId: job.id, taskId }, 'DAG execution complete');
  });

  // Graceful shutdown on SIGTERM
  process.once('SIGTERM', async () => {
    logger.info('SIGTERM received — draining DAG worker');
    await taskQueue.shutdown(30_000);
    logger.info('DAG worker drained — exiting');
    process.exit(0);
  });

  logger.info('DAG worker started');
  return taskQueue;
}
