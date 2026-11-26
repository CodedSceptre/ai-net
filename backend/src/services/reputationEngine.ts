import type Database from "better-sqlite3";
import { getAgentDb } from "../db/agents";

export interface ReputationScore {
  agentId: string;
  score: number;
  breakdown: {
    successRate: number;
    responseTimeScore: number;
    disputeScore: number;
    uptimeScore: number;
  };
  calculatedAt: string;
}

interface NodeOutcome {
  taskId: string;
  nodeId: string;
  successful: boolean;
  responseMs: number;
}

const clamp = (value: number): number => Math.max(0, Math.min(1, value));

export class ReputationEngine {
  constructor(private readonly db: Database.Database = getAgentDb()) {}

  calculate(agentId: string): ReputationScore {
    const tasks = this.db.prepare(`
      SELECT COUNT(*) AS total, SUM(successful) AS successful, AVG(responseMs) AS avgResponseMs
      FROM reputation_node_outcomes WHERE agentId = ?
    `).get(agentId) as { total: number; successful: number | null; avgResponseMs: number | null };
    const disputes = this.db.prepare(`
      SELECT COUNT(*) AS total, SUM(lost) AS lost FROM reputation_disputes WHERE agentId = ?
    `).get(agentId) as { total: number; lost: number | null };
    const uptime = this.db.prepare(`
      SELECT onlineMinutes, totalMonitoredMinutes FROM reputation_uptime WHERE agentId = ?
    `).get(agentId) as { onlineMinutes: number; totalMonitoredMinutes: number } | undefined;

    const successRate = tasks.total ? (tasks.successful ?? 0) / tasks.total : 0.5;
    const responseTimeScore = tasks.avgResponseMs === null ? 0.5 : clamp(1 - tasks.avgResponseMs / 30_000);
    const disputeScore = 1 - (disputes.lost ?? 0) / Math.max(1, disputes.total);
    const uptimeScore = uptime?.totalMonitoredMinutes
      ? clamp(uptime.onlineMinutes / uptime.totalMonitoredMinutes)
      : 0.5;
    const weighted = successRate * 0.5 + responseTimeScore * 0.2 + disputeScore * 0.2 + uptimeScore * 0.1;

    return {
      agentId,
      score: Math.round(clamp(weighted) * 100) / 100,
      breakdown: { successRate, responseTimeScore, disputeScore, uptimeScore },
      calculatedAt: new Date().toISOString(),
    };
  }

  updateReputation(agentId: string, outcome?: NodeOutcome): ReputationScore {
    return this.db.transaction(() => {
      if (outcome) {
        this.db.prepare(`
          INSERT INTO reputation_node_outcomes (agentId, taskId, nodeId, successful, responseMs)
          VALUES (?, ?, ?, ?, ?) ON CONFLICT(agentId, taskId, nodeId) DO UPDATE SET
          successful = excluded.successful, responseMs = excluded.responseMs
        `).run(agentId, outcome.taskId, outcome.nodeId, Number(outcome.successful), outcome.responseMs);
      }

      const result = this.calculate(agentId);
      const update = this.db.prepare("UPDATE agents SET reputationScore = ? WHERE id = ?")
        .run(result.score, agentId);
      if (!update.changes) throw new Error(`Unknown agent: ${agentId}`);

      this.db.prepare(`
        INSERT INTO reputation_history (agentId, taskId, nodeId, score, timestamp, breakdown, calculatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(agentId, outcome?.taskId ?? "", outcome?.nodeId ?? "", result.score,
        result.calculatedAt, JSON.stringify(result.breakdown), result.calculatedAt);
      return result;
    }).immediate();
  }

  recordDisputeOutcome(agentId: string, disputeId: string, lost: boolean): void {
    this.db.prepare(`
      INSERT INTO reputation_disputes (agentId, disputeId, lost) VALUES (?, ?, ?)
      ON CONFLICT(agentId, disputeId) DO UPDATE SET lost = excluded.lost
    `).run(agentId, disputeId, Number(lost));
  }

  sampleUptime(at = Date.now()): void {
    const minute = Math.floor(at / 60_000);
    this.db.prepare(`
      INSERT INTO reputation_uptime (agentId, onlineMinutes, totalMonitoredMinutes, lastSampleMinute)
      SELECT id, CASE WHEN status = 'online' THEN 1 ELSE 0 END, 1, ? FROM agents WHERE 1
      ON CONFLICT(agentId) DO UPDATE SET
        onlineMinutes = reputation_uptime.onlineMinutes + excluded.onlineMinutes,
        totalMonitoredMinutes = reputation_uptime.totalMonitoredMinutes + 1,
        lastSampleMinute = excluded.lastSampleMinute
      WHERE excluded.lastSampleMinute > reputation_uptime.lastSampleMinute
    `).run(minute);
  }
}
