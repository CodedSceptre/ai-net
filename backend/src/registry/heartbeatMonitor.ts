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
