import type { Request, Response } from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { walletAuthMiddleware } from "../api/middleware/auth";
import { AuthService } from "./authService";

const secret = "unit-test-secret";
const wallet = Keypair.random();

function setup() {
  const entries = new Map<string, { value: string; expiresAt: number }>();
  const redis = {
    async set(key: string, value: string, _mode: "EX", ttl: number) {
      entries.set(key, { value, expiresAt: Date.now() + ttl * 1000 });
    },
    async del(key: string) {
      const entry = entries.get(key);
      entries.delete(key);
      return entry && entry.expiresAt > Date.now() ? 1 : 0;
    },
    async eval(_script: string, _keys: number, oldKey: string, newKey: string, ttl: string) {
      const entry = entries.get(oldKey);
      if (!entry || entry.expiresAt <= Date.now()) return null;
      entries.delete(oldKey);
      await this.set(newKey, entry.value, "EX", Number(ttl));
      return entry.value;
    },
  };
  return new AuthService(redis, secret);
}

function sign(challenge: string, keypair = wallet) {
  return keypair.sign(Buffer.from(challenge, "hex")).toString("base64");
}

async function authenticate(service: AuthService) {
  const { challenge } = await service.createChallenge();
  const result = await service.verifySignature(wallet.publicKey(), challenge, sign(challenge));
  if (!result) throw new Error("Expected authentication to succeed");
  return result;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it("issues access and refresh tokens and consumes each challenge once", async () => {
  const service = setup();
  const { challenge, expiresAt } = await service.createChallenge();
  expect(challenge).toMatch(/^[a-f0-9]{64}$/);
  expect(Date.parse(expiresAt) - Date.now()).toBe(300_000);
  const results = await Promise.all([
    service.verifySignature(wallet.publicKey(), challenge, sign(challenge)),
    service.verifySignature(wallet.publicKey(), challenge, sign(challenge)),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  const tokens = results.find((result) => result !== null)!;
  expect(tokens.refreshToken).toBeTruthy();
  expect(service.verifyAccessToken(tokens.accessToken)).toMatchObject({
    sub: wallet.publicKey(),
    exp: Math.floor(Date.now() / 1000) + 900,
    type: "access",
  });
});

it("rejects signatures from another key and for a different challenge", async () => {
  const service = setup();
  const { challenge } = await service.createChallenge();
  const other = await service.createChallenge();
  expect(await service.verifySignature(wallet.publicKey(), challenge, sign(challenge, Keypair.random()))).toBeNull();
  expect(await service.verifySignature(wallet.publicKey(), challenge, sign(other.challenge))).toBeNull();
});

it("rejects the challenge at expiry", async () => {
  const service = setup();
  const { challenge } = await service.createChallenge();
  jest.advanceTimersByTime(300_000);
  expect(await service.verifySignature(wallet.publicKey(), challenge, sign(challenge))).toBeNull();
});

it("rotates refresh tokens and expires them after seven days", async () => {
  const service = setup();
  const first = await authenticate(service);
  const second = await service.rotateRefreshToken(first.refreshToken);
  expect(second?.accessToken).not.toBe(first.accessToken);
  expect(second?.refreshToken).not.toBe(first.refreshToken);
  expect(await service.rotateRefreshToken(first.refreshToken)).toBeNull();
  jest.advanceTimersByTime(604_800_000);
  expect(await service.rotateRefreshToken(second!.refreshToken)).toBeNull();
});

it("rejects expired access tokens in the middleware", async () => {
  const service = setup();
  const { accessToken } = await authenticate(service);
  jest.advanceTimersByTime(900_000);
  const req = { get: () => `Bearer ${accessToken}` } as unknown as Request;
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response;
  const next = jest.fn();
  walletAuthMiddleware(service)(req, res, next);
  expect(res.status).toHaveBeenCalledWith(401);
  expect(next).not.toHaveBeenCalled();
});
