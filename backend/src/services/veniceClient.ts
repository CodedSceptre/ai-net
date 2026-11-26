/**
 * VeniceClient — production-hardened HTTP client for Venice AI inference.
 *
 * Features:
 *  - Base URL and API key read from validated environment config (veniceConfigSchema)
 *  - Authorization: Bearer header injected on every request
 *  - 30-second per-request timeout enforced via AbortController; throws VeniceTimeoutError
 *  - Circuit breaker (CLOSED / OPEN / HALF_OPEN) backed by VeniceCircuitBreaker
 *  - Exponential backoff with jitter: base 500 ms, 2× multiplier, 5 attempts, cap 16 s
 *  - Structured pino logs on every circuit state transition via VeniceCircuitBreaker
 *  - getStatus() delegates to the circuit breaker for health checks
 */

import { createLogger } from '../utils/logger.js';
import { VeniceCircuitBreaker } from './veniceCircuitBreaker.js';
import { CircuitOpenError, VeniceTimeoutError } from './venice/errors.js';
import { parseVeniceConfig } from '../config/venice.js';
import type { CircuitBreakerStatus } from './veniceCircuitBreaker.js';

const log = createLogger({ module: 'VeniceClient' });

// ── Backoff constants (per-issue spec) ────────────────────────────────────────
const BACKOFF_BASE_MS = 500;
const BACKOFF_MULTIPLIER = 2;
const MAX_ATTEMPTS = 5;           // 1 initial + 4 retries = 5 total (spec: "up to 5 retry attempts")
const BACKOFF_CAP_MS = 16_000;
const REQUEST_TIMEOUT_MS = 30_000;

// 5xx codes that warrant a retry; 4xx (except 429) are not retryable
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export interface VeniceRequest {
  /** Venice model identifier, e.g. 'llama-3.3-70b' */
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_tokens?: number;
}

export interface VeniceResponse {
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface VeniceClientOptions {
  /** Override base URL (defaults to VENICE_BASE_URL env var). */
  baseUrl?: string;
  /** Override API key (defaults to VENICE_API_KEY env var). */
  apiKey?: string;
  /** Override request timeout in ms (default 30 000). */
  timeoutMs?: number;
  /** Inject a circuit breaker instance (mainly for tests). */
  circuitBreaker?: VeniceCircuitBreaker;
  /** Override clock (mainly for tests). */
  now?: () => number;
  /** Override sleep (mainly for tests — set to () => Promise.resolve() to skip waits). */
  sleep?: (ms: number) => Promise<void>;
}

export class VeniceClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly circuitBreaker: VeniceCircuitBreaker;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: VeniceClientOptions = {}) {
    const cfg = parseVeniceConfig(process.env);

    this.baseUrl = (options.baseUrl ?? cfg.VENICE_BASE_URL).replace(/\/$/, '');
    this.apiKey = options.apiKey ?? cfg.VENICE_API_KEY;
    this.timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.circuitBreaker =
      options.circuitBreaker ??
      new VeniceCircuitBreaker({
        failureThreshold: cfg.VENICE_CIRCUIT_FAILURE_THRESHOLD,
        openDurationMs: cfg.VENICE_CIRCUIT_RECOVERY_WINDOW_MS,
        failureWindowMs: cfg.VENICE_CIRCUIT_FAILURE_WINDOW_MS,
        now: options.now,
      });
    this.sleep =
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * Send a chat-completions request to Venice AI.
   *
   * Throws:
   *  - CircuitOpenError   — circuit is OPEN; no HTTP request is made
   *  - VeniceTimeoutError — request exceeded timeoutMs
   *  - Error              — non-retryable HTTP error or all retries exhausted
   */
  async complete(request: VeniceRequest): Promise<VeniceResponse> {
    // Guard: fail fast if circuit is open — no HTTP call made
    this.circuitBreaker.assertClosed();

    const url = `${this.baseUrl}/chat/completions`;
    const body = JSON.stringify(request);
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        const delay = this.backoffDelay(attempt - 1);
        log.debug({ attempt, delayMs: delay }, 'venice retry backoff');
        await this.sleep(delay);

        // Re-check circuit before each retry (a previous attempt may have opened it)
        this.circuitBreaker.assertClosed();
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const controller = new AbortController();

      timeoutId = setTimeout(() => controller.abort('timeout'), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = (await response.json()) as VeniceResponse;
          this.circuitBreaker.recordSuccess();
          log.info({ status: response.status, attempt }, 'venice request succeeded');
          return data;
        }

        // Non-retryable 4xx (not 429)
        if (!RETRYABLE_STATUS_CODES.has(response.status)) {
          const err = new Error(
            `Venice returned non-retryable status ${response.status}`,
          );
          this.circuitBreaker.recordFailure();
          throw err;
        }

        // Retryable status — record and loop
        lastError = new Error(`Venice returned status ${response.status}`);
        log.warn({ status: response.status, attempt }, 'venice retryable error');
        this.circuitBreaker.recordFailure();

        if (attempt === MAX_ATTEMPTS - 1) {
          throw lastError;
        }

        continue;
      } catch (err) {
        clearTimeout(timeoutId!);

        if (err instanceof CircuitOpenError) throw err;

        // AbortController fired — timeout
        if (
          err instanceof Error &&
          (err.name === 'AbortError' || (err as any).cause === 'timeout')
        ) {
          const timeoutErr = new VeniceTimeoutError(this.timeoutMs);
          this.circuitBreaker.recordFailure();
          log.warn({ attempt, timeoutMs: this.timeoutMs }, 'venice request timed out');

          if (attempt === MAX_ATTEMPTS - 1) throw timeoutErr;
          lastError = timeoutErr;
          continue;
        }

        // Non-retryable error thrown above (non-retryable status)
        if (
          err instanceof Error &&
          err.message.startsWith('Venice returned non-retryable')
        ) {
          throw err;
        }

        // Network / fetch error — retryable
        lastError = err instanceof Error ? err : new Error(String(err));
        this.circuitBreaker.recordFailure();
        log.warn({ attempt, error: lastError.message }, 'venice network error');

        if (attempt === MAX_ATTEMPTS - 1) throw lastError;
      }
    }

    throw lastError ?? new Error('Venice AI is unreachable');
  }

  /**
   * Returns the current circuit breaker status for health check endpoints.
   */
  getStatus(): CircuitBreakerStatus {
    return this.circuitBreaker.getStatus();
  }

  /**
   * Compute exponential backoff delay with ±20% jitter.
   *
   * attempt 0 → 500 ms base
   * attempt 1 → 1 000 ms
   * attempt 2 → 2 000 ms
   * attempt 3 → 4 000 ms
   * attempt 4 → 8 000 ms  (capped at 16 000 ms)
   */
  private backoffDelay(attempt: number): number {
    const base = Math.min(
      BACKOFF_BASE_MS * Math.pow(BACKOFF_MULTIPLIER, attempt),
      BACKOFF_CAP_MS,
    );
    // ±20% jitter
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(50, Math.round(base + jitter));
  }
}
