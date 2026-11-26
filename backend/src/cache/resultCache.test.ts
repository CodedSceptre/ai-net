/**
 * Unit tests for ResultCache — Issue #723
 */

import { ResultCache, resetResultCacheMetrics, getResultCacheMetrics } from './resultCache';
import { LRUCacheClient, setCacheClient, resetCache } from './index';
import type { AgentResult } from './resultCache';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    output: { text: 'hello world' },
    confidence: 0.9,
    agentType: 'research',
    producedAt: new Date().toISOString(),
    ...overrides,
  };
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  setCacheClient(new LRUCacheClient(500, 60_000));
  resetResultCacheMetrics();
});

afterEach(() => {
  resetCache();
});

// ─── Key generation ───────────────────────────────────────────────────────────

describe('ResultCache.generateKey', () => {
  it('produces the same key for identical prompt + capabilities', () => {
    const a = ResultCache.generateKey('hello', ['coding', 'research']);
    const b = ResultCache.generateKey('hello', ['coding', 'research']);
    expect(a).toBe(b);
  });

  it('sorts capabilities before hashing — order does not matter', () => {
    const a = ResultCache.generateKey('hello', ['research', 'coding']);
    const b = ResultCache.generateKey('hello', ['coding', 'research']);
    expect(a).toBe(b);
  });

  it('produces different keys for different prompts', () => {
    const a = ResultCache.generateKey('prompt A', ['research']);
    const b = ResultCache.generateKey('prompt B', ['research']);
    expect(a).not.toBe(b);
  });

  it('produces different keys for different capabilities', () => {
    const a = ResultCache.generateKey('same', ['research']);
    const b = ResultCache.generateKey('same', ['coding']);
    expect(a).not.toBe(b);
  });

  it('key is a 64-character hex string (SHA-256)', () => {
    const key = ResultCache.generateKey('test', ['cap']);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── Cache hit / miss ─────────────────────────────────────────────────────────

describe('ResultCache get/set', () => {
  it('returns null on a miss', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('miss prompt', ['research']);
    const result = await cache.get(key);
    expect(result).toBeNull();
  });

  it('returns the stored result on a hit', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('hit prompt', ['research']);
    const stored = makeResult();
    await cache.set(key, stored);
    const retrieved = await cache.get(key);
    expect(retrieved).toEqual(stored);
  });

  it('increments hits counter on a cache hit', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('counter hit', ['coding']);
    await cache.set(key, makeResult());
    await cache.get(key);
    expect(getResultCacheMetrics().hits).toBe(1);
    expect(getResultCacheMetrics().misses).toBe(0);
  });

  it('increments misses counter on a cache miss', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('counter miss', ['coding']);
    await cache.get(key);
    expect(getResultCacheMetrics().misses).toBe(1);
    expect(getResultCacheMetrics().hits).toBe(0);
  });
});

// ─── Low-confidence no-cache ──────────────────────────────────────────────────

describe('low confidence threshold', () => {
  it('does not cache a result with confidence < 0.5', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('low confidence', ['research']);
    await cache.set(key, makeResult({ confidence: 0.4 }));
    const result = await cache.get(key);
    expect(result).toBeNull();
  });

  it('does not cache a result with confidence exactly 0.49', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('borderline', ['research']);
    await cache.set(key, makeResult({ confidence: 0.49 }));
    expect(await cache.get(key)).toBeNull();
  });

  it('caches a result with confidence exactly 0.5', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('exactly 0.5', ['research']);
    const stored = makeResult({ confidence: 0.5 });
    await cache.set(key, stored);
    expect(await cache.get(key)).toEqual(stored);
  });
});

// ─── TTL expiry (mocked) ──────────────────────────────────────────────────────

describe('TTL expiry', () => {
  it('returns null after TTL expires (1-second TTL, mocked time)', async () => {
    jest.useFakeTimers();
    // Create a fresh LRU cache with 1-second TTL
    const shortTtlClient = new LRUCacheClient(500, 1_000);
    setCacheClient(shortTtlClient);

    const cache = new ResultCache(1); // 1 second TTL
    const key = ResultCache.generateKey('expire test', ['coding']);
    await cache.set(key, makeResult(), 1);

    // Entry is present immediately
    expect(await cache.get(key)).not.toBeNull();

    // Advance time past TTL
    jest.advanceTimersByTime(1_500);

    // LRU-cache respects TTL on get after time advance
    expect(await cache.get(key)).toBeNull();

    jest.useRealTimers();
  });
});

// ─── Invalidation ─────────────────────────────────────────────────────────────

describe('invalidate', () => {
  it('removes a specific cache entry', async () => {
    const cache = new ResultCache(3600);
    const key = ResultCache.generateKey('invalidate me', ['research']);
    await cache.set(key, makeResult());
    await cache.invalidate(key);
    expect(await cache.get(key)).toBeNull();
  });

  it('leaves other entries unaffected', async () => {
    const cache = new ResultCache(3600);
    const key1 = ResultCache.generateKey('keep me', ['research']);
    const key2 = ResultCache.generateKey('remove me', ['coding']);
    const result1 = makeResult({ output: 'keep' });
    await cache.set(key1, result1);
    await cache.set(key2, makeResult({ output: 'remove' }));
    await cache.invalidate(key2);
    expect(await cache.get(key1)).toEqual(result1);
    expect(await cache.get(key2)).toBeNull();
  });
});
