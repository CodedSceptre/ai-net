import { Router, Request, Response } from "express";
import { z } from "zod";
import { nanoid } from "nanoid";
import { getWorkspaceDb } from "../../db/workspaces";
import { createLogger } from "../../utils/logger";
import type { WorkspaceRole } from "../middleware/workspace";

const logger = createLogger({ component: "workspaces-route" });

// ── Schemas ──────────────────────────────────────────────────────────────────

const CreateWorkspaceSchema = z.object({
  name: z.string().min(3).max(64),
});

const AddMemberSchema = z.object({
  walletPublicKey: z.string().min(1),
  role: z.enum(["admin", "member"]),
});

const UpdateRoleSchema = z.object({
  role: z.enum(["admin", "member"]),
});

// ── Redis quota helpers ───────────────────────────────────────────────────────
// Daily quota tracked in Redis under key workspace:<id>:daily:<YYYY-MM-DD>.
// Falls back gracefully if Redis is unavailable (quota not enforced).

const WORKSPACE_DAILY_QUOTA = Number(process.env.WORKSPACE_DAILY_TASK_LIMIT ?? 200);

async function getWorkspaceDailyCount(workspaceId: string): Promise<number> {
  try {
    const { getRedisClient } = await import("../../cache/redis");
    const redis = getRedisClient();
    const today = new Date().toISOString().slice(0, 10);
    const key = `workspace:${workspaceId}:daily:${today}`;
    const val = await redis.get(key);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

async function incrementWorkspaceDailyCount(workspaceId: string): Promise<void> {
  try {
    const { getRedisClient } = await import("../../cache/redis");
    const redis = getRedisClient();
    const today = new Date().toISOString().slice(0, 10);
    const key = `workspace:${workspaceId}:daily:${today}`;
    await redis.incr(key);
    // Expire after 25 hours so midnight rollovers clean up automatically.
    await redis.expire(key, 90_000);
  } catch {
    // Non-fatal — quota enforcement degrades gracefully if Redis is down.
  }
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createWorkspacesRouter(): Router {
  const router = Router();

  function walletFrom(req: Request): string {
    return (req.user as { walletPublicKey?: string } | undefined)?.walletPublicKey ?? "";
  }

  // ── POST /api/workspaces ─────────────────────────────────────────────────
  router.post("/", (req: Request, res: Response): void => {
    const parsed = CreateWorkspaceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message });
      return;
    }

    const wallet = walletFrom(req);
    if (!wallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const id = nanoid();
    const now = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        "INSERT INTO workspaces (id, name, ownerWallet, createdAt) VALUES (?, ?, ?, ?)"
      ).run(id, parsed.data.name, wallet, now);

      db.prepare(
        "INSERT INTO workspace_members (workspaceId, walletPublicKey, role, addedAt) VALUES (?, ?, 'owner', ?)"
      ).run(id, wallet, now);
    })();

    logger.info({ workspaceId: id, owner: wallet }, "Workspace created");
    res.status(201).json({ id, name: parsed.data.name, ownerWallet: wallet, createdAt: now });
  });

  // ── GET /api/workspaces ──────────────────────────────────────────────────
  router.get("/", (req: Request, res: Response): void => {
    const wallet = walletFrom(req);
    if (!wallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const rows = db.prepare(`
      SELECT w.id, w.name, w.ownerWallet, w.createdAt, m.role
      FROM workspaces w
      JOIN workspace_members m ON m.workspaceId = w.id
      WHERE m.walletPublicKey = ?
      ORDER BY w.createdAt DESC
    `).all(wallet);

    res.json({ workspaces: rows });
  });

  // ── GET /api/workspaces/:id ──────────────────────────────────────────────
  router.get("/:id", (req: Request, res: Response): void => {
    const wallet = walletFrom(req);
    if (!wallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const workspace = db.prepare(
      "SELECT id, name, ownerWallet, createdAt FROM workspaces WHERE id = ?"
    ).get(req.params.id) as { id: string; name: string; ownerWallet: string; createdAt: string } | undefined;

    if (!workspace) {
      res.status(404).json({ error: "NotFound", message: "Workspace not found." });
      return;
    }

    const membership = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(req.params.id, wallet) as { role: WorkspaceRole } | undefined;

    if (!membership) {
      res.status(403).json({ error: "Forbidden", message: "You are not a member of this workspace." });
      return;
    }

    const taskCount = (db.prepare(
      "SELECT COUNT(*) as count FROM tasks WHERE workspaceId = ?"
    ).get(req.params.id) as { count: number } | undefined)?.count ?? 0;

    // Members see summary; owner/admin see member list too.
    const result: Record<string, unknown> = { ...workspace, taskCount, role: membership.role };
    if (membership.role === "owner" || membership.role === "admin") {
      result.members = db.prepare(
        "SELECT walletPublicKey, role, addedAt FROM workspace_members WHERE workspaceId = ?"
      ).all(req.params.id);
    }

    res.json(result);
  });

  // ── DELETE /api/workspaces/:id ───────────────────────────────────────────
  router.delete("/:id", (req: Request, res: Response): void => {
    const wallet = walletFrom(req);
    if (!wallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const workspace = db.prepare(
      "SELECT ownerWallet FROM workspaces WHERE id = ?"
    ).get(req.params.id) as { ownerWallet: string } | undefined;

    if (!workspace) {
      res.status(404).json({ error: "NotFound", message: "Workspace not found." });
      return;
    }

    if (workspace.ownerWallet !== wallet) {
      res.status(403).json({ error: "Forbidden", message: "Only the workspace owner can delete it." });
      return;
    }

    db.transaction(() => {
      db.prepare("DELETE FROM workspace_members WHERE workspaceId = ?").run(req.params.id);
      db.prepare("UPDATE tasks SET workspaceId = NULL WHERE workspaceId = ?").run(req.params.id);
      db.prepare("DELETE FROM workspaces WHERE id = ?").run(req.params.id);
    })();

    logger.info({ workspaceId: req.params.id, owner: wallet }, "Workspace deleted");
    res.status(204).send();
  });

  // ── POST /api/workspaces/:id/members ────────────────────────────────────
  router.post("/:id/members", (req: Request, res: Response): void => {
    const wallet = walletFrom(req);
    if (!wallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const callerMembership = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(req.params.id, wallet) as { role: WorkspaceRole } | undefined;

    if (!callerMembership) {
      res.status(403).json({ error: "Forbidden", message: "You are not a member of this workspace." });
      return;
    }

    if (callerMembership.role === "member") {
      res.status(403).json({ error: "Forbidden", message: "Only owner or admin can add members." });
      return;
    }

    const parsed = AddMemberSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(
      "INSERT OR REPLACE INTO workspace_members (workspaceId, walletPublicKey, role, addedAt) VALUES (?, ?, ?, ?)"
    ).run(req.params.id, parsed.data.walletPublicKey, parsed.data.role, now);

    res.status(201).json({
      workspaceId: req.params.id,
      walletPublicKey: parsed.data.walletPublicKey,
      role: parsed.data.role,
      addedAt: now,
    });
  });

  // ── DELETE /api/workspaces/:id/members/:wallet ───────────────────────────
  router.delete("/:id/members/:wallet", (req: Request, res: Response): void => {
    const callerWallet = walletFrom(req);
    if (!callerWallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const callerMembership = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(req.params.id, callerWallet) as { role: WorkspaceRole } | undefined;

    if (!callerMembership || callerMembership.role === "member") {
      res.status(403).json({ error: "Forbidden", message: "Only owner or admin can remove members." });
      return;
    }

    // Owner cannot be removed.
    const target = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(req.params.id, req.params.wallet) as { role: WorkspaceRole } | undefined;

    if (!target) {
      res.status(404).json({ error: "NotFound", message: "Member not found." });
      return;
    }

    if (target.role === "owner") {
      res.status(403).json({ error: "Forbidden", message: "The workspace owner cannot be removed." });
      return;
    }

    db.prepare(
      "DELETE FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).run(req.params.id, req.params.wallet);

    res.status(204).send();
  });

  // ── PUT /api/workspaces/:id/members/:wallet ──────────────────────────────
  router.put("/:id/members/:wallet", (req: Request, res: Response): void => {
    const callerWallet = walletFrom(req);
    if (!callerWallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const workspace = db.prepare(
      "SELECT ownerWallet FROM workspaces WHERE id = ?"
    ).get(req.params.id) as { ownerWallet: string } | undefined;

    if (!workspace) {
      res.status(404).json({ error: "NotFound", message: "Workspace not found." });
      return;
    }

    if (workspace.ownerWallet !== callerWallet) {
      res.status(403).json({ error: "Forbidden", message: "Only the owner can change member roles." });
      return;
    }

    const parsed = UpdateRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "ValidationError", message: parsed.error.issues[0]?.message });
      return;
    }

    const target = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(req.params.id, req.params.wallet) as { role: WorkspaceRole } | undefined;

    if (!target) {
      res.status(404).json({ error: "NotFound", message: "Member not found." });
      return;
    }

    if (target.role === "owner") {
      res.status(403).json({ error: "Forbidden", message: "Cannot change the owner's role." });
      return;
    }

    db.prepare(
      "UPDATE workspace_members SET role = ? WHERE workspaceId = ? AND walletPublicKey = ?"
    ).run(parsed.data.role, req.params.id, req.params.wallet);

    res.json({ workspaceId: req.params.id, walletPublicKey: req.params.wallet, role: parsed.data.role });
  });

  // ── GET /api/workspaces/:id/tasks ────────────────────────────────────────
  // Workspace members can list all tasks scoped to the workspace.
  router.get("/:id/tasks", async (req: Request, res: Response): Promise<void> => {
    const wallet = walletFrom(req);
    if (!wallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const membership = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(req.params.id, wallet) as { role: WorkspaceRole } | undefined;

    if (!membership) {
      res.status(403).json({ error: "Forbidden", message: "You are not a member of this workspace." });
      return;
    }

    // Tasks live in the tasks database; import lazily to avoid circular deps.
    const { getTaskDb } = await import("../../db/tasks");
    const taskDb = getTaskDb();
    const tasks = taskDb.prepare(
      "SELECT id, prompt, walletPublicKey, status, createdAt, updatedAt FROM tasks WHERE workspaceId = ? ORDER BY createdAt DESC"
    ).all(req.params.id);

    res.json({ tasks });
  });

  // ── POST /api/workspaces/:id/tasks ───────────────────────────────────────
  // Create a task scoped to the workspace, enforcing the workspace daily quota.
  router.post("/:id/tasks", async (req: Request, res: Response): Promise<void> => {
    const wallet = walletFrom(req);
    if (!wallet) {
      res.status(401).json({ error: "Unauthorized", message: "Authentication required." });
      return;
    }

    const db = getWorkspaceDb();
    const membership = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(req.params.id, wallet) as { role: WorkspaceRole } | undefined;

    if (!membership) {
      res.status(403).json({ error: "Forbidden", message: "You are not a member of this workspace." });
      return;
    }

    const dailyCount = await getWorkspaceDailyCount(req.params.id);
    if (dailyCount >= WORKSPACE_DAILY_QUOTA) {
      res.status(429).json({
        error: "TooManyRequests",
        message: `Workspace daily task limit of ${WORKSPACE_DAILY_QUOTA} reached.`,
      });
      return;
    }

    await incrementWorkspaceDailyCount(req.params.id);

    // Delegate actual task creation to the tasks router logic by forwarding
    // the workspaceId so the tasks handler can store it.
    req.body.workspaceId = req.params.id;

    // Return accepted — full task creation is handled by the existing tasks
    // route which is mounted separately. This endpoint validates quota only.
    res.status(202).json({ message: "Quota check passed. Submit task via POST /api/tasks with workspaceId." });
  });

  return router;
}
