import Database from "better-sqlite3";
import { join } from "node:path";
import { migrateToLatest } from "../db/migrator";
import { ReputationEngine } from "./reputationEngine";

describe("ReputationEngine", () => {
  let db: Database.Database;
  let engine: ReputationEngine;
  const id = "agent";

  beforeEach(() => {
    db = new Database(":memory:");
    migrateToLatest(db, join(__dirname, "../db/migrations/agents"));
    db.prepare(`
      INSERT INTO agents (id, capabilities, pricingXLM, endpoint, stellarPublicKey, lastSeenAt)
      VALUES (?, '[]', 0, 'https://example.com', 'test', '')
    `).run(id);
    engine = new ReputationEngine(db);
  });

  afterEach(() => db.close());

  function recordOutcomes(total: number, succeeded: number, responseMs: number): void {
    for (let index = 0; index < total; index += 1) {
      engine.updateReputation(id, {
        taskId: "task",
        nodeId: String(index),
        successful: index < succeeded,
        responseMs,
      });
    }
  }

  function setUptime(online: number, total: number): void {
    db.prepare("INSERT INTO reputation_uptime VALUES (?, ?, ?, 1)").run(id, online, total);
  }

  it("combines all four factors and rounds their weighted sum", () => {
    recordOutcomes(5, 4, 5_000);
    setUptime(1, 1);
    const result = engine.calculate(id);
    expect(result.breakdown).toEqual({
      successRate: 0.8, responseTimeScore: 1 - 5_000 / 30_000, disputeScore: 1, uptimeScore: 1,
    });
    expect(result.score).toBe(0.87);
  });

  it.each([
    { succeeded: 1, responseMs: 0, lost: false, online: 1, score: 1 },
    { succeeded: 0, responseMs: 31_000, lost: true, online: 0, score: 0 },
  ])("handles score boundary $score", ({ succeeded, responseMs, lost, online, score }) => {
    recordOutcomes(1, succeeded, responseMs);
    engine.recordDisputeOutcome(id, "dispute", lost);
    setUptime(online, 1);
    expect(engine.calculate(id).score).toBe(score);
  });

  it("uses neutral defaults and normalizes a 15-second response to 0.5", () => {
    expect(engine.calculate(id).breakdown).toEqual({
      successRate: 0.5, responseTimeScore: 0.5, disputeScore: 1, uptimeScore: 0.5,
    });
    recordOutcomes(1, 1, 15_000);
    expect(engine.calculate(id).breakdown.responseTimeScore).toBe(0.5);
    engine.recordDisputeOutcome(id, "d1", true);
    engine.recordDisputeOutcome(id, "d2", false);
    expect(engine.calculate(id).breakdown.disputeScore).toBe(0.5);
  });

  it("samples at most once per minute and retains snapshots after removing the agent", () => {
    db.prepare("UPDATE agents SET status = 'online' WHERE id = ?").run(id);
    engine.sampleUptime(60_000);
    engine.sampleUptime(61_000);
    db.prepare("UPDATE agents SET status = 'offline' WHERE id = ?").run(id);
    engine.sampleUptime(120_000);
    expect(engine.calculate(id).breakdown.uptimeScore).toBe(0.5);
    const first = engine.updateReputation(id);
    expect(db.prepare("SELECT reputationScore FROM agents WHERE id = ?").get(id))
      .toEqual({ reputationScore: first.score });
    const count = db.prepare("SELECT COUNT(*) AS count FROM reputation_history");
    expect(count.get()).toEqual({ count: 1 });
    engine.updateReputation(id);
    expect(count.get()).toEqual({ count: 2 });
    db.prepare("DELETE FROM agents WHERE id = ?").run(id);
    expect(count.get()).toEqual({ count: 2 });
  });
});
