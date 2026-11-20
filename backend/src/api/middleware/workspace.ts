import type { Request, Response, NextFunction } from "express";
import { getWorkspaceDb } from "../../db/workspaces";

export type WorkspaceRole = "owner" | "admin" | "member";

declare global {
  namespace Express {
    interface Request {
      workspace?: { id: string; name: string; ownerWallet: string; createdAt: string };
      workspaceRole?: WorkspaceRole;
    }
  }
}

/**
 * Reads the X-Workspace-ID header, verifies that the authenticated wallet is a
 * member of that workspace, and attaches req.workspace and req.workspaceRole.
 * Returns 403 if the wallet is not a member.
 */
export function workspaceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const workspaceId = req.headers["x-workspace-id"] as string | undefined;

  if (!workspaceId) {
    next();
    return;
  }

  const walletPublicKey =
    (req.user as { walletPublicKey?: string } | undefined)?.walletPublicKey ?? "";

  if (!walletPublicKey) {
    res.status(401).json({ error: "Unauthorized", message: "Authentication required to access a workspace." });
    return;
  }

  const db = getWorkspaceDb();
  const workspace = db.prepare(
    "SELECT id, name, ownerWallet, createdAt FROM workspaces WHERE id = ?"
  ).get(workspaceId) as { id: string; name: string; ownerWallet: string; createdAt: string } | undefined;

  if (!workspace) {
    res.status(404).json({ error: "NotFound", message: "Workspace not found." });
    return;
  }

  const membership = db.prepare(
    "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
  ).get(workspaceId, walletPublicKey) as { role: WorkspaceRole } | undefined;

  if (!membership) {
    res.status(403).json({ error: "Forbidden", message: "You are not a member of this workspace." });
    return;
  }

  req.workspace = workspace;
  req.workspaceRole = membership.role;
  next();
}
