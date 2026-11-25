/**
 * Sentry integration shim for ai-net.
 *
 * Uses @sentry/react when VITE_SENTRY_DSN is configured; falls back to a
 * no-op implementation so the app works without the package installed.
 *
 * To enable real Sentry reporting:
 *   1. Add @sentry/react to frontend/package.json dependencies
 *   2. Set VITE_SENTRY_DSN in your .env file
 *   3. Optionally set VITE_SENTRY_TRACES_SAMPLE_RATE (default: 0.1)
 */

export interface SentryScope {
  extras?: Record<string, unknown>;
}

/** Thin subset of the Sentry API surface used by ai-net. */
export interface SentryAdapter {
  captureException(error: Error, context?: { extra?: Record<string, unknown> }): string;
  lastEventId(): string | undefined;
}

/** No-op adapter used when Sentry is not configured. */
class NoOpSentry implements SentryAdapter {
  captureException(error: Error, context?: { extra?: Record<string, unknown> }): string {
    if (import.meta.env.DEV) {
      console.error('[Sentry no-op] captureException:', error, context);
    }
    return `local-${Date.now().toString(36)}`;
  }

  lastEventId(): string | undefined {
    return undefined;
  }
}

/** Real Sentry adapter — only instantiated when @sentry/react is resolvable. */
class RealSentry implements SentryAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly sdk: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(sdk: any) {
    this.sdk = sdk;
  }

  captureException(error: Error, context?: { extra?: Record<string, unknown> }): string {
    this.sdk.captureException(error, context ? { extra: context.extra } : undefined);
    return this.sdk.lastEventId() ?? `sentry-${Date.now().toString(36)}`;
  }

  lastEventId(): string | undefined {
    return this.sdk.lastEventId();
  }
}

let _adapter: SentryAdapter | null = null;

/**
 * Initialise the Sentry adapter at app startup.
 *
 * Call once in main.tsx before the first render.  Safe to call multiple times
 * — subsequent calls are no-ops.
 */
export async function initSentry(): Promise<void> {
  if (_adapter) return;

  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) {
    _adapter = new NoOpSentry();
    return;
  }

  try {
    // Dynamic import keeps @sentry/react out of the critical path when absent.
    const Sentry = await import('@sentry/react');
    const tracesSampleRate = Number(
      (import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE as string | undefined) ?? '0.1',
    );

    Sentry.init({ dsn, tracesSampleRate });
    _adapter = new RealSentry(Sentry);
  } catch {
    // Package not installed — fall back gracefully.
    if (import.meta.env.DEV) {
      console.warn('[Sentry] @sentry/react not installed; using no-op adapter.');
    }
    _adapter = new NoOpSentry();
  }
}

/** Returns the active Sentry adapter (always defined after initSentry()). */
export function getSentry(): SentryAdapter {
  if (!_adapter) {
    // Called before initSentry() — use no-op for safety.
    _adapter = new NoOpSentry();
  }
  return _adapter;
}

/**
 * Capture an exception and return the Sentry event ID (or a local fallback).
 * Safe to call before initSentry().
 */
export function captureException(
  error: Error,
  extra?: Record<string, unknown>,
): string {
  return getSentry().captureException(error, extra ? { extra } : undefined);
}
