/**
 * Unit tests for the workspaces API routes.
 *
 * Uses an in-memory SQLite database via the better-sqlite3 mock so no real
 * disk I/O occurs. Redis calls are stubbed to always return 0 / resolve.
 */

import express from "express";
import request from "supertest";
import Database from "better-sqlite3";
import path from "path";
import { createWorkspacesRouter } from "./workspaces";
import { migrateToLatest } from "../../db/migrator";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildApp(walletPublicKey: string) {
  const app = express();
  app.use(express.json());

  // Inject a fake authenticated user for every request.
  app.use((req, _res, next) => {
    (req as unknown as { user: { walletPublicKey: string } }).user = { walletPublicKey };
    next();
  });

  app.use("/api/workspaces", createWorkspacesRouter());
  return app;
}

// Shared in-memory DB instance used by all tests in this file.
let db: Database.Database;

jest.mock("../../db/workspaces", () => ({
  getWorkspaceDb: () => db,
  closeWorkspaceDb: jest.fn(),
}));

// Stub Redis to avoid real connections.
jest.mock("../../cache/redis", () => ({
  getRedisClient: () => ({
    get: jest.fn().mockResolvedValue(null),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  }),
}));

// Stub task DB for workspace task listing.
jest.mock("../../db/tasks", () => ({
  getTaskDb: () => ({
    prepare: () => ({ all: jest.fn().mockReturnValue([]) }),
  }),
}));

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  db = new Database(":memory:");
  const migrationsDir = path.join(__dirname, "../../db/migrations/workspaces");
  migrateToLatest(db, migrationsDir);

  // Ensure tasks table exists for workspaceId FK (migration 002 references it).
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      walletPublicKey TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued',
      dagJson TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      workspaceId TEXT
    )
  `);
});

afterEach(() => {
  db.close();
});

// ── POST /api/workspaces ──────────────────────────────────────────────────────

describe("POST /api/workspaces", () => {
  it("creates a workspace and adds the caller as owner", async () => {
    const app = buildApp("GCALICE");
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "My Team" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My Team");
    expect(res.body.ownerWallet).toBe("GCALICE");
    expect(res.body.id).toBeTruthy();

    const member = db.prepare(
      "SELECT role FROM workspace_members WHERE workspaceId = ? AND walletPublicKey = ?"
    ).get(res.body.id, "GCALICE") as { role: string } | undefined;
    expect(member?.role).toBe("owner");
  });

  it("rejects names shorter than 3 characters", async () => {
    const app = buildApp("GCALICE");
    const res = await request(app).post("/api/workspaces").send({ name: "ab" });
    expect(res.status).toBe(400);
  });

  it("rejects names longer than 64 characters", async () => {
    const app = buildApp("GCALICE");
    const res = await request(app)
      .post("/api/workspaces")
      .send({ name: "a".repeat(65) });
    expect(res.status).toBe(400);
  });
});

// ── GET /api/workspaces ───────────────────────────────────────────────────────

describe("GET /api/workspaces", () => {
  it("lists only workspaces the caller belongs to", async () => {
    const app = buildApp("GCALICE");
    await request(app).post("/api/workspaces").send({ name: "Alice Team" });

    const bobApp = buildApp("GCBOB");
    await request(bobApp).post("/api/workspaces").send({ name: "Bob Team" });

    const res = await request(app).get("/api/workspaces");
    expect(res.status).toBe(200);
    expect(res.body.workspaces).toHaveLength(1);
    expect(res.body.workspaces[0].name).toBe("Alice Team");
  });
});

// ── GET /api/workspaces/:id ───────────────────────────────────────────────────

describe("GET /api/workspaces/:id", () => {
  it("returns workspace details for a member", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });

    const res = await request(app).get(`/api/workspaces/${ws.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ws.id);
    expect(res.body.taskCount).toBe(0);
  });

  it("returns 403 for a non-member", async () => {
    const aliceApp = buildApp("GCALICE");
    const { body: ws } = await request(aliceApp).post("/api/workspaces").send({ name: "Team A" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp).get(`/api/workspaces/${ws.id}`);
    expect(res.status).toBe(403);
  });

  it("includes member list for owner", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });
    await request(app).post(`/api/workspaces/${ws.id}/members`).send({ walletPublicKey: "GCBOB", role: "member" });

    const res = await request(app).get(`/api/workspaces/${ws.id}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.members)).toBe(true);
    expect(res.body.members).toHaveLength(2);
  });
});

// ── DELETE /api/workspaces/:id ────────────────────────────────────────────────

describe("DELETE /api/workspaces/:id", () => {
  it("allows the owner to delete the workspace", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });

    const res = await request(app).delete(`/api/workspaces/${ws.id}`);
    expect(res.status).toBe(204);

    const check = db.prepare("SELECT id FROM workspaces WHERE id = ?").get(ws.id);
    expect(check).toBeUndefined();
  });

  it("returns 403 when an admin tries to delete", async () => {
    const aliceApp = buildApp("GCALICE");
    const { body: ws } = await request(aliceApp).post("/api/workspaces").send({ name: "Team A" });
    await request(aliceApp)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "admin" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp).delete(`/api/workspaces/${ws.id}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 when a member tries to delete", async () => {
    const aliceApp = buildApp("GCALICE");
    const { body: ws } = await request(aliceApp).post("/api/workspaces").send({ name: "Team A" });
    await request(aliceApp)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "member" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp).delete(`/api/workspaces/${ws.id}`);
    expect(res.status).toBe(403);
  });
});

