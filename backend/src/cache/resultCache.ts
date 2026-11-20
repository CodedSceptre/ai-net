/**
 * Content-addressable result cache for agent task outputs.
 *
 * Cache keys are derived as SHA-256(prompt + sorted_capabilities) so identical
 * requests always resolve to the same key. Results are stored in Redis (when
 * CACHE_DRIVER=redis) or the in-process LRU cache, with a configurable TTL
 * (default 1 hour via RESULT_CACHE_TTL_SECONDS).
 *
 * Results with confidence < 0.5 are never written to the cache.
 * Requests carrying the header `X-Cache-Control: no-cache` bypass both read
 * and write.
 *
 * Issue #723
 */

import { createHash } from 'crypto';
import { getCacheClient } from './index';
import { createLogger } from '../utils/logger';

const logger = createLogger({ component: 'result-cache' });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgentResult {
  /** Raw output returned by the agent. */
  output: unknown;
  /** Confidence score in [0, 1]. Results below 0.5 are never cached. */
  confidence: number;
  /** Agent type that produced the result. */
  agentType?: string;
  /** ISO timestamp when the result was produced. */
  producedAt?: string;
}

// ─── Prometheus-style counters ────────────────────────────────────────────────

let _hits = 0;
let _misses = 0;

export function getResultCacheMetrics(): { hits: number; misses: number } {
  return { hits: _hits, misses: _misses };
}

/** Reset counters — test teardown only. */
export function resetResultCacheMetrics(): void {
  _hits = 0;
  _misses = 0;
}

// ─── Cache key prefix ─────────────────────────────────────────────────────────

const KEY_PREFIX = 'result:';

// ─── ResultCache class ────────────────────────────────────────────────────────

export class ResultCache {
  private readonly defaultTtlSeconds: number;

  constructor(defaultTtlSeconds?: number) {
    this.defaultTtlSeconds =
      defaultTtlSeconds ??
      (process.env.RESULT_CACHE_TTL_SECONDS
        ? parseInt(process.env.RESULT_CACHE_TTL_SECONDS, 10)
        : 3_600);
  }

  /**
   * Derive a deterministic cache key from prompt and capabilities.
   *
   * SHA-256(prompt + sorted_capabilities.join(','))
   */
  static generateKey(prompt: string, capabilities: string[]): string {
    const sorted = [...capabilities].sort().join(',');
    return createHash('sha256')
      .update(prompt + sorted)
      .digest('hex');
  }

  /**
   * Fetch a cached result by key.
   * Returns null on miss or when the entry has expired.
   */
  async get(key: string): Promise<AgentResult | null> {
    try {
      const raw = await getCacheClient().get(`${KEY_PREFIX}${key}`);
      if (raw === undefined) {
        _misses++;
        return null;
      }
      _hits++;
      return JSON.parse(raw) as AgentResult;
    } catch (err) {
      logger.warn({ err, key }, 'result cache get failed');
      _misses++;
      return null;
    }
  }

  /**
   * Store a result. Never caches results with confidence < 0.5.
   *
   * @param key         - Cache key from generateKey()
   * @param result      - AgentResult to store
   * @param ttlSeconds  - Per-entry TTL override; falls back to defaultTtlSeconds
   */
  async set(key: string, result: AgentResult, ttlSeconds?: number): Promise<void> {
    if (result.confidence < 0.5) {
      logger.debug({ key, confidence: result.confidence }, 'skipping cache write — low confidence');
      return;
    }
    const ttl = ttlSeconds ?? this.defaultTtlSeconds;
    try {
      await getCacheClient().set(`${KEY_PREFIX}${key}`, JSON.stringify(result), ttl);
      logger.debug({ key, ttl }, 'result cached');
    } catch (err) {
      logger.warn({ err, key }, 'result cache set failed');
    }
  }

  /**
   * Delete a specific cache entry.
   */
  async invalidate(key: string): Promise<void> {
    try {
      await getCacheClient().del(`${KEY_PREFIX}${key}`);
      logger.debug({ key }, 'result cache entry invalidated');
    } catch (err) {
      logger.warn({ err, key }, 'result cache invalidate failed');
    }
  }

  /**
   * Delete all cache entries matching a glob pattern.
   * The pattern is matched against the full stored key (including the
   * `result:` prefix), so pass `result:*` to clear all result entries.
   */
  async invalidateByPattern(pattern: string): Promise<void> {
    try {
      await getCacheClient().delByPattern(pattern);
      logger.debug({ pattern }, 'result cache entries invalidated by pattern');
    } catch (err) {
      logger.warn({ err, pattern }, 'result cache invalidateByPattern failed');
    }
  }
}

/** Singleton — import this across the app. */
export const resultCache = new ResultCache();
