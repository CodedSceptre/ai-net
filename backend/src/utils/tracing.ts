/**
 * OpenTelemetry SDK initialization for ai-net backend.
 *
 * This module MUST be imported before all other application code in the entry
 * point (backend/src/index.ts) so that auto-instrumentation patches are
 * applied before Express, HTTP, and SQLite modules are loaded.
 *
 * Configuration via environment variables:
 *   OTEL_SERVICE_NAME            — service name reported in traces (default: ai-net-backend)
 *   OTEL_EXPORTER_OTLP_ENDPOINT  — OTLP HTTP collector URL (default: http://localhost:4318)
 *   OTEL_TRACES_SAMPLER          — sampler type: always_on | always_off | parentbased_traceidratio
 *   OTEL_TRACES_SAMPLER_ARG      — ratio for parentbased_traceidratio (default: 0.1 in prod, 1.0 in dev)
 *
 * Issue #732
 */

import { SpanStatusCode, context, trace, propagation } from '@opentelemetry/api';
import type { Span, Tracer, Context } from '@opentelemetry/api';

// ─── Types re-exported for callers ──────────────────────────────────────────
export type { Span, Tracer };

// ─── Noop fallbacks (used if SDK fails to initialise) ────────────────────────

function noopStartActiveSpan<T>(
  _name: string,
  _attrs: Record<string, unknown>,
  fn: (span: Span) => T,
): T {
  // Return a minimal no-op span object so callers never need to null-check.
  const noopSpan: Span = {
    setAttribute: () => noopSpan,
    setAttributes: () => noopSpan,
    addEvent: () => noopSpan,
    setStatus: () => noopSpan,
    updateName: () => noopSpan,
    end: () => undefined,
    isRecording: () => false,
    recordException: () => undefined,
    spanContext: () => ({
      traceId: '00000000000000000000000000000000',
      spanId: '0000000000000000',
      traceFlags: 0,
    }),
  };
  return fn(noopSpan);
}

function noopInjectTraceparent(headers: Record<string, string>): void {
  void headers;
}

function noopGetTraceContext(): { traceId: string; spanId: string } {
  return { traceId: '', spanId: '' };
}

// ─── SDK initialisation ──────────────────────────────────────────────────────

let _tracer: Tracer | null = null;
let _sdkInitialised = false;

function buildSampler(env: NodeJS.ProcessEnv) {
  // Inline requires to keep the import side-effect-free when OTel is absent.
  const {
    AlwaysOnSampler,
    AlwaysOffSampler,
    ParentBasedSampler,
    TraceIdRatioBasedSampler,
  } = require('@opentelemetry/sdk-trace-base');

  const samplerType = env.OTEL_TRACES_SAMPLER ?? (env.NODE_ENV === 'production' ? 'parentbased_traceidratio' : 'always_on');
  const samplerArg = env.OTEL_TRACES_SAMPLER_ARG
    ? parseFloat(env.OTEL_TRACES_SAMPLER_ARG)
    : env.NODE_ENV === 'production' ? 0.1 : 1.0;

  switch (samplerType) {
    case 'always_off':
      return new AlwaysOffSampler();
    case 'parentbased_traceidratio':
      return new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(samplerArg) });
    case 'traceidratio':
      return new TraceIdRatioBasedSampler(samplerArg);
    case 'always_on':
    default:
      return new AlwaysOnSampler();
  }
}

