/**
 * Express middleware that instruments HTTP requests with prom-client metrics.
 *
 * Records api_requests_total and api_response_duration_ms after each response.
 * Routes are normalised to path patterns before being used as label values to
 * avoid high-cardinality label explosion from UUIDs, numeric IDs, and
 * task-prefixed slugs.
 */
import type { Request, Response, NextFunction } from 'express';
import { apiRequestsTotal, apiResponseDurationMs } from '../../utils/metrics';

/**
 * Replace dynamic path segments with parameter placeholders.
 *
 * Examples:
 *   /api/tasks/task_abc123           → /api/tasks/:taskId
 *   /api/agents/G1ABC.../heartbeat   → /api/agents/:id/heartbeat
 *   /api/users/42/profile            → /api/users/:id/profile
 */
function normalizeRoute(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/task_[a-z0-9_-]+/gi, '/:taskId')
    .replace(/\/[0-9]+/g, '/:id');
}

export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const route = normalizeRoute(req.path ?? '/');
    const method = req.method ?? 'UNKNOWN';
    const statusCode = String(res.statusCode);

    apiRequestsTotal.inc({ method, route, status_code: statusCode });
    apiResponseDurationMs.observe({ route }, durationMs);
  });

  next();
}
