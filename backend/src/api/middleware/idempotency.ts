/**
 * Idempotency middleware — enhanced with UUID v4 validation, per-wallet
 * key scoping, 5xx retry semantics, and X-Idempotent-Replayed header.
 *
 * Key scoping: <walletPublicKey>:<idempotencyKey>
 * This prevents wallet A replaying wallet B's cached response.
 *
 * ## Usage
 *
 * ```ts
 * import { idempotencyMiddleware, requireIdempotencyKey } from './middleware/idempotency';
 *
 * // Enforce UUID v4 key on creation endpoints:
 * router.post('/tasks', requireIdempotencyKey, idempotencyMiddleware, handler);
 *
 * // Optional idempotency (key accepted if present, not required):
 * router.post('/other', idempotencyMiddleware, handler);
 * ```
 *
 * The middleware reads `Idempotency-Key` from the request headers (case-
 * insensitive). When present:
 *
 * 1. It scopes the key to the wallet identified by `X-Wallet-Public-Key`.
 * 2. It queries the idempotency store for a matching scoped key.
 * 3. If found and not a 5xx response, it replays the response with
 *    `X-Idempotent-Replayed: true` and skips the handler.
 * 4. If found but the cached response is 5xx, it passes through (retry allowed).
 * 5. If not found, it monkey-patches `res.json()` to capture the response,
 *    then calls `next()`. After the handler responds, the body is persisted
 *    (only for 2xx/3xx; 4xx and 5xx are not cached).
 */

import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import type { IdempotencyStore } from '../../services/idempotency';
import { getDefaultIdempotencyStore } from '../../services/idempotency';
import { createLogger } from '../../utils/logger';

const log = createLogger({ component: 'idempotency-middleware' });

/** UUID v4 regex */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns true when value is a valid UUID v4 string.
 */
export function isValidUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value);
}

/**
 * Middleware that REQUIRES a valid UUID v4 Idempotency-Key header.
 * Returns 400 IDEMPOTENCY_KEY_REQUIRED when missing.
 * Returns 400 INVALID_IDEMPOTENCY_KEY_FORMAT when present but not UUID v4.
 *
 * Compose before idempotencyMiddleware on endpoints that mandate the header:
 *   POST /api/tasks, POST /api/agents/register, POST /api/payments/release.
 */
export function requireIdempotencyKey(req: Request, res: Response, next: NextFunction): void {
  const key = (req.headers['idempotency-key'] ?? req.get('Idempotency-Key')) as string | undefined;

  if (!key || key.trim() === '') {
    res.status(400).json({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    return;
  }

  if (!isValidUuidV4(key.trim())) {
    res.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY_FORMAT' });
    return;
  }

  next();
}

/**
 * Deterministic SHA-256 hash of the request payload, used to detect reuse of
 * an idempotency key with a different body.
 */
export function hashIdempotentPayload(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
}

/**
 * Create an idempotency middleware bound to a specific store.
 *
 * UUID v4 format is NOT enforced here (keeps backward compatibility with
 * existing tests that use arbitrary string keys). Compose `requireIdempotencyKey`
 * before this middleware on endpoints that must reject non-UUID keys.
 *
 * Per-wallet scoping is applied when `X-Wallet-Public-Key` is present.
 * Without that header the key is scoped to the `anonymous` wallet bucket.
 *
 * @param store Optional store instance. When omitted the default singleton is used.
 */
export function createIdempotencyMiddleware(store?: IdempotencyStore) {
  return function idempotencyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const rawKey = (req.headers['idempotency-key'] ?? req.get('Idempotency-Key')) as string | undefined;

    // No key → pass through transparently.
    if (!rawKey || rawKey.trim() === '') {
      return next();
    }

    const idempotencyKey = rawKey.trim();

    // Per-wallet scoping: include walletPublicKey in the store key so that
    // wallet A cannot replay wallet B's cached response.
    const walletPublicKey = (
      (req.headers['x-wallet-public-key'] as string | undefined) ??
      (req.headers['walletpublickey'] as string | undefined) ??
      (typeof req.body?.walletAddress === 'string' && req.body.walletAddress) ||
      (typeof req.body?.walletPublicKey === 'string' && req.body.walletPublicKey) ||
      req.get('X-Wallet-Address') ||
      'anonymous'
    ).trim();

    const scopedKey = `${walletPublicKey}:${idempotencyKey}`;
    const resolvedStore = store ?? getDefaultIdempotencyStore();

    // ── Lookup ────────────────────────────────────────────────────────────────
    const existing = resolvedStore.get(scopedKey);
    if (existing) {
      // 5xx cached responses: allow retry instead of replaying.
      if (existing.statusCode >= 500) {
        log.debug(
          { key: scopedKey, statusCode: existing.statusCode },
          'skipping replay of cached 5xx response',
        );
        return next();
      }

      log.debug({ key: scopedKey, statusCode: existing.statusCode }, 'replaying idempotent response');
      res.setHeader('X-Idempotent-Replayed', 'true');
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

    // ── Capture ───────────────────────────────────────────────────────────────
    // Monkey-patch res.json() to capture the outgoing body, then persist.
    const originalJson = res.json.bind(res);
    let capturedBody: unknown = undefined;

    res.json = function patchedJson(body: unknown): Response {
      capturedBody = body;

      // Persist after the response has been sent so we capture the final shape.
      res.on('finish', () => {
        try {
          const status = res.statusCode;
          // Store 2xx and 3xx only.
          // 5xx are transient — allow retries.
          // 4xx are excluded so callers can fix the request and retry freely.
          if (status >= 200 && status < 400) {
            resolvedStore.storeResponse(scopedKey, status, capturedBody);
          }
        } catch (err) {
          log.error({ err, key: scopedKey }, 'failed to store idempotent response');
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
