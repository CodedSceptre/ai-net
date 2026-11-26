import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Global Prometheus registry for ai-net backend metrics.
 */
export const register = new Registry();

// Enable standard Node.js process / runtime metrics (memory, GC, event loop lag, etc.)
collectDefaultMetrics({ register });

/**
 * Counter for all inbound HTTP API requests.
 * Labels:
 *  - method: HTTP method (e.g. GET, POST)
 *  - route: Normalized route pattern (e.g. /api/tasks/:id)
 *  - status_code: HTTP response status code (e.g. 200, 404, 500)
 */
export const apiRequestsTotal = new Counter({
  name: 'api_requests_total',
  help: 'Total count of completed HTTP requests partitioned by method, route, and status code.',
  labelNames: ['method', 'route', 'status_code'] as const,
  registers: [register],
});

/**
 * Histogram for HTTP response duration in milliseconds.
 * Buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000]
 * Label: route
 */
export const apiResponseDurationMs = new Histogram({
  name: 'api_response_duration_ms',
  help: 'HTTP response duration in milliseconds partitioned by route pattern.',
  labelNames: ['route'] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

/**
 * Counter for task executions partitioned by outcome status.
 * Values for status: completed | failed | timeout
 */
export const taskExecutionsTotal = new Counter({
  name: 'task_executions_total',
  help: 'Total number of task executions partitioned by final status.',
  labelNames: ['status'] as const,
  registers: [register],
});

/**
 * Histogram for DAG execution duration in milliseconds.
 * Buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000]
 */
export const dagExecutionDurationMs = new Histogram({
  name: 'dag_execution_duration_ms',
  help: 'Duration of coordinator DAG execution in milliseconds.',
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

/**
 * Counter for Venice AI upstream invocations partitioned by outcome.
 * Values for outcome: success | error | timeout | circuit_open
 */
export const veniceCallsTotal = new Counter({
  name: 'venice_calls_total',
  help: 'Total count of Venice AI upstream calls by outcome.',
  labelNames: ['outcome'] as const,
  registers: [register],
});

/**
 * Gauge tracking active WebSocket client connections.
 */
export const activeWebsocketConnections = new Gauge({
  name: 'active_websocket_connections',
  help: 'Current number of active WebSocket connections.',
  registers: [register],
});

// ─────────────────────────────────────────────────────────────────────────────
// Metric recording helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Record an HTTP request's completion.
 */
export function recordApiRequest(
  method: string,
  route: string,
  statusCode: number | string,
  durationMs: number
): void {
  apiRequestsTotal.inc({
    method: method.toUpperCase(),
    route,
    status_code: String(statusCode),
  });
  apiResponseDurationMs.observe({ route }, durationMs);
}

/**
 * Record a task execution outcome.
 */
export function recordTaskExecution(
  status: 'completed' | 'failed' | 'timeout'
): void {
  taskExecutionsTotal.inc({ status });
}

/**
 * Record a DAG execution duration in milliseconds.
 */
export function recordDagExecution(durationMs: number): void {
  dagExecutionDurationMs.observe(durationMs);
}

/**
 * Record a Venice AI invocation outcome.
 */
export function recordVeniceCall(
  outcome: 'success' | 'error' | 'timeout' | 'circuit_open'
): void {
  veniceCallsTotal.inc({ outcome });
}

/**
 * Increment active WebSocket connections on client connect.
 */
export function incrementWebSocketConnections(): void {
  activeWebsocketConnections.inc();
}

/**
 * Decrement active WebSocket connections on client disconnect.
 */
export function decrementWebSocketConnections(): void {
  activeWebsocketConnections.dec();
}

/**
 * Export metrics in Prometheus text exposition format.
 */
export async function getMetricsText(): Promise<string> {
  return register.metrics();
}
