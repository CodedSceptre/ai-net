import Database from 'better-sqlite3';
import type { RequestHandler } from 'express';
import { logAuditEvent } from '../../utils/auditLog';

const LOGGED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function deriveEntityType(routePath: string): string {
  if (routePath.includes('/agents')) return 'agent';
  if (routePath.includes('/tasks')) return 'task';
  if (routePath.includes('/payments')) return 'payment';
  if (routePath.includes('/audit')) return 'audit';
  return 'unknown';
}

export function createAuditMiddleware(db: Database.Database): RequestHandler {
  return (req, res, next) => {
    res.on('finish', () => {
      try {
        if (!LOGGED_METHODS.has(req.method)) return;

        const routePath = req.route?.path ?? req.path;
        const action = `${req.method}:${routePath}`;
        const actorWallet = (req as unknown as { user?: { sub?: string } }).user?.sub ?? undefined;
        const entityId =
          req.params?.id ??
          req.params?.agentId ??
          req.params?.taskId ??
          'unknown';
        const entityType = deriveEntityType(routePath);
        const payload = {
          body: req.body as unknown,
          query: req.query,
          statusCode: res.statusCode,
        } as Record<string, unknown>;
        const ipAddress = req.ip;
        const userAgent = req.headers['user-agent'];

        logAuditEvent(db, {
          action,
          actorWallet,
          entityType,
          entityId,
          payload,
          ipAddress,
          userAgent,
        });
      } catch (err) {
        console.error('[auditMiddleware] failed to log audit event:', err);
      }
    });

    next();
  };
}
