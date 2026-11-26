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
/**
 * HeartbeatMonitor — detects and handles dead agents.
 *
 * Runs periodic checks every 60 seconds:
 *   - Agents with status='online' and lastSeenAt < NOW() - 15 min → 'offline'
 *   - Agents with status='offline' and lastSeenAt < NOW() - 45 min → 'deregistered'
 *   - On deregistered: call on-chain revocation + emit agent_deregistered event
 *
 * Thresholds are configurable via environment variables:
 *   HEARTBEAT_OFFLINE_THRESHOLD_MS    (default: 900_000  = 15 minutes)
 *   HEARTBEAT_DEREGISTER_THRESHOLD_MS (default: 2_700_000 = 45 minutes)
 */

import { createLogger } from '../utils/logger';
import { getAgentDb, createAgentDb, type AgentDb } from '../db/agents';
import { eventBus } from '../coordinator/eventBus';

const logger = createLogger({ component: 'heartbeat-monitor' });

const DEFAULT_CHECK_INTERVAL_MS = 60_000;
const DEFAULT_OFFLINE_THRESHOLD_MS = Number(
  process.env['HEARTBEAT_OFFLINE_THRESHOLD_MS'] ?? 900_000,
);
const DEFAULT_DEREGISTER_THRESHOLD_MS = Number(
  process.env['HEARTBEAT_DEREGISTER_THRESHOLD_MS'] ?? 2_700_000,
);

export interface HeartbeatMonitorOptions {
  /** How often the monitor polls the DB (default: 60 s). */
  checkIntervalMs?: number;
  /** Mark online agents offline if unseen for this long (default: 15 min). */
  offlineThresholdMs?: number;
  /** Mark offline agents deregistered if unseen for this long (default: 45 min). */
  deregisterThresholdMs?: number;
  /**
   * Pre-opened AgentDb instance.  When omitted the monitor opens the shared
   * production DB via `createAgentDb(getAgentDb())`.
   */
  db?: AgentDb;
  /**
   * Called when an agent must be deregistered on-chain.  Production code
   * should inject a function that delegates to `StellarService.revokeAgent`.
   * Defaults to a no-op so the monitor can run without a Stellar connection.
   */
  onChainRevoke?: (agentId: string) => Promise<void>;
}

export class HeartbeatMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs: number;
  private readonly offlineThresholdMs: number;
  private readonly deregisterThresholdMs: number;
  private readonly getDb: () => AgentDb;
  private readonly onChainRevoke: (agentId: string) => Promise<void>;

  constructor(options: HeartbeatMonitorOptions = {}) {
    this.checkIntervalMs = options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
    this.offlineThresholdMs = options.offlineThresholdMs ?? DEFAULT_OFFLINE_THRESHOLD_MS;
    this.deregisterThresholdMs = options.deregisterThresholdMs ?? DEFAULT_DEREGISTER_THRESHOLD_MS;

    if (options.db) {
      const db = options.db;
      this.getDb = () => db;
    } else {
      // Lazily open the shared production DB on first use so construction
      // never touches the filesystem when running in tests.
      this.getDb = () => createAgentDb(getAgentDb());
    }

    this.onChainRevoke = options.onChainRevoke ?? this.defaultOnChainRevoke.bind(this);
  }

  private async defaultOnChainRevoke(agentId: string): Promise<void> {
    // No-op default — production should inject an actual Stellar revocation.
    logger.info({ agentId }, 'on-chain revocation (default no-op)');
  }

  /**
   * Start the periodic check.  Calling `start()` more than once is a no-op;
   * the second call is silently ignored.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runCheck();
    }, this.checkIntervalMs);
    logger.info(
      {
        checkIntervalMs: this.checkIntervalMs,
        offlineThresholdMs: this.offlineThresholdMs,
        deregisterThresholdMs: this.deregisterThresholdMs,
      },
      'HeartbeatMonitor started',
    );
  }

  /**
   * Stop the periodic check and release the interval.  Safe to call when the
   * monitor is already stopped.
   */
  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.info('HeartbeatMonitor stopped');
  }

  /**
   * Run one check cycle immediately.  Called automatically by the interval
   * and exposed for testing or manual invocation.
   */
  async runCheck(): Promise<void> {
    try {
      await this.markOffline();
      await this.markDeregistered();
    } catch (err) {
      logger.error({ err }, 'HeartbeatMonitor check failed');
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
   * Transitions online agents that have not sent a heartbeat within
   * `offlineThresholdMs` to 'offline'.
   */
  private async markOffline(): Promise<void> {
    const db = this.getDb();
    const thresholdSeconds = Math.floor(this.offlineThresholdMs / 1000);
    const count = db.markStaleAgents(thresholdSeconds);
    if (count > 0) {
      logger.info({ count }, 'Agents marked offline due to heartbeat timeout');
      const timestamp = new Date().toISOString();
      eventBus.emit('system', {
        type: 'AgentMarkedOffline',
        taskId: 'system',
        timestamp,
        payload: { count, reason: 'heartbeat_timeout' },
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
  /**
   * Finds agents that have been 'offline' for longer than `deregisterThresholdMs`
   * and transitions each one to 'deregistered', triggers on-chain revocation,
   * and emits an `AgentDeregistered` event.
   */
  private async markDeregistered(): Promise<void> {
    const db = this.getDb();
    const staleAgents = db.findStaleOfflineAgents(this.deregisterThresholdMs);

    for (const agent of staleAgents) {
      try {
        // Persist the status change before the async on-chain call so a crash
        // between the two does not leave the agent stuck in 'offline' forever.
        db.markDeregistered(agent.id);

        await this.onChainRevoke(agent.id);

        const timestamp = new Date().toISOString();
        eventBus.emit('system', {
          type: 'AgentDeregistered',
          taskId: 'system',
          timestamp,
          payload: { agentId: agent.id, reason: 'heartbeat_timeout' },
        });

        logger.info({ agentId: agent.id }, 'Agent deregistered due to heartbeat timeout');
      } catch (err) {
        logger.error({ agentId: agent.id, err }, 'Failed to deregister agent');
      }
    }
  }
}

/**
 * Shared singleton.  Inject a custom instance in tests; use this in
 * application startup code.
 */
export const heartbeatMonitor = new HeartbeatMonitor();
