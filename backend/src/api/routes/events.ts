/**
 * GET /api/events — query indexed Soroban contract events.
 *
 * Query parameters:
 *   contract  — filter by Soroban contract ID
 *   type      — filter by event type (e.g. "registry:agent_reg")
 *   from      — ISO-8601 lower bound on occurred_at (inclusive)
 *   to        — ISO-8601 upper bound on occurred_at (inclusive)
 *   limit     — max records per page (1–200, default 50)
 *   offset    — pagination offset (default 0)
 */

import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { createEventsDb, getEventsDb } from "../../db/contractEvents";
import { getEventIndexer } from "../../services/eventIndexer";
import { ValidationError } from "../../errors";

const QuerySchema = z.object({
  contract: z.string().optional(),
  type: z.string().optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function createEventsRouter(): Router {
  const router = Router();

  /**
   * @openapi
   * /api/events:
   *   get:
   *     summary: Query indexed Soroban contract events
   *     operationId: listContractEvents
   *     tags:
   *       - Events
   *     parameters:
   *       - in: query
   *         name: contract
   *         schema:
   *           type: string
   *         description: Filter by Soroban contract ID
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *         description: Filter by event type (e.g. "registry:agent_reg")
   *       - in: query
   *         name: from
   *         schema:
   *           type: string
   *           format: date-time
   *         description: ISO-8601 lower bound (inclusive) on occurred_at
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *           format: date-time
   *         description: ISO-8601 upper bound (inclusive) on occurred_at
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 200
   *           default: 50
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           minimum: 0
   *           default: 0
   *     responses:
   *       200:
   *         description: Paginated list of contract events
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 events:
   *                   type: array
   *                   items:
   *                     $ref: '#/components/schemas/ContractEvent'
   *                 total:
   *                   type: integer
   *                 limit:
   *                   type: integer
   *                 offset:
   *                   type: integer
   *       400:
   *         description: Invalid query parameters
   */
  router.get("/", (req: Request, res: Response, next: NextFunction) => {
    const parsed = QuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return next(new ValidationError(parsed.error.message));
    }

    const { contract, type, from, to, limit, offset } = parsed.data;

    try {
      const db = createEventsDb(getEventsDb());
      const events = db.query({
        contractId: contract,
        eventType: type,
        from,
        to,
        limit,
        offset,
      });
      const total = db.count({
        contractId: contract,
        eventType: type,
        from,
        to,
      });

      return res.json({ events, total, limit, offset });
    } catch (err) {
      return next(err);
    }
  });

  /**
   * @openapi
   * /api/events/status:
   *   get:
   *     summary: Return the event indexer status
   *     operationId: getEventIndexerStatus
   *     tags:
   *       - Events
   *     responses:
   *       200:
   *         description: Indexer status
   */
  router.get("/status", (_req: Request, res: Response) => {
    try {
      const status = getEventIndexer().status();
      return res.json(status);
    } catch {
      return res.json({
        running: false,
        lastIndexedLedger: 0,
        eventsIndexed: 0,
        lastPollAt: null,
        lastError: "Indexer not initialised",
      });
    }
  });

  return router;
}
