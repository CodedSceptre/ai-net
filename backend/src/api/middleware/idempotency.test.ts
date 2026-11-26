import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import type { Request, Response, NextFunction } from 'express';
import { createIdempotencyMiddleware, requireIdempotencyKey, isValidUuidV4 } from './idempotency';
import { createIdempotencyStore } from '../../services/idempotency';

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_UUID_2 = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const WALLET_A = 'GWALLET_A_PUBLIC_KEY_12345';
const WALLET_B = 'GWALLET_B_PUBLIC_KEY_67890';

function makeReq(overrides: {
  idempotencyKey?: string;
  wallet?: string;
  body?: unknown;
} = {}): Request {
  return {
    headers: {
      ...(overrides.idempotencyKey ? { 'idempotency-key': overrides.idempotencyKey } : {}),
      ...(overrides.wallet ? { 'x-wallet-public-key': overrides.wallet } : {}),
    },
    body: overrides.body ?? {},
  } as unknown as Request;
}

type MockRes = Response & {
  _status: number;
  _body: unknown;
  _headers: Record<string, string>;
};

function makeRes(): MockRes {
  const headers: Record<string, string> = {};
  const res = {
    _status: 200,
    _body: null,
    _headers: headers,
    locals: {},
    statusCode: 200,
    headersSent: false,
    setHeader: jest.fn((key: string, val: string) => {
      headers[key] = val;
      return res;
    }),
    getHeader: jest.fn((key: string) => headers[key]),
    status: jest.fn((code: number) => {
      res.statusCode = code;
      res._status = code;
      return res;
    }),
    json: jest.fn((body: unknown) => {
      res._body = body;
      return res;
    }),
    send: jest.fn((body: unknown) => {
      res._body = body;
      return res;
    }),
    // Fire the 'finish' callback immediately so stores are populated synchronously in tests.
    on: jest.fn((event: string, cb: () => void) => {
      if (event === 'finish') cb();
      return res;
    }),
    emit: jest.fn(),
  } as unknown as MockRes;
  return res;
}

function makeNext(): NextFunction {
  return jest.fn() as unknown as NextFunction;
}

// ── isValidUuidV4 ─────────────────────────────────────────────────────────────

