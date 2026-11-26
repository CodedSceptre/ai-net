import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import {
  createIpRateLimitMiddleware,
  createWalletQuotaMiddleware,
  resetWalletQuota,
  getWalletQuota,
  incrementWalletQuota,
  secondsUntilUtcMidnight,
  WALLET_DAILY_LIMIT,
  IP_LIMIT,
} from './rateLimiter';

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    ip: '127.0.0.1',
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function mockRes(): { res: Response; status: jest.Mock; json: jest.Mock; setHeader: jest.Mock; locals: Record<string, unknown> } {
  const headers: Record<string, string> = {};
  const res = {
    locals: {} as Record<string, unknown>,
    setHeader: jest.fn((key: string, value: string) => { headers[key] = value; }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    headersSent: false,
  } as unknown as Response;

  return {
    res,
    status: (res.status as unknown as jest.Mock),
    json: (res.json as unknown as jest.Mock),
    setHeader: (res.setHeader as unknown as jest.Mock),
    locals: res.locals as Record<string, unknown>,
  };
}

function mockNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

describe('secondsUntilUtcMidnight', () => {
  it('returns positive number less than 86400', () => {
    const secs = secondsUntilUtcMidnight();
    expect(secs).toBeGreaterThan(0);
    expect(secs).toBeLessThanOrEqual(86400);
  });
});

describe('IP rate limit middleware', () => {
  it('allows requests under the limit', () => {
    const middleware = createIpRateLimitMiddleware({ maxRequests: 5, windowMs: 60_000 });
    const next = mockNext();

    for (let i = 0; i < 5; i++) {
      const { res } = mockRes();
      middleware(mockReq({ ip: '1.2.3.4' }), res, next);
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  it('returns 429 on the request exceeding the limit', () => {
    const middleware = createIpRateLimitMiddleware({ maxRequests: 3, windowMs: 60_000 });
    const next = mockNext();

    for (let i = 0; i < 3; i++) {
      const { res } = mockRes();
      middleware(mockReq({ ip: '5.6.7.8' }), res, next);
    }

    const { res, status, json } = mockRes();
    middleware(mockReq({ ip: '5.6.7.8' }), res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Too many requests' }));
  });

  it('sets Retry-After header on 429', () => {
    const middleware = createIpRateLimitMiddleware({ maxRequests: 1, windowMs: 60_000 });
    const next = mockNext();

    middleware(mockReq({ ip: '9.9.9.9' }), mockRes().res, next);

    const { res, setHeader } = mockRes();
    middleware(mockReq({ ip: '9.9.9.9' }), res, next);

    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });
});

describe('wallet quota middleware', () => {
  const TEST_WALLET = 'GTEST_WALLET_PUBLIC_KEY_RATELIMITER_TEST_123';

  beforeEach(() => {
    resetWalletQuota(TEST_WALLET);
  });

  afterEach(() => {
    resetWalletQuota(TEST_WALLET);
  });

  it('allows submissions under the daily limit', () => {
    const middleware = createWalletQuotaMiddleware({ dailyLimit: 5 });
    const next = mockNext();

    for (let i = 0; i < 5; i++) {
      const { res } = mockRes();
      middleware(
        mockReq({ headers: { 'x-wallet-public-key': TEST_WALLET } }),
        res,
        next
      );
    }

    expect(next).toHaveBeenCalledTimes(5);
  });

  it('blocks the submission exceeding the daily limit with 429', () => {
    const middleware = createWalletQuotaMiddleware({ dailyLimit: 2 });
    const next = mockNext();

    for (let i = 0; i < 2; i++) {
      const { res } = mockRes();
      middleware(mockReq({ headers: { 'x-wallet-public-key': TEST_WALLET } }), res, next);
    }

    const { res, status, json, setHeader } = mockRes();
    middleware(mockReq({ headers: { 'x-wallet-public-key': TEST_WALLET } }), res, next);

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'QUOTA_EXCEEDED',
      remaining: 0,
    }));
    expect(setHeader).toHaveBeenCalledWith('Retry-After', expect.any(String));
  });

  it('includes resetAt ISO timestamp in 429 response', () => {
    const middleware = createWalletQuotaMiddleware({ dailyLimit: 0 });
    const { res, json } = mockRes();
    const next = mockNext();

    middleware(mockReq({ headers: { 'x-wallet-public-key': TEST_WALLET } }), res, next);

    const body = (json.mock.calls[0] as unknown[])[0] as { resetAt: string };
    expect(body.resetAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('skips quota check when no wallet header is present', () => {
    const middleware = createWalletQuotaMiddleware({ dailyLimit: 0 });
    const { res } = mockRes();
    const next = mockNext();

    middleware(mockReq({ headers: {} }), res, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('sets X-Quota-Remaining header on successful request', () => {
    const middleware = createWalletQuotaMiddleware({ dailyLimit: 10 });
    const { res, setHeader } = mockRes();
    const next = mockNext();

    middleware(mockReq({ headers: { 'x-wallet-public-key': TEST_WALLET } }), res, next);

    expect(setHeader).toHaveBeenCalledWith('X-Quota-Remaining', expect.any(String));
  });

  it('resetWalletQuota resets the counter to zero', () => {
    const middleware = createWalletQuotaMiddleware({ dailyLimit: 50 });
    const next = mockNext();

    for (let i = 0; i < 5; i++) {
      const { res } = mockRes();
      middleware(mockReq({ headers: { 'x-wallet-public-key': TEST_WALLET } }), res, next);
    }

    expect(getWalletQuota(TEST_WALLET).count).toBe(5);

    resetWalletQuota(TEST_WALLET);

    expect(getWalletQuota(TEST_WALLET).count).toBe(0);
  });
});
