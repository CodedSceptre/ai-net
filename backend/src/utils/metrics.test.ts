import express from 'express';
import request from 'supertest';
import {
  register,
  apiRequestsTotal,
  apiResponseDurationMs,
  taskExecutionsTotal,
  dagExecutionDurationMs,
  veniceCallsTotal,
  activeWebsocketConnections,
  recordApiRequest,
  recordTaskExecution,
  recordDagExecution,
  recordVeniceCall,
  incrementWebSocketConnections,
  decrementWebSocketConnections,
  getMetricsText,
} from './metrics';
import { metricsMiddleware, normalizeRoute } from '../api/middleware/metricsMiddleware';
import { createMetricsRouter } from '../api/routes/metrics';

describe('Prometheus Metrics Infrastructure (#659)', () => {
  describe('Metric Registry & Definitions', () => {
    it('registers all 6 application metric families in the global registry', async () => {
      const metrics = await register.getMetricsAsJSON();
      const metricNames = metrics.map(m => m.name);

      expect(metricNames).toContain('api_requests_total');
      expect(metricNames).toContain('api_response_duration_ms');
      expect(metricNames).toContain('task_executions_total');
      expect(metricNames).toContain('dag_execution_duration_ms');
      expect(metricNames).toContain('venice_calls_total');
      expect(metricNames).toContain('active_websocket_connections');
    });

    it('registers default Node.js process metrics via collectDefaultMetrics()', async () => {
      const metricsText = await getMetricsText();

      // Check for standard nodejs default metrics
      expect(metricsText).toMatch(/process_cpu_seconds_total|nodejs_eventloop_lag_seconds|process_resident_memory_bytes/);
    });

    it('can increment api_requests_total with method, route, and status_code labels', async () => {
      recordApiRequest('GET', '/api/tasks/:id', 200, 45);

      const metricsText = await getMetricsText();
      expect(metricsText).toContain('api_requests_total{method="GET",route="/api/tasks/:id",status_code="200"}');
    });

    it('can observe api_response_duration_ms with route label and histogram buckets', async () => {
      recordApiRequest('POST', '/api/tasks', 201, 120);

      const metricsText = await getMetricsText();
      expect(metricsText).toContain('api_response_duration_ms_bucket{le="250",route="/api/tasks"}');
      expect(metricsText).toContain('api_response_duration_ms_count{route="/api/tasks"}');
    });

    it('can record task executions with status completed, failed, and timeout', async () => {
      recordTaskExecution('completed');
      recordTaskExecution('failed');
      recordTaskExecution('timeout');

      const metricsText = await getMetricsText();
      expect(metricsText).toContain('task_executions_total{status="completed"}');
      expect(metricsText).toContain('task_executions_total{status="failed"}');
      expect(metricsText).toContain('task_executions_total{status="timeout"}');
    });

    it('can observe dag_execution_duration_ms histogram', async () => {
      recordDagExecution(350);

      const metricsText = await getMetricsText();
      expect(metricsText).toContain('dag_execution_duration_ms_bucket{le="500"}');
      expect(metricsText).toContain('dag_execution_duration_ms_count');
    });

    it('can record venice AI calls with outcomes success, error, timeout, circuit_open', async () => {
      recordVeniceCall('success');
      recordVeniceCall('error');
      recordVeniceCall('timeout');
      recordVeniceCall('circuit_open');

      const metricsText = await getMetricsText();
      expect(metricsText).toContain('venice_calls_total{outcome="success"}');
      expect(metricsText).toContain('venice_calls_total{outcome="error"}');
      expect(metricsText).toContain('venice_calls_total{outcome="timeout"}');
      expect(metricsText).toContain('venice_calls_total{outcome="circuit_open"}');
    });

    it('increments and decrements active_websocket_connections gauge', async () => {
      incrementWebSocketConnections();
      incrementWebSocketConnections();
      decrementWebSocketConnections();

      const metricsText = await getMetricsText();
      expect(metricsText).toContain('active_websocket_connections');
    });
  });

  describe('Route Normalization', () => {
    it('normalizes UUIDs to :id', () => {
      expect(normalizeRoute('/api/tasks/550e8400-e29b-41d4-a716-446655440000')).toBe('/api/tasks/:id');
    });

    it('normalizes task_ and agent_ prefixed IDs to :id', () => {
      expect(normalizeRoute('/api/tasks/task_12345')).toBe('/api/tasks/:id');
      expect(normalizeRoute('/api/agents/agent_research_01')).toBe('/api/agents/:id');
    });

    it('normalizes numeric IDs to :id', () => {
      expect(normalizeRoute('/api/users/99824')).toBe('/api/users/:id');
    });

    it('strips query parameters', () => {
      expect(normalizeRoute('/api/tasks?limit=10&page=2')).toBe('/api/tasks');
    });
  });

  describe('metricsMiddleware & GET /metrics integration', () => {
    it('instruments HTTP requests and serves Prometheus exposition format on GET /metrics', async () => {
      const app = express();
      app.use(metricsMiddleware);
      app.use('/metrics', createMetricsRouter());

      app.get('/api/tasks/:id', (_req, res) => {
        res.status(200).json({ id: 'task_123', status: 'completed' });
      });

      // Issue a request through the instrumented middleware
      const response = await request(app).get('/api/tasks/task_123');
      expect(response.status).toBe(200);

      // Scrape /metrics endpoint
      const metricsResponse = await request(app).get('/metrics');
      expect(metricsResponse.status).toBe(200);
      expect(metricsResponse.headers['content-type']).toContain('text/plain; version=0.0.4');

      const body = metricsResponse.text;
      expect(body).toContain('api_requests_total');
      expect(body).toContain('api_response_duration_ms');
      expect(body).toContain('task_executions_total');
      expect(body).toContain('dag_execution_duration_ms');
      expect(body).toContain('venice_calls_total');
      expect(body).toContain('active_websocket_connections');
    });
  });
});
