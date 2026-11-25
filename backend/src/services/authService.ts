import { randomBytes, randomUUID } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";
import { TokenService } from "./auth/tokenService";

const CHALLENGE_TTL = 300;
const ACCESS_TTL = 900;
const REFRESH_TTL = 604800;

interface AuthRedis {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
}

export class AuthService {
  private readonly tokens: TokenService;

  constructor(private readonly redis: AuthRedis, secret: string) {
    if (!secret) throw new Error("JWT_SECRET is required for wallet authentication");
    this.tokens = new TokenService({ jwtSecret: secret, accessTtlSeconds: ACCESS_TTL });
  }

  async createChallenge() {
    const challenge = randomBytes(32).toString("hex");
    await this.redis.set(`challenge:${challenge}`, "1", "EX", CHALLENGE_TTL);
    return { challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL * 1000).toISOString() };
  }

  async verifySignature(walletPublicKey: string, challenge: string, signature: string) {
    if (!/^[a-f0-9]{64}$/.test(challenge)) return null;
    try {
      const bytes = Buffer.from(signature, "base64");
      if (bytes.length !== 64 || !Keypair.fromPublicKey(walletPublicKey)
        .verify(Buffer.from(challenge, "hex"), bytes)) return null;
    } catch {
      return null;
    }

    // DEL succeeds for just one verifier, including across API replicas.
    if (await this.redis.del(`challenge:${challenge}`) !== 1) return null;

    const refreshToken = `wallet_${this.tokens.generateRefreshToken()}`;
    await this.redis.set(this.refreshKey(refreshToken), walletPublicKey, "EX", REFRESH_TTL);
    return this.issueTokens(walletPublicKey, refreshToken);
  }

  async rotateRefreshToken(token: string) {
    const refreshToken = `wallet_${this.tokens.generateRefreshToken()}`;
    const wallet = await this.redis.eval(
      `local wallet = redis.call('GET', KEYS[1])
       if not wallet then return false end
       redis.call('SET', KEYS[2], wallet, 'EX', ARGV[1])
       redis.call('DEL', KEYS[1])
       return wallet`,
      2, this.refreshKey(token), this.refreshKey(refreshToken), String(REFRESH_TTL),
    );
    return typeof wallet === "string" ? this.issueTokens(wallet, refreshToken) : null;
  }

  verifyAccessToken(token: string) {
    const payload = this.tokens.verifyAccessToken(token);
    if (payload.type !== "access") throw new Error("Access token required");
    Keypair.fromPublicKey(payload.sub);
    return payload;
  }

  private refreshKey(token: string): string {
    return `wallet:refresh:{sessions}:${this.tokens.hashRefreshToken(token)}`;
  }

  private issueTokens(walletPublicKey: string, refreshToken: string) {
    const sessionId = randomUUID();
    const { token: accessToken, expiresIn } = this.tokens.generateAccessToken({
      walletPublicKey,
      sessionId,
      familyId: sessionId,
      deviceId: "wallet",
      type: "access",
    });
    return { accessToken, refreshToken, expiresIn };
  }
}
