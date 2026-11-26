/**
 * idempotencyStore.ts — Thin Redis-shaped interface over the in-memory
 * IdempotencyStore. Provides the INCR + TTL semantics described in the issue
 * using the existing SQLite-backed implementation.
 *
 * In a horizontally-scaled deployment, replace this module with a real Redis
 * client using INCR + EXPIREAT.
 *
 * Key scheme: idempotency:<walletPublicKey>:<idempotencyKey>
 */

import { getDefaultIdempotencyStore } from '../../services/idempotency';
import type { IdempotencyStore } from '../../services/idempotency';

export interface IdempotencyCache {
  get(key: string): { statusCode: number; body: string; headers?: Record<string, string> } | null;
  set(key: string, statusCode: number, body: unknown, ttlSeconds?: number): void;
  delete(key: string): void;
}

class InMemoryIdempotencyCache implements IdempotencyCache {
  private store: IdempotencyStore;

  constructor(store?: IdempotencyStore) {
    this.store = store ?? getDefaultIdempotencyStore();
  }

  get(key: string): { statusCode: number; body: string } | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    return { statusCode: entry.statusCode, body: entry.responseBody };
  }

  set(key: string, statusCode: number, body: unknown, _ttlSeconds?: number): void {
    this.store.storeResponse(key, statusCode, body);
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

let _instance: IdempotencyCache | null = null;

/**
 * Get or create the default singleton IdempotencyCache.
 * Lazily initialised on first call.
 */
export function getIdempotencyCache(): IdempotencyCache {
  if (!_instance) {
    _instance = new InMemoryIdempotencyCache();
  }
  return _instance;
}

/** Reset the singleton — only for test teardown. */
export function resetIdempotencyCache(): void {
  _instance = null;
}
