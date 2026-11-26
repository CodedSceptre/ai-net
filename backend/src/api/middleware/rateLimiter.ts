/**
 * rateLimiter.ts — Two-tier rate limiting middleware
 *
 * Tier 1: IP-based — 100 requests/minute/IP (global protection)
 * Tier 2: Wallet-based — 50 task submissions/wallet/UTC calendar day
 *
 * Since Redis is not a hard dependency, quota state is stored in an LRU cache.
 * In horizontally scaled deployments, replace the LRU store with a Redis INCR
 * implementation using the same key scheme:
 *   quota:wallet:<walletPublicKey>:tasks:<YYYY-MM-DD>
 */

import { LRUCache } from 'lru-cache';
import type { Request, Response, NextFunction } from 'express';

// ── Constants ─────────────────────────────────────────────────────────────────

export const IP_LIMIT = 100;          // requests per minute
export const IP_WINDOW_MS = 60_000;   // 1 minute
export const WALLET_DAILY_LIMIT = 50; // task submissions per UTC day

// ── IP rate limit store ───────────────────────────────────────────────────────

interface IPWindow {
  timestamps: number[];
}

const ipCache = new LRUCache<string, IPWindow>({
  max: 10_000,
  ttl: IP_WINDOW_MS,
  updateAgeOnGet: false,
});

/** Seconds remaining until next UTC midnight from now */
export function secondsUntilUtcMidnight(): number {
  const now = new Date();
  const midnight = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0, 0, 0, 0,
  ));
  return Math.ceil((midnight.getTime() - now.getTime()) / 1000);
}

/** Format today's UTC date as YYYY-MM-DD */
function utcDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Wallet quota store ────────────────────────────────────────────────────────

interface WalletQuota {
  count: number;
  date: string; // YYYY-MM-DD UTC
}

// TTL slightly over 24h so the entry definitely expires; actual reset is by
// checking the date field, not the LRU TTL.
const walletCache = new LRUCache<string, WalletQuota>({
  max: 50_000,
  ttl: 25 * 60 * 60 * 1000, // 25 hours
  updateAgeOnGet: false,
});

/**
 * Increment the wallet's daily submission counter.
 * Returns { count, remaining, resetAt }.
 */
export function incrementWalletQuota(walletPublicKey: string): {
  count: number;
  remaining: number;
  resetAt: string;
} {
  const today = utcDateString();
  const key = `quota:wallet:${walletPublicKey}:tasks:${today}`;

  let quota = walletCache.get(key);
  if (!quota || quota.date !== today) {
    quota = { count: 0, date: today };
  }

  quota.count += 1;
  walletCache.set(key, quota);

  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);

  return {
    count: quota.count,
    remaining: Math.max(0, WALLET_DAILY_LIMIT - quota.count),
    resetAt: midnight.toISOString(),
  };
}

/**
 * Get current quota without incrementing.
 */
export function getWalletQuota(walletPublicKey: string): {
  count: number;
  remaining: number;
  resetAt: string;
} {
  const today = utcDateString();
  const key = `quota:wallet:${walletPublicKey}:tasks:${today}`;
  const quota = walletCache.get(key);

  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  const resetAt = midnight.toISOString();

  if (!quota || quota.date !== today) {
    return { count: 0, remaining: WALLET_DAILY_LIMIT, resetAt };
  }

  return {
    count: quota.count,
    remaining: Math.max(0, WALLET_DAILY_LIMIT - quota.count),
    resetAt,
  };
}

/**
 * Reset the wallet quota (admin use).
 */
export function resetWalletQuota(walletPublicKey: string): void {
  const today = utcDateString();
  const key = `quota:wallet:${walletPublicKey}:tasks:${today}`;
  walletCache.delete(key);
}

// ── IP rate limit middleware ───────────────────────────────────────────────────

/**
 * Tier 1: 100 requests/minute/IP applied globally.
 */
export function createIpRateLimitMiddleware(opts: {
  maxRequests?: number;
  windowMs?: number;
} = {}) {
  const maxRequests = opts.maxRequests ?? IP_LIMIT;
  const windowMs = opts.windowMs ?? IP_WINDOW_MS;

  return function ipRateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip ?? 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    let win = ipCache.get(ip) ?? { timestamps: [] };
    win.timestamps = win.timestamps.filter(t => t > cutoff);

    if (win.timestamps.length >= maxRequests) {
      const oldest = win.timestamps[0];
      const resetAtMs = oldest !== undefined ? oldest + windowMs : now + windowMs;
      const retryAfter = Math.ceil((resetAtMs - now) / 1000);

      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Limit', String(maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAtMs / 1000)));
      res.status(429).json({
        error: 'Too many requests',
        code: 'RATE_LIMITED',
      });
      return;
    }

    win.timestamps.push(now);
    ipCache.set(ip, win);

    const oldest = win.timestamps[0];
    const resetAtMs = oldest !== undefined ? oldest + windowMs : now + windowMs;
    res.setHeader('X-RateLimit-Limit', String(maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(maxRequests - win.timestamps.length));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(resetAtMs / 1000)));

    next();
  };
}

// ── Wallet quota middleware ───────────────────────────────────────────────────

/**
 * Tier 2: 50 task submissions/wallet/UTC day.
 * Reads wallet from X-Wallet-Public-Key header.
 * Skips if header is absent (non-authenticated requests).
 */
export function createWalletQuotaMiddleware(opts: {
  dailyLimit?: number;
} = {}) {
  const dailyLimit = opts.dailyLimit ?? WALLET_DAILY_LIMIT;

  return function walletQuotaMiddleware(req: Request, res: Response, next: NextFunction): void {
    const walletPublicKey = req.headers['x-wallet-public-key'] as string | undefined;

    // No wallet header — skip quota check
    if (!walletPublicKey || walletPublicKey.trim() === '') {
      return next();
    }

    const { count, remaining, resetAt } = incrementWalletQuota(walletPublicKey.trim());

    if (count > dailyLimit) {
      // Decrement back (we incremented optimistically)
      const today = utcDateString();
      const key = `quota:wallet:${walletPublicKey.trim()}:tasks:${today}`;
      const quota = walletCache.get(key);
      if (quota) {
        quota.count = Math.max(0, quota.count - 1);
        walletCache.set(key, quota);
      }

      const retryAfter = secondsUntilUtcMidnight();
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'QUOTA_EXCEEDED',
        remaining: 0,
        resetAt,
      });
      return;
    }

    // Attach remaining to res.locals for the route handler to include in response
    res.locals.quotaRemaining = remaining;
    res.setHeader('X-Quota-Remaining', String(remaining));

    next();
  };
}

// ── Singleton instances ───────────────────────────────────────────────────────

export const ipRateLimitMiddleware = createIpRateLimitMiddleware();
export const walletQuotaMiddleware = createWalletQuotaMiddleware();
