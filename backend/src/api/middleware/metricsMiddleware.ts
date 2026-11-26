import type { Request, Response, NextFunction } from 'express';
import { recordApiRequest } from '../../utils/metrics';
import { metricsService } from '../../services/metrics';

/**
 * Normalizes a raw URL path to a low-cardinality route pattern.
 * Replaces UUIDs, alphanumeric prefixed IDs (task_*, agent_*), and numeric IDs with ':id'.
 */
export function normalizeRoute(path: string): string {
  if (!path) return '/';
  const cleanPath = path.split('?')[0] || '/';
  return cleanPath
    // Replace standard UUIDs (8-4-4-4-12 hex)
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    // Replace prefixed IDs such as task_123 or agent_abc
    .replace(/\/(?:task|agent|job|session)_[a-zA-Z0-9_-]+/gi, '/:id')
    // Replace Stellar account public keys (56 chars starting with G)
    .replace(/\/G[A-Z0-9]{55}/g, '/:id')
    // Replace numeric IDs
    .replace(/\/\d+/g, '/:id')
    // Collapse consecutive slashes
    .replace(/\/+/g, '/');
}

/**
 * Express middleware that starts a high-resolution timer and records
 * `api_requests_total` and `api_response_duration_ms` when the response finishes.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - start;
    const durationMs = Number(durationNs) / 1_000_000;

    let routePattern: string;
    if (req.route && typeof req.route.path === 'string') {
      const base = req.baseUrl || '';
      routePattern = normalizeRoute(`${base}${req.route.path}`);
    } else {
      const rawPath = req.baseUrl ? `${req.baseUrl}${req.path}` : (req.path || req.originalUrl || '/');
      routePattern = normalizeRoute(rawPath);
    }

    const method = req.method ? req.method.toUpperCase() : 'GET';
    const statusCode = res.statusCode || 200;

    // Record to Prometheus registry
    recordApiRequest(method, routePattern, statusCode, durationMs);

    // Also record to internal MetricsService for backward compatibility
    try {
      metricsService.recordRequest(durationMs, statusCode, method, routePattern);
    } catch {
      // Ignore if metricsService is not initialized
    }
  });

  next();
}
