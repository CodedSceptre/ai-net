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
/**
 * Prometheus metric definitions using prom-client.
 *
 * Defines the metric registry and all application metrics:
 * - api_requests_total: HTTP request counter with method/route/status_code labels
 * - api_response_duration_ms: HTTP response duration histogram
 * - task_executions_total: Task execution counter with status label
 * - dag_execution_duration_ms: DAG execution duration histogram
 * - venice_calls_total: Venice AI call counter with outcome label
 * - active_websocket_connections: WebSocket connection gauge
 *
 * Default Node.js metrics (event loop lag, memory, GC) are also collected.
 */
import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

export const register = new Registry();

// Enable default Node.js metrics (event loop lag, memory, GC).
collectDefaultMetrics({ register });

export const apiRequestsTotal = new Counter({
  name: 'api_requests_total',
  help: 'Total number of HTTP requests',
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
export const apiResponseDurationMs = new Histogram({
  name: 'api_response_duration_ms',
  help: 'HTTP response duration in milliseconds',
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
export const taskExecutionsTotal = new Counter({
  name: 'task_executions_total',
  help: 'Total number of task executions',
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
export const dagExecutionDurationMs = new Histogram({
  name: 'dag_execution_duration_ms',
  help: 'DAG execution duration in milliseconds',
  labelNames: [] as const,
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
export const veniceCallsTotal = new Counter({
  name: 'venice_calls_total',
  help: 'Total number of Venice AI calls',
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
export const activeWebsocketConnections = new Gauge({
  name: 'active_websocket_connections',
  help: 'Number of active WebSocket connections',
  registers: [register],
});
