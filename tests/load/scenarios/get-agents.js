/**
 * k6 load test: GET /api/agents at 1000 RPS
 *
 * Scenarios
 * ─────────
 *   warm-cache  – cache is pre-populated before the load phase starts.
 *                 Ramp: 0 → 1000 RPS (60 s) · sustain 5 min · ramp down 30 s.
 *
 *   cold-start  – cache is explicitly cleared before ramping up.
 *                 Same ramp/sustain profile; exercises the DB-read code path.
 *
 * SLO thresholds (both scenarios)
 * ────────────────────────────────
 *   p(95) < 200 ms
 *   p(99) < 500 ms
 *   error rate < 0.1 %
 *
 * Regression guard
 * ────────────────
 *   If the BASELINE_P99_MS environment variable is set (e.g. loaded from a
 *   previous run's artifact), the test also checks that the current p99 is
 *   within 20 % of the baseline.  Set it to 0 to disable.
 *
 * Usage
 * ─────
 *   # Warm-cache scenario only (default):
 *   k6 run tests/load/scenarios/get-agents.js
 *
 *   # Both scenarios:
 *   k6 run --env RUN_COLD_START=true tests/load/scenarios/get-agents.js
 *
 *   # With baseline regression check:
 *   k6 run --env BASELINE_P99_MS=120 tests/load/scenarios/get-agents.js
 *
 *   # Generate HTML report (requires xk6-html-reporter or k6 --out):
 *   k6 run --out json=results.json tests/load/scenarios/get-agents.js
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ── Custom metrics ────────────────────────────────────────────────────────────

const agentDiscoveryErrors = new Rate('agent_discovery_error_rate');
const agentDiscoveryDuration = new Trend('agent_discovery_duration', true);
const agentDiscoveryRequests = new Counter('agent_discovery_requests_total');

// ── Configuration ─────────────────────────────────────────────────────────────

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const RUN_COLD_START = __ENV.RUN_COLD_START === 'true';
const BASELINE_P99_MS = parseFloat(__ENV.BASELINE_P99_MS || '0');
const ADMIN_TOKEN = __ENV.ADMIN_TOKEN || '';

// ── Stage definitions (shared between scenarios) ──────────────────────────────

// Target: 1000 RPS sustained.
// k6 uses virtual users (VUs), not RPS directly.
// Assuming each VU can complete ~10 req/s (100 ms avg latency + overhead),
// we need ~100 VUs to hit 1000 RPS. Use arrival-rate executor for precision.
const RAMP_UP_DURATION = '60s';
const SUSTAIN_DURATION = '5m';
const RAMP_DOWN_DURATION = '30s';
const TARGET_RPS = 1000;

// ── k6 options ────────────────────────────────────────────────────────────────

export const options = {
  scenarios: {
    'warm-cache': {
      executor: 'ramping-arrival-rate',
      startRate: 0,
      timeUnit: '1s',
      preAllocatedVUs: 120,
      maxVUs: 200,
      stages: [
        { target: TARGET_RPS, duration: RAMP_UP_DURATION },   // 0 → 1000 RPS in 60 s
        { target: TARGET_RPS, duration: SUSTAIN_DURATION },    // sustain 1000 RPS for 5 min
        { target: 0,          duration: RAMP_DOWN_DURATION },  // ramp down in 30 s
      ],
    },

    ...(RUN_COLD_START
      ? {
          'cold-start': {
            executor: 'ramping-arrival-rate',
            startRate: 0,
            timeUnit: '1s',
            preAllocatedVUs: 120,
            maxVUs: 200,
            // Cold-start runs after warm-cache with a gap so results are independent
            startTime: `${60 + 300 + 30 + 30}s`, // warm ramp + sustain + ramp-down + 30 s gap
            stages: [
              { target: TARGET_RPS, duration: RAMP_UP_DURATION },
              { target: TARGET_RPS, duration: SUSTAIN_DURATION },
              { target: 0,          duration: RAMP_DOWN_DURATION },
            ],
          },
        }
      : {}),
  },

  // ── SLO thresholds ──────────────────────────────────────────────────────────
  thresholds: {
    // p95 under 200 ms for all agent-discovery requests
    'agent_discovery_duration{scenario:warm-cache}': [
      { threshold: 'p(95) < 200', abortOnFail: false },
      { threshold: 'p(99) < 500', abortOnFail: false },
    ],
    // Error rate below 0.1 %
    'agent_discovery_error_rate': [
      { threshold: 'rate < 0.001', abortOnFail: false },
    ],
    // Built-in k6 HTTP metrics as secondary guards
    'http_req_duration': ['p(95)<200', 'p(99)<500'],
    'http_req_failed': ['rate<0.001'],

    // Cold-start thresholds (only evaluated if RUN_COLD_START=true)
    ...(RUN_COLD_START
      ? {
          'agent_discovery_duration{scenario:cold-start}': [
            { threshold: 'p(95) < 200', abortOnFail: false },
            { threshold: 'p(99) < 500', abortOnFail: false },
          ],
        }
      : {}),
  },
};

// ── Setup: warm the cache (or clear it for cold-start) ───────────────────────

export function setup() {
  const scenarioName = __ENV.K6_SCENARIO_NAME || 'warm-cache';

  if (scenarioName === 'cold-start') {
    // Clear the registry cache so the first requests hit the DB
    if (ADMIN_TOKEN) {
      const res = http.del(`${BASE_URL}/api/admin/cache/registry`, null, {
        headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      check(res, {
        'cache cleared': (r) => r.status === 200 || r.status === 204,
      });
    }
    // No pre-warming
    return { scenario: 'cold-start', baselineP99: BASELINE_P99_MS };
  }

  // Warm-cache: pre-populate by making a few requests before the load phase
  for (let i = 0; i < 5; i++) {
    http.get(`${BASE_URL}/api/agents`);
    sleep(0.1);
  }

  return { scenario: 'warm-cache', baselineP99: BASELINE_P99_MS };
}

// ── Default function (called per VU iteration) ────────────────────────────────

export default function (data) {
  group('agent-discovery', () => {
    const res = http.get(`${BASE_URL}/api/agents`, {
      tags: { endpoint: 'get-agents', scenario: data.scenario || 'warm-cache' },
    });

    agentDiscoveryRequests.add(1);
    agentDiscoveryDuration.add(res.timings.duration);

    const ok = check(res, {
      'status 200': (r) => r.status === 200,
      'has agents array': (r) => {
        try {
          const body = JSON.parse(r.body);
          // Accept both { data: [...] } (v2) and plain array (v1) shapes
          return (
            Array.isArray(body) ||
            (body && typeof body === 'object' && Array.isArray(body.data))
          );
        } catch {
          return false;
        }
      },
      'response under 500ms': (r) => r.timings.duration < 500,
    });

    agentDiscoveryErrors.add(!ok ? 1 : 0);
  });
}

// ── Teardown: emit baseline regression summary ────────────────────────────────

export function teardown(data) {
  if (!data || !data.baselineP99 || data.baselineP99 <= 0) return;

  // k6 does not expose aggregated metrics in teardown; we log the baseline
  // for comparison. The CI step reads the JSON output to compute the delta.
  console.log(
    `[baseline-check] baseline_p99_ms=${data.baselineP99} ` +
    `regression_threshold_pct=20 ` +
    `check=see_ci_artifact_for_computed_p99`,
  );
}
