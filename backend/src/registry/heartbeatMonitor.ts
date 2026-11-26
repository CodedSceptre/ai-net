import type Database from 'better-sqlite3';
import { getAgentDb, createAgentDb, type AgentDb, type AgentRecord } from '../db/agents';
import { eventBus as defaultEventBus } from '../coordinator/eventBus';
import { createLogger } from '../utils/logger';
import { AgentMatcher } from '../coordinator/matcher';

export { AgentMatcher };

const logger = createLogger({ module: 'heartbeat-monitor' });

export type RevokeOnChainFn = (agentId: string) => Promise<void> | void;

export interface HeartbeatMonitorOptions {
  /** Database instance (AgentDb or SQLite Database) */
  db?: AgentDb;
  rawDb?: Database.Database;
  /** Application EventBus */
  eventBus?: any;
  /** Interval in milliseconds between monitor checks (default: 60,000 ms) */
  intervalMs?: number;
  /** Threshold in milliseconds before an online agent is marked offline (default: 15 min) */
  offlineThresholdMs?: number;
  /** Threshold in milliseconds before an offline agent is deregistered (default: 45 min) */
  deregisterThresholdMs?: number;
  /** Callback to invoke on-chain agent revocation */
  revokeOnChain?: RevokeOnChainFn;
  /** Custom clock provider for deterministic testing */
  now?: () => number;
}

export class HeartbeatMonitor {
  private readonly agentDb: AgentDb;
  private readonly rawDb?: Database.Database;
  private readonly bus: any;
  private readonly intervalMs: number;
  private readonly offlineThresholdMs: number;
  private readonly deregisterThresholdMs: number;
  private readonly revokeOnChainFn?: RevokeOnChainFn;
  private readonly nowFn: () => number;
  private intervalTimer: NodeJS.Timeout | null = null;
  private readonly revokedAgentIds = new Set<string>();

  constructor(options: HeartbeatMonitorOptions = {}) {
    this.rawDb = options.rawDb ?? (options.db ? undefined : getAgentDb());
    this.agentDb = options.db ?? (this.rawDb ? createAgentDb(this.rawDb) : createAgentDb(getAgentDb()));
    this.bus = options.eventBus ?? defaultEventBus;

    this.intervalMs =
      options.intervalMs ??
      Number(process.env.HEARTBEAT_INTERVAL_MS ?? 60_000);

    this.offlineThresholdMs =
      options.offlineThresholdMs ??
      Number(process.env.HEARTBEAT_OFFLINE_THRESHOLD_MS ?? 15 * 60 * 1000);

    this.deregisterThresholdMs =
      options.deregisterThresholdMs ??
      Number(process.env.HEARTBEAT_DEREGISTER_THRESHOLD_MS ?? 45 * 60 * 1000);

    this.revokeOnChainFn = options.revokeOnChain;
    this.nowFn = options.now ?? (() => Date.now());
  }

  /**
   * Starts the periodic heartbeat check.
   */
  start(): void {
    if (this.intervalTimer !== null) return;
    this.intervalTimer = setInterval(() => {
      void this.check();
    }, this.intervalMs);
  }

