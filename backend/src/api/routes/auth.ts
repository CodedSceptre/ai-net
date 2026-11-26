import { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { getAuthService, AuthService } from "../../services/auth";
import { authMiddleware as sessionAuthMiddleware, optionalAuthMiddleware } from "../middleware/auth";
import { ValidationError } from "../../errors/ValidationError";
import { emptyBodySchema, stellarPublicKeySchema } from "../../schemas/common";
import type { AuthService as WalletAuthService } from "../../services/authService";
import { validate } from "../middleware/validate";

const walletVerifySchema = z.object({
  publicKey: stellarPublicKeySchema,
  nonce: z.string().min(1).max(128),
  signature: z.string().min(1).max(256),
  signatureScheme: z.enum(["raw", "sep53"]).default("raw"),
  deviceId: z.string().trim().min(1).max(128).default("wallet"),
}).strict();

const refreshTokenSchema = z.object({
  refreshToken: z.string().min(1, "refreshToken is required").max(4096),
}).strict();

const revokeSessionSchema = z.object({
  sessionId: z.string().min(1).max(128).optional(),
  reason: z.string().max(500).optional(),
}).strict();

export function createAuthRouter(authService?: AuthService, walletAuth?: WalletAuthService): Router {
  const router = Router();
  const service = authService ?? getAuthService();

  router.get(["/nonce", "/challenge"], (_req: Request, res: Response) => {
    res.status(200).json(service.createWalletNonce());
  });

  const verifyWallet = (req: Request, res: Response, next: NextFunction) => {
    try {
      const { publicKey, nonce, signature, signatureScheme, deviceId } = req.body as z.infer<typeof walletVerifySchema>;
      const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      const tokens = service.verifyWalletSignature({
        walletPublicKey: publicKey,
        nonce,
        signature,
        signatureScheme,
        deviceId,
        ipAddress,
        userAgent,
      });

      res.status(200).json(tokens);
    } catch (err) {
      next(err);
    }
  };
  if (walletAuth) {
    const challengeResponse = z.object({
      walletPublicKey: z.string().max(128),
      challenge: z.string().max(128),
      signature: z.string().max(256),
    }).strict();
    router.get("/challenge", async (_req, res, next) => {
      try {
        res.setHeader("Cache-Control", "no-store");
        res.json(await walletAuth.createChallenge());
      } catch (error) {
        next(error);
      }
    });
    router.post("/verify", async (req, res, next) => {
      if (req.body?.nonce !== undefined) return next();
      const parsed = challengeResponse.safeParse(req.body);
      if (!parsed.success) {
        res.status(401).json({ error: "INVALID_SIGNATURE" });
        return;
      }
      try {
        const { walletPublicKey, challenge, signature } = parsed.data;
        const tokens = await walletAuth.verifySignature(walletPublicKey, challenge, signature);
        if (!tokens) {
          res.status(401).json({ error: "INVALID_SIGNATURE" });
          return;
        }
        res.setHeader("Cache-Control", "no-store");
        res.json(tokens);
      } catch (error) {
        next(error);
      }
    });
  }
  router.post("/verify", validate(walletVerifySchema), verifyWallet);
  router.post("/token", validate(walletVerifySchema), verifyWallet);

  /**
   * @openapi
   * /api/auth/refresh:
   *   post:
   *     summary: Rotate refresh token
   *     description: Exchanges an active refresh token for a new access/refresh pair. Replaying a consumed refresh token revokes the entire session family.
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [refreshToken]
   *             properties:
   *               refreshToken:
   *                 type: string
   *     responses:
   *       200:
   *         description: Refreshed token pair
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TokenRefreshResponse'
   *       401:
   *         description: Invalid, expired, or reused refresh token
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/UnauthorizedError'
   */
  router.post("/refresh", validate(refreshTokenSchema), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { refreshToken } = req.body as z.infer<typeof refreshTokenSchema>;
      const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      if (walletAuth && refreshToken.startsWith("wallet_")) {
        const tokens = await walletAuth.rotateRefreshToken(refreshToken);
        res.setHeader("Cache-Control", "no-store");
        if (!tokens) {
          res.status(401).json({ error: "INVALID_REFRESH_TOKEN" });
          return;
        }
        res.json(tokens);
        return;
      }

      const tokens = service.rotateRefreshToken({
        refreshToken,
        ipAddress,
        userAgent,
      });

      res.status(200).json(tokens);
    } catch (err) {
      next(err);
    }
  });

  /**
   * @openapi
   * /api/auth/revoke:
   *   post:
   *     summary: Revoke session
   *     description: Revokes the specified or current active session.
   *     tags: [Auth]
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               reason:
   *                 type: string
   *     responses:
   *       200:
   *         description: Session revoked
   */
  router.post("/revoke", validate(revokeSessionSchema), optionalAuthMiddleware, (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body as z.infer<typeof revokeSessionSchema>;
      const targetSessionId = body.sessionId || req.user?.sessionId;
      if (!targetSessionId) {
        return next(new ValidationError("sessionId is required or must authenticate via Bearer token"));
      }

      const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      service.revokeSession(
        targetSessionId,
        body.reason || "User requested revocation",
        ipAddress,
        userAgent
      );

      res.status(200).json({ success: true, message: "Session revoked successfully" });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @openapi
   * /api/auth/revoke-all:
   *   post:
   *     summary: Revoke all user sessions
   *     description: Revokes all active sessions across all devices for the authenticated wallet.
   *     tags: [Auth]
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: All sessions revoked
   */
  router.post("/revoke-all", validate(emptyBodySchema), sessionAuthMiddleware, (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletPublicKey = req.user!.sub;
      const ipAddress = req.ip || req.socket.remoteAddress || "unknown";
      const userAgent = req.headers["user-agent"] || "unknown";

      const count = service.revokeAllUserSessions(
        walletPublicKey,
        "User logged out of all devices",
        ipAddress,
        userAgent
      );

      res.status(200).json({
        success: true,
        count,
        message: `Successfully revoked ${count} session(s)`,
      });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @openapi
   * /api/auth/sessions:
   *   get:
   *     summary: List active sessions
   *     description: Returns all active devices/sessions for the authenticated wallet.
   *     tags: [Auth]
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: List of active sessions
   */
  router.get("/sessions", sessionAuthMiddleware, (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletPublicKey = req.user!.sub;
      const currentSessionId = req.user!.sessionId;
      const sessions = service.listUserSessions(walletPublicKey).map((s) => ({
        id: s.id,
        familyId: s.familyId,
        deviceId: s.deviceId,
        deviceName: s.deviceName,
        ipAddress: s.ipAddress,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        expiresAt: s.expiresAt,
        isCurrent: s.id === currentSessionId,
      }));

      res.status(200).json({ sessions });
    } catch (err) {
      next(err);
    }
  });

  /**
   * @openapi
   * /api/auth/audit-logs:
   *   get:
   *     summary: List auth audit logs
   *     description: Returns security audit trail for compliance and intrusion detection.
   *     tags: [Auth]
   *     security:
   *       - BearerAuth: []
   *     responses:
   *       200:
   *         description: Audit logs
   */
  router.get("/audit-logs", sessionAuthMiddleware, (req: Request, res: Response, next: NextFunction) => {
    try {
      const walletPublicKey = req.user!.sub;
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const offset = req.query.offset ? Number(req.query.offset) : 0;
      const action = typeof req.query.action === "string" ? req.query.action : undefined;

      const logs = service.getAuditLogs({
        walletPublicKey,
        action,
        limit,
        offset,
      });

      res.status(200).json({ logs });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export const authRouter = createAuthRouter();