// ── POST /api/workspaces/:id/members ─────────────────────────────────────────

describe("POST /api/workspaces/:id/members", () => {
  it("owner can add a member", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });

    const res = await request(app)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "member" });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe("member");
  });

  it("admin can add a member", async () => {
    const aliceApp = buildApp("GCALICE");
    const { body: ws } = await request(aliceApp).post("/api/workspaces").send({ name: "Team A" });
    await request(aliceApp)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "admin" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCCAROL", role: "member" });
    expect(res.status).toBe(201);
  });

  it("member cannot add another member (returns 403)", async () => {
    const aliceApp = buildApp("GCALICE");
    const { body: ws } = await request(aliceApp).post("/api/workspaces").send({ name: "Team A" });
    await request(aliceApp)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "member" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCCAROL", role: "member" });
    expect(res.status).toBe(403);
  });
});

// ── DELETE /api/workspaces/:id/members/:wallet ────────────────────────────────

describe("DELETE /api/workspaces/:id/members/:wallet", () => {
  it("owner can remove a member", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });
    await request(app)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "member" });

    const res = await request(app).delete(`/api/workspaces/${ws.id}/members/GCBOB`);
    expect(res.status).toBe(204);
  });

  it("owner cannot be removed", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });
    await request(app)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "admin" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp).delete(`/api/workspaces/${ws.id}/members/GCALICE`);
    expect(res.status).toBe(403);
  });
});

// ── PUT /api/workspaces/:id/members/:wallet ───────────────────────────────────

describe("PUT /api/workspaces/:id/members/:wallet", () => {
  it("owner can change a member role", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });
    await request(app)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "member" });

    const res = await request(app)
      .put(`/api/workspaces/${ws.id}/members/GCBOB`)
      .send({ role: "admin" });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
  });

  it("non-owner cannot change roles", async () => {
    const aliceApp = buildApp("GCALICE");
    const { body: ws } = await request(aliceApp).post("/api/workspaces").send({ name: "Team A" });
    await request(aliceApp)
      .post(`/api/workspaces/${ws.id}/members`)
      .send({ walletPublicKey: "GCBOB", role: "admin" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp)
      .put(`/api/workspaces/${ws.id}/members/GCBOB`)
      .send({ role: "member" });
    expect(res.status).toBe(403);
  });
});

// ── GET /api/workspaces/:id/tasks ─────────────────────────────────────────────

describe("GET /api/workspaces/:id/tasks", () => {
  it("member can list workspace tasks", async () => {
    const app = buildApp("GCALICE");
    const { body: ws } = await request(app).post("/api/workspaces").send({ name: "Team A" });

    const res = await request(app).get(`/api/workspaces/${ws.id}/tasks`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
  });

  it("non-member receives 403", async () => {
    const aliceApp = buildApp("GCALICE");
    const { body: ws } = await request(aliceApp).post("/api/workspaces").send({ name: "Team A" });

    const bobApp = buildApp("GCBOB");
    const res = await request(bobApp).get(`/api/workspaces/${ws.id}/tasks`);
    expect(res.status).toBe(403);
  });
});
