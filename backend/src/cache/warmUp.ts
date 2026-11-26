/**
 * Result cache warm-up on server startup.
 *
 * Queries the last 100 completed tasks from the past 24 hours and
 * pre-populates the result cache with their node outputs so the first
 * requests after a restart get cache hits instead of cold-starting Venice AI.
 *
 * Only caches results with confidence >= 0.5 (delegated to ResultCache.set).
 *
 * Issue #723
 */

import { resultCache, ResultCache } from './resultCache';
import { createLogger } from '../utils/logger';

const logger = createLogger({ component: 'cache-warm-up' });

/** How far back to look for recently completed tasks (ms). */
const LOOKBACK_MS = 24 * 60 * 60 * 1_000;

export async function warmUpResultCache(): Promise<void> {
  try {
    // Lazy-require to avoid a hard dependency at module-load time
    const { getTaskDb } = require('../db/tasks') as typeof import('../db/tasks');
    const db = getTaskDb();

    const cutoff = new Date(Date.now() - LOOKBACK_MS).toISOString();

    const rows = db
      .prepare(
        `SELECT id, dag FROM tasks
         WHERE status = 'completed' AND createdAt >= ?
         ORDER BY createdAt DESC
         LIMIT 100`,
      )
      .all(cutoff) as Array<{ id: string; dag: string }>;

    if (rows.length === 0) {
      logger.info('cache warm-up: no recent completed tasks found');
      return;
    }

    let warmed = 0;
    let skipped = 0;

    for (const row of rows) {
      let dag: Array<{ nodeId: string; type: string; prompt?: string; result?: unknown; quality?: { score: number } }>;
      try {
        dag = JSON.parse(row.dag);
      } catch {
        continue;
      }

      for (const node of dag) {
        if (!node.prompt || node.result === undefined) {
          skipped++;
          continue;
        }
        const confidence = node.quality?.score ?? 1.0;
        const cacheKey = ResultCache.generateKey(node.prompt, [node.type]);
        await resultCache.set(cacheKey, {
          output: node.result,
          confidence,
          agentType: node.type,
          producedAt: new Date().toISOString(),
        });
        warmed++;
      }
    }

    logger.info({ tasksScanned: rows.length, nodesWarmed: warmed, nodesSkipped: skipped }, 'result cache warm-up complete');
  } catch (err) {
    // Warm-up is best-effort — a failure must never prevent the server from starting
    logger.warn({ err }, 'result cache warm-up failed — continuing without warm cache');
  }
}
