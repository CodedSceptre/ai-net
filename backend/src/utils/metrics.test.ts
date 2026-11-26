/**
 * Unit tests for prom-client metric definitions.
 *
 * Each test resets the registry to avoid state bleed between cases.
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  register,
  apiRequestsTotal,
  apiResponseDurationMs,
  taskExecutionsTotal,
  dagExecutionDurationMs,
  veniceCallsTotal,
  activeWebsocketConnections,
} from './metrics';

describe('Prometheus metrics registry', () => {
  beforeEach(() => {
    register.resetMetrics();
  });

  it('registers all required metrics', async () => {
    const output = await register.metrics();
    expect(output).toContain('api_requests_total');
    expect(output).toContain('api_response_duration_ms');
    expect(output).toContain('task_executions_total');
    expect(output).toContain('dag_execution_duration_ms');
    expect(output).toContain('venice_calls_total');
    expect(output).toContain('active_websocket_connections');
  });

  it('increments api_requests_total and serializes correctly', async () => {
    apiRequestsTotal.inc({ method: 'GET', route: '/api/tasks', status_code: '200' });
    apiRequestsTotal.inc({ method: 'POST', route: '/api/tasks', status_code: '201' });

    const output = await register.metrics();
    expect(output).toContain('api_requests_total{method="GET",route="/api/tasks",status_code="200"} 1');
    expect(output).toContain('api_requests_total{method="POST",route="/api/tasks",status_code="201"} 1');
  });

  it('observes api_response_duration_ms histogram', async () => {
    apiResponseDurationMs.observe({ route: '/api/tasks/:id' }, 150);

    const output = await register.metrics();
    expect(output).toContain('api_response_duration_ms');
    expect(output).toContain('api_response_duration_ms_bucket{le="250",route="/api/tasks/:id"}');
  });

  it('increments task_executions_total with status labels', async () => {
    taskExecutionsTotal.inc({ status: 'completed' });
    taskExecutionsTotal.inc({ status: 'failed' });
    taskExecutionsTotal.inc({ status: 'timeout' });

    const output = await register.metrics();
    expect(output).toContain('task_executions_total{status="completed"} 1');
    expect(output).toContain('task_executions_total{status="failed"} 1');
    expect(output).toContain('task_executions_total{status="timeout"} 1');
  });

  it('increments venice_calls_total with outcome labels', async () => {
    veniceCallsTotal.inc({ outcome: 'success' });
    veniceCallsTotal.inc({ outcome: 'error' });
    veniceCallsTotal.inc({ outcome: 'timeout' });
    veniceCallsTotal.inc({ outcome: 'circuit_open' });

    const output = await register.metrics();
    expect(output).toContain('venice_calls_total{outcome="success"} 1');
    expect(output).toContain('venice_calls_total{outcome="error"} 1');
  });

  it('increments and decrements active_websocket_connections gauge', async () => {
    activeWebsocketConnections.inc();
    activeWebsocketConnections.inc();
    activeWebsocketConnections.dec();

    const output = await register.metrics();
    expect(output).toContain('active_websocket_connections 1');
  });

  it('outputs valid Prometheus text format with HELP and TYPE lines', async () => {
    const output = await register.metrics();
    expect(output).toMatch(/^# HELP \w+/m);
    expect(output).toMatch(/^# TYPE \w+ (counter|gauge|histogram)/m);
  });

  it('dag_execution_duration_ms uses correct buckets', async () => {
    dagExecutionDurationMs.observe(500);

    const output = await register.metrics();
    expect(output).toContain('dag_execution_duration_ms_bucket{le="500"}');
    expect(output).toContain('dag_execution_duration_ms_bucket{le="1000"}');
  });

  it('content type for metrics output includes version=0.0.4', () => {
    expect(register.contentType).toContain('text/plain');
    expect(register.contentType).toContain('version=0.0.4');
  });
});