  /**
   * Stops the periodic heartbeat check and clears the interval timer.
   */
  stop(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  /**
   * Executes a single heartbeat sweep across all registered agents.
   */
  async check(): Promise<{ markedOffline: string[]; deregistered: string[] }> {
    const nowMs = this.nowFn();
    const markedOffline: string[] = [];
    const deregistered: string[] = [];

    const agents = this.getAllAgents();

    for (const agent of agents) {
      const lastSeenMs = this.resolveLastSeenMs(agent);
      const elapsed = nowMs - lastSeenMs;
      const status = agent.status ?? 'online';

      // 1. Online -> Offline after 15 minutes of inactivity
      if (status === 'online' && elapsed >= this.offlineThresholdMs) {
        this.updateAgentStatus(agent.id, 'offline');
        markedOffline.push(agent.id);
        this.emitEvent('agent_offline', agent.id);
        logger.info({ agentId: agent.id, elapsedMs: elapsed }, 'Agent marked offline due to heartbeat timeout');
      }
      // 2. Offline -> Deregistered after 45 minutes of inactivity
      else if (status === 'offline' && elapsed >= this.deregisterThresholdMs) {
        this.updateAgentStatus(agent.id, 'deregistered');
        deregistered.push(agent.id);
        this.emitEvent('agent_deregistered', agent.id);
        await this.revokeAgentOnChain(agent.id);
        logger.info({ agentId: agent.id, elapsedMs: elapsed }, 'Agent deregistered due to heartbeat timeout');
      }
    }

    return { markedOffline, deregistered };
  }

  /**
   * Shorthand alias for check()
   */
  async checkHeartbeats(): Promise<{ markedOffline: string[]; deregistered: string[] }> {
    return this.check();
  }

  private getAllAgents(): AgentRecord[] {
    if (this.rawDb) {
      try {
        const rows = this.rawDb.prepare('SELECT * FROM agents').all() as any[];
        return rows.map(r => ({
          ...r,
          capabilities: typeof r.capabilities === 'string' ? JSON.parse(r.capabilities) : (r.capabilities ?? []),
          status: r.status ?? 'offline',
        }));
      } catch {
        // Fallback to agentDb
      }
    }
    return this.agentDb.list();
  }

  private resolveLastSeenMs(agent: AgentRecord): number {
    const agentAny = agent as any;
    if (typeof agentAny.last_seen_at === 'number' && agentAny.last_seen_at > 0) {
      return agentAny.last_seen_at * 1000;
    }
    if (agent.lastSeenAt) {
      const parsed = Date.parse(agent.lastSeenAt);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return 0;
  }

  private updateAgentStatus(agentId: string, newStatus: 'online' | 'offline' | 'deregistered'): void {
    if (this.rawDb) {
      try {
        this.rawDb.prepare('UPDATE agents SET status = ? WHERE id = ?').run(newStatus, agentId);
        return;
      } catch {
        // Fallback to agentDb
      }
    }

    const current = this.agentDb.findById(agentId);
    if (current) {
      this.agentDb.upsert({
        ...current,
        status: newStatus as any,
      });
    }
  }

  private emitEvent(eventName: 'agent_offline' | 'agent_deregistered', agentId: string): void {
    const payload = { agentId, reason: 'heartbeat_timeout' };
    if (!this.bus) return;

    try {
      if (typeof this.bus.emit === 'function') {
        // 1. Direct event name subscription: bus.on('agent_offline', payload => ...)
        this.bus.emit(eventName, payload);
        // 2. Coordinator channel emission: bus.emit('system', event)
        this.bus.emit('system', {
          type: eventName,
          taskId: 'system',
          timestamp: new Date(this.nowFn()).toISOString(),
          payload,
          agentId,
          reason: 'heartbeat_timeout',
        });
      }
    } catch (err) {
      logger.warn({ err, eventName, agentId }, 'Failed to emit agent heartbeat event');
    }
  }

  private async revokeAgentOnChain(agentId: string): Promise<void> {
    if (this.revokedAgentIds.has(agentId)) {
      return; // Ensure called exactly once per agent
    }
    this.revokedAgentIds.add(agentId);

    if (this.revokeOnChainFn) {
      try {
        await this.revokeOnChainFn(agentId);
      } catch (err) {
        logger.error({ err, agentId }, 'Custom on-chain agent revocation failed');
      }
      return;
    }

    try {
      // Default on-chain revocation helper if present
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const registry = require('../../../smart-contracts/src/registry/registry');
      if (typeof registry.deregisterAgent === 'function') {
        registry.deregisterAgent(agentId);
      }
    } catch {
      // Ignore if smart contract package is not loaded in current environment
    }
  }
}
