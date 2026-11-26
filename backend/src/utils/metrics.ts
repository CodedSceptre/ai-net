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

export const apiResponseDurationMs = new Histogram({
  name: 'api_response_duration_ms',
  help: 'HTTP response duration in milliseconds',
  labelNames: ['route'] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

export const taskExecutionsTotal = new Counter({
  name: 'task_executions_total',
  help: 'Total number of task executions',
  labelNames: ['status'] as const,
  registers: [register],
});

export const dagExecutionDurationMs = new Histogram({
  name: 'dag_execution_duration_ms',
  help: 'DAG execution duration in milliseconds',
  labelNames: [] as const,
  buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
  registers: [register],
});

export const veniceCallsTotal = new Counter({
  name: 'venice_calls_total',
  help: 'Total number of Venice AI calls',
  labelNames: ['outcome'] as const,
  registers: [register],
});

export const activeWebsocketConnections = new Gauge({
  name: 'active_websocket_connections',
  help: 'Number of active WebSocket connections',
  registers: [register],
});