describe('isValidUuidV4', () => {
  it('accepts a valid UUID v4', () => {
    expect(isValidUuidV4('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('rejects a UUID v1 (version digit is not 4)', () => {
    // Third group starts with '1', not '4'
    expect(isValidUuidV4('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
  });

  it('rejects an arbitrary string', () => {
    expect(isValidUuidV4('not-a-uuid')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isValidUuidV4('')).toBe(false);
  });

  it('rejects a UUID v4 with wrong variant digit in fourth group', () => {
    // Fourth group must start with 8, 9, a, or b — 'c' is invalid
    expect(isValidUuidV4('550e8400-e29b-41d4-c716-446655440000')).toBe(false);
  });
});

// ── requireIdempotencyKey ─────────────────────────────────────────────────────

describe('requireIdempotencyKey', () => {
  it('calls next() when a valid UUID v4 key is present', () => {
    const req = makeReq({ idempotencyKey: VALID_UUID });
    const res = makeRes();
    const next = makeNext();
    requireIdempotencyKey(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 IDEMPOTENCY_KEY_REQUIRED when header is missing', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = makeNext();
    requireIdempotencyKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 IDEMPOTENCY_KEY_REQUIRED when header is whitespace only', () => {
    const req = makeReq({ idempotencyKey: '   ' });
    const res = makeRes();
    const next = makeNext();
    requireIdempotencyKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_IDEMPOTENCY_KEY_FORMAT for a non-UUID value', () => {
    const req = makeReq({ idempotencyKey: 'not-a-uuid-v4' });
    const res = makeRes();
    const next = makeNext();
    requireIdempotencyKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_IDEMPOTENCY_KEY_FORMAT' });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 INVALID_IDEMPOTENCY_KEY_FORMAT for a UUID v1', () => {
    const req = makeReq({ idempotencyKey: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' });
    const res = makeRes();
    const next = makeNext();
    requireIdempotencyKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'INVALID_IDEMPOTENCY_KEY_FORMAT' });
  });

  it('trims whitespace from the key before validating', () => {
    const req = makeReq({ idempotencyKey: `  ${VALID_UUID}  ` });
    const res = makeRes();
    const next = makeNext();
    requireIdempotencyKey(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// ── createIdempotencyMiddleware ───────────────────────────────────────────────

describe('createIdempotencyMiddleware', () => {
  let store: ReturnType<typeof createIdempotencyStore>;
  let middleware: ReturnType<typeof createIdempotencyMiddleware>;

  beforeEach(() => {
    store = createIdempotencyStore(undefined, { cleanupIntervalMs: 0 });
    middleware = createIdempotencyMiddleware(store);
  });

  afterEach(() => {
    store.close();
  });

  it('calls next() when no idempotency key is present', () => {
    const req = makeReq({});
    const res = makeRes();
    const next = makeNext();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });

  it('calls next() and skips storage for whitespace-only key', () => {
    const req = makeReq({ idempotencyKey: '   ' });
    const res = makeRes();
    const next = makeNext();
    middleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('caches a 2xx response and replays it on a second identical request', () => {
    // First request: middleware patches res.json and calls next.
    const req1 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res1 = makeRes();
    const next1 = makeNext();

    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // Simulate the handler writing a 201 response.
    res1.statusCode = 201;
    res1.json({ taskId: 'task_abc', status: 'queued' });

    // Second request with the same key and wallet: should replay.
    const req2 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res2 = makeRes();
    const next2 = makeNext();

    middleware(req2, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2._headers['X-Idempotent-Replayed']).toBe('true');
    expect(res2._body).toEqual({ taskId: 'task_abc', status: 'queued' });
  });

  it('sets X-Idempotent-Replayed: true header on cached response replays', () => {
    const req1 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res1 = makeRes();
    middleware(req1, res1, makeNext());
    res1.statusCode = 200;
    res1.json({ ok: true });

    const req2 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res2 = makeRes();
    middleware(req2, res2, makeNext());

    expect(res2.setHeader).toHaveBeenCalledWith('X-Idempotent-Replayed', 'true');
  });

  it('allows retry when cached response is 5xx (does not replay)', () => {
    const req1 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res1 = makeRes();
    const next1 = makeNext();

    middleware(req1, res1, next1);
    expect(next1).toHaveBeenCalled();

    // Simulate a 500 response — should NOT be stored.
    res1.statusCode = 500;
    res1.json({ error: 'Internal Server Error' });

    // Second request with the same key: handler should run again.
    const req2 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res2 = makeRes();
    const next2 = makeNext();

    middleware(req2, res2, next2);

    expect(next2).toHaveBeenCalled();
    expect(res2._headers['X-Idempotent-Replayed']).toBeUndefined();
  });

  it('enforces wallet-scoped isolation (wallet A response is not replayed to wallet B)', () => {
    // Wallet A stores a response under VALID_UUID.
    const reqA = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const resA = makeRes();
    const nextA = makeNext();

    middleware(reqA, resA, nextA);
    resA.statusCode = 201;
    resA.json({ taskId: 'task_wallet_a' });

    // Wallet B uses the same UUID key but a different wallet.
    const reqB = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_B });
    const resB = makeRes();
    const nextB = makeNext();

    middleware(reqB, resB, nextB);

    // Wallet B must NOT receive wallet A's cached response.
    expect(nextB).toHaveBeenCalled();
    expect(resB._headers['X-Idempotent-Replayed']).toBeUndefined();
  });

  it('does not cache 4xx responses (handler is called again on retry)', () => {
    const req1 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res1 = makeRes();
    const next1 = makeNext();

    middleware(req1, res1, next1);
    res1.statusCode = 400;
    res1.json({ error: 'bad request' });

    // Second request: should NOT replay — handler should run again.
    const req2 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res2 = makeRes();
    const next2 = makeNext();

    middleware(req2, res2, next2);

    expect(next2).toHaveBeenCalled();
    expect(res2._headers['X-Idempotent-Replayed']).toBeUndefined();
  });

  it('two different UUID v4 keys for the same wallet do not interfere', () => {
    // First request with key 1 → stores response.
    const req1 = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const res1 = makeRes();
    middleware(req1, res1, makeNext());
    res1.statusCode = 201;
    res1.json({ result: 'first' });

    // Second request with a different key → should be a fresh call.
    const req2 = makeReq({ idempotencyKey: VALID_UUID_2, wallet: WALLET_A });
    const res2 = makeRes();
    const next2 = makeNext();

    middleware(req2, res2, next2);

    expect(next2).toHaveBeenCalled();
    expect(res2._headers['X-Idempotent-Replayed']).toBeUndefined();
  });

  it('requests with no wallet header are scoped to the anonymous bucket', () => {
    // First request with no wallet header.
    const req1 = makeReq({ idempotencyKey: VALID_UUID });
    const res1 = makeRes();
    const next1 = makeNext();

    middleware(req1, res1, next1);
    res1.statusCode = 200;
    res1.json({ hello: 'world' });

    // Second request with the same key and no wallet header — should replay.
    const req2 = makeReq({ idempotencyKey: VALID_UUID });
    const res2 = makeRes();
    const next2 = makeNext();

    middleware(req2, res2, next2);

    expect(next2).not.toHaveBeenCalled();
    expect(res2._headers['X-Idempotent-Replayed']).toBe('true');
  });

  it('a wallet-scoped key does not collide with the anonymous bucket for the same UUID', () => {
    // Anonymous request stores a response.
    const reqAnon = makeReq({ idempotencyKey: VALID_UUID });
    const resAnon = makeRes();
    middleware(reqAnon, resAnon, makeNext());
    resAnon.statusCode = 200;
    resAnon.json({ scope: 'anonymous' });

    // Wallet A with the same key should NOT get the anonymous response.
    const reqWallet = makeReq({ idempotencyKey: VALID_UUID, wallet: WALLET_A });
    const resWallet = makeRes();
    const nextWallet = makeNext();

    middleware(reqWallet, resWallet, nextWallet);

    expect(nextWallet).toHaveBeenCalled();
    expect(resWallet._headers['X-Idempotent-Replayed']).toBeUndefined();
  });
});
