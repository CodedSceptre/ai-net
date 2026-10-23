import { getAgentDb, createAgentDb } from '../db/agents';
import { createLogger } from '../utils/logger';

export interface AgentCleanupOptions {
  intervalMs?: number;
  ttlMs?: number;
}

export class AgentCleanupService {
  private readonly intervalMs: number;
  private readonly ttlMs: number;
  private interval: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly log = createLogger({ component: 'AgentCleanup' });

  constructor(options: AgentCleanupOptions = {}) {
    this.intervalMs = options.intervalMs ?? Number(process.env.HEARTBEAT_INTERVAL_MS ?? 30_000);
    this.ttlMs = options.ttlMs ?? Number(process.env.HEARTBEAT_GRACE_PERIOD_MS ?? 90_000);
  }

  start(): void {
    if (this.interval) return;
    this.stopped = false;
    this.tick();
    this.interval = setInterval(() => {
      this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.stopped = true;
  }

  private tick(): void {
    if (this.stopped) return;

    try {
      const db = createAgentDb(getAgentDb());
      const staleSeconds = Math.floor(this.ttlMs / 1000);
      const count = db.markStaleAgents(staleSeconds);
      this.log.info({ count, staleSeconds }, 'marked stale agents offline');
    } catch (err) {
      this.log.error({ err }, 'cleanup tick failed');
    }
  }
}
