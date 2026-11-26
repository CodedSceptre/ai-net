import { metricsService } from './metrics';
import { CircuitOpenError } from './venice/errors';
import { createLogger } from '../utils/logger';

const log = createLogger({ module: 'VeniceCircuitBreaker' });

export type VeniceCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerStatus {
  state: VeniceCircuitState;
  failureCount: number;
  lastFailureAt: number | null;
  nextAttemptAt: number | null;
}

export interface VeniceCircuitBreakerOptions {
  failureThreshold?: number;
  failureWindowMs?: number;
  openDurationMs?: number;
  halfOpenSuccessThreshold?: number;
  now?: () => number;
}

export class VeniceCircuitBreaker {
  private state: VeniceCircuitState = 'CLOSED';
  private readonly failures: number[] = [];
  private openedAt = 0;
  private halfOpenSuccesses = 0;
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly openDurationMs: number;
  private readonly halfOpenSuccessThreshold: number;
  private readonly now: () => number;

  constructor(options: VeniceCircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.failureWindowMs = options.failureWindowMs ?? 60_000;
    this.openDurationMs = options.openDurationMs ?? 30_000;
    this.halfOpenSuccessThreshold = options.halfOpenSuccessThreshold ?? 2;
    this.now = options.now ?? Date.now;
    this.publishState();
  }

  getState(): VeniceCircuitState {
    this.evaluateState();
    return this.state;
  }

  getFailureCount(): number {
    this.pruneFailures();
    return this.failures.length;
  }

  /**
   * Returns a snapshot of the breaker's current state for health checks and
   * observability endpoints.
   *
   * - `lastFailureAt`: Unix ms timestamp of the most recent failure, or null.
   * - `nextAttemptAt`: when the next probe will be allowed (openedAt +
   *   openDurationMs) while OPEN; null in every other state.
   */
  getStatus(): CircuitBreakerStatus {
    this.evaluateState();
    this.pruneFailures();
    return {
      state: this.state,
      failureCount: this.failures.length,
      lastFailureAt: this.failures.length > 0 ? this.failures[this.failures.length - 1]! : null,
      nextAttemptAt: this.state === 'OPEN' ? this.openedAt + this.openDurationMs : null,
    };
  }

  assertClosed(): void {
    this.evaluateState();
    if (this.state === 'OPEN') throw new CircuitOpenError();
  }

  recordSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      this.halfOpenSuccesses += 1;
      if (this.halfOpenSuccesses < this.halfOpenSuccessThreshold) return;
    }
    this.failures.length = 0;
    this.halfOpenSuccesses = 0;
    this.setState('CLOSED');
  }

  recordFailure(): void {
    this.evaluateState();
    if (this.state === 'HALF_OPEN') {
      this.open();
      return;
    }
    if (this.state === 'OPEN') return;

    this.pruneFailures();
    this.failures.push(this.now());
    if (this.failures.length >= this.failureThreshold) this.open();
  }

  private evaluateState(): void {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.openDurationMs) {
      this.halfOpenSuccesses = 0;
      this.setState('HALF_OPEN');
    }
  }

  private pruneFailures(): void {
    const cutoff = this.now() - this.failureWindowMs;
    while (this.failures.length > 0 && this.failures[0]! < cutoff) this.failures.shift();
  }

  private open(): void {
    this.openedAt = this.now();
    this.halfOpenSuccesses = 0;
    this.setState('OPEN');
  }

  private setState(state: VeniceCircuitState): void {
    if (this.state === state) return;
    const previousState = this.state;
    this.state = state;
    log.info(
      {
        state,
        previousState,
        failureCount: this.failures.length,
        reason: this.getTransitionReason(previousState, state),
      },
      `circuit breaker transition: ${previousState} → ${state}`,
    );
    this.publishState();
  }

  private getTransitionReason(from: VeniceCircuitState, to: VeniceCircuitState): string {
    if (from === 'CLOSED' && to === 'OPEN') return 'failure_threshold_reached';
    if (from === 'OPEN' && to === 'HALF_OPEN') return 'recovery_window_elapsed';
    if (from === 'HALF_OPEN' && to === 'CLOSED') return 'probe_succeeded';
    if (from === 'HALF_OPEN' && to === 'OPEN') return 'probe_failed';
    return 'unknown';
  }

  private publishState(): void {
    metricsService.setVeniceCircuitBreakerState(this.state.toLowerCase().replace('_', '-') as 'closed' | 'open' | 'half-open');
  }
}