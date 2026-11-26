/**
 * Internal admin routes — not exposed to public traffic.
 * Requires X-Internal-Token header matching INTERNAL_API_TOKEN env var.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { resetWalletQuota, getWalletQuota } from '../middleware/rateLimiter';

const router = Router();

function requireInternalToken(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.INTERNAL_API_TOKEN;
  const provided = req.headers['x-internal-token'] as string | undefined;

  if (!token || !provided || provided !== token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

const resetQuotaSchema = z.object({
  walletPublicKey: z.string().min(1),
});

/**
 * POST /internal/quota/reset
 * Resets the daily task submission quota for a wallet.
 */
router.post('/quota/reset', requireInternalToken, (req: Request, res: Response): void => {
  const parse = resetQuotaSchema.safeParse(req.body);
  if (!parse.success) {
    res.status(400).json({ error: 'Missing walletPublicKey', details: parse.error.flatten() });
    return;
  }

  const { walletPublicKey } = parse.data;
  resetWalletQuota(walletPublicKey);

  res.json({
    success: true,
    walletPublicKey,
    quota: getWalletQuota(walletPublicKey),
  });
});

/**
 * GET /internal/quota/status
 * Returns current quota for a wallet.
 */
router.get('/quota/status', requireInternalToken, (req: Request, res: Response): void => {
  const walletPublicKey = req.query.walletPublicKey as string | undefined;
  if (!walletPublicKey) {
    res.status(400).json({ error: 'Missing walletPublicKey query parameter' });
    return;
  }

  res.json({
    walletPublicKey,
    quota: getWalletQuota(walletPublicKey),
  });
});

export { router as internalRouter };
export default router;
