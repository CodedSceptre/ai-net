import Database from 'better-sqlite3';
import { Router } from 'express';
import { createAuditDb } from '../../utils/auditLog';

export function createAuditRouter(db: Database.Database): Router {
  const router = Router();

  router.get('/', (req, res, next) => {
    try {
      const {
        entityId,
        entityType,
        action,
        actorWallet,
        from,
        to,
        page: pageRaw,
        limit: limitRaw,
      } = req.query as Record<string, string | undefined>;

      const page = pageRaw !== undefined ? parseInt(pageRaw, 10) : undefined;
      const limit = limitRaw !== undefined ? Math.min(100, parseInt(limitRaw, 10)) : undefined;

      const result = createAuditDb(db).query({
        entityId,
        entityType,
        action,
        actorWallet,
        from,
        to,
        page,
        limit,
      });

      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
