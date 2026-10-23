/**
 * Idempotency middleware — intercepts POST requests carrying an
 * `Idempotency-Key` header and either replays a cached response or captures
 * the outgoing response for future replays.
 *
 * ## Usage
 *
 * ```ts
 * import { idempotencyMiddleware } from './middleware/idempotency';
 *
 * router.post('/', idempotencyMiddleware, handler);
 * ```
 *
 * The middleware reads a UUID v4 `Idempotency-Key` from the request headers
 * (case-insensitive). Keys are scoped to the wallet in the request body or
 * wallet header. When present:
 *
 * 1. It queries the idempotency store for a matching key.
 * 2. If found **and not expired**, the stored response is replayed and the
 *    handler is never called.
 * 3. If not found, the middleware monkey-patches `res.json()` to capture the
 *    response body, then calls `next()`.  After the handler writes its
 *    response the captured body is persisted to the store.
 *
 * ## Key format
 *
 * UUID v4 is required. Requests without the header remain backward compatible.
 */

import { Request, Response, NextFunction } from 'express';
import type { IdempotencyStore } from '../../services/idempotency';
import { getDefaultIdempotencyStore } from '../../services/idempotency';
import { createLogger } from '../../utils/logger';

const log = createLogger({ component: 'idempotency-middleware' });

/**
 * Create an idempotency middleware bound to a specific store.
 *
 * @param store  Optional store instance.  When omitted the default singleton
 *               is used.
 */
export function createIdempotencyMiddleware(store?: IdempotencyStore) {
  return function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const key = req.get('Idempotency-Key');

    // No key → pass through transparently.
    if (key === undefined) {
      return next();
    }

    const trimmedKey = key.trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmedKey)) {
      res.status(400).json({
        error: {
          message: 'Idempotency-Key must be a UUID v4',
          code: 'INVALID_IDEMPOTENCY_KEY',
        },
      });
      return;
    }

    const walletAddress =
      (typeof req.body?.walletAddress === 'string' && req.body.walletAddress) ||
      (typeof req.body?.walletPublicKey === 'string' && req.body.walletPublicKey) ||
      req.get('X-Wallet-Address') ||
      req.get('walletpublickey') ||
      'anonymous';
    const resolvedStore = store ?? getDefaultIdempotencyStore();

    // ── Lookup ─────────────────────────────────────────────────────────────
    const existing = resolvedStore.get(trimmedKey, walletAddress);
    if (existing) {
      log.debug({ key: trimmedKey }, 'replaying idempotent response');
      res.setHeader('X-Idempotency-Replay', 'true');
      res.status(existing.statusCode);
      try {
        const body = JSON.parse(existing.responseBody);
        res.json(body);
      } catch {
        // Fallback: send raw string if JSON parsing fails.
        res.status(existing.statusCode).send(existing.responseBody);
      }
      return;
    }

    // ── Capture ────────────────────────────────────────────────────────────
    // Intercept res.json() to capture the outgoing body, then persist.
    const originalJson = res.json.bind(res);
    let capturedBody: unknown = undefined;

    res.json = function patchedJson(body: unknown): Response {
      capturedBody = body;

      // Persist after the response has been sent so we capture the final shape.
      res.on('finish', () => {
        try {
          // Only store successful (2xx/3xx) responses; errors are not
          // idempotent-safe to replay (e.g. transient 500s).
          const status = res.statusCode;
          if (status >= 200 && status < 400) {
            resolvedStore.storeResponse(trimmedKey, status, capturedBody, walletAddress);
          }
        } catch (err) {
          log.error({ err, key: trimmedKey }, 'failed to store idempotent response');
        }
      });

      return originalJson(body);
    };

    next();
  };
}

/**
 * Convenience middleware using the default singleton store.
 * Suitable for most production usages where a single store suffices.
 */
export const idempotencyMiddleware = createIdempotencyMiddleware();
