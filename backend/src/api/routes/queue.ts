/**
 * Queue status route — GET /api/queue/status
 *
 * Returns current job queue depths and worker count so operators can
 * monitor backlog growth and confirm workers are running.
 */

import { Router, Request, Response } from 'express';
import { getGlobalTaskQueue } from '../../queue/taskQueue';
import { createLogger } from '../../utils/logger';

const router = Router();
const logger = createLogger({ component: 'queue-route' });

/**
 * @openapi
 * /api/queue/status:
 *   get:
 *     summary: Queue depth and worker status
 *     operationId: getQueueStatus
 *     description: >
 *       Returns the number of jobs in each state (waiting, active, completed,
 *       failed, dead-letter) and the number of configured worker slots.
 *       Use this to monitor backlog growth and confirm workers are running.
 *     tags: [Queue]
 *     security: []
 *     responses:
 *       200:
 *         description: Queue status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required: [waiting, active, completed, failed, dlqDepth, workerCount]
 *               properties:
 *                 waiting:
 *                   type: integer
 *                   description: Jobs queued and waiting for a worker slot
 *                   example: 3
 *                 active:
 *                   type: integer
 *                   description: Jobs currently executing
 *                   example: 2
 *                 completed:
 *                   type: integer
 *                   description: Jobs that finished successfully
 *                   example: 142
 *                 failed:
 *                   type: integer
 *                   description: Jobs that failed but have retries remaining
 *                   example: 1
 *                 dlqDepth:
 *                   type: integer
 *                   description: Jobs in the dead-letter queue (retries exhausted)
 *                   example: 0
 *                 workerCount:
 *                   type: integer
 *                   description: Configured maximum concurrent worker slots
 *                   example: 3
 */
router.get('/status', (_req: Request, res: Response) => {
  try {
    const taskQueue = getGlobalTaskQueue();
    const status = taskQueue.getStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err }, 'Failed to retrieve queue status');
    res.status(500).json({ error: 'Failed to retrieve queue status' });
  }
});

export { router as queueRouter };
export default router;