try {
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
  const { Resource } = require('@opentelemetry/resources');
  const { SEMRESATTRS_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'ai-net-backend';
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

  const exporter = new OTLPTraceExporter({
    url: `${endpoint.replace(/\/$/, '')}/v1/traces`,
  });

  const sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
    }),
    traceExporter: exporter,
    sampler: buildSampler(process.env),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Express auto-instrumentation
        '@opentelemetry/instrumentation-express': { enabled: true },
        // HTTP auto-instrumentation (covers Venice AI + Stellar Horizon calls)
        '@opentelemetry/instrumentation-http': {
          enabled: true,
          // Inject W3C traceparent on outbound requests automatically
          headersToPropagate: ['traceparent', 'tracestate', 'x-correlation-id'],
        },
        // fs instrumentation covers SQLite file access
        '@opentelemetry/instrumentation-fs': { enabled: true },
      }),
    ],
  });

  sdk.start();
  _sdkInitialised = true;

  _tracer = trace.getTracer(serviceName, '1.0.0');

  // Flush and shut down cleanly on process exit
  const shutdown = async () => {
    try {
      await sdk.shutdown();
    } catch {
      // Best-effort — don't block process exit
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('beforeExit', shutdown);
} catch (err) {
  // OTel packages not installed or SDK failed — degrade gracefully to no-ops
  const msg = err instanceof Error ? err.message : String(err);
  if (!msg.includes('Cannot find module')) {
    // Unexpected error — log it, but don't crash the app
    console.warn('[tracing] OpenTelemetry SDK failed to initialise:', msg);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the OpenTelemetry tracer, or null when OTel is not available.
 * Prefer `startActiveSpan` and `injectTraceparent` over this.
 */
export function getTracer(): Tracer | null {
  return _tracer;
}

/**
 * Whether the OTel SDK initialised successfully.
 */
export function isTracingEnabled(): boolean {
  return _sdkInitialised;
}

/**
 * Run `fn` inside a new active span. Automatically sets the span status to
 * OK on success or ERROR on exception, then ends the span.
 *
 * Falls back to calling `fn` with a no-op span when OTel is unavailable.
 *
 * @param name    - Span name (e.g. 'api.handler', 'venice.ai.call')
 * @param attributes - Initial span attributes
 * @param fn      - Work to run inside the span; receives the active span
 */
export function startActiveSpan<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> | T {
  if (!_tracer) {
    return noopStartActiveSpan(name, attributes, fn);
  }

  return _tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: err instanceof Error ? err.message : String(err),
      });
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      throw err;
    } finally {
      span.end();
    }
  });
}

/**
 * Inject W3C `traceparent` (and `tracestate`) headers into an outbound
 * headers object using the currently active OTel context.
 *
 * Call this before every outbound fetch to Venice AI or Stellar Horizon to
 * propagate the trace across service boundaries.
 *
 * ```typescript
 * const headers: Record<string, string> = { 'Content-Type': 'application/json' };
 * injectTraceparent(headers);
 * await fetch(url, { headers });
 * ```
 */
export function injectTraceparent(headers: Record<string, string>): void {
  if (!_sdkInitialised) {
    noopInjectTraceparent(headers);
    return;
  }

  propagation.inject(context.active(), headers, {
    set(carrier: Record<string, string>, key: string, value: string) {
      carrier[key] = value;
    },
  });
}

/**
 * Returns the `traceId` and `spanId` from the currently active OTel span
 * context, or empty strings when no span is active.
 *
 * Used to inject trace correlation into pino log lines.
 */
export function getTraceContext(): { traceId: string; spanId: string } {
  if (!_sdkInitialised) {
    return noopGetTraceContext();
  }

  const ctx: Context = context.active();
  const spanCtx = trace.getSpanContext(ctx);
  if (!spanCtx) {
    return { traceId: '', spanId: '' };
  }
  return {
    traceId: spanCtx.traceId,
    spanId: spanCtx.spanId,
  };
}

/**
 * Manually create a span for one of the four key operations and end it
 * immediately with the given status. Useful for wrapping synchronous
 * operations (e.g. a single DB query) without async overhead.
 *
 * @param service   - Logical service name ('api', 'venice', 'stellar', 'db')
 * @param operation - Operation name  ('handler', 'inference', 'horizon', 'query')
 * @param attributes - Span attributes (HTTP method, URL, DB table, row count…)
 * @param status    - 'ok' | 'error'
 * @param errorMsg  - Error message when status is 'error'
 */
export function recordSpan(
  service: string,
  operation: string,
  attributes: Record<string, string | number | boolean>,
  status: 'ok' | 'error' = 'ok',
  errorMsg?: string,
): void {
  if (!_tracer) return;

  const span = _tracer.startSpan(`${service}.${operation}`, { attributes });
  if (status === 'error') {
    span.setStatus({ code: SpanStatusCode.ERROR, message: errorMsg });
    if (errorMsg) span.recordException(new Error(errorMsg));
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }
  span.end();
}
